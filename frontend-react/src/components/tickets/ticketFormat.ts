import type { Ticket, TicketField, TicketStatus } from '@/types';

export const STATUS_LABELS: Record<TicketStatus, string> = {
  open: 'Не решено',
  resolved: 'Решено',
};

/** Human-readable value of a single template field. */
export function formatFieldValue(field: TicketField, value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  const options = field.options || [];
  const labelFor = (v: string) => options.find((o) => o.value === v)?.label ?? v;

  switch (field.type) {
    case 'checkbox':
      if (Array.isArray(value)) {
        if (options.length === 0) return value.length ? 'Да' : 'Нет';
        return (value as string[]).map(labelFor).join(', ');
      }
      return value ? 'Да' : 'Нет';
    case 'multiselect':
      return Array.isArray(value) ? (value as string[]).map(labelFor).join(', ') : String(value);
    case 'select':
    case 'radio':
      return labelFor(String(value));
    case 'date': {
      const s = String(value);
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
      return m ? `${m[3]}.${m[2]}.${m[1]}` : s;
    }
    default:
      return String(value);
  }
}

/** Ordered [field, formattedValue] pairs for a ticket, empty values skipped. */
export function ticketFieldRows(ticket: Ticket): { field: TicketField; value: string }[] {
  const fields: TicketField[] = Array.isArray(ticket.template_schema?.fields)
    ? ticket.template_schema.fields
    : [];
  const rows: { field: TicketField; value: string }[] = [];
  for (const f of fields) {
    if (f.type === 'divider' || f.type === 'title') continue;
    const value = formatFieldValue(f, ticket.data?.[f.id]);
    if (value !== '') rows.push({ field: f, value });
  }
  return rows;
}

/** Short one-line summary shown in the ticket list. */
export function ticketSummary(ticket: Ticket): string {
  const rows = ticketFieldRows(ticket);
  if (rows.length === 0) return `Тикет #${ticket.id}`;
  const preferred = rows.find((r) => ['subject', 'title', 'theme'].includes(r.field.id));
  const text = (preferred ?? rows[0]).value;
  return text.length > 80 ? text.slice(0, 80) + '…' : text;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU');
}
