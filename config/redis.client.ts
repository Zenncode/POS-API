import { createClient } from 'redis';

type RedisClient = ReturnType<typeof createClient>;

let redisClient: RedisClient | null = null;

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function isRedisEnabled(): boolean {
  return (process.env.REDIS_ENABLED ?? 'true').toLowerCase() !== 'false';
}

export async function connectRedis(): Promise<void> {
  if (!isRedisEnabled()) {
    return;
  }

  if (redisClient?.isOpen) {
    return;
  }

  const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
  const connectTimeout = parsePositiveNumber(process.env.REDIS_CONNECT_TIMEOUT_MS, 2000);

  const client = createClient({
    url: redisUrl,
    socket: {
      connectTimeout,
      reconnectStrategy: () => false,
    },
  });

  const suppressConnectErrors = () => undefined;
  client.on('error', suppressConnectErrors);

  try {
    await client.connect();
    client.off('error', suppressConnectErrors);
    client.on('error', (error: unknown) => {
      process.stderr.write(`Redis error: ${String(error)}\n`);
    });

    redisClient = client;
  } catch (error) {
    client.off('error', suppressConnectErrors);
    process.stderr.write(`Redis unavailable, continuing without cache: ${String(error)}\n`);

    if (client.isOpen) {
      await client.quit();
    }

    redisClient = null;
  }
}

export function getRedisClient(): RedisClient | null {
  if (!redisClient || !redisClient.isOpen) {
    return null;
  }

  return redisClient;
}

export async function disconnectRedis(): Promise<void> {
  if (!redisClient) {
    return;
  }

  try {
    if (redisClient.isOpen) {
      await redisClient.quit();
    }
  } catch (error) {
    process.stderr.write(`Failed to close Redis connection: ${String(error)}\n`);
  } finally {
    redisClient = null;
  }
}
