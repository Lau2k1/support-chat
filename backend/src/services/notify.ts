import { pool } from '../db';
import { normalizeTgApiBase } from '../utils/tgApiBase';

/**
 * Уведомления владельцу платформы — в отдельный бот алертов, тот же, что
 * использует мониторинг: ALERT_TELEGRAM_TOKEN / ALERT_TELEGRAM_CHAT_ID.
 *
 * Зачем: лиды и деньги не должны ждать, пока владелец откроет CRM. Новая
 * регистрация, заявка на оплату и подтверждённый платёж уходят в Telegram.
 *
 * Отправка никогда не ломает бизнес-операцию: ошибки гасятся в лог, а при
 * пустых переменных сервис молча выключен (локальная разработка, тесты).
 */

// SEC-18: тот же базовый URL Telegram API, что и у ботов, с валидацией.
const TG_API_BASE = normalizeTgApiBase(process.env.TELEGRAM_API_BASE, process.env.NODE_ENV);

const token = () => (process.env.ALERT_TELEGRAM_TOKEN || '').trim();
const chatId = () => (process.env.ALERT_TELEGRAM_CHAT_ID || '').trim();

/** Настроен ли канал уведомлений. */
export function notifyConfigured(): boolean {
  return Boolean(token() && chatId());
}

/** Экранирование пользовательских данных (названия компаний, email) для HTML. */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Центы → «$13.99». */
export function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  return `$${(Number(cents) / 100).toFixed(2)}`;
}

/** Дата в московском времени: «14.11.2026». Клиенты и владелец — в РФ. */
export function formatDay(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** Код способа оплаты → человеческая подпись. */
export function methodLabel(method: string | null | undefined): string {
  switch (method) {
    case 'manual':
      return 'вручную';
    case 'cryptobot':
      return 'CryptoBot';
    case 'promo':
      return 'промокод';
    default:
      return method || '—';
  }
}

async function send(text: string): Promise<void> {
  const t = token();
  const c = chatId();
  if (!t || !c) return;
  try {
    const res = await fetch(`${TG_API_BASE}/bot${t}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: c, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    if (!res.ok) {
      console.warn('[notify] Telegram ответил', res.status, (await res.text()).slice(0, 200));
    }
  } catch (e) {
    console.warn('[notify] не удалось отправить уведомление:', e instanceof Error ? e.message : e);
  }
}

/** Уведомление владельцу. Никогда не бросает исключение. */
export async function notifyOwner(text: string): Promise<void> {
  await send(text);
}

/**
 * Уведомление-одноразовик: повторный вызов с тем же ключом молчит. Ключи живут
 * в БД, поэтому рестарт контейнера не приводит к повторной рассылке.
 * Возвращает true, если сообщение действительно ушло.
 */
export async function notifyOwnerOnce(key: string, text: string): Promise<boolean> {
  if (!notifyConfigured()) return false;
  try {
    const ins = await pool.query('INSERT INTO notified_events (key) VALUES ($1) ON CONFLICT (key) DO NOTHING', [key]);
    if (!ins.rowCount) return false;
  } catch (e) {
    console.warn('[notify] не удалось отметить событие:', e instanceof Error ? e.message : e);
    return false;
  }
  await send(text);
  return true;
}

// ---------------------------------------------------------------------------
// Готовые сообщения — форматирование живёт в одном месте
// ---------------------------------------------------------------------------

/** Клиент зарегистрировался сам (сайт или Telegram-вход). */
export function notifyNewTenant(info: {
  tenantName: string;
  slug: string;
  email?: string | null;
  source: string;
}): void {
  void send(
    [
      '🆕 <b>Новый клиент</b>',
      `Компания: <b>${esc(info.tenantName)}</b> · <code>${esc(info.slug)}</code>`,
      info.email ? `Админ: ${esc(info.email)}` : 'Админ: аккаунт Telegram без email',
      `Источник: ${esc(info.source)}`,
      'Тариф не оплачен — аккаунт ждёт оплаты.',
    ].join('\n')
  );
}

/** Заявка на оплату (когда онлайн-оплата выключена и её подтверждает владелец). */
export function notifyPaymentRequest(info: {
  tenantName: string;
  slug: string;
  planName: string;
  amountCents: number;
  promoCode?: string | null;
  paymentId: number;
}): void {
  void send(
    [
      '💰 <b>Заявка на оплату</b>',
      `Клиент: <b>${esc(info.tenantName)}</b> · <code>${esc(info.slug)}</code>`,
      `Тариф: ${esc(info.planName)} на 30 дней — <b>${money(info.amountCents)}</b>`,
      info.promoCode ? `Промокод: <code>${esc(info.promoCode)}</code>` : null,
      `Платёж #${info.paymentId} · подтвердить: CRM → Платежи`,
    ]
      .filter(Boolean)
      .join('\n')
  );
}

/** Платёж подтверждён (онлайн, промокод или вручную) — подписка продлена. */
export function notifyPaymentPaid(info: {
  tenantName: string;
  slug: string;
  planName: string;
  amountCents: number;
  days: number;
  method: string;
  paidUntil?: string | Date | null;
}): void {
  const until = formatDay(info.paidUntil);
  void send(
    [
      '✅ <b>Оплата подтверждена</b>',
      `Клиент: <b>${esc(info.tenantName)}</b> · <code>${esc(info.slug)}</code>`,
      `Тариф: ${esc(info.planName)} — <b>${money(info.amountCents)}</b> (${esc(methodLabel(info.method))})`,
      `Подписка продлена на ${info.days} дн.${until ? `, действует до ${esc(until)}` : ''}`,
    ].join('\n')
  );
}
