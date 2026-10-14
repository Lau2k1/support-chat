import crypto from 'crypto';
import { SECRET } from '../middleware/auth';

/**
 * Подписанные ссылки на файлы (/uploads/...).
 *
 * Файлы тенантов лежат в общем хранилище, поэтому раздача должна проверять,
 * что запрашивающий имеет право видеть файл. Панель оператора ходит со
 * сессионной cookie (same-origin), а встроенный виджет — нет: теги <img>/<a>
 * не умеют слать заголовки. Для виджета мы добавляем короткую подпись в
 * query-строку: `?t=<exp>.<hmac>`. Подпись привязана к имени файла и сроку и
 * не даёт доступа к чатам/API (не заменяет client-token).
 */

const PREFIX = '/uploads/';
const DAY_MS = 24 * 60 * 60 * 1000;
/** Срок жизни ссылки; по умолчанию 7 суток. */
const TTL_MS = Number(process.env.UPLOAD_URL_TTL_MS || String(7 * DAY_MS));

function sign(name: string, exp: number): string {
  return crypto.createHmac('sha256', SECRET).update(`${name}.${exp}`).digest('hex');
}

/**
 * Добавляет подпись к сохранённому `/uploads/<file>` URL. Срок выравнивается по
 * границе суток, чтобы одна и та же ссылка была стабильной в течение дня (не
 * ломает кэш браузера при повторной отрисовке одного и того же сообщения).
 */
export function signFileUrl(fileUrl: string | null | undefined): string | null {
  if (!fileUrl) return null;
  if (!fileUrl.startsWith(PREFIX)) return fileUrl;
  const name = fileUrl.slice(PREFIX.length);
  // Уже подписанный/подозрительный URL не трогаем.
  if (!name || name.includes('?') || name.includes('/')) return fileUrl;
  const exp = Math.ceil((Date.now() + TTL_MS) / DAY_MS) * DAY_MS;
  return `${PREFIX}${name}?t=${exp}.${sign(name, exp)}`;
}

/** Проверяет подпись из query-параметра `t`. */
export function verifyFileSignature(name: string, token: string, now: number = Date.now()): boolean {
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const exp = Number(token.slice(0, dot));
  const provided = token.slice(dot + 1);
  if (!Number.isFinite(exp) || exp < now) return false;
  const expected = sign(name, exp);
  if (provided.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}
