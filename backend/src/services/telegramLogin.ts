import crypto from 'crypto';

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
