import { createTransport, Transporter, SentMessageInfo } from 'nodemailer';
import { getEnv } from '../../config/env';

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  const env = getEnv();

  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) {
    return null;
  }

  if (!transporter) {
    transporter = createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
    });
  }

  return transporter;
}

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
}

export async function sendEmail(options: EmailOptions): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const tx = getTransporter();

  if (!tx) {
    return { success: false, error: 'SMTP not configured' };
  }

  try {
    const info: SentMessageInfo = await tx.sendMail({
      from: getEnv().SMTP_FROM ?? 'POS System <noreply@pos.local>',
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      attachments: options.attachments,
    });

    return { success: true, messageId: info.messageId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown email error';
    return { success: false, error: message };
  }
}

export async function sendReceiptEmail(
  to: string,
  orderNumber: string,
  pdfBuffer: Buffer,
  isRefund = false,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const subject = isRefund ? `Refund Receipt - ${orderNumber}` : `Receipt - ${orderNumber}`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #2563eb;">${isRefund ? 'Refund' : 'Sales'} Receipt</h2>
      <p>Thank you for your ${isRefund ? 'refund' : 'purchase'}!</p>
      <p><strong>Order Number:</strong> ${orderNumber}</p>
      <p>Please find your receipt attached as a PDF.</p>
      <hr style="margin: 20px 0;" />
      <p style="color: #6b7280; font-size: 12px;">This is an automated message from POS System.</p>
    </div>
  `;

  return sendEmail({
    to,
    subject,
    html,
    text: `${isRefund ? 'Refund' : 'Sales'} Receipt - ${orderNumber}\n\nThank you for your ${isRefund ? 'refund' : 'purchase'}!\nOrder Number: ${orderNumber}\n\nPlease find your receipt attached.`,
    attachments: [
      {
        filename: `receipt-${orderNumber}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  });
}