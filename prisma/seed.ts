import { PrismaClient } from '@prisma/client';
import { seedCatalog, seedCustomers, seedStore, seedUsers } from './seeds';

const prisma = new PrismaClient();

// Thin runner only — ALL seed data + seed functions live in prisma/seeds/.
// Run with: pnpm run db:seed
async function main(): Promise<void> {
  await seedStore(prisma);
  await seedUsers(prisma);
  await seedCustomers(prisma);
  await seedCatalog(prisma);
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`Seed failed: ${String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
