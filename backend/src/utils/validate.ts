// Shared, dependency-free validation helpers for the API routes.
// Every function returns a user-facing error string (Russian) or null when the
// value is valid. Keeping the limits in one place lets the frontend mirror them.

export type ValidationError = string | null;

export const LIMITS = {
  operatorName: 100,
  tenantName: 200,
  email: 255,
  passwordMin: 8,
  passwordMax: 128,
  tagName: 30,
  /** Максимум тегов на один чат: больше на практике не нужно и мешает чтению. */
  tagsPerChat: 10,
  cannedShortcut: 32,
  cannedTitle: 200,
  cannedContent: 4000,
  cannedCategory: 100,
  message: 4000,
  welcomeMessage: 1000,
  chatTimeoutMin: 1,
  chatTimeoutMax: 1440,
  inviteCountMax: 100,
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const SHORTCUT_RE = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * SEC-04: blocklist of the most common/leaked passwords. Compared lowercased so
 * `Admin123` is rejected too. Kept small (exact matches) to avoid false positives.
 */
export const WEAK_PASSWORDS = new Set([
  'password', 'password1', 'password12', 'password123', 'passw0rd',
  '12345678', '123456789', '1234567890', '87654321',
  'qwerty', 'qwerty123', 'qwertyui', 'qwertyuiop',
  'admin', 'admin123', 'admin1234', 'administrator',
  'letmein', 'welcome', 'welcome1', 'iloveyou',
  'monkey', 'dragon', 'football', 'baseball', 'superman',
  '11111111', '00000000', 'aaaaaaaa', 'changeme',
]);

interface StringOpts {
  min?: number;
  max?: number;
  /** Trim before measuring (default true). */
  trim?: boolean;
}

/** Validates a required, non-empty string within [min, max] characters. */
export function validString(value: unknown, label: string, opts: StringOpts = {}): ValidationError {
  const { min = 1, max = 255, trim = true } = opts;
  if (typeof value !== 'string') return `${label}: обязательное поле`;
  const v = trim ? value.trim() : value;
  if (v.length < min) return min === 1 ? `${label}: обязательное поле` : `${label}: минимум ${min} символов`;
  if (v.length > max) return `${label}: максимум ${max} символов`;
  return null;
}

export function validEmail(value: unknown): ValidationError {
  const e = validString(value, 'Email', { max: LIMITS.email });
  if (e) return 'Укажите корректный email';
  if (!EMAIL_RE.test(String(value).trim())) return 'Некорректный email';
  return null;
}

export function validPassword(value: unknown): ValidationError {
  if (typeof value !== 'string' || value.length === 0) return 'Пароль: обязательное поле';
  if (value.length < LIMITS.passwordMin) return `Пароль: минимум ${LIMITS.passwordMin} символов`;
  if (value.length > LIMITS.passwordMax) return `Пароль: максимум ${LIMITS.passwordMax} символов`;
  // SEC-04: reject the most common/leaked passwords.
  if (WEAK_PASSWORDS.has(value.toLowerCase())) return 'Пароль слишком простой, выберите другой';
  return null;
}

export function validSlug(value: unknown): ValidationError {
  if (typeof value !== 'string' || !SLUG_RE.test(value.trim().toLowerCase())) {
    return 'Slug: 2–64 символа, латиница в нижнем регистре, цифры и дефис';
  }
  return null;
}

/** Optional hex colour (#RRGGBB). Empty/null is allowed. */
export function validColor(value: unknown): ValidationError {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !COLOR_RE.test(value)) return 'Цвет: формат #RRGGBB';
  return null;
}

export function validInt(
  value: unknown,
  label: string,
  opts: { min?: number; max?: number } = {}
): ValidationError {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) return `${label}: целое число`;
  if (opts.min !== undefined && n < opts.min) return `${label}: минимум ${opts.min}`;
  if (opts.max !== undefined && n > opts.max) return `${label}: максимум ${opts.max}`;
  return null;
}

/**
 * SEC-25: widget embed origin for the CSP frame-ancestors list. Values end up
 * verbatim in a response header, so only a strict origin (scheme://host[:port])
 * is allowed — no paths, spaces, quotes or `;`.
 */
const ORIGIN_RE = /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/;

export function validWidgetOrigin(value: unknown): ValidationError {
  if (typeof value !== 'string' || value.trim().length === 0) return 'Origins: укажите адрес сайта';
  const v = value.trim();
  if (v.length > 100 || !ORIGIN_RE.test(v)) {
    return 'Origins: формат https://site.ru (без пути, пробелов и кавычек)';
  }
  return null;
}

/** Tag name: 1–30 chars. */
export function validTagName(value: unknown): ValidationError {
  return validString(value, 'Название тега', { max: LIMITS.tagName });
}

/** Canned-response shortcut: latin/digits/_/- up to 32 chars. */
export function validShortcut(value: unknown): ValidationError {
  if (typeof value !== 'string' || !SHORTCUT_RE.test(value.trim())) {
    return 'Shortcut: латиница, цифры, «_» и «-», до 32 символов';
  }
  return null;
}

/** Returns the first non-null error, or null. */
export function firstError(...errs: ValidationError[]): ValidationError {
  for (const e of errs) if (e) return e;
  return null;
}
