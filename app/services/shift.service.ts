import { Prisma, ShiftStatus, CashCountType } from '@prisma/client';
import { getPrismaClient } from '../../config/prisma.client';
import { delCacheByPrefix } from './cache.service';
import { notFound, unprocessable } from '../common/errors';
import type { OpenShiftDto, CloseShiftDto, ListShiftsDto, GetZReportsDto, CashCountInput } from '../../zod/shift.schema';
import { paginationSkip } from '../../zod/shared';

type ShiftWithRelations = {
  id: string;
  userId: string;
  storeId: string | null;
  openedAt: Date;
  closedAt: Date | null;
  openingFloatCents: number;
  closingFloatCents: number | null;
  expectedCashCents: number | null;
  varianceCents: number | null;
  status: ShiftStatus;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  user: { id: string; name: string; email: string };
  store: { id: string; name: string } | null;
  cashCounts: Prisma.CashCountGetPayload<object>[];
};

type ZReportWithRelations = Prisma.ZReportGetPayload<{
  include: { shift: { select: { id: true; user: { select: { id: true; name: true } } } }, store: { select: { id: true; name: true } } };
}>;

function sumCashCount(counts: CashCountInput[]): number {
  return counts.reduce((sum, c) => sum + c.denomination * c.count, 0);
}

async function createCashCounts(
  tx: Prisma.TransactionClient,
  shiftId: string,
  counts: CashCountInput[],
  type: CashCountType,
): Promise<void> {
  await tx.cashCount.createMany({
    data: counts.map((count) => ({
      shiftId,
      denomination: count.denomination,
      count: count.count,
      type,
    })),
  });
}

export async function openShift(
  dto: OpenShiftDto,
  userId: string,
  storeId: string | null,
): Promise<ShiftWithRelations> {
  const prisma = getPrismaClient();

  const existingOpenShift = await prisma.shift.findFirst({
    where: { userId, status: ShiftStatus.OPEN },
  });

  if (existingOpenShift) {
    throw unprocessable('You already have an open shift. Close it first.', 'SHIFT_ALREADY_OPEN');
  }

  const openingFloatCents = sumCashCount(dto.openingFloat);

  const shift = await prisma.$transaction(async (tx) => {
    const created = await tx.shift.create({
      data: {
        userId,
        storeId: storeId ?? null,
        openingFloatCents,
        status: ShiftStatus.OPEN,
        note: dto.note ?? null,
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        store: { select: { id: true, name: true } },
        cashCounts: true,
      } as any,
    });

    await createCashCounts(tx, created.id, dto.openingFloat, CashCountType.OPENING);

    return tx.shift.findUniqueOrThrow({
      where: { id: created.id },
      include: {
        user: { select: { id: true, name: true, email: true } },
        store: { select: { id: true, name: true } },
        cashCounts: true,
      } as any,
    }) as unknown as ShiftWithRelations;
  });

  return shift;
}

export async function getCurrentShift(userId: string): Promise<ShiftWithRelations | null> {
  const shift = await getPrismaClient().shift.findFirst({
    where: { userId, status: ShiftStatus.OPEN },
    include: {
      user: { select: { id: true, name: true, email: true } },
      store: { select: { id: true, name: true } },
      cashCounts: true,
    } as any,
    orderBy: { openedAt: 'desc' },
  });
  return shift as unknown as ShiftWithRelations | null;
}

export async function closeShift(
  shiftId: string,
  userId: string,
  dto: CloseShiftDto,
): Promise<ShiftWithRelations> {
  const prisma = getPrismaClient();

  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    include: { user: { select: { id: true, name: true, email: true } }, store: { select: { id: true, name: true } }, cashCounts: true } as any,
  }) as unknown as ShiftWithRelations;

  if (!shift) {
    throw notFound('Shift not found');
  }

  if (shift.userId !== userId) {
    throw unprocessable('You can only close your own shift', 'SHIFT_NOT_OWNER');
  }

  if (shift.status !== ShiftStatus.OPEN) {
    throw unprocessable('Shift is already closed', 'SHIFT_ALREADY_CLOSED');
  }

  const closingFloatCents = sumCashCount(dto.closingFloat);

  const completedShift = await prisma.$transaction(async (tx) => {
    await createCashCounts(tx, shiftId, dto.closingFloat, CashCountType.CLOSING);

    const orders = await tx.order.findMany({
      where: {
        cashierId: userId,
        createdAt: { gte: shift.openedAt },
        status: { in: ['PAID', 'VOID', 'REFUNDED'] },
      },
      include: { payments: true },
    });

    let expectedCashCents = 0;
    let totalCashSalesCents = 0;
    let totalCardSalesCents = 0;
    let totalRefundsCents = 0;
    let transactionCount = 0;
    let voidCount = 0;
    let refundCount = 0;

    for (const order of orders) {
      transactionCount++;
      if (order.status === 'VOID') {
        voidCount++;
      } else if (order.status === 'REFUNDED') {
        refundCount++;
        totalRefundsCents += order.totalCents;
      } else {
        for (const payment of order.payments) {
          if (payment.method === 'CASH') {
            totalCashSalesCents += payment.amountCents;
            expectedCashCents += payment.amountCents;
          } else {
            totalCardSalesCents += payment.amountCents;
          }
        }
      }
    }

    const netSalesCents = totalCashSalesCents + totalCardSalesCents - totalRefundsCents;
    const varianceCents = closingFloatCents - (shift.openingFloatCents + expectedCashCents);

    const updated = await tx.shift.update({
      where: { id: shiftId },
      data: {
        closedAt: new Date(),
        closingFloatCents,
        expectedCashCents,
        varianceCents,
        status: ShiftStatus.CLOSED,
        note: dto.note ?? shift.note,
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        store: { select: { id: true, name: true } },
        cashCounts: true,
      } as any,
    }) as unknown as ShiftWithRelations;

    if (updated.storeId) {
      await tx.zReport.create({
        data: {
          storeId: updated.storeId,
          shiftId: updated.id,
          date: new Date(shift.openedAt),
          totalSalesCents: netSalesCents,
          totalCashSalesCents,
          totalCardSalesCents,
          totalRefundsCents,
          netSalesCents,
          openingFloatCents: shift.openingFloatCents,
          closingFloatCents,
          expectedCashCents,
          varianceCents,
          transactionCount,
          voidCount,
          refundCount,
        },
      });
    }

    return updated;
  });

  await delCacheByPrefix('shifts:list');

  return completedShift;
}

export async function listShifts(dto: ListShiftsDto): Promise<{ data: ShiftWithRelations[]; total: number; page: number; pageSize: number }> {
  const prisma = getPrismaClient();
  const { skip, take } = paginationSkip(dto);

  const where: Prisma.ShiftWhereInput = {
    userId: dto.userId,
    status: dto.status,
    openedAt: dto.from || dto.to ? { gte: dto.from ? new Date(dto.from) : undefined, lte: dto.to ? new Date(dto.to) : undefined } : undefined,
  };

  const [data, total] = await prisma.$transaction([
    prisma.shift.findMany({
      where,
      orderBy: { openedAt: 'desc' },
      skip,
      take,
      include: {
        user: { select: { id: true, name: true, email: true } },
        store: { select: { id: true, name: true } },
        cashCounts: true,
      } as any,
    }),
    prisma.shift.count({ where }),
  ]);

  return { data: data as unknown as ShiftWithRelations[], total, page: dto.page, pageSize: dto.pageSize };
}

export async function getShift(shiftId: string): Promise<ShiftWithRelations> {
  const shift = await getPrismaClient().shift.findUnique({
    where: { id: shiftId },
    include: {
      user: { select: { id: true, name: true, email: true } },
      store: { select: { id: true, name: true } },
      cashCounts: true,
    } as any,
  });

  if (!shift) {
    throw notFound('Shift not found');
  }

  return shift as unknown as ShiftWithRelations;
}

export async function getZReports(dto: GetZReportsDto): Promise<{ data: ZReportWithRelations[]; total: number; page: number; pageSize: number }> {
  const prisma = getPrismaClient();
  const { skip, take } = paginationSkip(dto);

  const where: Prisma.ZReportWhereInput = {
    storeId: dto.storeId,
    date: dto.from || dto.to ? { gte: dto.from ? new Date(dto.from) : undefined, lte: dto.to ? new Date(dto.to) : undefined } : undefined,
  };

  const [data, total] = await prisma.$transaction([
    prisma.zReport.findMany({
      where,
      orderBy: { date: 'desc' },
      skip,
      take,
      include: { shift: { select: { id: true, user: { select: { id: true, name: true } } } }, store: { select: { id: true, name: true } } },
    }),
    prisma.zReport.count({ where }),
  ]);

  return { data, total, page: dto.page, pageSize: dto.pageSize };
}

export async function getZReport(reportId: string): Promise<ZReportWithRelations> {
  const report = await getPrismaClient().zReport.findUnique({
    where: { id: reportId },
    include: { shift: { select: { id: true, user: { select: { id: true, name: true } } } }, store: { select: { id: true, name: true } } },
  });

  if (!report) {
    throw notFound('Z-Report not found');
  }

  return report;
}