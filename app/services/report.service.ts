import { OrderStatus, Prisma } from '@prisma/client';
import { getPrismaClient } from '../../config/prisma.client';

export type SalesRange = { start: Date; end: Date };

export type SalesTotals = {
  orderCount: number;
  subtotalCents: number;
  taxCents: number;
  discountCents: number;
  totalCents: number;
};

export type DailySalesReport = SalesTotals & {
  date: string;
  topProducts: { productId: string; name: string; sku: string; quantitySold: number; revenueCents: number }[];
  paymentMix: { method: string; amountCents: number; count: number }[];
};

export function parseDayRange(dateIso: string): SalesRange {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
    throw new Error('date must be in YYYY-MM-DD format');
  }

  const start = new Date(`${dateIso}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  if (Number.isNaN(start.getTime())) {
    throw new Error('date must be a valid calendar day');
  }

  return { start, end };
}

function buildRangeWhere(range: SalesRange): Prisma.OrderWhereInput {
  return {
    status: OrderStatus.PAID,
    createdAt: { gte: range.start, lt: range.end },
  };
}

async function computeTotals(range: SalesRange): Promise<SalesTotals> {
  const aggregate = await getPrismaClient().order.aggregate({
    where: buildRangeWhere(range),
    _count: { _all: true },
    _sum: {
      subtotalCents: true,
      taxCents: true,
      discountCents: true,
      totalCents: true,
    },
  });

  return {
    orderCount: aggregate._count._all,
    subtotalCents: aggregate._sum.subtotalCents ?? 0,
    taxCents: aggregate._sum.taxCents ?? 0,
    discountCents: aggregate._sum.discountCents ?? 0,
    totalCents: aggregate._sum.totalCents ?? 0,
  };
}

async function computeTopProducts(range: SalesRange, limit = 10) {
  const prisma = getPrismaClient();

  const grouped = await prisma.orderItem.groupBy({
    by: ['productId'],
    where: { order: buildRangeWhere(range) },
    _sum: { quantity: true, lineTotalCents: true },
    orderBy: { _sum: { quantity: 'desc' } },
    take: limit,
  });

  const productIds = grouped.map((row) => row.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true, sku: true },
  });
  const productMap = new Map(products.map((product) => [product.id, product]));

  return grouped.map((row) => ({
    productId: row.productId,
    name: productMap.get(row.productId)?.name ?? 'Unknown',
    sku: productMap.get(row.productId)?.sku ?? 'UNKNOWN',
    quantitySold: row._sum.quantity ?? 0,
    revenueCents: row._sum.lineTotalCents ?? 0,
  }));
}

async function computePaymentMix(range: SalesRange) {
  const grouped = await getPrismaClient().payment.groupBy({
    by: ['method'],
    where: { order: buildRangeWhere(range) },
    _sum: { amountCents: true },
    _count: { _all: true },
  });

  return grouped.map((row) => ({
    method: row.method,
    amountCents: row._sum.amountCents ?? 0,
    count: row._count._all,
  }));
}

export async function dailySales(dateIso: string): Promise<DailySalesReport> {
  const range = parseDayRange(dateIso);
  const [totals, topProducts, paymentMix] = await Promise.all([
    computeTotals(range),
    computeTopProducts(range),
    computePaymentMix(range),
  ]);

  return { date: dateIso, ...totals, topProducts, paymentMix };
}

export type SalesSummary = {
  from: string;
  to: string;
} & SalesTotals;

export async function salesSummary(fromIso: string, toIso: string): Promise<SalesSummary> {
  const start = new Date(fromIso);
  const end = new Date(toIso);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('from and to must be valid ISO 8601 timestamps');
  }

  if (start >= end) {
    throw new Error('from must be earlier than to');
  }

  const totals = await computeTotals({ start, end });
  return { from: fromIso, to: toIso, ...totals };
}
