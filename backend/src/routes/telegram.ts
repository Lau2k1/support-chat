import { Router } from 'express';
import { pool } from '../db';
import { handleTelegramUpdate } from '../services/telegram';

/**
 * Telegram webhook receiver (PLAN 9.2).
 *
 * Mounted at /api/tg. Telegram calls POST /api/tg/:botId with the header
 * X-Telegram-Bot-Api-Secret-Token set to the per-bot secret we registered.
 */
const router = Router();

router.post('/:botId', async (req, res) => {
  const botId = Number(req.params.botId);
  if (!Number.isInteger(botId) || botId <= 0) {
    return res.sendStatus(404);
  }

  try {
    const botRes = await pool.query(
      'SELECT id, webhook_secret, is_active FROM telegram_bots WHERE id = $1',
      [botId]
    );
    const bot = botRes.rows[0];
    if (!bot || !bot.is_active) {
      return res.sendStatus(404);
    }

    const secret = req.header('X-Telegram-Bot-Api-Secret-Token');
    if (!secret || secret !== bot.webhook_secret) {
      return res.sendStatus(401);
    }

    await handleTelegramUpdate(botId, req.body);
  } catch (e) {
    // Always ack with 200 so Telegram does not retry-storm us; log for ops.
    console.error('Telegram webhook error:', e);
  }
  res.sendStatus(200);
});

export default router;
