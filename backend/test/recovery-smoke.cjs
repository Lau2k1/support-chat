// Smoke-тест восстановления пароля через Telegram (против запущенного сервера).
//
// Что проверяется:
//   1. шаг 1 принимает подпись Telegram только от настоящего бота (подделка → 400);
//   2. Telegram, не привязанный ни к одному аккаунту → 404;
//   3. шаг 2 не пропускает слабый пароль и не меняет пароль в базе;
//   4. шаг 2 меняет пароль, гасит токен, поднимает token_version и выдаёт сессию;
//   5. повторное использование того же токена → 400;
//   6. истёкший токен → 400;
//   7. отправка уведомления в Telegram (несуществующий чат) не ломает смену пароля.
//
// Из-за лимита RECOVERY_RATE_LIMIT_MAX (20 запросов / 15 мин на IP) тест нельзя
// гонять подряд много раз: 9 запросов за прогон (то есть не больше двух подряд).
//
// Запуск (рядом с работающим сервером, нужен TELEGRAM_LOGIN_BOT_TOKEN и доступ к БД):
//   node test/recovery-smoke.cjs
// Внутри контейнера:
//   docker cp test/recovery-smoke.cjs support-chat-app:/app/backend/recovery-smoke.cjs
//   docker exec support-chat-app node recovery-smoke.cjs

const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

const HTTP = (process.env.SMOKE_HTTP || 'http://localhost:3000').replace(/\/+$/, '');
const BOT_TOKEN = (process.env.TELEGRAM_LOGIN_BOT_TOKEN || '').trim();
const OLD_PASSWORD = 'old-password-123456';
const NEW_PASSWORD = 'new-password-654321';

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) process.exitCode = 1;
}

/** Подписывает payload так же, как Telegram Login Widget. */
function sign(payload, token = BOT_TOKEN) {
  const data = {};
  for (const [k, v] of Object.entries(payload)) data[k] = String(v);
  const dataCheckString = Object.keys(data)
    .map((k) => `${k}=${data[k]}`)
    .sort()
    .join('\n');
  const secret = crypto.createHash('sha256').update(token).digest();
  data.hash = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  return data;
}

function widgetPayload(id, authDate = Math.floor(Date.now() / 1000)) {
  return sign({ id, first_name: 'Smoke', username: 'smoke_recovery', auth_date: authDate });
}

async function post(p, body) {
  const res = await fetch(HTTP + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* пустой ответ */
  }
  return { status: res.status, data: data || {}, setCookie: res.headers.get('set-cookie') || '' };
}

(async () => {
  if (!BOT_TOKEN) {
    console.log('SKIP: TELEGRAM_LOGIN_BOT_TOKEN не задан — восстановление через Telegram выключено');
    process.exit(0);
  }

  // Telegram ID заведомо вне диапазона реальных аккаунтов: тест не должен
  // задеть чужой аккаунт, даже если такой Telegram когда-нибудь появится.
  const tgId = 9_000_000_000_000 + Math.floor(Math.random() * 1_000_000);
  const email = `recovery-smoke-${Date.now()}@example.com`;
  const tenant = await pool.query('SELECT id FROM tenants ORDER BY id LIMIT 1');
  const tenantId = tenant.rows.length ? tenant.rows[0].id : null;

  const created = await pool.query(
    `INSERT INTO operators (name, email, password, role, tenant_id, telegram_id, telegram_username)
     VALUES ('Smoke Recovery', $1, $2, 'operator', $3, $4, 'smoke_recovery')
     RETURNING id, token_version`,
    [email, await bcrypt.hash(OLD_PASSWORD, 10), tenantId, String(tgId)]
  );
  const opId = created.rows[0].id;
  const startVersion = created.rows[0].token_version;

  try {
    // 1. Шаг 1: подпись настоящего бота — токен на 10 минут, email под маской.
    const started = await post('/auth/telegram/recovery', widgetPayload(tgId));
    check('шаг 1: подтверждение принято', started.status === 200, `status=${started.status}`);
    const token = started.data.token;
    check('шаг 1: выдан одноразовый токен', typeof token === 'string' && /^[a-f0-9]{64}$/.test(token));
    check('шаг 1: срок жизни 10 минут', started.data.ttlMinutes === 10, `ttl=${started.data.ttlMinutes}`);
    check('шаг 1: имя аккаунта отдано', started.data.name === 'Smoke Recovery', String(started.data.name));
    check('шаг 1: email под маской', started.data.email === 'r******@example.com', String(started.data.email));

    const stored = await pool.query('SELECT reset_token_hash, reset_token_expires FROM operators WHERE id = $1', [opId]);
    check(
      'шаг 1: в базе хеш, а не токен',
      stored.rows[0].reset_token_hash === crypto.createHash('sha256').update(token).digest('hex') &&
        stored.rows[0].reset_token_hash !== token
    );
    check(
      'шаг 1: срок хранения — epoch в будущем',
      Number(stored.rows[0].reset_token_expires) > Date.now(),
      String(stored.rows[0].reset_token_expires)
    );

    // 2. Подпись другого бота (подделка id) — вход закрыт.
    const forged = widgetPayload(tgId);
    forged.id = String(tgId + 1);
    const forgedRes = await post('/auth/telegram/recovery', forged);
    check('подделанный payload → 400', forgedRes.status === 400, `status=${forgedRes.status}`);

    // 3. Telegram ни к чему не привязан.
    const stranger = await post('/auth/telegram/recovery', widgetPayload(tgId + 7));
    check('чужой Telegram → 404', stranger.status === 404, `status=${stranger.status}`);

    // 4. Слабый пароль не проходит, пароль в базе не трогаем.
    const weak = await post('/auth/telegram/recovery/confirm', { token, password: 'qwerty123' });
    check('слабый пароль → 400', weak.status === 400, `status=${weak.status}`);
    const afterWeak = await pool.query('SELECT password, reset_token_hash FROM operators WHERE id = $1', [opId]);
    check('после отказа пароль прежний', await bcrypt.compare(OLD_PASSWORD, afterWeak.rows[0].password));
    check('после отказа токен ещё жив', afterWeak.rows[0].reset_token_hash !== null);

    // 5. Успешная смена пароля.
    const confirm = await post('/auth/telegram/recovery/confirm', { token, password: NEW_PASSWORD });
    check('шаг 2: пароль изменён', confirm.status === 200, `status=${confirm.status}`);
    check('шаг 2: выдана сессия', /sc_token=/.test(confirm.setCookie));
    const afterOk = await pool.query(
      'SELECT password, token_version, reset_token_hash, reset_token_expires FROM operators WHERE id = $1',
      [opId]
    );
    check('новый пароль подходит', await bcrypt.compare(NEW_PASSWORD, afterOk.rows[0].password));
    check('старый пароль больше не подходит', !(await bcrypt.compare(OLD_PASSWORD, afterOk.rows[0].password)));
    check('token_version выросла', afterOk.rows[0].token_version === startVersion + 1, `${startVersion} → ${afterOk.rows[0].token_version}`);
    check('токен погашен', afterOk.rows[0].reset_token_hash === null && afterOk.rows[0].reset_token_expires === null);

    // 6. Тот же токен второй раз не работает.
    const again = await post('/auth/telegram/recovery/confirm', { token, password: 'another-password-777' });
    check('повтор токена → 400', again.status === 400, `status=${again.status}`);

    // 7. Истёкший токен не работает.
    const second = await post('/auth/telegram/recovery', widgetPayload(tgId));
    const secondToken = second.data.token;
    await pool.query('UPDATE operators SET reset_token_expires = $1 WHERE id = $2', [Date.now() - 1000, opId]);
    const expired = await post('/auth/telegram/recovery/confirm', { token: secondToken, password: 'yet-another-pass-999' });
    check('истёкший токен → 400', expired.status === 400, `status=${expired.status}`);
    const afterExpired = await pool.query('SELECT password FROM operators WHERE id = $1', [opId]);
    check('истечение не меняет пароль', await bcrypt.compare(NEW_PASSWORD, afterExpired.rows[0].password));

    // 8. Мусорный токен отсекается даже раньше обращения к базе.
    const junk = await post('/auth/telegram/recovery/confirm', { token: 'не-токен', password: NEW_PASSWORD });
    check('мусорный токен → 400', junk.status === 400, `status=${junk.status}`);
  } finally {
    await pool.query('DELETE FROM operators WHERE id = $1', [opId]);
    console.log('\n=== done ===');
    await pool.end();
    process.exit(Number(process.exitCode) || 0);
  }
})().catch(async (e) => {
  console.error('FATAL:', e.message);
  await pool.end().catch(() => {});
  process.exit(2);
});
