import { describe, it, expect } from 'vitest';
import { normalizeTgApiBase } from '../../src/utils/tgApiBase';

describe('normalizeTgApiBase', () => {
  it('defaults to api.telegram.org without a trailing slash', () => {
    expect(normalizeTgApiBase(undefined, 'development')).toBe('https://api.telegram.org');
    expect(normalizeTgApiBase('', 'development')).toBe('https://api.telegram.org');
  });

  // Regression: a trailing slash produced `//bot<token>/<method>` and Telegram
  // answered 404 "Not Found", silently breaking every outgoing message.
  it('strips the trailing slash that URL.toString() would keep', () => {
    expect(normalizeTgApiBase('https://api.telegram.org', 'production')).toBe('https://api.telegram.org');
    expect(normalizeTgApiBase('https://api.telegram.org/', 'production')).toBe('https://api.telegram.org');
    expect(normalizeTgApiBase('https://api.telegram.org///', 'production')).toBe('https://api.telegram.org');
  });

  it('keeps a non-empty path but drops the trailing slash', () => {
    expect(normalizeTgApiBase('https://example.test/telegram/', 'production')).toBe('https://example.test/telegram');
  });

  it('allows http in development (mock API) and strips the slash', () => {
    expect(normalizeTgApiBase('http://localhost:3999/', 'development')).toBe('http://localhost:3999');
  });

  it('rejects http in production', () => {
    expect(() => normalizeTgApiBase('http://localhost:3999', 'production')).toThrow(/https/);
  });

  it('rejects a non-URL and a non-http(s) scheme', () => {
    expect(() => normalizeTgApiBase('not a url', 'development')).toThrow(/valid URL/);
    expect(() => normalizeTgApiBase('ftp://example.test', 'development')).toThrow(/http\(s\)/);
  });
});
