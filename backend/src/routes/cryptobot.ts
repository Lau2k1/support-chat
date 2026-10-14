import { Router, type Request } from 'express';
import { pool } from '../db';
import { verifyWebhookSignature } from '../services/cryptobot';
import { markPaymentPaid } from '../services/billing';

/**
 * Crypto Pay API webhook receiver. Configure the URL in the CryptoBot app
 * settings: https://<PUBLIC_BASE_URL>/api/cryptobot/webhook
 *
 * The raw request body is required to verify the HMAC signature (see server.ts).
 */
interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

const router = Router();

router.post('/webhook', async (req, res) => {
  const raw = (req as RawBodyRequest).rawBody;
  const signature = req.header('crypto-pay-api-signature');
  if (!raw || !verifyWebhookSignature(raw, signature)) {
    return res.sendStatus(401);
  }

  try {
    const update = (req.body ?? {}) as { update_type?: string; payload?: { invoice_id?: number } };
    if (update.update_type === 'invoice_paid') {
      const invoiceId = update.payload?.invoice_id;
      if (invoiceId !== undefined && invoiceId !== null) {
        const r = await pool.query('SELECT id, status FROM payments WHERE provider_invoice_id = $1', [String(invoiceId)]);
        if (r.rows.length && r.rows[0].status === 'pending') {
          await markPaymentPaid(r.rows[0].id, { method: 'cryptobot' });
        }
      }
    }
  } catch (e) {
    // Always ack so CryptoBot does not retry-storm us.
    console.error('cryptobot webhook error:', e);
  }
  res.sendStatus(200);
});

export default router;
