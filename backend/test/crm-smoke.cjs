// CRM owner flow smoke test (run against a live dev server, port 3000):
//  1. superadmin dashboard metrics
//  2. create tenant → set operator_limit → issue invites
//  3. tenant admin is constrained by the seat quota
//  4. tenant admin cannot access /superadmin/* (role separation)
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
  const body = await res.json();
  return { ok: res.status === 200, token: body.token };
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const sa = await login(SUPERADMIN.email, SUPERADMIN.password);
  check('superadmin login', sa.ok);
  if (!sa.ok) process.exit(2);

  // 1. dashboard metrics
  const dash = await api(sa.token, '/superadmin/dashboard');
  check('dashboard has totals', dash.status === 200 && typeof dash.data.tenants === 'number' && dash.data.tenants >= 1);
  check('dashboard has 7-day series', Array.isArray(dash.data.daily) && dash.data.daily.length === 7, `days=${dash.data.daily.length}`);

  // 2. create a fresh tenant
  const slug = 'crm-test-' + Date.now().toString(36);
  const created = await api(sa.token, '/superadmin/tenants', { method: 'POST', body: { name: 'CRM Test', slug } });
  check('create tenant', created.status === 201 && created.data.id > 0, `slug=${slug}`);
  const tenantId = created.data.id;

  const updatedName = await api(sa.token, `/superadmin/tenants/${tenantId}`, { method: 'PUT', body: { name: 'CRM Test Renamed', operator_limit: 2 } });
  check('update tenant name+limit', updatedName.status === 200 && updatedName.data.name === 'CRM Test Renamed' && updatedName.data.operator_limit === 2);

  // 3. owner issues 1 invite code
  const issued = await api(sa.token, `/superadmin/tenants/${tenantId}/invites`, { method: 'POST', body: { count: 1 } });
  check('issue invite codes', issued.status === 201 && Array.isArray(issued.data.codes) && issued.data.codes.length === 1);
  const inviteCode = issued.data.codes[0];

  // 4. register a tenant admin for it, promote to admin
  const email = `admin_${Date.now()}@crmtest.local`;
  const reg = await fetch(HTTP + '/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'CRM Admin', email, password: 'secret123', inviteCode }),
  });
  const regBody = await reg.json();
  check('register via issued invite binds to the tenant', reg.status === 201 && !!regBody.token);
  const opToken = regBody.token;

  // figure out operator id (needs admin listing; register returns no id, use /admin/operators as superadmin, find by email)
  const ops = await api(sa.token, '/admin/operators');
  const opRow = ops.data.find((o) => o.email === email);
  check('found registered operator', !!opRow);
  const opId = opRow.id;

  const roleRes = await api(sa.token, `/admin/operators/${opId}/role`, { method: 'PUT', body: { role: 'admin' } });
  check('promote to tenant admin', roleRes.status === 200);

  // fresh token picks up new role
  const adminLogin = await login(email, 'secret123');
  check('tenant admin can login after promotion', adminLogin.ok);
  const taToken = adminLogin.token;

  // 5. role separation: tenant admin is blocked from superadmin routes
  const forbidden = await api(taToken, '/superadmin/tenants');
  check('tenant admin blocked from /superadmin/tenants', forbidden.status === 403, `status=${forbidden.status}`);

  // 6. seat quota: tenant admin can create 1 more invite (operator=1, issued invite now used → pending=0)
  //    limit=2 → seats used = operators(1) + pending(0) = 1, room for 1 more
  const inv1 = await api(taToken, '/admin/invite-codes', { method: 'POST', body: {} });
  check('tenant admin creates invite within quota', inv1.status === 201, `status=${inv1.status}`);

  // now seats used = 1 operator + 1 pending = 2 = limit → next must fail
  const inv2 = await api(taToken, '/admin/invite-codes', { method: 'POST', body: {} });
  check('tenant admin blocked at quota', inv2.status === 400, `expected 400 got ${inv2.status} (${inv2.data?.error})`);

  // owner issuing beyond limit is also blocked
  const over = await api(sa.token, `/superadmin/tenants/${tenantId}/invites`, { method: 'POST', body: { count: 1 } });
  check('owner blocked from over-issuing', over.status === 400, `expected 400 got ${over.status}`);

  // raise the limit → owner can issue again
  const up = await api(sa.token, `/superadmin/tenants/${tenantId}`, { method: 'PUT', body: { operator_limit: 5 } });
  check('raise limit to 5', up.status === 200 && up.data.operator_limit === 5);
  const issue2 = await api(sa.token, `/superadmin/tenants/${tenantId}/invites`, { method: 'POST', body: { count: 3 } });
  check('issue 3 more after raising limit', issue2.status === 201 && issue2.data.codes.length === 3);

  // 7. suspend / reactivate
  const susp = await api(sa.token, `/superadmin/tenants/${tenantId}/status`, { method: 'PUT', body: { status: 'suspended' } });
  check('suspend tenant', susp.status === 200 && susp.data.status === 'suspended');
  const act = await api(sa.token, `/superadmin/tenants/${tenantId}/status`, { method: 'PUT', body: { status: 'active' } });
  check('reactivate tenant', act.status === 200 && act.data.status === 'active');
  const restored = await api(taToken, '/admin/invite-codes');
  check('operator access restored after reactivation', restored.status === 200, `status=${restored.status}`);

  // 8. tenant list has the new metrics columns
  const list = await api(sa.token, '/superadmin/tenants');
  const mine = list.data.find((t) => t.id === tenantId);
  check(
    'tenant metrics present',
    mine && typeof mine.operators_count === 'number' && typeof mine.invites_used === 'number' && mine.operator_limit === 5,
    `operators=${mine?.operators_count} invites_used=${mine?.invites_used}`
  );

  // 7. delete tenant: only superadmin may, and it removes the tenant + its rows
  const delForbidden = await api(taToken, `/superadmin/tenants/${tenantId}`, { method: 'DELETE' });
  check('tenant admin blocked from deleting tenant', delForbidden.status === 403, `status=${delForbidden.status}`);
  const del = await api(sa.token, `/superadmin/tenants/${tenantId}`, { method: 'DELETE' });
  check('superadmin deletes tenant', del.status === 200 && del.data.ok === true, `status=${del.status}`);
  const delAgain = await api(sa.token, `/superadmin/tenants/${tenantId}`, { method: 'DELETE' });
  check('deleting a missing tenant -> 404', delAgain.status === 404, `status=${delAgain.status}`);
  const listAfter = await api(sa.token, '/superadmin/tenants');
  check('deleted tenant gone from list', !listAfter.data.some((t) => t.id === tenantId));
  const opsAfter = await api(sa.token, '/admin/operators');
  check('deleted tenant operators removed', !opsAfter.data.some((o) => o.email === email));

  const failed = process.exitCode ? 1 : 0;
  console.log(`\n=== done (${failed ? 'FAILURES' : 'all passed'}) ===`);
  process.exit(failed);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(2); });