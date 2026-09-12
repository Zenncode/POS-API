import { Request, Response, NextFunction } from 'express';

export function httpLogger(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  const requestId = req.id ?? 'unknown';

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const log = {
      requestId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      ip: req.ip,
      userAgent: req.get('user-agent')?.slice(0, 120),
    };

    if (res.statusCode >= 500) {
      console.error('[HTTP]', log);
    } else if (res.statusCode >= 400) {
      console.warn('[HTTP]', log);
    } else {
      console.log('[HTTP]', log);
    }
  });

  next();
}