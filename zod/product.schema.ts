import { z } from 'zod';
import { paginationSchema } from './shared';

export const createProductSchema = z.object({
  sku: z.string().min(1).max(64),
  barcode: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(255),
  categoryId: z.string().uuid().optional(),
  priceCents: z.number().int().min(0),
  costCents: z.number().int().min(0).optional(),
  taxRateBps: z.number().int().min(0).max(10000).default(0),
  stock: z.number().int().min(0).default(0),
  lowStockThreshold: z.number().int().min(0).max(100000).default(5),
});

export const updateProductSchema = createProductSchema.partial().omit({ stock: true });

export const listProductsSchema = paginationSchema.extend({
  q: z.string().max(255).optional(),
  categoryId: z.string().uuid().optional(),
  activeOnly: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  sort: z.enum(['name', 'price', 'stock', 'newest']).default('name'),
});

export const adjustStockSchema = z.object({
  delta: z.number().int().refine((value) => value !== 0, 'Delta must be non-zero'),
  reason: z.enum(['PURCHASE', 'ADJUST', 'REFUND']),
  note: z.string().max(500).optional(),
});

export type CreateProductDto = z.infer<typeof createProductSchema>;
export type UpdateProductDto = z.infer<typeof updateProductSchema>;
export type ListProductsDto = z.infer<typeof listProductsSchema>;
export type AdjustStockDto = z.infer<typeof adjustStockSchema>;
