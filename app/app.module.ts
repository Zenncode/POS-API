import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { authRouter } from './routes/auth.module';
import { categoryRouter } from './routes/category.module';
import { customerRouter } from './routes/customer.module';
import { helloRouter } from './routes/hello.module';
import { orderRouter } from './routes/order.module';
import { productRouter } from './routes/product.module';
import { reportRouter } from './routes/report.module';
import { shiftRouter } from './routes/shift.module';
import { userRouter } from './routes/user.module';
import { getEnv } from '../config/env';
import { getPrismaClient } from '../config/prisma.client';
import { getRedisClient } from '../config/redis.client';
import { getCache, setCache } from './services/cache.service';
import { AppError } from './common/errors';

type HealthStatus = 'ok' | 'degraded';
type DependencyStatus = 'up' | 'down' | 'disabled' | 'enabled';

type HealthResponse = {
  status: HealthStatus;
  database: DependencyStatus;
  cache: DependencyStatus;
  queue: DependencyStatus;
  generatedAt: string;
};

async function checkDatabase(): Promise<DependencyStatus> {
  try {
    await getPrismaClient().$queryRaw`SELECT 1`;
    return 'up';
  } catch {
    return 'down';
  }
}

function checkCache(): DependencyStatus {
  const redis = getRedisClient();
  if (!redis) {
    return 'disabled';
  }

  try {
    void redis.ping();
    return 'up';
  } catch {
    return 'down';
  }
}

export function createApp(): express.Express {
  const env = getEnv();
  const app = express();

  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser(env.COOKIE_SECRET));

  const corsOrigin = env.CORS_ORIGIN;
  const allowedOrigins = corsOrigin ? corsOrigin.split(',').map((value) => value.trim()) : ['*'];

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Override-Token'],
    }),
  );

  app.use(
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      max: env.RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
      message: { message: 'Too many requests, please try again later' },
    }),
  );

  app.get('/', (_req, res) => {
    const socketPath = env.SOCKET_PATH?.trim() || '/socket.io';
    const normalizedSocketPath = socketPath.startsWith('/') ? socketPath : `/${socketPath}`;

    res.status(200).json({
      message: 'ZENNTECHINC POS API is running',
      health: '/api/health',
      socket: normalizedSocketPath,
    });
  });

  app.get('/api/health', async (_req, res) => {
    const healthCacheKey = 'api:health';

    const cachedHealth = await getCache<HealthResponse>(healthCacheKey);
    if (cachedHealth) {
      res.status(200).json(cachedHealth);
      return;
    }

    const database = await checkDatabase();
    const cache = checkCache();
    const queue: DependencyStatus = env.QUEUE_ENABLED ? 'enabled' : 'disabled';

    const payload: HealthResponse = {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      cache,
      queue,
      generatedAt: new Date().toISOString(),
    };

    await setCache(healthCacheKey, payload, env.REDIS_HEALTH_TTL_SECONDS);
    res.status(200).json(payload);
  });

  app.use('/api/auth', authRouter);
  app.use('/api/hello', helloRouter);
  app.use('/api/products', productRouter);
  app.use('/api/categories', categoryRouter);
  app.use('/api/customers', customerRouter);
  app.use('/api/orders', orderRouter);
  app.use('/api/shifts', shiftRouter);
  app.use('/api/users', userRouter);
  app.use('/api/reports', reportRouter);

  app.use((_req, res) => {
    res.status(404).json({ message: 'Route not found' });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ZodError) {
      res.status(400).json({
        message: 'Validation failed',
        issues: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
      return;
    }

    if (error instanceof AppError) {
      res.status(error.status).json({ message: error.message, code: error.code });
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Unhandled error: ${message}\n`);

    res.status(500).json({ message: 'Internal server error' });
  });

  return app;
}