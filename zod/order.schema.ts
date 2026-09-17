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

export const refundLineSchema = z.object({
  orderItemId: z.string().uuid(),
  quantity: z.number().int().min(1),
});

export const refundOrderSchema = z
  .object({
    lines: z.array(refundLineSchema).min(1, 'Refund needs at least one line').max(200),
    paymentMethod: z.enum(['CASH', 'CARD', 'QR']),
    reference: z.string().max(255).optional(),
    note: z.string().max(500).optional(),
  })
  .refine(
    (value) => new Set(value.lines.map((line) => line.orderItemId)).size === value.lines.length,
    'Duplicate order item lines are not allowed in a single refund',
  );

export const listOrdersSchema = paginationSchema.extend({
  status: z.enum(['PENDING', 'PAID', 'VOID', 'REFUNDED']).optional(),
  cashierId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export const receiptQuerySchema = z.object({
  format: z.enum(['pdf', 'escpos']).default('pdf'),
});

export const receiptDeliverySchema = z.object({
  channels: z.array(z.enum(['EMAIL', 'SMS', 'PRINT'])).min(1, 'At least one delivery channel required').max(3),
  target: z.string().min(1, 'Target (email or phone) is required'),
  consent: z.boolean().refine((v) => v === true, 'Consent is required for receipt delivery'),
  format: z.enum(['pdf', 'escpos']).default('pdf'),
});

export type OrderPaymentInput = z.infer<typeof paymentInputSchema>;
export type OrderItemInput = z.infer<typeof orderItemInputSchema>;
export type CreateOrderDto = z.infer<typeof createOrderSchema>;
export type RefundLineInput = z.infer<typeof refundLineSchema>;
export type RefundOrderDto = z.infer<typeof refundOrderSchema>;
export type ListOrdersDto = z.infer<typeof listOrdersSchema>;
export type ReceiptQueryDto = z.infer<typeof receiptQuerySchema>;
export type ReceiptDeliveryDto = z.infer<typeof receiptDeliverySchema>;
