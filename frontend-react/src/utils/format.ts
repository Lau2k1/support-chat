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

/**
 * Days left until a subscription end date, rounded up — an end date later today
 * still counts as a whole remaining day. Returns null when there is no end date
 * at all (бессрочная подписка) and 0 once the date has passed.
 */
export function daysLeft(until: string | number | Date | null | undefined): number | null {
  if (until === null || until === undefined || until === '') return null;
  const d = toDate(until);
  if (isNaN(d.getTime())) return null;
  return Math.max(0, Math.ceil((d.getTime() - Date.now()) / 86400000));
}

/** «день» / «дня» / «дней» — the word alone, for a count shown separately. */
export function daysWord(days: number): string {
  const mod10 = days % 10;
  const mod100 = days % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'дня';
  return 'дней';
}

/** «1 день», «3 дня», «11 дней» — the count with the right Russian form. */
export function pluralDays(days: number): string {
  return `${days} ${daysWord(days)}`;
}

/** «YYYY-MM-DD» from a date field → конец этого дня по локальному времени, ISO. */
export function endOfLocalDay(dateStr: string): string | null {
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p))) return null;
  const [year, month, day] = parts;
  return new Date(year, month - 1, day, 23, 59, 59, 999).toISOString();
}

/** ISO-дата → «YYYY-MM-DD» по локальному времени (для <input type="date">). */
export function toDateInput(iso: string | number | Date | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return '';
  const d = toDate(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}