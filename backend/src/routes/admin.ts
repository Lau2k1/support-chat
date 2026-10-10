import express, { Router } from 'express';
import crypto from 'crypto';
import { pool } from '../db';
import {
  authMiddleware,
  tenantAdminMiddleware,
  superAdminMiddleware,
  AuthenticatedRequest,
} from '../middleware/auth';

const router = Router();
router.use(authMiddleware, tenantAdminMiddleware);

/** superadmins bypass tenant filters and see everything. */
function isGlobal(req: express.Request): boolean {
  return (req as AuthenticatedRequest).user?.role === 'superadmin';
}

// ---------------------------------------------------------------------------
// Operators (tenant-scoped)
// ---------------------------------------------------------------------------

router.get('/admin/operators', async (req, res) => {
  try {
    const global = isGlobal(req);
    const result = await pool.query(
      `SELECT o.id, o.name, o.email, o.role, o.is_enabled, o.status, o.tenant_id, t.name AS tenant_name, o.created_at
       FROM operators o
       LEFT JOIN tenants t ON t.id = o.tenant_id
       WHERE 1=1 ${global ? '' : 'AND o.tenant_id = $1'}
       ORDER BY o.id`,
      global ? [] : [(req as AuthenticatedRequest).user!.tenantId]
    );
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

router.put('/admin/operators/:id/toggle', async (req, res) => {
  try {
    const global = isGlobal(req);
    const current = await pool.query(
      'SELECT is_enabled, role, tenant_id FROM operators WHERE id = $1',
      [req.params.id]
    );
    if (!current.rows.length) return res.status(404).json({ error: 'Operator not found' });
    if (current.rows[0].role === 'admin' && !global) {
      return res.status(400).json({ error: 'Cannot disable admin' });
    }
    if (current.rows[0].role === 'superadmin' && !global) {
      return res.status(403).json({ error: 'Cannot manage superadmin' });
    }
    if (!global && current.rows[0].tenant_id !== (req as AuthenticatedRequest).user!.tenantId) {
      return res.status(403).json({ error: 'Operator belongs to another tenant' });
    }

    const newVal = !current.rows[0].is_enabled;
    const result = await pool.query(
      'UPDATE operators SET is_enabled = $1, token_version = token_version + 1 WHERE id = $2 RETURNING id, name, email, role, is_enabled, tenant_id',
      [newVal, req.params.id]
    );
    res.json({ ...result.rows[0], tenant_id: result.rows[0].tenant_id ?? null });
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

router.put('/admin/operators/:id/role', async (req, res) => {
  try {
    const global = isGlobal(req);
    const { role } = req.body;
    if (!['admin', 'operator'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

    const adminId = (req as AuthenticatedRequest).user!.id;
    if (Number(req.params.id) === adminId) return res.status(400).json({ error: 'Cannot change own role' });

    const current = await pool.query('SELECT role, tenant_id FROM operators WHERE id = $1', [req.params.id]);
    if (!current.rows.length) return res.status(404).json({ error: 'Operator not found' });
    if (current.rows[0].role === 'superadmin' && !global) {
      return res.status(403).json({ error: 'Cannot manage superadmin' });
    }
    if (!global && current.rows[0].tenant_id !== (req as AuthenticatedRequest).user!.tenantId) {
      return res.status(403).json({ error: 'Operator belongs to another tenant' });
    }

    const result = await pool.query(
      'UPDATE operators SET role = $1, token_version = token_version + 1 WHERE id = $2 RETURNING id, name, email, role, is_enabled, tenant_id',
      [role, req.params.id]
    );
    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

router.delete('/admin/operators/:id', async (req, res) => {
  try {
    const global = isGlobal(req);
    if (Number(req.params.id) === (req as AuthenticatedRequest).user!.id) return res.status(400).json({ error: 'Cannot delete yourself' });

    const opCheck = await pool.query('SELECT role, tenant_id FROM operators WHERE id = $1', [req.params.id]);
    if (!opCheck.rows.length) return res.status(404).json({ error: 'Operator not found' });
    if (opCheck.rows[0].role === 'admin' && !global) return res.status(400).json({ error: 'Cannot delete admin' });
    if (opCheck.rows[0].role === 'superadmin' && !global) return res.status(403).json({ error: 'Cannot delete superadmin' });
    if (!global && opCheck.rows[0].tenant_id !== (req as AuthenticatedRequest).user!.tenantId) {
      return res.status(403).json({ error: 'Operator belongs to another tenant' });
    }

    await pool.query('DELETE FROM operators WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

// ---------------------------------------------------------------------------
// Invite codes (tenant-scoped; superadmin may create for any tenant)
// ---------------------------------------------------------------------------

router.post('/admin/invite-codes', async (req, res) => {
  try {
    const global = isGlobal(req);
    const { expiresInHours } = req.body;
    // Superadmins must pick a tenant; tenant admins always get their own.
    const tenantId = global && req.body.tenantId ? Number(req.body.tenantId) : (req as AuthenticatedRequest).user!.tenantId;
    if (!Number.isInteger(tenantId)) return res.status(400).json({ error: 'Tenant required' });

    const code = crypto.randomBytes(6).toString('hex').toUpperCase();
    const adminId = (req as AuthenticatedRequest).user!.id;

    let expiresAt = null;
    if (expiresInHours && expiresInHours > 0) {
      expiresAt = new Date(Date.now() + expiresInHours * 3600000).toISOString();
    }

    const result = await pool.query(
      'INSERT INTO invite_codes (code, created_by, expires_at, tenant_id) VALUES ($1, $2, $3, $4) RETURNING id, code, expires_at, created_at, tenant_id',
      [code, adminId, expiresAt, tenantId]
    );
    res.status(201).json(result.rows[0]);
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

router.get('/admin/invite-codes', async (req, res) => {
  try {
    const global = isGlobal(req);
    const result = await pool.query(
      `SELECT ic.id, ic.code, ic.expires_at, ic.created_at, ic.used_at, ic.tenant_id,
              t.name AS tenant_name,
              o1.name as created_by_name,
              o2.name as used_by_name
       FROM invite_codes ic
       LEFT JOIN tenants t ON t.id = ic.tenant_id
       LEFT JOIN operators o1 ON ic.created_by = o1.id
       LEFT JOIN operators o2 ON ic.used_by = o2.id
       WHERE 1=1 ${global ? '' : 'AND ic.tenant_id = $1'}
       ORDER BY ic.created_at DESC`,
      global ? [] : [(req as AuthenticatedRequest).user!.tenantId]
    );
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

router.delete('/admin/invite-codes/:id', async (req, res) => {
  try {
    const global = isGlobal(req);
    const result = await pool.query(
      `DELETE FROM invite_codes WHERE id = $1 AND used_by IS NULL ${global ? '' : 'AND tenant_id = $2'} RETURNING id`,
      global ? [req.params.id] : [req.params.id, (req as AuthenticatedRequest).user!.tenantId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Invite code not found or already used' });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

// ---------------------------------------------------------------------------
// Stats & audit
// ---------------------------------------------------------------------------

router.get('/admin/operator-stats', async (req, res) => {
  try {
    const global = isGlobal(req);
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
      ${global ? '' : 'WHERE o.tenant_id = $1'}
      ORDER BY o.id
    `, global ? [] : [(req as AuthenticatedRequest).user!.tenantId]);
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
    const global = isGlobal(req);
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

    if (!global) { sql += ` AND c.tenant_id = $${idx++}`; params.push((req as AuthenticatedRequest).user!.tenantId); }
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

// ---------------------------------------------------------------------------
// Settings (per tenant)
// ---------------------------------------------------------------------------

router.get('/admin/settings', async (req, res) => {
  try {
    const global = isGlobal(req);
    if (global && !req.query.tenantId) return res.status(400).json({ error: 'tenantId required for superadmin' });
    const tenantId = global ? Number(req.query.tenantId) : (req as AuthenticatedRequest).user!.tenantId;
    const result = await pool.query('SELECT key, value FROM settings WHERE tenant_id = $1 ORDER BY key', [tenantId]);
    const settings: Record<string, string> = {};
    result.rows.forEach((r: { key: string; value: string }) => { settings[r.key] = r.value; });
    res.json(settings);
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

router.put('/admin/settings', async (req, res) => {
  try {
    const global = isGlobal(req);
    if (global && !req.body.tenantId) return res.status(400).json({ error: 'tenantId required for superadmin' });
    const tenantId = global ? Number(req.body.tenantId) : (req as AuthenticatedRequest).user!.tenantId;
    const allowedKeys = ['chat_timeout_minutes', 'welcome_message'];
    for (const [key, value] of Object.entries(req.body)) {
      if (!allowedKeys.includes(key)) continue;
      await pool.query(
        'INSERT INTO settings (tenant_id, key, value) VALUES ($1, $2, $3) ON CONFLICT (tenant_id, key) DO UPDATE SET value = $3',
        [tenantId, key, String(value)]
      );
    }
    const result = await pool.query('SELECT key, value FROM settings WHERE tenant_id = $1 ORDER BY key', [tenantId]);
    const settings: Record<string, string> = {};
    result.rows.forEach((r: { key: string; value: string }) => { settings[r.key] = r.value; });
    res.json(settings);
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

// ---------------------------------------------------------------------------
// Tags (per tenant)
// ---------------------------------------------------------------------------

router.get('/admin/tags', async (req, res) => {
  try {
    const global = isGlobal(req);
    const result = await pool.query(
      `SELECT id, name, color, created_at, tenant_id FROM tags WHERE 1=1 ${global ? '' : 'AND tenant_id = $1'} ORDER BY name`,
      global ? [] : [(req as AuthenticatedRequest).user!.tenantId]
    );
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

router.post('/admin/tags', async (req, res) => {
  try {
    const global = isGlobal(req);
    const { name, color } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (global && !req.body.tenantId) return res.status(400).json({ error: 'tenantId required for superadmin' });
    const tenantId = global ? Number(req.body.tenantId) : (req as AuthenticatedRequest).user!.tenantId;
    const result = await pool.query(
      'INSERT INTO tags (name, color, tenant_id) VALUES ($1, $2, $3) RETURNING id, name, color, created_at, tenant_id',
      [name.trim(), color || null, tenantId]
    );
    res.status(201).json(result.rows[0]);
  } catch (e: any) {
    if (e.code === '23505') { // unique violation
      res.status(400).json({ error: 'Tag name already exists in this tenant' });
    } else {
      res.status(500).json({ error: 'DB Error' });
    }
  }
});

router.delete('/admin/tags/:id', async (req, res) => {
  try {
    const global = isGlobal(req);
    const result = await pool.query(
      `DELETE FROM tags WHERE id = $1 ${global ? '' : 'AND tenant_id = $2'} RETURNING id`,
      global ? [req.params.id] : [req.params.id, (req as AuthenticatedRequest).user!.tenantId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Tag not found' });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

// ---------------------------------------------------------------------------
// Superadmin: tenant management
// ---------------------------------------------------------------------------

const superRouter = Router();
superRouter.use(authMiddleware, superAdminMiddleware);

superRouter.get('/superadmin/tenants', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT t.id, t.slug, t.name, t.status, t.created_at,
             (SELECT COUNT(*)::int FROM operators o WHERE o.tenant_id = t.id) AS operators_count,
             (SELECT COUNT(*)::int FROM chats c WHERE c.tenant_id = t.id) AS chats_count
      FROM tenants t
      ORDER BY t.id
    `);
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

superRouter.post('/superadmin/tenants', async (req, res) => {
  try {
    const { name, slug } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (!slug || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(slug)) {
      return res.status(400).json({ error: 'Slug must be 2-64 chars: lowercase latin, digits, hyphens' });
    }
    const result = await pool.query(
      'INSERT INTO tenants (slug, name) VALUES ($1, $2) RETURNING id, slug, name, status, created_at',
      [slug.toLowerCase(), name.trim()]
    );
    res.status(201).json(result.rows[0]);
  } catch (e: any) {
    if (e.code === '23505') return res.status(400).json({ error: 'Slug already exists' });
    res.status(500).json({ error: 'DB Error' });
  }
});

superRouter.put('/superadmin/tenants/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'suspended'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const result = await pool.query(
      'UPDATE tenants SET status = $1 WHERE id = $2 RETURNING id, slug, name, status',
      [status, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Tenant not found' });
    // Suspending a tenant should also take its operators offline.
    if (status === 'suspended') {
      await pool.query('UPDATE operators SET is_enabled = false WHERE tenant_id = $1 AND role != $2', [req.params.id, 'superadmin']);
    }
    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

export { superRouter };
export default router;