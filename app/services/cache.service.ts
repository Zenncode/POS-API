import { getRedisClient } from '../../config/redis.client';

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function getDefaultTtlSeconds(): number {
  return parsePositiveNumber(process.env.REDIS_CACHE_TTL_SECONDS, 30);
}

export async function getCache<T>(key: string): Promise<T | null> {
  const redis = getRedisClient();
  if (!redis) {
    return null;
  }

  try {
    const cached = await redis.get(key);
    if (!cached) {
      return null;
    }

    return JSON.parse(cached) as T;
  } catch {
    return null;
  }
}

export async function setCache<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    return;
  }

  const defaultTtlSeconds = getDefaultTtlSeconds();
  const ttl = typeof ttlSeconds === 'number' && ttlSeconds > 0 ? ttlSeconds : defaultTtlSeconds;

  try {
    await redis.set(key, JSON.stringify(value), { EX: ttl });
  } catch {
    return;
  }
}
