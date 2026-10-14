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

/**
 * Human-readable duration from a number of seconds (e.g. avg response time).
 * 45 → «45с», 494 → «8м 14с», 5400 → «1ч 30м».
 */
export function formatDuration(seconds: number | null | undefined): string {
  const sec = Number(seconds);
  if (!Number.isFinite(sec) || sec <= 0) return '—';
  const total = Math.round(sec);
  if (total < 60) return `${total}с`;
  const minutes = Math.floor(total / 60);
  const restSec = total % 60;
  if (minutes < 60) return restSec ? `${minutes}м ${restSec}с` : `${minutes}м`;
  const hours = Math.floor(minutes / 60);
  const restMin = minutes % 60;
  return restMin ? `${hours}ч ${restMin}м` : `${hours}ч`;
}