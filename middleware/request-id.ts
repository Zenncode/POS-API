import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

export function requestIdMiddleware(req: Request, _res: Response, next: NextFunction): void {
  req.id = req.headers['x-request-id'] as string || randomUUID();
  next();
}

declare global {
  namespace Express {
    interface Request {
      id: string;
    }
  }
}

export {};