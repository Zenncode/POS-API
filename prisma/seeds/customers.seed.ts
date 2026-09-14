import { PrismaClient } from '@prisma/client';

// Raw seed data lives HERE in prisma/seeds/ — matches POS/credentials.md §7.
// Fake test numbers only, no real PII.
const customersSeedData = [
  { name: 'Jose Cruz', phone: '09171234567', email: null as string | null, loyaltyPoints: 150 },
  { name: 'Ana Reyes', phone: '09181234567', email: 'ana@example.com', loyaltyPoints: 0 },
];

export async function seedCustomers(prisma: PrismaClient): Promise<void> {
  for (const c of customersSeedData) {
    await prisma.customer.upsert({
      where: { phone: c.phone },
      update: {},
      create: c,
    });
  }

  process.stdout.write(`Seeded ${customersSeedData.length} test customers\n`);
}

export { customersSeedData };
