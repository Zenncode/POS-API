import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { authRouter } from './routes/auth.module';
import { getCache, setCache } from './services/cache.service';

type HealthResponse = {
  status: 'ok';
  generatedAt: string;
};

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(express.json());

  const corsOrigin = process.env.CORS_ORIGIN;
  const allowedOrigins = corsOrigin
    ? corsOrigin.split(',').map((value) => value.trim())
    : ['*'];

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
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  );

  const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000;
  const max = Number(process.env.RATE_LIMIT_MAX) || 100;

  app.use(
    rateLimit({
      windowMs,
      max,
      standardHeaders: true,
      legacyHeaders: false,
      message: { message: 'Too many requests, please try again later' },
    }),
  );

  app.get('/', (_req, res) => {
    const socketPath = process.env.SOCKET_PATH?.trim() || '/socket.io';
    const normalizedSocketPath = socketPath.startsWith('/') ? socketPath : `/${socketPath}`;

    res.status(200).json({
      message: 'ZENNTECHINC Backend API is running',
      health: '/api/health',
      socket: normalizedSocketPath,
    });
  });

  app.get('/api/health', async (_req, res) => {
    const healthCacheKey = 'api:health';
    const healthTtlSeconds = Number(process.env.REDIS_HEALTH_TTL_SECONDS ?? '15');
    const cachedHealth = await getCache<HealthResponse>(healthCacheKey);

    if (cachedHealth) {
      res.status(200).json(cachedHealth);
      return;
    }

    const payload: HealthResponse = {
      status: 'ok',
      generatedAt: new Date().toISOString(),
    };

    await setCache(healthCacheKey, payload, healthTtlSeconds);
    res.status(200).json(payload);
  });

  app.use('/api/auth', authRouter);

  app.use((_req, res) => {
    res.status(404).json({ message: 'Route not found' });
  });

  return app;
}
