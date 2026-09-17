import bcrypt from 'bcryptjs';
import { Prisma, UserRole } from '@prisma/client';
import { getPrismaClient } from '../../config/prisma.client';
import { getEnv } from '../../config/env';
import { conflict, forbidden, notFound, unprocessable } from '../common/errors';
import { paginationSkip } from '../../zod/shared';
import type { CreateUserDto, ListUsersDto, UpdateUserDto } from '../../zod/user.schema';

export type SafeUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type ManagerOverrideUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
};

const safeSelect: Prisma.UserSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
};

function getSaltRounds(): number {
  return getEnv().BCRYPT_SALT_ROUNDS;
}

export async function listUsers(
  dto: ListUsersDto,
): Promise<{ items: SafeUser[]; page: number; pageSize: number; total: number }> {
  const prisma = getPrismaClient();

  const where: Prisma.UserWhereInput = {
    ...(dto.q
      ? {
          OR: [
            { email: { contains: dto.q, mode: 'insensitive' } },
            { name: { contains: dto.q, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(dto.role ? { role: dto.role } : {}),
    ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
  };

  const { skip, take } = paginationSkip(dto);

  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: safeSelect,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.user.count({ where }),
  ]);

  return { items, page: dto.page, pageSize: dto.pageSize, total };
}

export async function createUser(dto: CreateUserDto): Promise<SafeUser> {
  const prisma = getPrismaClient();
  const email = dto.email.toLowerCase().trim();

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw conflict('A user with this email already exists', 'DUPLICATE_EMAIL');
  }

  const passwordHash = await bcrypt.hash(dto.password, getSaltRounds());

  return prisma.user.create({
    data: { email, passwordHash, name: dto.name, role: dto.role },
    select: safeSelect,
  });
}

export async function updateUser(id: string, dto: UpdateUserDto, actorId: string): Promise<SafeUser> {
  const prisma = getPrismaClient();

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) {
    throw notFound('User not found');
  }

  const demotingSelf =
    id === actorId && ((dto.role !== undefined && dto.role !== 'ADMIN') || dto.isActive === false);

  if (demotingSelf) {
    throw forbidden('You cannot deactivate or demote your own account', 'SELF_MODIFICATION_FORBIDDEN');
  }

  const losingAdmin =
    target.role === UserRole.ADMIN &&
    ((dto.role !== undefined && dto.role !== 'ADMIN') || dto.isActive === false);

  if (losingAdmin) {
    const otherActiveAdmins = await prisma.user.count({
      where: { role: UserRole.ADMIN, isActive: true, id: { not: id } },
    });

    if (otherActiveAdmins === 0) {
      throw conflict('Cannot remove the last active admin', 'LAST_ADMIN');
    }
  }

  return prisma.user.update({
    where: { id },
    data: {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.role !== undefined ? { role: dto.role } : {}),
      ...(dto.isActive !== undefined
        ? { isActive: dto.isActive, refreshTokenHash: dto.isActive ? undefined : null }
        : {}),
    },
    select: safeSelect,
  });
}

export async function resetUserPassword(id: string, password: string): Promise<SafeUser> {
  const prisma = getPrismaClient();

  const target = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!target) {
    throw notFound('User not found');
  }

  const passwordHash = await bcrypt.hash(password, getSaltRounds());

  return prisma.user.update({
    where: { id },
    data: { passwordHash, refreshTokenHash: null },
    select: safeSelect,
  });
}

export async function setUserPin(id: string, pin: string): Promise<SafeUser> {
  const prisma = getPrismaClient();

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) {
    throw notFound('User not found');
  }

  if (target.role === UserRole.CASHIER) {
    throw unprocessable('PIN overrides are only available to managers and admins', 'PIN_NOT_ALLOWED');
  }

  const pinHash = await bcrypt.hash(pin, getSaltRounds());

  return prisma.user.update({ where: { id }, data: { pinHash }, select: safeSelect });
}

export async function verifyOverridePin(pin: string): Promise<ManagerOverrideUser | null> {
  const prisma = getPrismaClient();

  const managers = await prisma.user.findMany({
    where: {
      role: { in: [UserRole.ADMIN, UserRole.MANAGER] },
      isActive: true,
      pinHash: { not: null },
    },
    select: { id: true, email: true, name: true, role: true, pinHash: true },
    take: 100,
    orderBy: { createdAt: 'asc' },
  });

  for (const manager of managers) {
    if (manager.pinHash && (await bcrypt.compare(pin, manager.pinHash))) {
      return { id: manager.id, email: manager.email, name: manager.name, role: manager.role };
    }
  }

  return null;
}
