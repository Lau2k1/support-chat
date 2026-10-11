// Shared, dependency-free validation helpers for the API routes.
// Every function returns a user-facing error string (Russian) or null when the
// value is valid. Keeping the limits in one place lets the frontend mirror them.

export type ValidationError = string | null;

export const LIMITS = {
  operatorName: 100,
  tenantName: 200,
  email: 255,
  passwordMin: 6,
  passwordMax: 128,
  tagName: 30,
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
