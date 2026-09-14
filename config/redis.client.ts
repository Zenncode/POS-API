import { createClient } from 'redis';
import { getEnv } from './env';

type RedisClient = ReturnType<typeof createClient>;

let redisClient: RedisClient | null = null;
let subscriberClient: RedisClient | null = null;

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

async function createConnectedClient(): Promise<RedisClient> {
  const env = getEnv();
  const connectTimeout = parsePositiveNumber(process.env.REDIS_CONNECT_TIMEOUT_MS, env.REDIS_CONNECT_TIMEOUT_MS);

  const client = createClient({
    url: env.REDIS_URL,
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

    return client;
  } catch (error) {
    client.off('error', suppressConnectErrors);
    throw error;
  }
}

export async function connectRedis(): Promise<void> {
  if (!isRedisEnabled()) {
    return;
  }

  if (redisClient?.isOpen) {
    return;
  }

  try {
    redisClient = await createConnectedClient();
  } catch (error) {
    process.stderr.write(`Redis unavailable, continuing without cache: ${String(error)}\n`);

    if (redisClient?.isOpen) {
      await redisClient.quit();
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

export async function getSubscriberClient(): Promise<RedisClient | null> {
  const main = getRedisClient();
  if (!main) {
    return null;
  }

  if (subscriberClient?.isOpen) {
    return subscriberClient;
  }

  try {
    subscriberClient = await createConnectedClient();
    return subscriberClient;
  } catch (error) {
    process.stderr.write(`Redis subscriber unavailable: ${String(error)}\n`);
    return null;
  }
}

export type PosEventPayload = {
  type: 'stock:low' | 'order:created' | 'order:voided' | 'order:refunded' | 'report:daily' | 'report:daily:completed';
  data: unknown;
};

export const POS_EVENTS_CHANNEL = 'pos:events';

export async function publishPosEvent(payload: PosEventPayload): Promise<void> {
  const client = getRedisClient();
  if (!client) {
    return;
  }

  try {
    await client.publish(POS_EVENTS_CHANNEL, JSON.stringify(payload));
  } catch (error) {
    process.stderr.write(`Failed to publish pos event: ${String(error)}\n`);
  }
}

export async function disconnectRedis(): Promise<void> {
  for (const client of [subscriberClient, redisClient]) {
    if (!client) {
      continue;
    }

    try {
      if (client.isOpen) {
        await client.quit();
      }
    } catch (error) {
      process.stderr.write(`Failed to close Redis connection: ${String(error)}\n`);
    }
  }

  subscriberClient = null;
  redisClient = null;
}
