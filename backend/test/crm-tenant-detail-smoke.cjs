// CRM tenant drill-down smoke test (run against a live dev server, port 3000):
//  1. superadmin can scope /admin/* listings to a chosen tenantId
//  2. settings / tags are written to and read from the selected tenant only
//  3. telegram-bot endpoint requires tenantId for superadmin
//  4. a tenant admin cannot use tenantId to peek at another tenant (isolation)
const HTTP = 'http://localhost:3000';
const SUPERADMIN = { email: 'admin@test.com', password: 'admin123' };

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

async function api(token, path, { method = 'GET', body } = {}) {
  const res = await fetch(HTTP + path, {
    method,
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  return { status: res.status, data };
}

async function register(name, email, password, inviteCode) {
  const res = await fetch(HTTP + '/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, email, password, inviteCode }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, token: body.token };
}

const ts = Date.now();
const lease = async (saToken, slug) => {
  const c = await api(saToken, '/superadmin/tenants', { method: 'POST', body: { name: slug, slug } });
  return c.data.id;
};

(async () => {
  const sa = await login(SUPERADMIN.email, SUPERADMIN.password);
  check('superadmin login', sa.ok);
  if (!sa.ok) process.exit(2);

  // two isolated test tenants
  const slugA = 'detail-a-' + ts.toString(36);
  const slugB = 'detail-b-' + ts.toString(36);
  const A = await lease(sa.token, slugA);
  const B = await lease(sa.token, slugB);
  check('created tenant A and B', Number.isInteger(A) && Number.isInteger(B) && A !== B, `A=${A} B=${B}`);

  // seed one operator into each tenant
  const invA = await api(sa.token, `/superadmin/tenants/${A}/invites`, { method: 'POST', body: { count: 1 } });
  const invB = await api(sa.token, `/superadmin/tenants/${B}/invites`, { method: 'POST', body: { count: 1 } });
  const emailA = `opa_${ts}@detail.local`;
  const emailB = `opb_${ts}@detail.local`;
  const regA = await register('Op A', emailA, 'secret123', invA.data.codes[0]);
  const regB = await register('Op B', emailB, 'secret123', invB.data.codes[0]);
  check('registered operator in each tenant', regA.status === 201 && regB.status === 201);

  // 1. scoped listings
  const opsA = await api(sa.token, `/admin/operators?tenantId=${A}`);
  check('scoped operators A returns only A', opsA.status === 200 && opsA.data.length === 1 && opsA.data[0].email === emailA, `n=${opsA.data.length}`);
  const opsB = await api(sa.token, `/admin/operators?tenantId=${B}`);
  check('scoped operators B returns only B', opsB.status === 200 && opsB.data.length === 1 && opsB.data[0].email === emailB, `n=${opsB.data.length}`);
  const opsAll = await api(sa.token, '/admin/operators');
  check('unscoped operators still returns everything', opsAll.status === 200 && opsAll.data.length >= 2, `n=${opsAll.data.length}`);
  check('operators rows carry tenant_id', opsA.data.every((o) => o.tenant_id === A));

  // 2. settings isolated per tenant
  const marker = 'welcome-detail-' + ts;
  const setA = await api(sa.token, '/admin/settings', { method: 'PUT', body: { tenantId: A, chat_timeout_minutes: '11', welcome_message: marker } });
  check('superadmin saves settings for A', setA.status === 200);
  const getA = await api(sa.token, `/admin/settings?tenantId=${A}`);
  check('settings A reflect marker', getA.status === 200 && getA.data.welcome_message === marker, JSON.stringify(getA.data));
  const getA2 = await api(sa.token, `/admin/settings?tenantId=${B}`);
  check('settings B do not leak A marker', getA2.status === 200 && getA2.data.welcome_message !== marker, `b="${getA2.data.welcome_message}"`);
  const noT = await api(sa.token, '/admin/settings');
  check('settings without tenantId rejected for superadmin', noT.status === 400, `status=${noT.status}`);

  // 3. tags isolated per tenant
  const tagName = 'tag-detail-' + ts;
  const mkTag = await api(sa.token, '/admin/tags', { method: 'POST', body: { name: tagName, tenantId: A } });
  check('superadmin creates tag in A', mkTag.status === 201, `status=${mkTag.status}`);
  const tagsA = await api(sa.token, `/admin/tags?tenantId=${A}`);
  check('tags A contain new tag', tagsA.status === 200 && tagsA.data.some((t) => t.name === tagName));
  const tagsB = await api(sa.token, `/admin/tags?tenantId=${B}`);
  check('tags B do not contain A tag', tagsB.status === 200 && !tagsB.data.some((t) => t.name === tagName));
  const tagsNoT = await api(sa.token, '/admin/tags');
  check('tags without tenantId returns all (row has tenant_id)', tagsNoT.status === 200 && tagsNoT.data.every((t) => 'tenant_id' in t));

  // 4. operator-stats + chats scoped
  const statsA = await api(sa.token, `/admin/operator-stats?tenantId=${A}`);
  check('operator-stats A scoped', statsA.status === 200 && statsA.data.length === 1 && statsA.data[0].email === emailA, `n=${statsA.data.length}`);
  const chatsA = await api(sa.token, `/admin/chats?tenantId=${A}&limit=100`);
  check('chats A scoped (array)', chatsA.status === 200 && Array.isArray(chatsA.data));

  // 5. telegram-bot requires tenantId for superadmin
  const botA = await api(sa.token, `/admin/telegram-bot?tenantId=${A}`);
  check('telegram-bot scoped returns empty bot', botA.status === 200 && botA.data.bot === null, `status=${botA.status}`);
  const botNoT = await api(sa.token, '/admin/telegram-bot');
  check('telegram-bot without tenantId rejected', botNoT.status === 400, `status=${botNoT.status}`);

  // 6. isolation: a tenant admin cannot peek at tenant B via tenantId
  const opIdA = opsA.data[0].id;
  const promote = await api(sa.token, `/admin/operators/${opIdA}/role`, { method: 'PUT', body: { role: 'admin' } });
  check('promote A operator to admin', promote.status === 200);
  const adminA = await login(emailA, 'secret123');
  check('tenant A admin login', adminA.ok);
  const peek = await api(adminA.token, `/admin/operators?tenantId=${B}`);
  check('tenant A admin cannot peek tenant B operators', peek.status === 200 && peek.data.length === 1 && peek.data[0].tenant_id === A, `n=${peek.data.length}`);
  const peekSettings = await api(adminA.token, `/admin/settings?tenantId=${B}`);
  check('tenant A admin settings ignore tenantId (gets own)', peekSettings.status === 200 && peekSettings.data.welcome_message === marker, JSON.stringify(peekSettings.data));
  const peekTags = await api(adminA.token, `/admin/tags?tenantId=${B}`);
  check('tenant A admin tags ignore tenantId', peekTags.status === 200 && peekTags.data.every((t) => t.tenant_id === A));

  // 7. cleanup: delete both test tenants (also exercises cascade deletion)
  const delA = await api(sa.token, `/superadmin/tenants/${A}`, { method: 'DELETE' });
  check('delete tenant A', delA.status === 200 && delA.data.ok === true, `status=${delA.status}`);
  const delB = await api(sa.token, `/superadmin/tenants/${B}`, { method: 'DELETE' });
  check('delete tenant B', delB.status === 200 && delB.data.ok === true, `status=${delB.status}`);
  const tagsGone = await api(sa.token, `/admin/tags?tenantId=${A}`);
  check('tenant A tags removed with it', tagsGone.status === 200 && tagsGone.data.length === 0, `n=${tagsGone.data.length}`);

  const failed = process.exitCode ? 1 : 0;
  console.log(`\n=== done (${failed ? 'FAILURES' : 'all passed'}) ===`);
  process.exit(failed);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(2); });
