import crypto from 'crypto';
import { normalizeTgApiBase } from '../utils/tgApiBase';

/**
 * Verification of the Telegram Login Widget payload.
 *
 * Telegram signs the user data with the bot token:
 *   secret = SHA256(bot_token)
 *   hash   = HMAC_SHA256(data_check_string, secret)
 * where data_check_string is every field except `hash`, sorted by key and joined
 * with "\n". Docs: https://core.telegram.org/widgets/login#checking-authorization
 */

export interface TelegramWidgetUser {
  id: number;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  photoUrl: string | null;
  authDate: number;
}

/** Login payloads older than this are rejected (replay protection). */
const MAX_AGE_SECONDS = 24 * 60 * 60;

export const TELEGRAM_LOGIN_ENABLED = (): boolean =>
  Boolean(process.env.TELEGRAM_LOGIN_BOT_TOKEN && process.env.TELEGRAM_LOGIN_BOT_USERNAME);

export function telegramBotUsername(): string | null {
  return process.env.TELEGRAM_LOGIN_BOT_USERNAME?.replace(/^@/, '') || null;
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  return crypto.timingSafeEqual(bufA, bufB);
}

export function verifyWidgetPayload(
  payload: unknown,
  botToken: string
): { user?: TelegramWidgetUser; error?: string } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { error: 'Некорректные данные Telegram' };
  }
  const data = payload as Record<string, unknown>;

  const hash = data.hash;
  if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/i.test(hash)) {
    return { error: 'Некорректная подпись Telegram' };
  }

  const dataCheckString = Object.keys(data)
    .filter((k) => k !== 'hash' && data[k] !== undefined && data[k] !== null && data[k] !== '')
    .map((k) => `${k}=${String(data[k])}`)
    .sort()
    .join('\n');

  const secret = crypto.createHash('sha256').update(botToken).digest();
  const computed = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  if (!safeEqualHex(computed, hash.toLowerCase())) {
    return { error: 'Подпись Telegram не совпадает' };
  }

  const authDate = Number(data.auth_date);
  if (!Number.isFinite(authDate) || authDate <= 0) {
    return { error: 'Нет даты авторизации' };
  }
  const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
  if (ageSeconds > MAX_AGE_SECONDS) {
    return { error: 'Данные авторизации устарели — попробуйте снова' };
  }
  if (ageSeconds < -60) {
    return { error: 'Некорректная дата авторизации' };
  }

  const id = Number(data.id);
  if (!Number.isInteger(id) || id <= 0) {
    return { error: 'Некорректный Telegram ID' };
  }

  const str = (v: unknown, max: number): string | null => {
    if (typeof v !== 'string') return null;
    const s = v.trim();
    return s ? s.slice(0, max) : null;
  };

  return {
    user: {
      id,
      firstName: str(data.first_name, 100),
      lastName: str(data.last_name, 100),
      username: str(data.username, 64),
      photoUrl: str(data.photo_url, 500),
      authDate,
    },
  };
}

/** Display name for an account created from Telegram data. */
export function displayNameOf(user: TelegramWidgetUser): string {
  const full = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return full || user.username || `Telegram ${user.id}`;
}

// ---------------------------------------------------------------------------
// Восстановление пароля через Telegram
// ---------------------------------------------------------------------------

/**
 * Сколько живёт одноразовый токен восстановления. Короткий срок — потому что
 * токен даёт полный доступ к аккаунту тому, кто им воспользуется.
 */
export const RESET_TOKEN_TTL_MINUTES = 10;

/** Токен, который уходит клиенту, и его представление в базе. */
export interface ResetToken {
  /** 64 hex-символа; наружу отдаётся только он. */
  token: string;
  /** SHA-256 от токена — хранится в operators.reset_token_hash. */
  hash: string;
  expiresAt: Date;
}

/** Хеш токена восстановления (в базе лежит только он). */
export function hashResetToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Новый одноразовый токен восстановления. 32 байта из CSPRNG: угадать нельзя,
 * а срок жизни ограничен, поэтому перебора по хешу в базе тоже нет.
 */
export function createResetToken(now: Date = new Date()): ResetToken {
  const token = crypto.randomBytes(32).toString('hex');
  return {
    token,
    hash: hashResetToken(token),
    expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MINUTES * 60 * 1000),
  };
}

/**
 * Email для показа на шаге подтверждения: «i***@mail.ru». Своих данных мы не
 * раскрываем — вызывающий уже доказал, что владеет этим Telegram, но экран
 * может быть чужим, поэтому email под маской.
 */
export function maskEmail(email: string | null | undefined): string | null {
  const value = (email || '').trim();
  const at = value.lastIndexOf('@');
  if (at <= 0) return null;
  const local = value.slice(0, at);
  const domain = value.slice(at);
  const head = local.slice(0, 1);
  return `${head}${'*'.repeat(Math.min(Math.max(local.length - 1, 1), 6))}${domain}`;
}

// SEC-18: тот же базовый URL Telegram API, что и у ботов, с валидацией.
const TG_API_BASE = normalizeTgApiBase(process.env.TELEGRAM_API_BASE, process.env.NODE_ENV);

/**
 * Сообщение пользователю от бота входа (TELEGRAM_LOGIN_BOT_TOKEN).
 *
 * Доставка возможна только если у пользователя есть диалог с ботом: Telegram
 * запрещает ботам писать первыми. Поэтому ошибка отправки никогда не ломает
 * смену пароля — она гасится в лог, а результат возвращается флагом.
 */
export async function sendLoginBotMessage(chatId: number, text: string): Promise<boolean> {
  const token = (process.env.TELEGRAM_LOGIN_BOT_TOKEN || '').trim();
  if (!token) return false;
  try {
    const res = await fetch(`${TG_API_BASE}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      console.warn('[telegram-login] не удалось отправить сообщение:', res.status, (await res.text()).slice(0, 200));
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[telegram-login] не удалось отправить сообщение:', e instanceof Error ? e.message : e);
    return false;
  }
}
