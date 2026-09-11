# Project Purpose and Backend Flow

## Purpose of this project

This project is a production-ready backend foundation for admin-based systems.

It provides:
- Express + TypeScript API
- Admin JWT auth (login, refresh, logout)
- MongoDB (optional by default; required only when `MONGODB_REQUIRED=true`)
- Redis cache (optional)
- Socket.IO realtime support
- Jest/Supertest tests

## Architecture in simple terms

1. Entry and runtime layer
   - `app/server.ts` starts the HTTP API and integrations.
   - `worker/index.ts` starts the background worker as a separate process.
2. API layer
   - `app/app.module.ts`, routes, controllers, guards.
3. Business and data layer
   - services, schema/types, Prisma model files, Redis cache access.
4. Background jobs layer
   - `worker/jobs/` for queued, scheduled, or long-running work.

## Runtime flow of the generated backend

1. Startup (`app/server.ts`)
   - Loads `.env`
   - Tries MongoDB connection
   - Continues in in-memory sample auth mode when MongoDB is unavailable and `MONGODB_REQUIRED=false`
   - Tries Redis connection (continues if unavailable)
   - Seeds first admin from env (`ADMIN_*`/`SAMPLE_ADMIN_*`) depending on active auth mode
   - Starts HTTP server and Socket.IO server
2. App setup (`app/app.module.ts`)
   - Registers JSON parser and CORS logic
   - Public routes: `/` and `/api/health`
   - Auth routes: `/api/auth/admin/*`
   - Protected routes under `/api/*` use `adminAuthGuard`
   - 404 fallback for unknown routes
3. Auth request path
   - Route -> Controller -> DTO validation -> Service -> DB or in-memory sample store
   - `POST /api/auth/admin/login`: validates body, checks password, returns access + refresh token
   - `POST /api/auth/admin/refresh`: verifies refresh token, rotates tokens, updates refresh hash
   - `POST /api/auth/admin/logout`: protected route, clears stored refresh token hash
4. Protected route path
   - `adminAuthGuard` validates Bearer access token (`role=admin`, `tokenType=access`)
   - Request proceeds only when token is valid
5. Cache and realtime path
   - `/api/health` uses Redis cache through `cache.service.ts`
   - Socket.IO events are configured in `app/socket/socket.server.ts`
6. Worker path (separate process)
   - `npm run dev:worker` starts `worker/index.ts`
   - Jobs live in `worker/jobs/` and should not be started from the HTTP server

## Backend folder map (where to edit)

- `app/routes/`: endpoint mapping
- `app/controllers/`: request/response handling
- `app/services/`: business logic and DB operations
- `app/common/guards/`: auth and access control
- `app/types/`: DTO parsing and schema types
- `app/config/`: integrations (Redis client, etc.)
- `app/socket/`: realtime events and socket config
- `worker/`: background worker process
- `worker/jobs/`: individual jobs executed by the worker
- `tests/`: endpoint behavior and regressions
- `docs/`: endpoint and architecture documentation

## Simple change flow for contributors

1. Find the route you want to change.
2. Update controller + service + DTO validation together.
3. If data shape changes, update schema and docs.
4. Add or update tests for changed behavior.
5. Run checks: `npm run lint`, `npm test`, `npm run build`.

## Quick rule

If one part of the flow changes, update the matching docs and tests in the same change.
