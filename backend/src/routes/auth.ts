import { Router } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { pool } from '../db';
import {
  signToken,
  authMiddleware,
  authCookieOptions,
  AUTH_COOKIE,
  type AuthenticatedRequest,
} from '../middleware/auth';
import { LIMITS, validEmail, validPassword, validString, firstError } from '../utils/validate';
import { notifyNewTenant } from '../services/notify';

const router = Router();

const INVITE_RE = /^[A-Fa-f0-9]{8,32}$/;

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya',
};

/** Builds an URL-safe tenant slug from a (possibly Cyrillic) company name. */
export function slugifyTenant(input: string): string {
  const s = input
    .trim()
    .toLowerCase()
    .split('')
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return s;
}

/** Unique slug for a new self-registered tenant. */
export async function uniqueTenantSlug(client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }, name: string): Promise<string> {
  let base = slugifyTenant(name);
  if (base.length < 2) base = `tenant-${crypto.randomBytes(3).toString('hex')}`;
  let candidate = base;
  for (let i = 0; i < 22; i++) {
    const exists = await client.query('SELECT 1 FROM tenants WHERE slug = $1', [candidate]);
    if (!exists.rows.length) return candidate;
    candidate = `${base}-${crypto.randomBytes(2).toString('hex')}`;
  }
  return `tenant-${crypto.randomBytes(6).toString('hex')}`;
}

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      return res.status(400).json({ error: 'Укажите email и пароль' });
    }
    const result = await pool.query('SELECT * FROM operators WHERE lower(email) = $1', [email.trim().toLowerCase()]);
    const user = result.rows[0];
    // SEC-11: always run bcrypt.compare — with a dummy hash when the user is
    // missing — so the response time doesn't reveal whether the email exists.
    const DUMMY_HASH = '$2b$10$P0Xx/2wH0DljYe9TDPHcHOXno6aDSd3tiMr9R9yyca1XFK7UVpSyO';
    const passwordOk = await bcrypt.compare(password, user?.password || DUMMY_HASH);
    if (!user || !passwordOk) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }
    if (!user.is_enabled) {
      return res.status(403).json({ error: 'Аккаунт отключён' });
    }
    const token = signToken(user);
    // SEC-01: session lives in an HttpOnly cookie (XSS cannot read it); the token
    // is still returned for API clients / smoke tests that prefer Bearer auth.
    res.cookie(AUTH_COOKIE, token, authCookieOptions());
    res.json({ token });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'DB Error' });
  }
});

router.post('/register', async (req, res) => {
  const { name, email, password, inviteCode, company } = req.body ?? {};
  // Two flows share this endpoint:
  //  - with an invite code → an operator joins an existing tenant;
  //  - without one → a client self-registers and becomes the admin of a NEW tenant.
  const hasInvite = typeof inviteCode === 'string' && inviteCode.trim().length > 0;
  const companyStr = typeof company === 'string' ? company.trim() : '';

  const err = firstError(
    validString(name, 'Имя', { max: LIMITS.operatorName }),
    validEmail(email),
    validPassword(password),
    hasInvite && !INVITE_RE.test(String(inviteCode).trim()) ? 'Некорректный инвайт-код' : null,
    !hasInvite && companyStr.length > LIMITS.tenantName
      ? `Название компании: максимум ${LIMITS.tenantName} символов`
      : null
  );
  if (err) return res.status(400).json({ error: err });
  const normEmail = String(email).trim().toLowerCase();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query('SELECT id FROM operators WHERE lower(email) = $1', [normEmail]);
    if (existing.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Email уже зарегистрирован' });
    }

    const hash = await bcrypt.hash(String(password), 10);

    // ---- Operator joins an existing tenant by invite code ----
    if (hasInvite) {
      const normCode = String(inviteCode).trim().toUpperCase();
      const inviteResult = await client.query(
        'SELECT * FROM invite_codes WHERE code = $1 AND used_by IS NULL FOR UPDATE',
        [normCode]
      );
      const invite = inviteResult.rows[0];
      if (!invite) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Неверный или уже использованный инвайт-код' });
      }
      if (!invite.tenant_id) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Инвайт-код не привязан к аккаунту' });
      }
      if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Инвайт-код истёк' });
      }

      const opResult = await client.query(
        'INSERT INTO operators (name, email, password, role, tenant_id) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, role, token_version, tenant_id',
        [String(name).trim(), normEmail, hash, 'operator', invite.tenant_id]
      );
      const newOp = opResult.rows[0];
      await client.query(
        'UPDATE invite_codes SET used_by = $1, used_at = CURRENT_TIMESTAMP WHERE id = $2',
        [newOp.id, invite.id]
      );
      await client.query('COMMIT');

      const token = signToken(newOp);
      res.cookie(AUTH_COOKIE, token, authCookieOptions());
      return res.status(201).json({ token, role: 'operator' });
    }

    // ---- Client self-registers: create a fresh (unpaid) tenant + admin ----
    const tenantName = (companyStr || String(name).trim()).slice(0, LIMITS.tenantName);
    const slug = await uniqueTenantSlug(client, tenantName);
    const tenantRes = await client.query(
      "INSERT INTO tenants (slug, name, status, billing_status) VALUES ($1, $2, 'active', 'unpaid') RETURNING id",
      [slug, tenantName]
    );
    const tenantId: number = tenantRes.rows[0].id;

    // Per-tenant defaults so the widget/panels work as soon as the tenant pays.
    await client.query(
      `INSERT INTO settings (tenant_id, key, value) VALUES
         ($1, 'chat_timeout_minutes', $2),
         ($1, 'welcome_message', 'Здравствуйте! Чем могу помочь?'),
         ($1, 'widget_origins', '[]')
       ON CONFLICT (tenant_id, key) DO NOTHING`,
      [tenantId, String(process.env.CHAT_TIMEOUT_MINUTES || 7)]
    );

    const opResult = await client.query(
      'INSERT INTO operators (name, email, password, role, tenant_id) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, role, token_version, tenant_id',
      [String(name).trim(), normEmail, hash, 'admin', tenantId]
    );
    const newOp = opResult.rows[0];
    await client.query('COMMIT');

    // Лид: сообщаем владельцу, что кто-то зарегистрировался и ждёт оплаты.
    notifyNewTenant({ tenantName, slug, email: normEmail, source: 'регистрация на сайте' });

    const token = signToken(newOp);
    res.cookie(AUTH_COOKIE, token, authCookieOptions());
    return res.status(201).json({ token, role: 'admin', tenantId });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Register error:', e);
    res.status(500).json({ error: 'Registration failed' });
  } finally {
    client.release();
  }
});

/** Current operator profile (used by the SPA to rehydrate after a reload). */
router.get('/me', authMiddleware, (req, res) => {
  const user = (req as AuthenticatedRequest).user!;
  res.json({
    id: user.id,
    name: user.name,
    role: user.role,
    tenantId: user.tenantId,
    email: user.email ?? null,
    billing: {
      active: user.tenantActive,
      status: user.tenantBillingStatus ?? null,
      paidUntil: user.tenantPaidUntil ?? null,
      planName: user.tenantPlanName ?? null,
    },
    telegram: {
      linked: Boolean(user.telegramId),
      username: user.telegramUsername ?? null,
    },
    hasPassword: user.hasPassword !== false,
    features: user.features,
  });
});

/** Clears the session cookie. Idempotent (works even without a valid session). */
router.post('/logout', (_req, res) => {
  res.clearCookie(AUTH_COOKIE, { path: '/' });
  res.json({ ok: true });
});

/**
 * Self-service password change. Requires the current password (proves the session
 * owner is present, not just a stolen cookie). On success every previously issued
 * token is invalidated via token_version, and a fresh session is issued to THIS
 * client so other devices are logged out without logging the user out here.
 */
router.post('/me/password', authMiddleware, async (req, res) => {
  try {
    const user = (req as AuthenticatedRequest).user!;
    const { currentPassword, newPassword } = (req.body ?? {}) as {
      currentPassword?: unknown;
      newPassword?: unknown;
    };

    if (typeof currentPassword !== 'string' || currentPassword.length === 0) {
      return res.status(400).json({ error: 'Укажите текущий пароль' });
    }
    const policyError = validPassword(newPassword);
    if (policyError) return res.status(400).json({ error: policyError });
    if (currentPassword === newPassword) {
      return res.status(400).json({ error: 'Новый пароль должен отличаться от текущего' });
    }

    const current = await pool.query('SELECT password FROM operators WHERE id = $1', [user.id]);
    const row = current.rows[0];
    if (!row) return res.status(404).json({ error: 'Оператор не найден' });

    const ok = await bcrypt.compare(currentPassword, row.password);
    if (!ok) return res.status(401).json({ error: 'Неверный текущий пароль' });

    const hash = await bcrypt.hash(String(newPassword), 10);
    const updated = await pool.query(
      'UPDATE operators SET password = $1, token_version = token_version + 1 WHERE id = $2 RETURNING id, name, role, token_version, tenant_id',
      [hash, user.id]
    );
    const u = updated.rows[0];

    // Re-issue the cookie with the bumped token_version so this session survives.
    const token = signToken({
      id: u.id,
      name: u.name,
      role: u.role,
      token_version: u.token_version,
      tenant_id: u.tenant_id,
    });
    res.cookie(AUTH_COOKIE, token, authCookieOptions());
    console.log(`Password changed for operator id=${user.id}`);
    res.json({ token });
  } catch (e) {
    console.error('Change password error:', e);
    res.status(500).json({ error: 'DB Error' });
  }
});

export default router;
