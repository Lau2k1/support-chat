const { WebSocket } = require('ws');

const HTTP = 'http://localhost:3000';
const WS = 'ws://localhost:3000';

const SUPERADMIN = { email: 'admin@test.com', password: 'admin123' };
const TENANT_ADMIN = { email: 'tenant@admin.ru', password: 'tenant1234' };
const TENANT_SLUG = 'default';

function connect() {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS);
    ws.on('open', () => resolve(ws));
  });
}

function waitFor(ws, pred, ms = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for ' + JSON.stringify(pred))), ms);
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

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function login(email, password) {
  const res = await fetch(HTTP + '/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  return { ok: res.status === 200, token: body.token };
}

const results = [];
function check(name, ok, extra = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? ' — ' + extra : ''}`);
}

(async () => {
  // 1. tenant admin login (operator of the default tenant)
  const ta = await login(TENANT_ADMIN.email, TENANT_ADMIN.password);
  check('tenant admin login', ta.ok);

  // 1b. superadmin login for tenant management
  const sa = await login(SUPERADMIN.email, SUPERADMIN.password);
  check('superadmin login', sa.ok);

  // 2. operator WS auth + join
  const op = await connect();
  op.send(JSON.stringify({ type: 'auth', token: ta.token }));
  await waitFor(op, (d) => d.type === 'auth_ok');
  op.send(JSON.stringify({ type: 'operator_join' }));
  op.send(JSON.stringify({ type: 'operator_status', status: 'online' }));
  await waitFor(op, (d) => d.type === 'init_operator');
  const opMessages = [];
  op.on('message', (raw) => opMessages.push(JSON.parse(raw.toString())));
  check('operator WS auth+join', true);

  // 3. widget creates a chat for its tenant
  const client = await connect();
  client.send(JSON.stringify({ type: 'init_chat', tenant: TENANT_SLUG }));
  const created = await waitFor(client, (d) => d.type === 'chat_created');
  const chatId = created.chatId;
  check('chat created with token', !!(created.token && chatId > 0), `chatId=${chatId}`);

  // 3b. unknown tenant -> chat_error, no chat created
  const badTenant = await connect();
  badTenant.send(JSON.stringify({ type: 'init_chat', tenant: 'no-such-tenant' }));
  const badTenantResp = await waitFor(badTenant, (d) => d.type === 'chat_error' || d.type === 'operators_offline');
  check('unknown tenant rejected', badTenantResp.type === 'chat_error');

  // operator joins the chat room (as the UI does when opening a chat)
  op.send(JSON.stringify({ type: 'join_chat', chatId, token: undefined }));

  // 4. client sends message
  client.send(JSON.stringify({ type: 'message', chatId, content: 'привет, это тест' }));
  const echo = await waitFor(client, (d) => d.type === 'message' && d.message.sender_id === 0);
  check('client message broadcast', echo.message.chat_id === chatId);

  // 5. attacker with wrong token cannot join
  const bad = await connect();
  bad.send(JSON.stringify({ type: 'join_chat', chatId, token: 'wrong-token' }));
  const err = await waitFor(bad, (d) => d.type === 'chat_error' || d.type === 'chat_closed');
  check('wrong token rejected', err.type === 'chat_error');

  // 6. correct token can join (no error within 600ms)
  const okWs = await connect();
  okWs.send(JSON.stringify({ type: 'join_chat', chatId, token: created.token }));
  let badResp = null;
  const hidden = new Promise((r) => {
    okWs.once('message', (raw) => r(JSON.parse(raw.toString())));
    setTimeout(() => r(null), 600);
  });
  badResp = await hidden;
  check('correct token accepted (no chat_error)', badResp === null || !['chat_error', 'chat_closed'].includes(badResp.type));

  // 7. REST messages with client token -> no notes visible
  const msgs = await fetch(`${HTTP}/messages/${chatId}?token=${encodeURIComponent(created.token)}`);
  const msgsBody = await msgs.json();
  const notes = msgsBody.filter((m) => m.message_type === 'note').length;
  check('REST messages via client token', msgs.status === 200 && notes === 0 && msgsBody.length >= 1);

  // 8. REST messages without token -> 401
  const noTok = await fetch(`${HTTP}/messages/${chatId}`);
  check('REST messages without token -> 401', noTok.status === 401);

  // 9. upload without auth -> 401
  const fd1 = new FormData();
  fd1.append('file', new Blob(['hello'], { type: 'text/plain' }), 'a.txt');
  const upNoAuth = await fetch(`${HTTP}/upload/${chatId}`, { method: 'POST', body: fd1 });
  check('upload without auth -> 401', upNoAuth.status === 401);

  // 10. upload with client token -> 200
  const fd2 = new FormData();
  fd2.append('file', new Blob(['hello'], { type: 'text/plain' }), 'b.txt');
  const upOk = await fetch(`${HTTP}/upload/${chatId}`, {
    method: 'POST',
    headers: { 'X-Client-Token': created.token },
    body: fd2,
  });
  check('upload with client token OK', upOk.status === 200, `status=${upOk.status}`);

  // 10b. the REST upload must broadcast the stored message into the room
  await sleep(300);
  const gotFile = opMessages.some(
    (d) => d.type === 'message' && d.message.chat_id === chatId && !!d.message.file_url
  );
  check('operator got uploaded file broadcast', gotFile);

  // 11. operator received message + new_chat
  await sleep(500);
  const gotMsg = opMessages.some((d) => d.type === 'message' && d.message.chat_id === chatId);
  const gotNew = opMessages.some((d) => d.type === 'new_chat' && d.chatId === chatId);
  check('operator got new_chat + message', gotNew && gotMsg);

  // 12. tenant admin sees its own chats via /chats (tenant-scoped)
  const chatsRes = await fetch(HTTP + '/chats?status=open', {
    headers: { Authorization: 'Bearer ' + ta.token },
  });
  const chatsBody = await chatsRes.json();
  check('tenant admin /chats scoped', chatsRes.status === 200 && chatsBody.some((c) => c.id === chatId));

  // 13. tenant admin can use tenant admin routes
  const adm = await fetch(HTTP + '/admin/operators', {
    headers: { Authorization: 'Bearer ' + ta.token },
  });
  const admOps = await adm.json();
  check('tenant admin /admin/operators OK', adm.status === 200 && admOps.length >= 1);

  // 14. tenant admin CANNOT use superadmin routes -> 403
  const deniedT = await fetch(HTTP + '/superadmin/tenants', {
    headers: { Authorization: 'Bearer ' + ta.token },
  });
  check('tenant admin blocked from /superadmin/tenants', deniedT.status === 403, `status=${deniedT.status}`);

  // 15. superadmin sees tenants
  const tenantsRes = await fetch(HTTP + '/superadmin/tenants', {
    headers: { Authorization: 'Bearer ' + sa.token },
  });
  const tenantsBody = await tenantsRes.json();
  check(
    'superadmin /superadmin/tenants OK',
    tenantsRes.status === 200 && tenantsBody.some((t) => t.slug === TENANT_SLUG),
    `tenants=${tenantsBody.length}`
  );

  // 16. superadmin sees the tenant-scoped chat (global bypass)
  const saChats = await fetch(HTTP + '/chats?status=open', {
    headers: { Authorization: 'Bearer ' + sa.token },
  });
  const saChatsBody = await saChats.json();
  check('superadmin sees all open chats', saChats.status === 200 && saChatsBody.some((c) => c.id === chatId));

  client.close(); bad.close(); okWs.close(); badTenant.close(); op.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} passed ===`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(2); });