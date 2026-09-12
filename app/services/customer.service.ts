import { Prisma } from '@prisma/client';
import { getPrismaClient } from '../../config/prisma.client';
import { conflict, notFound, unprocessable } from '../common/errors';
import type { CreateCustomerDto, UpdateCustomerDto } from '../../zod/customer.schema';
import { paginationSkip, type Pagination } from '../../zod/shared';

function buildListWhere(q?: string): Prisma.CustomerWhereInput {
  if (!q) {
    return {};
  }

  return {
    OR: [
      { name: { contains: q, mode: 'insensitive' } },
      { phone: { contains: q } },
      { email: { contains: q, mode: 'insensitive' } },
    ],
  };
}

export async function listCustomers(dto: Pagination & { q?: string }) {
  const { skip, take } = paginationSkip(dto);
  const prisma = getPrismaClient();
  const where = buildListWhere(dto.q);

  const [data, total] = await prisma.$transaction([
    prisma.customer.findMany({ where, orderBy: { name: 'asc' }, skip, take }),
    prisma.customer.count({ where }),
  ]);

  return { data, total, page: dto.page, pageSize: dto.pageSize };
}

export async function getCustomer(customerId: string) {
  const customer = await getPrismaClient().customer.findUnique({
    where: { id: customerId },
    include: { orders: { orderBy: { createdAt: 'desc' }, take: 10 } },
  });

  if (!customer) {
    throw notFound('Customer not found');
  }

  return customer;
}

export async function createCustomer(dto: CreateCustomerDto) {
  const prisma = getPrismaClient();

  if (dto.phone) {
    const existing = await prisma.customer.findUnique({ where: { phone: dto.phone } });
    if (existing) {
      throw conflict(`Customer with phone ${dto.phone} already exists`, 'DUPLICATE_PHONE');
    }
  }

  return prisma.customer.create({
    data: {
      name: dto.name,
      phone: dto.phone ?? null,
      email: dto.email ?? null,
    },
  });
}

export async function updateCustomer(customerId: string, dto: UpdateCustomerDto) {
  const prisma = getPrismaClient();
  const existing = await prisma.customer.findUnique({ where: { id: customerId } });

  if (!existing) {
    throw notFound('Customer not found');
  }

  if (dto.phone && dto.phone !== existing.phone) {
    const duplicate = await prisma.customer.findUnique({ where: { phone: dto.phone } });
    if (duplicate && duplicate.id !== customerId) {
      throw conflict(`Customer with phone ${dto.phone} already exists`, 'DUPLICATE_PHONE');
    }
  }

  return prisma.customer.update({
    where: { id: customerId },
    data: { name: dto.name, phone: dto.phone, email: dto.email },
  });
}

export async function deleteCustomer(customerId: string) {
  const prisma = getPrismaClient();
  const existing = await prisma.customer.findUnique({ where: { id: customerId } });

  if (!existing) {
    throw notFound('Customer not found');
  }

  await prisma.customer.delete({ where: { id: customerId } });
  return { id: customerId, deleted: true };
}

export async function adjustLoyaltyPoints(customerId: string, delta: number) {
  if (delta === 0) {
    throw unprocessable('Loyalty delta must be non-zero', 'INVALID_LOYALTY_DELTA');
  }

  const prisma = getPrismaClient();
  const existing = await prisma.customer.findUnique({ where: { id: customerId } });

  if (!existing) {
    throw notFound('Customer not found');
  }

  const newPoints = existing.loyaltyPoints + delta;
  if (newPoints < 0) {
    throw unprocessable('Loyalty points cannot go negative', 'INVALID_LOYALTY_DELTA');
  }

  return prisma.customer.update({
    where: { id: customerId },
    data: { loyaltyPoints: newPoints },
  });
}
