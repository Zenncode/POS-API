# ZENNTECHINC POS API

Point-of-Sale backend: Express.js + TypeScript + PostgreSQL (Prisma) + Redis + BullMQ + Socket.IO.

## Included Stack

- Runtime: Node.js (>=18.18) + TypeScript
- Web framework: Express.js
- Database: PostgreSQL + Prisma ORM (`docs/prisma.md`)
- Authentication: JWT (access + refresh rotation), roles `ADMIN`/`MANAGER`/`CASHIER`
- Cache / idempotency / pub-sub: Redis (`redis`), optional via `REDIS_ENABLED`
- Background jobs: BullMQ (`pos-jobs` queue, separate worker process)
- Realtime: Socket.IO with JWT handshake auth
- Testing: Jest + Supertest (hermetic — mocks Prisma/Redis, no live DB needed)
- Code quality: ESLint + Prettier

## Documentation Map

- `docs/project-purpose-flow.md`: architecture overview and runtime flow
- `docs/endpoints.md`: endpoint inventory, roles, payloads
- `docs/prisma.md`: schema, money conventions, db commands
- `docs/worker.md`: worker process and jobs

Update these docs in the same change whenever endpoint flow, auth behavior, or module responsibilities change.

## Quick Start

```bash
# 1. Start Postgres + Redis
docker compose up -d

# 2. Install and set up the database
npm install
npm run db:push
npm run db:seed

# 3. Run the API
npm run dev

# (separate terminal) run the background worker
npm run dev:worker
```

Defaults come from `.env.example` (copy to `.env`). First admin is seeded from
`ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD`.

Production startup refuses default JWT secrets — set real `JWT_SECRET` / `JWT_REFRESH_SECRET`.

## Core Concepts

- **Money is integer cents.** `priceCents`, `totalCents`, `paidCents`... never floats.
- **Tax is basis points.** `taxRateBps: 800` = 8%. Rounding is half-up per line.
- **Checkout is atomic.** Order + snapshot items + payments + stock movements commit in one
  Prisma transaction; stock is guarded (`stock >= qty`) so overselling returns `422`.
- **Idempotent checkout.** Send `Idempotency-Key` on `POST /api/orders`; replays return the
  stored response, concurrent duplicates get `409`.
- **Soft deletes.** Products archive via `isActive: false`; the stock ledger is never rewritten.

## Auth

```http
POST /api/auth/login        { "email": "...", "password": "..." }
→ { "accessToken": "...", "refreshToken": "..." }
```

Send `Authorization: Bearer <accessToken>` on all other endpoints. Legacy
`/api/auth/admin/*` routes still work (admin-role-only login).

## Health Check

```http
GET /api/health
```

```json
{
  "status": "ok",
  "database": "up",
  "cache": "up",
  "queue": "enabled",
  "generatedAt": "2026-04-20T06:10:00.000Z"
}
```

`cache: "disabled"` when `REDIS_ENABLED=false` or Redis is unreachable; the API still runs.

## Realtime (Socket.IO)

```ts
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000', {
  path: '/socket.io',
  auth: { token: accessToken },
});

socket.emit('join:store', '<storeId>');
socket.on('order:created', (payload) => { ... });
socket.on('stock:low', (payload) => { ... });
```

Events emitted by the API: `order:created`, `order:voided`, `stock:low`, `report:daily:completed`, `session:revoked`.

## Background Worker

```bash
npm run dev:worker   # development
npm run worker       # production (after npm run build)
```

Jobs: `report:daily` (daily sales digest), `stock:low-alert`. See `docs/worker.md`.

## Useful Commands

| Command | Purpose |
| --- | --- |
| `npm run db:push` | Push Prisma schema to Postgres (dev) |
| `npm run db:seed` | Seed store, admin, sample catalog |
| `npm run dev` | API with nodemon |
| `npm run dev:worker` | Worker with nodemon |
| `npm run lint` / `lint:fix` | ESLint |
| `npx tsc --noEmit` | Typecheck |
| `npm test` | Jest (hermetic) |
| `npm run build` | Compile to `dist/` |

## Docker Services

`docker-compose.yml` includes:

- `postgres` (PostgreSQL 16)
- `redis` (Redis 7, AOF persistence)

```bash
docker compose up -d
```
