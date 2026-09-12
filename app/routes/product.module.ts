import { Router } from 'express';
import { asyncHandler } from '../common/asyncHandler';
import { authGuard, MANAGER_ROLES, requireRoles } from '../common/guards/auth.guard';
import { validateBody, validateParams, validateQuery } from '../common/validate.middleware';
import { createProductSchema, listProductsSchema, updateProductSchema, adjustStockSchema } from '../../zod/product.schema';
import { idParamSchema } from '../../zod/shared';
import {
  handleAdjustStock,
  handleArchiveProduct,
  handleCreateProduct,
  handleGetProduct,
  handleGetStockMovements,
  handleListProducts,
  handleUpdateProduct,
} from '../controllers/product.controller';

export const productRouter: Router = Router();

productRouter.use(authGuard);

productRouter.get('/', validateQuery(listProductsSchema), asyncHandler(handleListProducts));
productRouter.get(
  '/:id/movements',
  validateParams(idParamSchema),
  asyncHandler(handleGetStockMovements),
);
productRouter.get('/:id', validateParams(idParamSchema), asyncHandler(handleGetProduct));

const managerOnly = requireRoles(...MANAGER_ROLES);

productRouter.post('/', managerOnly, validateBody(createProductSchema), asyncHandler(handleCreateProduct));
productRouter.put(
  '/:id',
  managerOnly,
  validateParams(idParamSchema),
  validateBody(updateProductSchema),
  asyncHandler(handleUpdateProduct),
);
productRouter.post(
  '/:id/adjust-stock',
  managerOnly,
  validateParams(idParamSchema),
  validateBody(adjustStockSchema),
  asyncHandler(handleAdjustStock),
);
productRouter.delete('/:id', managerOnly, validateParams(idParamSchema), asyncHandler(handleArchiveProduct));
