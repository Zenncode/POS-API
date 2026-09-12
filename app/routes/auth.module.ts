import { Router } from 'express';
import { validateBody } from '../common/validate.middleware';
import { asyncHandler } from '../common/asyncHandler';
import { authGuard } from '../common/guards/auth.guard';
import { loginSchema, overrideSchema, refreshSchema } from '../../zod/auth.schema';
import {
  handleLegacyAdminLogin,
  handleLogin,
  handleLogout,
  handleMe,
  handleOverride,
  handleRefresh,
} from '../controllers/auth.controller';

export const authRouter: Router = Router();

authRouter.post('/login', validateBody(loginSchema), asyncHandler(handleLogin));
authRouter.post('/refresh', validateBody(refreshSchema), asyncHandler(handleRefresh));

authRouter.use(authGuard);
authRouter.post('/logout', asyncHandler(handleLogout));
authRouter.get('/me', asyncHandler(handleMe));
authRouter.post('/override', validateBody(overrideSchema), asyncHandler(handleOverride));

authRouter.post('/admin/login', validateBody(loginSchema), asyncHandler(handleLegacyAdminLogin));
authRouter.post('/admin/refresh', validateBody(refreshSchema), asyncHandler(handleRefresh));
authRouter.post('/admin/logout', asyncHandler(handleLogout));
authRouter.get('/admin/me', asyncHandler(handleMe));
