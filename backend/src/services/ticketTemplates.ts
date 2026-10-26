import { pool } from '../db';
import type { PoolClient } from 'pg';

export type TicketFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'select'
  | 'multiselect'
  | 'radio'
  | 'checkbox'
  | 'date'
  | 'file'
  | 'divider'
  | 'title';

export const TICKET_FIELD_TYPES: TicketFieldType[] = [
  'text',
  'textarea',
  'number',
  'select',
  'multiselect',
  'radio',
  'checkbox',
  'date',
  'file',
  'divider',
  'title',
];

/** Priority shown in the ticket list and set by template automation. */
export type TicketPriority = 'low' | 'normal' | 'high';

export const TICKET_PRIORITIES: TicketPriority[] = ['low', 'normal', 'high'];

export function isTicketPriority(v: unknown): v is TicketPriority {
  return typeof v === 'string' && (TICKET_PRIORITIES as string[]).includes(v);
}

/** Operators for a field-level visibility rule. */
export type ConditionOperator = 'eq' | 'neq' | 'in' | 'notEmpty' | 'empty';

export const CONDITION_OPERATORS: ConditionOperator[] = ['eq', 'neq', 'in', 'notEmpty', 'empty'];

/**
 * A field is rendered only when the referenced earlier field matches the rule.
 * `value` is a single option value for eq/neq, and a list for `in`.
 */
export interface FieldCondition {
  fieldId: string;
  operator: ConditionOperator;
  value?: string | string[];
}

export interface TicketFieldOption {
  value: string;
  label: string;
}

export interface TicketField {
  id: string;
  type: TicketFieldType;
  label: string;
  placeholder?: string;
  required?: boolean;
  options?: TicketFieldOption[];
  helpText?: string;
  order?: number;
  defaultValue?: string | number | boolean | string[];
  visibleWhen?: FieldCondition;
}

/** What the ticket creator may pre-fill automatically (admin side). */
export interface TemplateAutomation {
  /** Default priority of tickets created from this template. */
  priority?: TicketPriority | null;
  /** Operator the ticket is assigned to (must belong to the same tenant). */
  assignTo?: number | null;
}

export interface TicketTemplateSchema {
  fields: TicketField[];
  automation?: TemplateAutomation;
}

export interface TicketTemplate {
  id: number;
  tenant_id: number;
  name: string;
  description: string | null;
  category: string | null;
  schema: TicketTemplateSchema;
  is_active: boolean;
  created_by: number | null;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
}

interface CreateTemplateInput {
  tenantId: number;
  name: string;
  description?: string | null;
  category?: string | null;
  schema: TicketTemplateSchema;
  isActive?: boolean;
  createdBy?: number | null;
}

interface UpdateTemplateInput {
  name?: string;
  description?: string | null;
  category?: string | null;
  schema?: TicketTemplateSchema;
  isActive?: boolean;
  updatedBy?: number | null;
}

// ---------------------------------------------------------------------------
// Schema limits. The template is user-authored JSON, so everything that goes
// into the DB is re-validated and normalised here instead of being trusted.
// ---------------------------------------------------------------------------

const MAX_FIELDS = 50;
const MAX_OPTIONS = 50;
const MAX_LABEL = 200;
const MAX_PLACEHOLDER = 200;
const MAX_HELP = 500;
const MAX_NAME = 150;
const MAX_CATEGORY = 100;
const MAX_DESCRIPTION = 2000;
const FIELD_ID_RE = /^[a-zA-Z0-9_-]{1,40}$/;

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t || t.length > max) return null;
  return t;
}

/** Trims an optional string to `max` chars; empty becomes null. */
export function optionalText(v: unknown, max: number): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  return t.slice(0, max);
}

function normalizeDefaultValue(v: unknown): string | number | boolean | string[] | undefined {
  if (typeof v === 'string') return v.slice(0, 500);
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'boolean') return v;
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v.slice(0, MAX_OPTIONS);
  return undefined;
}

function normalizeCondition(
  input: unknown,
  earlierIds: Set<string>
): { condition?: FieldCondition; error?: string } {
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'visibleWhen должен быть объектом' };
  }
  const c = input as Record<string, unknown>;
  const fieldId = typeof c.fieldId === 'string' ? c.fieldId : '';
  if (!FIELD_ID_RE.test(fieldId) || !earlierIds.has(fieldId)) {
    return { error: 'Условие ссылается на несуществующее или более позднее поле' };
  }
  const operator = c.operator;
  if (typeof operator !== 'string' || !(CONDITION_OPERATORS as string[]).includes(operator)) {
    return { error: 'Неверный оператор условия' };
  }
  const op = operator as ConditionOperator;

  if (op === 'notEmpty' || op === 'empty') {
    return { condition: { fieldId, operator: op } };
  }

  if (op === 'in') {
    if (!Array.isArray(c.value) || c.value.length === 0 || c.value.length > MAX_OPTIONS) {
      return { error: 'Условие «одно из» требует список значений' };
    }
    const values = c.value.filter((x): x is string => typeof x === 'string' && x.length <= MAX_LABEL);
    if (values.length !== c.value.length) return { error: 'Неверное значение в условии' };
    return { condition: { fieldId, operator: op, value: values } };
  }

  const value = str(c.value, MAX_LABEL);
  if (value === null) return { error: 'Условие требует значение' };
  return { condition: { fieldId, operator: op, value } };
}

/**
 * Validates and normalises a template schema:
 * - only known field types,
 * - unique ids, valid labels and option lists,
 * - visibility conditions may reference only earlier fields (no cycles),
 * - automation values are checked against the priority enum / operator id.
 */
export function normalizeTemplateSchema(
  input: unknown
): { schema: TicketTemplateSchema; error: string | null } {
  const empty: TicketTemplateSchema = { fields: [] };
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { schema: empty, error: 'Неверная структура схемы шаблона' };
  }
  const raw = input as Record<string, unknown>;
  if (!Array.isArray(raw.fields)) {
    return { schema: empty, error: 'Неверная структура schema.fields' };
  }
  if (raw.fields.length > MAX_FIELDS) {
    return { schema: empty, error: `Максимум ${MAX_FIELDS} полей в шаблоне` };
  }

  const fields: TicketField[] = [];
  const ids = new Set<string>();

  for (const item of raw.fields) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { schema: empty, error: 'Неверное описание поля' };
    }
    const f = item as Record<string, unknown>;
    const id = typeof f.id === 'string' ? f.id : '';
    if (!FIELD_ID_RE.test(id)) return { schema: empty, error: 'Неверный идентификатор поля' };
    if (ids.has(id)) return { schema: empty, error: `Повторяющийся идентификатор поля: ${id}` };

    const type = f.type;
    if (typeof type !== 'string' || !(TICKET_FIELD_TYPES as string[]).includes(type)) {
      return { schema: empty, error: `Неизвестный тип поля: ${String(type)}` };
    }
    const fieldType = type as TicketFieldType;
    const layoutOnly = fieldType === 'divider' || fieldType === 'title';

    const label = layoutOnly
      ? optionalText(f.label, MAX_LABEL) || ''
      : str(f.label, MAX_LABEL);
    if (!layoutOnly && label === null) {
      return { schema: empty, error: 'У поля должно быть название (до 200 символов)' };
    }

    const field: TicketField = {
      id,
      type: fieldType,
      label: label || '',
      required: !layoutOnly && f.required === true,
    };

    const placeholder = optionalText(f.placeholder, MAX_PLACEHOLDER);
    if (placeholder) field.placeholder = placeholder;
    const helpText = optionalText(f.helpText, MAX_HELP);
    if (helpText) field.helpText = helpText;

    if (['select', 'multiselect', 'radio', 'checkbox'].includes(fieldType)) {
      const optsRaw = Array.isArray(f.options) ? f.options : [];
      if (optsRaw.length > MAX_OPTIONS) {
        return { schema: empty, error: `Максимум ${MAX_OPTIONS} вариантов в поле «${field.label}»` };
      }
      const values = new Set<string>();
      const options: TicketFieldOption[] = [];
      for (const o of optsRaw) {
        if (!o || typeof o !== 'object' || Array.isArray(o)) {
          return { schema: empty, error: `Неверный вариант в поле «${field.label}»` };
        }
        const opt = o as Record<string, unknown>;
        const value = str(opt.value, MAX_LABEL);
        const optLabel = str(opt.label, MAX_LABEL);
        if (value === null || optLabel === null) {
          return { schema: empty, error: `Вариант в поле «${field.label}»: нужны значение и текст` };
        }
        if (values.has(value)) {
          return { schema: empty, error: `Повторяющийся вариант «${value}» в поле «${field.label}»` };
        }
        values.add(value);
        options.push({ value, label: optLabel });
      }
      if (options.length) field.options = options;
    }

    const defaultValue = normalizeDefaultValue(f.defaultValue);
    if (defaultValue !== undefined) field.defaultValue = defaultValue;

    const condition = normalizeCondition(f.visibleWhen, ids);
    if (condition.error) return { schema: empty, error: condition.error };
    if (condition.condition) field.visibleWhen = condition.condition;

    ids.add(id);
    fields.push({ ...field, order: fields.length });
  }

  let automation: TemplateAutomation | undefined;
  if (raw.automation !== undefined && raw.automation !== null) {
    if (typeof raw.automation !== 'object' || Array.isArray(raw.automation)) {
      return { schema: empty, error: 'Неверная структура automation' };
    }
    const a = raw.automation as Record<string, unknown>;
    automation = {};
    if (a.priority !== undefined && a.priority !== null && a.priority !== '') {
      if (!isTicketPriority(a.priority)) {
        return { schema: empty, error: 'Неверный приоритет в автоматизации' };
      }
      automation.priority = a.priority;
    }
    if (a.assignTo !== undefined && a.assignTo !== null && a.assignTo !== '') {
      const n = Number(a.assignTo);
      if (!Number.isInteger(n) || n <= 0) {
        return { schema: empty, error: 'Неверный исполнитель в автоматизации' };
      }
      automation.assignTo = n;
    }
    if (automation.priority === undefined && automation.assignTo === undefined) {
      automation = undefined;
    }
  }

  return {
    schema: automation ? { fields, automation } : { fields },
    error: null,
  };
}

/** Human-readable labels are validated in routes; here we only clamp. */
export function normalizeTemplateName(v: unknown): string | null {
  return str(v, MAX_NAME);
}

export function normalizeTemplateCategory(v: unknown): string | null {
  return optionalText(v, MAX_CATEGORY);
}

export function normalizeTemplateDescription(v: unknown): string | null {
  return optionalText(v, MAX_DESCRIPTION);
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const SELECT_COLUMNS = `id, tenant_id, name, description, category, schema, is_active,
                        created_by, updated_by, created_at, updated_at`;

export async function listTemplates(
  tenantId: number,
  opts: { includeInactive?: boolean } = {}
): Promise<TicketTemplate[]> {
  const { includeInactive = false } = opts;
  const params: any[] = [tenantId];
  let sql = `SELECT ${SELECT_COLUMNS} FROM ticket_templates WHERE tenant_id = $1`;
  if (!includeInactive) {
    sql += ` AND is_active = true`;
  }
  sql += ` ORDER BY created_at DESC, id DESC`;
  const res = await pool.query(sql, params);
  return res.rows;
}

export async function getTemplateById(
  id: number,
  tenantId: number
): Promise<TicketTemplate | null> {
  const res = await pool.query(
    `SELECT ${SELECT_COLUMNS} FROM ticket_templates WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId]
  );
  return res.rows[0] || null;
}

export async function createTemplate(
  input: CreateTemplateInput,
  client?: PoolClient
): Promise<TicketTemplate> {
  const db = client || pool;
  const res = await db.query(
    `INSERT INTO ticket_templates (tenant_id, name, description, category, schema, is_active, created_by)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, true), $7)
     RETURNING ${SELECT_COLUMNS}`,
    [
      input.tenantId,
      input.name,
      input.description || null,
      input.category || null,
      JSON.stringify(input.schema || { fields: [] }),
      input.isActive,
      input.createdBy || null,
    ]
  );
  return res.rows[0];
}

export async function updateTemplate(
  id: number,
  tenantId: number,
  input: UpdateTemplateInput,
  client?: PoolClient
): Promise<TicketTemplate | null> {
  const db = client || pool;
  const fields: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (input.name !== undefined) {
    fields.push(`name = $${idx++}`);
    params.push(input.name);
  }
  if (input.description !== undefined) {
    fields.push(`description = $${idx++}`);
    params.push(input.description);
  }
  if (input.category !== undefined) {
    fields.push(`category = $${idx++}`);
    params.push(input.category);
  }
  if (input.schema !== undefined) {
    fields.push(`schema = $${idx++}`);
    params.push(JSON.stringify(input.schema));
  }
  if (input.isActive !== undefined) {
    fields.push(`is_active = $${idx++}`);
    params.push(input.isActive);
  }
  if (input.updatedBy !== undefined) {
    fields.push(`updated_by = $${idx++}`);
    params.push(input.updatedBy);
  }

  if (fields.length === 0) {
    return getTemplateById(id, tenantId);
  }

  fields.push(`updated_at = NOW()`);

  params.push(id);
  params.push(tenantId);

  const res = await db.query(
    `UPDATE ticket_templates
     SET ${fields.join(', ')}
     WHERE id = $${idx} AND tenant_id = $${idx + 1}
     RETURNING ${SELECT_COLUMNS}`,
    params
  );

  return res.rows[0] || null;
}

export async function deleteTemplate(
  id: number,
  tenantId: number,
  client?: PoolClient
): Promise<boolean> {
  const db = client || pool;
  const res = await db.query(
    `DELETE FROM ticket_templates WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId]
  );
  return (res.rowCount ?? 0) > 0;
}
