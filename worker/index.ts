import { Worker } from 'bullmq';
import { loadEnvFile } from '../config/loadEnv';
import { getEnv } from '../config/env';
import { POS_QUEUE_NAME, bullConnection, closeQueue, setupRepeatableJobs } from '../config/queues';
import { connectDatabase, disconnectDatabase } from '../config/prisma.client';
import { connectRedis, disconnectRedis } from '../config/redis.client';
import { runDailyReportJob } from './jobs/report.job';
import { runLowStockAlertJob } from './jobs/low-stock.job';
import type { StockLowAlertJobData } from '../config/queues';

function log(message: string): void {
  process.stdout.write(`[worker] ${message}\n`);
}

function logError(message: string): void {
  process.stderr.write(`[worker] ${message}\n`);
}

let worker: Worker | null = null;

function startBullWorker(): Worker {
  const bullWorker = new Worker(
    POS_QUEUE_NAME,
    async (job) => {
      log(`Processing job ${job.id} (${job.name})`);

      switch (job.name) {
        case 'report:daily':
          await runDailyReportJob(job.data as { date?: string });
          break;
        case 'stock:low-alert':
          await runLowStockAlertJob((job.data ?? {}) as StockLowAlertJobData);
          break;
        default:
          log(`Unknown job name: ${job.name} — skipping`);
          break;
      }
    },
    {
      connection: bullConnection(),
      concurrency: 4,
    },
  );

  bullWorker.on('completed', (job) => {
    log(`Job ${job.id} (${job.name}) completed`);
  });

  bullWorker.on('failed', (job, error) => {
    logError(`Job ${job?.id ?? 'unknown'} (${job?.name ?? 'unknown'}) failed: ${error.message}`);
  });

  return bullWorker;
}

async function startWorker(): Promise<void> {
  loadEnvFile();
  const env = getEnv();

  await connectDatabase();
  await connectRedis();

  if (!env.QUEUE_ENABLED) {
    log('QUEUE_ENABLED=false — worker idling; set QUEUE_ENABLED=true to process jobs.');
    await new Promise<void>(() => {
      // Keep process alive; jobs are disabled.
    });
    return;
  }

  // Set up repeatable jobs (daily report at 1 AM UTC)
  await setupRepeatableJobs();

  worker = startBullWorker();
  log(`Worker listening on queue "${POS_QUEUE_NAME}" (redis: ${env.REDIS_URL})`);

  await new Promise<void>((resolve) => {
    const shutdown = (signal: string) => {
      log(`${signal} received, shutting down worker...`);
      resolve();
    };

    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
  });

  if (worker) {
    await worker.close();
  }

  await Promise.allSettled([closeQueue(), disconnectDatabase(), disconnectRedis()]);
  log('Worker process stopped.');
}

void startWorker().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logError(`Failed to start worker:\n${message}`);
  process.exit(1);
});
