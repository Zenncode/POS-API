# Project Purpose and Backend Flow

## Purpose of this project

This is the backend for a Point-of-Sale (POS) system:

- Express + TypeScript REST API
- PostgreSQL (Prisma) — staff accounts, catalog, customers, orders, payments, stock ledger
- Redis — response caching, idempotency claims, pub/sub event fan-out
- BullMQ — background jobs (daily reports, low-stock alerts) in a separate worker process
- Socket.IO — realtime order/stock events to POS clients
- Role-based JWT auth: ADMIN / MANAGER / CASHIER

## Architecture in simple terms

1. Entry and runtime layer
   - `app/server.ts` starts the HTTP API + Socket.IO server
   - `worker/index.ts` starts the BullMQ worker as a separate process
2. API layer
   - `app/app.module.ts` wires middleware, routers, health, error handling
   - `app/routes/*` map endpoints; `app/controllers/*` parse/validate/respond
3. Business and data layer
   - `app/services/*` hold business logic; Prisma via `config/prisma.client.ts`
   - `config/redis.client.ts` (cache + pub/sub), `config/queues.ts` (BullMQ producers)
   - `zod/*` define request schemas shared by `validateBody`/`validateQuery`/`validateParams`
4. Background jobs layer
   - `worker/jobs/` consume the `pos-jobs` queue; results publish to Redis `pos:events`
   - The API subscriber re-emits worker results to Socket.IO clients

## Runtime flow

1. Startup (`app/server.ts`)
   - Loads `.env` (validated by `config/env.ts` — fails fast in production on default secrets)
   - Connects PostgreSQL (startup fails if unreachable) and Redis (optional, degrades gracefully)
   - Seeds first ADMIN staff from `ADMIN_SEED_EMAIL`/`ADMIN_SEED_PASSWORD` if not present
   - Starts HTTP server (with port auto-fallback) and Socket.IO server (JWT handshake auth)
2. App setup (`app/app.module.ts`)
   - Helmet, JSON parser, CORS, rate limiting
   - Public: `/`, `/api/health`, `/api/auth/login`, `/api/auth/refresh`
   - Authenticated: `/api/products`, `/api/categories`, `/api/customers`, `/api/orders`, `/api/reports`
   - Central error handler: ZodError → 400, AppError → status+code, unknown → 500
3. Checkout request path (the core flow)
   - `POST /api/orders` with optional `Idempotency-Key`
   - Redis claim via `SET NX EX` (replay stored response / 409 while in-flight / pass-through when Redis off)
   - `order.service.createOrder` prices lines (integer cents, basis-point tax), then in one Prisma transaction:
     creates order + snapshot items, guards stock decrement (`stock >= qty` else 422), writes payments + stock movements
   - Side effects after commit: invalidate product list cache, emit `order:created` to the store room, publish pos event, enqueue low-stock alert
4. Stock adjustments path
   - `POST /api/products/:id/adjust-stock` — guarded update + `StockMovement` ledger entry
5. Reports path
   - `GET /api/reports/sales/daily|summary` — manager+ only; SQL aggregates, no report tables
6. Worker path
   - `report:daily` (repeatable) and `stock:low-alert` jobs; results fan out via `pos:events` → Socket.IO

## Backend folder map (where to edit)

- `app/routes/`: endpoint mapping
- `app/controllers/`: request/response handling
- `app/services/`: business logic and DB operations
- `app/common/`: errors, asyncHandler, validate middleware, guards (roles)
- `zod/`: request schemas (per domain)
- `config/`: env, Prisma client, Redis client, BullMQ queues
- `socket/`: realtime events and socket auth
- `worker/`: background worker process and jobs
- `tests/`: endpoint behavior and regressions
- `docs/`: endpoint and architecture documentation
- `prisma/`: schema + seed

## Simple change flow for contributors

1. Find the route you want to change.
2. Update zod schema + controller + service together.
3. If data shape changes, update `prisma/schema.prisma` and docs.
4. Add or update tests for changed behavior.
5. Run checks: `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`.

## Quick rule

If one part of the flow changes, update the matching docs and tests in the same change.
