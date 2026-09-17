import bcrypt from 'bcryptjs';
import { PrismaClient, UserRole } from '@prisma/client';

// Test-only E2E seed — idempotent upserts for the feature-organized Playwright
// suite: MAIN store, synthetic ADMIN/MANAGER/CASHIER accounts, one category
// with two register products, one CRM customer, plus scoped cleanup of stale
// OPEN shifts owned by the synthetic accounts (nothing else is ever wiped).
// It NEVER runs the general seed (prisma/seed.ts) and fail-closes unless the
// target is the isolated E2E DB.
// Run via: pnpm run e2e:bootstrap  (guard.mjs + prisma db push run first)
// Manual runs must export the SAME DATABASE_URL + NODE_ENV=test the Playwright
// webServer sets inline (postgresql://postgres:postgres@127.0.0.1:55433/pos_e2e),
// plus the same E2E_MANAGER_EMAIL/PASSWORD (or rely on the defaults below,
// which match the Playwright spec defaults) — otherwise this seed refuses.
async function main(): Promise<void> {
  // Independent strict checks — mirrors guard.mjs exactly (same values, same
  // rejections) so the seed stays safe even if guard.mjs is ever bypassed.
  // Validates DATABASE_URL (what Prisma uses), never prints it.
  if (process.env.E2E_EXPECT_DB && process.env.E2E_EXPECT_DB !== 'pos_e2e') {
    throw new Error('E2E seed: refusing — E2E_EXPECT_DB override is not allowed.');
  }
  if (process.env.E2E_EXPECT_HOSTPORT && process.env.E2E_EXPECT_HOSTPORT !== '55433') {
    throw new Error('E2E seed: refusing — E2E_EXPECT_HOSTPORT override is not allowed.');
  }

  const dbUrl = process.env.DATABASE_URL ?? '';
  if (!dbUrl) {
    throw new Error('E2E seed: refusing — DATABASE_URL is not set.');
  }
  if (process.env.E2E_DATABASE_URL && process.env.E2E_DATABASE_URL !== dbUrl) {
    throw new Error('E2E seed: refusing — E2E_DATABASE_URL diverges from DATABASE_URL.');
  }

  let parsed: URL;
  try {
    parsed = new URL(dbUrl);
  } catch {
    throw new Error('E2E seed: refusing — DATABASE_URL is not a valid URL.');
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('E2E seed: refusing — DATABASE_URL must use the postgres/postgresql scheme.');
  }
  if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
    throw new Error('E2E seed: refusing — DATABASE_URL hostname must be 127.0.0.1 or localhost.');
  }
  if (parsed.port !== '55433') {
    throw new Error('E2E seed: refusing — DATABASE_URL port must be 55433.');
  }
  if (parsed.pathname !== '/pos_e2e') {
    throw new Error('E2E seed: refusing — DATABASE_URL database must be /pos_e2e.');
  }
  // Query allowlist mirrors guard.mjs: only Prisma's `schema` key is allowed,
  // so a crafted URL cannot retarget the network layer via query parameters.
  for (const key of parsed.searchParams.keys()) {
    if (key !== 'schema') {
      throw new Error(`E2E seed: refusing — DATABASE_URL query parameter "${key}" is not allowed.`);
    }
  }
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('E2E seed: refusing — NODE_ENV must be exactly "test".');
  }

  const managerEmail = (process.env.E2E_MANAGER_EMAIL ?? 'e2e-manager@example.com').toLowerCase().trim();
  const managerPassword = process.env.E2E_MANAGER_PASSWORD ?? 'E2eManager1234!';
  const adminEmail = (process.env.E2E_ADMIN_EMAIL ?? 'e2e-admin@example.com').toLowerCase().trim();
  const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? 'E2eAdmin1234!';
  const cashierEmail = (process.env.E2E_CASHIER_EMAIL ?? 'e2e-cashier@example.com').toLowerCase().trim();
  const cashierPassword = process.env.E2E_CASHIER_PASSWORD ?? 'E2eCashier1234!';

  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  try {
    await prisma.store.upsert({
      where: { code: 'MAIN' },
      update: {},
      create: { name: 'Main Store', code: 'MAIN' },
    });

    // Idempotent test accounts — upsert-only, never wiped. The MANAGER row is
    // byte-identical to the original seed so the legacy login-dashboard spec
    // keeps passing on an existing pos_e2e volume.
    const accounts = [
      { email: managerEmail, password: managerPassword, name: 'E2E Manager', role: UserRole.MANAGER },
      { email: adminEmail, password: adminPassword, name: 'E2E Admin', role: UserRole.ADMIN },
      { email: cashierEmail, password: cashierPassword, name: 'E2E Cashier', role: UserRole.CASHIER },
    ];
    for (const account of accounts) {
      const passwordHash = await bcrypt.hash(account.password, 4);
      await prisma.user.upsert({
        where: { email: account.email },
        update: { role: account.role, isActive: true, passwordHash, name: account.name },
        create: { email: account.email, passwordHash, name: account.name, role: account.role },
      });
      process.stdout.write(`E2E seed: upserted ${account.role} ${account.email}\n`);
    }

    // Deliberate clean precondition, scoped to the synthetic accounts above:
    // close any stale OPEN shifts they own so every spec starts shift-free
    // (the legacy spec asserts the register gates selling with no open shift).
    // Never touches other users' shifts or any other table.
    const seeded = await prisma.user.findMany({
      where: { email: { in: accounts.map((account) => account.email) } },
      select: { id: true },
    });
    const closed = await prisma.shift.updateMany({
      where: { userId: { in: seeded.map((user) => user.id) }, status: 'OPEN' },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    if (closed.count > 0) {
      process.stdout.write(`E2E seed: closed ${closed.count} stale test shift(s)\n`);
    }

    // Shared catalog + CRM fixtures. Unique E2E SKUs/phone so specs can also
    // mint per-test entities without colliding. Stock is reset deterministically
    // so re-seeding a dirty volume restores a known baseline.
    const beverages = await prisma.category.upsert({
      where: { name: 'E2E Beverages' },
      update: {},
      create: { name: 'E2E Beverages' },
    });
    const products = [
      { sku: 'E2E-REG-001', barcode: 'E2E-BAR-001', name: 'E2E Drip Coffee', priceCents: 350, stock: 50 },
      { sku: 'E2E-REG-002', barcode: 'E2E-BAR-002', name: 'E2E Butter Croissant', priceCents: 500, stock: 50 },
    ];
    for (const product of products) {
      await prisma.product.upsert({
        where: { sku: product.sku },
        update: {
          name: product.name,
          barcode: product.barcode,
          priceCents: product.priceCents,
          stock: product.stock,
          isActive: true,
          categoryId: beverages.id,
        },
        create: {
          sku: product.sku,
          barcode: product.barcode,
          name: product.name,
          priceCents: product.priceCents,
          stock: product.stock,
          categoryId: beverages.id,
        },
      });
    }
    process.stdout.write(`E2E seed: upserted ${products.length} products in ${beverages.name}\n`);

    await prisma.customer.upsert({
      where: { phone: '+15550001001' },
      update: { name: 'E2E Walker', email: 'e2e-walker@example.com' },
      create: { name: 'E2E Walker', phone: '+15550001001', email: 'e2e-walker@example.com' },
    });
    process.stdout.write('E2E seed: upserted customer E2E Walker\n');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`E2E seed failed: ${String(error)}\n`);
  process.exitCode = 1;
});
