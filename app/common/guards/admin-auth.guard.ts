import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

type JwtPayload = {
  sub: string;
  email: string;
  role: 'admin';
  tokenType: string;
};

export function adminAuthGuard(req: Request, res: Response, next: NextFunction): void {
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

  const token = parts[1];
  const secret = process.env.JWT_SECRET ?? 'fallback-secret';

  try {
    const decoded = jwt.verify(token, secret) as JwtPayload;

    if (decoded.tokenType !== 'access') {
      res.status(401).json({ message: 'Invalid token type' });
      return;
    }

    req.admin = {
      id: decoded.sub,
      email: decoded.email,
      role: decoded.role,
    };

    next();
  } catch (error) {
    const message = error instanceof Error && error.name === 'TokenExpiredError'
      ? 'Token has expired'
      : 'Invalid token';
    res.status(401).json({ message });
  }
}
