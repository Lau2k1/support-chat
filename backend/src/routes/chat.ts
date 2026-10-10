import { Router } from 'express';
import { pool } from '../db';
import { authMiddleware, resolveOperator, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

router.get('/archive', authMiddleware, async (req, res) => {
  const user = (req as AuthenticatedRequest).user!;
  const scopeSql = user.role !== 'superadmin' ? ' AND tenant_id = $1' : '';
  const params = user.role !== 'superadmin' ? [user.tenantId] : [];
  const result = await pool.query(
    `SELECT id, extract(epoch from updated_at) * 1000 as updated_at FROM chats WHERE status = 'closed'${scopeSql} ORDER BY updated_at DESC LIMIT 50`,
    params
  );
  res.json(result.rows);
});

router.get('/chats', authMiddleware, async (req, res) => {
  try {
    const user = (req as AuthenticatedRequest).user!;
    const { status, from, to, limit = '50', offset = '0' } = req.query;
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

    if (user.role !== 'superadmin') {
      sql += ` AND c.tenant_id = $${idx++}`;
      params.push(user.tenantId);
    }
    if (status) { sql += ` AND c.status = $${idx++}`; params.push(status); }
    // Accept every shape the frontends send: a single id, an id[] array, or a
    // comma-separated string. (With Express 5's 'simple' query parser, axios's
    // default `tagId[]=1&tagId[]=2` keeps the literal key `tagId[]`.)
    const rawTagId = req.query.tagId ?? (req.query as any)['tagId[]'];
    if (rawTagId !== undefined) {
      const parts = Array.isArray(rawTagId) ? rawTagId : [rawTagId];
      const tagIds: number[] = [];
      for (const part of parts) {
        if (typeof part === 'string' && part.length > 0) {
          tagIds.push(...part.split(',').map(Number));
        } else if (typeof part === 'number' && Number.isInteger(part)) {
          tagIds.push(part);
        }
      }
      const clean = tagIds.filter((n) => Number.isInteger(n) && n > 0);
      if (clean.length > 1) {
        sql += ` AND c.id IN (SELECT chat_id FROM chat_tags WHERE tag_id = ANY($${idx++}::int[]))`;
        params.push(clean);
      } else if (clean.length === 1) {
        sql += ` AND c.id IN (SELECT chat_id FROM chat_tags WHERE tag_id = $${idx++})`;
        params.push(clean[0]);
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

  const chatRes = await pool.query(
    'SELECT status, client_token, tenant_id FROM chats WHERE id = $1',
    [chatId]
  );
  if (!chatRes.rows.length) {
    return res.status(404).json({ error: 'Chat not found' });
  }

  // Two ways in: a valid operator token, or the opaque client token issued
  // when the chat was created (proves the caller owns this chat).
  const authHeader = req.headers.authorization;
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;
  const operator = bearer ? await resolveOperator(bearer) : null;

  if (operator && operator.role !== 'superadmin' && chatRes.rows[0].tenant_id !== operator.tenantId) {
    return res.status(403).json({ error: 'Chat belongs to another tenant' });
  }

  const clientToken =
    (typeof req.query.token === 'string' ? req.query.token : undefined) ||
    (typeof req.headers['x-client-token'] === 'string' ? req.headers['x-client-token'] : undefined);
  const isOwner = !!clientToken && chatRes.rows[0].client_token === clientToken;

  if (!operator && !isOwner) {
    return res.status(401).json({ error: 'Auth required' });
  }

  const result = await pool.query(
    "SELECT id, chat_id, sender_id, content, message_type, file_url, extract(epoch from created_at) * 1000 as created_at FROM messages WHERE chat_id = $1 ORDER BY created_at ASC",
    [chatId]
  );

  if (operator) {
    res.json(result.rows);
  } else {
    res.json(result.rows.filter((m: any) => m.message_type !== 'note'));
  }
});

router.get('/chat-status/:id', async (req, res) => {
  const result = await pool.query('SELECT status FROM chats WHERE id = $1', [req.params.id]);
  res.json(result.rows[0] || { status: 'not_found' });
});

async function isOwnResource(client: any, chatId: number | string, tagId: number | string): Promise<boolean> {
  const chatCheck = await pool.query(
    'SELECT c.id, c.tenant_id FROM chats c WHERE c.id = $1',
    [chatId]
  );
  if (!chatCheck.rows.length) return false;
  const tagCheck = await pool.query('SELECT tenant_id FROM tags WHERE id = $1', [tagId]);
  if (!tagCheck.rows.length) return false;
  if (client.role === 'superadmin') return true;
  return chatCheck.rows[0].tenant_id === client.tenantId && tagCheck.rows[0].tenant_id === client.tenantId;
}

router.put('/chats/:chatId/tag', authMiddleware, async (req, res) => {
  try {
    const user = (req as AuthenticatedRequest).user!;
    const chatId = String(req.params.chatId);
    const { tagId } = req.body;
    if (!tagId || isNaN(Number(tagId))) return res.status(400).json({ error: 'Invalid tagId' });

    if (!(await isOwnResource(user, chatId, tagId))) {
      return res.status(404).json({ error: 'Chat or tag not found' });
    }

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
    const user = (req as AuthenticatedRequest).user!;
    const chatId = String(req.params.chatId);
    const tagId = String(req.params.tagId);
    if (!(await isOwnResource(user, chatId, tagId))) {
      return res.status(404).json({ error: 'Chat or tag not found' });
    }
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