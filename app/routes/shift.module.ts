import { Router } from 'express';
import { asyncHandler } from '../common/asyncHandler';
import { authGuard, requireRoles, MANAGER_ROLES } from '../common/guards/auth.guard';
import { validateBody, validateParams, validateQuery } from '../common/validate.middleware';
import { openShiftSchema, closeShiftSchema, listShiftsSchema, getZReportsSchema } from '../../zod/shift.schema';
import { idParamSchema } from '../../zod/shared';
import {
  handleOpenShift,
  handleCloseShift,
  handleGetCurrentShift,
  handleListShifts,
  handleGetShift,
  handleGetZReports,
  handleGetZReport,
} from '../controllers/shift.controller';

export const shiftRouter: Router = Router();

shiftRouter.use(authGuard);

shiftRouter.post('/open', validateBody(openShiftSchema), asyncHandler(handleOpenShift));
shiftRouter.post('/close', validateBody(closeShiftSchema), asyncHandler(handleCloseShift));
shiftRouter.get('/current', asyncHandler(handleGetCurrentShift));
shiftRouter.get('/', validateQuery(listShiftsSchema), asyncHandler(handleListShifts));
shiftRouter.get('/:id', validateParams(idParamSchema), asyncHandler(handleGetShift));

shiftRouter.get('/reports/z', validateQuery(getZReportsSchema), asyncHandler(handleGetZReports));
shiftRouter.get('/reports/z/:id', validateParams(idParamSchema), asyncHandler(handleGetZReport));

shiftRouter.get('/reports/z', requireRoles(...MANAGER_ROLES), validateQuery(getZReportsSchema), asyncHandler(handleGetZReports));
shiftRouter.get('/reports/z/:id', requireRoles(...MANAGER_ROLES), validateParams(idParamSchema), asyncHandler(handleGetZReport));