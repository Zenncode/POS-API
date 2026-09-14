import { z } from 'zod';

export const idParamSchema = z.object({
  id: z.string().uuid('Must be a valid UUID'),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(250).default(20),
});

export type Pagination = z.infer<typeof paginationSchema>;

export function paginationSkip(pagination: Pagination): { skip: number; take: number } {
  return {
    skip: (pagination.page - 1) * pagination.pageSize,
    take: pagination.pageSize,
  };
}
