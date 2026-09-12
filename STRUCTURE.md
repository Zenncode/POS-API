# File Tree: POS-API

**Root Path:** `POS System\POS-API`

```
├── .env.example
├── .eslintrc.js
├── docker-compose.yml        # postgres + redis
├── nodemon.json
├── nodemon.worker.json
├── package.json
├── prisma.config.ts
├── STRUCTURE.md
├── tsconfig.json
├── tsconfig.build.json
├── tsconfig.eslint.json
├── docs/
│   ├── endpoints.md
│   ├── modules-note.txt
│   ├── prisma.md
│   ├── project-purpose-flow.md
│   └── worker.md
├── prisma/
│   ├── schema.prisma         # postgres, single file
│   └── seed.ts               # store + admin + sample catalog
├── app/
│   ├── app.module.ts         # middleware, routers, health v2, error handler
│   ├── server.ts             # bootstrap, port fallback, graceful shutdown
│   ├── common/
│   │   ├── asyncHandler.ts
│   │   ├── errors.ts         # AppError + factories (400/401/403/404/409/422)
│   │   ├── validate.middleware.ts  # validateBody / validateQuery / validateParams
│   │   └── guards/
│   │       └── auth.guard.ts # authGuard, requireRoles, MANAGER_ROLES, requireOverride
│   ├── controllers/
│   │   ├── auth.controller.ts
│   │   ├── category.controller.ts
│   │   ├── customer.controller.ts
│   │   ├── order.controller.ts     # idempotent checkout
│   │   ├── product.controller.ts
│   │   ├── report.controller.ts
│   │   └── user.controller.ts      # ADMIN-only staff management
│   ├── routes/
│   │   ├── auth.module.ts
│   │   ├── category.module.ts
│   │   ├── customer.module.ts
│   │   ├── order.module.ts
│   │   ├── product.module.ts
│   │   ├── report.module.ts
│   │   └── user.module.ts
│   ├── services/
│   │   ├── auth.service.ts         # staff login/refresh/logout (Prisma)
│   │   ├── cache.service.ts        # get/set/del/delCacheByPrefix/withCache
│   │   ├── category.service.ts
│   │   ├── customer.service.ts
│   │   ├── idempotency.service.ts  # Redis SET NX EX claim/replay
│   │   ├── order.service.ts        # transactional checkout + void
│   │   ├── pricing.service.ts      # cents math, bps tax, half-up rounding
│   │   ├── product.service.ts
│   │   ├── report.service.ts
│   │   └── user.service.ts         # staff CRUD + manager PIN verification
│   ├── types/
│   │   └── express.d.ts      # req.user { id, email, role }, req.override
│   └── ...
├── config/
│   ├── env.ts                # Zod-validated env (central)
│   ├── loadEnv.ts            # .env file loader (shared API + worker)
│   ├── prisma.client.ts      # PrismaClient singleton
│   ├── queues.ts             # BullMQ producers (pos-jobs queue)
│   └── redis.client.ts       # cache client + pub/sub (pos:events)
├── socket/
│   └── socket.server.ts      # JWT handshake auth, user:/store: rooms
├── worker/
│   ├── index.ts              # BullMQ worker (queue pos-jobs)
│   └── jobs/
│       ├── report.job.ts     # report:daily
│       └── low-stock.job.ts  # stock:low-alert
├── zod/
│   ├── shared.ts             # idParam, pagination
│   ├── auth.schema.ts
│   ├── category.schema.ts
│   ├── customer.schema.ts
│   ├── order.schema.ts
│   ├── product.schema.ts
│   └── user.schema.ts
└── tests/
    ├── health.spec.ts
    ├── orders.routes.spec.ts
    ├── users.routes.spec.ts
    └── unit/
        ├── auth.service.spec.ts
        ├── idempotency.spec.ts
        ├── orders.service.spec.ts
        ├── pricing.spec.ts
        ├── user.service.spec.ts
        └── worker.spec.ts
```
