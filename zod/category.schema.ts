import { z } from 'zod';
import { paginationSchema } from './shared';

export const createCategorySchema = z.object({
  name: z.string().min(1).max(120),
});

export const updateCategorySchema = createCategorySchema.partial();

export const listCategoriesSchema = paginationSchema;

export type CreateCategoryDto = z.infer<typeof createCategorySchema>;
export type UpdateCategoryDto = z.infer<typeof updateCategorySchema>;
