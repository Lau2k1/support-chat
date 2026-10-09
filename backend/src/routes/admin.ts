import { Router } from 'express';
import crypto from 'crypto';
import { pool } from '../db';
import { authMiddleware, adminMiddleware, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

router.use(authMiddleware, adminMiddleware);

router.get('/admin/operators', async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, role, is_enabled, status, created_at FROM operators ORDER BY id'
    );
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

router.put('/admin/operators/:id/toggle', async (req, res) => {
  try {
    const opId = req.params.id;
    const current = await pool.query('SELECT is_enabled, role FROM operators WHERE id = $1', [opId]);
    if (!current.rows.length) return res.status(404).json({ error: 'Operator not found' });
    if (current.rows[0].role === 'admin') return res.status(400).json({ error: 'Cannot disable admin' });

    const newVal = !current.rows[0].is_enabled;
    const result = await pool.query(
      'UPDATE operators SET is_enabled = $1 WHERE id = $2 RETURNING id, name, email, role, is_enabled',
      [newVal, opId]
    );
    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

router.put('/admin/operators/:id/role', async (req, res) => {
  try {
    const { role } = req.body;
    if (!['admin', 'operator'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

    const adminId = (req as AuthenticatedRequest).user!.id;
    if (Number(req.params.id) === adminId) return res.status(400).json({ error: 'Cannot change own role' });

    const result = await pool.query(
      'UPDATE operators SET role = $1 WHERE id = $2 RETURNING id, name, email, role, is_enabled',
      [role, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Operator not found' });
    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

router.delete('/admin/operators/:id', async (req, res) => {
  try {
    const adminId = (req as AuthenticatedRequest).user!.id;
    if (Number(req.params.id) === adminId) return res.status(400).json({ error: 'Cannot delete yourself' });

    const opCheck = await pool.query('SELECT role FROM operators WHERE id = $1', [req.params.id]);
    if (!opCheck.rows.length) return res.status(404).json({ error: 'Operator not found' });
    if (opCheck.rows[0].role === 'admin') return res.status(400).json({ error: 'Cannot delete admin' });

    await pool.query('DELETE FROM operators WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

router.post('/admin/invite-codes', async (req, res) => {
  try {
    const { expiresInHours } = req.body;
    const code = crypto.randomBytes(6).toString('hex').toUpperCase();
    const adminId = (req as AuthenticatedRequest).user!.id;

    let expiresAt = null;
    if (expiresInHours && expiresInHours > 0) {
      expiresAt = new Date(Date.now() + expiresInHours * 3600000).toISOString();
    }

    const result = await pool.query(
      'INSERT INTO invite_codes (code, created_by, expires_at) VALUES ($1, $2, $3) RETURNING id, code, expires_at, created_at',
      [code, adminId, expiresAt]
    );
    res.status(201).json(result.rows[0]);
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

router.get('/admin/invite-codes', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT ic.id, ic.code, ic.expires_at, ic.created_at, ic.used_at,
              o1.name as created_by_name,
              o2.name as used_by_name
       FROM invite_codes ic
       LEFT JOIN operators o1 ON ic.created_by = o1.id
       LEFT JOIN operators o2 ON ic.used_by = o2.id
       ORDER BY ic.created_at DESC`
    );
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

router.delete('/admin/invite-codes/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM invite_codes WHERE id = $1 AND used_by IS NULL RETURNING id',
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Invite code not found or already used' });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

router.get('/admin/operator-stats', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        o.id, o.name, o.email, o.role, o.is_enabled,
        COALESCE(chats.count, 0) AS total_chats,
        COALESCE(msgs.count, 0) AS total_messages,
        COALESCE(resp.avg_seconds, 0) AS avg_response_sec,
        COALESCE(ratings.avg_rating, 0) AS avg_rating
      FROM operators o
      LEFT JOIN (
        SELECT assigned_operator_id, COUNT(*)::int AS count
        FROM chats WHERE assigned_operator_id IS NOT NULL
        GROUP BY assigned_operator_id
      ) chats ON chats.assigned_operator_id = o.id
      LEFT JOIN (
        SELECT sender_id, COUNT(*)::int AS count
        FROM messages WHERE sender_id != 0
        GROUP BY sender_id
      ) msgs ON msgs.sender_id = o.id
      LEFT JOIN (
        SELECT c.assigned_operator_id, AVG(sub.diff) AS avg_seconds
        FROM (
          SELECT m1.chat_id, EXTRACT(EPOCH FROM (m1.created_at - c.created_at)) AS diff
          FROM messages m1
          JOIN chats c ON c.id = m1.chat_id
          WHERE m1.sender_id != 0
            AND m1.id = (SELECT MIN(m2.id) FROM messages m2 WHERE m2.chat_id = c.id AND m2.sender_id != 0)
            AND c.assigned_operator_id IS NOT NULL
        ) sub
        JOIN chats c ON c.id = sub.chat_id
        GROUP BY c.assigned_operator_id
      ) resp ON resp.assigned_operator_id = o.id
      LEFT JOIN (
        SELECT assigned_operator_id, AVG(rating) AS avg_rating
        FROM chats WHERE rating IS NOT NULL AND assigned_operator_id IS NOT NULL
        GROUP BY assigned_operator_id
      ) ratings ON ratings.assigned_operator_id = o.id
      ORDER BY o.id
    `);
    res.json(result.rows.map(r => ({
      ...r,
      avg_response_sec: Math.round(Number(r.avg_response_sec)),
      avg_rating: Math.round(Number(r.avg_rating) * 10) / 10,
    })));
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

router.get('/admin/chats', async (req, res) => {
  try {
    const { status, operator_id, from, to, limit = '50', offset = '0' } = req.query;
    let sql = `
      SELECT c.id, c.client_id, c.status, c.rating, c.assigned_operator_id,
             o.name AS operator_name,
             extract(epoch from c.created_at) * 1000 AS created_at,
             extract(epoch from c.updated_at) * 1000 AS updated_at,
             (SELECT COUNT(*)::int FROM messages m WHERE m.chat_id = c.id) AS messages_count
      FROM chats c
      LEFT JOIN operators o ON c.assigned_operator_id = o.id
      WHERE 1=1
    `;
    const params: any[] = [];
    let idx = 1;

    if (status) { sql += ` AND c.status = $${idx++}`; params.push(status); }
    if (operator_id) { sql += ` AND c.assigned_operator_id = $${idx++}`; params.push(Number(operator_id)); }
    if (from) { sql += ` AND c.created_at >= $${idx++}`; params.push(from); }
    if (to) { sql += ` AND c.created_at <= $${idx++}`; params.push(to); }

    sql += ` ORDER BY c.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(Number(limit), Number(offset));

    const result = await pool.query(sql, params);
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

router.get('/admin/settings', async (_req, res) => {
  try {
    const result = await pool.query('SELECT key, value FROM settings ORDER BY key');
    const settings: Record<string, string> = {};
    result.rows.forEach((r: { key: string; value: string }) => { settings[r.key] = r.value; });
    res.json(settings);
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

router.put('/admin/settings', async (req, res) => {
  try {
    const allowedKeys = ['chat_timeout_minutes', 'welcome_message'];
    for (const [key, value] of Object.entries(req.body)) {
      if (!allowedKeys.includes(key)) continue;
      await pool.query(
        'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
        [key, String(value)]
      );
    }
    const result = await pool.query('SELECT key, value FROM settings ORDER BY key');
    const settings: Record<string, string> = {};
    result.rows.forEach((r: { key: string; value: string }) => { settings[r.key] = r.value; });
    res.json(settings);
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

router.get('/admin/tags', async (_req, res) => {
  try {
    const result = await pool.query('SELECT id, name, color, created_at FROM tags ORDER BY name');
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

router.post('/admin/tags', async (req, res) => {
  try {
    const { name, color } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name is required' });
    }
    const result = await pool.query(
      'INSERT INTO tags (name, color) VALUES ($1, $2) RETURNING id, name, color, created_at',
      [name.trim(), color || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (e: any) {
    if (e.code === '23505') { // unique violation
      res.status(400).json({ error: 'Tag name already exists' });
    } else {
      res.status(500).json({ error: 'DB Error' });
    }
  }
});

router.delete('/admin/tags/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM tags WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Tag not found' });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

export default router;
