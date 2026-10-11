import { Router } from 'express';
import { pool } from '../db';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { LIMITS, validShortcut, validString, firstError } from '../utils/validate';

const router = Router();

const FIELDS = 'id, shortcut, title, content, category';

router.get('/canned-responses', authMiddleware, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user!.id;
  const result = await pool.query(
    `SELECT ${FIELDS} FROM canned_responses WHERE operator_id = $1
     ORDER BY (category = '') ASC, category ASC, title ASC`,
    [userId]
  );
  res.json(result.rows);
});

router.post('/canned-responses', authMiddleware, async (req, res) => {
  const user = (req as AuthenticatedRequest).user!;
  const { shortcut, title, content, category } = req.body;
  const sc = typeof shortcut === 'string' ? shortcut.trim() : '';
  const cat = typeof category === 'string' ? category.trim() : '';
  const err = firstError(
    sc ? validShortcut(sc) : null,
    cat ? validString(cat, 'Категория', { max: LIMITS.cannedCategory }) : null,
    validString(title, 'Название', { max: LIMITS.cannedTitle }),
    validString(content, 'Текст', { min: 1, max: LIMITS.cannedContent })
  );
  if (err) return res.status(400).json({ error: err });
  const result = await pool.query(
    `INSERT INTO canned_responses (operator_id, tenant_id, shortcut, title, content, category)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${FIELDS}`,
    [user.id, user.tenantId, sc, String(title).trim(), content, cat]
  );
  res.status(201).json(result.rows[0]);
});

router.put('/canned-responses/:id', authMiddleware, async (req, res) => {
  const userId = (req as AuthenticatedRequest).user!.id;
  const { shortcut, title, content, category } = req.body;

  const sc = shortcut === undefined ? undefined : (typeof shortcut === 'string' ? shortcut.trim() : shortcut);
  if (sc !== undefined && sc !== '') {
    const e = validShortcut(sc);
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
  const cat = category === undefined ? undefined : (typeof category === 'string' ? category.trim() : category);
  if (cat !== undefined && cat !== '') {
    const e = validString(cat, 'Категория', { max: LIMITS.cannedCategory });
    if (e) return res.status(400).json({ error: e });
  }

  const result = await pool.query(
    `UPDATE canned_responses
     SET shortcut = COALESCE($1, shortcut),
         title = COALESCE($2, title),
         content = COALESCE($3, content),
         category = COALESCE($4, category)
     WHERE id = $5 AND operator_id = $6
     RETURNING ${FIELDS}`,
    [sc, title, content, cat, req.params.id, userId]
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