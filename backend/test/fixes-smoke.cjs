// Smoke test for the bug-fix batch (run against a live dev server, port 3000):
//  1. operator deletion no longer fails on FK-bound chats/invites
//  2. superadmin can delete a tenant admin from the CRM
//  3. tag names are capped at 30 chars and tags can be edited (PUT)
//  4. date filters are inclusive of the whole "to" day (end-of-day)
//  5. validation rejects garbage across the main input points
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { Pool } = require('pg');

const HTTP = 'http://localhost:3000';
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
  return { ok: res.status === 200, token: body.token, status: res.status };
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

async function register(name, email, password, inviteCode) {
  const res = await fetch(HTTP + '/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, email, password, inviteCode }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, data: body };
}

const ts = Date.now();

(async () => {
  const sa = await login(SUPERADMIN.email, SUPERADMIN.password);
  check('superadmin login', sa.ok);
  if (!sa.ok) process.exit(2);
  const token = sa.token;

  // ---------------------------------------------------------------------
  // 1. Operator deletion with FK-bound chats + invites
  // ---------------------------------------------------------------------
  const slug = 'fix-' + ts.toString(36);
  const t = await api(token, '/superadmin/tenants', { method: 'POST', body: { name: slug, slug } });
  check('created test tenant', t.status === 201, `id=${t.data && t.data.id}`);
  const tenantId = t.data.id;

  const inv = await api(token, `/superadmin/tenants/${tenantId}/invites`, { method: 'POST', body: { count: 1 } });
  const opEmail = `fixop_${ts}@fix.local`;
  const reg = await register('Fix Op', opEmail, 'secret123', inv.data.codes[0]);
  check('registered operator', reg.status === 201);
  const opId = (await pool.query('SELECT id, tenant_id FROM operators WHERE email = $1', [opEmail])).rows[0].id;

  const chat = await pool.query(
    "INSERT INTO chats (tenant_id, client_id, client_name, status, assigned_operator_id) VALUES ($1, $2, 'Fix Client', 'open', $3) RETURNING id",
    [tenantId, Number(String(ts).slice(-9)), opId]
  );
  const chatId = chat.rows[0].id;
  await pool.query(
    'UPDATE invite_codes SET used_by = $1 WHERE code = $2',
    [opId, inv.data.codes[0]]
  );

  // Pre-fix this returned 500 (FK violation). Now it must succeed.
  const del = await api(token, `/admin/operators/${opId}`, { method: 'DELETE' });
  check('delete operator with chats/invites -> 200', del.status === 200, `status=${del.status}`);

  const gone = await pool.query('SELECT id FROM operators WHERE id = $1', [opId]);
  check('operator row removed', gone.rows.length === 0);

  const detached = await pool.query('SELECT assigned_operator_id FROM chats WHERE id = $1', [chatId]);
  check('chat assignment detached (NULL)', detached.rows[0].assigned_operator_id === null);

  const inviteKept = await pool.query('SELECT used_by FROM invite_codes WHERE code = $1', [inv.data.codes[0]]);
  check('invite row kept, used_by detached', inviteKept.rows.length === 1 && inviteKept.rows[0].used_by === null);

  // ---------------------------------------------------------------------
  // 2. Superadmin deletes a tenant admin
  // ---------------------------------------------------------------------
  const inv2 = await api(token, `/superadmin/tenants/${tenantId}/invites`, { method: 'POST', body: { count: 1 } });
  const adminEmail = `fixadmin_${ts}@fix.local`;
  await register('Fix Admin', adminEmail, 'secret123', inv2.data.codes[0]);
  const adminId = (await pool.query('SELECT id FROM operators WHERE email = $1', [adminEmail])).rows[0].id;
  await api(token, `/admin/operators/${adminId}/role`, { method: 'PUT', body: { role: 'admin', tenantId } });
  const roleRow = await pool.query('SELECT role FROM operators WHERE id = $1', [adminId]);
  check('promoted to tenant admin', roleRow.rows[0].role === 'admin');

  const delAdmin = await api(token, `/admin/operators/${adminId}`, { method: 'DELETE' });
  check('superadmin deletes tenant admin -> 200', delAdmin.status === 200, `status=${delAdmin.status}`);
  const adminGone = await pool.query('SELECT id FROM operators WHERE id = $1', [adminId]);
  check('tenant admin row removed', adminGone.rows.length === 0);

  // ---------------------------------------------------------------------
  // 2b. Tenant admin deleting operators ("в админке")
  // ---------------------------------------------------------------------
  const invA = await api(token, `/superadmin/tenants/${tenantId}/invites`, { method: 'POST', body: { count: 2 } });
  const taEmail = `fix.ta_${ts}@fix.local`;
  await register('Ta Admin', taEmail, 'secret123', invA.data.codes[0]);
  const taId = (await pool.query('SELECT id FROM operators WHERE email = $1', [taEmail])).rows[0].id;
  await api(token, `/admin/operators/${taId}/role`, { method: 'PUT', body: { role: 'admin', tenantId } });
  const taLogin = await login(taEmail, 'secret123');
  check('tenant admin can log in', taLogin.ok);

  const opEmail2 = `fix.op2_${ts}@fix.local`;
  await register('Op Two', opEmail2, 'secret123', invA.data.codes[1]);
  const op2Id = (await pool.query('SELECT id FROM operators WHERE email = $1', [opEmail2])).rows[0].id;
  const taDelOp = await api(taLogin.token, `/admin/operators/${op2Id}`, { method: 'DELETE' });
  check('tenant admin deletes own operator -> 200', taDelOp.status === 200, `status=${taDelOp.status}`);

  // A second admin: the tenant admin must NOT be able to remove it.
  const invB = await api(token, `/superadmin/tenants/${tenantId}/invites`, { method: 'POST', body: { count: 1 } });
  const ta2Email = `fix.ta2_${ts}@fix.local`;
  await register('Ta Two', ta2Email, 'secret123', invB.data.codes[0]);
  const ta2Id = (await pool.query('SELECT id FROM operators WHERE email = $1', [ta2Email])).rows[0].id;
  await api(token, `/admin/operators/${ta2Id}/role`, { method: 'PUT', body: { role: 'admin', tenantId } });
  const taDelAdmin = await api(taLogin.token, `/admin/operators/${ta2Id}`, { method: 'DELETE' });
  check('tenant admin cannot delete another admin -> 400', taDelAdmin.status === 400, `status=${taDelAdmin.status}`);
  const ta2Still = await pool.query('SELECT id FROM operators WHERE id = $1', [ta2Id]);
  check('other admin still present', ta2Still.rows.length === 1);

  // ---------------------------------------------------------------------
  // 3. Tag length cap + edit
  // ---------------------------------------------------------------------
  const longName = 'x'.repeat(31);
  const tooLong = await api(token, '/admin/tags', { method: 'POST', body: { name: longName, tenantId } });
  check('tag name > 30 chars -> 400', tooLong.status === 400, `status=${tooLong.status}`);

  const okName = 'y'.repeat(30);
  const made = await api(token, '/admin/tags', { method: 'POST', body: { name: okName, color: '#112233', tenantId } });
  check('tag name == 30 chars -> 201', made.status === 201, `status=${made.status}`);
  const tagId = made.data && made.data.id;

  const edited = await api(token, `/admin/tags/${tagId}`, { method: 'PUT', body: { name: 'edited-tag', color: '#445566' } });
  check('edit tag -> 200', edited.status === 200 && edited.data.name === 'edited-tag', `status=${edited.status}`);

  const editTooLong = await api(token, `/admin/tags/${tagId}`, { method: 'PUT', body: { name: longName, color: '#445566' } });
  check('edit tag to > 30 chars -> 400', editTooLong.status === 400, `status=${editTooLong.status}`);

  const badColor = await api(token, '/admin/tags', { method: 'POST', body: { name: 'color-test', color: 'blue', tenantId } });
  check('tag with bad colour -> 400', badColor.status === 400, `status=${badColor.status}`);

  // ---------------------------------------------------------------------
  // 4. Date filter inclusive of the whole "to" day
  // ---------------------------------------------------------------------
  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  // created_at defaults to CURRENT_TIMESTAMP (today). Pre-fix the same-day
  // filter dropped it because `<= 'YYYY-MM-DD'` means midnight.
  const sameDay = await api(token, `/admin/chats?tenantId=${tenantId}&from=${todayStr}&to=${todayStr}`);
  check('same-day date filter returns today\'s chat', Array.isArray(sameDay.data) && sameDay.data.some((c) => c.id === chatId), `count=${sameDay.data && sameDay.data.length}`);

  // ---------------------------------------------------------------------
  // 5. Validation across input points
  // ---------------------------------------------------------------------
  const loginNoEmail = await fetch(HTTP + '/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'x' }),
  });
  check('login without email -> 400', loginNoEmail.status === 400, `status=${loginNoEmail.status}`);

  const badReg = await register('A', 'not-an-email', 'secret123', 'ABCDEF123456');
  check('register with bad email -> 400', badReg.status === 400, `status=${badReg.status}`);

  const shortPass = await register('Valid Name', `v_${ts}@fix.local`, '123', 'ABCDEF123456');
  check('register with short password -> 400', shortPass.status === 400, `status=${shortPass.status}`);

  const badTag = await api(token, '/admin/tags', { method: 'POST', body: { name: '', tenantId } });
  check('empty tag name -> 400', badTag.status === 400, `status=${badTag.status}`);

  const badSettings = await api(token, '/admin/settings', { method: 'PUT', body: { tenantId, chat_timeout_minutes: 0, welcome_message: 'x' } });
  check('settings timeout 0 -> 400', badSettings.status === 400, `status=${badSettings.status}`);

  const badCanned = await api(token, '/canned-responses', { method: 'POST', body: { shortcut: 'bad shortcut!', title: 'T', content: 'C' } });
  check('canned bad shortcut -> 400', badCanned.status === 400, `status=${badCanned.status}`);

  const badSlugTenant = await api(token, '/superadmin/tenants', { method: 'POST', body: { name: 'Bad Slug', slug: 'Bad Slug!' } });
  check('tenant with bad slug -> 400', badSlugTenant.status === 400, `status=${badSlugTenant.status}`);

  // ---------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------
  const cleanup = await api(token, `/superadmin/tenants/${tenantId}`, { method: 'DELETE' });
  check('cleanup: delete test tenant', cleanup.status === 200, `status=${cleanup.status}`);

  await pool.end();
  console.log('\n=== fixes smoke done ===');
})().catch(async (e) => {
  console.error('UNEXPECTED:', e);
  try { await pool.end(); } catch { /* ignore */ }
  process.exit(1);
});
