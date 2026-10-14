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
  defaultValue?: any;
}

export interface TicketTemplateSchema {
  fields: TicketField[];
  [key: string]: any;
}

export interface TicketTemplate {
  id: number;
  tenant_id: number;
  name: string;
  description: string | null;
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
  schema: TicketTemplateSchema;
  isActive?: boolean;
  createdBy?: number | null;
}

interface UpdateTemplateInput {
  name?: string;
  description?: string | null;
  schema?: TicketTemplateSchema;
  isActive?: boolean;
  updatedBy?: number | null;
}

export async function listTemplates(
  tenantId: number,
  opts: { includeInactive?: boolean } = {}
): Promise<TicketTemplate[]> {
  const { includeInactive = false } = opts;
  const params: any[] = [tenantId];
  let sql = `SELECT id, tenant_id, name, description, schema, is_active, created_by, updated_by, created_at, updated_at
             FROM ticket_templates
             WHERE tenant_id = $1`;
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
    `SELECT id, tenant_id, name, description, schema, is_active, created_by, updated_by, created_at, updated_at
     FROM ticket_templates
     WHERE id = $1 AND tenant_id = $2`,
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
    `INSERT INTO ticket_templates (tenant_id, name, description, schema, is_active, created_by)
     VALUES ($1, $2, $3, $4, COALESCE($5, true), $6)
     RETURNING id, tenant_id, name, description, schema, is_active, created_by, updated_by, created_at, updated_at`,
    [
      input.tenantId,
      input.name,
      input.description || null,
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
     WHERE id = $${idx++} AND tenant_id = $${idx++}
     RETURNING id, tenant_id, name, description, schema, is_active, created_by, updated_by, created_at, updated_at`,
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
