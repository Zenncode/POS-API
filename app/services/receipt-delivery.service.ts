import { getPrismaClient } from '../../config/prisma.client';
import { generateReceipt, type ReceiptFormat } from './receipt.service';
import { sendReceiptEmail } from './email.service';
import { sendReceiptSms } from './sms.service';
import { writeAuditLog } from './audit.service';

export type ReceiptChannel = 'EMAIL' | 'SMS' | 'PRINT';

export interface ReceiptDeliveryRequest {
  orderId: string;
  channels: ReceiptChannel[];
  target: string; // email or phone
  consent: boolean;
  format?: ReceiptFormat;
}

export interface ReceiptDeliveryResult {
  channel: ReceiptChannel;
  target: string;
  success: boolean;
  messageId?: string;
  error?: string;
}

export async function deliverReceipt(
  orderId: string,
  channels: ReceiptChannel[],
  target: string,
  consent: boolean,
  format: ReceiptFormat = 'pdf',
): Promise<ReceiptDeliveryResult[]> {
  const prisma = getPrismaClient();

  // Get order data
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      totalCents: true,
      customer: { select: { email: true, phone: true, name: true } },
    },
  });

  if (!order) {
    throw new Error('Order not found');
  }

  // Generate receipt once
  const receiptBuffer = await generateReceipt(orderId, format);
  if (!receiptBuffer) {
    throw new Error('Failed to generate receipt');
  }

  const results: ReceiptDeliveryResult[] = [];

  for (const channel of channels) {
    let result: ReceiptDeliveryResult;

    switch (channel) {
      case 'EMAIL': {
        const emailResult = await sendReceiptEmail(target, order.orderNumber, receiptBuffer);
        result = {
          channel: 'EMAIL',
          target,
          success: emailResult.success,
          messageId: emailResult.messageId,
          error: emailResult.error,
        };
        break;
      }

      case 'SMS': {
        const smsResult = await sendReceiptSms(target, order.orderNumber, order.totalCents);
        result = {
          channel: 'SMS',
          target,
          success: smsResult.success,
          messageId: smsResult.messageId,
          error: smsResult.error,
        };
        break;
      }

      case 'PRINT': {
        // Print is handled client-side via the ESC/POS format
        // Here we just record that a print was requested
        result = {
          channel: 'PRINT',
          target: 'local-printer',
          success: true,
          messageId: `print-${Date.now()}`,
        };
        break;
      }

      default:
        result = {
          channel,
          target,
          success: false,
          error: `Unknown channel: ${channel}`,
        };
    }

    results.push(result);

    // Audit log each delivery attempt
    await writeAuditLog({
      action: 'RECEIPT_DELIVERY',
      entity: 'Order',
      entityId: orderId,
      metadata: {
        channel,
        target,
        success: result.success,
        messageId: result.messageId,
        error: result.error,
      },
      result: result.success ? 'SUCCESS' : 'FAILURE',
    });
  }

  // Store at least one receipt record per completed sale (FR-52)
  // Even if all deliveries fail, we record the receipt as stored locally
  const allFailed = results.every((r) => !r.success);
  if (allFailed) {
    await writeAuditLog({
      action: 'RECEIPT_STORED_LOCALLY',
      entity: 'Order',
      entityId: orderId,
      metadata: {
        reason: 'All delivery channels failed',
        channels: channels.map((c) => c),
      },
      result: 'SUCCESS',
    });
  }

  return results;
}

export async function getReceiptDeliveryHistory(orderId: string): Promise<Array<{
  id: string;
  channel: string;
  destination: string;
  status: string;
  sentAt: Date;
  error?: string;
}>> {
  const prisma = getPrismaClient();

  const logs = await prisma.auditLog.findMany({
    where: {
      entity: 'Order',
      entityId: orderId,
      action: { in: ['RECEIPT_DELIVERY', 'RECEIPT_STORED_LOCALLY'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return logs.map((log) => ({
    id: log.id,
    channel: (log.metadata as any)?.channel ?? 'UNKNOWN',
    destination: (log.metadata as any)?.target ?? 'UNKNOWN',
    status: log.result,
    sentAt: log.createdAt,
    error: (log.metadata as any)?.error,
  }));
}