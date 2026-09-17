import { Request, Response } from 'express';
import { conflict, unauthorized, unprocessable, notFound } from '../common/errors';
import { ensureOverride } from '../common/guards/auth.guard';
import { createOrderSchema, listOrdersSchema, refundOrderSchema, receiptQuerySchema, receiptDeliverySchema } from '../../zod/order.schema';
import { idParamSchema } from '../../zod/shared';
import { getEnv } from '../../config/env';
import {
  beginIdempotency,
  extractIdempotencyKey,
  releaseIdempotency,
  storeIdempotentResponse,
} from '../services/idempotency.service';
import { createOrder, finalizeOrderSideEffects, getOrder, listOrders, refundOrder, voidOrder } from '../services/order.service';
import { generateReceipt, getReceiptMimeType, getReceiptFileName } from '../services/receipt.service';
import { deliverReceipt, type ReceiptChannel } from '../services/receipt-delivery.service';
import type { ReceiptQueryDto, ReceiptDeliveryDto } from '../../zod/order.schema';

export async function handleCreateOrder(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw unauthorized();
  }

  const dto = createOrderSchema.parse(req.body);

  const env = getEnv();
  if (env.DISCOUNT_OVERRIDE_CENTS > 0 && dto.discountCents > env.DISCOUNT_OVERRIDE_CENTS) {
    ensureOverride(req);
  }

  const idempotencyKey = extractIdempotencyKey(req.headers['idempotency-key']);

  let claimed = false;
  if (idempotencyKey) {
    const outcome = await beginIdempotency<unknown>(idempotencyKey);

    if (outcome.kind === 'replay') {
      res.status(201).json(outcome.response);
      return;
    }

    if (outcome.kind === 'in-flight') {
      throw conflict(
        'A request with this Idempotency-Key is already being processed',
        'IDEMPOTENCY_IN_FLIGHT',
      );
    }

    claimed = true;
  }

  try {
    const result = await createOrder(dto, req.user.id);
    const response = {
      order: result.order,
      changeCents: result.order.changeCents,
    };

    await finalizeOrderSideEffects(result);

    if (idempotencyKey && claimed) {
      await storeIdempotentResponse(idempotencyKey, response);
    }

    res.status(201).json(response);
  } catch (error) {
    if (idempotencyKey && claimed) {
      await releaseIdempotency(idempotencyKey);
    }

    if (error instanceof Error && error.message === 'Idempotency-Key must be between 8 and 128 characters') {
      throw unprocessable(error.message, 'INVALID_IDEMPOTENCY_KEY');
    }

    throw error;
  }
}

export async function handleListOrders(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw unauthorized();
  }

  const dto = listOrdersSchema.parse(req.query);

  const effectiveFilters = dto.cashierId
    ? dto
    : (req.user.role === 'CASHIER' ? { ...dto, cashierId: req.user.id } : dto);

  res.status(200).json(await listOrders(effectiveFilters));
}

export async function handleGetOrder(req: Request, res: Response): Promise<void> {
  const { id } = idParamSchema.parse(req.params);
  res.status(200).json(await getOrder(id));
}

export async function handleVoidOrder(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw unauthorized();
  }

  const { id } = idParamSchema.parse(req.params);
  const authorizedBy = req.override?.userId ?? null;
  res.status(200).json(await voidOrder(id, req.user.id, authorizedBy));
}

export async function handleRefundOrder(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw unauthorized();
  }

  const { id } = idParamSchema.parse(req.params);
  const dto = refundOrderSchema.parse(req.body);
  const authorizedBy = req.override?.userId ?? null;

  res.status(200).json(await refundOrder(id, dto, req.user.id, authorizedBy));
}

export async function handleGetReceipt(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw unauthorized();
  }

  const { id } = idParamSchema.parse(req.params);
  const query = receiptQuerySchema.parse(req.query) as ReceiptQueryDto;

  // Get order to check it exists and get order number for filename
  const order = await getOrder(id);

  const receiptBuffer = await generateReceipt(id, query.format);
  if (!receiptBuffer) {
    throw notFound('Order not found');
  }

  res.setHeader('Content-Type', getReceiptMimeType(query.format));
  res.setHeader('Content-Disposition', `attachment; filename="${getReceiptFileName(order.orderNumber, query.format)}"`);
  res.status(200).send(receiptBuffer);
}

export async function handleDeliverReceipt(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw unauthorized();
  }

  const { id } = idParamSchema.parse(req.params);
  const dto = receiptDeliverySchema.parse(req.body) as ReceiptDeliveryDto;

  // Verify order exists
  const order = await getOrder(id);

  const results = await deliverReceipt(
    id,
    dto.channels as ReceiptChannel[],
    dto.target,
    dto.consent,
    dto.format,
  );

  const allSuccess = results.every((r) => r.success);
  const anySuccess = results.some((r) => r.success);

  res.status(allSuccess ? 200 : anySuccess ? 207 : 502).json({
    orderId: order.id,
    orderNumber: order.orderNumber,
    results,
    summary: {
      total: results.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
    },
  });
}
