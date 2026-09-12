import { Request, Response } from 'express';
import { createCustomerSchema, updateCustomerSchema } from '../../zod/customer.schema';
import { idParamSchema, paginationSchema } from '../../zod/shared';
import { z } from 'zod';
import {
  adjustLoyaltyPoints,
  createCustomer,
  deleteCustomer,
  getCustomer,
  listCustomers,
  updateCustomer,
} from '../services/customer.service';

export async function handleListCustomers(req: Request, res: Response): Promise<void> {
  const dto = paginationSchema.extend({ q: z.string().max(255).optional() }).parse(req.query);
  res.status(200).json(await listCustomers(dto));
}

export async function handleGetCustomer(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  res.status(200).json(await getCustomer(id));
}

export async function handleCreateCustomer(req: Request, res: Response): Promise<void> {
  const dto = createCustomerSchema.parse(req.body);
  res.status(201).json(await createCustomer(dto));
}

export async function handleUpdateCustomer(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  const dto = updateCustomerSchema.parse(req.body);
  res.status(200).json(await updateCustomer(id, dto));
}

export async function handleDeleteCustomer(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  res.status(200).json(await deleteCustomer(id));
}

export async function handleAdjustLoyalty(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  const { delta } = z.object({ delta: z.number().int() }).parse(req.body);
  res.status(200).json(await adjustLoyaltyPoints(id, delta));
}
