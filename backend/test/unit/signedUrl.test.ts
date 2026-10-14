import { describe, it, expect } from 'vitest';
import { signFileUrl, verifyFileSignature } from '../../src/utils/signedUrl';

const FILE = '123e4567-e89b-12d3-a456-426614174000.png';

describe('signFileUrl', () => {
  it('returns null for empty input', () => {
    expect(signFileUrl(null)).toBeNull();
    expect(signFileUrl(undefined)).toBeNull();
    expect(signFileUrl('')).toBeNull();
  });

  it('leaves non-upload URLs untouched', () => {
    expect(signFileUrl('https://example.test/a.png')).toBe('https://example.test/a.png');
    expect(signFileUrl('/other/a.png')).toBe('/other/a.png');
  });

  it('adds a verifiable signature to an /uploads URL', () => {
    const signed = signFileUrl(`/uploads/${FILE}`);
    expect(signed).toMatch(/^\/uploads\/123e4567-e89b-12d3-a456-426614174000\.png\?t=\d+\.[0-9a-f]{64}$/);
    const token = signed!.split('?t=')[1];
    expect(verifyFileSignature(FILE, token)).toBe(true);
  });

  it('is stable within a day (same URL for the same file)', () => {
    expect(signFileUrl(`/uploads/${FILE}`)).toBe(signFileUrl(`/uploads/${FILE}`));
  });
});

describe('verifyFileSignature', () => {
  const tokenOf = (name: string) => signFileUrl(`/uploads/${name}`)!.split('?t=')[1];

  it('rejects a signature for a different file', () => {
    const token = tokenOf(FILE);
    expect(verifyFileSignature('aaaaaaaa-e89b-12d3-a456-426614174000.png', token)).toBe(false);
  });

  it('rejects a tampered signature', () => {
    const token = tokenOf(FILE);
    const [exp] = token.split('.');
    const bad = `${exp}.${'0'.repeat(64)}`;
    expect(verifyFileSignature(FILE, bad)).toBe(false);
  });

  it('rejects an expired signature', () => {
    const token = tokenOf(FILE);
    const farFuture = Date.now() + 365 * 24 * 60 * 60 * 1000;
    expect(verifyFileSignature(FILE, token, farFuture)).toBe(false);
  });

  it('rejects malformed tokens', () => {
    expect(verifyFileSignature(FILE, '')).toBe(false);
    expect(verifyFileSignature(FILE, 'nodot')).toBe(false);
    expect(verifyFileSignature(FILE, 'abc.def')).toBe(false);
  });
});
