import { Server, createServer } from 'http';
import { loadEnvFile } from '../config/loadEnv';
import { getEnv } from '../config/env';
import { connectDatabase, disconnectDatabase } from '../config/prisma.client';
import { connectRedis, disconnectRedis } from '../config/redis.client';
import { closeQueue } from '../config/queues';
import { createApp } from './app.module';
import { seedStaffFromEnv } from './services/auth.service';
import { closeSocketServer, initializeSocketServer } from '../socket/socket.server';

let httpServer: Server | null = null;

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function isPortAutoFallbackEnabled(): boolean {
  return (process.env.PORT_AUTO_FALLBACK ?? 'true').toLowerCase() !== 'false';
}

async function connectDatabaseOrFail(): Promise<void> {
  try {
    await connectDatabase();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      [
        `Cannot connect to PostgreSQL (${getEnv().DATABASE_URL}).`,
        'Start the database first, or fix DATABASE_URL in .env:',
        '  - Docker (from project folder): docker compose up -d postgres',
        '  - Then apply the schema: npm run db:push && npm run db:seed',
        `Original error: ${message}`,
      ].join('\n'),
    );
  }
}

async function seedInitialStaff(): Promise<void> {
  try {
    await seedStaffFromEnv();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Warning: staff seed failed — ${message}\n`);
  }
}

async function bindServerWithFallback(app: ReturnType<typeof createApp>, preferredPort: number): Promise<number> {
  const fallbackAttempts = parsePositiveNumber(process.env.PORT_FALLBACK_ATTEMPTS, 10);
  const autoFallbackEnabled = isPortAutoFallbackEnabled();
  let port = Number.isFinite(preferredPort) && preferredPort > 0 ? preferredPort : 3000;

  for (let attempt = 0; attempt <= fallbackAttempts; attempt += 1) {
try {
      httpServer = createServer(app);
      initializeSocketServer(httpServer);

      await new Promise<void>((resolve, reject) => {
        if (!httpServer) {
          reject(new Error('HTTP server not initialized'));
          return;
        }

        const onListening = () => {
          httpServer?.off('error', onError);
          resolve();
        };

        const onError = (error: NodeJS.ErrnoException) => {
          httpServer?.off('listening', onListening);
          reject(error);
        };

        httpServer.once('listening', onListening);
        httpServer.once('error', onError);
        httpServer.listen(port);
      });

      return port;
    } catch (error) {
      if (httpServer) {
        await new Promise<void>((resolve) => {
          httpServer?.close(() => resolve());
        });
        httpServer = null;
      }
      await closeSocketServer();

      const err = error as NodeJS.ErrnoException;

      if (err.code === 'EADDRINUSE' && autoFallbackEnabled && attempt < fallbackAttempts) {
        const nextPort = port + 1;
        process.stderr.write(`Port ${port} is in use, trying ${nextPort}\n`);
        port = nextPort;
        continue;
      }

      throw error;
    }
  }

  throw new Error('Unable to bind HTTP server to any configured fallback ports');
}

async function closeHttpServer(): Promise<void> {
  if (!httpServer) {
    return;
  }

  await new Promise<void>((resolve) => {
    httpServer?.close(() => resolve());
  });

  httpServer = null;
}

async function bootstrap() {
  loadEnvFile();

  const env = getEnv();
  await connectDatabaseOrFail();
  await connectRedis();
  await seedInitialStaff();

  const app = createApp();
  const preferredPort = env.PORT;
  const activePort = await bindServerWithFallback(app, preferredPort);
  process.stdout.write(`Server running on http://localhost:${activePort}\n`);
}

async function shutdown(signal: string) {
  process.stdout.write(`${signal} received, shutting down...\n`);
  await Promise.allSettled([
    closeSocketServer(),
    closeHttpServer(),
    closeQueue(),
    disconnectDatabase(),
    disconnectRedis(),
  ]);
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

void bootstrap().catch(async (error: unknown) => {
  await Promise.allSettled([
    closeSocketServer(),
    closeHttpServer(),
    closeQueue(),
    disconnectDatabase(),
    disconnectRedis(),
  ]);
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Failed to start server:\n${message}\n`);
  process.exit(1);
});
