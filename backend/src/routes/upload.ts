import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { pool } from '../db';
import { authMiddleware, resolveOperator, AuthenticatedRequest } from '../middleware/auth';
import { broadcastToRoom } from '../services/chat';
import type { OutgoingMessage } from '../ws/types';

const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '../../uploads'),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, crypto.randomUUID() + ext);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.doc', '.docx', '.txt'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

/**
 * Resolves the caller of a client-facing endpoint: either an authenticated
 * operator or the owner of the chat (proofed by its client token).
 */
async function resolveCaller(req: AuthenticatedRequest, chatId: number) {
  const authHeader = req.headers.authorization;
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;
  const operator = bearer ? await resolveOperator(bearer) : null;

  const clientToken =
    (typeof req.query.token === 'string' ? req.query.token : undefined) ||
    (typeof req.headers['x-client-token'] === 'string' ? req.headers['x-client-token'] : undefined);
  const owner = clientToken
    ? await pool.query('SELECT client_token FROM chats WHERE id = $1', [chatId])
    : null;
  const isOwner = !!owner?.rows[0] && owner.rows[0].client_token === clientToken;

  return { operator, isOwner };
}

const router = Router();

router.post('/upload/:chatId', upload.single('file'), async (req, res) => {
  const file = req.file as Express.Multer.File;
  if (!file) return res.status(400).json({ error: 'No file' });

  const chatId = Number(req.params.chatId);
  if (!Number.isInteger(chatId) || chatId <= 0) {
    return res.status(400).json({ error: 'Invalid chat id' });
  }

  const chatCheck = await pool.query('SELECT status FROM chats WHERE id = $1', [chatId]);
  if (!chatCheck.rows.length || chatCheck.rows[0].status === 'closed') {
    return res.status(404).json({ error: 'Chat not found or closed' });
  }

  const { operator, isOwner } = await resolveCaller(req, chatId);
  if (!operator && !isOwner) {
    return res.status(401).json({ error: 'Auth required' });
  }

  const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(file.originalname);
  const message_type = isImage ? 'image' : 'file';
  const fileUrl = `/uploads/${file.filename}`;
  const content = file.originalname;

  const senderId = operator?.id || 0;

  const result = await pool.query(
    "INSERT INTO messages (chat_id, sender_id, content, message_type, file_url) VALUES ($1, $2, $3, $4, $5) RETURNING *, extract(epoch from created_at) * 1000 as created_at",
    [chatId, senderId, content, message_type, fileUrl]
  );

  // Push the stored message into the chat room (widget client + operators) so
  // everyone sees the upload without a separate WS round-trip. The message is
  // re-read from the DB row (server-side), so clients can't forge file_url.
  const timeUpdate = await pool.query(
    'UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING extract(epoch from updated_at) * 1000 as updated_at',
    [chatId]
  );
  const serverTime = Number(timeUpdate.rows[0].updated_at);

  const out: OutgoingMessage = {
    type: 'message',
    message: {
      ...result.rows[0],
      sender_name: operator?.name || 'Клиент',
      message_type: result.rows[0].message_type || 'file',
      file_url: result.rows[0].file_url || null,
    },
    updated_at: serverTime,
  };
  broadcastToRoom(chatId, out);

  res.json(result.rows[0]);
});

router.post('/rate/:chatId', async (req, res) => {
  const chatId = Number(req.params.chatId);
  if (!Number.isInteger(chatId) || chatId <= 0) {
    return res.status(400).json({ error: 'Invalid chat id' });
  }
  const { rating } = req.body;
  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Rating must be 1-5' });
  }

  const { operator, isOwner } = await resolveCaller(req, chatId);
  if (!operator && !isOwner) {
    return res.status(401).json({ error: 'Auth required' });
  }

  const result = await pool.query(
    'UPDATE chats SET rating = $1 WHERE id = $2 AND status = $3 RETURNING id',
    [rating, chatId, 'closed']
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Chat not found or not closed' });
  res.json({ ok: true });
});

router.get('/stats', authMiddleware, async (_req, res) => {
  const totalChats = await pool.query('SELECT COUNT(*)::int AS count FROM chats');
  const openChats = await pool.query("SELECT COUNT(*)::int AS count FROM chats WHERE status = 'open'");
  const closedChats = await pool.query("SELECT COUNT(*)::int AS count FROM chats WHERE status = 'closed'");

  const avgResponse = await pool.query(`
    SELECT COALESCE(AVG(diff), 0) AS avg_seconds FROM (
      SELECT EXTRACT(EPOCH FROM (m1.created_at - c.created_at)) AS diff
      FROM messages m1
      JOIN chats c ON c.id = m1.chat_id
      WHERE m1.sender_id != 0
        AND m1.id = (
          SELECT MIN(m2.id) FROM messages m2
          WHERE m2.chat_id = c.id AND m2.sender_id != 0
        )
        AND c.created_at > NOW() - INTERVAL '30 days'
    ) sub
  `);

  const avgRating = await pool.query('SELECT COALESCE(AVG(rating), 0) AS avg_rating FROM chats WHERE rating IS NOT NULL');
  const totalMessages = await pool.query('SELECT COUNT(*)::int AS count FROM messages');

  res.json({
    totalChats: totalChats.rows[0].count,
    openChats: openChats.rows[0].count,
    closedChats: closedChats.rows[0].count,
    totalMessages: totalMessages.rows[0].count,
    avgResponseSec: Math.round(Number(avgResponse.rows[0].avg_seconds)),
    avgRating: Math.round(Number(avgRating.rows[0].avg_rating) * 10) / 10,
  });
});

router.get('/stats/daily', authMiddleware, async (_req, res) => {
  const result = await pool.query(`
    SELECT TO_CHAR(date, 'DD.MM') AS day, COALESCE(count, 0) AS count
    FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, '1 day') AS date
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS count FROM chats WHERE DATE(created_at) = date
    ) c ON true
    ORDER BY date
  `);
  res.json(result.rows);
});

export { upload };
export default router;
