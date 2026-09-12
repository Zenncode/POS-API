# Worker Process

The HTTP API (`npm run dev`) and the worker (`npm run dev:worker`) are separate processes.

## Why a separate process

Background work (reports, alerts) should not block API requests or lose progress when the API restarts. Jobs persist in Redis via BullMQ and survive restarts.

## Files

- `worker/index.ts`: BullMQ worker entry — connects Postgres + Redis, consumes queue `pos-jobs`
- `worker/jobs/report.job.ts`: `report:daily` — aggregates daily sales (totals, top products, payment mix) and publishes `report:daily:completed` on Redis pub/sub `pos:events`
- `worker/jobs/low-stock.job.ts`: `stock:low-alert` — finds products at/below `lowStockThreshold` and publishes `stock:low` on `pos:events`
- `worker/jobs/sample.job.ts`: template sample (unused)

## Queue wiring

- Producers live in the API: `config/queues.ts` (`enqueueLowStockAlert` after checkout/stock adjustments, `enqueueDailyReport`)
- `QUEUE_ENABLED=false` disables the queue everywhere (API skips enqueue, worker idles)
- The API subscribes to `pos:events` and re-emits job results to Socket.IO clients, so the worker never needs a socket server

## Commands

Development:

```bash
npm run dev:worker
```

Production (after `npm run build`):

```bash
npm run worker
```

## Change flow

1. Add a job in `worker/jobs/`.
2. Register the job name in `worker/index.ts` switch and in `config/queues.ts` (`PosJobName`).
3. Add an enqueue helper in `config/queues.ts` for API producers.
4. Keep the worker independent from `app/server.ts`.
5. Update this file if job names or commands change.
