import PDFDocument from 'pdfkit';
import type { OrderWithRelations } from './order.service';
import { getPrismaClient } from '../../config/prisma.client';

export type ReceiptFormat = 'pdf' | 'escpos';

export type ReceiptData = {
  order: OrderWithRelations;
  storeName: string;
  storeAddress?: string;
  storePhone?: string;
  cashierName: string;
  isRefund?: boolean;
  refundAmountCents?: number;
  refundedLines?: { orderItemId: string; quantity: number; amountCents: number }[];
};

function formatDate(date: Date): string {
  return new Date(date).toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatMoney(cents: number, currency = '$'): string {
  return `${currency}${(cents / 100).toFixed(2)}`;
}

export async function getReceiptData(orderId: string): Promise<ReceiptData | null> {
  const prisma = getPrismaClient();

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        include: {
          product: { select: { name: true, sku: true, priceCents: true, taxRateBps: true } },
        },
      },
      payments: true,
      cashier: { select: { id: true, name: true, email: true } },
      customer: true,
      store: true,
    },
  });

  if (!order) {
    return null;
  }

  return {
    order,
    storeName: order.store?.name ?? 'POS Store',
    storeAddress: undefined,
    storePhone: undefined,
    cashierName: order.cashier?.name ?? 'Cashier',
  };
}

function buildEscposReceipt(data: ReceiptData): Buffer {
  const { order, storeName, storeAddress, storePhone, cashierName, isRefund, refundAmountCents, refundedLines } = data;

  // ESC/POS commands
  const ESC = '\x1b';
  const GS = '\x1d';
  const lines: string[] = [];

  // Initialize printer
  lines.push(`${ESC}@`); // Initialize
  lines.push(`${ESC}a\x01`); // Center align

  // Store header
  lines.push(`${ESC}!\x30`); // Double height/width
  lines.push(`${storeName}\n`);
  lines.push(`${ESC}!\x00`); // Normal size

  if (storeAddress) {
    lines.push(`${storeAddress}\n`);
  }
  if (storePhone) {
    lines.push(`Tel: ${storePhone}\n`);
  }

  lines.push('--------------------------------\n');
  lines.push(`${ESC}a\x00`); // Left align

  // Order info
  lines.push(`Order: ${order.orderNumber}\n`);
  lines.push(`Date: ${formatDate(order.createdAt)}\n`);
  lines.push(`Cashier: ${cashierName}\n`);

  if (order.customer) {
    lines.push(`Customer: ${order.customer.name}\n`);
  }

  lines.push('--------------------------------\n');

  // Items
  lines.push(`${ESC}!\x01`); // Bold
  lines.push('Item                 Qty  Total\n');
  lines.push(`${ESC}!\x00`); // Normal

  for (const item of order.items) {
    const name = item.nameSnapshot.length > 20 ? item.nameSnapshot.substring(0, 18) + '..' : item.nameSnapshot;
    const qty = item.quantity.toString().padStart(3);
    const total = formatMoney(item.lineTotalCents).padStart(8);
    lines.push(`${name.padEnd(20)} ${qty} ${total}\n`);

    // Show unit price
    const unitPrice = formatMoney(item.unitPriceCents);
    lines.push(`  @ ${unitPrice} x ${item.quantity}\n`);
  }

  lines.push('--------------------------------\n');

  // Totals
  const addTotals = (label: string, amount: number, bold = false) => {
    if (bold) lines.push(`${ESC}!\x01`);
    lines.push(`${label.padEnd(30)}${formatMoney(amount).padStart(10)}\n`);
    if (bold) lines.push(`${ESC}!\x00`);
  };

  addTotals('Subtotal', order.subtotalCents);
  if (order.discountCents > 0) {
    addTotals('Discount', -order.discountCents);
  }
  addTotals('Tax', order.taxCents);
  addTotals('TOTAL', order.totalCents, true);

  lines.push('--------------------------------\n');

  // Payments
  lines.push('Payments:\n');
  for (const payment of order.payments) {
    const method = payment.method;
    const amount = payment.amountCents;
    const sign = amount >= 0 ? '' : '-';
    lines.push(`  ${method.padEnd(10)} ${sign}${formatMoney(Math.abs(amount))}\n`);
  }

  if (isRefund && refundAmountCents && refundedLines) {
    lines.push('--------------------------------\n');
    lines.push(`${ESC}!\x01`);
    lines.push(`REFUND: ${formatMoney(refundAmountCents)}\n`);
    lines.push(`${ESC}!\x00`);
    for (const line of refundedLines) {
      lines.push(`  Refunded ${line.quantity} x ${formatMoney(line.amountCents / line.quantity)} each\n`);
    }
  }

  lines.push('--------------------------------\n');
  lines.push(`${ESC}a\x01`); // Center align
  lines.push('Thank you for your purchase!\n');
  lines.push('\n\n\n'); // Feed paper
  lines.push(`${GS}V\x00`); // Cut paper

  return Buffer.from(lines.join(''), 'utf8');
}

function buildPdfReceipt(data: ReceiptData): Promise<Buffer> {
  const { order, storeName, storeAddress, storePhone, cashierName, isRefund, refundAmountCents, refundedLines } = data;

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A6',
      margin: 20,
      bufferPages: true,
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    let y = 20;
    const pageWidth = doc.page.width - 40;

    // Store header
    doc.fontSize(16).font('Helvetica-Bold').text(storeName, 20, y, { width: pageWidth, align: 'center' });
    y += 24;

    if (storeAddress) {
      doc.fontSize(9).font('Helvetica').text(storeAddress, 20, y, { width: pageWidth, align: 'center' });
      y += 14;
    }
    if (storePhone) {
      doc.fontSize(9).font('Helvetica').text(`Tel: ${storePhone}`, 20, y, { width: pageWidth, align: 'center' });
      y += 14;
    }

    // Divider
    doc.moveTo(20, y).lineTo(doc.page.width - 20, y).stroke();
    y += 10;

    // Order info
    doc.fontSize(10).font('Helvetica');
    doc.text(`Order: ${order.orderNumber}`, 20, y);
    y += 14;
    doc.text(`Date: ${formatDate(order.createdAt)}`, 20, y);
    y += 14;
    doc.text(`Cashier: ${cashierName}`, 20, y);
    y += 14;

    if (order.customer) {
      doc.text(`Customer: ${order.customer.name}`, 20, y);
      y += 14;
    }

    // Divider
    doc.moveTo(20, y).lineTo(doc.page.width - 20, y).stroke();
    y += 10;

    // Items header
    doc.fontSize(10).font('Helvetica-Bold');
    const colItem = 20;
    const colQty = 260;
    const colPrice = 320;
    const colTotal = 380;

    doc.text('Item', colItem, y);
    doc.text('Qty', colQty, y, { width: 50, align: 'right' });
    doc.text('Price', colPrice, y, { width: 50, align: 'right' });
    doc.text('Total', colTotal, y, { width: 60, align: 'right' });
    y += 16;

    doc.moveTo(20, y).lineTo(doc.page.width - 20, y).stroke();
    y += 8;

    // Items
    doc.fontSize(9).font('Helvetica');
    for (const item of order.items) {
      const name = item.nameSnapshot.length > 26 ? item.nameSnapshot.substring(0, 24) + '..' : item.nameSnapshot;
      doc.text(name, colItem, y, { width: 230 });
      doc.text(item.quantity.toString(), colQty, y, { width: 50, align: 'right' });
      doc.text(formatMoney(item.unitPriceCents), colPrice, y, { width: 50, align: 'right' });
      doc.text(formatMoney(item.lineTotalCents), colTotal, y, { width: 60, align: 'right' });
      y += 14;

      // Show unit price detail
      doc.fontSize(8).fillColor('#666');
      doc.text(`  @ ${formatMoney(item.unitPriceCents)} x ${item.quantity}`, colItem, y, { width: 230 });
      doc.fillColor('#000').fontSize(9);
      y += 10;
    }

    doc.moveTo(20, y).lineTo(doc.page.width - 20, y).stroke();
    y += 10;

    // Totals
    const addTotal = (label: string, amount: number, bold = false) => {
      if (bold) doc.font('Helvetica-Bold').fontSize(11);
      else doc.font('Helvetica').fontSize(10);
      doc.text(label, colItem, y, { width: 280 });
      doc.text(formatMoney(amount), colTotal, y, { width: 80, align: 'right' });
      y += 16;
    };

    addTotal('Subtotal', order.subtotalCents);
    if (order.discountCents > 0) {
      doc.font('Helvetica').fontSize(10).fillColor('#dc2626');
      doc.text('Discount', colItem, y, { width: 280 });
      doc.text(`-${formatMoney(order.discountCents)}`, colTotal, y, { width: 80, align: 'right' });
      doc.fillColor('#000');
      y += 16;
    }
    addTotal('Tax', order.taxCents);
    addTotal('TOTAL', order.totalCents, true);

    doc.moveTo(20, y).lineTo(doc.page.width - 20, y).stroke();
    y += 10;

    // Payments
    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('Payments:', 20, y);
    y += 16;

    doc.fontSize(10).font('Helvetica');
    for (const payment of order.payments) {
      const sign = payment.amountCents >= 0 ? '' : '-';
      doc.text(`${payment.method}:`, 30, y, { width: 150 });
      doc.text(`${sign}${formatMoney(Math.abs(payment.amountCents))}`, colTotal, y, { width: 80, align: 'right' });
      y += 16;
    }

    if (isRefund && refundAmountCents && refundedLines) {
      doc.moveTo(20, y).lineTo(doc.page.width - 20, y).stroke();
      y += 10;
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#dc2626');
      doc.text(`REFUND: ${formatMoney(refundAmountCents)}`, 20, y, { width: pageWidth, align: 'center' });
      doc.fillColor('#000');
      y += 20;

      doc.fontSize(9).font('Helvetica');
      for (const line of refundedLines) {
        doc.text(`  Refunded ${line.quantity} x ${formatMoney(line.amountCents / line.quantity)} each`, 30, y, { width: 300 });
        y += 14;
      }
    }

    doc.moveTo(20, y).lineTo(doc.page.width - 20, y).stroke();
    y += 15;

    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('Thank you for your purchase!', 20, y, { width: pageWidth, align: 'center' });

    doc.end();
  });
}

export async function generateReceipt(
  orderId: string,
  format: ReceiptFormat = 'pdf',
  refundInfo?: { refundAmountCents: number; refundedLines: { orderItemId: string; quantity: number; amountCents: number }[] },
): Promise<Buffer | null> {
  const data = await getReceiptData(orderId);
  if (!data) {
    return null;
  }

  if (refundInfo) {
    data.isRefund = true;
    data.refundAmountCents = refundInfo.refundAmountCents;
    data.refundedLines = refundInfo.refundedLines;
  }

  if (format === 'escpos') {
    return buildEscposReceipt(data);
  }

  return buildPdfReceipt(data);
}

export function getReceiptMimeType(format: ReceiptFormat): string {
  return format === 'pdf' ? 'application/pdf' : 'application/octet-stream';
}

export function getReceiptFileName(orderNumber: string, format: ReceiptFormat): string {
  const ext = format === 'pdf' ? 'pdf' : 'txt';
  return `receipt-${orderNumber}.${ext}`;
}