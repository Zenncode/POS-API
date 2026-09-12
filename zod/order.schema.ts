import { z } from 'zod';
import { paginationSchema } from './shared';

export const paymentInputSchema = z.object({
  method: z.enum(['CASH', 'CARD', 'QR']),
  amountCents: z.number().int().min(1),
  reference: z.string().max(255).optional(),
});

export const orderItemInputSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1).max(1000),
});

export const createOrderSchema = z
  .object({
    items: z.array(orderItemInputSchema).min(1, 'Order needs at least one item').max(200),
    payments: z.array(paymentInputSchema).min(1, 'Order needs at least one payment').max(10),
    customerId: z.string().uuid().optional(),
    discountCents: z.number().int().min(0).default(0),
    note: z.string().max(500).optional(),
  })
  .refine(
    (value) => new Set(value.items.map((item) => item.productId)).size === value.items.length,
    'Duplicate product lines are not allowed — merge quantities instead',
  );

export const listOrdersSchema = paginationSchema.extend({
  status: z.enum(['PENDING', 'PAID', 'VOID', 'REFUNDED']).optional(),
  cashierId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export type OrderPaymentInput = z.infer<typeof paymentInputSchema>;
export type OrderItemInput = z.infer<typeof orderItemInputSchema>;
export type CreateOrderDto = z.infer<typeof createOrderSchema>;
export type ListOrdersDto = z.infer<typeof listOrdersSchema>;
