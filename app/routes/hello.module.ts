import { Router } from 'express';
import { asyncHandler } from '../common/asyncHandler';
import { validateQuery } from '../common/validate.middleware';
import { helloQuerySchema } from '../../zod/hello.schema';
import { handleHello } from '../controllers/hello.controller';

export const helloRouter: Router = Router();

helloRouter.get('/', validateQuery(helloQuerySchema), asyncHandler(handleHello));