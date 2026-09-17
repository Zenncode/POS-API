import { z } from 'zod';

const booleanish = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined ? fallback : value.toLowerCase() !== 'false'));

const positiveInt = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: positiveInt(3000),
  PORT_AUTO_FALLBACK: booleanish(true),
  PORT_FALLBACK_ATTEMPTS: positiveInt(10),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (postgresql://...'),

  REDIS_ENABLED: booleanish(true),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  REDIS_CONNECT_TIMEOUT_MS: positiveInt(2000),
  REDIS_CACHE_TTL_SECONDS: positiveInt(30),
  REDIS_HEALTH_TTL_SECONDS: positiveInt(15),
  IDEMPOTENCY_TTL_SECONDS: positiveInt(86400),

  QUEUE_ENABLED: booleanish(true),

  JWT_SECRET: z.string().min(1).default('fallback-secret'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string().min(1).default('fallback-refresh-secret'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  OVERRIDE_TOKEN_EXPIRES_IN: z.string().default('5m'),
  BCRYPT_SALT_ROUNDS: positiveInt(12),

  COOKIE_SECRET: z.string().min(1).default('fallback-cookie-secret'),

  DISCOUNT_OVERRIDE_CENTS: z
    .string()
    .optional()
    .transform((value) => {
      const parsed = value ? Number(value) : 0;
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    }),

  CORS_ORIGIN: z.string().optional(),
  RATE_LIMIT_WINDOW_MS: positiveInt(15 * 60 * 1000),
  RATE_LIMIT_MAX: positiveInt(100),

  SOCKET_PATH: z.string().optional(),
  SOCKET_CORS_ORIGIN: z.string().optional(),
  SOCKET_AUTH_REQUIRED: booleanish(true),

  ADMIN_SEED_EMAIL: z.string().optional(),
  ADMIN_SEED_PASSWORD: z.string().optional(),

  LOW_STOCK_THRESHOLD: positiveInt(5),

  MINIO_ENDPOINT: z.string().default('127.0.0.1'),
  MINIO_PORT: positiveInt(9000),
  MINIO_ACCESS_KEY: z.string().default('minioadmin'),
  MINIO_SECRET_KEY: z.string().default('minioadmin'),
  MINIO_BUCKET: z.string().default('pos-assets'),
  MINIO_USE_SSL: booleanish(false),

  // Email (SMTP)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: positiveInt(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  SMTP_SECURE: booleanish(false),

  // SMS (Twilio compatible)
  SMS_PROVIDER: z.enum(['twilio', 'vonage', 'mock']).default('mock'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  VONAGE_API_KEY: z.string().optional(),
  VONAGE_API_SECRET: z.string().optional(),
  VONAGE_FROM_NUMBER: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }

  const env = parsed.data;

  if (env.NODE_ENV === 'production') {
    if (env.JWT_SECRET === 'fallback-secret' || env.JWT_REFRESH_SECRET === 'fallback-refresh-secret') {
      throw new Error('Refusing to start in production with default JWT secrets. Set JWT_SECRET and JWT_REFRESH_SECRET.');
    }
    if (!env.ADMIN_SEED_EMAIL || !env.ADMIN_SEED_PASSWORD) {
      process.stderr.write('Warning: ADMIN_SEED_EMAIL/ADMIN_SEED_PASSWORD not set; no first admin will be seeded.\n');
    }
  }

  return env;
}

let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (!cachedEnv) {
    cachedEnv = loadEnv();
  }

  return cachedEnv;
}
