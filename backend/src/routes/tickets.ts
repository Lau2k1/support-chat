import { Router, Request, Response, NextFunction } from 'express';
import fs from 'fs';
import multer from 'multer';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { getTemplateById } from '../services/ticketTemplates';
import {
  listTickets,
  getTicket,
  createTicket,
  setTicketStatus,
  deleteTicket,
  validateTicketData,
  isTicketStatus,
} from '../services/tickets';
import { attachmentUpload } from '../utils/attachmentUpload';
import { UPLOAD_HINT } from '../utils/attachments';
import { tenantRelPath } from '../utils/uploadPaths';

const router = Router();

function getUser(req: Request) {
  return (req as any).user as {
    id: number;
    role: string;
    tenantId: number | null;
    email: string;
  };
}

/**
 * Файловое поле шаблона: вложение оператора или админа. Тенант уже известен
 * (authMiddleware выше), поэтому файл сразу кладём в папку тенанта.
 */
const upload = attachmentUpload((req) => (req as AuthenticatedRequest).user?.tenantId ?? null);

/** Тикет-форма с загруженным файлом (multer дописывает поле `file`). */
interface TicketUploadRequest extends Request {
  file?: Express.Multer.File;
}

router.use(authMiddleware);

// GET /tickets?status=open|resolved&templateId=1
router.get('/', async (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user.tenantId) return res.status(400).json({ error: 'Тенант не определён' });

  const statusRaw = typeof req.query.status === 'string' ? req.query.status : '';
  if (statusRaw && !isTicketStatus(statusRaw)) {
    return res.status(400).json({ error: 'Неверный статус' });
  }
  const templateRaw = req.query.templateId;
  let templateId: number | undefined;
  if (typeof templateRaw === 'string' && templateRaw !== '') {
    const n = Number(templateRaw);
    if (!Number.isInteger(n) || n <= 0) return res.status(400).json({ error: 'Неверный ID шаблона' });
    templateId = n;
  }

  const items = await listTickets(user.tenantId, {
    status: statusRaw ? (statusRaw as any) : undefined,
    templateId,
  });
  res.json({ items });
});

// GET /tickets/:id
router.get('/:id', async (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user.tenantId) return res.status(400).json({ error: 'Тенант не определён' });
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Неверный ID' });

  const ticket = await getTicket(id, user.tenantId);
  if (!ticket) return res.status(404).json({ error: 'Тикет не найден' });
  res.json({ ticket });
});

// POST /tickets — operator or admin fills an active template and creates a ticket.
router.post('/', async (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user.tenantId) return res.status(400).json({ error: 'Тенант не определён' });

  const body = req.body || {};
  const templateId = Number(body.templateId);
  if (!Number.isInteger(templateId) || templateId <= 0) {
    return res.status(400).json({ error: 'Выберите шаблон тикета' });
  }

  // The template must exist in the caller's tenant and be active.
  const template = await getTemplateById(templateId, user.tenantId);
  if (!template || !template.is_active) {
    return res.status(404).json({ error: 'Шаблон не найден или неактивен' });
  }

  const { data, error } = validateTicketData(template.schema, body.data);
  if (error) return res.status(400).json({ error });

  const ticket = await createTicket({
    tenantId: user.tenantId,
    templateId: template.id,
    templateName: template.name,
    templateSchema: template.schema,
    data,
    createdBy: user.id,
  });

  res.status(201).json({ ticket });
});

// POST /tickets/upload — вложение для поля «Файл». Возвращаем URL и исходное имя:
// оператор видит в форме имя, а при сохранении тикета они попадают в data поля.
// Файл пишется в папку тенанта, поэтому чужой оператор его не получит.
router.post(
  '/upload',
  (req: Request, res: Response, next: NextFunction) => {
    if (!getUser(req).tenantId) return res.status(400).json({ error: 'Тенант не определён' });
    next();
  },
  (req: TicketUploadRequest, res: Response, next: NextFunction) => {
    upload.single('file')(req as never, res as never, (err: unknown) => {
      if (err) {
        // Частично записанный файл (например, при превышении лимита) убираем.
        if (req.file?.path) fs.promises.unlink(req.file.path).catch(() => {});
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          res.status(413).json({ error: 'Файл слишком большой (макс. 20 МБ)' });
          return;
        }
        res.status(400).json({ error: 'Не удалось загрузить файл' });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: `Неподдерживаемый тип файла: ${UPLOAD_HINT}` });
        return;
      }
      next();
    });
  },
  (req: TicketUploadRequest, res: Response) => {
    const file = req.file as Express.Multer.File;
    const rel = tenantRelPath(getUser(req).tenantId as number, file.filename);
    res.status(201).json({
      file: { url: `/uploads/${rel}`, name: file.originalname, size: file.size },
    });
  }
);

// PUT /tickets/:id — change status (решено / не решено).
router.put('/:id', async (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user.tenantId) return res.status(400).json({ error: 'Тенант не определён' });
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Неверный ID' });

  const status = (req.body || {}).status;
  if (!isTicketStatus(status)) {
    return res.status(400).json({ error: 'Статус: open или resolved' });
  }

  const ticket = await setTicketStatus(id, user.tenantId, status, user.id);
  if (!ticket) return res.status(404).json({ error: 'Тикет не найден' });
  res.json({ ticket });
});

// DELETE /tickets/:id — admin only.
router.delete('/:id', async (req: Request, res: Response) => {
  const user = getUser(req);
  if (user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  if (!user.tenantId) return res.status(400).json({ error: 'Тенант не определён' });
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Неверный ID' });

  const ok = await deleteTicket(id, user.tenantId);
  if (!ok) return res.status(404).json({ error: 'Тикет не найден' });
  res.json({ success: true });
});

export default router;
