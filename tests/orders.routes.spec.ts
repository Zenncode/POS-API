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

import { createApp } from '../app/app.module';
import * as orderService from '../app/services/order.service';
import * as idempotencyService from '../app/services/idempotency.service';

const createOrderMock = orderService.createOrder as jest.MockedFunction<typeof orderService.createOrder>;
const listOrdersMock = orderService.listOrders as jest.MockedFunction<typeof orderService.listOrders>;
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
  items: [],
  payments: [],
  cashier: { id: 'u1', name: 'Cashier', email: 'user@example.com' },
  customer: null,
};

const validPayload = {
  items: [{ productId: '00000000-0000-4000-8000-000000000001', quantity: 2 }],
  payments: [{ method: 'CASH', amountCents: 2500 }],
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
    expect(orderService.voidOrder).not.toHaveBeenCalled();
  });

  it('voids orders for managers', async () => {
    (orderService.voidOrder as jest.MockedFunction<typeof orderService.voidOrder>).mockResolvedValueOnce({
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
    (orderService.voidOrder as jest.MockedFunction<typeof orderService.voidOrder>).mockResolvedValueOnce({
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
    expect(orderService.voidOrder).toHaveBeenCalledWith(
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
    expect(orderService.voidOrder).not.toHaveBeenCalled();
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
});
