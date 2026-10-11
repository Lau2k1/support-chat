import { Router } from 'express';
import { pool } from '../db';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { LIMITS, validShortcut, validString, firstError } from '../utils/validate';

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
  const user = (req as AuthenticatedRequest).user!;
  const { shortcut, title, content } = req.body;
  const err = firstError(
    validShortcut(shortcut),
    validString(title, 'Название', { max: LIMITS.cannedTitle }),
    validString(content, 'Текст', { min: 1, max: LIMITS.cannedContent })
  );
  if (err) return res.status(400).json({ error: err });
  const result = await pool.query(
    'INSERT INTO canned_responses (operator_id, tenant_id, shortcut, title, content) VALUES ($1, $2, $3, $4, $5) RETURNING id, shortcut, title, content',
    [user.id, user.tenantId, String(shortcut).trim(), String(title).trim(), content]
  );
  res.status(201).json(result.rows[0]);
});

router.put('/canned-responses/:id', authMiddleware, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user!.id;
  const { shortcut, title, content } = req.body;
  if (shortcut !== undefined) {
    const e = validShortcut(shortcut);
    if (e) return res.status(400).json({ error: e });
  }
  if (title !== undefined) {
    const e = validString(title, 'Название', { max: LIMITS.cannedTitle });
    if (e) return res.status(400).json({ error: e });
  }
  if (content !== undefined) {
    const e = validString(content, 'Текст', { min: 1, max: LIMITS.cannedContent });
    if (e) return res.status(400).json({ error: e });
  }
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
