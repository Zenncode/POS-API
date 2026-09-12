# Database (Prisma + PostgreSQL)

This backend uses Express.js with PostgreSQL via Prisma.

- Provider: `postgresql` (`DATABASE_URL` in `.env`)
- Schema: `prisma/schema.prisma` (single-file)
- Client: generated to `node_modules/@prisma/client` via `prisma generate` (runs on `npm install`)

## Models

| Model | Purpose | Key fields |
| --- | --- | --- |
| `Store` | Branch/location | `code` unique |
| `User` | Staff accounts | `role` (ADMIN/MANAGER/CASHIER), `refreshTokenHash` for rotation |
| `Category` | Product grouping | `name` unique |
| `Product` | Sellable items | `sku` unique, `barcode` unique, `priceCents`, `taxRateBps`, `stock`, `lowStockThreshold`, `isActive` (soft delete) |
| `Customer` | Walk-in/loyalty customers | `phone` unique, `loyaltyPoints` |
| `Order` | Sales | `orderNumber` unique, `status` (PENDING/PAID/VOID/REFUNDED), `*Cents` money fields |
| `OrderItem` | Line items | `nameSnapshot`/`skuSnapshot`/`unitPriceCents` frozen at sale time |
| `Payment` | Split payments | `method` (CASH/CARD/QR), `amountCents` |
| `StockMovement` | Inventory ledger | `delta`, `reason` (SALE/REFUND/PURCHASE/ADJUST/VOID) |

Conventions:

- All money is **integer cents** (`priceCents`, `totalCents`, ...). Never use floats.
- Tax is stored in **basis points** (`taxRateBps`: 800 = 8%).
- Products are global in v1 (no per-store `productId`); orders can reference a store.

## Commands

```bash
npm run db:generate   # prisma generate (client)
npm run db:push       # push schema to database (dev)
npm run db:migrate    # prisma migrate dev (create/apply migration)
npm run db:deploy     # prisma migrate deploy (production)
npm run db:seed       # seed store, admin user, sample catalog
```

## Local setup

```bash
docker compose up -d postgres
npm run db:push
npm run db:seed
```

## Access pattern

Services import `getPrismaClient()` from `config/prisma.client.ts` (global singleton, safe across hot reloads). Do not instantiate `PrismaClient` directly in services/controllers.
