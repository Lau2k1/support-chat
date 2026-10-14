import crypto from 'crypto';

/**
 * Crypto Pay API (CryptoBot, Telegram) integration.
 *
 * Docs: https://help.crypt.bot/crypto-pay-api
 * Auth:  header `Crypto-Pay-API-Token: <token>` on every request.
 *
 * The integration is optional: when CRYPTOBOT_TOKEN is empty the billing layer
 * falls back to manual confirmation by the platform owner (CRM). This lets the
 * product go live before the merchant account is ready.
 */

const API_BASE = (process.env.CRYPTOBOT_API_BASE || 'https://pay.crypt.bot/api').replace(/\/$/, '');
const TOKEN = (process.env.CRYPTOBOT_TOKEN || '').trim();

// Fiat (USD) invoices by default; can be switched to a crypto asset via env.
const CURRENCY_TYPE = (process.env.CRYPTOBOT_CURRENCY_TYPE || 'fiat').trim();
const FIAT = (process.env.CRYPTOBOT_FIAT || 'USD').trim();
const ASSET = (process.env.CRYPTOBOT_ASSET || 'USDT').trim();

export function isConfigured(): boolean {
  return TOKEN.length > 0;
}

export interface CryptoInvoice {
  invoice_id: number;
  status: string;
  amount: string;
  pay_url: string;
  bot_invoice_url?: string;
  mini_app_invoice_url?: string;
  web_app_invoice_url?: string;
}

interface CryptoResponse<T> {
  ok: boolean;
  result?: T;
  error?: { code: number; name: string };
}

async function call<T>(method: string, body: Record<string, unknown>): Promise<T> {
  if (!isConfigured()) throw new Error('CryptoBot is not configured');
  const res = await fetch(`${API_BASE}/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Crypto-Pay-API-Token': TOKEN,
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as CryptoResponse<T> | null;
  if (!res.ok || !data || !data.ok || !data.result) {
    const name = data?.error?.name || `HTTP ${res.status}`;
    throw new Error(`CryptoBot ${method} failed: ${name}`);
  }
  return data.result;
}

/** USD cents -> Crypto Pay amount string ("8.99"). */
function toAmount(amountCents: number): string {
  return (amountCents / 100).toFixed(2);
}

export async function createInvoice(params: {
  amountCents: number;
  description: string;
  payload: string;
  expiresInSeconds?: number;
}): Promise<CryptoInvoice> {
  const body: Record<string, unknown> = {
    amount: toAmount(params.amountCents),
    description: params.description.slice(0, 1024),
    payload: params.payload.slice(0, 4096),
    expires_in: params.expiresInSeconds ?? 3600,
  };
  if (CURRENCY_TYPE === 'fiat') {
    body.currency_type = 'fiat';
    body.fiat = FIAT;
  } else {
    body.currency_type = 'crypto';
    body.asset = ASSET;
  }
  return call<CryptoInvoice>('createInvoice', body);
}

/** Looks up a single invoice by id (used to poll a pending payment). */
export async function getInvoice(invoiceId: string | number): Promise<CryptoInvoice | null> {
  const result = await call<{ items: CryptoInvoice[] }>('getInvoices', {
    invoice_ids: String(invoiceId),
  });
  return result.items?.[0] ?? null;
}

/**
 * Verifies the `crypto-pay-api-signature` header: HMAC-SHA-256 of the raw
 * request body, keyed with SHA-256(token).
 */
export function verifyWebhookSignature(rawBody: string | Buffer, signature: string | undefined): boolean {
  if (!signature || !TOKEN) return false;
  const secret = crypto.createHash('sha256').update(TOKEN).digest();
  const computed = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(computed, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
