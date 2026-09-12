import { Router } from 'express';
import { asyncHandler } from '../common/asyncHandler';
import { authGuard, requireRoles } from '../common/guards/auth.guard';
import { validateBody, validateParams, validateQuery } from '../common/validate.middleware';
import { idParamSchema } from '../../zod/shared';
import {
  createUserSchema,
  listUsersSchema,
  resetPasswordSchema,
  setPinSchema,
  updateUserSchema,
} from '../../zod/user.schema';
import {
  handleCreateUser,
  handleListUsers,
  handleResetUserPassword,
  handleSetUserPin,
  handleUpdateUser,
} from '../controllers/user.controller';

export const userRouter: Router = Router();

userRouter.use(authGuard, requireRoles('ADMIN'));

userRouter.get('/', validateQuery(listUsersSchema), asyncHandler(handleListUsers));
userRouter.post('/', validateBody(createUserSchema), asyncHandler(handleCreateUser));
userRouter.patch(
  '/:id',
  validateParams(idParamSchema),
  validateBody(updateUserSchema),
  asyncHandler(handleUpdateUser),
);
userRouter.post(
  '/:id/reset-password',
  validateParams(idParamSchema),
  validateBody(resetPasswordSchema),
  asyncHandler(handleResetUserPassword),
);
userRouter.post(
  '/:id/pin',
  validateParams(idParamSchema),
  validateBody(setPinSchema),
  asyncHandler(handleSetUserPin),
);
