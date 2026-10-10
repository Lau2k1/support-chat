import express, { Router } from 'express';
import crypto from 'crypto';
import { pool } from '../db';
import {
  authMiddleware,
  tenantAdminMiddleware,
  superAdminMiddleware,
  AuthenticatedRequest,
} from '../middleware/auth';
import { encryptToken, decryptToken, getMe, setWebhook, deleteWebhook } from '../services/telegram';

const router = Router();
router.use(authMiddleware, tenantAdminMiddleware);

/** superadmins bypass tenant filters and see everything. */
function isGlobal(req: express.Request): boolean {
  return (req as AuthenticatedRequest).user?.role === 'superadmin';
}

/**
 * Explicit tenant filter for a superadmin request (query or body).
 * Returns null to mean "all tenants" (legacy behaviour).
 */
function requestedTenant(req: express.Request): number | null {
  const raw = (req.query.tenantId ?? (req.body ? req.body.tenantId : undefined)) as unknown;
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Effective tenant scope for the request:
 * - tenant admin → always own tenant;
 * - superadmin → tenantId from query/body, or null (all tenants).
 */
function scopedTenant(req: express.Request): number | null {
  const user = (req as AuthenticatedRequest).user!;
  return user.role === 'superadmin' ? requestedTenant(req) : user.tenantId;
}

// ---------------------------------------------------------------------------
// Operators (tenant-scoped)
// ---------------------------------------------------------------------------

router.get('/operators', async (req, res) => {
  try {
    const scope = scopedTenant(req);
    const result = await pool.query(
      `SELECT o.id, o.name, o.email, o.role, o.is_enabled, o.status, o.tenant_id, t.name AS tenant_name, o.created_at
       FROM operators o
       LEFT JOIN tenants t ON t.id = o.tenant_id
       WHERE 1=1 ${scope ? 'AND o.tenant_id = $1' : ''}
       ORDER BY o.id`,
      scope ? [scope] : []
    );
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

router.put('/operators/:id/toggle', async (req, res) => {
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

router.put('/operators/:id/role', async (req, res) => {
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

router.delete('/operators/:id', async (req, res) => {
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

interface SeatState {
  operator_limit: number | null;
  operators: number;
  pending: number;
}

/** Seats occupied = operators + not-yet-used (not expired) invites. */
async function getSeatState(tenantId: number): Promise<SeatState | null> {
  const result = await pool.query(
    `SELECT t.operator_limit,
            (SELECT COUNT(*)::int FROM operators o WHERE o.tenant_id = t.id) AS operators,
            (SELECT COUNT(*)::int FROM invite_codes ic
              WHERE ic.tenant_id = t.id AND ic.used_by IS NULL
                AND (ic.expires_at IS NULL OR ic.expires_at > now())) AS pending
     FROM tenants t WHERE t.id = $1`,
    [tenantId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return { operator_limit: row.operator_limit as number | null, operators: row.operators, pending: row.pending };
}

router.post('/invite-codes', async (req, res) => {
  try {
    const global = isGlobal(req);
    const { expiresInHours, count } = req.body;
    // Superadmins must pick a tenant; tenant admins always get their own.
    const tenantId = global && req.body.tenantId ? Number(req.body.tenantId) : (req as AuthenticatedRequest).user!.tenantId;
    if (typeof tenantId !== 'number' || !Number.isInteger(tenantId)) return res.status(400).json({ error: 'Tenant required' });

    const howMany = global && Number.isInteger(count) && count > 0 ? Math.min(Number(count), 100) : 1;

    // Seat quota: owner issued N "seats" to the tenant; won't exceed them.
    const seats = await getSeatState(tenantId);
    if (!seats) return res.status(404).json({ error: 'Tenant not found' });
    if (seats.operator_limit !== null && seats.operators + seats.pending + howMany > seats.operator_limit) {
      return res.status(400).json({ error: `Seat limit reached (${seats.operator_limit})` });
    }

    const adminId = (req as AuthenticatedRequest).user!.id;
    const codes: string[] = [];
    for (let i = 0; i < howMany; i++) {
      const code = crypto.randomBytes(6).toString('hex').toUpperCase();
      codes.push(code);
      let expiresAt: string | null = null;
      if (expiresInHours && expiresInHours > 0) {
        expiresAt = new Date(Date.now() + expiresInHours * 3600000).toISOString();
      }
      await pool.query(
        'INSERT INTO invite_codes (code, created_by, expires_at, tenant_id) VALUES ($1, $2, $3, $4)',
        [code, adminId, expiresAt, tenantId]
      );
    }
    res.status(201).json({ codes, count: codes.length, tenant_id: tenantId });
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

router.get('/invite-codes', async (req, res) => {
  try {
    const scope = scopedTenant(req);
    const result = await pool.query(
      `SELECT ic.id, ic.code, ic.expires_at, ic.created_at, ic.used_at, ic.tenant_id,
              t.name AS tenant_name,
              o1.name as created_by_name,
              o2.name as used_by_name
       FROM invite_codes ic
       LEFT JOIN tenants t ON t.id = ic.tenant_id
       LEFT JOIN operators o1 ON ic.created_by = o1.id
       LEFT JOIN operators o2 ON ic.used_by = o2.id
       WHERE 1=1 ${scope ? 'AND ic.tenant_id = $1' : ''}
       ORDER BY ic.created_at DESC`,
      scope ? [scope] : []
    );
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

router.delete('/invite-codes/:id', async (req, res) => {
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

router.get('/operator-stats', async (req, res) => {
  try {
    const scope = scopedTenant(req);
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
      ${scope ? 'WHERE o.tenant_id = $1' : ''}
      ORDER BY o.id
    `, scope ? [scope] : []);
    res.json(result.rows.map(r => ({
      ...r,
      avg_response_sec: Math.round(Number(r.avg_response_sec)),
      avg_rating: Math.round(Number(r.avg_rating) * 10) / 10,
    })));
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

router.get('/chats', async (req, res) => {
  try {
    const scope = scopedTenant(req);
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

    if (scope) { sql += ` AND c.tenant_id = $${idx++}`; params.push(scope); }
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

router.get('/settings', async (req, res) => {
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

router.put('/settings', async (req, res) => {
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

router.get('/tags', async (req, res) => {
  try {
    const scope = scopedTenant(req);
    const result = await pool.query(
      `SELECT id, name, color, created_at, tenant_id FROM tags WHERE 1=1 ${scope ? 'AND tenant_id = $1' : ''} ORDER BY name`,
      scope ? [scope] : []
    );
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

router.post('/tags', async (req, res) => {
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

router.delete('/tags/:id', async (req, res) => {
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
// Telegram bot (per tenant, PLAN section 9)
// ---------------------------------------------------------------------------

/** Public webhook URL for a bot, or null when PUBLIC_BASE_URL is not configured. */
function webhookUrlFor(botId: number): string | null {
  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  return base ? `${base}/api/tg/${botId}` : null;
}

function botPublicRow(row: any) {
  return row ? { id: row.id, bot_username: row.bot_username, is_active: row.is_active, created_at: row.created_at } : null;
}

router.get('/telegram-bot', async (req, res) => {
  try {
    const tenantId = scopedTenant(req);
    if (!tenantId) return res.status(400).json({ error: 'Tenant required' });
    const result = await pool.query(
      'SELECT id, bot_username, is_active, created_at FROM telegram_bots WHERE tenant_id = $1',
      [tenantId]
    );
    const bot = botPublicRow(result.rows[0]);
    res.json({ bot, webhook_url: bot ? webhookUrlFor(bot.id) : null });
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

router.put('/telegram-bot', async (req, res) => {
  try {
    const tenantId = scopedTenant(req);
    if (!tenantId) return res.status(400).json({ error: 'Tenant required' });
    const token = String(req.body.bot_token || '').trim();
    if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) {
      return res.status(400).json({ error: 'Неверный формат токена (нужен токен от @BotFather)' });
    }

    let me;
    try {
      me = await getMe(token);
    } catch (e) {
      return res.status(400).json({ error: 'Telegram отклонил токен: ' + (e instanceof Error ? e.message : String(e)) });
    }
    if (!me.is_bot) return res.status(400).json({ error: 'Токен не принадлежит боту' });

    const secret = crypto.randomBytes(24).toString('hex');
    const enc = encryptToken(token);
    const existing = await pool.query('SELECT id FROM telegram_bots WHERE tenant_id = $1', [tenantId]);
    let botId: number;
    if (existing.rows.length) {
      botId = existing.rows[0].id;
      await pool.query(
        'UPDATE telegram_bots SET bot_token = $1, bot_username = $2, webhook_secret = $3, is_active = true WHERE id = $4',
        [enc, me.username || null, secret, botId]
      );
    } else {
      const ins = await pool.query(
        'INSERT INTO telegram_bots (tenant_id, bot_token, bot_username, webhook_secret, is_active) VALUES ($1, $2, $3, $4, true) RETURNING id',
        [tenantId, enc, me.username || null, secret]
      );
      botId = ins.rows[0].id;
    }

    let webhookRegistered = false;
    let webhookError: string | null = null;
    const url = webhookUrlFor(botId);
    if (url) {
      try {
        await setWebhook(token, url, secret);
        webhookRegistered = true;
      } catch (e) {
        webhookError = e instanceof Error ? e.message : String(e);
      }
    }

    const result = await pool.query('SELECT id, bot_username, is_active, created_at FROM telegram_bots WHERE id = $1', [botId]);
    res.json({ bot: botPublicRow(result.rows[0]), webhook_url: url, webhook_registered: webhookRegistered, webhook_error: webhookError });
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

router.put('/telegram-bot/toggle', async (req, res) => {
  try {
    const tenantId = scopedTenant(req);
    if (!tenantId) return res.status(400).json({ error: 'Tenant required' });
    const isActive = !!req.body.is_active;
    const r = await pool.query('SELECT id, bot_token, webhook_secret FROM telegram_bots WHERE tenant_id = $1', [tenantId]);
    const bot = r.rows[0];
    if (!bot) return res.status(404).json({ error: 'Бот не подключён' });

    await pool.query('UPDATE telegram_bots SET is_active = $1 WHERE id = $2', [isActive, bot.id]);
    try {
      const token = decryptToken(bot.bot_token);
      if (isActive) {
        const url = webhookUrlFor(bot.id);
        if (url) await setWebhook(token, url, bot.webhook_secret);
      } else {
        await deleteWebhook(token);
      }
    } catch {
      // Best effort: the local state is what matters for the panel.
    }

    const result = await pool.query('SELECT id, bot_username, is_active, created_at FROM telegram_bots WHERE id = $1', [bot.id]);
    res.json({ bot: botPublicRow(result.rows[0]) });
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

router.delete('/telegram-bot', async (req, res) => {
  try {
    const tenantId = scopedTenant(req);
    if (!tenantId) return res.status(400).json({ error: 'Tenant required' });
    const r = await pool.query('SELECT id, bot_token FROM telegram_bots WHERE tenant_id = $1', [tenantId]);
    const bot = r.rows[0];
    if (!bot) return res.status(404).json({ error: 'Бот не подключён' });
    try {
      await deleteWebhook(decryptToken(bot.bot_token));
    } catch {
      // Best effort.
    }
    await pool.query('DELETE FROM telegram_bots WHERE id = $1', [bot.id]);
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

superRouter.get('/tenants', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT t.id, t.slug, t.name, t.status, t.operator_limit, t.created_at,
             (SELECT COUNT(*)::int FROM operators o WHERE o.tenant_id = t.id) AS operators_count,
             (SELECT COUNT(*)::int FROM chats c WHERE c.tenant_id = t.id) AS chats_count,
             (SELECT COUNT(*)::int FROM chats c WHERE c.tenant_id = t.id AND c.status = 'open') AS open_chats,
             (SELECT COUNT(*)::int FROM messages m
                JOIN chats c ON c.id = m.chat_id AND c.tenant_id = t.id) AS messages_count,
             (SELECT COUNT(*)::int FROM invite_codes ic WHERE ic.tenant_id = t.id) AS invites_issued,
             (SELECT COUNT(*)::int FROM invite_codes ic WHERE ic.tenant_id = t.id AND ic.used_by IS NOT NULL) AS invites_used,
             (SELECT COALESCE(AVG(c.rating), 0) FROM chats c WHERE c.tenant_id = t.id AND c.rating IS NOT NULL) AS avg_rating
      FROM tenants t
      ORDER BY t.id
    `);
    res.json(result.rows.map((r: any) => ({
      ...r,
      avg_rating: Math.round(Number(r.avg_rating) * 10) / 10,
    })));
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

superRouter.put('/tenants/:id', async (req, res) => {
  try {
    const { name, operator_limit } = req.body;
    if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (operator_limit !== undefined && operator_limit !== null) {
      if (!Number.isInteger(operator_limit) || operator_limit < 0) {
        return res.status(400).json({ error: 'operator_limit must be a non-negative integer or null' });
      }
    }
    const nextName = name !== undefined ? name.trim() : null;
    const nextLimit = operator_limit === undefined ? '__keep__' : operator_limit;
    const result = await pool.query(
      `UPDATE tenants
       SET name = COALESCE($1, name),
           operator_limit = CASE WHEN $2::text = '__keep__' THEN operator_limit ELSE $2::int END
       WHERE id = $3
       RETURNING id, slug, name, status, operator_limit, created_at`,
      [nextName, nextLimit, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Tenant not found' });
    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

/** Owner issues a batch of invite codes to a tenant (handed over to the client). */
superRouter.post('/tenants/:id/invites', async (req, res) => {
  try {
    const tenantId = Number(req.params.id);
    const { count = 1, expiresInHours } = req.body;
    const howMany = Number.isInteger(count) && count > 0 ? Math.min(Number(count), 100) : 1;

    const seats = await getSeatState(tenantId);
    if (!seats) return res.status(404).json({ error: 'Tenant not found' });
    if (seats.operator_limit !== null && seats.operators + seats.pending + howMany > seats.operator_limit) {
      return res.status(400).json({ error: `Not enough free seats (limit ${seats.operator_limit})` });
    }

    const adminId = (req as AuthenticatedRequest).user!.id;
    const codes: string[] = [];
    for (let i = 0; i < howMany; i++) {
      const code = crypto.randomBytes(6).toString('hex').toUpperCase();
      codes.push(code);
      let expiresAt: string | null = null;
      if (expiresInHours && expiresInHours > 0) {
        expiresAt = new Date(Date.now() + expiresInHours * 3600000).toISOString();
      }
      await pool.query(
        'INSERT INTO invite_codes (code, created_by, expires_at, tenant_id) VALUES ($1, $2, $3, $4)',
        [code, adminId, expiresAt, tenantId]
      );
    }
    res.status(201).json({ tenant_id: tenantId, codes, count: codes.length });
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

/** Global CRM metrics for the owner dashboard. */
superRouter.get('/dashboard', async (_req, res) => {
  try {
    const totals = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM tenants) AS tenants,
        (SELECT COUNT(*)::int FROM tenants WHERE status = 'active') AS active_tenants,
        (SELECT COUNT(*)::int FROM operators WHERE role != 'superadmin') AS operators,
        (SELECT COUNT(*)::int FROM chats) AS chats,
        (SELECT COUNT(*)::int FROM chats WHERE status = 'open') AS open_chats,
        (SELECT COUNT(*)::int FROM messages) AS messages,
        (SELECT COUNT(*)::int FROM invite_codes) AS invites,
        (SELECT COUNT(*)::int FROM invite_codes WHERE used_by IS NOT NULL) AS invites_used,
        (SELECT COALESCE(AVG(rating), 0) FROM chats WHERE rating IS NOT NULL) AS avg_rating
    `);
    const daily = await pool.query(`
      SELECT to_char(day, 'YYYY-MM-DD') AS day, COALESCE(cnt, 0)::int AS count
      FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, '1 day') day
      LEFT JOIN (
        SELECT created_at::date AS d, COUNT(*)::int AS cnt FROM chats GROUP BY 1
      ) s ON s.d = day::date
      ORDER BY day
    `);
    res.json({
      ...totals.rows[0],
      avg_rating: Math.round(Number(totals.rows[0].avg_rating) * 10) / 10,
      daily: daily.rows,
    });
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

/** All connected Telegram bots across tenants (owner overview). */
superRouter.get('/telegram-bots', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT tb.id, tb.tenant_id, t.name AS tenant_name, t.slug AS tenant_slug,
             tb.bot_username, tb.is_active, tb.created_at
      FROM telegram_bots tb
      JOIN tenants t ON t.id = tb.tenant_id
      ORDER BY tb.created_at DESC
    `);
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

superRouter.post('/tenants', async (req, res) => {
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

superRouter.put('/tenants/:id/status', async (req, res) => {
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