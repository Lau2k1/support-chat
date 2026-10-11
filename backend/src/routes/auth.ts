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
    if (!user || !(await bcrypt.compare(password, user.password))) {
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

export default router;
