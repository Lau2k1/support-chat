import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { UPLOADS_DIR } from './uploadPaths';
import { MAX_UPLOAD_BYTES, classifyAttachment } from './attachments';

/**
 * Multer для вложений (файлы чата и файловые поля тикетов): принимаем картинки,
 * видео и документы, лимит 20 МБ, кладём в подпапку `tenant-<id>/` — изоляция
 * тенантов. Тенант запроса отдаёт вызывающий роут: авторизация выполняется до
 * multer (см. routes/upload.ts и routes/tickets.ts), поэтому к моменту записи
 * файла он уже известен.
 */
export function attachmentUpload(tenantOf: (req: unknown) => number | null | undefined) {
  return multer({
    storage: multer.diskStorage({
      destination: (req, _file, cb) => {
        const tenantId = tenantOf(req);
        const dir = tenantId != null ? path.join(UPLOADS_DIR, `tenant-${tenantId}`) : UPLOADS_DIR;
        fs.mkdir(dir, { recursive: true }, (err) => cb(err, dir));
      },
      filename: (_req, file, cb) => {
        cb(null, crypto.randomUUID() + path.extname(file.originalname));
      },
    }),
    limits: { fileSize: MAX_UPLOAD_BYTES },
    fileFilter: (_req, file, cb) => {
      cb(null, classifyAttachment(file.originalname) !== null);
    },
  });
}
