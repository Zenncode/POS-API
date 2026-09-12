import { randomUUID } from 'crypto';
import { getRedisClient } from '../../config/redis.client';
import { getEnv } from '../../config/env';
import { conflict } from '../common/errors';

export type IdempotencyOutcome<T> =
  | { kind: 'claim' }
  | { kind: 'replay'; response: T }
  | { kind: 'in-flight' };

const RESPONSE_SUFFIX = ':response';

export async function beginIdempotency<T>(key: string): Promise<IdempotencyOutcome<T>> {
  const redis = getRedisClient();
  if (!redis) {
    return { kind: 'claim' };
  }

  const claimKey = `idem:${key}`;
  const responseKey = `${claimKey}${RESPONSE_SUFFIX}`;
  const ttl = getEnv().IDEMPOTENCY_TTL_SECONDS;

  try {
    const storedResponse = await redis.get(responseKey);
    if (storedResponse) {
      return { kind: 'replay', response: JSON.parse(storedResponse) as T };
    }

    const claimed = await redis.set(claimKey, 'in-flight', { EX: ttl, NX: true });
    if (!claimed) {
      const pendingResponse = await redis.get(responseKey);
      if (pendingResponse) {
        return { kind: 'replay', response: JSON.parse(pendingResponse) as T };
      }

      return { kind: 'in-flight' };
    }

    return { kind: 'claim' };
  } catch {
    return { kind: 'claim' };
  }
}

export async function storeIdempotentResponse<T>(key: string, response: T): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    return;
  }

  try {
    const ttl = getEnv().IDEMPOTENCY_TTL_SECONDS;
    await redis.set(`idem:${key}${RESPONSE_SUFFIX}`, JSON.stringify(response), { EX: ttl });
  } catch {
    return;
  }
}

export async function releaseIdempotency(key: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    return;
  }

  try {
    await redis.del(`idem:${key}`);
  } catch {
    return;
  }
}

export function extractIdempotencyKey(headerValue: string | string[] | undefined): string | null {
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const trimmed = raw?.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.length < 8 || trimmed.length > 128) {
    throw conflict('Idempotency-Key must be between 8 and 128 characters', 'INVALID_IDEMPOTENCY_KEY');
  }

  return trimmed;
}

export function newIdempotencyKey(): string {
  return randomUUID();
}
