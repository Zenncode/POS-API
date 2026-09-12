import { z } from 'zod';
import { paginationSchema } from './shared';

const userRoles = z.enum(['ADMIN', 'MANAGER', 'CASHIER']);

export const createUserSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  name: z.string().min(1).max(255),
  role: userRoles.default('CASHIER'),
});

export const updateUserSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    role: userRoles.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const resetPasswordSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

export const setPinSchema = z.object({
  pin: z.string().regex(/^\d{4,8}$/, 'PIN must be 4 to 8 digits'),
});

export const listUsersSchema = paginationSchema.extend({
  q: z.string().max(255).optional(),
  role: userRoles.optional(),
  isActive: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
});

export type UserRoleDto = z.infer<typeof userRoles>;
export type CreateUserDto = z.infer<typeof createUserSchema>;
export type UpdateUserDto = z.infer<typeof updateUserSchema>;
export type ListUsersDto = z.infer<typeof listUsersSchema>;
