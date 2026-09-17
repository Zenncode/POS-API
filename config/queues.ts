import { Queue } from 'bullmq';
import { getEnv } from './env';

export const POS_QUEUE_NAME = 'pos-jobs';

export type PosJobName = 'report:daily' | 'stock:low-alert';

export type StockLowAlertJobData = {
  productIds?: string[];
  threshold?: number;
};

export type BullConnectionOptions = {
  host: string;
  port: number;
  username?: string;
  password?: string;
};

export function bullConnection(): BullConnectionOptions {
  try {
    const url = new URL(getEnv().REDIS_URL);
    const options: BullConnectionOptions = {
      host: url.hostname || '127.0.0.1',
      port: Number(url.port || '6379'),
    };

    if (url.username && url.username !== 'default') {
      options.username = url.username;
    }

    if (url.password) {
      options.password = decodeURIComponent(url.password);
    }

    return options;
  } catch {
    return { host: '127.0.0.1', port: 6379 };
  }
}

let queue: Queue | null = null;

function isQueueEnabled(): boolean {
  return getEnv().QUEUE_ENABLED;
}

export function getPosQueue(): Queue | null {
  if (!isQueueEnabled()) {
    return null;
  }

  if (!queue) {
    queue = new Queue(POS_QUEUE_NAME, {
      connection: bullConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 500 },
      },
    });

    queue.on('error', (error: unknown) => {
      process.stderr.write(`Queue error: ${String(error)}\n`);
    });
  }

  return queue;
}

export async function enqueueLowStockAlert(data: StockLowAlertJobData): Promise<void> {
  const posQueue = getPosQueue();
  if (!posQueue) {
    return;
  }

  try {
    await posQueue.add('stock:low-alert', data, {
      jobId: `stock:low-alert:${Date.now()}`,
      delay: 2000,
    });
  } catch (error) {
    process.stderr.write(`Failed to enqueue low stock alert: ${String(error)}\n`);
  }
}

export async function enqueueDailyReport(dateIso: string): Promise<void> {
  const posQueue = getPosQueue();
  if (!posQueue) {
    return;
  }

  try {
    await posQueue.add('report:daily', { date: dateIso });
  } catch (error) {
    process.stderr.write(`Failed to enqueue daily report: ${String(error)}\n`);
  }
}

// Set up repeatable jobs (runs daily at 1 AM UTC)
export async function setupRepeatableJobs(): Promise<void> {
  const posQueue = getPosQueue();
  if (!posQueue) {
    return;
  }

  try {
    // Remove existing repeatable job if any
    const repeatableJobs = await posQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      if (job.name === 'report:daily') {
        await posQueue.removeRepeatableByKey(job.key);
      }
    }

    // Add new repeatable job - runs daily at 1 AM UTC
    await posQueue.add(
      'report:daily',
      { date: new Date().toISOString().slice(0, 10) },
      {
        repeat: {
          pattern: '0 1 * * *', // cron: at 1:00 AM every day
        },
        jobId: 'report:daily:repeatable',
      },
    );

    process.stdout.write('[queues] Repeatable daily report job scheduled (1 AM UTC)\n');
  } catch (error) {
    process.stderr.write(`Failed to setup repeatable jobs: ${String(error)}\n`);
  }
}

export async function closeQueue(): Promise<void> {
  if (!queue) {
    return;
  }

  try {
    await queue.close();
  } catch (error) {
    process.stderr.write(`Failed to close queue: ${String(error)}\n`);
  } finally {
    queue = null;
  }
}
