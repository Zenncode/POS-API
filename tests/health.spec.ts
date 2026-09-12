import request from 'supertest';

process.env.JWT_SECRET = 'test-access-secret-health';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-health';
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:5432/test';
process.env.REDIS_ENABLED = 'false';
process.env.QUEUE_ENABLED = 'true';

jest.mock('../app/services/cache.service', () => ({
  __esModule: true,
  getCache: jest.fn(),
  setCache: jest.fn(),
  delCache: jest.fn(),
  delCacheByPrefix: jest.fn(),
  withCache: jest.fn(),
}));

jest.mock('../config/prisma.client', () => ({
  __esModule: true,
  getPrismaClient: () => ({
    $queryRaw: jest.fn(async () => []),
    $transaction: jest.fn(),
  }),
  connectDatabase: jest.fn(async () => true),
  disconnectDatabase: jest.fn(async () => undefined),
}));

jest.mock('../config/redis.client', () => ({
  __esModule: true,
  getRedisClient: () => null,
  connectRedis: jest.fn(async () => undefined),
  disconnectRedis: jest.fn(async () => undefined),
  publishPosEvent: jest.fn(async () => undefined),
  getSubscriberClient: jest.fn(async () => null),
  POS_EVENTS_CHANNEL: 'pos:events',
}));

import { createApp } from '../app/app.module';
import * as cacheService from '../app/services/cache.service';

const getCacheMock = cacheService.getCache as jest.MockedFunction<typeof cacheService.getCache>;
const setCacheMock = cacheService.setCache as jest.MockedFunction<typeof cacheService.setCache>;

describe('Health Route', () => {
  const app = createApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('GET /api/health returns cached payload when available', async () => {
    getCacheMock.mockResolvedValue({
      status: 'ok',
      database: 'up',
      cache: 'disabled',
      queue: 'enabled',
      generatedAt: '2026-04-20T00:00:00.000Z',
    });

    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ok',
      database: 'up',
      cache: 'disabled',
      queue: 'enabled',
      generatedAt: '2026-04-20T00:00:00.000Z',
    });
    expect(setCacheMock).not.toHaveBeenCalled();
  });

  it('GET /api/health reports database up, cache disabled, queue enabled on miss', async () => {
    getCacheMock.mockResolvedValue(null);
    setCacheMock.mockResolvedValue(undefined);

    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ok',
      database: 'up',
      cache: 'disabled',
      queue: 'enabled',
      generatedAt: expect.any(String),
    });

    expect(setCacheMock).toHaveBeenCalledWith(
      'api:health',
      expect.objectContaining({ status: 'ok', database: 'up' }),
      15,
    );
  });
});
