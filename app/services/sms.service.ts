import { getEnv } from '../../config/env';
import { createHmac } from 'crypto';

export interface SmsOptions {
  to: string;
  body: string;
}

export interface SmsResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

async function sendTwilio(to: string, body: string): Promise<SmsResult> {
  const env = getEnv();

  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM_NUMBER) {
    return { success: false, error: 'Twilio not configured' };
  }

  try {
    const accountSid = env.TWILIO_ACCOUNT_SID;
    const authToken = env.TWILIO_AUTH_TOKEN;

    // Using fetch to avoid adding twilio dependency
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        From: env.TWILIO_FROM_NUMBER,
        To: to,
        Body: body,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error: `Twilio API error: ${error}` };
    }

    const data = await response.json();
    return { success: true, messageId: data.sid };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Twilio error';
    return { success: false, error: message };
  }
}

async function sendVonage(to: string, body: string): Promise<SmsResult> {
  const env = getEnv();

  if (!env.VONAGE_API_KEY || !env.VONAGE_API_SECRET || !env.VONAGE_FROM_NUMBER) {
    return { success: false, error: 'Vonage not configured' };
  }

  try {
    const response = await fetch('https://api.nexmo.com/v0.1/messages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${generateVonageJwt(env.VONAGE_API_KEY, env.VONAGE_API_SECRET)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: { type: 'sms', number: env.VONAGE_FROM_NUMBER },
        to: { type: 'sms', number: to },
        message: { content: { type: 'text', text: body } },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error: `Vonage API error: ${error}` };
    }

    const data = await response.json();
    return { success: true, messageId: data.message_uuid };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Vonage error';
    return { success: false, error: message };
  }
}

function generateVonageJwt(apiKey: string, apiSecret: string): string {
  // Simplified JWT generation for Vonage - in production use a proper library
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ iat: now, jti: `${apiKey}-${now}`, exp: now + 3600 })).toString('base64url');
  const signature = createHmac('sha256', apiSecret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

async function sendMock(to: string, body: string): Promise<SmsResult> {
  // Mock implementation for development - logs to console
  console.log(`[MOCK SMS] To: ${to}`);
  console.log(`[MOCK SMS] Body: ${body}`);
  return { success: true, messageId: `mock-${Date.now()}` };
}

export async function sendSms(options: SmsOptions): Promise<SmsResult> {
  const env = getEnv();

  switch (env.SMS_PROVIDER) {
    case 'twilio':
      return sendTwilio(options.to, options.body);
    case 'vonage':
      return sendVonage(options.to, options.body);
    case 'mock':
    default:
      return sendMock(options.to, options.body);
  }
}

export async function sendReceiptSms(
  to: string,
  orderNumber: string,
  totalCents: number,
  isRefund = false,
): Promise<SmsResult> {
  const formatMoney = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const body = isRefund
    ? `Refund processed for order ${orderNumber}. Amount: ${formatMoney(totalCents)}. Thank you!`
    : `Receipt for order ${orderNumber}. Total: ${formatMoney(totalCents)}. Thank you for your purchase!`;

  return sendSms({ to, body });
}