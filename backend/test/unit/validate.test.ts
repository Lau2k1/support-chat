import { describe, it, expect } from 'vitest';
import {
  validString,
  validEmail,
  validPassword,
  validSlug,
  validColor,
  validInt,
  validShortcut,
  firstError,
  LIMITS,
} from '../../src/utils/validate';

describe('validString', () => {
  it('accepts a normal trimmed string', () => {
    expect(validString('  hi  ', 'Поле')).toBeNull();
  });

  it('rejects non strings', () => {
    expect(validString(5, 'Поле')).toBe('Поле: обязательное поле');
  });

  it('rejects an empty string after trim', () => {
    expect(validString('   ', 'Поле')).toBe('Поле: обязательное поле');
  });

  it('enforces the max length', () => {
    expect(validString('abcd', 'Поле', { max: 3 })).toBe('Поле: максимум 3 символов');
  });

  it('enforces the min length', () => {
    expect(validString('ab', 'Поле', { min: 3 })).toBe('Поле: минимум 3 символов');
  });

  it('can skip trimming', () => {
    expect(validString('  ', 'Поле', { trim: false })).toBeNull();
  });
});

describe('validEmail', () => {
  it('accepts a valid email', () => {
    expect(validEmail('user@example.com')).toBeNull();
  });

  it('rejects malformed emails', () => {
    expect(validEmail('user@example')).not.toBeNull();
    expect(validEmail('no-at-sign')).not.toBeNull();
  });

  it('rejects non strings', () => {
    expect(validEmail(undefined)).not.toBeNull();
  });
});

describe('validPassword', () => {
  it('accepts a password within bounds', () => {
    expect(validPassword('secret1')).toBeNull();
  });

  it('rejects a too-short password', () => {
    expect(validPassword('abc')).toBe(`Пароль: минимум ${LIMITS.passwordMin} символов`);
  });

  it('rejects non strings', () => {
    expect(validPassword(null)).toBe('Пароль: обязательное поле');
  });
});

describe('validSlug', () => {
  it('accepts a lowercase slug', () => {
    expect(validSlug('acme-support')).toBeNull();
  });

  it('lowercases before matching, rejects too-short slugs', () => {
    expect(validSlug('Acme')).toBeNull();
    expect(validSlug('a')).not.toBeNull();
  });
});

describe('validColor', () => {
  it('allows empty values', () => {
    expect(validColor('')).toBeNull();
    expect(validColor(null)).toBeNull();
  });

  it('accepts #RRGGBB', () => {
    expect(validColor('#A1b2C3')).toBeNull();
  });

  it('rejects other formats', () => {
    expect(validColor('red')).not.toBeNull();
    expect(validColor('#fff')).not.toBeNull();
  });
});

describe('validInt', () => {
  it('accepts integers from numbers and numeric strings', () => {
    expect(validInt(7, 'N')).toBeNull();
    expect(validInt('7', 'N')).toBeNull();
  });

  it('rejects floats and non-numeric values', () => {
    expect(validInt(1.5, 'N')).not.toBeNull();
    expect(validInt('abc', 'N')).not.toBeNull();
  });

  it('enforces bounds', () => {
    expect(validInt(0, 'N', { min: 1 })).toBe('N: минимум 1');
    expect(validInt(5, 'N', { max: 3 })).toBe('N: максимум 3');
  });
});

describe('validShortcut', () => {
  it('accepts latin, digits, "_" and "-"', () => {
    expect(validShortcut('hello_1-a')).toBeNull();
  });

  it('rejects spaces and cyrillic', () => {
    expect(validShortcut('привет')).not.toBeNull();
    expect(validShortcut('a b')).not.toBeNull();
  });
});

describe('firstError', () => {
  it('returns the first non-null error', () => {
    expect(firstError(null, 'boom', 'later')).toBe('boom');
  });

  it('returns null when every value is valid', () => {
    expect(firstError(null, null)).toBeNull();
  });
});
