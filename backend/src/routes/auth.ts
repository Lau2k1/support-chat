import { Router } from 'express';
import bcrypt from 'bcrypt';
import { pool } from '../db';
import { signToken } from '../middleware/auth';

const router = Router();

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await pool.query('SELECT * FROM operators WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!user.is_enabled) {
      return res.status(403).json({ error: 'Account disabled' });
    }
    const token = signToken(user);
    res.json({ token });
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

router.post('/register', async (req, res) => {
  const { name, email, password, inviteCode } = req.body;
  if (!name || !email || !password || !inviteCode) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const inviteResult = await client.query(
      'SELECT * FROM invite_codes WHERE code = $1 AND used_by IS NULL FOR UPDATE',
      [inviteCode]
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

    const existing = await client.query('SELECT id FROM operators WHERE email = $1', [email]);
    if (existing.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hash = await bcrypt.hash(password, 10);
    const opResult = await client.query(
      'INSERT INTO operators (name, email, password, role, tenant_id) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, role, token_version, tenant_id',
      [name, email, hash, 'operator', invite.tenant_id]
    );
    const newOp = opResult.rows[0];

    await client.query(
      'UPDATE invite_codes SET used_by = $1, used_at = CURRENT_TIMESTAMP WHERE id = $2',
      [newOp.id, invite.id]
    );

    await client.query('COMMIT');

    const token = signToken(newOp);
    res.status(201).json({ token });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  } finally {
    client.release();
  }
});

export default router;
