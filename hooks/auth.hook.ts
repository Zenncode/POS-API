/**
 * SAMPLE ONLY
 * This hooks file is intentionally comment-only.
 * Uncomment and adapt if you want reusable auth-related hooks/middleware.
 *
 * Example connection flow:
 * route -> guard -> hook -> controller -> service -> db/cache/socket
 *
 * --------------------------------------------------------------------
 * 1) Request metadata hook (runs before controllers)
 * --------------------------------------------------------------------
 *
 * import { NextFunction, Request, Response } from 'express';
 *
 * export function attachRequestMetaHook(req: Request, _res: Response, next: NextFunction): void {
 *   // Assign request ID and start time for tracing.
 *   // req.requestId = crypto.randomUUID();
 *   // req.requestStartedAt = Date.now();
 *   next();
 * }
 *
 * --------------------------------------------------------------------
 * 2) Session validation hook (optional cache-first check)
 * --------------------------------------------------------------------
 *
 * import { getCache, setCache } from '../services/cache.service';
 *
 * export async function validateAdminSessionHook(
 *   req: Request,
 *   res: Response,
 *   next: NextFunction,
 * ): Promise<void> {
 *   // Example: require req.admin from adminAuthGuard first.
 *   // if (!req.admin?.id) {
 *   //   res.status(401).json({ message: 'Unauthorized' });
 *   //   return;
 *   // }
 *
 *   // Example cache key:
 *   // const key = `admin:session:${req.admin.id}`;
 *   // const cached = await getCache<{ revoked: boolean }>(key);
 *   // if (cached?.revoked) {
 *   //   res.status(401).json({ message: 'Session revoked' });
 *   //   return;
 *   // }
 *
 *   // Optional warm cache:
 *   // await setCache(key, { revoked: false }, 60);
 *   next();
 * }
 *
 * --------------------------------------------------------------------
 * 3) Audit hook (optional socket broadcast)
 * --------------------------------------------------------------------
 *
 * import { getSocketServer } from '../socket/socket.server';
 *
 * export function emitAdminAuditHook(req: Request, _res: Response, next: NextFunction): void {
 *   // Example: broadcast admin activity for dashboards.
 *   // const io = getSocketServer();
 *   // io?.emit('admin:audit', {
 *   //   adminId: req.admin?.id ?? null,
 *   //   method: req.method,
 *   //   path: req.originalUrl,
 *   //   timestamp: new Date().toISOString(),
 *   // });
 *   next();
 * }
 *
 * --------------------------------------------------------------------
 * 4) Wiring examples
 * --------------------------------------------------------------------
 *
 * // app.module.ts
 * // app.use('/api', attachRequestMetaHook);
 *
 * // routes/auth.module.ts
 * // authRouter.post('/logout', adminAuthGuard, validateAdminSessionHook, logoutAdminController);
 */

