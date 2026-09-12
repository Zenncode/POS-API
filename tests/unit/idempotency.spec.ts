import { conflict } from '../../app/common/errors';
import {
  beginIdempotency,
  extractIdempotencyKey,
  newIdempotencyKey,
  releaseIdempotency,
  storeIdempotentResponse,
} from '../../app/services/idempotency.service';

jest.mock('../../config/redis.client', () => ({
  getRedisClient: () => mockGetRedisClient(),
}));

jest.mock('../../config/env', () => ({
  getEnv: () => ({ IDEMPOTENCY_TTL_SECONDS: 86400 }),
}));

const mockGetRedisClient = jest.fn();

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
};

describe('idempotency.service', () => {
  beforeEach(() => {
    mockRedis.get.mockReset();
    mockRedis.set.mockReset();
    mockRedis.del.mockReset();
    mockGetRedisClient.mockReset();
    mockGetRedisClient.mockReturnValue(mockRedis);
  });

  describe('beginIdempotency', () => {
    it('claims when redis is unavailable', async () => {
      mockGetRedisClient.mockReturnValue(null);

      const outcome = await beginIdempotency<{ ok: true }>('test-key-123');

      expect(outcome).toEqual({ kind: 'claim' });
    });

    it('replays a stored response', async () => {
      mockRedis.get.mockResolvedValueOnce(JSON.stringify({ order: { id: 'o1' } }));

      const outcome = await beginIdempotency<{ order: { id: string } }>('key-aaaaaaaa');

      expect(outcome).toEqual({ kind: 'replay', response: { order: { id: 'o1' } } });
      expect(mockRedis.get).toHaveBeenCalledWith('idem:key-aaaaaaaa:response');
    });

    it('claims the key when NX succeeds', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockRedis.set.mockResolvedValueOnce('OK');

      const outcome = await beginIdempotency('key-aaaaaaaa');

      expect(outcome).toEqual({ kind: 'claim' });
      expect(mockRedis.set).toHaveBeenCalledWith('idem:key-aaaaaaaa', 'in-flight', { EX: 86400, NX: true });
    });

    it('reports in-flight when another request holds the claim', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockRedis.set.mockResolvedValueOnce(null);
      mockRedis.get.mockResolvedValueOnce(null);

      const outcome = await beginIdempotency('key-aaaaaaaa');

      expect(outcome).toEqual({ kind: 'in-flight' });
    });

    it('falls back to claim on redis errors', async () => {
      mockRedis.get.mockRejectedValueOnce(new Error('boom'));

      const outcome = await beginIdempotency('key-aaaaaaaa');

      expect(outcome).toEqual({ kind: 'claim' });
    });
  });

  describe('storeIdempotentResponse', () => {
    it('stores the response with the configured ttl', async () => {
      await storeIdempotentResponse('key-aaaaaaaa', { ok: true });

      expect(mockRedis.set).toHaveBeenCalledWith('idem:key-aaaaaaaa:response', JSON.stringify({ ok: true }), {
        EX: 86400,
      });
    });
  });

  describe('releaseIdempotency', () => {
    it('deletes the claim key only', async () => {
      await releaseIdempotency('key-aaaaaaaa');

      expect(mockRedis.del).toHaveBeenCalledWith('idem:key-aaaaaaaa');
      expect(mockRedis.del).not.toHaveBeenCalledWith('idem:key-aaaaaaaa:response');
    });
  });

  describe('extractIdempotencyKey', () => {
    it('returns null when header missing', () => {
      expect(extractIdempotencyKey(undefined)).toBeNull();
      expect(extractIdempotencyKey('   ')).toBeNull();
    });

    it('accepts array headers', () => {
      expect(extractIdempotencyKey(['key-aaaaaaaa'])).toBe('key-aaaaaaaa');
    });

    it('throws conflict for keys outside 8..128 chars', () => {
      expect(() => extractIdempotencyKey('short')).toThrow(conflict('', 'INVALID_IDEMPOTENCY_KEY').constructor);
      expect(() => extractIdempotencyKey('x'.repeat(129))).toThrow();
    });

    it('trims valid keys', () => {
      expect(extractIdempotencyKey('  key-aaaaaaaa  ')).toBe('key-aaaaaaaa');
    });
  });

  it('generates uuid keys', () => {
    expect(newIdempotencyKey()).toMatch(/^[0-9a-f-]{36}$/);
  });
});
