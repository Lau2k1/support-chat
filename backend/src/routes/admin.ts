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
import {
  LIMITS,
  validColor,
  validInt,
  validSlug,
  validString,
  validTagName,
  firstError,
} from '../utils/validate';
import { startOfDay, endOfDay } from '../utils/dateRange';
import { getOperatorsWithStatus, type OperatorBusyStatus } from '../services/chat';
import { markPaymentPaid, listPlans, getPlanByCode } from '../services/billing';

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
      `SELECT o.id, o.name, o.email, o.role, o.is_enabled, o.tenant_id, t.name AS tenant_name, o.created_at
       FROM operators o
       LEFT JOIN tenants t ON t.id = o.tenant_id
       WHERE 1=1 ${scope ? 'AND o.tenant_id = $1' : ''}
       ORDER BY o.id`,
      scope ? [scope] : []
    );

    // Live status is derived from WS connections / assigned open chats, not
    // stored in the DB (the operators.status column was removed). Build a
    // tenant→operator→status map once, then annotate every row.
    const tenantIds = [...new Set(result.rows.map((r) => r.tenant_id ?? 0))];
    const statusMaps = new Map<number, Map<number, OperatorBusyStatus>>();
    for (const tid of tenantIds) {
      const list = await getOperatorsWithStatus(tid);
      statusMaps.set(tid, new Map(list.map((o) => [o.id, o.status])));
    }
    res.json(result.rows.map((r) => ({
      ...r,
      status: statusMaps.get(r.tenant_id ?? 0)?.get(r.id) ?? 'offline',
    })));
  } catch (e) {
    console.error('admin /operators error:', e);
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
  } catch (e) {
    console.error('admin route error:', e);
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
    // SEC-14: a tenant admin may only demote operators, not other admins.
    const isSuper = (req as AuthenticatedRequest).user!.role === 'superadmin';
    if (!isSuper && current.rows[0].role === 'admin') {
      return res.status(403).json({ error: 'Only a superadmin can change an admin role' });
    }
    if (!global && current.rows[0].tenant_id !== (req as AuthenticatedRequest).user!.tenantId) {
      return res.status(403).json({ error: 'Operator belongs to another tenant' });
    }

    const result = await pool.query(
      'UPDATE operators SET role = $1, token_version = token_version + 1 WHERE id = $2 RETURNING id, name, email, role, is_enabled, tenant_id',
      [role, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (e) {
    console.error('admin route error:', e);
    res.status(500).json({ error: 'DB Error' });
  }
});

router.delete('/operators/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid operator id' });

  const global = isGlobal(req);
  if (id === (req as AuthenticatedRequest).user!.id) {
    return res.status(400).json({ error: 'Нельзя удалить себя' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const opCheck = await client.query('SELECT role, tenant_id FROM operators WHERE id = $1 FOR UPDATE', [id]);
    if (!opCheck.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Operator not found' });
    }
    const target = opCheck.rows[0];
    // A superadmin is the account owner — never deletable through this route.
    if (target.role === 'superadmin') {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Нельзя удалить владельца' });
    }
    // Tenant admins may remove their own operators, but not other admins.
    if (target.role === 'admin' && !global) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Нельзя удалить администратора' });
    }
    if (!global && target.tenant_id !== (req as AuthenticatedRequest).user!.tenantId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Operator belongs to another tenant' });
    }

    // Dependent rows that don't cascade must be detached first, otherwise the
    // DELETE fails with a foreign-key violation (the old "silent" delete bug).
    await client.query('UPDATE chats SET assigned_operator_id = NULL WHERE assigned_operator_id = $1', [id]);
    await client.query('UPDATE invite_codes SET created_by = NULL WHERE created_by = $1', [id]);
    await client.query('UPDATE invite_codes SET used_by = NULL WHERE used_by = $1', [id]);
    await client.query('DELETE FROM canned_responses WHERE operator_id = $1', [id]);

    await client.query('DELETE FROM operators WHERE id = $1', [id]);
    await client.query('COMMIT');

    res.json({ ok: true, id });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    console.error('delete operator error:', e);
    res.status(500).json({ error: 'Не удалось удалить оператора' });
  } finally {
    client.release();
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
      // SEC-16: 8+ bytes of entropy (6 → 8 bytes = 16 hex chars).
      const code = crypto.randomBytes(8).toString('hex').toUpperCase();
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
  } catch (e) {
    console.error('admin route error:', e);
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
  } catch (e) {
    console.error('admin route error:', e);
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
  } catch (e) {
    console.error('admin route error:', e);
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
  } catch (e) {
    console.error('admin route error:', e);
    res.status(500).json({ error: 'DB Error' });
  }
});

router.get('/chats', async (req, res) => {
  try {
    const scope = scopedTenant(req);
    const { status, operator_id, from, to, limit = '50', offset = '0' } = req.query;
    let sql = `
      SELECT c.id, c.client_id, c.status, c.rating, c.assigned_operator_id,
             COALESCE(c.tenant_id, 0)::text || '_' || c.id::text AS public_code,
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
    const fromDate = startOfDay(from);
    const toDate = endOfDay(to);
    if (fromDate) { sql += ` AND c.created_at >= $${idx++}`; params.push(fromDate); }
    if (toDate) { sql += ` AND c.created_at <= $${idx++}`; params.push(toDate); }

    sql += ` ORDER BY c.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(Number(limit), Number(offset));

    const result = await pool.query(sql, params);
    res.json(result.rows);
  } catch (e) {
    console.error('admin route error:', e);
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
  } catch (e) {
    console.error('admin route error:', e);
    res.status(500).json({ error: 'DB Error' });
  }
});

router.put('/settings', async (req, res) => {
  try {
    const global = isGlobal(req);
    if (global && !req.body.tenantId) return res.status(400).json({ error: 'tenantId required for superadmin' });
    const tenantId = global ? Number(req.body.tenantId) : (req as AuthenticatedRequest).user!.tenantId;
    const allowedKeys = ['chat_timeout_minutes', 'welcome_message', 'widget_origins'];
    if (req.body.chat_timeout_minutes !== undefined) {
      const err = validInt(req.body.chat_timeout_minutes, 'Время авто-закрытия', {
        min: LIMITS.chatTimeoutMin,
        max: LIMITS.chatTimeoutMax,
      });
      if (err) return res.status(400).json({ error: `${err} (минуты)` });
    }
    if (req.body.welcome_message !== undefined) {
      if (typeof req.body.welcome_message !== 'string' || req.body.welcome_message.length > LIMITS.welcomeMessage) {
        return res.status(400).json({ error: `Приветственное сообщение: максимум ${LIMITS.welcomeMessage} символов` });
      }
    }
    if (req.body.widget_origins !== undefined) {
      const list = req.body.widget_origins;
      if (!Array.isArray(list) || !list.every((o: unknown) => typeof o === 'string' && /^https?:\/\//i.test(o))) {
        return res.status(400).json({ error: 'widget_origins: массив URL (http/https)' });
      }
      req.body.widget_origins = JSON.stringify(list);
    }
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
  } catch (e) {
    console.error('admin route error:', e);
    res.status(500).json({ error: 'DB Error' });
  }
});

// ---------------------------------------------------------------------------
// Widget (per tenant)
// ---------------------------------------------------------------------------

/** Хост, на котором живёт widget.html: маркетинговый домен либо хост запроса. */
function widgetBaseUrl(req: express.Request): string {
  const raw = (process.env.DOMAIN || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
  return raw ? `https://${raw}` : `${req.protocol}://${req.get('host')}`;
}

/**
 * Данные для раздела «Виджет»: slug тенанта и готовый адрес виджета. Раньше slug
 * знал только владелец платформы (CRM), поэтому клиент физически не мог собрать
 * сниппет встраивания — приходилось диктовать его в переписке.
 */
router.get('/widget', async (req, res) => {
  try {
    const tenantId = scopedTenant(req);
    if (tenantId === null) return res.status(400).json({ error: 'tenantId required for superadmin' });
    const t = await pool.query('SELECT slug FROM tenants WHERE id = $1', [tenantId]);
    if (!t.rows.length) return res.status(404).json({ error: 'Тенант не найден' });

    let origins: string[] = [];
    const s = await pool.query("SELECT value FROM settings WHERE tenant_id = $1 AND key = 'widget_origins'", [tenantId]);
    if (s.rows.length) {
      try {
        const list = JSON.parse(s.rows[0].value);
        if (Array.isArray(list)) origins = list.filter((o: unknown): o is string => typeof o === 'string');
      } catch {
        // Повреждённое значение настройки не должно ломать страницу.
      }
    }

    const slug = t.rows[0].slug as string;
    res.json({
      slug,
      widgetUrl: `${widgetBaseUrl(req)}/widget.html?tenant=${encodeURIComponent(slug)}`,
      origins,
    });
  } catch (e) {
    console.error('admin route error:', e);
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
  } catch (e) {
    console.error('admin route error:', e);
    res.status(500).json({ error: 'DB Error' });
  }
});

router.post('/tags', async (req, res) => {
  try {
    const global = isGlobal(req);
    const { name, color } = req.body;
    const err = firstError(validTagName(name), validColor(color));
    if (err) return res.status(400).json({ error: err });
    if (global && !req.body.tenantId) return res.status(400).json({ error: 'tenantId required for superadmin' });
    const tenantId = global ? Number(req.body.tenantId) : (req as AuthenticatedRequest).user!.tenantId;
    const result = await pool.query(
      'INSERT INTO tags (name, color, tenant_id) VALUES ($1, $2, $3) RETURNING id, name, color, created_at, tenant_id',
      [String(name).trim(), color || null, tenantId]
    );
    res.status(201).json(result.rows[0]);
  } catch (e: any) {
    if (e.code === '23505') { // unique violation
      res.status(400).json({ error: 'Тег с таким названием уже существует' });
    } else {
      res.status(500).json({ error: 'DB Error' });
    }
  }
});

router.put('/tags/:id', async (req, res) => {
  try {
    const global = isGlobal(req);
    const { name, color } = req.body;
    const err = firstError(validTagName(name), validColor(color));
    if (err) return res.status(400).json({ error: err });

    const result = await pool.query(
      `UPDATE tags SET name = $1, color = $2
       WHERE id = $3 ${global ? '' : 'AND tenant_id = $4'}
       RETURNING id, name, color, created_at, tenant_id`,
      global
        ? [String(name).trim(), color || null, req.params.id]
        : [String(name).trim(), color || null, req.params.id, (req as AuthenticatedRequest).user!.tenantId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Tag not found' });
    res.json(result.rows[0]);
  } catch (e: any) {
    if (e.code === '23505') {
      res.status(400).json({ error: 'Тег с таким названием уже существует' });
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
  } catch (e) {
    console.error('admin route error:', e);
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
    // The webhook endpoint is intentionally NOT exposed to the panel: showing it
    // adds no value (Telegram is configured server-side) and only widens the
    // attack surface. Clients only need to know whether it is configured.
    res.json({ bot, webhook_configured: !!process.env.PUBLIC_BASE_URL });
  } catch (e) {
    console.error('admin route error:', e);
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
    res.json({ bot: botPublicRow(result.rows[0]), webhook_registered: webhookRegistered, webhook_error: webhookError });
  } catch (e) {
    console.error('admin route error:', e);
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
  } catch (e) {
    console.error('admin route error:', e);
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
  } catch (e) {
    console.error('admin route error:', e);
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
             t.billing_status, t.paid_until, t.plan_id, p.name AS plan_name, p.code AS plan_code,
             (SELECT COUNT(*)::int FROM operators o WHERE o.tenant_id = t.id) AS operators_count,
             (SELECT COUNT(*)::int FROM chats c WHERE c.tenant_id = t.id) AS chats_count,
             (SELECT COUNT(*)::int FROM chats c WHERE c.tenant_id = t.id AND c.status = 'open') AS open_chats,
             (SELECT COUNT(*)::int FROM messages m
                JOIN chats c ON c.id = m.chat_id AND c.tenant_id = t.id) AS messages_count,
             (SELECT COUNT(*)::int FROM invite_codes ic WHERE ic.tenant_id = t.id) AS invites_issued,
             (SELECT COUNT(*)::int FROM invite_codes ic WHERE ic.tenant_id = t.id AND ic.used_by IS NOT NULL) AS invites_used,
             (SELECT COALESCE(AVG(c.rating), 0) FROM chats c WHERE c.tenant_id = t.id AND c.rating IS NOT NULL) AS avg_rating
      FROM tenants t
      LEFT JOIN plans p ON p.id = t.plan_id
      ORDER BY t.id
    `);
    res.json(result.rows.map((r: any) => ({
      ...r,
      avg_rating: Math.round(Number(r.avg_rating) * 10) / 10,
    })));
  } catch (e) {
    console.error('admin route error:', e);
    res.status(500).json({ error: 'DB Error' });
  }
});

superRouter.put('/tenants/:id', async (req, res) => {
  try {
    const { name, operator_limit } = req.body;
    if (name !== undefined) {
      const nameErr = validString(name, 'Название', { max: LIMITS.tenantName });
      if (nameErr) return res.status(400).json({ error: nameErr });
    }
    if (operator_limit !== undefined && operator_limit !== null) {
      const limitErr = validInt(operator_limit, 'Лимит мест', { min: 0 });
      if (limitErr) return res.status(400).json({ error: limitErr });
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
  } catch (e) {
    console.error('admin route error:', e);
    res.status(500).json({ error: 'DB Error' });
  }
});

/** Plan catalog for the CRM — the owner assigns plans to clients by hand. */
superRouter.get('/plans', async (_req, res) => {
  try {
    res.json(await listPlans());
  } catch (e) {
    console.error('admin route error:', e);
    res.status(500).json({ error: 'DB Error' });
  }
});

/**
 * Manual subscription change for a client: offline payments, individual deals,
 * make-good periods. Mirrors what a confirmed payment does (see
 * services/billing.ts → markPaymentPaid), except the owner sets the end date
 * explicitly instead of extending the term by a fixed number of days.
 *
 * Every field is optional — sending one changes only that one thing:
 *   planCode      — код тарифа, null/'' снимает тариф
 *   paidUntil     — ISO-дата окончания, null/'' делает подписку бессрочной
 *   billingStatus — 'active' | 'unpaid'
 *   operatorLimit — явный лимит мест (иначе берётся из тарифа)
 */
superRouter.put('/tenants/:id/subscription', async (req, res) => {
  try {
    const tenantId = Number(req.params.id);
    if (!Number.isInteger(tenantId) || tenantId <= 0) {
      return res.status(400).json({ error: 'Неверный ID тенанта' });
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const sets: string[] = [];
    const params: unknown[] = [];
    const hasPlan = body.planCode !== undefined && body.planCode !== null && String(body.planCode) !== '';

    // --- тариф -------------------------------------------------------------
    let planLimit: number | null | undefined;
    if (body.planCode !== undefined) {
      let planId: number | null = null;
      if (hasPlan) {
        const plan = await getPlanByCode(String(body.planCode));
        if (!plan) return res.status(400).json({ error: 'Тариф не найден' });
        planId = plan.id;
        planLimit = plan.operator_limit ?? null;
      }
      params.push(planId);
      sets.push(`plan_id = $${params.length}`);
    }

    // --- лимит мест --------------------------------------------------------
    // Явное значение важнее тарифа. Иначе при назначении тарифа лимит берётся
    // из него — ровно как при подтверждении оплаты. Снятие тарифа лимит не
    // трогает: у «Custom» лимита нет вовсе, и затирать его нельзя.
    if (body.operatorLimit !== undefined) {
      if (body.operatorLimit !== null) {
        const limitErr = validInt(body.operatorLimit, 'Лимит мест', { min: 0 });
        if (limitErr) return res.status(400).json({ error: limitErr });
      }
      params.push(body.operatorLimit);
      sets.push(`operator_limit = $${params.length}`);
    } else if (planLimit !== undefined) {
      params.push(planLimit);
      sets.push(`operator_limit = $${params.length}`);
    }

    // --- срок --------------------------------------------------------------
    if (body.paidUntil !== undefined) {
      let value: string | null = null;
      if (body.paidUntil !== null && String(body.paidUntil) !== '') {
        const raw = String(body.paidUntil);
        const d = new Date(raw);
        if (Number.isNaN(d.getTime())) {
          return res.status(400).json({ error: 'Неверная дата окончания' });
        }
        // «2026-11-01» без времени означает «до конца этого дня», иначе подписка
        // истекла бы ровно в полночь и на день раньше, чем ждёт владелец.
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) d.setUTCHours(23, 59, 59, 999);
        value = d.toISOString();
      }
      params.push(value);
      sets.push(`paid_until = $${params.length}`);
    }

    // --- статус подписки ---------------------------------------------------
    if (body.billingStatus !== undefined) {
      const status = String(body.billingStatus);
      if (status !== 'active' && status !== 'unpaid') {
        return res.status(400).json({ error: 'Статус: active или unpaid' });
      }
      params.push(status);
      sets.push(`billing_status = $${params.length}`);
    } else if (hasPlan) {
      // Выдать тариф и оставить клиента неоплаченным — почти всегда ошибка
      // оператора, поэтому назначение тарифа сразу включает подписку.
      sets.push("billing_status = 'active'");
    }

    if (!sets.length) return res.status(400).json({ error: 'Нечего менять' });

    params.push(tenantId);
    const updated = await pool.query(
      `UPDATE tenants
          SET ${sets.join(', ')}, billing_updated_at = CURRENT_TIMESTAMP
        WHERE id = $${params.length}
        RETURNING id`,
      params
    );
    if (!updated.rows.length) return res.status(404).json({ error: 'Tenant not found' });

    const row = await pool.query(
      `SELECT t.id, t.slug, t.name, t.status, t.billing_status, t.paid_until,
              t.plan_id, t.operator_limit, p.name AS plan_name, p.code AS plan_code
         FROM tenants t
         LEFT JOIN plans p ON p.id = t.plan_id
        WHERE t.id = $1`,
      [tenantId]
    );
    res.json(row.rows[0]);
  } catch (e) {
    console.error('admin route error:', e);
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
      // SEC-16: 8+ bytes of entropy (6 → 8 bytes = 16 hex chars).
      const code = crypto.randomBytes(8).toString('hex').toUpperCase();
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
  } catch (e) {
    console.error('admin route error:', e);
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
  } catch (e) {
    console.error('admin route error:', e);
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
  } catch (e) {
    console.error('admin route error:', e);
    res.status(500).json({ error: 'DB Error' });
  }
});

superRouter.post('/tenants', async (req, res) => {
  try {
    const { name, slug } = req.body;
    const createErr = firstError(
      validString(name, 'Название', { max: LIMITS.tenantName }),
      validSlug(slug)
    );
    if (createErr) return res.status(400).json({ error: createErr });
    const result = await pool.query(
      'INSERT INTO tenants (slug, name) VALUES ($1, $2) RETURNING id, slug, name, status, created_at',
      [String(slug).trim().toLowerCase(), String(name).trim()]
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
    // Suspending takes the tenant's operators offline; reactivating brings them back.
    if (status === 'suspended') {
      await pool.query('UPDATE operators SET is_enabled = false WHERE tenant_id = $1 AND role != $2', [req.params.id, 'superadmin']);
    } else if (status === 'active') {
      await pool.query('UPDATE operators SET is_enabled = true WHERE tenant_id = $1 AND role != $2', [req.params.id, 'superadmin']);
    }
    res.json(result.rows[0]);
  } catch (e) {
    console.error('admin route error:', e);
    res.status(500).json({ error: 'DB Error' });
  }
});

/**
 * Owner permanently deletes a tenant and every row that belongs to it.
 * The related foreign keys are not all ON DELETE CASCADE, so we remove the
 * dependent rows explicitly inside a single transaction. The tenant's Telegram
 * bot (if any) is detached from Telegram first (best effort).
 */
superRouter.delete('/tenants/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid tenant id' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT id, name, slug FROM tenants WHERE id = $1', [id]);
    if (!found.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Tenant not found' });
    }

    // Best effort: stop Telegram from forwarding updates to a dead endpoint.
    const bots = await client.query('SELECT bot_token FROM telegram_bots WHERE tenant_id = $1', [id]);
    for (const b of bots.rows) {
      try {
        await deleteWebhook(decryptToken(b.bot_token));
      } catch {
        /* token may be stale/undecryptable — ignore */
      }
    }

    await client.query('DELETE FROM messages WHERE chat_id IN (SELECT id FROM chats WHERE tenant_id = $1)', [id]);
    await client.query('DELETE FROM chat_tags WHERE chat_id IN (SELECT id FROM chats WHERE tenant_id = $1)', [id]);
    await client.query('DELETE FROM chats WHERE tenant_id = $1', [id]);
    await client.query('DELETE FROM canned_responses WHERE tenant_id = $1', [id]);
    await client.query('DELETE FROM invite_codes WHERE tenant_id = $1', [id]);
    await client.query('DELETE FROM tags WHERE tenant_id = $1', [id]);
    await client.query('DELETE FROM settings WHERE tenant_id = $1', [id]);
    await client.query('DELETE FROM telegram_users WHERE tenant_id = $1', [id]);
    await client.query('DELETE FROM telegram_bots WHERE tenant_id = $1', [id]);
    // Operators last: chats/canned/invites (which reference them) are gone.
    await client.query('DELETE FROM operators WHERE tenant_id = $1', [id]);
    await client.query('DELETE FROM tenants WHERE id = $1', [id]);
    await client.query('COMMIT');

    res.json({ ok: true, id, name: found.rows[0].name, slug: found.rows[0].slug });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    console.error('delete tenant error:', e);
    res.status(500).json({ error: 'DB Error' });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// Superadmin: promo codes (CRM)
// ---------------------------------------------------------------------------

const PROMO_FIELDS =
  'id, code, discount_type, discount_value, max_activations, used_count, valid_from, valid_until, is_active, created_at';

function parsePromoInput(body: any): { value?: Record<string, unknown>; error?: string } {
  const discountType = body?.discountType;
  const discountValue = Number(body?.discountValue);
  if (!['percent', 'fixed'].includes(discountType)) return { error: 'Тип скидки: percent или fixed' };
  if (!Number.isInteger(discountValue) || discountValue <= 0) return { error: 'Значение скидки — целое число больше 0' };
  if (discountType === 'percent' && discountValue > 100) return { error: 'Процент скидки: от 1 до 100' };
  if (discountType === 'fixed' && discountValue > 1000000) return { error: 'Скидка: максимум 10000 $' };

  let maxActivations: number | null = null;
  if (body?.maxActivations !== undefined && body?.maxActivations !== null && body?.maxActivations !== '') {
    maxActivations = Number(body.maxActivations);
    if (!Number.isInteger(maxActivations) || maxActivations < 1) return { error: 'Лимит активаций — целое число больше 0 или пусто' };
  }

  const parseDate = (v: unknown): string | null | undefined => {
    if (v === undefined || v === null || v === '') return null;
    const d = new Date(String(v));
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  };
  const validFrom = parseDate(body?.validFrom);
  if (validFrom === undefined) return { error: 'Некорректная дата начала' };
  const validUntil = parseDate(body?.validUntil);
  if (validUntil === undefined) return { error: 'Некорректная дата окончания' };
  if (validFrom && validUntil && new Date(validUntil) <= new Date(validFrom)) {
    return { error: 'Дата окончания должна быть позже даты начала' };
  }

  return {
    value: { discountType, discountValue, maxActivations, validFrom, validUntil, isActive: body?.isActive !== false },
  };
}

superRouter.get('/promo-codes', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.code, p.discount_type, p.discount_value, p.max_activations, p.used_count,
              p.valid_from, p.valid_until, p.is_active, p.created_at, o.name AS created_by_name
       FROM promo_codes p LEFT JOIN operators o ON o.id = p.created_by
       ORDER BY p.created_at DESC`
    );
    res.json(result.rows);
  } catch (e) {
    console.error('superadmin promo list error:', e);
    res.status(500).json({ error: 'DB Error' });
  }
});

superRouter.post('/promo-codes', async (req, res) => {
  try {
    const parsed = parsePromoInput(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const v = parsed.value!;

    // Optional custom code; otherwise generate a random one.
    let code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : '';
    if (code && !/^[A-Z0-9_-]{3,32}$/.test(code)) {
      return res.status(400).json({ error: 'Код: 3–32 символа (латиница, цифры, «_», «-»)' });
    }

    const adminId = (req as AuthenticatedRequest).user!.id;
    const insert = async (c: string) =>
      pool.query(
        `INSERT INTO promo_codes (code, discount_type, discount_value, max_activations, valid_from, valid_until, is_active, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${PROMO_FIELDS}`,
        [c, v.discountType, v.discountValue, v.maxActivations, v.validFrom, v.validUntil, v.isActive, adminId]
      );

    if (code) {
      const r = await insert(code);
      return res.status(201).json(r.rows[0]);
    }
    for (let i = 0; i < 8; i++) {
      code = crypto.randomBytes(5).toString('hex').toUpperCase().slice(0, 10);
      try {
        const r = await insert(code);
        return res.status(201).json(r.rows[0]);
      } catch (e: any) {
        if (e.code !== '23505') throw e;
      }
    }
    return res.status(500).json({ error: 'Не удалось сгенерировать код' });
  } catch (e: any) {
    if (e.code === '23505') return res.status(400).json({ error: 'Такой промокод уже существует' });
    console.error('superadmin promo create error:', e);
    res.status(500).json({ error: 'DB Error' });
  }
});

superRouter.put('/promo-codes/:id', async (req, res) => {
  try {
    const parsed = parsePromoInput(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const v = parsed.value!;
    const result = await pool.query(
      `UPDATE promo_codes
       SET discount_type = $1, discount_value = $2, max_activations = $3,
           valid_from = $4, valid_until = $5, is_active = $6
       WHERE id = $7 RETURNING ${PROMO_FIELDS}`,
      [v.discountType, v.discountValue, v.maxActivations, v.validFrom, v.validUntil, v.isActive, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Промокод не найден' });
    res.json(result.rows[0]);
  } catch (e) {
    console.error('superadmin promo update error:', e);
    res.status(500).json({ error: 'DB Error' });
  }
});

superRouter.delete('/promo-codes/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM promo_codes WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Промокод не найден' });
    res.json({ ok: true });
  } catch (e) {
    console.error('superadmin promo delete error:', e);
    res.status(500).json({ error: 'DB Error' });
  }
});

// ---------------------------------------------------------------------------
// Superadmin: payments (CRM)
// ---------------------------------------------------------------------------

superRouter.get('/payments', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT pm.id, pm.tenant_id, t.name AS tenant_name, t.slug AS tenant_slug,
              pm.plan_id, pl.name AS plan_name, pl.code AS plan_code,
              pm.base_cents, pm.amount_cents, pm.discount_type, pm.discount_value,
              pc.code AS promo_code, pm.method, pm.status, pm.pay_url, pm.paid_at, pm.created_at
       FROM payments pm
       JOIN tenants t ON t.id = pm.tenant_id
       LEFT JOIN plans pl ON pl.id = pm.plan_id
       LEFT JOIN promo_codes pc ON pc.id = pm.promo_code_id
       ORDER BY pm.created_at DESC
       LIMIT 200`
    );
    res.json(result.rows);
  } catch (e) {
    console.error('superadmin payments list error:', e);
    res.status(500).json({ error: 'DB Error' });
  }
});

/** Manual confirmation (used when online payment is disabled/missed). */
superRouter.post('/payments/:id/confirm', async (req, res) => {
  try {
    const adminId = (req as AuthenticatedRequest).user!.id;
    const result = await markPaymentPaid(Number(req.params.id), { method: 'manual', confirmedBy: adminId });
    if (!result.ok) return res.status(400).json({ error: result.error || 'Не удалось подтвердить платёж' });
    res.json({ ok: true, alreadyPaid: !!result.alreadyPaid });
  } catch (e) {
    console.error('superadmin payment confirm error:', e);
    res.status(500).json({ error: 'DB Error' });
  }
});

superRouter.post('/payments/:id/cancel', async (req, res) => {
  try {
    const result = await pool.query(
      "UPDATE payments SET status = 'cancelled' WHERE id = $1 AND status = 'pending' RETURNING id",
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Активный платёж не найден' });
    res.json({ ok: true });
  } catch (e) {
    console.error('superadmin payment cancel error:', e);
    res.status(500).json({ error: 'DB Error' });
  }
});

export { superRouter };
export default router;