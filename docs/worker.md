# Worker Process

The HTTP API (`npm run dev`) and the worker (`npm run dev:worker`) are separate processes.

## Why a separate folder

Use `worker/` for background work that should not block API requests:

- queued jobs
- scheduled/cron-style tasks
- email, file, and report processing
- cache warm-up or cleanup

## Files

- `worker/index.ts`: worker process entry
- `worker/jobs/sample.job.ts`: sample job used as a startup check

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
2. Call it from `worker/index.ts` (or from a scheduler/queue you add later).
3. Keep the worker independent from `app/server.ts`.
4. Add or update tests under `tests/unit/`.
5. Update this file if job names or commands change.
