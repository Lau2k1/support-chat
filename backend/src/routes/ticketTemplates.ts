import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  listTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  TicketTemplateSchema,
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

router.use(authMiddleware);

// GET /api/ticket-templates
router.get('/', async (req: Request, res: Response) => {
  const user = getUser(req);
  if (!user.tenantId) {
    return res.status(400).json({ error: 'Тенант не определён' });
  }
  const includeInactive = user.role === 'admin';
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
  if (user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  if (!user.tenantId) {
    return res.status(400).json({ error: 'Тенант не определён' });
  }
  const { name, description, schema, isActive } = req.body || {};

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Укажите название шаблона' });
  }
  if (!schema || typeof schema !== 'object' || !Array.isArray((schema as TicketTemplateSchema).fields)) {
    return res.status(400).json({ error: 'Неверная структура schema.fields' });
  }

  const tpl = await createTemplate(
    {
      tenantId: user.tenantId,
      name: name.trim(),
      description: description?.trim() || null,
      schema,
      isActive: typeof isActive === 'boolean' ? isActive : true,
      createdBy: user.id,
    },
    undefined
  );

  res.status(201).json({ template: tpl });
});

// PUT /api/ticket-templates/:id (admin only)
router.put('/:id', async (req: Request, res: Response) => {
  const user = getUser(req);
  if (user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  if (!user.tenantId) {
    return res.status(400).json({ error: 'Тенант не определён' });
  }
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Неверный ID' });

  const { name, description, schema, isActive } = req.body || {};
  const input: any = { updatedBy: user.id };

  if (name !== undefined) {
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Укажите название шаблона' });
    }
    input.name = name.trim();
  }
  if (description !== undefined) {
    input.description = description?.trim() || null;
  }
  if (schema !== undefined) {
    if (typeof schema !== 'object' || !Array.isArray((schema as TicketTemplateSchema).fields)) {
      return res.status(400).json({ error: 'Неверная структура schema.fields' });
    }
    input.schema = schema;
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
  if (user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  if (!user.tenantId) {
    return res.status(400).json({ error: 'Тенант не определён' });
  }
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Неверный ID' });

  const ok = await deleteTemplate(id, user.tenantId);
  if (!ok) return res.status(404).json({ error: 'Шаблон не найден' });
  res.json({ success: true });
});

export default router;
