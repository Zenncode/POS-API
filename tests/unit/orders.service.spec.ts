import { AppError } from '../../app/common/errors';

jest.mock('@prisma/client', () => ({
  OrderStatus: {
    PENDING: 'PENDING',
    PAID: 'PAID',
    VOID: 'VOID',
    REFUNDED: 'REFUNDED',
  },
  Prisma: {},
}));

jest.mock('../../config/prisma.client', () => ({
  getPrismaClient: () => mockPrisma,
}));

const txMock = {
  order: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    update: jest.fn(),
  },
  product: {
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  stockMovement: {
    create: jest.fn(),
  },
  payment: {
    createMany: jest.fn(),
  },
};

const mockPrisma = {
  $transaction: jest.fn(async (arg: unknown) => {
    if (Array.isArray(arg)) {
      return Promise.all(arg as Promise<unknown>[]);
    }
    return (arg as (tx: typeof txMock) => Promise<unknown>)(txMock);
  }),
  product: {
    findMany: jest.fn(),
  },
};

import { createOrder, voidOrder } from '../../app/services/order.service';
import type { CreateOrderDto } from '../../zod/order.schema';

const fullOrderFixture = {
  id: 'o1',
  orderNumber: 'ORD-20260101-AAAAAA',
  status: 'PAID',
  subtotalCents: 2000,
  taxCents: 160,
  discountCents: 0,
  totalCents: 2160,
  paidCents: 2500,
  changeCents: 340,
  items: [],
  payments: [],
  cashier: { id: 'u1', name: 'Cashier', email: 'cashier@example.com' },
  customer: null,
  storeId: null,
};

const baseDto: CreateOrderDto = {
  items: [{ productId: 'p1', quantity: 2 }],
  payments: [{ method: 'CASH', amountCents: 2500 }],
  discountCents: 0,
};

describe('order.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockPrisma.product.findMany.mockResolvedValue([
      { id: 'p1', name: 'Coffee', sku: 'SKU-1', priceCents: 1000, taxRateBps: 800 },
    ]);

    txMock.order.create.mockResolvedValue({ id: 'o1' });
    txMock.order.update.mockResolvedValue({ ...fullOrderFixture, status: 'VOID' });
    txMock.order.findUniqueOrThrow.mockResolvedValue(fullOrderFixture);
    txMock.product.findMany.mockResolvedValue([
      { id: 'p1', name: 'Coffee', sku: 'SKU-1', priceCents: 1000, taxRateBps: 800, stock: 10, lowStockThreshold: 5, isActive: true },
    ]);
    txMock.product.updateMany.mockResolvedValue({ count: 1 });
    txMock.product.update.mockResolvedValue({});
    txMock.stockMovement.create.mockResolvedValue({});
    txMock.payment.createMany.mockResolvedValue({ count: 1 });
  });

  describe('createOrder', () => {
    it('computes totals with tax and stores item snapshots', async () => {
      const result = await createOrder(baseDto, 'u1');

      expect(result.order.totalCents).toBe(2160);
      expect(result.order.changeCents).toBe(340);

      const createdItems = txMock.order.create.mock.calls[0][0].data.items.create;
      expect(createdItems).toEqual([
        {
          productId: 'p1',
          nameSnapshot: 'Coffee',
          skuSnapshot: 'SKU-1',
          unitPriceCents: 1000,
          quantity: 2,
          lineTotalCents: 2160,
        },
      ]);

      expect(txMock.product.updateMany).toHaveBeenCalledWith({
        where: { id: 'p1', stock: { gte: 2 } },
        data: { stock: { decrement: 2 } },
      });

      expect(txMock.stockMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ productId: 'p1', delta: -2, reason: 'SALE', orderId: 'o1' }),
      });
    });

    it('rejects with INSUFFICIENT_STOCK when the guarded decrement misses', async () => {
      txMock.product.updateMany.mockResolvedValue({ count: 0 });

      await expect(createOrder(baseDto, 'u1')).rejects.toMatchObject({
        status: 422,
        code: 'INSUFFICIENT_STOCK',
      });
    });

    it('rejects when payments do not cover the total', async () => {
      await expect(
        createOrder(
          { ...baseDto, payments: [{ method: 'CASH', amountCents: 100 }] },
          'u1',
        ),
      ).rejects.toMatchObject({
        status: 422,
        code: 'INVALID_ORDER_TOTALS',
      });
    });

    it('rejects unknown products', async () => {
      mockPrisma.product.findMany.mockResolvedValue([]);

      await expect(createOrder(baseDto, 'u1')).rejects.toMatchObject({
        status: 422,
        code: 'PRODUCT_UNAVAILABLE',
      });
    });
  });

  describe('voidOrder', () => {
    it('restores stock and marks the order VOID', async () => {
      txMock.order.findUnique.mockResolvedValue({
        ...fullOrderFixture,
        items: [{ id: 'i1', productId: 'p1', quantity: 2, nameSnapshot: 'Coffee', skuSnapshot: 'SKU-1', unitPriceCents: 1000, lineTotalCents: 2160 }],
      });

      const result = await voidOrder('o1', 'mgr1');

      expect(result.status).toBe('VOID');
      expect(txMock.product.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { stock: { increment: 2 } },
      });
      expect(txMock.stockMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ productId: 'p1', delta: 2, reason: 'VOID' }),
      });
    });

    it('refuses to void an order that is not PAID', async () => {
      txMock.order.findUnique.mockResolvedValue({ ...fullOrderFixture, status: 'PENDING', items: [] });

      await expect(voidOrder('o1', 'mgr1')).rejects.toMatchObject({
        status: 422,
        code: 'ORDER_NOT_VOIDABLE',
      });
    });

    it('throws NOT_FOUND for missing orders', async () => {
      txMock.order.findUnique.mockResolvedValue(null);

      await expect(voidOrder('missing', 'mgr1')).rejects.toBeInstanceOf(AppError);
    });
  });
});
