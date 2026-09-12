import { Router } from 'express';
import { asyncHandler } from '../common/asyncHandler';
import { authGuard, MANAGER_ROLES, requireRoles } from '../common/guards/auth.guard';
import { validateBody, validateParams, validateQuery } from '../common/validate.middleware';
import { createCategorySchema, updateCategorySchema } from '../../zod/category.schema';
import { idParamSchema, paginationSchema } from '../../zod/shared';
import {
  handleCreateCategory,
  handleDeleteCategory,
  handleGetCategory,
  handleListCategories,
  handleUpdateCategory,
} from '../controllers/category.controller';

export const categoryRouter: Router = Router();

categoryRouter.use(authGuard);

categoryRouter.get('/', validateQuery(paginationSchema), asyncHandler(handleListCategories));
categoryRouter.get('/:id', validateParams(idParamSchema), asyncHandler(handleGetCategory));

const managerOnly = requireRoles(...MANAGER_ROLES);

categoryRouter.post('/', managerOnly, validateBody(createCategorySchema), asyncHandler(handleCreateCategory));
categoryRouter.put(
  '/:id',
  managerOnly,
  validateParams(idParamSchema),
  validateBody(updateCategorySchema),
  asyncHandler(handleUpdateCategory),
);
categoryRouter.delete('/:id', managerOnly, validateParams(idParamSchema), asyncHandler(handleDeleteCategory));
