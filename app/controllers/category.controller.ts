import { Request, Response } from 'express';
import { createCategorySchema, updateCategorySchema } from '../../zod/category.schema';
import { idParamSchema, paginationSchema } from '../../zod/shared';
import {
  createCategory,
  deleteCategory,
  getCategory,
  listCategories,
  updateCategory,
} from '../services/category.service';

export async function handleListCategories(req: Request, res: Response): Promise<void> {
  const dto = paginationSchema.parse(req.query);
  res.status(200).json(await listCategories(dto));
}

export async function handleGetCategory(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  res.status(200).json(await getCategory(id));
}

export async function handleCreateCategory(req: Request, res: Response): Promise<void> {
  const dto = createCategorySchema.parse(req.body);
  res.status(201).json(await createCategory(dto));
}

export async function handleUpdateCategory(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  const dto = updateCategorySchema.parse(req.body);
  res.status(200).json(await updateCategory(id, dto));
}

export async function handleDeleteCategory(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  res.status(200).json(await deleteCategory(id));
}
