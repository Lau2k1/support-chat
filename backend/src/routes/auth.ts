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
    if (user && await bcrypt.compare(password, user.password)) {
      const token = jwt.sign({ id: user.id, name: user.name }, SECRET);
      res.json({ token });
    } else {
      res.status(401).json({ error: 'Unauthorized' });
    }
  } catch {
    res.status(500).json({ error: 'DB Error' });
  }
});

export default router;
