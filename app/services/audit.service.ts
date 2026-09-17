import { Prisma } from '@prisma/client';
import { getPrismaClient } from '../../config/prisma.client';

export type AuditAction =
  | 'LOGIN'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'PASSWORD_CHANGE'
  | 'PASSWORD_RESET'
  | 'USER_CREATE'
  | 'USER_UPDATE'
  | 'USER_DEACTIVATE'
  | 'USER_PIN_SET'
  | 'OVERRIDE_REQUEST'
  | 'ORDER_VOID'
  | 'ORDER_REFUND'
  | 'DISCOUNT_OVERRIDE'
  | 'STOCK_ADJUST'
  | 'REFRESH_TOKEN_REUSE'
  | 'RECEIPT_DELIVERY'
  | 'RECEIPT_STORED_LOCALLY';

export type AuditResult = 'SUCCESS' | 'FAILURE';

export interface AuditLogInput {
  userId?: string;
  action: AuditAction;
  entity?: string;
  entityId?: string;
  metadata?: Prisma.JsonObject;
  ip?: string;
  userAgent?: string;
  result: AuditResult;
}

export async function writeAuditLog(input: AuditLogInput): Promise<void> {
  try {
    await getPrismaClient().auditLog.create({ data: input });
  } catch (error) {
    console.error('[Audit log failed]', error);
  }
}

export async function getAuditLogs(filters: {
  userId?: string;
  action?: AuditAction;
  entity?: string;
  entityId?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}): Promise<{ items: any[]; total: number }> {
  const prisma = getPrismaClient();
  const { page = 1, pageSize = 20, ...where } = filters;

  const whereClause: Prisma.AuditLogWhereInput = {};
  if (where.userId) whereClause.userId = where.userId;
  if (where.action) whereClause.action = where.action;
  if (where.entity) whereClause.entity = where.entity;
  if (where.entityId) whereClause.entityId = where.entityId;
  if (where.from || where.to) {
    whereClause.createdAt = {};
    if (where.from) whereClause.createdAt.gte = where.from;
    if (where.to) whereClause.createdAt.lte = where.to;
  }

  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where: whereClause }),
  ]);

  return { items, total };
}