import fs from 'fs';
import { Server, createServer } from 'http';
import path from 'path';
import mongoose from 'mongoose';
import { createApp } from './app.module';
import { connectRedis, disconnectRedis } from '../config/redis.client';
import { seedAdminFromEnv } from './services/auth.service';
import { closeSocketServer, initializeSocketServer } from '../socket/socket.server';

let httpServer: Server | null = null;

function normalizeEnvValue(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (trimmed.length < 2) {
    return trimmed;
  }

  const startsWithDoubleQuote = trimmed.startsWith('"') && trimmed.endsWith('"');
  const startsWithSingleQuote = trimmed.startsWith("'") && trimmed.endsWith("'");

  if (startsWithDoubleQuote) {
    return trimmed.slice(1, -1).replace(/\\n/g, '\n').replace(/\\r/g, '\r');
  }

  if (startsWithSingleQuote) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function loadEnvFile() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, 'utf-8');
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = normalizeEnvValue(line.slice(separatorIndex + 1));

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function maskMongoUri(uri: string): string {
  try {
    const parsedUri = new URL(uri);
    if (parsedUri.password) {
      parsedUri.password = '***';
    }
    return parsedUri.toString();
  } catch {
    return uri;
  }
}

function formatMongoConnectionError(error: unknown, mongoUri: string): string {
  const message = error instanceof Error ? error.message : String(error);
  const maskedUri = maskMongoUri(mongoUri);
  const isConnectivityError = /ECONNREFUSED/i.test(message) || /MongooseServerSelectionError/i.test(message);

  if (!isConnectivityError) {
    return `MongoDB connection failed (${maskedUri}): ${message}`;
  }

  return [
    `Cannot connect to MongoDB at ${maskedUri}`,
    'Start MongoDB first, or set MONGODB_URI in .env to a reachable instance.',
    'Examples:',
    '  - Local MongoDB: mongod',
    '  - Docker (from project folder): docker compose up -d mongo',
    '  - MongoDB Atlas: MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/<db>',
    `Original error: ${message}`,
  ].join('\n');
}

function isMongoRequired(): boolean {
  return (process.env.MONGODB_REQUIRED ?? 'false').toLowerCase() === 'true';
}

async function connectMongoIfAvailable(): Promise<void> {
  const mongoUri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/zenntechinc';
  const connectTimeoutMs = parsePositiveNumber(process.env.MONGODB_CONNECT_TIMEOUT_MS, 5000);

  try {
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: connectTimeoutMs,
    });
  } catch (error) {
    const formattedError = formatMongoConnectionError(error, mongoUri);
    if (isMongoRequired()) {
      throw new Error(formattedError);
    }

    process.stderr.write(`${formattedError}\n`);
    process.stderr.write(
      'MongoDB unavailable, continuing in sample mode. Set MONGODB_REQUIRED=true to fail startup.\n',
    );
  }
}

function isPortAutoFallbackEnabled(): boolean {
  return (process.env.PORT_AUTO_FALLBACK ?? 'true').toLowerCase() !== 'false';
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

  await connectMongoIfAvailable();
  await connectRedis();

  await seedAdminFromEnv();

  const app = createApp();
  const preferredPort = Number(process.env.PORT ?? '3000');
  const activePort = await bindServerWithFallback(app, preferredPort);
  process.stdout.write(`Server running on http://localhost:${activePort}\n`);
}

async function shutdown(signal: string) {
  process.stdout.write(`${signal} received, shutting down...\n`);
  await Promise.allSettled([closeSocketServer(), closeHttpServer(), mongoose.disconnect(), disconnectRedis()]);
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

void bootstrap().catch(async (error: unknown) => {
  await Promise.allSettled([closeSocketServer(), closeHttpServer(), mongoose.disconnect(), disconnectRedis()]);
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Failed to start server:\n${message}\n`);
  process.exit(1);
});
