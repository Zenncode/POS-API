import { createClient, RedisClientType } from 'redis';

const globalForRedis = globalThis as unknown as { redis?: RedisClientType };

export function getRedisHelper(): RedisClientType {
  if (!globalForRedis.redis) {
    const url = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
    globalForRedis.redis = createClient({ url });
    globalForRedis.redis.on('error', (err) => console.error('[Redis]', err));
    await globalForRedis.redis.connect();
  }
  return globalForRedis.redis;
}

export async function disconnectRedis(): Promise<void> {
  await globalForRedis.redis?.quit();
  globalForRedis.redis = undefined;
}