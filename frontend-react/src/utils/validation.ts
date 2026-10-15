// Shared, dependency-free validation helpers for the React forms.
// Mirrors backend/src/utils/validate.ts so the UI and API agree on limits.

export const LIMITS = {
  operatorName: 100,
  tenantName: 200,
  email: 255,
  passwordMin: 8,
  passwordMax: 128,
  tagName: 30,
  /** Максимум тегов на один чат (зеркалит backend LIMITS.tagsPerChat). */
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

/** SEC-04: mirrors backend/src/utils/validate.ts WEAK_PASSWORDS. */
export const WEAK_PASSWORDS = new Set([
  'password', 'password1', 'password12', 'password123', 'passw0rd',
  '12345678', '123456789', '1234567890', '87654321',
  'qwerty', 'qwerty123', 'qwertyui', 'qwertyuiop',
  'admin', 'admin123', 'admin1234', 'administrator',
  'letmein', 'welcome', 'welcome1', 'iloveyou',
  'monkey', 'dragon', 'football', 'baseball', 'superman',
  '11111111', '00000000', 'aaaaaaaa', 'changeme',
]);

export const isEmail = (v: string) => EMAIL_RE.test(v.trim());
export const isSlug = (v: string) => SLUG_RE.test(v.trim().toLowerCase());
export const isHexColor = (v: string) => COLOR_RE.test(v);
export const isShortcut = (v: string) => SHORTCUT_RE.test(v.trim());

/** Telegram bot token: "<digits>:<35+ url-safe chars>". */
const TELEGRAM_TOKEN_RE = /^\d{6,}:[A-Za-z0-9_-]{30,}$/;
export const isTelegramToken = (v: string) => TELEGRAM_TOKEN_RE.test(v.trim());

/** Returns an error message or null. */
export function validateRequired(value: string, label: string, max = 255): string | null {
  const v = value.trim();
  if (!v) return `${label}: обязательное поле`;
  if (v.length > max) return `${label}: максимум ${max} символов`;
  return null;
}

export function validateEmail(value: string): string | null {
  if (!value.trim()) return 'Укажите email';
  if (!isEmail(value)) return 'Некорректный email';
  if (value.trim().length > LIMITS.email) return 'Email слишком длинный';
  return null;
}

export function validatePassword(value: string): string | null {
  if (!value) return 'Пароль: обязательное поле';
  if (value.length < LIMITS.passwordMin) return `Пароль: минимум ${LIMITS.passwordMin} символов`;
  if (value.length > LIMITS.passwordMax) return `Пароль: максимум ${LIMITS.passwordMax} символов`;
  // SEC-04: mirror the backend blocklist of common passwords.
  if (WEAK_PASSWORDS.has(value.toLowerCase())) return 'Пароль слишком простой, выберите другой';
  return null;
}

export function validateTagName(value: string): string | null {
  const v = value.trim();
  if (!v) return 'Название тега: обязательное поле';
  if (v.length > LIMITS.tagName) return `Название тега: максимум ${LIMITS.tagName} символов`;
  return null;
}

export function validateShortcut(value: string): string | null {
  if (!isShortcut(value)) return 'Shortcut: латиница, цифры, «_» и «-», до 32 символов';
  return null;
}

export function validateCategory(value: string): string | null {
  return validateRequired(value, 'Категория', LIMITS.cannedCategory);
}

/** Clamps a numeric input to an integer range, returning '' for empty input. */
export function clampIntInput(raw: string, min: number, max: number): string {
  if (raw === '') return '';
  const n = Math.floor(Number(raw));
  if (Number.isNaN(n)) return '';
  return String(Math.min(Math.max(n, min), max));
}
