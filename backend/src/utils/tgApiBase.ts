/**
 * SEC-18: validate and normalize the Telegram Bot API base URL.
 *
 * Must be an http(s) URL, and https-only in production (prevents SSRF to
 * internal services and protects the bot token). The trailing slash is stripped
 * because callers build `${base}/bot${token}/${method}` — a trailing slash would
 * produce `//bot…`, which the Telegram Bot API rejects with 404 "Not Found".
 *
 * Pure function (env is passed in) so it can be unit-tested without side effects.
 */
export function normalizeTgApiBase(raw: string | undefined, nodeEnv: string | undefined): string {
  const trimmed = (raw || 'https://api.telegram.org').trim().replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('TELEGRAM_API_BASE must be a valid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('TELEGRAM_API_BASE must use http(s)');
  }
  if (nodeEnv === 'production' && url.protocol !== 'https:') {
    throw new Error('TELEGRAM_API_BASE must use https in production');
  }
  // `url.toString()` always appends `/` — strip it (and any duplicates).
  return url.toString().replace(/\/+$/, '');
}
