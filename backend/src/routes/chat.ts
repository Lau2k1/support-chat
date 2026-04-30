import jwt from 'jsonwebtoken';
import { Router } from 'express';
import { pool } from '../db';
import { authMiddleware } from '../middleware/auth';
import { SECRET } from '../middleware/auth';

const router = Router();

router.get('/archive', authMiddleware, async (_req, res) => {
  const result = await pool.query(
    "SELECT id, extract(epoch from updated_at) * 1000 as updated_at FROM chats WHERE status = 'closed' ORDER BY updated_at DESC LIMIT 50"
  );
  res.json(result.rows);
});

router.get('/messages/:chatId', async (req, res) => {
  const chatId = req.params.chatId;

  const chatRes = await pool.query('SELECT status FROM chats WHERE id = $1', [chatId]);
  if (!chatRes.rows.length) {
    return res.status(404).json({ error: 'Chat not found' });
  }

  if (chatRes.rows[0].status === 'closed') {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Auth required for archived chats' });
    }
    try {
      jwt.verify(authHeader.split(' ')[1], SECRET);
    } catch {
      return res.status(401).json({ error: 'Invalid token' });
    }
  }

  const result = await pool.query(
    "SELECT id, chat_id, sender_id, content, message_type, file_url, extract(epoch from created_at) * 1000 as created_at FROM messages WHERE chat_id = $1 ORDER BY created_at ASC",
    [chatId]
  );
  res.json(result.rows);
});

router.get('/chat-status/:id', async (req, res) => {
  const result = await pool.query('SELECT status FROM chats WHERE id = $1', [req.params.id]);
  res.json(result.rows[0] || { status: 'not_found' });
});

export default router;
