import crypto from 'crypto';
import { describe, it, expect } from 'vitest';
import { verifyWidgetPayload, displayNameOf } from '../../src/services/telegramLogin';

const BOT_TOKEN = '123456:test-token';

/** Signs a payload the way the Telegram Login Widget does. */
function sign(payload: Record<string, string | number>, token = BOT_TOKEN): Record<string, string> {
  const data: Record<string, string> = {};
  for (const [k, v] of Object.entries(payload)) data[k] = String(v);
  const dataCheckString = Object.keys(data)
    .map((k) => `${k}=${data[k]}`)
    .sort()
    .join('\n');
  const secret = crypto.createHash('sha256').update(token).digest();
  data.hash = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  return data;
}

function validPayload(authDate = Math.floor(Date.now() / 1000)) {
  return sign({ id: 424242, first_name: 'Иван', last_name: 'Петров', username: 'ivan_p', auth_date: authDate });
}

describe('verifyWidgetPayload', () => {
  it('accepts a correctly signed payload and parses the user', () => {
    const { user, error } = verifyWidgetPayload(validPayload(), BOT_TOKEN);
    expect(error).toBeUndefined();
    expect(user).toMatchObject({
      id: 424242,
      firstName: 'Иван',
      lastName: 'Петров',
      username: 'ivan_p',
      photoUrl: null,
    });
  });

  it('accepts an uppercase hex hash', () => {
    const payload = validPayload();
    payload.hash = payload.hash.toUpperCase();
    const { user } = verifyWidgetPayload(payload, BOT_TOKEN);
    expect(user?.id).toBe(424242);
  });

  it('rejects a field tampered after signing', () => {
    const payload = validPayload();
    payload.id = '1'; // attacker tries to become another operator
    expect(verifyWidgetPayload(payload, BOT_TOKEN).user).toBeUndefined();
  });

  it('rejects a signature made with a different bot token', () => {
    const payload = validPayload();
    expect(verifyWidgetPayload(payload, '999999:other-token').user).toBeUndefined();
  });

  it('rejects payloads older than 24 hours (replay)', () => {
    const stale = Math.floor(Date.now() / 1000) - 25 * 60 * 60;
    const { user, error } = verifyWidgetPayload(validPayload(stale), BOT_TOKEN);
    expect(user).toBeUndefined();
    expect(error).toMatch(/устарели/i);
  });

  it('rejects an auth_date from the far future', () => {
    const future = Math.floor(Date.now() / 1000) + 60 * 60;
    const { user, error } = verifyWidgetPayload(validPayload(future), BOT_TOKEN);
    expect(user).toBeUndefined();
    expect(error).toMatch(/дата/i);
  });

  it('rejects a non-integer or non-positive id', () => {
    for (const id of ['abc', '-5', '1.5']) {
      const { user } = verifyWidgetPayload(sign({ id, auth_date: Math.floor(Date.now() / 1000) }), BOT_TOKEN);
      expect(user).toBeUndefined();
    }
  });

  it('rejects non-objects and payloads without a hash', () => {
    expect(verifyWidgetPayload(null, BOT_TOKEN).user).toBeUndefined();
    expect(verifyWidgetPayload([validPayload()], BOT_TOKEN).user).toBeUndefined();
    expect(verifyWidgetPayload({ id: 1, auth_date: 1 }, BOT_TOKEN).user).toBeUndefined();
    expect(verifyWidgetPayload({ ...validPayload(), hash: 'zz' }, BOT_TOKEN).user).toBeUndefined();
  });

  it('trims and truncates oversized fields', () => {
    const payload = sign({
      id: 7,
      first_name: 'a'.repeat(300),
      username: 'u'.repeat(100),
      auth_date: Math.floor(Date.now() / 1000),
    });
    const { user } = verifyWidgetPayload(payload, BOT_TOKEN);
    expect(user?.firstName?.length).toBe(100);
    expect(user?.username?.length).toBe(64);
  });
});

describe('displayNameOf', () => {
  it('prefers first + last name', () => {
    expect(
      displayNameOf({ id: 1, firstName: 'Иван', lastName: 'Петров', username: 'u', photoUrl: null, authDate: 0 })
    ).toBe('Иван Петров');
  });

  it('falls back to username, then to the numeric id', () => {
    expect(displayNameOf({ id: 42, firstName: null, lastName: null, username: 'sam', photoUrl: null, authDate: 0 })).toBe('sam');
    expect(displayNameOf({ id: 42, firstName: '  ', lastName: null, username: null, photoUrl: null, authDate: 0 })).toBe('Telegram 42');
  });
});
