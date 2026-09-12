import { Request, Response } from 'express';
import { createProductSchema, updateProductSchema, adjustStockSchema } from '../../zod/product.schema';
import type { ListProductsDto } from '../../zod/product.schema';
import { idParamSchema } from '../../zod/shared';
import {
  adjustStock,
  archiveProduct,
  createProduct,
  getProduct,
  getStockMovements,
  listProducts,
  updateProduct,
} from '../services/product.service';

export async function handleListProducts(req: Request, res: Response): Promise<void> {
  // Query was already validated + coerced by validateQuery(listProductsSchema) in
  // product.module.ts — do NOT re-parse here: the activeOnly 'true'|'false' enum is
  // transformed to boolean by the middleware, so a second parse always 400s.
  const dto = req.query as unknown as ListProductsDto;
  res.status(200).json(await listProducts(dto));
}

export async function handleGetProduct(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  res.status(200).json(await getProduct(id));
}

export async function handleCreateProduct(req: Request, res: Response): Promise<void> {
  const dto = createProductSchema.parse(req.body);
  const product = await createProduct(dto);
  res.status(201).json(product);
}

export async function handleUpdateProduct(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  const dto = updateProductSchema.parse(req.body);
  res.status(200).json(await updateProduct(id, dto));
}

export async function handleAdjustStock(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  const dto = adjustStockSchema.parse(req.body);
  res.status(200).json(await adjustStock(id, dto));
}

export async function handleGetStockMovements(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  const page = Number(req.query.page) || 1;
  const pageSize = Math.min(Number(req.query.pageSize) || 20, 100);
  res.status(200).json(await getStockMovements(id, page, pageSize));
}

export async function handleArchiveProduct(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  res.status(200).json(await archiveProduct(id));
}
