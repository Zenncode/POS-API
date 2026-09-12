import { Router } from 'express';
import { asyncHandler } from '../common/asyncHandler';
import { authGuard, MANAGER_ROLES, requireRoles } from '../common/guards/auth.guard';
import {
  handleDailySales,
  handleSalesSummary,
} from '../controllers/report.controller';

export const reportRouter: Router = Router();

reportRouter.use(authGuard, requireRoles(...MANAGER_ROLES));

reportRouter.get('/sales/daily', asyncHandler(handleDailySales));
reportRouter.get('/sales/summary', asyncHandler(handleSalesSummary));
