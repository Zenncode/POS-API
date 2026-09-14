import { Request, Response } from 'express';
import { helloQuerySchema } from '../../zod/hello.schema';
import { getHello } from '../services/hello.service';

export async function handleHello(req: Request, res: Response): Promise<void> {
  const dto = helloQuerySchema.parse(req.query);
  res.status(200).json(await getHello(dto));
}