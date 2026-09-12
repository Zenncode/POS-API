import { getRedisClient } from '../../config/redis.client';
import { getEnv } from '../../config/env';

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

  const ttl = typeof ttlSeconds === 'number' && ttlSeconds > 0 ? ttlSeconds : getEnv().REDIS_CACHE_TTL_SECONDS;

  try {
    await redis.set(key, JSON.stringify(value), { EX: ttl });
  } catch {
    return;
  }
}

export async function delCache(key: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    return;
  }

  try {
    await redis.del(key);
  } catch {
    return;
  }
}

export async function delCacheByPrefix(prefix: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    return;
  }

  try {
    for await (const key of redis.scanIterator({ MATCH: `${prefix}*`, COUNT: 100 })) {
      await redis.del(key);
    }
  } catch {
    return;
  }
}

export async function withCache<T>(key: string, ttlSeconds: number, producer: () => Promise<T>): Promise<T> {
  const cached = await getCache<T>(key);
  if (cached !== null) {
    return cached;
  }

  const fresh = await producer();
  await setCache(key, fresh, ttlSeconds);
  return fresh;
}
