import { getRedisClient } from '../../config/redis.client';
import { getEnv } from '../../config/env';

const RESERVATION_TTL_SECONDS = 300; // 5 minutes
const RESERVATION_KEY_PREFIX = 'pos:stock:reserve:';

interface ReservationResult {
  success: boolean;
  reserved?: number;
  error?: string;
  expiresAt?: Date;
}

interface ReleaseResult {
  success: boolean;
  released?: number;
  error?: string;
}

function buildKey(productId: string, saleId: string): string {
  return `${RESERVATION_KEY_PREFIX}${productId}:${saleId}`;
}

export async function reserveStock(
  productId: string,
  quantity: number,
  saleId: string,
  ttlSeconds = RESERVATION_TTL_SECONDS,
): Promise<ReservationResult> {
  const client = getRedisClient();
  const env = getEnv();

  if (!client || !env.REDIS_ENABLED) {
    // Redis not available - reservation not enforced
    return { success: true, reserved: quantity, error: 'Redis unavailable - soft reservation skipped' };
  }

  if (quantity <= 0) {
    return { success: false, error: 'Quantity must be positive' };
  }

  const key = buildKey(productId, saleId);

  try {
    // Use Lua script for atomic check-and-set with TTL
    const luaScript = `
      local current = redis.call('GET', KEYS[1])
      local qty = tonumber(ARGV[1])
      local ttl = tonumber(ARGV[2])
      
      if current then
        local newQty = tonumber(current) + qty
        redis.call('SET', KEYS[1], newQty, 'EX', ttl)
        return newQty
      else
        redis.call('SET', KEYS[1], qty, 'EX', ttl)
        return qty
      end
    `;

    const reservedQty = await client.eval(luaScript, {
      keys: [key],
      arguments: [quantity.toString(), ttlSeconds.toString()],
    });

    return {
      success: true,
      reserved: Number(reservedQty),
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown reservation error';
    return { success: false, error: message };
  }
}

export async function releaseStock(
  productId: string,
  quantity: number,
  saleId: string,
): Promise<ReleaseResult> {
  const client = getRedisClient();
  const env = getEnv();

  if (!client || !env.REDIS_ENABLED) {
    return { success: true, released: quantity, error: 'Redis unavailable - soft reservation skipped' };
  }

  if (quantity <= 0) {
    return { success: false, error: 'Quantity must be positive' };
  }

  const key = buildKey(productId, saleId);

  try {
    const luaScript = `
      local current = redis.call('GET', KEYS[1])
      if not current then
        return 0
      end
      
      local newQty = tonumber(current) - tonumber(ARGV[1])
      if newQty <= 0 then
        redis.call('DEL', KEYS[1])
        return 0
      else
        redis.call('SET', KEYS[1], newQty, 'KEETTL')
        return newQty
      end
    `;

    const remaining = await client.eval(luaScript, {
      keys: [key],
      arguments: [quantity.toString()],
    });

    return { success: true, released: quantity, error: Number(remaining) === 0 ? 'Reservation fully released' : undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown release error';
    return { success: false, error: message };
  }
}

export async function getReservation(productId: string, saleId: string): Promise<number> {
  const client = getRedisClient();
  const env = getEnv();

  if (!client || !env.REDIS_ENABLED) {
    return 0;
  }

  const key = buildKey(productId, saleId);

  try {
    const value = await client.get(key);
    return value ? parseInt(value, 10) : 0;
  } catch {
    return 0;
  }
}

export async function extendReservation(productId: string, saleId: string, ttlSeconds = RESERVATION_TTL_SECONDS): Promise<boolean> {
  const client = getRedisClient();
  const env = getEnv();

  if (!client || !env.REDIS_ENABLED) {
    return false;
  }

  const key = buildKey(productId, saleId);

  try {
    const result = await client.expire(key, ttlSeconds);
    return result;
  } catch {
    return false;
  }
}

export async function releaseAllReservations(saleId: string): Promise<void> {
  const client = getRedisClient();
  const env = getEnv();

  if (!client || !env.REDIS_ENABLED) {
    return;
  }

  try {
    const pattern = `${RESERVATION_KEY_PREFIX}*:${saleId}`;
    let cursor = 0;
    do {
      const result = await client.scan(cursor, { MATCH: pattern, COUNT: 100 });
      cursor = result.cursor;
      if (result.keys.length > 0) {
        await client.del(result.keys);
      }
    } while (cursor !== 0);
  } catch (error) {
    process.stderr.write(`Failed to release all reservations for sale ${saleId}: ${String(error)}\n`);
  }
}