import { OrderStatus, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { getPrismaClient } from '../../config/prisma.client';
import { enqueueLowStockAlert } from '../../config/queues';
import { publishPosEvent } from '../../config/redis.client';
import { getSocketServer } from '../../socket/socket.server';
import { delCacheByPrefix } from './cache.service';
import { computeOrderTotals } from './pricing.service';
import { notFound, unprocessable } from '../common/errors';
import type { CreateOrderDto, ListOrdersDto, OrderItemInput, OrderPaymentInput } from '../../zod/order.schema';
import { paginationSkip } from '../../zod/shared';

type OrderWithRelations = Prisma.OrderGetPayload<{
  include: { items: true; payments: true; cashier: { select: { id: true; name: true; email: true } }; customer: true };
}>;

export type CreateOrderResult = {
  order: OrderWithRelations;
  lowStockProductIds: string[];
};

function generateOrderNumber(): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = randomBytes(3).toString('hex').toUpperCase();
  return `ORD-${stamp}-${suffix}`;
}

type TransactionClient = Prisma.TransactionClient;

async function decrementStock(
  tx: TransactionClient,
  items: OrderItemInput[],
  orderId: string,
): Promise<string[]> {
  const productIds = items.map((item) => item.productId);
  const products = await tx.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true,
      name: true,
      sku: true,
      priceCents: true,
      taxRateBps: true,
      stock: true,
      lowStockThreshold: true,
      isActive: true,
    },
  });

  const productMap = new Map(products.map((product) => [product.id, product]));

  for (const item of items) {
    const product = productMap.get(item.productId);
    if (!product || !product.isActive) {
      throw unprocessable(`Product not found or inactive: ${item.productId}`, 'PRODUCT_UNAVAILABLE');
    }
  }

  const lowStockProductIds: string[] = [];

  for (const item of items) {
    const product = productMap.get(item.productId)!;

    const updated = await tx.product.updateMany({
      where: { id: product.id, stock: { gte: item.quantity } },
      data: { stock: { decrement: item.quantity } },
    });

    if (updated.count === 0) {
      throw unprocessable(
        `Insufficient stock for ${product.name} (requested ${item.quantity}, available ${product.stock})`,
        'INSUFFICIENT_STOCK',
      );
    }

    const remainingStock = product.stock - item.quantity;
    if (remainingStock <= product.lowStockThreshold) {
      lowStockProductIds.push(product.id);
    }

    await tx.stockMovement.create({
      data: {
        productId: product.id,
        delta: -item.quantity,
        reason: 'SALE',
        orderId,
        note: `Sold ${item.quantity} x ${product.name}`,
      },
    });
  }

  return lowStockProductIds;
}

export async function createOrder(dto: CreateOrderDto, cashierId: string, storeId?: string | null): Promise<CreateOrderResult> {
  const prisma = getPrismaClient();

  const paidCents = dto.payments.reduce((sum, payment) => sum + payment.amountCents, 0);

  const productPrices = await prisma.product.findMany({
    where: { id: { in: dto.items.map((item) => item.productId) } },
    select: { id: true, name: true, sku: true, priceCents: true, taxRateBps: true },
  });

  const priceMap = new Map(productPrices.map((product) => [product.id, product]));
  const pricedLines = dto.items.map((item) => {
    const product = priceMap.get(item.productId);
    if (!product) {
      throw unprocessable(`Product not found: ${item.productId}`, 'PRODUCT_UNAVAILABLE');
    }

    return {
      quantity: item.quantity,
      priceCents: product.priceCents,
      taxRateBps: product.taxRateBps,
    };
  });

  let totals: ReturnType<typeof computeOrderTotals> & { paidCents: number; changeCents: number };
  try {
    totals = computeOrderTotals(pricedLines, dto.discountCents, paidCents);
  } catch (error) {
    throw unprocessable((error as Error).message, 'INVALID_ORDER_TOTALS');
  }

  const created = await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        orderNumber: generateOrderNumber(),
        status: OrderStatus.PAID,
        cashierId,
        storeId: storeId ?? null,
        customerId: dto.customerId ?? null,
        subtotalCents: totals.subtotalCents,
        taxCents: totals.taxCents,
        discountCents: totals.discountCents,
        totalCents: totals.totalCents,
        paidCents: totals.paidCents,
        changeCents: totals.changeCents,
        note: dto.note ?? null,
        items: {
          create: dto.items.map((item, index) => {
            const product = priceMap.get(item.productId)!;
            const priced = totals.lines[index];
            return {
              productId: item.productId,
              nameSnapshot: product.name,
              skuSnapshot: product.sku,
              unitPriceCents: product.priceCents,
              quantity: item.quantity,
              lineTotalCents: priced.lineTotalCents,
            };
          }),
        },
      },
      include: { items: true, payments: true, cashier: { select: { id: true, name: true, email: true } }, customer: true },
    });

    const lowStockProductIds = await decrementStock(tx, dto.items, order.id);

    await tx.payment.createMany({
      data: dto.payments.map((payment: OrderPaymentInput) => ({
        orderId: order.id,
        method: payment.method,
        amountCents: payment.amountCents,
        reference: payment.reference ?? null,
      })),
    });

    const fullOrder = await tx.order.findUniqueOrThrow({
      where: { id: order.id },
      include: {
        items: {
          include: { product: { select: { name: true, sku: true, priceCents: true } } },
        },
        payments: true,
        cashier: { select: { id: true, name: true, email: true } },
        customer: true,
      },
    });

    return { order: fullOrder, lowStockProductIds };
  });

  return created;
}

export async function finalizeOrderSideEffects(result: CreateOrderResult): Promise<void> {
  const order = result.order;

  await delCacheByPrefix('products:list');

  const io = getSocketServer();
  const room = order.storeId ? `store:${order.storeId}` : 'store:default';
  io?.to(room).emit('order:created', {
    id: order.id,
    orderNumber: order.orderNumber,
    totalCents: order.totalCents,
    itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
  });

  await publishPosEvent({
    type: 'order:created',
    data: { id: order.id, orderNumber: order.orderNumber, totalCents: order.totalCents },
  });

  if (result.lowStockProductIds.length > 0) {
    await enqueueLowStockAlert({ productIds: result.lowStockProductIds });
  }
}

export async function listOrders(dto: ListOrdersDto): Promise<{ data: OrderWithRelations[]; total: number; page: number; pageSize: number }> {
  const prisma = getPrismaClient();
  const { skip, take } = paginationSkip(dto);

  const where: Prisma.OrderWhereInput = {
    status: dto.status,
    cashierId: dto.cashierId,
    createdAt: dto.from || dto.to ? { gte: dto.from ? new Date(dto.from) : undefined, lte: dto.to ? new Date(dto.to) : undefined } : undefined,
  };

  const [data, total] = await prisma.$transaction([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: { items: true, payments: true, cashier: { select: { id: true, name: true, email: true } }, customer: true },
    }),
    prisma.order.count({ where }),
  ]);

  return { data, total, page: dto.page, pageSize: dto.pageSize };
}

export async function getOrder(orderId: string): Promise<OrderWithRelations> {
  const order = await getPrismaClient().order.findUnique({
    where: { id: orderId },
    include: { items: true, payments: true, cashier: { select: { id: true, name: true, email: true } }, customer: true },
  });

  if (!order) {
    throw notFound('Order not found');
  }

  return order;
}

export async function voidOrder(
  orderId: string,
  actorId: string,
  authorizedById?: string | null,
): Promise<OrderWithRelations> {
  const prisma = getPrismaClient();

  const updated = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) {
      throw notFound('Order not found');
    }

    if (order.status !== OrderStatus.PAID) {
      throw unprocessable(`Only PAID orders can be voided (current status: ${order.status})`, 'ORDER_NOT_VOIDABLE');
    }

    for (const item of order.items) {
      await tx.product.update({
        where: { id: item.productId },
        data: { stock: { increment: item.quantity } },
      });

      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          delta: item.quantity,
          reason: 'VOID',
          orderId: order.id,
          note: `Voided order ${order.orderNumber}`,
        },
      });
    }

    return tx.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.VOID },
      include: { items: true, payments: true, cashier: { select: { id: true, name: true, email: true } }, customer: true },
    });
  });

  await delCacheByPrefix('products:list');

  const authorizedBy = authorizedById ?? null;

  const io = getSocketServer();
  const room = updated.storeId ? `store:${updated.storeId}` : 'store:default';
  io?.to(room).emit('order:voided', {
    id: updated.id,
    orderNumber: updated.orderNumber,
    voidedBy: actorId,
    authorizedBy,
  });

  await publishPosEvent({
    type: 'order:voided',
    data: { id: updated.id, orderNumber: updated.orderNumber, voidedBy: actorId, authorizedBy },
  });

  return updated;
}
