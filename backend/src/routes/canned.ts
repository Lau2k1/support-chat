import { Router } from 'express';
import { pool } from '../db';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

router.get('/canned-responses', authMiddleware, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user!.id;
  const result = await pool.query(
    'SELECT id, shortcut, title, content FROM canned_responses WHERE operator_id = $1 ORDER BY shortcut',
    [userId]
  );
  res.json(result.rows);
});

router.post('/canned-responses', authMiddleware, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user!.id;
  const { shortcut, title, content } = req.body;
  if (!shortcut || !title || !content) {
    return res.status(400).json({ error: 'shortcut, title and content are required' });
  }
  const result = await pool.query(
    'INSERT INTO canned_responses (operator_id, shortcut, title, content) VALUES ($1, $2, $3, $4) RETURNING id, shortcut, title, content',
    [userId, shortcut, title, content]
  );
  res.status(201).json(result.rows[0]);
});

router.put('/canned-responses/:id', authMiddleware, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user!.id;
  const { shortcut, title, content } = req.body;
  const result = await pool.query(
    'UPDATE canned_responses SET shortcut = COALESCE($1, shortcut), title = COALESCE($2, title), content = COALESCE($3, content) WHERE id = $4 AND operator_id = $5 RETURNING id, shortcut, title, content',
    [shortcut, title, content, req.params.id, userId]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(result.rows[0]);
});

router.delete('/canned-responses/:id', authMiddleware, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user!.id;
  const result = await pool.query(
    'DELETE FROM canned_responses WHERE id = $1 AND operator_id = $2 RETURNING id',
    [req.params.id, userId]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

export default router;
