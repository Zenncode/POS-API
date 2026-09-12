import { Request, Response } from 'express';
import { idParamSchema } from '../../zod/shared';
import {
  createUserSchema,
  resetPasswordSchema,
  setPinSchema,
  updateUserSchema,
} from '../../zod/user.schema';
import type { ListUsersDto } from '../../zod/user.schema';
import {
  createUser,
  listUsers,
  resetUserPassword,
  setUserPin,
  updateUser,
} from '../services/user.service';
import { unauthorized } from '../common/errors';

function requireActor(req: Request): string {
  if (!req.user) {
    throw unauthorized();
  }

  return req.user.id;
}

export async function handleListUsers(req: Request, res: Response): Promise<void> {
  // Already validated + coerced by validateQuery(listUsersSchema) — see product.controller.
  const dto = req.query as unknown as ListUsersDto;
  res.status(200).json(await listUsers(dto));
}

export async function handleCreateUser(req: Request, res: Response): Promise<void> {
  const dto = createUserSchema.parse(req.body);
  res.status(201).json(await createUser(dto));
}

export async function handleUpdateUser(req: Request, res: Response): Promise<void> {
  const actorId = requireActor(req);
  const { id } = idParamSchema.parse(req.params);
  const dto = updateUserSchema.parse(req.body);
  res.status(200).json(await updateUser(id, dto, actorId));
}

export async function handleResetUserPassword(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  const dto = resetPasswordSchema.parse(req.body);
  res.status(200).json(await resetUserPassword(id, dto.password));
}

export async function handleSetUserPin(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  const dto = setPinSchema.parse(req.body);
  res.status(200).json(await setUserPin(id, dto.pin));
}
