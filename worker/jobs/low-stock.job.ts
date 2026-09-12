import { publishPosEvent } from '../../config/redis.client';
import { getPrismaClient } from '../../config/prisma.client';
import { getEnv } from '../../config/env';
import type { StockLowAlertJobData } from '../../config/queues';

export type LowStockAlert = {
  productId: string;
  sku: string;
  name: string;
  stock: number;
  threshold: number;
};

export async function findLowStockProducts(productIds?: string[]): Promise<LowStockAlert[]> {
  const prisma = getPrismaClient();

  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      ...(productIds && productIds.length > 0
        ? { id: { in: productIds } }
        : {}),
    },
    select: {
      id: true,
      sku: true,
      name: true,
      stock: true,
      lowStockThreshold: true,
    },
  });

  return products
    .filter((product) => product.stock <= product.lowStockThreshold)
    .map((product) => ({
      productId: product.id,
      sku: product.sku,
      name: product.name,
      stock: product.stock,
      threshold: product.lowStockThreshold,
    }));
}

export async function runLowStockAlertJob(data: StockLowAlertJobData): Promise<void> {
  const threshold = data.threshold ?? getEnv().LOW_STOCK_THRESHOLD;

  const alerts = await findLowStockProducts(data.productIds);

  if (alerts.length === 0) {
    return;
  }

  await publishPosEvent({
    type: 'stock:low',
    data: { threshold, products: alerts },
  });

  process.stdout.write(
    `[stock:low] ${alerts.length} product(s) at or below threshold: ${alerts
      .map((alert) => `${alert.sku} (${alert.stock})`)
      .join(', ')}\n`,
  );
}
