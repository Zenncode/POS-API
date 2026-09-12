import { getRedisClient } from '../../config/redis.client';

const MAX_ATTEMPTS = 5;
const LOCKOUT_TTL_SECONDS = 15 * 60; // 15 minutes
const ATTEMPT_TTL_SECONDS = 15 * 60;

function attemptKey(email: string, ip: string): string {
  return `login:attempts:${email.toLowerCase()}:${ip}`;
}

function lockoutKey(email: string, ip: string): string {
  return `login:lockout:${email.toLowerCase()}:${ip}`;
}

export async function recordFailedLogin(email: string, ip: string): Promise<{ locked: boolean; attemptsLeft: number }> {
  const redis = getRedisClient();
  if (!redis) return { locked: false, attemptsLeft: MAX_ATTEMPTS };

  const key = attemptKey(email, ip);
  const lockKey = lockoutKey(email, ip);

  const isLocked = await redis.exists(lockKey);
  if (isLocked) {
    await redis.ttl(lockKey);
    return { locked: true, attemptsLeft: 0 };
  }

  const attempts = await redis.incr(key);
  if (attempts === 1) {
    await redis.expire(key, ATTEMPT_TTL_SECONDS);
  }

  if (attempts >= MAX_ATTEMPTS) {
    await redis.setEx(lockKey, LOCKOUT_TTL_SECONDS, '1');
    await redis.del(key);
    return { locked: true, attemptsLeft: 0 };
  }

  return { locked: false, attemptsLeft: MAX_ATTEMPTS - attempts };
}

export async function clearFailedLogins(email: string, ip: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  await redis.del(attemptKey(email, ip));
  await redis.del(lockoutKey(email, ip));
}

export async function isLockedOut(email: string, ip: string): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return false;
  return (await redis.exists(lockoutKey(email, ip))) === 1;
}