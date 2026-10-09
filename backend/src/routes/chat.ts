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

router.get('/chats', authMiddleware, async (req, res) => {
  try {
    const { tagId, status, from, to, limit = '50', offset = '0' } = req.query;
    let sql = `
      SELECT c.id, c.client_id, c.client_name, c.client_device, c.client_region, c.status, c.rating, c.assigned_operator_id,
             o.name AS operator_name,
             extract(epoch from c.created_at) * 1000 AS created_at,
             extract(epoch from c.updated_at) * 1000 AS updated_at,
             (SELECT COUNT(*)::int FROM messages m WHERE m.chat_id = c.id) AS messages_count,
             COALESCE(ARRAY_AGG(t.id || ':' || t.name || ':' || COALESCE(t.color, '')) FILTER (WHERE t.id IS NOT NULL), '{}') AS tags
      FROM chats c
      LEFT JOIN operators o ON c.assigned_operator_id = o.id
      LEFT JOIN chat_tags ct ON c.id = ct.chat_id
      LEFT JOIN tags t ON ct.tag_id = t.id
      WHERE 1=1
    `;
    const params: any[] = [];
    let idx = 1;

    if (status) { sql += ` AND c.status = $${idx++}`; params.push(status); }
    if (tagId) {
      if (Array.isArray(tagId)) {
        sql += ` AND c.id IN (SELECT chat_id FROM chat_tags WHERE tag_id = ANY($${idx++}::int[]))`;
        params.push(tagId.map(Number));
      } else {
        sql += ` AND c.id IN (SELECT chat_id FROM chat_tags WHERE tag_id = $${idx++})`;
        params.push(Number(tagId));
      }
    }
    if (from) { sql += ` AND c.created_at >= $${idx++}`; params.push(from); }
    if (to) { sql += ` AND c.created_at <= $${idx++}`; params.push(to); }

    sql += ` GROUP BY c.id, o.name ORDER BY c.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(Number(limit), Number(offset));

    const result = await pool.query(sql, params);
    res.json(result.rows.map(row => ({
      ...row,
      tags: row.tags.filter((t: string) => t !== '').map((t: string) => {
        const [id, name, color] = t.split(':');
        return { id: Number(id), name, color: color || null };
      })
    })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'DB Error' });
  }
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

  const isOperator = !!req.headers.authorization;
  if (isOperator) {
    res.json(result.rows);
  } else {
    res.json(result.rows.filter((m: any) => m.message_type !== 'note'));
  }
});

router.get('/chat-status/:id', async (req, res) => {
  const result = await pool.query('SELECT status FROM chats WHERE id = $1', [req.params.id]);
  res.json(result.rows[0] || { status: 'not_found' });
});

router.put('/chats/:chatId/tag', authMiddleware, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { tagId } = req.body;
    if (!tagId || isNaN(Number(tagId))) return res.status(400).json({ error: 'Invalid tagId' });

    // Check if chat exists
    const chatCheck = await pool.query('SELECT id FROM chats WHERE id = $1', [chatId]);
    if (!chatCheck.rows.length) return res.status(404).json({ error: 'Chat not found' });

    // Check if tag exists
    const tagCheck = await pool.query('SELECT id FROM tags WHERE id = $1', [tagId]);
    if (!tagCheck.rows.length) return res.status(404).json({ error: 'Tag not found' });

    // Insert if not exists
    await pool.query(
      'INSERT INTO chat_tags (chat_id, tag_id) VALUES ($1, $2) ON CONFLICT (chat_id, tag_id) DO NOTHING',
      [chatId, tagId]
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

router.delete('/chats/:chatId/tag/:tagId', authMiddleware, async (req, res) => {
  try {
    const { chatId, tagId } = req.params;
    const result = await pool.query(
      'DELETE FROM chat_tags WHERE chat_id = $1 AND tag_id = $2 RETURNING chat_id',
      [chatId, tagId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Tag not assigned to chat' });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

export default router;
