import { PrismaClient } from '@prisma/client';

// Raw seed data lives HERE in prisma/seeds/.
const categorySeedData = { name: 'General' };

const productsSeedData = [
  { sku: 'SKU-0001', barcode: '1000000000017', name: 'Coffee Beans 500g', priceCents: 45000, costCents: 27000, taxRateBps: 800, stock: 40 },
  { sku: 'SKU-0002', barcode: '1000000000024', name: 'Milk 1L', priceCents: 12000, costCents: 8400, taxRateBps: 800, stock: 100 },
  { sku: 'SKU-0003', barcode: '1000000000031', name: 'Bread Loaf', priceCents: 9000, costCents: 4500, taxRateBps: 0, stock: 60 },
  { sku: 'SKU-0004', barcode: '1000000000048', name: 'Energy Drink', priceCents: 8500, costCents: 4300, taxRateBps: 800, stock: 80 },
  { sku: 'SKU-0005', barcode: '1000000000055', name: 'Chocolate Bar', priceCents: 4500, costCents: 2100, taxRateBps: 800, stock: 3 },
];

export async function seedCatalog(prisma: PrismaClient): Promise<void> {
  const category = await prisma.category.upsert({
    where: { name: categorySeedData.name },
    update: {},
    create: categorySeedData,
  });

  for (const product of productsSeedData) {
    await prisma.product.upsert({
      where: { sku: product.sku },
      update: {},
      create: { ...product, categoryId: category.id },
    });
  }

  process.stdout.write(`Seeded ${productsSeedData.length} products in category "${category.name}"\n`);
}

export { categorySeedData, productsSeedData };
