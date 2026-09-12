import { PrismaClient } from '@prisma/client';
import { getEnv } from './env';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function getPrismaClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = new PrismaClient({
      datasources: {
        db: { url: getEnv().DATABASE_URL },
      },
    });
  }

  return globalForPrisma.prisma;
}

export async function connectDatabase(): Promise<void> {
  try {
    await getPrismaClient().$connect();
  } catch (error) {
    process.stderr.write(`Database unavailable: ${String(error)}\n`);
    throw error;
  }
}

export async function disconnectDatabase(): Promise<void> {
  if (!globalForPrisma.prisma) {
    return;
  }

  try {
    await globalForPrisma.prisma.$disconnect();
  } catch (error) {
    process.stderr.write(`Failed to close database connection: ${String(error)}\n`);
  }
}
