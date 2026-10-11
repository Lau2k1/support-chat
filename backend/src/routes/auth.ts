import { Router } from 'express';
import bcrypt from 'bcrypt';
import { pool } from '../db';
import {
  signToken,
  authMiddleware,
  authCookieOptions,
  AUTH_COOKIE,
  type AuthenticatedRequest,
} from '../middleware/auth';
import { LIMITS, validEmail, validPassword, validString, firstError } from '../utils/validate';

const router = Router();

const INVITE_RE = /^[A-Fa-f0-9]{8,32}$/;

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
  const { name, email, password, inviteCode } = req.body;
  const err = firstError(
    validString(name, 'Имя', { max: LIMITS.operatorName }),
    validEmail(email),
    validPassword(password),
    typeof inviteCode === 'string' && INVITE_RE.test(inviteCode.trim()) ? null : 'Некорректный инвайт-код'
  );
  if (err) return res.status(400).json({ error: err });
  const normEmail = String(email).trim().toLowerCase();
  const normCode = String(inviteCode).trim().toUpperCase();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const inviteResult = await client.query(
      'SELECT * FROM invite_codes WHERE code = $1 AND used_by IS NULL FOR UPDATE',
      [normCode]
    );
    const invite = inviteResult.rows[0];
    if (!invite) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid or already used invite code' });
    }
    if (!invite.tenant_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invite code has no tenant' });
    }
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invite code has expired' });
    }

    const existing = await client.query('SELECT id FROM operators WHERE lower(email) = $1', [normEmail]);
    if (existing.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Email уже зарегистрирован' });
    }

    const hash = await bcrypt.hash(password, 10);
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
    res.status(201).json({ token });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  } finally {
    client.release();
  }
});

/** Current operator profile (used by the SPA to rehydrate after a reload). */
router.get('/me', authMiddleware, (req, res) => {
  const user = (req as AuthenticatedRequest).user!;
  res.json({ id: user.id, name: user.name, role: user.role, tenantId: user.tenantId });
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
