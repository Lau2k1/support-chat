import type { FieldCondition, TicketField, TicketPriority } from '@/types';

export const PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: 'Низкий',
  normal: 'Средний',
  high: 'Высокий',
};

/** MUI chip colors used for the priority badge. */
export const PRIORITY_COLORS: Record<TicketPriority, 'default' | 'info' | 'error'> = {
  low: 'default',
  normal: 'info',
  high: 'error',
};

export const CONDITION_OPERATOR_LABELS: Record<string, string> = {
  eq: 'равно',
  neq: 'не равно',
  in: 'одно из',
  notEmpty: 'заполнено',
  empty: 'пусто',
};

export function isLayoutField(field: TicketField): boolean {
  return field.type === 'title' || field.type === 'divider';
}

function valuesOf(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (Array.isArray(raw)) return raw.map(String);
  return [String(raw)];
}

/** Mirrors the server-side evaluation in services/tickets.ts. */
export function matchesCondition(condition: FieldCondition, values: Record<string, unknown>): boolean {
  const actual = valuesOf(values[condition.fieldId]);
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
 * Fields currently visible for the given values. A field whose condition
 * references a hidden field is hidden too — same rule as the backend.
 */
export function visibleFields(fields: TicketField[], values: Record<string, unknown>): TicketField[] {
  const visibility = new Map<string, boolean>();
  const out: TicketField[] = [];
  for (const field of fields) {
    const rule = field.visibleWhen;
    const visible = !rule
      ? true
      : visibility.get(rule.fieldId) === true && matchesCondition(rule, values);
    visibility.set(field.id, visible);
    if (visible) out.push(field);
  }
  return out;
}

/** Human-readable condition, e.g. «Причина: равно «Возврат»». */
export function describeCondition(condition: FieldCondition, fields: TicketField[]): string {
  const target = fields.find((f) => f.id === condition.fieldId);
  const fieldLabel = target?.label || condition.fieldId;
  const op = CONDITION_OPERATOR_LABELS[condition.operator] || condition.operator;
  if (condition.operator === 'empty' || condition.operator === 'notEmpty') {
    return `${fieldLabel} ${op}`;
  }
  const raw = Array.isArray(condition.value) ? condition.value : [condition.value];
  const values = raw.filter((v): v is string => typeof v === 'string');
  if (values.length === 0) return `${fieldLabel} ${op}`;
  const labels = values.map((v) => target?.options?.find((o) => o.value === v)?.label ?? v);
  return `${fieldLabel} ${op} «${labels.join('», «')}»`;
}

function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'boolean') return value === false;
  return false;
}

/** Client-side required check; the server repeats every rule anyway. */
export function requiredFieldError(fields: TicketField[], values: Record<string, unknown>): string | null {
  for (const field of visibleFields(fields, values)) {
    if (isLayoutField(field) || !field.required) continue;
    if (isBlank(values[field.id])) return `«${field.label}»: обязательное поле`;
  }
  return null;
}

/** Russian plural form: plural(2, ['поле','поля','полей']) → 'поля'. */
export function plural(n: number, forms: [string, string, string]): string {
  const n10 = Math.abs(n) % 10;
  const n100 = Math.abs(n) % 100;
  if (n10 === 1 && n100 !== 11) return forms[0];
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return forms[1];
  return forms[2];
}

/** «2 поля», «5 полей», «1 поле» — для подписей в списках шаблонов. */
export function fieldsLabel(n: number): string {
  return `${n} ${plural(n, ['поле', 'поля', 'полей'])}`;
}

/** Group templates by category for the admin list (no category last). */
export function groupByCategory<T extends { category: string | null }>(items: T[]): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = item.category?.trim() || 'Без категории';
    const list = map.get(key) || [];
    list.push(item);
    map.set(key, list);
  }
  return [...map.entries()].sort(([a], [b]) => {
    if (a === 'Без категории') return 1;
    if (b === 'Без категории') return -1;
    return a.localeCompare(b, 'ru');
  });
}
