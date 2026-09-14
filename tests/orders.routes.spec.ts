import { notFound, unprocessable } from '../app/common/errors';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-access-secret-routes';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-routes';
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:5432/test';
process.env.REDIS_ENABLED = 'false';
process.env.QUEUE_ENABLED = 'false';
process.env.DISCOUNT_OVERRIDE_CENTS = '1000';

jest.mock('../app/services/order.service', () => ({
  createOrder: jest.fn(),
  listOrders: jest.fn(),
  getOrder: jest.fn(),
  voidOrder: jest.fn(),
  refundOrder: jest.fn(),
  finalizeOrderSideEffects: jest.fn(async () => undefined),
}));

jest.mock('../app/services/idempotency.service', () => ({
  beginIdempotency: jest.fn(async () => ({ kind: 'claim' })),
  storeIdempotentResponse: jest.fn(async () => undefined),
  releaseIdempotency: jest.fn(async () => undefined),
  extractIdempotencyKey: jest.fn(() => null),
  newIdempotencyKey: jest.fn(() => 'generated-key'),
}));

jest.mock('../app/services/cache.service', () => ({
  getCache: jest.fn(async () => null),
  setCache: jest.fn(async () => undefined),
  delCache: jest.fn(async () => undefined),
  delCacheByPrefix: jest.fn(async () => undefined),
  withCache: jest.fn(async (_key: string, _ttl: number, producer: () => Promise<unknown>) => producer()),
}));

jest.mock('../app/services/audit.service', () => ({
  writeAuditLog: jest.fn(async () => undefined),
}));

import { createApp } from '../app/app.module';
import * as orderService from '../app/services/order.service';
import * as idempotencyService from '../app/services/idempotency.service';

const createOrderMock = orderService.createOrder as jest.MockedFunction<typeof orderService.createOrder>;
const listOrdersMock = orderService.listOrders as jest.MockedFunction<typeof orderService.listOrders>;
const voidOrderMock = orderService.voidOrder as jest.MockedFunction<typeof orderService.voidOrder>;
const refundOrderMock = orderService.refundOrder as jest.MockedFunction<typeof orderService.refundOrder>;
const beginIdempotencyMock = idempotencyService.beginIdempotency as jest.Mock;
const extractIdempotencyKeyMock = idempotencyService.extractIdempotencyKey as jest.Mock;

function cashierToken(role: 'ADMIN' | 'MANAGER' | 'CASHIER' = 'CASHIER'): string {
  return jwt.sign(
    { sub: 'u1', email: 'user@example.com', role, tokenType: 'access' },
    process.env.JWT_SECRET as string,
    { expiresIn: '15m' },
  );
}

const orderFixture = {
  id: 'o1',
  orderNumber: 'ORD-20260101-AAAAAA',
  status: 'PAID',
  totalCents: 2160,
  paidCents: 2500,
  changeCents: 340,
  items: [
    { id: '00000000-0000-4000-8000-000000000010', productId: 'p1', nameSnapshot: 'Product 1', skuSnapshot: 'SKU1', unitPriceCents: 1000, quantity: 2, lineTotalCents: 2160 },
  ],
  payments: [],
  cashier: { id: 'u1', name: 'Cashier', email: 'user@example.com' },
  customer: null,
};

const validPayload = {
  items: [{ productId: '00000000-0000-4000-8000-000000000001', quantity: 2 }],
  payments: [{ method: 'CASH', amountCents: 2500 }],
};

const refundPayload = {
  lines: [{ orderItemId: '00000000-0000-4000-8000-000000000010', quantity: 1 }],
  paymentMethod: 'CASH',
  reference: 'ref-123',
  note: 'Customer request',
};

const refundResultFixture = {
  order: {
    ...orderFixture,
    status: 'PAID',
    payments: [{ id: 'pay1', method: 'CASH', amountCents: -1080, reference: 'Refund: Customer request' }],
  },
  refundAmountCents: 1080,
  refundedLines: [{ orderItemId: 'item1', quantity: 1, amountCents: 1080 }],
};

describe('Order routes', () => {
  const app = createApp();

  beforeEach(() => {
    jest.clearAllMocks();
    extractIdempotencyKeyMock.mockReturnValue(null);
    beginIdempotencyMock.mockResolvedValue({ kind: 'claim' });
  });

  it('rejects unauthenticated requests', async () => {
    const response = await request(app).post('/api/orders').send(validPayload);

    expect(response.status).toBe(401);
    expect(createOrderMock).not.toHaveBeenCalled();
  });

  it('creates an order for a cashier', async () => {
    createOrderMock.mockResolvedValueOnce({ order: orderFixture as never, lowStockProductIds: [] });

    const response = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${cashierToken()}`)
      .send(validPayload);

    expect(response.status).toBe(201);
    expect(response.body.order.orderNumber).toBe('ORD-20260101-AAAAAA');
    expect(response.body.changeCents).toBe(340);
    expect(orderService.finalizeOrderSideEffects).toHaveBeenCalledWith({
      order: orderFixture,
      lowStockProductIds: [],
    });
  });

  it('replies with the stored response on idempotent replay', async () => {
    extractIdempotencyKeyMock.mockReturnValue('key-aaaaaaaa');
    beginIdempotencyMock.mockResolvedValueOnce({ kind: 'replay', response: { replayed: true } });

    const response = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${cashierToken()}`)
      .set('Idempotency-Key', 'key-aaaaaaaa')
      .send(validPayload);

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ replayed: true });
    expect(createOrderMock).not.toHaveBeenCalled();
  });

  it('rejects validation failures with 400', async () => {
    const response = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${cashierToken()}`)
      .send({ items: [], payments: [] });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Validation failed');
    expect(createOrderMock).not.toHaveBeenCalled();
  });

  it('lists orders for a manager and scopes cashiers to their own orders', async () => {
    listOrdersMock.mockResolvedValueOnce({ data: [], total: 0, page: 1, pageSize: 20 });

    const managerResponse = await request(app)
      .get('/api/orders')
      .set('Authorization', `Bearer ${cashierToken('MANAGER')}`);

    expect(managerResponse.status).toBe(200);
    expect(listOrdersMock).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 20 }));

    listOrdersMock.mockClear();
    listOrdersMock.mockResolvedValueOnce({ data: [], total: 0, page: 1, pageSize: 20 });

    await request(app).get('/api/orders').set('Authorization', `Bearer ${cashierToken('CASHIER')}`);

    expect(listOrdersMock).toHaveBeenCalledWith(
      expect.objectContaining({ cashierId: 'u1' }),
    );
  });

  it('forbids cashiers from voiding orders', async () => {
    const response = await request(app)
      .post('/api/orders/00000000-0000-4000-8000-000000000009/void')
      .set('Authorization', `Bearer ${cashierToken('CASHIER')}`);

    expect(response.status).toBe(403);
    expect(voidOrderMock).not.toHaveBeenCalled();
  });

  it('voids orders for managers', async () => {
    voidOrderMock.mockResolvedValueOnce({
      ...orderFixture,
      status: 'VOID',
    } as never);

    const response = await request(app)
      .post('/api/orders/00000000-0000-4000-8000-000000000009/void')
      .set('Authorization', `Bearer ${cashierToken('MANAGER')}`);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('VOID');
  });

  it('allows cashiers to void orders with a manager override token', async () => {
    voidOrderMock.mockResolvedValueOnce({
      ...orderFixture,
      status: 'VOID',
    } as never);

    const overrideToken = jwt.sign(
      { sub: 'mgr1', email: 'manager@example.com', role: 'MANAGER', tokenType: 'override' },
      process.env.JWT_SECRET as string,
      { expiresIn: '5m' },
    );

    const response = await request(app)
      .post('/api/orders/00000000-0000-4000-8000-000000000009/void')
      .set('Authorization', `Bearer ${cashierToken('CASHIER')}`)
      .set('X-Override-Token', overrideToken);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('VOID');
    expect(voidOrderMock).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000009',
      'u1',
      'mgr1',
    );
  });

  it('rejects invalid override tokens', async () => {
    const response = await request(app)
      .post('/api/orders/00000000-0000-4000-8000-000000000009/void')
      .set('Authorization', `Bearer ${cashierToken('CASHIER')}`)
      .set('X-Override-Token', jwt.sign({ sub: 'mgr1', tokenType: 'override' }, 'wrong-secret'));

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('INVALID_OVERRIDE_TOKEN');
    expect(voidOrderMock).not.toHaveBeenCalled();
  });

  it('requires manager approval when a cashier discounts above the threshold', async () => {
    const response = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${cashierToken('CASHIER')}`)
      .send({ ...validPayload, discountCents: 2000 });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('MANAGER_OVERRIDE_REQUIRED');
    expect(createOrderMock).not.toHaveBeenCalled();
  });

  it('lets managers discount above the threshold without an override', async () => {
    createOrderMock.mockResolvedValueOnce({ order: orderFixture as never, lowStockProductIds: [] });

    const response = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${cashierToken('MANAGER')}`)
      .send({ ...validPayload, discountCents: 2000 });

    expect(response.status).toBe(201);
    expect(createOrderMock).toHaveBeenCalled();
  });

  describe('Refunds', () => {
    it('forbids cashiers from refunding orders', async () => {
      const response = await request(app)
        .post('/api/orders/00000000-0000-4000-8000-000000000009/refund')
        .set('Authorization', `Bearer ${cashierToken('CASHIER')}`)
        .send(refundPayload);

      expect(response.status).toBe(403);
      expect(refundOrderMock).not.toHaveBeenCalled();
    });

    it('refunds orders for managers', async () => {
      refundOrderMock.mockResolvedValueOnce(refundResultFixture as never);

      const response = await request(app)
        .post('/api/orders/00000000-0000-4000-8000-000000000009/refund')
        .set('Authorization', `Bearer ${cashierToken('MANAGER')}`)
        .send(refundPayload);

      expect(response.status).toBe(200);
      expect(response.body.refundAmountCents).toBe(1080);
      expect(response.body.refundedLines).toHaveLength(1);
      expect(refundOrderMock).toHaveBeenCalledWith(
        '00000000-0000-4000-8000-000000000009',
        expect.objectContaining({
          lines: [{ orderItemId: '00000000-0000-4000-8000-000000000010', quantity: 1 }],
          paymentMethod: 'CASH',
          reference: 'ref-123',
          note: 'Customer request',
        }),
        'u1',
        null,
      );
    });

    it('allows cashiers to refund orders with a manager override token', async () => {
      refundOrderMock.mockResolvedValueOnce(refundResultFixture as never);

      const overrideToken = jwt.sign(
        { sub: 'mgr1', email: 'manager@example.com', role: 'MANAGER', tokenType: 'override' },
        process.env.JWT_SECRET as string,
        { expiresIn: '5m' },
      );

      const response = await request(app)
        .post('/api/orders/00000000-0000-4000-8000-000000000009/refund')
        .set('Authorization', `Bearer ${cashierToken('CASHIER')}`)
        .set('X-Override-Token', overrideToken)
        .send(refundPayload);

      expect(response.status).toBe(200);
      expect(response.body.refundAmountCents).toBe(1080);
      expect(refundOrderMock).toHaveBeenCalledWith(
        '00000000-0000-4000-8000-000000000009',
        expect.any(Object),
        'u1',
        'mgr1',
      );
    });

    it('rejects refund for non-existent order', async () => {
      refundOrderMock.mockRejectedValueOnce(notFound('Order not found'));

      const response = await request(app)
        .post('/api/orders/00000000-0000-4000-8000-000000000009/refund')
        .set('Authorization', `Bearer ${cashierToken('MANAGER')}`)
        .send(refundPayload);

      expect(response.status).toBe(404);
    });

    it('rejects refund for voided order', async () => {
      refundOrderMock.mockRejectedValueOnce(unprocessable('Cannot refund a voided order', 'ORDER_VOIDED'));

      const response = await request(app)
        .post('/api/orders/00000000-0000-4000-8000-000000000009/refund')
        .set('Authorization', `Bearer ${cashierToken('MANAGER')}`)
        .send(refundPayload);

      expect(response.status).toBe(422);
      expect(response.body.code).toBe('ORDER_VOIDED');
    });

    it('rejects refund for already fully refunded order', async () => {
      refundOrderMock.mockRejectedValueOnce(unprocessable('Order is already fully refunded', 'ORDER_ALREADY_REFUNDED'));

      const response = await request(app)
        .post('/api/orders/00000000-0000-4000-8000-000000000009/refund')
        .set('Authorization', `Bearer ${cashierToken('MANAGER')}`)
        .send(refundPayload);

      expect(response.status).toBe(422);
      expect(response.body.code).toBe('ORDER_ALREADY_REFUNDED');
    });

    it('rejects refund with invalid payload', async () => {
      const response = await request(app)
        .post('/api/orders/00000000-0000-4000-8000-000000000009/refund')
        .set('Authorization', `Bearer ${cashierToken('MANAGER')}`)
        .send({ lines: [], paymentMethod: 'CASH' });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Validation failed');
      expect(refundOrderMock).not.toHaveBeenCalled();
    });
  });
});
