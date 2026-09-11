import { Router, Request, Response } from 'express';
import {
  loginAdminController,
  refreshAdminController,
  logoutAdminController,
} from '../controllers/auth.controller';
import { adminAuthGuard } from '../common/guards/admin-auth.guard';

const authRouter = Router();

authRouter.post('/admin/login', loginAdminController);
authRouter.post('/admin/refresh', refreshAdminController);
authRouter.post('/admin/logout', adminAuthGuard, logoutAdminController);

authRouter.get('/admin/me', adminAuthGuard, (req: Request, res: Response) => {
  res.status(200).json({ admin: req.admin });
});

export { authRouter };
