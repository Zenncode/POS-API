import { getPrismaClient } from '../../config/prisma.client';
import { conflict, notFound } from '../common/errors';
import type { CreateCategoryDto, UpdateCategoryDto } from '../../zod/category.schema';
import { paginationSkip, type Pagination } from '../../zod/shared';

export async function listCategories(dto: Pagination) {
  const { skip, take } = paginationSkip(dto);
  const prisma = getPrismaClient();

  const [data, total] = await prisma.$transaction([
    prisma.category.findMany({
      orderBy: { name: 'asc' },
      skip,
      take,
      include: { _count: { select: { products: true } } },
    }),
    prisma.category.count(),
  ]);

  return { data, total, page: dto.page, pageSize: dto.pageSize };
}

export async function getCategory(categoryId: string) {
  const category = await getPrismaClient().category.findUnique({
    where: { id: categoryId },
    include: { _count: { select: { products: true } } },
  });

  if (!category) {
    throw notFound('Category not found');
  }

  return category;
}

export async function createCategory(dto: CreateCategoryDto) {
  const prisma = getPrismaClient();
  const existing = await prisma.category.findUnique({ where: { name: dto.name } });

  if (existing) {
    throw conflict(`Category ${dto.name} already exists`, 'DUPLICATE_CATEGORY');
  }

  return prisma.category.create({ data: { name: dto.name } });
}

export async function updateCategory(categoryId: string, dto: UpdateCategoryDto) {
  const prisma = getPrismaClient();
  const existing = await prisma.category.findUnique({ where: { id: categoryId } });

  if (!existing) {
    throw notFound('Category not found');
  }

  if (dto.name && dto.name !== existing.name) {
    const duplicate = await prisma.category.findUnique({ where: { name: dto.name } });
    if (duplicate && duplicate.id !== categoryId) {
      throw conflict(`Category ${dto.name} already exists`, 'DUPLICATE_CATEGORY');
    }
  }

  return prisma.category.update({
    where: { id: categoryId },
    data: { name: dto.name },
  });
}

export async function deleteCategory(categoryId: string) {
  const prisma = getPrismaClient();
  const existing = await prisma.category.findUnique({
    where: { id: categoryId },
    include: { _count: { select: { products: true } } },
  });

  if (!existing) {
    throw notFound('Category not found');
  }

  if (existing._count.products > 0) {
    throw conflict(
      `Category still has ${existing._count.products} products — move or archive them first`,
      'CATEGORY_IN_USE',
    );
  }

  await prisma.category.delete({ where: { id: categoryId } });
  return { id: categoryId, deleted: true };
}
