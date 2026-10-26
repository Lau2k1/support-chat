import { pool } from '../db';
import type { PoolClient } from 'pg';
import type { TicketTemplateSchema, TicketField, FieldCondition, TicketPriority } from './ticketTemplates';

export type TicketStatus = 'open' | 'resolved';

export const TICKET_STATUSES: TicketStatus[] = ['open', 'resolved'];

export function isTicketStatus(v: unknown): v is TicketStatus {
  return typeof v === 'string' && (TICKET_STATUSES as string[]).includes(v);
}

export interface Ticket {
  id: number;
  tenant_id: number;
  template_id: number | null;
  template_name: string;
  template_schema: TicketTemplateSchema;
  data: Record<string, unknown>;
  status: TicketStatus;
  priority: TicketPriority;
  assigned_to: number | null;
  assigned_to_name: string | null;
  created_by: number | null;
  created_by_name: string | null;
  resolved_by: number | null;
  resolved_by_name: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateTicketInput {
  tenantId: number;
  templateId: number | null;
  templateName: string;
  templateSchema: TicketTemplateSchema;
  data: Record<string, unknown>;
  priority?: TicketPriority;
  assignedTo?: number | null;
  createdBy?: number | null;
}

const TEXT_MAX = 500;
const TEXTAREA_MAX = 5000;
const FILE_MAX = 1000;
const FILE_NAME_MAX = 300;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Ссылка на вложение: свой /uploads/ (панель) или внешний http(s) — на случай
 * интеграций. Всё остальное (javascript: и т.п.) отсекаем, чтобы значения не
 * превращались в исполняемые ссылки при отображении.
 */
function isFileUrl(v: string): boolean {
  if (v.includes('..') || v.includes('\\')) return false;
  return v.startsWith('/uploads/') || /^https?:\/\//i.test(v);
}

function isBlank(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/** Values of a condition operand as plain strings (booleans → 'true'/'false'). */
function conditionValues(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (Array.isArray(raw)) return raw.map((v) => String(v));
  return [String(raw)];
}

/**
 * Evaluates a visibility rule against submitted data. Mirrors the frontend
 * resolver, so the server never accepts a hidden required field or stores a
 * value that the admin's condition made invisible.
 */
function conditionMatches(condition: FieldCondition, values: Record<string, unknown>): boolean {
  const actual = conditionValues(values[condition.fieldId]);
  switch (condition.operator) {
    case 'empty':
      return actual.every((v) => v.trim() === '');
    case 'notEmpty':
      return actual.some((v) => v.trim() !== '');
    case 'eq': {
      const expected = Array.isArray(condition.value) ? condition.value[0] : condition.value;
      return expected !== undefined && actual.includes(String(expected));
    }
    case 'neq': {
      const expected = Array.isArray(condition.value) ? condition.value[0] : condition.value;
      return expected !== undefined && !actual.includes(String(expected));
    }
    case 'in': {
      const list = Array.isArray(condition.value)
        ? condition.value
        : condition.value !== undefined
          ? [condition.value]
          : [];
      return actual.some((v) => list.includes(v));
    }
    default:
      return true;
  }
}

/**
 * Validates and normalises submitted ticket data against the template schema.
 * Only known field ids are stored; `title`/`divider` are layout-only and skipped.
 * Fields hidden by a `visibleWhen` rule are not validated and not stored.
 * Returns the cleaned payload, or the first user-facing error.
 */
export function validateTicketData(
  schema: TicketTemplateSchema | null | undefined,
  input: unknown
): { data: Record<string, unknown>; error: string | null } {
  const fields: TicketField[] = Array.isArray(schema?.fields) ? schema!.fields : [];
  const src: Record<string, unknown> =
    input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  const visible = new Map<string, boolean>();

  for (const f of fields) {
    if (!f || !f.id) continue;

    // A condition may only reference an earlier field (enforced on save), so
    // visibility of every referenced field is already known here.
    const condition = f.visibleWhen;
    const isVisible = !condition
      ? true
      : visible.get(condition.fieldId) === true && conditionMatches(condition, src);
    visible.set(f.id, isVisible);

    if (!isVisible) continue;
    if (f.type === 'title' || f.type === 'divider') continue;
    const raw = src[f.id];
    const label = f.label || f.id;

    if (isBlank(raw)) {
      if (f.required) return { data: out, error: `«${label}»: обязательное поле` };
      continue; // пустые необязательные поля не сохраняем
    }

    switch (f.type) {
      case 'text':
      case 'textarea': {
        // A JSON number is acceptable here too (coerced), so API clients don't
        // have to stringify ids they read from elsewhere.
        if (typeof raw !== 'string' && typeof raw !== 'number') {
          return { data: out, error: `«${label}»: ожидается текст` };
        }
        const v = String(raw).trim();
        const max = f.type === 'textarea' ? TEXTAREA_MAX : TEXT_MAX;
        if (v.length > max) return { data: out, error: `«${label}»: максимум ${max} символов` };
        out[f.id] = v;
        break;
      }
      case 'number': {
        const n = typeof raw === 'string' ? Number(raw.trim()) : raw;
        if (typeof n !== 'number' || !Number.isFinite(n)) return { data: out, error: `«${label}»: ожидается число` };
        out[f.id] = n;
        break;
      }
      case 'date': {
        if (typeof raw !== 'string' || !DATE_RE.test(raw.trim())) {
          return { data: out, error: `«${label}»: ожидается дата в формате ГГГГ-ММ-ДД` };
        }
        out[f.id] = raw.trim();
        break;
      }
      case 'select':
      case 'radio': {
        const allowed = (f.options || []).map((o) => o.value);
        if (typeof raw !== 'string' || !allowed.includes(raw)) {
          return { data: out, error: `«${label}»: недопустимое значение` };
        }
        out[f.id] = raw;
        break;
      }
      case 'multiselect': {
        const allowed = (f.options || []).map((o) => o.value);
        if (!Array.isArray(raw)) return { data: out, error: `«${label}»: ожидается список` };
        const vals = raw.filter((x): x is string => typeof x === 'string');
        if (vals.length !== raw.length) return { data: out, error: `«${label}»: ожидается список` };
        if (vals.some((v) => !allowed.includes(v))) {
          return { data: out, error: `«${label}»: недопустимое значение` };
        }
        out[f.id] = vals;
        break;
      }
      case 'checkbox': {
        const opts = f.options || [];
        if (opts.length > 0) {
          const allowed = opts.map((o) => o.value);
          if (!Array.isArray(raw)) return { data: out, error: `«${label}»: ожидается список` };
          const vals = raw.filter((x): x is string => typeof x === 'string');
          if (vals.length !== raw.length || vals.some((v) => !allowed.includes(v))) {
            return { data: out, error: `«${label}»: недопустимое значение` };
          }
          out[f.id] = vals;
        } else {
          if (typeof raw !== 'boolean') return { data: out, error: `«${label}»: ожидается флаг` };
          out[f.id] = raw;
        }
        break;
      }
      case 'file': {
        // Новый формат — объект { url, name } от загрузчика вложений
        // (POST /tickets/upload): оператор видит исходное имя файла.
        // Строку-ссылку принимаем для совместимости со старыми тикетами.
        if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
          const r = raw as { url?: unknown; name?: unknown };
          const url = typeof r.url === 'string' ? r.url.trim() : '';
          if (!url || !isFileUrl(url)) return { data: out, error: `«${label}»: неверная ссылка на файл` };
          if (url.length > FILE_MAX) return { data: out, error: `«${label}»: максимум ${FILE_MAX} символов` };
          const name = typeof r.name === 'string' ? r.name.trim() : '';
          if (name.length > FILE_NAME_MAX) return { data: out, error: `«${label}»: слишком длинное имя файла` };
          out[f.id] = name ? { url, name } : { url };
          break;
        }
        if (typeof raw !== 'string') return { data: out, error: `«${label}»: ожидается файл` };
        const v = raw.trim();
        if (v.length > FILE_MAX) return { data: out, error: `«${label}»: максимум ${FILE_MAX} символов` };
        if (!isFileUrl(v)) return { data: out, error: `«${label}»: неверная ссылка на файл` };
        out[f.id] = v;
        break;
      }
      default:
        break;
    }
  }

  return { data: out, error: null };
}

const TICKET_SELECT = `
  SELECT t.id, t.tenant_id, t.template_id, t.template_name, t.template_schema, t.data,
         t.status, t.priority, t.assigned_to, t.created_by, t.resolved_by, t.resolved_at,
         t.created_at, t.updated_at,
         c.name AS created_by_name, r.name AS resolved_by_name, a.name AS assigned_to_name
  FROM tickets t
  LEFT JOIN operators c ON c.id = t.created_by
  LEFT JOIN operators r ON r.id = t.resolved_by
  LEFT JOIN operators a ON a.id = t.assigned_to`;

export async function listTickets(
  tenantId: number,
  opts: { status?: TicketStatus; templateId?: number } = {}
): Promise<Ticket[]> {
  const params: unknown[] = [tenantId];
  let sql = `${TICKET_SELECT} WHERE t.tenant_id = $1`;
  if (opts.status) {
    params.push(opts.status);
    sql += ` AND t.status = $${params.length}`;
  }
  if (opts.templateId) {
    params.push(opts.templateId);
    sql += ` AND t.template_id = $${params.length}`;
  }
  sql += ` ORDER BY t.created_at DESC, t.id DESC`;
  const res = await pool.query(sql, params);
  return res.rows;
}

export async function getTicket(id: number, tenantId: number): Promise<Ticket | null> {
  const res = await pool.query(`${TICKET_SELECT} WHERE t.id = $1 AND t.tenant_id = $2`, [id, tenantId]);
  return res.rows[0] || null;
}

export async function countOpenTickets(tenantId: number): Promise<number> {
  const res = await pool.query(
    `SELECT COUNT(*)::int AS n FROM tickets WHERE tenant_id = $1 AND status = 'open'`,
    [tenantId]
  );
  return res.rows[0]?.n ?? 0;
}

export async function createTicket(input: CreateTicketInput, client?: PoolClient): Promise<Ticket> {
  const db = client || pool;
  const res = await db.query(
    `INSERT INTO tickets (tenant_id, template_id, template_name, template_schema, data, status, priority, assigned_to, created_by)
     VALUES ($1, $2, $3, $4, $5, 'open', $6, $7, $8)
     RETURNING id`,
    [
      input.tenantId,
      input.templateId,
      input.templateName,
      JSON.stringify(input.templateSchema || { fields: [] }),
      JSON.stringify(input.data || {}),
      input.priority || 'normal',
      input.assignedTo ?? null,
      input.createdBy ?? null,
    ]
  );
  const created = await getTicket(res.rows[0].id as number, input.tenantId);
  return created as Ticket;
}

/**
 * Marks a ticket resolved (records who/when) or reopens it (clears that info).
 */
export async function setTicketStatus(
  id: number,
  tenantId: number,
  status: TicketStatus,
  userId: number | null
): Promise<Ticket | null> {
  const isResolved = status === 'resolved';
  // Explicit casts: `$1` would otherwise be deduced inconsistently (varchar vs
  // text) because it is both assigned to `status` and compared to a literal.
  const res = await pool.query(
    `UPDATE tickets
     SET status = $1::varchar,
         resolved_by = CASE WHEN $2::boolean THEN $3::int ELSE NULL END,
         resolved_at = CASE WHEN $2::boolean THEN NOW() ELSE NULL END,
         updated_at = NOW()
     WHERE id = $4::int AND tenant_id = $5::int
     RETURNING id`,
    [status, isResolved, userId, id, tenantId]
  );
  if (!res.rows[0]) return null;
  return getTicket(res.rows[0].id as number, tenantId);
}

export async function deleteTicket(id: number, tenantId: number): Promise<boolean> {
  const res = await pool.query(`DELETE FROM tickets WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  return (res.rowCount ?? 0) > 0;
}
