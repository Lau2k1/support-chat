// Smoke test for the self-service password change (POST /me/password):
//   1. wrong current password -> 401
//   2. weak new password -> 400
//   3. new == current -> 400
//   4. success -> 200 + fresh token
//   5. old token invalidated, new token still valid (other sessions logged out)
//   6. login works with the new password and fails with the old one
// Run against a live dev server on :3000.
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
  return { ok: res.status === 200, status: res.status, token: body.token };
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

(async () => {
  const sa = await login(SUPERADMIN.email, SUPERADMIN.password);
  check('superadmin login', sa.ok);
  if (!sa.ok) process.exit(2);

  const ts = Date.now();
  const slug = 'pwsmoke-' + ts;
  const tenant = await api(sa.token, '/superadmin/tenants', { method: 'POST', body: { name: 'PW Smoke', slug } });
  const tenantId = tenant.data && tenant.data.id;
  check('created test tenant', !!tenantId, `id=${tenantId}`);

  const inv = await api(sa.token, `/superadmin/tenants/${tenantId}/invites`, { method: 'POST', body: { count: 1 } });
  const code = inv.data && inv.data.codes && inv.data.codes[0];
  const email = `pwsmoke_${ts}@pw.local`;

  const reg = await fetch(HTTP + '/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'PW Smoke', email, password: 'goodPass11', inviteCode: code }),
  });
  check('registered operator', reg.status === 201, `status=${reg.status}`);

  const op = await login(email, 'goodPass11');
  check('operator login', op.ok);

  // 1. wrong current password
  const wrong = await api(op.token, '/me/password', { method: 'POST', body: { currentPassword: 'wrong-pass', newPassword: 'newSecret9' } });
  check('wrong current password -> 401', wrong.status === 401, `status=${wrong.status}`);

  // 2. weak new password
  const weak = await api(op.token, '/me/password', { method: 'POST', body: { currentPassword: 'goodPass11', newPassword: 'admin123' } });
  check('weak new password -> 400', weak.status === 400, `status=${weak.status}`);

  // 3. new equals current
  const same = await api(op.token, '/me/password', { method: 'POST', body: { currentPassword: 'goodPass11', newPassword: 'goodPass11' } });
  check('new == current -> 400', same.status === 400, `status=${same.status}`);

  // 4. success
  const okChange = await api(op.token, '/me/password', { method: 'POST', body: { currentPassword: 'goodPass11', newPassword: 'newSecret9' } });
  const newToken = okChange.data && okChange.data.token;
  check('change password -> 200 + token', okChange.status === 200 && !!newToken, `status=${okChange.status}`);

  // 5. old session invalidated, new session valid
  const oldMe = await api(op.token, '/me');
  const newMe = await api(newToken, '/me');
  check('old token invalidated -> 401', oldMe.status === 401, `status=${oldMe.status}`);
  check('new token valid -> 200', newMe.status === 200, `status=${newMe.status}`);

  // 6. login with new password / old password
  const newLogin = await login(email, 'newSecret9');
  const oldLogin = await login(email, 'goodPass11');
  check('login with new password -> 200', newLogin.status === 200, `status=${newLogin.status}`);
  check('login with old password -> 401', oldLogin.status === 401, `status=${oldLogin.status}`);

  // cleanup
  const del = await api(sa.token, `/superadmin/tenants/${tenantId}`, { method: 'DELETE' });
  check('cleanup: delete test tenant', del.status === 200, `status=${del.status}`);
})();
