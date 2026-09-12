import { z } from 'zod';
import { paginationSchema } from './shared';

export const createCustomerSchema = z.object({
  name: z.string().min(1).max(255),
  phone: z.string().min(3).max(32).optional(),
  email: z.string().email().max(255).optional(),
});

export const updateCustomerSchema = createCustomerSchema.partial();

export const listCustomersSchema = paginationSchema.extend({
  q: z.string().max(255).optional(),
});

export type CreateCustomerDto = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerDto = z.infer<typeof updateCustomerSchema>;
