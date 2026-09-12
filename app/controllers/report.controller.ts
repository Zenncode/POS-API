import { Request, Response } from 'express';
import { z } from 'zod';
import { dailySales, salesSummary } from '../services/report.service';

export async function handleDailySales(req: Request, res: Response): Promise<void> {
  const { date } = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD') }).parse(req.query);
  res.status(200).json(await dailySales(date));
}

export async function handleSalesSummary(req: Request, res: Response): Promise<void> {
  const { from, to } = z
    .object({
      from: z.string().datetime(),
      to: z.string().datetime(),
    })
    .parse(req.query);

  res.status(200).json(await salesSummary(from, to));
}
