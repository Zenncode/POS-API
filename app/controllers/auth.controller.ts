import { Request, Response } from 'express';
import { loginSchema, overrideSchema } from '../../zod/auth.schema';
import { createOverrideToken, getStaffProfile, loginStaff, logoutStaff, refreshStaffSession } from '../services/auth.service';
import { verifyOverridePin } from '../services/user.service';
import { forbidden, unauthorized } from '../common/errors';
import type { UserRole } from '../common/guards/auth.guard';

function parseBody<T>(schema: { parse: (value: unknown) => T }, body: unknown): T {
  return schema.parse(body);
}

export async function handleLogin(req: Request, res: Response): Promise<void> {
  const dto = parseBody(loginSchema, req.body);
  const ip = req.ip;
  const accessToken = await loginStaff(dto, res, { ip });
  res.status(200).json({ accessToken });
}

export async function handleLegacyAdminLogin(req: Request, res: Response): Promise<void> {
  const dto = parseBody(loginSchema, req.body);
  const ip = req.ip;
  const accessToken = await loginStaff(dto, res, { requireRole: 'ADMIN' as UserRole, ip });
  res.status(200).json({ accessToken });
}

export async function handleRefresh(req: Request, res: Response): Promise<void> {
  const accessToken = await refreshStaffSession(req, res);
  res.status(200).json({ accessToken });
}

export async function handleLogout(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw unauthorized();
  }

  await logoutStaff(req.user.id, res, req.ip);
  res.status(200).json({ message: 'Logged out' });
}

export async function handleMe(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw unauthorized();
  }

  const profile = await getStaffProfile(req.user.id);
  if (!profile) {
    throw unauthorized('User not found');
  }

  res.status(200).json(profile);
}

export async function handleOverride(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw unauthorized();
  }

  const dto = parseBody(overrideSchema, req.body);
  const manager = await verifyOverridePin(dto.pin);

  if (!manager) {
    throw forbidden('Invalid manager PIN', 'INVALID_OVERRIDE_PIN');
  }

  res.status(200).json({
    overrideToken: createOverrideToken(manager),
    manager: { id: manager.id, name: manager.name, role: manager.role },
  });
}