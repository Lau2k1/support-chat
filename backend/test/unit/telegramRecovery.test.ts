import crypto from 'crypto';
import { describe, it, expect } from 'vitest';
import {
  RESET_TOKEN_TTL_MINUTES,
  createResetToken,
  hashResetToken,
  maskEmail,
} from '../../src/services/telegramLogin';

describe('createResetToken', () => {
  it('выдаёт 64 hex-символа и хранит только их хеш', () => {
    const { token, hash } = createResetToken();
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    // В базе не должно лежать ничего, чем можно воспользоваться напрямую.
    expect(hash).not.toBe(token);
    expect(hash).toBe(crypto.createHash('sha256').update(token).digest('hex'));
  });

  it('живёт ровно отведённые минуты от переданного момента', () => {
    const now = new Date('2026-10-18T10:00:00.000Z');
    const { expiresAt } = createResetToken(now);
    expect(expiresAt.getTime() - now.getTime()).toBe(RESET_TOKEN_TTL_MINUTES * 60 * 1000);
    expect(RESET_TOKEN_TTL_MINUTES).toBe(10);
  });

  it('не повторяется даже при одинаковом времени', () => {
    const now = new Date('2026-10-18T10:00:00.000Z');
    const a = createResetToken(now);
    const b = createResetToken(now);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe('hashResetToken', () => {
  it('детерминирован — токен из письма/страницы сводится к тому же хешу', () => {
    const { token, hash } = createResetToken();
    expect(hashResetToken(token)).toBe(hash);
    expect(hashResetToken(token.toUpperCase())).not.toBe(hash); // токен регистрозависим
  });

  it('разные токены дают разные хеши', () => {
    expect(hashResetToken('a'.repeat(64))).not.toBe(hashResetToken('b'.repeat(64)));
  });
});

describe('maskEmail', () => {
  it('оставляет первую букву и домен', () => {
    expect(maskEmail('ivan.petrov@example.com')).toBe('i******@example.com');
  });

  it('короткий локальный адрес не раскрывается целиком', () => {
    expect(maskEmail('a@example.com')).toBe('a*@example.com');
  });

  it('возвращает null, когда маскировать нечего', () => {
    expect(maskEmail(null)).toBeNull();
    expect(maskEmail(undefined)).toBeNull();
    expect(maskEmail('')).toBeNull();
    expect(maskEmail('без-собаки')).toBeNull();
    expect(maskEmail('@example.com')).toBeNull();
  });
});
