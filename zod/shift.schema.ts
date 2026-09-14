import { z } from 'zod';
import { paginationSchema } from './shared';

export const cashCountInputSchema = z.object({
  denomination: z.number().int().positive('Denomination must be a positive integer (in cents)'),
  count: z.number().int().min(0, 'Count cannot be negative'),
});

export const openShiftSchema = z.object({
  openingFloat: z.array(cashCountInputSchema).min(1, 'At least one cash count is required'),
  note: z.string().max(500).optional(),
});

export const closeShiftSchema = z.object({
  closingFloat: z.array(cashCountInputSchema).min(1, 'At least one cash count is required'),
  note: z.string().max(500).optional(),
});

export const listShiftsSchema = paginationSchema.extend({
  userId: z.string().uuid().optional(),
  status: z.enum(['OPEN', 'CLOSED']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export const getZReportsSchema = paginationSchema.extend({
  storeId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export type CashCountInput = z.infer<typeof cashCountInputSchema>;
export type OpenShiftDto = z.infer<typeof openShiftSchema>;
export type CloseShiftDto = z.infer<typeof closeShiftSchema>;
export type ListShiftsDto = z.infer<typeof listShiftsSchema>;
export type GetZReportsDto = z.infer<typeof getZReportsSchema>;