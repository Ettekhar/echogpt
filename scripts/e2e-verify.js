/* eslint-disable */
/**
 * End-to-end verification script for the EchoGPT backend.
 * Exercises every assignment feature against a live API + real Gemini key.
 *
 *   node scripts/e2e-verify.js [baseUrl]
 */
const BASE = process.argv[2] || 'http://localhost:3001/api/v1';
// NEVER hardcode a real key here. Supply it via the environment:
//   set GEMINI_KEY=...   (PowerShell:  $env:GEMINI_KEY = "..."; node scripts/e2e-verify.js)
const GEMINI_KEY = process.env.GEMINI_KEY || '';

let pass = 0;
let fail = 0;
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

async function req(method, path, { token, body, raw } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-json */
  }
  if (raw) return { status: res.status, text, json };
  return { status: res.status, json };
}

const data = (r) => (r.json && r.json.data !== undefined ? r.json.data : r.json);

(async () => {
  const email = `e2e_${Date.now()}@echogpt.test`;
  let token = null;
  let providerId = null;

  console.log(`\n=== EchoGPT E2E @ ${BASE} ===\n`);

  console.log('[1] Health');
  {
    const r = await req('GET', '/health');
    log(r.status === 200 && data(r).status === 'ok', 'GET /health', `status=${r.status}`);
  }

  console.log('\n[2] Auth');
  {
    const r = await req('POST', '/auth/register', {
      body: { email, password: 'Passw0rd!23', name: 'E2E Tester' },
    });
    log(r.status === 201 || r.status === 200, 'POST /auth/register', `status=${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
    const d = data(r);
    token = d && (d.accessToken || (d.tokens && d.tokens.accessToken));

    const login = await req('POST', '/auth/login', {
      body: { email, password: 'Passw0rd!23' },
    });
    log(login.status === 200 || login.status === 201, 'POST /auth/login', `status=${login.status}`);
    const ld = data(login);
    token = (ld && (ld.accessToken || (ld.tokens && ld.tokens.accessToken))) || token;
    log(!!token, 'access token issued');

    const refresh = await req('POST', '/auth/refresh', { body: { refreshToken: ld.refreshToken } });
    log(refresh.status === 200 || refresh.status === 201, 'POST /auth/refresh', `status=${refresh.status}`);

    const bad = await req('POST', '/auth/login', {
      body: { email, password: 'Wr0ngPassword!' },
    });
    log(bad.status === 401, 'POST /auth/login rejects bad password', `status=${bad.status}`);

    const noauth = await req('GET', '/users/me');
    log(noauth.status === 401, 'GET /users/me requires auth', `status=${noauth.status}`);
  }

  console.log('\n[3] User management');
  {
    const me = await req('GET', '/users/me', { token });
    log(me.status === 200, 'GET /users/me', `status=${me.status}`);

    const patch = await req('PATCH', '/users/me', { token, body: { name: 'E2E Renamed' } });
    log(patch.status === 200, 'PATCH /users/me', `status=${patch.status}`);
  }

  console.log('\n[4] Subscriptions');
  {
    for (const p of ['/subscriptions/status', '/subscriptions/usage', '/subscriptions/remaining']) {
      const r = await req('GET', p, { token });
      log(r.status === 200, `GET ${p}`, `status=${r.status}`);
    }
    const up = await req('POST', '/subscriptions/upgrade', { token, body: { plan: 'PREMIUM' } });
    log(up.status === 200 || up.status === 201, 'POST /subscriptions/upgrade', `status=${up.status} ${JSON.stringify(up.json).slice(0, 160)}`);
  }

  console.log('\n[5] AI Providers (real Gemini key)');
  {
    const create = await req('POST', '/providers', {
      token,
      body: { name: 'GEMINI', apiKey: GEMINI_KEY, label: 'E2E Gemini', isDefault: true },
    });
    log(create.status === 201 || create.status === 200, 'POST /providers', `status=${create.status} ${JSON.stringify(create.json).slice(0, 250)}`);
    providerId = data(create) && data(create).id;

    const list = await req('GET', '/providers', { token });
    log(list.status === 200, 'GET /providers', `status=${list.status}`);

    // ensure the API key is never echoed back in full
    const raw = JSON.stringify(create.json || {});
    log(!raw.includes(GEMINI_KEY), 'API key never returned in plaintext');

    if (providerId) {
      const get = await req('GET', `/providers/${providerId}`, { token });
      log(get.status === 200, 'GET /providers/:id', `status=${get.status}`);

      const patch = await req('PATCH', `/providers/${providerId}`, { token, body: { label: 'E2E Gemini v2' } });
      log(patch.status === 200, 'PATCH /providers/:id', `status=${patch.status}`);

      const def = await req('GET', '/providers/default', { token });
      log(def.status === 200, 'GET /providers/default', `status=${def.status}`);

      const setdef = await req('PATCH', `/providers/${providerId}/default`, { token });
      log(setdef.status === 200, 'PATCH /providers/:id/default', `status=${setdef.status}`);

      const health = await req('POST', `/providers/${providerId}/health-check`, { token });
      log(health.status === 200, 'POST /providers/:id/health-check', `status=${health.status} ${JSON.stringify(health.json).slice(0, 200)}`);

      const health2 = await req('GET', `/providers/${providerId}/health`, { token });
      log(health2.status === 200, 'GET /providers/:id/health', `status=${health2.status}`);

      const disable = await req('PATCH', `/providers/${providerId}/disable`, { token });
      log(disable.status === 200, 'PATCH /providers/:id/disable', `status=${disable.status}`);
      const enable = await req('PATCH', `/providers/${providerId}/enable`, { token });
      log(enable.status === 200, 'PATCH /providers/:id/enable', `status=${enable.status}`);
    }
  }

  console.log('\n[6] Chat (real AI response)');
  {
    const r = await req('POST', '/chat/messages', {
      token,
      body: { content: 'Reply with exactly: ECHOGPT_OK', providerId },
    });
    const body = JSON.stringify(r.json || {});
    const ok = (r.status === 200 || r.status === 201) && /ECHOGPT_OK/i.test(body);
    log(ok, 'POST /chat/messages returns real AI text', `status=${r.status} body=${body.slice(0, 300)}`);

    const convs = await req('GET', '/chat/conversations', { token });
    log(convs.status === 200, 'GET /chat/conversations', `status=${convs.status}`);

    const hist = await req('GET', '/chat/history', { token });
    log(hist.status === 200, 'GET /chat/history', `status=${hist.status}`);
  }

  console.log('\n[7] Streaming chat (SSE)');
  {
    const res = await fetch(BASE + '/chat/messages/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ content: 'Say hi', providerId }),
    });
    const text = await res.text();
    const ctype = res.headers.get('content-type') || '';
    log(
      res.status === 200 && ctype.includes('text/event-stream') && /event:\s*done|event:\s*chunk/.test(text),
      'POST /chat/messages/stream emits SSE',
      `status=${res.status} ctype=${ctype} len=${text.length} head=${text.slice(0, 120).replace(/\n/g, '\\n')}`
    );
  }

  console.log('\n[8] Web search');
  {
    for (const p of ['/search/history', '/search/recent', '/search/suggestions?q=nestjs']) {
      const r = await req('GET', p, { token });
      log(r.status === 200, `GET ${p}`, `status=${r.status}`);
    }
    const q = await req('POST', '/search/query', { token, body: { query: 'nestjs swagger' } });
    log(q.status === 200 || q.status === 201, 'POST /search/query', `status=${q.status} ${JSON.stringify(q.json).slice(0, 200)}`);
  }

  console.log('\n[9] Admin (expect 403 for non-admin)');
  {
    const r = await req('GET', '/admin/dashboard', { token });
    log(r.status === 403, 'GET /admin/dashboard blocked for non-admin', `status=${r.status}`);
  }

  console.log('\n[10] Logout + token revocation');
  {
    // Re-login so we hold a live refresh token; logout revokes it by value.
    const relogin = await req('POST', '/auth/login', {
      body: { email, password: 'Passw0rd!23' },
    });
    const rt = data(relogin) && data(relogin).refreshToken;
    const r = await req('POST', '/auth/logout', { body: { refreshToken: rt } });
    log(r.status === 200, 'POST /auth/logout', `status=${r.status}`);

    // The revoked refresh token must no longer mint a new access token.
    const reuse = await req('POST', '/auth/refresh', { body: { refreshToken: rt } });
    log(reuse.status === 400 || reuse.status === 401, 'revoked refresh token is rejected', `status=${reuse.status}`);
  }

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
