/* eslint-disable */
/**
 * Admin + recruiter-flow verification. Uses the seeded admin account.
 *   node scripts/verify-admin.js [baseUrl]
 */
const BASE = process.argv[2] || 'http://localhost:3001/api/v1';

let pass = 0,
  fail = 0;
const failures = [];

function log(ok, name, detail) {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    failures.push(`${name} :: ${detail || ''}`);
    console.log(`  FAIL  ${name}  ${detail || ''}`);
  }
}

async function req(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await res.text();
  let j = null;
  try {
    j = JSON.parse(t);
  } catch {}
  return { status: res.status, json: j, text: t };
}
const data = (r) => (r.json && r.json.data !== undefined ? r.json.data : r.json);

(async () => {
  console.log(`\n=== EchoGPT admin verification @ ${BASE} ===\n`);

  console.log('[1] Seeded admin login');
  const login = await req('POST', '/auth/login', {
    body: { email: 'admin@echogpt.app', password: 'ChangeMe123!' },
  });
  log(login.status === 200, 'POST /auth/login (admin@echogpt.app)', `status=${login.status} ${login.text.slice(0, 150)}`);
  const d = data(login) || {};
  const token = d.accessToken || (d.tokens && d.tokens.accessToken);

  console.log('\n[2] Seeded demo login');
  const demo = await req('POST', '/auth/login', {
    body: { email: 'demo@echogpt.app', password: 'DemoUser123!' },
  });
  log(demo.status === 200, 'POST /auth/login (demo@echogpt.app)', `status=${demo.status}`);

  console.log('\n[3] Admin panel endpoints');
  const adminGets = [
    '/admin/dashboard',
    '/admin/stats',
    '/admin/users',
    '/admin/subscriptions',
    '/admin/providers',
    '/admin/usage-analytics',
    '/admin/usage',
    '/admin/logs',
    '/admin/system-health',
  ];
  for (const p of adminGets) {
    const r = await req('GET', p, { token });
    log(r.status === 200, `GET ${p}`, `status=${r.status} ${r.text.slice(0, 120)}`);
  }

  console.log('\n[4] Admin per-user views');
  const users = await req('GET', '/admin/users', { token });
  // Paginated admin endpoints return { data: { data: [...], meta: {...} } }
  const ud = data(users) || {};
  const list = Array.isArray(ud) ? ud : ud.data;
  const firstUser = Array.isArray(list) ? list[0] : null;
  if (firstUser && firstUser.id) {
    const uid = firstUser.id;
    for (const p of [`/admin/users/${uid}`, `/admin/subscriptions/${uid}`, `/admin/users/${uid}/providers`]) {
      const r = await req('GET', p, { token });
      log(r.status === 200, `GET ${p}`, `status=${r.status} ${r.text.slice(0, 120)}`);
    }
    const rolePatch = await req('PATCH', `/admin/users/${uid}/role`, { token, body: { role: 'USER' } });
    log([200, 201].includes(rolePatch.status), `PATCH /admin/users/${uid}/role`, `status=${rolePatch.status}`);

    const subPatch = await req('PATCH', `/admin/subscriptions/${uid}`, {
      token,
      body: { plan: 'PREMIUM' },
    });
    log([200, 201].includes(subPatch.status), `PATCH /admin/subscriptions/${uid}`, `status=${subPatch.status} ${subPatch.text.slice(0, 120)}`);
  } else {
    log(false, 'admin per-user views', 'no users returned to test against');
  }

  console.log('\n[5] Seeded admin provider (real key) health + chat');
  const provs = await req('GET', '/providers', { token });
  const pd = data(provs) || {};
  const plist = Array.isArray(pd) ? pd : pd.data;
  const gem = (Array.isArray(plist) ? plist : []).find((p) => p.name === 'GEMINI');
  if (gem) {
    log(true, 'seeded GEMINI provider present');
    const hc = await req('POST', `/providers/${gem.id}/health-check`, { token });
    const hcd = data(hc);
    log(hcd && hcd.healthy === true, 'POST /providers/:id/health-check (seeded key)', JSON.stringify(hcd).slice(0, 200));

    const chat = await req('POST', '/chat/messages', {
      token,
      body: { content: 'In one short sentence, what is a REST API?' },
    });
    const cbody = JSON.stringify(chat.json || {});
    log(chat.status === 200 || chat.status === 201, 'POST /chat/messages (admin default provider)', `status=${chat.status} ${cbody.slice(0, 250)}`);
  } else {
    log(false, 'seeded GEMINI provider present', JSON.stringify(plist).slice(0, 200));
  }

  console.log('\n[6] Swagger / OpenAPI');
  const docs = await req('GET', '/docs');
  log(docs.status === 200, 'GET /docs', `status=${docs.status}`);
  const spec = await req('GET', '/docs-json');
  const paths = spec.json && spec.json.paths ? Object.keys(spec.json.paths).length : 0;
  log(spec.status === 200 && paths > 0, 'GET /docs-json', `status=${spec.status} paths=${paths}`);

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log('  - ' + f));
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(2);
});
