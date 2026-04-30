import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { pool } from '../db';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';

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

const router = Router();

router.post('/upload/:chatId', upload.single('file'), async (req, res) => {
  const file = req.file as Express.Multer.File;
  if (!file) return res.status(400).json({ error: 'No file' });

  const chatId = Number(req.params.chatId);
  const chatCheck = await pool.query('SELECT status FROM chats WHERE id = $1', [chatId]);
  if (!chatCheck.rows.length || chatCheck.rows[0].status === 'closed') {
    return res.status(404).json({ error: 'Chat not found or closed' });
  }

  const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(file.originalname);
  const message_type = isImage ? 'image' : 'file';
  const fileUrl = `/uploads/${file.filename}`;
  const content = file.originalname;

  const senderId = (req as AuthenticatedRequest).user?.id || 0;

  const result = await pool.query(
    "INSERT INTO messages (chat_id, sender_id, content, message_type, file_url) VALUES ($1, $2, $3, $4, $5) RETURNING *, extract(epoch from created_at) * 1000 as created_at",
    [chatId, senderId, content, message_type, fileUrl]
  );

  res.json(result.rows[0]);
});

router.post('/rate/:chatId', async (req, res) => {
  const chatId = Number(req.params.chatId);
  const { rating } = req.body;
  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Rating must be 1-5' });
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

export { upload };
export default router;
