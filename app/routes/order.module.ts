import { Router } from 'express';
import { asyncHandler } from '../common/asyncHandler';
import { authGuard, requireOverride } from '../common/guards/auth.guard';
import { validateBody, validateParams, validateQuery } from '../common/validate.middleware';
import { createOrderSchema, listOrdersSchema, refundOrderSchema } from '../../zod/order.schema';
import { idParamSchema } from '../../zod/shared';
import {
  handleCreateOrder,
  handleGetOrder,
  handleListOrders,
  handleRefundOrder,
  handleVoidOrder,
} from '../controllers/order.controller';

export const orderRouter: Router = Router();

orderRouter.use(authGuard);

orderRouter.post('/', validateBody(createOrderSchema), asyncHandler(handleCreateOrder));
orderRouter.get('/', validateQuery(listOrdersSchema), asyncHandler(handleListOrders));
orderRouter.get('/:id', validateParams(idParamSchema), asyncHandler(handleGetOrder));
orderRouter.post(
  '/:id/void',
  requireOverride,
  validateParams(idParamSchema),
  asyncHandler(handleVoidOrder),
);
orderRouter.post(
  '/:id/refund',
  requireOverride,
  validateParams(idParamSchema),
  validateBody(refundOrderSchema),
  asyncHandler(handleRefundOrder),
);
