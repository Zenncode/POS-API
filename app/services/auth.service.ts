import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { UserRole } from '@prisma/client';
import { getPrismaClient } from '../../config/prisma.client';
import { getEnv } from '../../config/env';
import { getSocketServer } from '../../socket/socket.server';
import { setCache, delCache } from './cache.service';
import { recordFailedLogin, clearFailedLogins } from './login-throttle.service';
import { writeAuditLog } from './audit.service';
import { unauthorized } from '../common/errors';

export type TokenPayload = {
  sub: string;
  email: string;
  role: 'ADMIN' | 'MANAGER' | 'CASHIER';
  tokenType: 'access' | 'refresh';
};

export type LoginDto = {
  email: string;
  password: string;
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
};

const REFRESH_COOKIE_NAME = 'rt';

function createAccessToken(payload: Omit<TokenPayload, 'tokenType'>): string {
  return jwt.sign({ ...payload, tokenType: 'access' }, getEnv().JWT_SECRET, {
    expiresIn: getEnv().JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

function createRefreshToken(payload: Omit<TokenPayload, 'tokenType'>): string {
  return jwt.sign({ ...payload, tokenType: 'refresh' }, getEnv().JWT_REFRESH_SECRET, {
    expiresIn: getEnv().JWT_REFRESH_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

function verifyRefreshToken(token: string): TokenPayload {
  return jwt.verify(token, getEnv().JWT_REFRESH_SECRET) as TokenPayload;
}

export function createOverrideToken(user: { id: string; email: string; role: UserRole }): string {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role as TokenPayload['role'], tokenType: 'override' },
    getEnv().JWT_SECRET,
    { expiresIn: getEnv().OVERRIDE_TOKEN_EXPIRES_IN as jwt.SignOptions['expiresIn'] },
  );
}

function getSaltRounds(): number {
  const env = getEnv();
  return env.NODE_ENV === 'development' ? 4 : env.BCRYPT_SALT_ROUNDS;
}

function setRefreshCookie(res: Response, refreshToken: string): void {
  const env = getEnv();
  const isProd = env.NODE_ENV === 'production';
  const maxAgeMs = 7 * 24 * 60 * 60 * 1000; // 7 days

  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: maxAgeMs,
    path: '/',
  });
}

function clearRefreshCookie(res: Response): void {
  const env = getEnv();
  const isProd = env.NODE_ENV === 'production';

  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
  });
}

async function issueTokens(user: { id: string; email: string; role: UserRole }, res: Response): Promise<string> {
  const payload = { sub: user.id, email: user.email, role: user.role as TokenPayload['role'] };
  const accessToken = createAccessToken(payload);
  const refreshToken = createRefreshToken(payload);

  const refreshHash = await bcrypt.hash(refreshToken, getSaltRounds());
  await getPrismaClient().user.update({
    where: { id: user.id },
    data: { refreshTokenHash: refreshHash },
  });

  setRefreshCookie(res, refreshToken);

  return accessToken;
}

export async function loginStaff(dto: LoginDto, res: Response, options?: { requireRole?: UserRole; ip?: string }): Promise<string> {
  const prisma = getPrismaClient();
  const email = dto.email.toLowerCase().trim();
  const ip = options?.ip ?? 'unknown';

  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || !user.isActive) {
    await recordFailedLogin(email, ip);
    await writeAuditLog({ action: 'LOGIN_FAILED', ip, result: 'FAILURE', metadata: { email, reason: 'user_not_found_or_inactive' } });
    throw unauthorized('Invalid email or password');
  }

  if (options?.requireRole && user.role !== options.requireRole) {
    await recordFailedLogin(email, ip);
    await writeAuditLog({ userId: user.id, action: 'LOGIN_FAILED', ip, result: 'FAILURE', metadata: { email, reason: 'role_mismatch' } });
    throw unauthorized('Invalid email or password');
  }

  const passwordMatch = await bcrypt.compare(dto.password, user.passwordHash);
  if (!passwordMatch) {
    await recordFailedLogin(email, ip);
    await writeAuditLog({ userId: user.id, action: 'LOGIN_FAILED', ip, result: 'FAILURE', metadata: { email, reason: 'invalid_password' } });
    throw unauthorized('Invalid email or password');
  }

  await clearFailedLogins(email, ip);
  await writeAuditLog({ userId: user.id, action: 'LOGIN', ip, result: 'SUCCESS', metadata: { email } });
  return issueTokens(user, res);
}

export async function refreshStaffSession(req: Request, res: Response): Promise<string> {
  const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
  const ip = req.ip;
  if (!refreshToken) {
    await writeAuditLog({ action: 'LOGIN_FAILED', ip, result: 'FAILURE', metadata: { reason: 'refresh_token_missing' } });
    throw unauthorized('Refresh token missing');
  }

  let decoded: TokenPayload;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    clearRefreshCookie(res);
    await writeAuditLog({ action: 'LOGIN_FAILED', ip, result: 'FAILURE', metadata: { reason: 'refresh_token_invalid' } });
    throw unauthorized('Invalid or expired refresh token');
  }

  if (decoded.tokenType !== 'refresh') {
    clearRefreshCookie(res);
    await writeAuditLog({ userId: decoded.sub, action: 'LOGIN_FAILED', ip, result: 'FAILURE', metadata: { reason: 'invalid_token_type' } });
    throw unauthorized('Invalid token type');
  }

  const prisma = getPrismaClient();
  const user = await prisma.user.findUnique({ where: { id: decoded.sub } });
  if (!user || !user.isActive) {
    clearRefreshCookie(res);
    await writeAuditLog({ userId: decoded.sub, action: 'LOGIN_FAILED', ip, result: 'FAILURE', metadata: { reason: 'user_not_found_or_inactive' } });
    throw unauthorized('User not found');
  }

  if (user.refreshTokenHash) {
    const storedHashValid = await bcrypt.compare(refreshToken, user.refreshTokenHash);
    if (!storedHashValid) {
      await invalidateStaffSession(user.id);
      clearRefreshCookie(res);
      await writeAuditLog({ userId: user.id, action: 'REFRESH_TOKEN_REUSE', ip, result: 'FAILURE' });
      throw unauthorized('Refresh token has been revoked');
    }
  }

  await writeAuditLog({ userId: user.id, action: 'LOGIN', ip, result: 'SUCCESS', metadata: { refreshed: true } });
  return issueTokens(user, res);
}

export async function logoutStaff(userId: string, res: Response, ip?: string): Promise<void> {
  await invalidateStaffSession(userId);
  clearRefreshCookie(res);
  await writeAuditLog({ userId, action: 'LOGOUT', ip, result: 'SUCCESS' });

  const io = getSocketServer();
  io?.to(`user:${userId}`).emit('session:revoked');
}

export async function getStaffProfile(userId: string): Promise<AuthUser | null> {
  const user = await getPrismaClient().user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true },
  });

  return user;
}

async function invalidateStaffSession(userId: string): Promise<void> {
  const prisma = getPrismaClient();
  await prisma.user.update({
    where: { id: userId },
    data: { refreshTokenHash: null },
  });

  await delCache(`user:session:${userId}`);
  await setCache(`user:session:${userId}`, { revoked: true }, 86400);
}

export async function seedStaffFromEnv(): Promise<void> {
  const env = getEnv();
  const email = env.ADMIN_SEED_EMAIL;
  const password = env.ADMIN_SEED_PASSWORD;

  if (!email || !password) {
    return;
  }

  const prisma = getPrismaClient();
  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (existing) {
    return;
  }

  const passwordHash = await bcrypt.hash(password, getSaltRounds());
  await prisma.user.create({
    data: {
      email: email.toLowerCase().trim(),
      passwordHash,
      name: 'Owner',
      role: UserRole.ADMIN,
    },
  });
}