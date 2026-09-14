import { PrismaClient } from '@prisma/client';

// Raw seed data lives HERE in prisma/seeds/.
const storeSeedData = { name: 'Main Store', code: 'MAIN' };

export async function seedStore(prisma: PrismaClient): Promise<void> {
  const store = await prisma.store.upsert({
    where: { code: storeSeedData.code },
    update: {},
    create: storeSeedData,
  });

  process.stdout.write(`Seeded store: ${store.code}\n`);
}

export { storeSeedData };
