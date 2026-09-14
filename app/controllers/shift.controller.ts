import { Request, Response } from 'express';
import { openShift, closeShift, getCurrentShift, listShifts, getShift, getZReports, getZReport } from '../services/shift.service';
import type { ListShiftsDto, GetZReportsDto } from '../../zod/shift.schema';

export async function handleOpenShift(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const storeId = (req.user as any).storeId ?? null;

  const shift = await openShift(req.body, userId, storeId);
  res.status(201).json(shift);
}

export async function handleCloseShift(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  // POST /api/shifts/close carries no :id — close the caller's open shift.
  let { id } = req.params;
  if (!id) {
    const current = await getCurrentShift(userId);
    if (!current) {
      res.status(404).json({ message: 'No open shift found' });
      return;
    }
    id = current.id;
  }

  const shift = await closeShift(id, userId, req.body);
  res.status(200).json(shift);
}

export async function handleGetCurrentShift(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;

  // Raw shift (or null) — matches POS-APP's `Shift | null` client type.
  const shift = await getCurrentShift(userId);
  res.status(200).json(shift ?? null);
}

export async function handleListShifts(req: Request, res: Response): Promise<void> {
  const result = await listShifts(req.query as unknown as ListShiftsDto);
  res.status(200).json(result);
}

export async function handleGetShift(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const shift = await getShift(id);
  res.status(200).json({ shift });
}

export async function handleGetZReports(req: Request, res: Response): Promise<void> {
  const result = await getZReports(req.query as unknown as GetZReportsDto);
  res.status(200).json(result);
}

export async function handleGetZReport(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const report = await getZReport(id);
  res.status(200).json({ report });
}