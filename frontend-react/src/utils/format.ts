/**
 * Dates arrive in two shapes from the API: epoch milliseconds (WS events)
 * and ISO strings (pg timestamps serialized by res.json). Accept both,
 * plus Date objects for good measure.
 */
function toDate(value: number | string | Date | null | undefined): Date {
  if (value === null || value === undefined) return new Date(NaN);
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);

  const asIso = new Date(value);
  if (!isNaN(asIso.getTime())) return asIso;

  // A numeric string (e.g. "1699999999999") — parse as epoch ms.
  return new Date(Number(value));
}

export function formatTime(ts: number | string | Date | null | undefined): string {
  const d = toDate(ts);
  return isNaN(d.getTime()) ? '—' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(ts: number | string | Date | null | undefined): string {
  const d = toDate(ts);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('ru-RU');
}

export function formatElapsedTime(updatedAt: number): string {
  const diff = Math.floor((Date.now() - updatedAt) / 1000);
  if (diff < 0) return '0м 0с';
  return `${Math.floor(diff / 60)}м ${diff % 60}с`;
}

export function formatDateInput(date: Date): string {
  return date.toISOString().split('T')[0];
}