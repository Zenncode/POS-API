import { OrderStatus, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { getPrismaClient } from '../../config/prisma.client';
import { enqueueLowStockAlert } from '../../config/queues';
import { publishPosEvent } from '../../config/redis.client';
import { getSocketServer } from '../../socket/socket.server';
import { delCacheByPrefix } from './cache.service';
import { computeOrderTotals } from './pricing.service';
import { reserveStock, releaseAllReservations } from './stock-reservation.service';
import { notFound, unprocessable } from '../common/errors';
import type { CreateOrderDto, ListOrdersDto, OrderItemInput, OrderPaymentInput, RefundOrderDto } from '../../zod/order.schema';
import { paginationSkip } from '../../zod/shared';
import { writeAuditLog } from './audit.service';

export type OrderWithRelations = Prisma.OrderGetPayload<{
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

  // Create soft stock reservations (FR-21) - these expire automatically via Redis TTL
  // If the transaction fails, we release the reservations
  const saleId = `sale-${randomBytes(8).toString('hex')}`;
  for (const item of dto.items) {
    const reserveResult = await reserveStock(item.productId, item.quantity, saleId);
    if (!reserveResult.success) {
      // Release any already-created reservations for this sale
      await releaseAllReservations(saleId);
      throw unprocessable(reserveResult.error ?? 'Failed to reserve stock', 'STOCK_RESERVATION_FAILED');
    }
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

  // Release soft reservations now that the sale is committed
  await releaseAllReservations(saleId);

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

export type RefundResult = {
  order: OrderWithRelations;
  refundAmountCents: number;
  refundedLines: { orderItemId: string; quantity: number; amountCents: number }[];
};

export async function refundOrder(
  orderId: string,
  dto: RefundOrderDto,
  actorId: string,
  authorizedById?: string | null,
): Promise<RefundResult> {
  const prisma = getPrismaClient();

  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: true, payments: true },
    });

    if (!order) {
      throw notFound('Order not found');
    }

    if (order.status === OrderStatus.VOID) {
      throw unprocessable('Cannot refund a voided order', 'ORDER_VOIDED');
    }

    if (order.status === OrderStatus.REFUNDED) {
      throw unprocessable('Order is already fully refunded', 'ORDER_ALREADY_REFUNDED');
    }

    if (order.status !== OrderStatus.PAID) {
      throw unprocessable(`Only PAID orders can be refunded (current status: ${order.status})`, 'ORDER_NOT_REFUNDABLE');
    }

    // Build a map of order items by ID
    const itemMap = new Map(order.items.map((item) => [item.id, item]));

    // Validate refund lines and calculate totals
    const refundedLines: { orderItemId: string; quantity: number; amountCents: number }[] = [];
    let totalRefundCents = 0;

    for (const line of dto.lines) {
      const orderItem = itemMap.get(line.orderItemId);
      if (!orderItem) {
        throw unprocessable(`Order item not found: ${line.orderItemId}`, 'ORDER_ITEM_NOT_FOUND');
      }

      // Check if refund quantity exceeds what's available to refund
      const previouslyRefundedQty = await getPreviouslyRefundedQuantity(tx, order.id, line.orderItemId);
      const availableToRefund = orderItem.quantity - previouslyRefundedQty;

      if (line.quantity > availableToRefund) {
        throw unprocessable(
          `Cannot refund ${line.quantity} units of ${orderItem.nameSnapshot} (only ${availableToRefund} available for refund)`,
          'REFUND_QUANTITY_EXCEEDED',
        );
      }

      // Calculate refund amount for this line (using the stored unitPriceCents which includes tax)
      // The lineTotalCents already includes tax, so we calculate proportionally
      const unitTotalCents = orderItem.lineTotalCents / orderItem.quantity;
      const lineRefundCents = unitTotalCents * line.quantity;
      totalRefundCents += lineRefundCents;

      refundedLines.push({
        orderItemId: line.orderItemId,
        quantity: line.quantity,
        amountCents: lineRefundCents,
      });

      // Restore stock
      await tx.product.update({
        where: { id: orderItem.productId },
        data: { stock: { increment: line.quantity } },
      });

      // Create stock movement for refund
      await tx.stockMovement.create({
        data: {
          productId: orderItem.productId,
          delta: line.quantity,
          reason: 'REFUND',
          orderId: order.id,
          note: `Refunded ${line.quantity} x ${orderItem.nameSnapshot}`,
        },
      });
    }

    // Create refund payment record (negative amount)
    await tx.payment.create({
      data: {
        orderId: order.id,
        method: dto.paymentMethod,
        amountCents: -totalRefundCents,
        reference: dto.reference ?? `Refund: ${dto.note ?? 'No note'}`,
      },
    });

    // Determine new order status
    // Calculate total refunded so far (including this refund)
    const totalRefundedSoFar = await tx.payment.aggregate({
      where: { orderId: order.id, amountCents: { lt: 0 } },
      _sum: { amountCents: true },
    });

    const allRefundedCents = Math.abs(totalRefundedSoFar._sum.amountCents ?? 0) + totalRefundCents;
    const newStatus = allRefundedCents >= order.totalCents ? OrderStatus.REFUNDED : OrderStatus.PAID;

    const updatedOrder = await tx.order.update({
      where: { id: orderId },
      data: { status: newStatus },
      include: {
        items: { include: { product: { select: { name: true, sku: true, priceCents: true } } } },
        payments: true,
        cashier: { select: { id: true, name: true, email: true } },
        customer: true,
      },
    });

    return { order: updatedOrder, refundAmountCents: totalRefundCents, refundedLines };
  });

  await delCacheByPrefix('products:list');

  const authorizedBy = authorizedById ?? null;

  const io = getSocketServer();
  const room = result.order.storeId ? `store:${result.order.storeId}` : 'store:default';
  io?.to(room).emit('order:refunded', {
    id: result.order.id,
    orderNumber: result.order.orderNumber,
    refundAmountCents: result.refundAmountCents,
    refundedBy: actorId,
    authorizedBy,
    lines: result.refundedLines,
  });

  await publishPosEvent({
    type: 'order:refunded',
    data: { id: result.order.id, orderNumber: result.order.orderNumber, refundAmountCents: result.refundAmountCents, refundedBy: actorId, authorizedBy },
  });

  // Write audit log
  await writeAuditLog({
    userId: actorId,
    action: 'ORDER_REFUND',
    entity: 'Order',
    entityId: orderId,
    metadata: {
      refundAmountCents: result.refundAmountCents,
      paymentMethod: dto.paymentMethod,
      lines: result.refundedLines,
      authorizedBy,
      note: dto.note,
    },
    result: 'SUCCESS',
  });

  return result;
}

async function getPreviouslyRefundedQuantity(tx: Prisma.TransactionClient, orderId: string, orderItemId: string): Promise<number> {
  // For simplicity, we track refunds through negative payment amounts
  // In a more sophisticated system, we might have a RefundLine model
  // Here we approximate by checking stock movements with REFUND reason for this order item
  const movements = await tx.stockMovement.findMany({
    where: { orderId, reason: 'REFUND' },
    select: { delta: true, productId: true },
  });

  // Get the product ID for this order item
  const orderItem = await tx.orderItem.findUnique({
    where: { id: orderItemId },
    select: { productId: true },
  });

  if (!orderItem) return 0;

  // Sum up all refund deltas for this product in this order
  // Note: this is an approximation since multiple order items could have the same product
  // A more precise implementation would need a RefundLine model
  return movements
    .filter((m) => m.productId === orderItem.productId)
    .reduce((sum, m) => sum + m.delta, 0);
}
