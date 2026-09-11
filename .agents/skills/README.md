# Agent Skills (Simplified)

Purpose: define clear ownership so updates stay consistent and safe.

## Skill 1: API Flow Maintainer

- Owns: `app/routes`, `app/controllers`, `app/services`, `app/app.module.ts`
- Focus:
  - endpoint behavior
  - request/response contract consistency
  - error handling
- Validate:
  - `npm run lint`
  - `npm test`

## Skill 2: Auth and Security Keeper

- Owns: `app/common/guards`, auth service/token logic, auth DTO validation
- Focus:
  - access token vs refresh token rules
  - protected route behavior
  - auth-related validation
- Validate:
  - auth tests (`npm test`)
  - manual protected-route checks if needed

## Skill 3: Data and Integration Keeper

- Owns: `prisma`, schema/model docs, `config/`, cache services
- Focus:
  - schema/data changes
  - MongoDB and Redis integration safety
  - backward compatibility notes
- Validate:
  - `npm run build`
  - `npm test`
  - docs alignment (`docs/`)

## Skill 4: Realtime and Infrastructure Keeper

- Owns: `socket/`, `hooks/`, server startup flow, environment-based runtime behavior
- Focus:
  - Socket.IO events and connection rules
  - auth hooks and request lifecycle
  - startup resilience (port fallback, optional Redis)
  - runtime safety and graceful shutdown behavior
- Validate:
  - `npm run build`
  - socket/manual smoke checks when behavior changes

## Skill 5: Security and Auth Hardener

- Owns: `app/common/guards`, `app/services/auth.service.ts`, `app/controllers/auth.controller.ts`, `app/routes/auth.module.ts`
- Focus:
  - JWT and refresh token logic
  - admin guard and protected routes
  - rate limiting, CORS, helmet configuration
  - input validation (zod)
  - admin seeding and password hashing
- Validate:
  - `npm test`
  - manual protected-route checks
  - security header and rate-limit behavior

## Skill 6: Worker and Jobs Keeper

- Owns: `worker/`, `worker/jobs/`
- Focus:
  - background job behavior
  - keeping the worker process separate from `app/server.ts`
  - worker startup and graceful shutdown
- Validate:
  - `npm test`
  - `npm run build`
  - docs alignment (`docs/worker.md`)

## Skill 7: Docs and Developer Experience

- Owns: `README.md`, `docs/**`, `.agents/**`, `STRUCTURE.md`
- Focus:
  - clear onboarding
  - accurate endpoint flow docs
  - keeping agent instructions updated with project changes
- Validate:
  - command/path correctness in docs
  - consistency with actual implementation

## Simple assignment rule

If a task touches route + service + docs, involve both:
- `API Flow Maintainer` for code behavior
- `Docs and Developer Experience` for documentation updates

If a task adds background work, involve `Worker and Jobs Keeper` and keep it out of the HTTP request path.

For security-related changes, involve `Security and Auth Hardener` alongside the relevant skill.
