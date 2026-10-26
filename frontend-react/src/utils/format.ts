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
 * Календарных дней до даты окончания: 15 октября → 14 ноября = 30 дней.
 * Именно календарные дни, а не остаток часов, — тогда «+30 дней» в CRM и
 * таймер в панели показывают одно и то же число. null — срока нет вовсе;
 * отрицательное значение — подписка уже истекла.
 */
export function daysLeft(until: string | number | Date | null | undefined): number | null {
  if (until === null || until === undefined || until === '') return null;
  const d = toDate(until);
  if (isNaN(d.getTime())) return null;
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  return Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000);
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

/**
 * Период подписки в месяцах: «1 месяц», «3 месяца», «1 год». Совпадает с
 * подписями бэкенда, чтобы счёт и интерфейс не расходились.
 */
export function periodLabel(months: number): string {
  if (months === 12) return '1 год';
  const mod10 = months % 10;
  const mod100 = months % 100;
  const word =
    mod10 === 1 && mod100 !== 11
      ? 'месяц'
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? 'месяца'
        : 'месяцев';
  return `${months} ${word}`;
}

/** Период уже оплаченного платежа приходит в днях — переводим в месяцы. */
export function periodFromDays(days: number): string {
  if (days >= 365) return '1 год';
  if (days > 0 && days % 30 === 0) return periodLabel(days / 30);
  return pluralDays(days);
}

/** Состояние подписки — одно и то же в панели, боковом меню и CRM. */
export type SubscriptionLevel = 'ok' | 'soon' | 'expired' | 'unpaid' | 'forever';

export interface SubscriptionState {
  level: SubscriptionLevel;
  /** Календарных дней до конца срока; null — срока нет. */
  days: number | null;
  /** Готовая подпись для интерфейса. */
  text: string;
}

/**
 * Состояние подписки по сроку и признаку оплаты. Последний день действия —
 * ещё не «истекла»: доступ есть до конца суток, поэтому подсвечиваем его как
 * предупреждение, а не как ошибку.
 */
export function subscriptionState(
  until: string | number | Date | null | undefined,
  active: boolean
): SubscriptionState {
  if (!active) return { level: 'unpaid', days: null, text: 'не оплачен' };

  const hasDate = until !== null && until !== undefined && until !== '';
  const d = toDate(hasDate ? until : NaN);
  if (!hasDate || isNaN(d.getTime())) return { level: 'forever', days: null, text: 'бессрочно' };

  if (d.getTime() < Date.now()) return { level: 'expired', days: 0, text: 'срок истёк' };

  const days = daysLeft(until) ?? 0;
  if (days === 0) return { level: 'soon', days, text: 'последний день' };
  return { level: days <= 5 ? 'soon' : 'ok', days, text: `осталось ${pluralDays(days)}` };
}

/**
 * Заголовок дня в переписке: «Сегодня», «Вчера» или «12 мая» (в прошлые годы —
 * с годом). Сравниваются календарные сутки, а не разница в 24 часа, иначе
 * сообщение в 00:30 уезжает во «вчера».
 */
export function formatDayLabel(ts: number | string | Date | null | undefined): string {
  const d = toDate(ts);
  if (isNaN(d.getTime())) return '';
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000);
  if (diffDays === 0) return 'Сегодня';
  if (diffDays === 1) return 'Вчера';
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }),
  });
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