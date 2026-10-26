import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { authMiddleware } from '../middleware/auth';
import {
  listTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  normalizeTemplateSchema,
  normalizeTemplateName,
  normalizeTemplateCategory,
  normalizeTemplateDescription,
  type TicketTemplateSchema,
} from '../services/ticketTemplates';

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
 * Automation can assign a ticket to an operator. Only an enabled operator of
 * the same tenant may be referenced, otherwise the admin could point a
 * template at a foreign or disabled account.
 */
async function invalidAssignee(schema: TicketTemplateSchema, tenantId: number): Promise<string | null> {
  const id = schema.automation?.assignTo;
  if (id === undefined || id === null) return null;
  const res = await pool.query(
    `SELECT 1 FROM operators
     WHERE id = $1 AND tenant_id = $2 AND is_enabled = true AND role IN ('admin', 'operator')`,
    [id, tenantId]
  );
  return res.rowCount ? null : 'Исполнитель автоматизации не найден в этом тенанте';
}

router.use(authMiddleware);

// GET /api/ticket-templates
router.get('/', async (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user.tenantId) {
    return res.status(400).json({ error: 'Тенант не определён' });
  }
  const includeInactive = user.role === 'admin' || user.role === 'superadmin';
  const items = await listTemplates(user.tenantId, { includeInactive });
  res.json({ items });
});

// GET /api/ticket-templates/:id
router.get('/:id', async (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user.tenantId) {
    return res.status(400).json({ error: 'Тенант не определён' });
  }
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Неверный ID' });

  const tpl = await getTemplateById(id, user.tenantId);
  if (!tpl) return res.status(404).json({ error: 'Шаблон не найден' });
  if (user.role === 'operator' && !tpl.is_active) {
    return res.status(404).json({ error: 'Шаблон не найден' });
  }
  res.json({ template: tpl });
});

// POST /api/ticket-templates (admin only)
router.post('/', async (req: Request, res: Response) => {
  const user = getUser(req);
  if (user.role !== 'admin' && user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  if (!user.tenantId) {
    return res.status(400).json({ error: 'Тенант не определён' });
  }
  const { name, description, category, schema, isActive } = req.body || {};

  const templateName = normalizeTemplateName(name);
  if (!templateName) {
    return res.status(400).json({ error: 'Укажите название шаблона (до 150 символов)' });
  }

  const normalized = normalizeTemplateSchema(schema);
  if (normalized.error) return res.status(400).json({ error: normalized.error });

  const assigneeError = await invalidAssignee(normalized.schema, user.tenantId);
  if (assigneeError) return res.status(400).json({ error: assigneeError });

  const tpl = await createTemplate({
    tenantId: user.tenantId,
    name: templateName,
    description: normalizeTemplateDescription(description),
    category: normalizeTemplateCategory(category),
    schema: normalized.schema,
    isActive: typeof isActive === 'boolean' ? isActive : true,
    createdBy: user.id,
  });

  res.status(201).json({ template: tpl });
});

// PUT /api/ticket-templates/:id (admin only)
router.put('/:id', async (req: Request, res: Response) => {
  const user = getUser(req);
  if (user.role !== 'admin' && user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  if (!user.tenantId) {
    return res.status(400).json({ error: 'Тенант не определён' });
  }
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Неверный ID' });

  const { name, description, category, schema, isActive } = req.body || {};
  const input: Parameters<typeof updateTemplate>[2] = { updatedBy: user.id };

  if (name !== undefined) {
    const templateName = normalizeTemplateName(name);
    if (!templateName) {
      return res.status(400).json({ error: 'Укажите название шаблона (до 150 символов)' });
    }
    input.name = templateName;
  }
  if (description !== undefined) {
    input.description = normalizeTemplateDescription(description);
  }
  if (category !== undefined) {
    input.category = normalizeTemplateCategory(category);
  }
  if (schema !== undefined) {
    const normalized = normalizeTemplateSchema(schema);
    if (normalized.error) return res.status(400).json({ error: normalized.error });
    const assigneeError = await invalidAssignee(normalized.schema, user.tenantId);
    if (assigneeError) return res.status(400).json({ error: assigneeError });
    input.schema = normalized.schema;
  }
  if (isActive !== undefined) {
    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive должен быть boolean' });
    }
    input.isActive = isActive;
  }

  const tpl = await updateTemplate(id, user.tenantId, input);
  if (!tpl) return res.status(404).json({ error: 'Шаблон не найден' });
  res.json({ template: tpl });
});

// DELETE /api/ticket-templates/:id (admin only)
router.delete('/:id', async (req: Request, res: Response) => {
  const user = getUser(req);
  if (user.role !== 'admin' && user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  if (!user.tenantId) {
    return res.status(400).json({ error: 'Тенант не определён' });
  }
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Неверный ID' });

  const ok = await deleteTemplate(id, user.tenantId);
  if (!ok) return res.status(404).json({ error: 'Шаблон не найден' });
  res.json({ success: true });
});

export default router;
