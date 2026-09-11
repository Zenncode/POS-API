import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import request from 'supertest';

jest.mock('../app/services/cache.service', () => ({
  __esModule: true,
  getCache: jest.fn(),
  setCache: jest.fn(),
}));

import { createApp } from '../app/app.module';
import * as cacheService from '../app/services/cache.service';

const getCacheMock = cacheService.getCache as jest.MockedFunction<typeof cacheService.getCache>;
const setCacheMock = cacheService.setCache as jest.MockedFunction<typeof cacheService.setCache>;

describe('Health Route', () => {
  const app = createApp();

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.REDIS_HEALTH_TTL_SECONDS;
  });

  it('GET /api/health returns cached payload when available', async () => {
    getCacheMock.mockResolvedValue({
      status: 'ok',
      generatedAt: '2026-04-20T00:00:00.000Z',
    });

    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ok',
      generatedAt: '2026-04-20T00:00:00.000Z',
    });
    expect(setCacheMock).not.toHaveBeenCalled();
  });

  it('GET /api/health creates and stores payload on cache miss', async () => {
    getCacheMock.mockResolvedValue(null);
    setCacheMock.mockResolvedValue(undefined);
    process.env.REDIS_HEALTH_TTL_SECONDS = '10';

    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(Number.isNaN(Date.parse(response.body.generatedAt))).toBe(false);

    expect(setCacheMock).toHaveBeenCalledWith(
      'api:health',
      expect.objectContaining({
        status: 'ok',
        generatedAt: expect.any(String),
      }),
      10,
    );
  });
});
