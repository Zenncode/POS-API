import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { getEnv } from '../../../config/env';
import { AppError, forbidden, unauthorized } from '../errors';

export type JwtPayload = {
  sub: string;
  email: string;
  role: 'ADMIN' | 'MANAGER' | 'CASHIER';
  tokenType: string;
};

export type RequestUser = NonNullable<Request['user']>;

export type UserRole = RequestUser['role'];

function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, getEnv().JWT_SECRET) as JwtPayload;
}

export function authGuard(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({ message: 'Authorization header is required' });
    return;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    res.status(401).json({ message: 'Authorization header must be Bearer <token>' });
    return;
  }

  try {
    const decoded = verifyAccessToken(parts[1]);

    if (decoded.tokenType !== 'access') {
      res.status(401).json({ message: 'Invalid token type' });
      return;
    }

    req.user = {
      id: decoded.sub,
      email: decoded.email,
      role: decoded.role,
    };

    next();
  } catch (error) {
    const message =
      error instanceof Error && error.name === 'TokenExpiredError' ? 'Token has expired' : 'Invalid token';
    res.status(401).json({ message });
  }
}

export function requireRoles(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ message: unauthorized().message });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ message: forbidden('Insufficient role').message });
      return;
    }

    next();
  };
}

export const MANAGER_ROLES: UserRole[] = ['ADMIN', 'MANAGER'];

export function adminAuthGuard(req: Request, res: Response, next: NextFunction): void {
  authGuard(req, res, (): void => {
    if (res.headersSent) {
      return;
    }

    requireRoles('ADMIN')(req, res, next);
  });
}

export type OverridePayload = {
  sub: string;
  email: string;
  role: 'ADMIN' | 'MANAGER';
  tokenType: string;
};

export function verifyOverrideToken(token: string): OverridePayload {
  const decoded = jwt.verify(token, getEnv().JWT_SECRET) as OverridePayload;

  if (decoded.tokenType !== 'override') {
    throw unauthorized('Invalid override token');
  }

  return decoded;
}

export function ensureOverride(req: Request): void {
  if (req.user && MANAGER_ROLES.includes(req.user.role)) {
    return;
  }

  const header = req.headers['x-override-token'];
  const token = Array.isArray(header) ? header[0] : header;

  if (!token) {
    throw forbidden('Manager approval is required for this action', 'MANAGER_OVERRIDE_REQUIRED');
  }

  try {
    const decoded = verifyOverrideToken(token);
    req.override = { userId: decoded.sub, email: decoded.email, role: decoded.role };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw forbidden('Override token is invalid or expired', 'INVALID_OVERRIDE_TOKEN');
  }
}

export function requireOverride(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ message: unauthorized().message });
    return;
  }

  try {
    ensureOverride(req);
    next();
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.status).json({ message: error.message, code: error.code });
      return;
    }

    res.status(403).json({ message: forbidden('Manager approval is required for this action').message });
  }
}
