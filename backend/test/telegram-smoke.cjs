// Telegram integration smoke test (PLAN section 9).
//
// Starts:
//   1. a mock Telegram Bot API on :3999 (getMe/setWebhook/deleteWebhook/sendMessage/getFile/file)
//   2. an isolated backend on :3100 with TELEGRAM_API_BASE pointing at the mock
// then exercises the full loop: connect bot -> inbound update -> operator reply -> bot ack.
//
// Run:  node test/telegram-smoke.cjs
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { WebSocket } = require('ws');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { Pool } = require('pg');

const MOCK_PORT = 3999;
const APP_PORT = 3100;
const APP = `http://localhost:${APP_PORT}`;
const TEST_CONTACT = '555';

const TENANT_ADMIN = { email: 'tenant@admin.ru', password: 'tenant1234' };
const BOT_TOKEN = '123456789:AAFakeFakeFakeFakeFakeFakeFakeFake';

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

/** Removes leftover data from previous (possibly aborted) runs. */
async function cleanupData() {
  await pool.query(
    "DELETE FROM chats WHERE source = 'telegram' AND external_id = $1",
    [TEST_CONTACT]
  );
  await pool.query('DELETE FROM telegram_users WHERE tg_user_id = $1', [Number(TEST_CONTACT)]);
}

let passed = 0;
let failed = 0;
function check(name, ok, extra = '') {
  if (ok) passed++; else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) process.exitCode = 1;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Mock Telegram Bot API
// ---------------------------------------------------------------------------
const tgRequests = [];
const mock = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const url = req.url || '';
    const m = url.match(/^\/bot([^/]+)\/([^/?]+)/);
    if (m && req.method === 'POST') {
      const method = m[2];
      let payload = {};
      const ctype = req.headers['content-type'] || '';
      if (ctype.includes('application/json')) {
        try { payload = JSON.parse(body.toString('utf8') || '{}'); } catch { /* ignore */ }
      } else {
        payload = { _raw: body.length, _multipart: true };
      }
      tgRequests.push({ method, payload, raw: body.length });
      const replies = {
        getMe: { ok: true, result: { id: 777, is_bot: true, first_name: 'Mock', username: 'mock_support_bot' } },
        setWebhook: { ok: true, result: true },
        deleteWebhook: { ok: true, result: true },
        sendMessage: { ok: true, result: { message_id: 1001 } },
        sendPhoto: { ok: true, result: { message_id: 1002 } },
        sendDocument: { ok: true, result: { message_id: 1003 } },
        getFile: { ok: true, result: { file_path: 'photos/file_1.jpg' } },
      };
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(replies[method] || { ok: false, description: 'unknown method ' + method }));
    }
    // File download endpoint: /file/bot<token>/<path>
    if (url.startsWith('/file/bot') && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      return res.end(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])); // tiny jpeg-ish header
    }
    res.writeHead(404);
    res.end();
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function login(email, password) {
  const res = await fetch(APP + '/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  return { ok: res.status === 200, token: body.token };
}

async function api(token, p, { method = 'GET', body } = {}) {
  const res = await fetch(APP + p, {
    method,
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, body: json, text };
}

function connect() {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${APP_PORT}`);
    ws.on('open', () => resolve(ws));
  });
}

// Buffer every event so nothing is lost between awaited checks.
let wsEvents = [];
function waitEvent(pred, ms = 5000) {
  return new Promise((resolve, reject) => {
    const existing = wsEvents.find(pred);
    if (existing) return resolve(existing);
    const deadline = Date.now() + ms;
    const iv = setInterval(() => {
      const found = wsEvents.find(pred);
      if (found) {
        clearInterval(iv);
        resolve(found);
      } else if (Date.now() > deadline) {
        clearInterval(iv);
        reject(new Error('timeout waiting for event'));
      }
    }, 50);
  });
}

async function waitForServer(url, ms = 30000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok || r.status === 404) return true;
    } catch { /* not up yet */ }
    await sleep(400);
  }
  return false;
}

async function postUpdate(botId, secret, update) {
  const res = await fetch(`${APP}/api/tg/${botId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
    body: JSON.stringify(update),
  });
  return res.status;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
let child;
let ws;

async function main() {
  await new Promise((r) => mock.listen(MOCK_PORT, r));
  console.log(`mock Telegram API on :${MOCK_PORT}`);

  const backendDir = path.join(__dirname, '..');
  child = spawn(
    process.execPath,
    [path.join(backendDir, 'node_modules', 'ts-node', 'dist', 'bin-transpile.js'), 'src/server.ts'],
    {
      cwd: backendDir,
      env: {
        ...process.env,
        PORT: String(APP_PORT),
        TELEGRAM_API_BASE: `http://localhost:${MOCK_PORT}`,
        PUBLIC_BASE_URL: APP,
      },
      stdio: 'ignore',
    }
  );

  const up = await waitForServer(APP + '/login');
  check('isolated backend started', up);
  if (!up) throw new Error('backend did not start');

  await cleanupData();

  const admin = await login(TENANT_ADMIN.email, TENANT_ADMIN.password);
  check('tenant admin login', admin.ok);

  // Connect an operator WS first so it observes new_chat / message broadcasts.
  ws = await connect();
  wsEvents = [];
  ws.on('message', (raw) => {
    try { wsEvents.push(JSON.parse(raw.toString())); } catch { /* ignore */ }
  });
  ws.send(JSON.stringify({ type: 'auth', token: admin.token }));
  await waitEvent((d) => d.type === 'auth_ok');
  ws.send(JSON.stringify({ type: 'operator_join' }));
  await waitEvent((d) => d.type === 'init_operator');
  // new_chat is broadcast to *online* operators only (same as the widget flow).
  ws.send(JSON.stringify({ type: 'operator_status', status: 'online' }));
  await sleep(200);
  check('operator WS ready', true);

  // ---- connect bot -------------------------------------------------------
  const connectRes = await api(admin.token, '/admin/telegram-bot', {
    method: 'PUT',
    body: { bot_token: BOT_TOKEN },
  });
  check('connect bot ok', connectRes.status === 200, `status=${connectRes.status}`);
  check('bot username from getMe', connectRes.body?.bot?.bot_username === 'mock_support_bot');
  check('webhook registered', connectRes.body?.webhook_registered === true);
  const botId = connectRes.body?.bot?.id;

  const setWebhook = tgRequests.find((r) => r.method === 'setWebhook');
  check('setWebhook called with secret', !!setWebhook && !!setWebhook.payload.secret_token);
  check('setWebhook url points to /api/tg', String(setWebhook?.payload?.url || '').endsWith(`/api/tg/${botId}`));
  const secret = setWebhook?.payload?.secret_token || '';

  // ---- invalid token rejected -------------------------------------------
  const badToken = await api(admin.token, '/admin/telegram-bot', { method: 'PUT', body: { bot_token: 'not-a-token' } });
  check('reject malformed token', badToken.status === 400);

  // ---- inbound text ------------------------------------------------------
  const chatPromise = waitEvent((d) => d.type === 'new_chat' && d.source === 'telegram');
  const status = await postUpdate(botId, secret, {
    update_id: 1,
    message: { message_id: 1, from: { id: Number(TEST_CONTACT), first_name: 'Иван', username: 'ivan' }, chat: { id: Number(TEST_CONTACT) }, text: 'Привет из Telegram' },
  });
  check('webhook accepts text update', status === 200);

  const newChat = await chatPromise;
  check('operator got new_chat (source=telegram)', newChat.source === 'telegram');
  check('new_chat carries the TG profile name', newChat.client_name === 'Иван');
  const chatId = newChat.chatId;

  const msg = await waitEvent((d) => d.type === 'message' && String(d.message?.content) === 'Привет из Telegram');
  check('operator got inbound message', msg.message.chat_id === chatId);
  check('inbound message has tg sender name', msg.message.sender_name === 'Иван');

  // ---- inbound photo (file download) ------------------------------------
  await postUpdate(botId, secret, {
    update_id: 2,
    message: { message_id: 2, from: { id: Number(TEST_CONTACT), first_name: 'Иван' }, chat: { id: Number(TEST_CONTACT) }, photo: [{ file_id: 'PHOTO_SMALL' }, { file_id: 'PHOTO_BIG' }], caption: 'Смотри' },
  });
  const photoMsg = await waitEvent((d) => d.type === 'message' && d.message?.message_type === 'image');
  check('inbound photo normalized to image', photoMsg.message.content === 'Смотри');
  check('inbound photo saved to /uploads', String(photoMsg.message.file_url || '').startsWith('/uploads/'));

  // ---- outbound operator reply ------------------------------------------
  ws.send(JSON.stringify({ type: 'message', chatId, content: 'Здравствуйте! Чем помочь?' }));
  let sent = null;
  for (let i = 0; i < 30 && !sent; i++) {
    await sleep(150);
    sent = tgRequests.find((r) => r.method === 'sendMessage' && r.payload.text === 'Здравствуйте! Чем помочь?');
  }
  check('reply forwarded to Telegram', !!sent, sent ? `chat_id=${sent.payload.chat_id}` : 'not seen');
  check('reply targets the tg chat id', String(sent?.payload?.chat_id) === TEST_CONTACT);

  // ---- security ----------------------------------------------------------
  const wrongSecret = await fetch(`${APP}/api/tg/${botId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'wrong' },
    body: JSON.stringify({ update_id: 3 }),
  });
  check('reject wrong webhook secret', wrongSecret.status === 401);

  const unknownBot = await fetch(`${APP}/api/tg/999999`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
    body: JSON.stringify({ update_id: 4 }),
  });
  check('unknown bot -> 404', unknownBot.status === 404);

  // ---- disconnect --------------------------------------------------------
  const del = await api(admin.token, '/admin/telegram-bot', { method: 'DELETE' });
  check('disconnect bot ok', del.status === 200);
  const after = await api(admin.token, '/admin/telegram-bot');
  check('bot gone after disconnect', after.body?.bot === null);
}

main()
  .catch((e) => { check('test run', false, e.message); })
  .finally(async () => {
    try { if (ws) ws.close(); } catch { /* ignore */ }
    // Best-effort cleanup of the test bot in case the run aborted mid-way.
    try {
      const admin = await login(TENANT_ADMIN.email, TENANT_ADMIN.password);
      if (admin.ok) await api(admin.token, '/admin/telegram-bot', { method: 'DELETE' });
    } catch { /* ignore */ }
    try { if (child) child.kill(); } catch { /* ignore */ }
    try { await cleanupData(); } catch { /* ignore */ }
    try { await pool.end(); } catch { /* ignore */ }
    mock.close();
    console.log(`\n=== ${passed}/${passed + failed} passed ===`);
    setTimeout(() => process.exit(process.exitCode || 0), 300);
  });
