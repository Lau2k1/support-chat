import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { pool } from '../db';
import { SECRET } from '../middleware/auth';

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
    const token = jwt.sign({ id: user.id, name: user.name, role: user.role || 'operator' }, SECRET);
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
      'INSERT INTO operators (name, email, password, role) VALUES ($1, $2, $3, $4) RETURNING id, name, role',
      [name, email, hash, 'operator']
    );
    const newOp = opResult.rows[0];

    await client.query(
      'UPDATE invite_codes SET used_by = $1, used_at = CURRENT_TIMESTAMP WHERE id = $2',
      [newOp.id, invite.id]
    );

    await client.query('COMMIT');

    const token = jwt.sign({ id: newOp.id, name: newOp.name, role: newOp.role }, SECRET);
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
