import { Prisma } from '@prisma/client';
import { getPrismaClient } from '../../config/prisma.client';
import { getEnv } from '../../config/env';
import { enqueueLowStockAlert } from '../../config/queues';
import { delCacheByPrefix, withCache } from './cache.service';
import { conflict, notFound, unprocessable } from '../common/errors';
import type { AdjustStockDto, CreateProductDto, ListProductsDto, UpdateProductDto } from '../../zod/product.schema';
import { paginationSkip } from '../../zod/shared';

const CACHE_PREFIX = 'products:list';

function buildListCacheKey(dto: ListProductsDto): string {
  return `${CACHE_PREFIX}:${JSON.stringify(dto)}`;
}

function buildListWhere(dto: ListProductsDto): Prisma.ProductWhereInput {
  return {
    isActive: dto.activeOnly ? true : undefined,
    categoryId: dto.categoryId,
    OR: dto.q
      ? [
          { name: { contains: dto.q, mode: 'insensitive' } },
          { sku: { contains: dto.q, mode: 'insensitive' } },
          { barcode: { contains: dto.q, mode: 'insensitive' } },
        ]
      : undefined,
  };
}

function buildOrderBy(dto: ListProductsDto): Prisma.ProductOrderByWithRelationInput {
  switch (dto.sort) {
    case 'price':
      return { priceCents: 'asc' };
    case 'stock':
      return { stock: 'desc' };
    case 'newest':
      return { createdAt: 'desc' };
    default:
      return { name: 'asc' };
  }
}

export async function listProducts(dto: ListProductsDto) {
  const { skip, take } = paginationSkip(dto);

  return withCache(buildListCacheKey(dto), getEnv().REDIS_CACHE_TTL_SECONDS, async () => {
    const prisma = getPrismaClient();
    const where = buildListWhere(dto);

    const [data, total] = await prisma.$transaction([
      prisma.product.findMany({
        where,
        orderBy: buildOrderBy(dto),
        skip,
        take,
        include: { category: { select: { id: true, name: true } } },
      }),
      prisma.product.count({ where }),
    ]);

    return { data, total, page: dto.page, pageSize: dto.pageSize };
  });
}

export async function getProduct(productId: string) {
  const product = await getPrismaClient().product.findUnique({
    where: { id: productId },
    include: { category: { select: { id: true, name: true } } },
  });

  if (!product) {
    throw notFound('Product not found');
  }

  return product;
}

export async function createProduct(dto: CreateProductDto) {
  const prisma = getPrismaClient();

  const existingSku = await prisma.product.findUnique({ where: { sku: dto.sku } });
  if (existingSku) {
    throw conflict(`Product with SKU ${dto.sku} already exists`, 'DUPLICATE_SKU');
  }

  if (dto.barcode) {
    const existingBarcode = await prisma.product.findUnique({ where: { barcode: dto.barcode } });
    if (existingBarcode) {
      throw conflict(`Product with barcode ${dto.barcode} already exists`, 'DUPLICATE_BARCODE');
    }
  }

  const product = await prisma.product.create({
    data: {
      sku: dto.sku,
      barcode: dto.barcode ?? null,
      name: dto.name,
      categoryId: dto.categoryId ?? null,
      priceCents: dto.priceCents,
      costCents: dto.costCents ?? null,
      taxRateBps: dto.taxRateBps,
      stock: dto.stock,
      lowStockThreshold: dto.lowStockThreshold,
    },
    include: { category: { select: { id: true, name: true } } },
  });

  await delCacheByPrefix(CACHE_PREFIX);
  return product;
}

export async function updateProduct(productId: string, dto: UpdateProductDto) {
  const prisma = getPrismaClient();
  const existing = await prisma.product.findUnique({ where: { id: productId } });

  if (!existing) {
    throw notFound('Product not found');
  }

  if (dto.barcode && dto.barcode !== existing.barcode) {
    const existingBarcode = await prisma.product.findUnique({ where: { barcode: dto.barcode } });
    if (existingBarcode && existingBarcode.id !== productId) {
      throw conflict(`Product with barcode ${dto.barcode} already exists`, 'DUPLICATE_BARCODE');
    }
  }

  const product = await prisma.product.update({
    where: { id: productId },
    data: {
      sku: dto.sku,
      barcode: dto.barcode,
      name: dto.name,
      categoryId: dto.categoryId,
      priceCents: dto.priceCents,
      costCents: dto.costCents,
      taxRateBps: dto.taxRateBps,
      lowStockThreshold: dto.lowStockThreshold,
    },
    include: { category: { select: { id: true, name: true } } },
  });

  await delCacheByPrefix(CACHE_PREFIX);
  return product;
}

export async function adjustStock(productId: string, dto: AdjustStockDto) {
  const prisma = getPrismaClient();

  const updated = await prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw notFound('Product not found');
    }

    const newStock = product.stock + dto.delta;
    if (newStock < 0) {
      throw unprocessable(
        `Stock adjustment would go negative (${product.stock} + ${dto.delta})`,
        'INSUFFICIENT_STOCK',
      );
    }

    const result = await tx.product.update({
      where: { id: productId },
      data: { stock: newStock },
    });

    await tx.stockMovement.create({
      data: {
        productId,
        delta: dto.delta,
        reason: dto.reason,
        note: dto.note ?? null,
      },
    });

    return result;
  });

  await delCacheByPrefix(CACHE_PREFIX);

  if (updated.stock <= updated.lowStockThreshold) {
    await enqueueLowStockAlert({ productIds: [updated.id] });
  }

  return updated;
}

export async function getStockMovements(productId: string, page = 1, pageSize = 20) {
  const prisma = getPrismaClient();
  const skip = (page - 1) * pageSize;

  const [data, total] = await prisma.$transaction([
    prisma.stockMovement.findMany({
      where: { productId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.stockMovement.count({ where: { productId } }),
  ]);

  return { data, total, page, pageSize };
}

export async function archiveProduct(productId: string) {
  const prisma = getPrismaClient();
  const existing = await prisma.product.findUnique({ where: { id: productId } });

  if (!existing) {
    throw notFound('Product not found');
  }

  const product = await prisma.product.update({
    where: { id: productId },
    data: { isActive: false },
  });

  await delCacheByPrefix(CACHE_PREFIX);
  return product;
}
