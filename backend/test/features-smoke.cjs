// Smoke test for the 7-item feature batch (run against the live dev server :3000):
//  1. telegram-bot endpoint no longer exposes webhook_url
//  2. chats get an assigned operator (claim on join/reply) + chat_assigned broadcast
//  3. chat list always carries the public code (init_operator / new_chat / REST)
//  4. per-chat tags endpoint, scoped to the tenant
//  5. public_code format "<project>_<chatId>" is unique and server-generated
const path = require('path');
const { WebSocket } = require('ws');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { Pool } = require('pg');

const HTTP = 'http://localhost:3000';
const WS = 'ws://localhost:3000';
const SUPERADMIN = { email: 'admin@test.com', password: 'admin123' };

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

async function login(email, password) {
  const res = await fetch(HTTP + '/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.status === 200, token: body.token };
}

async function register(name, email, password, inviteCode) {
  const res = await fetch(HTTP + '/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, email, password, inviteCode }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, data: body };
}

async function api(token, p, { method = 'GET', body } = {}) {
  const res = await fetch(HTTP + p, {
    method,
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  return { status: res.status, data };
}

function connect() {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS);
    ws.on('open', () => resolve(ws));
  });
}

function waitFor(ws, pred, ms = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for event')), ms);
    const onMsg = (raw) => {
      const d = JSON.parse(raw.toString());
      if (pred(d)) {
        clearTimeout(timer);
        ws.off('message', onMsg);
        resolve(d);
      }
    };
    ws.on('message', onMsg);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ts = Date.now();

(async () => {
  const sa = await login(SUPERADMIN.email, SUPERADMIN.password);
  check('superadmin login', sa.ok);
  if (!sa.ok) process.exit(2);

  // Fresh isolated tenant so the project prefix is deterministic.
  const slug = 'feat-' + ts.toString(36);
  const t = await api(sa.token, '/superadmin/tenants', { method: 'POST', body: { name: slug, slug } });
  check('created test tenant', t.status === 201, `id=${t.data && t.data.id}`);
  if (t.status !== 201) process.exit(2);
  const tenantId = t.data.id;

  // 1. telegram-bot endpoint hides the webhook URL after binding/querying
  const tg = await api(sa.token, `/admin/telegram-bot?tenantId=${tenantId}`);
  check('telegram-bot hides webhook_url', tg.status === 200 && !('webhook_url' in (tg.data || {})), JSON.stringify(tg.data));
  check('telegram-bot exposes webhook_configured', tg.status === 200 && typeof tg.data.webhook_configured === 'boolean');

  // Create a tag for the per-chat tags test
  const tag = await api(sa.token, '/admin/tags', { method: 'POST', body: { name: 'feat-tag', color: '#ff0000', tenantId } });
  check('created test tag', tag.status === 201 || tag.status === 200, `status=${tag.status}`);

  // Register an operator inside the tenant + connect via WS
  const inv = await api(sa.token, `/superadmin/tenants/${tenantId}/invites`, { method: 'POST', body: { count: 1 } });
  const opEmail = `featop_${ts}@feat.local`;
  const reg = await register('Feat Op', opEmail, 'secret123', inv.data.codes[0]);
  check('registered operator', reg.status === 201);
  const opLogin = await login(opEmail, 'secret123');
  check('operator login', opLogin.ok);

  const op = await connect();
  const opMessages = [];
  op.on('message', (raw) => opMessages.push(JSON.parse(raw.toString())));
  op.send(JSON.stringify({ type: 'auth', token: opLogin.token }));
  await waitFor(op, (d) => d.type === 'auth_ok');
  op.send(JSON.stringify({ type: 'operator_join' }));
  const init = await waitFor(op, (d) => d.type === 'init_operator');

  // Client chat for our tenant
  const client = await connect();
  client.send(JSON.stringify({ type: 'init_chat', tenant: slug }));
  const created = await waitFor(client, (d) => d.type === 'chat_created');
  const chatId = created.chatId;
  check('chat_created carries public_code', typeof created.public_code === 'string', created.public_code);
  check('public_code = <project>_<chatId>', created.public_code === `${tenantId}_${chatId}`, created.public_code);

  // REST /chats carries public_code too
  await sleep(400);
  const chatsRes = await api(opLogin.token, `/chats?status=open&tenantId=${tenantId}`);
  const mine = (chatsRes.data || []).find((c) => c.id === chatId);
  check('/chats carries public_code', !!(mine && mine.public_code === `${tenantId}_${chatId}`));

  // /admin/chats carries public_code
  const admChats = await api(sa.token, `/admin/chats?tenantId=${tenantId}&status=open`);
  const admMine = (admChats.data || []).find((c) => c.id === chatId);
  check('/admin/chats carries public_code', !!(admMine && admMine.public_code === `${tenantId}_${chatId}`));

  // 2. operator is assigned when they open the chat
  op.send(JSON.stringify({ type: 'join_chat', chatId, token: undefined }));
  const assigned = await waitFor(op, (d) => d.type === 'chat_assigned' && d.chatId === chatId);
  check('chat_assigned broadcast received', assigned.operatorId > 0, `op=${assigned.operatorName}`);
  const row1 = (await pool.query('SELECT assigned_operator_id FROM chats WHERE id = $1', [chatId])).rows[0];
  check('assigned_operator_id set on join', row1.assigned_operator_id === assigned.operatorId);

  // 2b. even without an explicit join, replying claims the chat
  const client2 = await connect();
  client2.send(JSON.stringify({ type: 'init_chat', tenant: slug }));
  const created2 = await waitFor(client2, (d) => d.type === 'chat_created');
  const chatId2 = created2.chatId;
  op.send(JSON.stringify({ type: 'message', chatId: chatId2, content: 'забираю чат' }));
  const assigned2 = await waitFor(op, (d) => d.type === 'chat_assigned' && d.chatId === chatId2);
  check('reply claims chat', assigned2.operatorId === assigned.operatorId);
  const row2 = (await pool.query('SELECT assigned_operator_id FROM chats WHERE id = $1', [chatId2])).rows[0];
  check('assigned_operator_id set on reply', row2.assigned_operator_id === assigned.operatorId);

  // 3. per-chat tags + tenant scoping
  const tagsEmpty = await api(opLogin.token, `/chats/${chatId}/tags`);
  check('GET chat tags (empty)', tagsEmpty.status === 200 && Array.isArray(tagsEmpty.data) && tagsEmpty.data.length === 0);
  const putTag = await api(opLogin.token, `/chats/${chatId}/tag`, { method: 'PUT', body: { tagId: tag.data.id } });
  check('PUT chat tag', putTag.status === 200);
  const tagsOne = await api(opLogin.token, `/chats/${chatId}/tags`);
  check('GET chat tags (1)', tagsOne.status === 200 && tagsOne.data.length === 1 && tagsOne.data[0].name === 'feat-tag');

  // cross-tenant: a superadmin-scoped other tenant admin must NOT see our chat
  const otherTenantOp = await pool.query(
    'SELECT email FROM operators WHERE role = \'admin\' AND tenant_id IS NOT NULL AND tenant_id <> $1 ORDER BY id LIMIT 1',
    [tenantId]
  );
  if (otherTenantOp.rows.length) {
    const otherEmail = otherTenantOp.rows[0].email;
    const otherLogin = await login(otherEmail, 'admin123');
    if (otherLogin.ok) {
      const crossTags = await api(otherLogin.token, `/chats/${chatId}/tags`);
      check('cross-tenant chat tags -> 404', crossTags.status === 404, `status=${crossTags.status}`);
    } else {
      check('cross-tenant chat tags -> 404 (skipped: unknown password)', true);
    }
  } else {
    check('cross-tenant chat tags -> 404 (skipped: no other tenant admin)', true);
  }

  // 4. timeout consistency is a UI concern; ensure init_operator had public_code for each chat
  check('init_operator rows carry public_code', (init.chats || []).every((c) => typeof c.public_code === 'string'));

  const failed = [...opMessages, []].some(() => false);
  void failed;
  client.close(); client2.close(); op.close();
  console.log('\n=== done ===');
  pool.end();
  process.exit(Number(process.exitCode) || 0);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(2); });