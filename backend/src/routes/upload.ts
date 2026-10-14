import { Router, type Response, type NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { pool } from '../db';
import { authMiddleware, resolveOperator, tokenFromRequest, AuthenticatedRequest, type AuthUser } from '../middleware/auth';
import { broadcastToRoom } from '../services/chat';
import { forwardMessageToTelegram } from '../services/telegram';
import { signFileUrl } from '../utils/signedUrl';
import { UPLOADS_DIR, tenantRelPath } from '../utils/uploadPaths';
import type { OutgoingMessage } from '../ws/types';

const upload = multer({
  storage: multer.diskStorage({
    // Изоляция тенантов: новые файлы кладём в подпапку `tenant-<id>/`. Тенант
    // известен заранее — authorizeUpload выполняется до multer и кладёт id в req.
    destination: (req, _file, cb) => {
      const tenantId = (req as UploadRequest).uploadTenantId;
      const dir = tenantId != null ? path.join(UPLOADS_DIR, `tenant-${tenantId}`) : UPLOADS_DIR;
      fs.mkdir(dir, { recursive: true }, (err) => cb(err, dir));
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, crypto.randomUUID() + ext);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.doc', '.docx', '.txt'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

/**
 * Resolves the caller of a client-facing endpoint: either an authenticated
 * operator or the owner of the chat (proofed by its client token).
 */
async function resolveCaller(req: AuthenticatedRequest, chatId: number) {
  // SEC-01/SEC-02: operators may authenticate via Bearer *or* the HttpOnly cookie.
  const token = tokenFromRequest(req as unknown as { headers: Record<string, unknown> });
  const operator = token ? await resolveOperator(token) : null;

  const clientToken =
    (typeof req.query.token === 'string' ? req.query.token : undefined) ||
    (typeof req.headers['x-client-token'] === 'string' ? req.headers['x-client-token'] : undefined);
  const owner = clientToken
    ? await pool.query('SELECT client_token FROM chats WHERE id = $1', [chatId])
    : null;
  const isOwner = !!owner?.rows[0] && owner.rows[0].client_token === clientToken;

  return { operator, isOwner };
}

const router = Router();

interface UploadRequest extends AuthenticatedRequest {
  uploadChatId?: number;
  uploadOperator?: AuthUser | null;
  uploadTenantId?: number | null;
}

/**
 * SEC-02: authorize *before* multer touches the disk, so an unauthenticated or
 * cross-tenant request can never leave an orphan file on the volume.
 */
async function authorizeUpload(req: UploadRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const chatId = Number(req.params.chatId);
    if (!Number.isInteger(chatId) || chatId <= 0) {
      res.status(400).json({ error: 'Invalid chat id' });
      return;
    }

    const chatCheck = await pool.query('SELECT status, tenant_id FROM chats WHERE id = $1', [chatId]);
    const chat = chatCheck.rows[0];
    if (!chat || chat.status === 'closed') {
      res.status(404).json({ error: 'Chat not found or closed' });
      return;
    }

    const { operator, isOwner } = await resolveCaller(req, chatId);
    if (!operator && !isOwner) {
      res.status(401).json({ error: 'Auth required' });
      return;
    }
    if (operator && operator.role !== 'superadmin' && chat.tenant_id !== operator.tenantId) {
      res.status(403).json({ error: 'Chat belongs to another tenant' });
      return;
    }

    req.uploadChatId = chatId;
    req.uploadOperator = operator;
    req.uploadTenantId = chat.tenant_id ?? null;
    next();
  } catch (e) {
    console.error('Upload auth error:', e);
    res.status(500).json({ error: 'DB Error' });
  }
}

router.post(
  '/upload/:chatId',
  authorizeUpload,
  (req: UploadRequest, res: Response, next: NextFunction) => {
    upload.single('file')(req as never, res as never, (err: unknown) => {
      if (err) {
        const f = req.file as Express.Multer.File | undefined;
        if (f?.path) fs.promises.unlink(f.path).catch(() => {});
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          res.status(413).json({ error: 'Файл слишком большой (макс. 10 МБ)' });
          return;
        }
        res.status(400).json({ error: 'Upload error' });
        return;
      }
      next();
    });
  },
  async (req: UploadRequest, res: Response) => {
    const file = req.file as Express.Multer.File;
    if (!file) {
      res.status(400).json({ error: 'No file' });
      return;
    }

    const chatId = req.uploadChatId!;
    const operator = req.uploadOperator ?? null;

    try {
      const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(file.originalname);
      const message_type = isImage ? 'image' : 'file';
      // Изоляция тенантов: путь включает папку тенанта, если она известна.
      const rel = req.uploadTenantId != null ? tenantRelPath(req.uploadTenantId, file.filename) : file.filename;
      const fileUrl = `/uploads/${rel}`;
      const content = file.originalname;

      const senderId = operator?.id || 0;

      const result = await pool.query(
        "INSERT INTO messages (chat_id, sender_id, content, message_type, file_url) VALUES ($1, $2, $3, $4, $5) RETURNING *, extract(epoch from created_at) * 1000 as created_at",
        [chatId, senderId, content, message_type, fileUrl]
      );

      // Push the stored message into the chat room (widget client + operators) so
      // everyone sees the upload without a separate WS round-trip. The message is
      // re-read from the DB row (server-side), so clients can't forge file_url.
      const timeUpdate = await pool.query(
        'UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING extract(epoch from updated_at) * 1000 as updated_at',
        [chatId]
      );
      const serverTime = Number(timeUpdate.rows[0].updated_at);

      const out: OutgoingMessage = {
        type: 'message',
        message: {
          ...result.rows[0],
          sender_name: operator?.name || 'Клиент',
          message_type: result.rows[0].message_type || 'file',
          file_url: signFileUrl(result.rows[0].file_url),
        },
        updated_at: serverTime,
      };
      broadcastToRoom(chatId, out);

      // Mirror operator uploads into a Telegram-sourced chat.
      if (senderId !== 0) {
        forwardMessageToTelegram(chatId, result.rows[0]).catch((e) => console.error('TG forward failed', e));
      }

      res.json({ ...result.rows[0], file_url: signFileUrl(result.rows[0].file_url) });
    } catch (e) {
      // SEC-02: never leave an orphan file behind when the insert/broadcast fails.
      fs.promises.unlink(file.path).catch(() => {});
      console.error('Upload handler error:', e);
      res.status(500).json({ error: 'Upload failed' });
    }
  }
);

router.post('/rate/:chatId', async (req, res) => {
  const chatId = Number(req.params.chatId);
  if (!Number.isInteger(chatId) || chatId <= 0) {
    return res.status(400).json({ error: 'Invalid chat id' });
  }
  const { rating } = req.body;
  if (!rating || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Rating must be 1-5' });
  }

  const { operator, isOwner } = await resolveCaller(req, chatId);
  if (!operator && !isOwner) {
    return res.status(401).json({ error: 'Auth required' });
  }
  if (operator && operator.role !== 'superadmin') {
    const chatCheck = await pool.query('SELECT tenant_id FROM chats WHERE id = $1', [chatId]);
    if (!chatCheck.rows.length || chatCheck.rows[0].tenant_id !== operator.tenantId) {
      return res.status(403).json({ error: 'Chat belongs to another tenant' });
    }
  }

  const result = await pool.query(
    'UPDATE chats SET rating = $1 WHERE id = $2 AND status = $3 RETURNING id',
    [rating, chatId, 'closed']
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Chat not found or not closed' });
  res.json({ ok: true });
});

router.get('/stats', authMiddleware, async (req, res) => {
  const user = (req as AuthenticatedRequest).user!;
  const scope = user.role !== 'superadmin' ? ' AND c.tenant_id = $1' : '';
  const scopeParams = user.role !== 'superadmin' ? [user.tenantId] : [];

  const totalChats = await pool.query(`SELECT COUNT(*)::int AS count FROM chats c WHERE 1=1${scope}`, scopeParams);
  const openChats = await pool.query(`SELECT COUNT(*)::int AS count FROM chats c WHERE c.status = 'open'${scope}`, scopeParams);
  const closedChats = await pool.query(`SELECT COUNT(*)::int AS count FROM chats c WHERE c.status = 'closed'${scope}`, scopeParams);

  const statsScope = user.role !== 'superadmin';
  const avgResponse = await pool.query(`
    SELECT COALESCE(AVG(diff), 0) AS avg_seconds FROM (
      SELECT EXTRACT(EPOCH FROM (m1.created_at - c.created_at)) AS diff
      FROM messages m1
      JOIN chats c ON c.id = m1.chat_id
      WHERE m1.sender_id != 0
        AND m1.id = (
          SELECT MIN(m2.id) FROM messages m2
          WHERE m2.chat_id = c.id AND m2.sender_id != 0
        )
        AND c.created_at > NOW() - INTERVAL '30 days'
        ${statsScope ? 'AND c.tenant_id = $1' : ''}
    ) sub
  `, statsScope ? [user.tenantId] : []);

  const avgRating = await pool.query(`SELECT COALESCE(AVG(rating), 0) AS avg_rating FROM chats c WHERE rating IS NOT NULL${scope}`, scopeParams);
  const totalMessages = await pool.query(
    `SELECT COUNT(*)::int AS count FROM messages m JOIN chats c ON c.id = m.chat_id WHERE 1=1${scope}`,
    scopeParams
  );

  res.json({
    totalChats: totalChats.rows[0].count,
    openChats: openChats.rows[0].count,
    closedChats: closedChats.rows[0].count,
    totalMessages: totalMessages.rows[0].count,
    avgResponseSec: Math.round(Number(avgResponse.rows[0].avg_seconds)),
    avgRating: Math.round(Number(avgRating.rows[0].avg_rating) * 10) / 10,
  });
});

router.get('/stats/daily', authMiddleware, async (req, res) => {
  const user = (req as AuthenticatedRequest).user!;
  const result = await pool.query(`
    SELECT TO_CHAR(date, 'DD.MM') AS day, COALESCE(count, 0) AS count
    FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, '1 day') AS date
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS count FROM chats c WHERE DATE(c.created_at) = date ${user.role !== 'superadmin' ? 'AND c.tenant_id = $1' : ''}
    ) c ON true
    ORDER BY date
  `, user.role !== 'superadmin' ? [user.tenantId] : []);
  res.json(result.rows);
});

export default router;
