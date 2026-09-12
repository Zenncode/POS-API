import { Router } from 'express';
import { asyncHandler } from '../common/asyncHandler';
import { authGuard, MANAGER_ROLES, requireRoles } from '../common/guards/auth.guard';
import { validateBody, validateParams } from '../common/validate.middleware';
import { createCustomerSchema, updateCustomerSchema } from '../../zod/customer.schema';
import { idParamSchema } from '../../zod/shared';
import {
  handleAdjustLoyalty,
  handleCreateCustomer,
  handleDeleteCustomer,
  handleGetCustomer,
  handleListCustomers,
  handleUpdateCustomer,
} from '../controllers/customer.controller';

export const customerRouter: Router = Router();

customerRouter.use(authGuard);

customerRouter.get('/', asyncHandler(handleListCustomers));
customerRouter.get('/:id', validateParams(idParamSchema), asyncHandler(handleGetCustomer));

const managerOnly = requireRoles(...MANAGER_ROLES);

customerRouter.post('/', managerOnly, validateBody(createCustomerSchema), asyncHandler(handleCreateCustomer));
customerRouter.put(
  '/:id',
  managerOnly,
  validateParams(idParamSchema),
  validateBody(updateCustomerSchema),
  asyncHandler(handleUpdateCustomer),
);
customerRouter.delete('/:id', managerOnly, validateParams(idParamSchema), asyncHandler(handleDeleteCustomer));
customerRouter.post(
  '/:id/loyalty',
  managerOnly,
  validateParams(idParamSchema),
  asyncHandler(handleAdjustLoyalty),
);
