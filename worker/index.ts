/**
 * Background worker process.
 * Run separately from the HTTP API:
 *   npm run dev:worker
 *   npm run worker
 *
 * Add jobs under worker/jobs and call them from startWorker().
 */

import { runSampleJob } from './jobs/sample.job';

function log(message: string): void {
  process.stdout.write(`[worker] ${message}\n`);
}

function logError(message: string): void {
  process.stderr.write(`[worker] ${message}\n`);
}

async function startWorker(): Promise<void> {
  log('Worker process started. Add jobs in worker/jobs.');

  const startupCheck = await runSampleJob();
  log(`Startup sample job completed at ${startupCheck.ranAt}`);

  await new Promise<void>((resolve) => {
    const shutdown = (signal: string) => {
      log(`${signal} received, shutting down worker...`);
      resolve();
    };

    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
  });

  log('Worker process stopped.');
}

void startWorker().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logError(`Failed to start worker:\n${message}`);
  process.exit(1);
});
