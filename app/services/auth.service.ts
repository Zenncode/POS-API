import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { AdminModel } from '../models/admin.model';
import { getSocketServer } from '../../socket/socket.server';
import { setCache } from './cache.service';

type TokenPayload = {
  sub: string;
  email: string;
  role: 'admin';
  tokenType: 'access' | 'refresh';
};

function getJwtSecret(): string {
  return process.env.JWT_SECRET ?? 'fallback-secret';
}

function getJwtExpiresIn(): string {
  return process.env.JWT_EXPIRES_IN ?? '15m';
}

function getRefreshSecret(): string {
  return process.env.JWT_REFRESH_SECRET ?? 'fallback-refresh-secret';
}

function getRefreshExpiresIn(): string {
  return process.env.JWT_REFRESH_EXPIRES_IN ?? '7d';
}

function getSaltRounds(): number {
  const parsed = Number(process.env.BCRYPT_SALT_ROUNDS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 12;
}

function createAccessToken(payload: Omit<TokenPayload, 'tokenType'>): string {
  return jwt.sign({ ...payload, tokenType: 'access' }, getJwtSecret(), {
    expiresIn: getJwtExpiresIn(),
  });
}

function createRefreshToken(payload: Omit<TokenPayload, 'tokenType'>): string {
  return jwt.sign({ ...payload, tokenType: 'refresh' }, getRefreshSecret(), {
    expiresIn: getRefreshExpiresIn(),
  });
}

function verifyRefreshToken(token: string): TokenPayload {
  return jwt.verify(token, getRefreshSecret()) as TokenPayload;
}

export type LoginAdminDto = {
  email: string;
  password: string;
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

export async function loginAdmin(dto: LoginAdminDto): Promise<AuthTokens> {
  const admin = await AdminModel.findOne({ email: dto.email.toLowerCase().trim() });
  if (!admin) {
    throw new Error('Invalid email or password');
  }

  const passwordMatch = await bcrypt.compare(dto.password, admin.passwordHash);
  if (!passwordMatch) {
    throw new Error('Invalid email or password');
  }

  const payload = { sub: admin._id.toString(), email: admin.email, role: 'admin' as const };
  const accessToken = createAccessToken(payload);
  const refreshToken = createRefreshToken(payload);

  const refreshHash = await bcrypt.hash(refreshToken, getSaltRounds());
  admin.refreshTokenHash = refreshHash;
  await admin.save();

  return { accessToken, refreshToken };
}

export async function refreshAdminSession(refreshToken: string): Promise<AuthTokens> {
  let decoded: TokenPayload;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    throw new Error('Invalid or expired refresh token');
  }

  if (decoded.tokenType !== 'refresh') {
    throw new Error('Invalid token type');
  }

  const admin = await AdminModel.findById(decoded.sub);
  if (!admin) {
    throw new Error('Admin not found');
  }

  if (admin.refreshTokenHash) {
    const storedHashValid = await bcrypt.compare(refreshToken, admin.refreshTokenHash);
    if (!storedHashValid) {
      await invalidateAdminSession(admin._id.toString());
      throw new Error('Refresh token has been revoked');
    }
  }

  const payload = { sub: admin._id.toString(), email: admin.email, role: 'admin' as const };
  const newAccessToken = createAccessToken(payload);
  const newRefreshToken = createRefreshToken(payload);

  const newRefreshHash = await bcrypt.hash(newRefreshToken, getSaltRounds());
  admin.refreshTokenHash = newRefreshHash;
  await admin.save();

  return { accessToken: newAccessToken, refreshToken: newRefreshToken };
}

export async function logoutAdmin(adminId: string): Promise<void> {
  await invalidateAdminSession(adminId);

  const io = getSocketServer();
  io?.to(`admin:${adminId}`).emit('session:revoked');
}

async function invalidateAdminSession(adminId: string): Promise<void> {
  const admin = await AdminModel.findById(adminId);
  if (admin) {
    admin.refreshTokenHash = null;
    await admin.save();
  }

  const cacheKey = `admin:session:${adminId}`;
  await setCache(cacheKey, { revoked: true }, 86400);
}

export async function seedAdminFromEnv(): Promise<void> {
  const email = process.env.ADMIN_SEED_EMAIL;
  const password = process.env.ADMIN_SEED_PASSWORD;

  if (!email || !password) {
    return;
  }

  const existing = await AdminModel.findOne({ email: email.toLowerCase().trim() });
  if (existing) {
    return;
  }

  const passwordHash = await bcrypt.hash(password, getSaltRounds());
  await AdminModel.create({ email: email.toLowerCase().trim(), passwordHash });
}
