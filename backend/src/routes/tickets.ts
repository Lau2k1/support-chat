import { Router, Request, Response, NextFunction } from 'express';
import fs from 'fs';
import multer from 'multer';
import { pool } from '../db';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { getTemplateById, isTicketPriority } from '../services/ticketTemplates';
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

const MAX_SUBJECT = 150;
const MAX_DESCRIPTION = 5000;

/** An automation assignee must still be an enabled operator of the tenant. */
async function validAssignee(tenantId: number, id: unknown): Promise<number | null> {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  const res = await pool.query(
    `SELECT 1 FROM operators
     WHERE id = $1 AND tenant_id = $2 AND is_enabled = true AND role IN ('admin', 'operator')`,
    [n, tenantId]
  );
  return res.rowCount ? n : null;
}

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

// POST /tickets — an operator or admin creates a ticket either from an active
// template (body.templateId) or as a free-form request (body.subject).
router.post('/', async (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user.tenantId) return res.status(400).json({ error: 'Тенант не определён' });

  const body = req.body || {};
  const templateId = Number(body.templateId);
  const wantsFree = body.mode === 'free' || !Number.isInteger(templateId) || templateId <= 0;

  if (wantsFree) {
    const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
    if (subject.length < 3) {
      return res.status(400).json({ error: 'Укажите тему обращения (минимум 3 символа)' });
    }
    if (subject.length > MAX_SUBJECT) {
      return res.status(400).json({ error: `Тема: максимум ${MAX_SUBJECT} символов` });
    }
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (description.length > MAX_DESCRIPTION) {
      return res.status(400).json({ error: `Описание: максимум ${MAX_DESCRIPTION} символов` });
    }

    const ticket = await createTicket({
      tenantId: user.tenantId,
      templateId: null,
      templateName: subject,
      // Snapshot a one-field schema so the existing detail view can render the
      // description without special-casing free tickets.
      templateSchema: {
        fields: [{ id: 'description', type: 'textarea', label: 'Описание', required: false }],
      },
      data: description ? { description } : {},
      priority: isTicketPriority(body.priority) ? body.priority : 'normal',
      assignedTo: null,
      createdBy: user.id,
    });

    return res.status(201).json({ ticket });
  }

  // The template must exist in the caller's tenant and be active.
  const template = await getTemplateById(templateId, user.tenantId);
  if (!template || !template.is_active) {
    return res.status(404).json({ error: 'Шаблон не найден или неактивен' });
  }

  const { data, error } = validateTicketData(template.schema, body.data);
  if (error) return res.status(400).json({ error });

  const automation = template.schema?.automation;
  const priority = isTicketPriority(automation?.priority)
    ? automation.priority
    : isTicketPriority(body.priority)
      ? body.priority
      : 'normal';
  const assignedTo = automation?.assignTo
    ? await validAssignee(user.tenantId, automation.assignTo)
    : null;

  const ticket = await createTicket({
    tenantId: user.tenantId,
    templateId: template.id,
    templateName: template.name,
    templateSchema: template.schema,
    data,
    priority,
    assignedTo,
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
