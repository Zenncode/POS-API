import bcrypt from 'bcryptjs';
import { PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

function envOr(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

async function seedAdmin(): Promise<void> {
  const email = envOr('ADMIN_SEED_EMAIL', 'admin@example.com').toLowerCase();
  const password = envOr('ADMIN_SEED_PASSWORD', 'change-me-please');
  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.user.upsert({
    where: { email },
    update: { role: UserRole.ADMIN, isActive: true },
    create: {
      email,
      passwordHash,
      name: 'Owner',
      role: UserRole.ADMIN,
    },
  });

  process.stdout.write(`Seeded admin user: ${email}\n`);
}

async function seedStore(): Promise<void> {
  const store = await prisma.store.upsert({
    where: { code: 'MAIN' },
    update: {},
    create: { name: 'Main Store', code: 'MAIN' },
  });

  process.stdout.write(`Seeded store: ${store.code}\n`);
}

async function seedCatalog(): Promise<void> {
  const category = await prisma.category.upsert({
    where: { name: 'General' },
    update: {},
    create: { name: 'General' },
  });

  const products = [
    { sku: 'SKU-0001', barcode: '1000000000017', name: 'Coffee Beans 500g', priceCents: 1250, costCents: 700, taxRateBps: 800, stock: 40 },
    { sku: 'SKU-0002', barcode: '1000000000024', name: 'Milk 1L', priceCents: 199, costCents: 120, taxRateBps: 800, stock: 100 },
    { sku: 'SKU-0003', barcode: '1000000000031', name: 'Bread Loaf', priceCents: 350, costCents: 180, taxRateBps: 0, stock: 60 },
    { sku: 'SKU-0004', barcode: '1000000000048', name: 'Energy Drink', priceCents: 299, costCents: 150, taxRateBps: 800, stock: 80 },
    { sku: 'SKU-0005', barcode: '1000000000055', name: 'Chocolate Bar', priceCents: 150, costCents: 70, taxRateBps: 800, stock: 3 },
  ];

  for (const product of products) {
    await prisma.product.upsert({
      where: { sku: product.sku },
      update: {},
      create: { ...product, categoryId: category.id },
    });
  }

  process.stdout.write(`Seeded ${products.length} products in category "${category.name}"\n`);
}

async function main(): Promise<void> {
  await seedStore();
  await seedAdmin();
  await seedCatalog();
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`Seed failed: ${String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
