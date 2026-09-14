import { z } from 'zod';

export const helloQuerySchema = z.object({
  name: z.string().min(1).max(50).optional(),
});

export type HelloQueryDto = z.infer<typeof helloQuerySchema>;