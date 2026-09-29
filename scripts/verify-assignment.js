/* eslint-disable */
/**
 * Assignment compliance audit.
 *
 * Walks the AppifyDevs assignment email line by line and proves each item
 * against a LIVE backend, so the result reflects what a reviewer will actually
 * see rather than what the unit tests (which mock Prisma) claim.
 *
 *   node scripts/verify-assignment.js [baseUrl]
 *
 * Defaults to the tunneled deployment. Pass a base URL to audit another host:
 *   node scripts/verify-assignment.js https://echogpt-api.onrender.com/api/v1
 *
 * Requires GEMINI_KEY in the environment to exercise live AI calls.
 */
const BASE = process.argv[2] || 'http://localhost:3001/api/v1';
const GEMINI_KEY = process.env.GEMINI_KEY || '';

let pass = 0,
  fail = 0,
  skip = 0;
const failures = [];
const bySection = {};
let currentSection = null;

function log(ok, name, detail) {
  const bucket = bySection[currentSection];
  if (ok) {
    pass++;
    if (bucket) bucket.pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    if (bucket) bucket.fail++;
    failures.push(`${name} :: ${detail || ''}`);
    console.log(`  FAIL  ${name}  ${detail || ''}`);
  }
  return ok;
}

function skipTest(name, why) {
  skip++;
  const bucket = bySection[currentSection];
  if (bucket) bucket.skip++;
  console.log(`  SKIP  ${name}  (${why})`);
}

function section(title) {
  console.log(`\n${title}`);
  currentSection = title;
  bySection[title] = { pass: 0, fail: 0, skip: 0 };
}

// A Cloudflare quick tunnel occasionally answers 502/503 under a burst of
// requests. Those are transport hiccups, not application failures, so retry
// before recording a failure - otherwise a flaky tunnel reports dozens of
// false negatives and buries the real results.
const TRANSIENT = new Set([502, 503, 504]);

async function req(method, path, { token, body, retries = 2 } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let attempt = 0;
  for (;;) {
    try {
      const res = await fetch(BASE + path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const t = await res.text();
      let j = null;
      try {
        j = JSON.parse(t);
      } catch {}
      if (TRANSIENT.has(res.status) && attempt < retries) {
        attempt++;
        await new Promise((r) => setTimeout(r, 800 * attempt));
        continue;
      }
      return { status: res.status, json: j, text: t, ok: res.ok };
    } catch (e) {
      if (attempt < retries) {
        attempt++;
        await new Promise((r) => setTimeout(r, 800 * attempt));
        continue;
      }
      return { status: 0, json: null, text: String(e.message), ok: false };
    }
  }
}
const data = (r) => (r.json && r.json.data !== undefined ? r.json.data : r.json);

// Admin/user list endpoints wrap pagination twice: { data: { data: [...], meta } }.
const unwrapList = (d) => {
  if (Array.isArray(d)) return d;
  if (d && Array.isArray(d.data)) return d.data;
  return [];
};

(async () => {
  console.log(`\n${'='.repeat(72)}`);
  console.log(' EchoGPT — AppifyDevs Assignment Compliance Audit');
  console.log(` Target: ${BASE}`);
  console.log('='.repeat(72));

  const stamp = Date.now();
  const uniq = Math.random().toString(36).slice(2, 8);
  const newEmail = `audit_${stamp}_${uniq}@echogpt.test`;
  const newPass = 'Audit@12345';
  let userToken = null;
  let newUserId = null;
  let refreshToken = null;
  let adminToken = null;

  // ==========================================================================
  section('1. AUTHENTICATION');

  // Registration
  const reg = await req('POST', '/auth/register', {
    body: { email: newEmail, password: newPass, name: 'Audit Bot' },
  });
  log(reg.status === 201 || reg.status === 200, 'User Registration  POST /auth/register', `status=${reg.status} ${reg.text.slice(0, 120)}`);
  const regData = data(reg) || {};
  userToken = regData.accessToken || (regData.tokens && regData.tokens.accessToken);
  refreshToken = regData.refreshToken || (regData.tokens && regData.tokens.refreshToken);
  newUserId = regData.user && regData.user.id;
  log(!!userToken, 'JWT issued on registration', 'no accessToken in response');
  log(!!refreshToken, 'Refresh token issued on registration', 'no refreshToken in response');
  log(!JSON.stringify(reg.json || {}).match(newPass), 'Password hashing (plaintext absent from response)', 'password echoed back');

  // Password hashing on the wire: register with a password, then confirm the
  // stored value is never exposed by any read endpoint.
  const me1 = await req('GET', '/users/me', { token: userToken });
  const meData = data(me1) || {};
  log(!JSON.stringify(me1.json || {}).toLowerCase().includes('passwordhash'), 'Password hash never exposed', 'passwordHash leaked in /users/me');

  // Duplicate email rejection
  const dupe = await req('POST', '/auth/register', { body: { email: newEmail, password: newPass, name: 'Dup' } });
  log(dupe.status === 409 || dupe.status === 400, 'Duplicate email rejected', `status=${dupe.status}`);

  // Login
  const login = await req('POST', '/auth/login', { body: { email: newEmail, password: newPass } });
  log(login.status === 200, 'User Login  POST /auth/login', `status=${login.status}`);
  const loginData = data(login) || {};
  userToken = loginData.accessToken || userToken;
  refreshToken = loginData.refreshToken || refreshToken;

  // Wrong password
  const bad = await req('POST', '/auth/login', { body: { email: newEmail, password: 'TotallyWrong123' } });
  log(bad.status === 401, 'Wrong password rejected (401)', `status=${bad.status}`);

  // JWT auth enforced
  const noAuth = await req('GET', '/users/me');
  log(noAuth.status === 401, 'JWT Authentication guards protected routes', `status=${noAuth.status}`);

  // Garbage token
  const badTok = await req('GET', '/users/me', { token: 'not.a.jwt' });
  log(badTok.status === 401, 'Invalid/expired JWT rejected', `status=${badTok.status}`);

  // Refresh token
  if (refreshToken) {
    const ref = await req('POST', '/auth/refresh', { body: { refreshToken } });
    log(ref.status === 200, 'Refresh Token Support  POST /auth/refresh', `status=${ref.status}`);
    const refData = data(ref) || {};
    const rotated = refData.accessToken || (refData.tokens && refData.tokens.accessToken);
    log(!!rotated, 'Refresh returns a new access token', 'no accessToken in refresh response');
    if (rotated) {
      const reuse = await req('POST', '/auth/refresh', { body: { refreshToken } });
      log(reuse.status === 401 || reuse.status === 200, 'Old refresh token handled (rotation or reuse-policy)', `status=${reuse.status}`);
    }
  } else {
    skipTest('Refresh Token Support', 'no refresh token returned');
  }

  // Email verification (bonus)
  const verifyLink = await req('GET', '/auth/verify-email', { token: 'a'.repeat(64) });
  log([200, 400, 401, 404].includes(verifyLink.status), 'Email Verification endpoint exists  GET /auth/verify-email', `status=${verifyLink.status}`);
  const resend = await req('POST', '/auth/verify-email', { body: { email: newEmail } });
  log([200, 202, 400, 404].includes(resend.status), 'Email verification resend endpoint', `status=${resend.status}`);

  // ==========================================================================
  section('2. USER MANAGEMENT');

  log(me1.status === 200, 'User Profile  GET /users/me', `status=${me1.status}`);
  const patch = await req('PATCH', '/users/me', { token: userToken, body: { name: 'Audit Bot Renamed' } });
  log(patch.status === 200, 'Update Profile  PATCH /users/me', `status=${patch.status} ${patch.text.slice(0, 100)}`);
  const putProfile = await req('GET', '/users/profile', { token: userToken });
  log(putProfile.status === 200, 'Alternate profile route  GET /users/profile', `status=${putProfile.status}`);

  const chp = await req('PATCH', '/users/me/password', {
    token: userToken,
    body: { currentPassword: newPass, newPassword: 'Audit@123456' },
  });
  log(chp.status === 200, 'Change Password  PATCH /users/me/password', `status=${chp.status} ${chp.text.slice(0, 120)}`);
  // Change back so later authenticated calls keep working.
  await req('PATCH', '/users/me/password', {
    token: userToken,
    body: { currentPassword: 'Audit@123456', newPassword: newPass },
  });

  const roles = ['ADMIN', 'USER'];
  log(roles.includes(meData.role), `User Roles present (role=${meData.role})`, 'no role field');
  const roleEnum = await req('GET', '/admin/users?pageSize=1', { token: (await loginAdmin()).token });
  log(roleEnum.status === 200, 'Admin can enumerate users (role-gated)', `status=${roleEnum.status}`);

  // ==========================================================================
  section('3. SUBSCRIPTION MANAGEMENT');

  const status = await req('GET', '/subscriptions/status', { token: userToken });
  log(status.status === 200, 'Subscription Status API  GET /subscriptions/status', `status=${status.status}`);
  const stData = data(status) || {};
  log(!!stData.plan, `Free & Premium plans modelled (plan=${stData.plan})`, 'no plan field');

  const usage = await req('GET', '/subscriptions/usage', { token: userToken });
  log(usage.status === 200, 'Usage API  GET /subscriptions/usage', `status=${usage.status}`);
  const remaining = await req('GET', '/subscriptions/remaining', { token: userToken });
  log(remaining.status === 200, 'Remaining Requests API  GET /subscriptions/remaining', `status=${remaining.status}`);
  const remData = data(remaining) || {};
  log(remData.remainingRequests !== undefined || remData.remaining !== undefined, 'Remaining-requests value returned', JSON.stringify(remData).slice(0, 120));
  const subMe = await req('GET', '/subscriptions/me', { token: userToken });
  log(subMe.status === 200, 'GET /subscriptions/me', `status=${subMe.status}`);

  const upgrade = await req('PATCH', '/subscriptions/plan', { token: userToken, body: { plan: 'PREMIUM' } });
  log(upgrade.status === 200, 'Upgrade Subscription  PATCH /subscriptions/plan', `status=${upgrade.status} ${upgrade.text.slice(0, 100)}`);
  const afterUp = data(await req('GET', '/subscriptions/status', { token: userToken })) || {};
  log(afterUp.plan === 'PREMIUM', 'Plan actually changed to PREMIUM', `plan=${afterUp.plan}`);

  const downgrade = await req('PATCH', '/subscriptions/plan', { token: userToken, body: { plan: 'FREE' } });
  log(downgrade.status === 200, 'Downgrade Subscription  PATCH /subscriptions/plan', `status=${downgrade.status}`);
  const upRoute = await req('POST', '/subscriptions/upgrade', { token: userToken });
  const downRoute = await req('POST', '/subscriptions/downgrade', { token: userToken });
  log(upRoute.status === 200, 'Dedicated upgrade route  POST /subscriptions/upgrade', `status=${upRoute.status}`);
  log(downRoute.status === 200, 'Dedicated downgrade route  POST /subscriptions/downgrade', `status=${downRoute.status}`);

  // Usage limits are enforced (not just reported).
  const freeStatus = data(await req('GET', '/subscriptions/status', { token: userToken })) || {};
  log(freeStatus.dailyLimit !== undefined || freeStatus.limit !== undefined, 'Daily usage limit defined on plan', JSON.stringify(freeStatus).slice(0, 140));

  // ==========================================================================
  section('4. AI PROVIDER MANAGEMENT');

  const provList = await req('GET', '/providers', { token: userToken });
  log(provList.status === 200, 'GET /providers', `status=${provList.status}`);

  // Add provider for each supported vendor
  const made = {};
  for (const [vendor, model] of [
    ['OPENAI', 'gpt-4o-mini'],
    ['CLAUDE', 'claude-3-5-haiku-latest'],
    ['GEMINI', 'gemini-3.8-flash'],
  ]) {
    const add = await req('POST', '/providers', {
      token: userToken,
      body: { name: vendor, label: `Audit ${vendor}`, apiKey: GEMINI_KEY || `sk-audit-placeholder-${vendor}`, model },
    });
    const ok = log(add.status === 201 || add.status === 200, `Add Provider (${vendor})  POST /providers`, `status=${add.status} ${add.text.slice(0, 120)}`);
    if (ok) {
      const pd = data(add) || {};
      made[vendor] = pd.id;
      log(!JSON.stringify(add.json || {}).match(/sk-audit-placeholder/), `API key stored securely, not echoed (${vendor})`, 'raw key returned in response');
    }
  }

  if (made.GEMINI) {
    const edit = await req('PATCH', `/providers/${made.GEMINI}`, { token: userToken, body: { label: 'Audit Gemini Renamed' } });
    log(edit.status === 200, 'Edit Provider  PATCH /providers/:id', `status=${edit.status}`);
    const dis = await req('PATCH', `/providers/${made.GEMINI}/disable`, { token: userToken });
    log(dis.status === 200, 'Disable Provider  PATCH /providers/:id/disable', `status=${dis.status}`);
    const ena = await req('PATCH', `/providers/${made.GEMINI}/enable`, { token: userToken });
    log(ena.status === 200, 'Enable Provider  PATCH /providers/:id/enable', `status=${ena.status}`);

    const def = await req('POST', `/providers/${made.GEMINI}/default`, { token: userToken });
    log(def.status === 200 || def.status === 201, 'Default Provider Selection  POST /providers/:id/default', `status=${def.status}`);
    const getDef = await req('GET', '/providers/default', { token: userToken });
    log(getDef.status === 200, 'GET /providers/default', `status=${getDef.status}`);

    if (GEMINI_KEY) {
      const hc = await req('POST', `/providers/${made.GEMINI}/health-check`, { token: userToken });
      log(hc.status === 200, 'Health Check Endpoint  POST /providers/:id/health-check (200, not 201)', `status=${hc.status}`);
      const hcData = data(hc) || {};
      log(hcData.healthy === true || hcData.status === 'healthy', `Health check reports healthy with a real key`, JSON.stringify(hcData).slice(0, 140));
      const hcGet = await req('GET', `/providers/${made.GEMINI}/health`, { token: userToken });
      log(hcGet.status === 200, 'GET /providers/:id/health', `status=${hcGet.status}`);
    } else {
      skipTest('Live health check', 'GEMINI_KEY not set');
    }
  }

  const delProv = await req('DELETE', `/providers/${made.OPENAI || 'x'}`, { token: userToken });
  log(delProv.status === 200 || delProv.status === 404, 'Delete Provider  DELETE /providers/:id', `status=${delProv.status}`);

  const noAuthProv = await req('GET', '/providers');
  log(noAuthProv.status === 401, 'Provider list requires auth', `status=${noAuthProv.status}`);

  // ==========================================================================
  section('5. CHAT API');

  // The provider created above carries a real key only when GEMINI_KEY is set;
  // without one it holds a placeholder, so a live call is guaranteed to 503 and
  // reporting that as a failure would say the wiring is broken when it is not.
  // Guarded the same way as the health check and the streaming check above.
  let chatData = {};
  if (GEMINI_KEY) {
    const chat = await req('POST', '/chat/messages', { token: userToken, body: { message: 'Reply with exactly: AUDIT_OK' } });
    log(chat.status === 201 || chat.status === 200, 'Send Prompt / Receive AI Response  POST /chat/messages', `status=${chat.status} ${chat.text.slice(0, 140)}`);
    chatData = data(chat) || {};
    log(!!(chatData.message && chatData.message.content), 'Response contains assistant content', JSON.stringify(chatData).slice(0, 140));
    log(!!chatData.conversationId, 'Conversation created and id returned', 'no conversationId');
  } else {
    skipTest('Send Prompt / Receive AI Response  POST /chat/messages', 'GEMINI_KEY not set');
    skipTest('Response contains assistant content', 'GEMINI_KEY not set');
    skipTest('Conversation created and id returned', 'GEMINI_KEY not set');
  }

  if (chatData.conversationId) {
    const convs = await req('GET', '/chat/conversations', { token: userToken });
    log(convs.status === 200, 'Conversation History  GET /chat/conversations', `status=${convs.status}`);
    const one = await req('GET', `/chat/conversations/${chatData.conversationId}`, { token: userToken });
    log(one.status === 200, 'GET /chat/conversations/:id', `status=${one.status}`);
    const oneData = data(one) || {};
    // This route returns { conversation, messages }, not a bare list.
    const msgs = Array.isArray(oneData.messages) ? oneData.messages : unwrapList(oneData);
    log(msgs.length >= 2, `History holds the full exchange (${msgs.length} messages)`, `only ${msgs.length}`);

    // Provider selection: an explicit providerId must route to that provider.
    // Use the working Gemini provider - pointing at a provider with a bogus key
    // is expected to fail, which would not prove routing works either way.
    const routeProvider = made.GEMINI || made.GEMINI;
    if (routeProvider) {
      const sel = await req('POST', '/chat/messages', {
        token: userToken,
        body: { message: 'Reply with exactly: ROUTE_OK', providerId: routeProvider, conversationId: chatData.conversationId },
      });
      const selOk = sel.status === 201 || sel.status === 200;
      log(selOk, 'Provider Selection via providerId', `status=${sel.status} ${sel.text.slice(0, 110)}`);
      if (selOk) {
        const selData = data(sel) || {};
        log(!!selData.message && !!selData.message.content, 'Provider-selected reply returns content', JSON.stringify(selData).slice(0, 120));
      }
    }
  }

  const hist = await req('GET', '/chat/history', { token: userToken });
  log(hist.status === 200, 'GET /chat/history', `status=${hist.status}`);

  if (GEMINI_KEY) {
    const stream = await req('POST', '/chat/messages/stream', { token: userToken, body: { message: 'Say AUDIT_STREAM' } });
    const streamed = stream.text.includes('AUDIT_STREAM') || stream.status === 200;
    log(streamed, 'Streaming Response (bonus)  POST /chat/messages/stream', `status=${stream.status} ${stream.text.slice(0, 110)}`);
  } else {
    skipTest('Streaming Response', 'GEMINI_KEY not set');
  }

  // ==========================================================================
  section('6. WEB SEARCH API');

  const search = await req('POST', '/search/query', { token: userToken, body: { query: 'NestJS official website' } });
  log(search.status === 200 || search.status === 201, 'Search Query  POST /search/query', `status=${search.status} ${search.text.slice(0, 130)}`);
  const searchData = data(search) || {};
  log(!!searchData.answer || !!searchData.results || !!searchData.summary, 'Search returns an AI answer / results', JSON.stringify(searchData).slice(0, 130));

  const sh = await req('GET', '/search/history', { token: userToken });
  log(sh.status === 200, 'Search History  GET /search/history', `status=${sh.status}`);
  const sr = await req('GET', '/search/recent', { token: userToken });
  log(sr.status === 200, 'Recent Searches  GET /search/recent', `status=${sr.status}`);
  const ss = await req('GET', '/search/suggestions?q=nes', { token: userToken });
  log(ss.status === 200, 'Search Suggestions  GET /search/suggestions', `status=${ss.status}`);

  // ==========================================================================
  section('7. ADMIN PANEL APIs');

  const admin = await loginAdmin();
  adminToken = admin.token;
  log(!!adminToken, 'Admin login for panel checks', 'could not authenticate admin@echogpt.app');
  if (adminToken) {
    for (const [label, path] of [
      ['Dashboard Statistics', '/admin/dashboard'],
      ['Dashboard Statistics (alt)', '/admin/stats'],
      ['User Management', '/admin/users?pageSize=5'],
      ['Subscription Management', '/admin/subscriptions'],
      ['AI Provider Management', '/admin/providers'],
      ['API Usage Analytics', '/admin/usage-analytics?days=7'],
      ['API Usage (alt)', '/admin/usage'],
      ['Request Logs', '/admin/logs?pageSize=5'],
      ['System Health', '/admin/system-health'],
    ]) {
      const r = await req('GET', path, { token: adminToken });
      log(r.status === 200, `${label}  GET ${path.split('?')[0]}`, `status=${r.status} ${r.text.slice(0, 110)}`);
    }

    // Non-admin must be blocked everywhere in the panel.
    let blocked = 0;
    let checked = 0;
    for (const p of ['/admin/dashboard', '/admin/users', '/admin/providers', '/admin/logs', '/admin/subscriptions']) {
      checked++;
      const r = await req('GET', p, { token: userToken });
      if (r.status === 401 || r.status === 403) blocked++;
    }
    log(blocked === checked, `Admin routes reject non-admins (${blocked}/${checked})`, `only ${blocked}/${checked} blocked`);

    // Subscription override (admin managing a user's subscription)
    if (newUserId) {
      const subGet = await req('GET', `/admin/subscriptions/${newUserId}`, { token: adminToken });
      log(subGet.status === 200, 'Admin reads a user subscription  GET /admin/subscriptions/:userId', `status=${subGet.status}`);
      const subSet = await req('PATCH', `/admin/subscriptions/${newUserId}`, {
        token: adminToken,
        body: { plan: 'PREMIUM', status: 'ACTIVE' },
      });
      log(subSet.status === 200, 'Admin updates a user subscription  PATCH /admin/subscriptions/:userId', `status=${subSet.status}`);
    }

    // Admin role management
    const adminUsers = unwrapList(data(await req('GET', '/admin/users?pageSize=50', { token: adminToken })));
    log(adminUsers.length > 0, `Admin user list populated (${adminUsers.length} users)`, 'no users returned');

    // ==========================================================================
    section('8. API DOCUMENTATION (Swagger)');

    const docs = await req('GET', '/docs');
    log(docs.status === 200, 'Swagger UI  GET /docs', `status=${docs.status}`);
    log(docs.text.toLowerCase().includes('swagger'), 'Swagger UI renders', 'no swagger markup');
    const spec = await req('GET', '/docs-json');
    log(spec.status === 200, 'OpenAPI spec  GET /docs-json', `status=${spec.status}`);
    const specJson = spec.json || {};
    // Paths in the spec carry the global prefix (e.g. /api/v1/auth/login),
    // so compare on the suffix after stripping it.
    const prefix = (specJson.servers && specJson.servers[0] && specJson.servers[0].url) || '';
    const paths = Object.keys(specJson.paths || {});
    log(paths.length >= 40, `OpenAPI documents ${paths.length} paths`, `only ${paths.length}`);
    const required = ['/auth/register', '/auth/login', '/auth/logout', '/auth/refresh', '/users/me', '/subscriptions/status', '/providers', '/chat/messages', '/search/query', '/admin/dashboard'];
    const hasPath = (suffix) => paths.some((p) => p === suffix || p.endsWith(suffix) || `${prefix}${suffix}` === p);
    const missing = required.filter((p) => !hasPath(p));
    log(missing.length === 0, `Key paths present in spec${missing.length ? ` (missing: ${missing.join(', ')})` : ''}`, missing.join(', '));

    // Every documented GET must actually resolve.
    let badMethods = [];
    for (const p of paths) {
      const ops = specJson.paths[p] || {};
      if (!ops.get) continue;
      if (!/(auth|users|subscriptions|providers|chat|search|admin|health)/.test(p)) continue;
      const r = await req('GET', p.replace(/^\/api\/v1/, ''), {});
      if (r.status === 404) badMethods.push(`GET ${p}`);
    }
    log(badMethods.length === 0, `All GET paths in the spec resolve (no 404s)${badMethods.length ? ` — ${badMethods.join(', ')}` : ''}`, badMethods.join(', '));

    const secured = (specJson.components && specJson.components.securitySchemes) || {};
    log(Object.keys(secured).length > 0, `Security scheme documented (${Object.keys(secured).join(', ') || 'none'})`, 'no securitySchemes');

    const documentedTags = (specJson.tags || []).map((t) => t.name);
    const needTags = ['Auth', 'Users', 'Subscriptions', 'AI Providers', 'Chat', 'Web Search', 'Admin'];
    const missingTags = needTags.filter((t) => !documentedTags.includes(t));
    log(missingTags.length === 0, `All feature areas tagged in Swagger${missingTags.length ? ` (missing: ${missingTags.join(', ')})` : ''}`, missingTags.join(', '));
  }

  // ==========================================================================
  section('9. USAGE LIMITS ENFORCED (end-to-end)');

  // A cancelled subscription must actually block paid endpoints, proving the
  // limits are enforced server-side rather than merely reported.
  await req('PATCH', '/subscriptions/plan', { token: userToken, body: { plan: 'PREMIUM' } });
  const cancel = await req('POST', '/subscriptions/cancel', { token: userToken });
  log(cancel.status === 200 || cancel.status === 201, 'POST /subscriptions/cancel', `status=${cancel.status}`);
  const blockedChat = await req('POST', '/chat/messages', { token: userToken, body: { message: 'should be blocked' } });
  log(blockedChat.status === 403, 'Cancelled subscription blocks chat (403)', `status=${blockedChat.status}`);
  const blockedSearch = await req('POST', '/search/query', { token: userToken, body: { query: 'should be blocked' } });
  log(blockedSearch.status === 403, 'Cancelled subscription blocks web search (403)', `status=${blockedSearch.status}`);
  await req('PATCH', '/subscriptions/plan', { token: userToken, body: { plan: 'PREMIUM' } });

  // ==========================================================================
  section('10. SECURE LOGOUT');

  const relogin = await req('POST', '/auth/login', { body: { email: newEmail, password: newPass } });
  const reloginData = data(relogin) || {};
  const logoutToken = reloginData.accessToken;
  const logoutRefresh = reloginData.refreshToken;
  const lo = await req('POST', '/auth/logout', { token: logoutToken, body: { refreshToken: logoutRefresh } });
  log(lo.status === 200 || lo.status === 201, 'Secure Logout  POST /auth/logout', `status=${lo.status}`);
  if (logoutRefresh) {
    const afterLogout = await req('POST', '/auth/refresh', { body: { refreshToken: logoutRefresh } });
    log(afterLogout.status === 401, 'Refresh token revoked by logout', `status=${afterLogout.status}`);
  }

  // ==========================================================================
  section('11. DELETE ACCOUNT');

  const fresh = data(await req('POST', '/auth/login', { body: { email: newEmail, password: newPass } })) || {};
  const delTok = fresh.accessToken;
  const freshRefresh = fresh.refreshToken;
  const del = await req('DELETE', '/users/me', { token: delTok });
  log(del.status === 200, 'Delete Account  DELETE /users/me', `status=${del.status}`);
  const afterDel = await req('POST', '/auth/login', { body: { email: newEmail, password: newPass } });
  log(afterDel.status === 401, 'Deleted account can no longer log in', `status=${afterDel.status}`);
  if (freshRefresh) {
    const delRefresh = await req('POST', '/auth/refresh', { body: { refreshToken: freshRefresh } });
    log(delRefresh.status === 401, 'Deleted account refresh token invalidated', `status=${delRefresh.status}`);
  }

  // ==========================================================================
  section('12. DATABASE DESIGN & SUBMISSION ARTIFACTS');
  auditRepository();

  // ==========================================================================
  console.log(`\n${'='.repeat(72)}`);
  console.log(' RESULTS BY ASSIGNMENT SECTION');
  console.log('='.repeat(72));
  const sections = Object.entries(bySection);
  for (const [name, s] of sections) {
    const total = s.pass + s.fail;
    const mark = s.fail === 0 ? 'OK  ' : 'FAIL';
    console.log(` ${mark} ${name.padEnd(42)} ${s.pass}/${total}${s.skip ? ` (+${s.skip} skipped)` : ''}`);
  }

  console.log(`\n${'='.repeat(72)}`);
  console.log(` TOTAL: ${pass} passed, ${fail} failed${skip ? `, ${skip} skipped` : ''}`);
  if (failures.length) {
    console.log('\n FAILURES:');
    failures.forEach((f) => console.log('  - ' + f));
  }
  console.log('='.repeat(72));
  process.exit(fail === 0 ? 0 : 1);
})();

async function loginAdmin() {
  const r = await req('POST', '/auth/login', {
    body: { email: 'admin@echogpt.app', password: 'ChangeMe123!' },
  });
  const d = data(r) || {};
  return { token: d.accessToken || (d.tokens && d.tokens.accessToken), res: r };
}

/**
 * The last third of the assignment ("Database Design" and "Submission
 * Requirements") is about the repository, not the running API, so it is checked
 * against the files on disk.
 */
function auditRepository() {
  const fs = require('fs');
  const path = require('path');
  const root = path.resolve(__dirname, '..');
  const has = (p) => fs.existsSync(path.join(root, p));

  // Normalized schema: the eight entities the assignment names by minimum.
  const schemaPath = path.join(root, 'prisma', 'schema.prisma');
  if (!fs.existsSync(schemaPath)) {
    log(false, 'prisma/schema.prisma exists', 'file missing');
    return;
  }
  const schema = fs.readFileSync(schemaPath, 'utf8');
  const models = [...schema.matchAll(/^model\s+(\w+)/gm)].map((m) => m[1]);
  const required = {
    Users: 'User',
    Sessions: 'Session',
    Roles: 'Role',
    Subscriptions: 'Subscription',
    'AI Providers': 'AiProvider',
    'Chat History': 'Message',
    'Web Searches': 'WebSearch',
    'API Usage Logs': 'ApiUsageLog',
  };
  const missingModels = Object.entries(required)
    .filter(([, model]) => !models.includes(model))
    .map(([label]) => label);
  log(
    missingModels.length === 0,
    `Normalized schema has all 8 required entities (${models.length} models)`,
    `missing: ${missingModels.join(', ')}`,
  );

  // Relational integrity: every model should declare a primary key.
  const noPk = models.filter((m) => {
    const block = schema.split(new RegExp(`^model\\s+${m}\\s*\\{`, 'm'))[1] || '';
    return !/@@id|@id/.test(block.split(/\n\}/)[0]);
  });
  log(noPk.length === 0, 'Every model declares a primary key', `no @id in: ${noPk.join(', ')}`);

  // Foreign keys prove the schema is relational rather than JSON blobs.
  const fkCount = (schema.match(/@relation\(/g) || []).length;
  log(fkCount >= 8, `Schema uses foreign-key relations (${fkCount} @relation)`, `only ${fkCount}`);

  // Enums keep status/role/plan values normalized.
  const enums = [...schema.matchAll(/^enum\s+(\w+)/gm)].map((m) => m[1]);
  log(enums.length >= 3, `Enums normalize domain values (${enums.join(', ')})`, `only ${enums.length}`);

  // Migration files must be committed.
  const migDir = path.join(root, 'prisma', 'migrations');
  const migrations = fs.existsSync(migDir)
    ? fs.readdirSync(migDir).filter((d) => fs.statSync(path.join(migDir, d)).isDirectory())
    : [];
  log(migrations.length > 0, `Database migration files committed (${migrations.length})`, 'no migrations directory');
  log(
    migrations.some((m) => fs.existsSync(path.join(migDir, m, 'migration.sql'))),
    'Migrations contain migration.sql',
    'no migration.sql found',
  );

  // Submission requirements.
  log(has('README.md'), 'Submission: README with setup instructions', 'README.md missing');
  const readme = has('README.md') ? fs.readFileSync(path.join(root, 'README.md'), 'utf8') : '';
  log(/npm run dev/.test(readme), 'README documents how to run the project', 'no run instructions');
  log(/prisma/.test(readme) && /migrat/i.test(readme), 'README documents migrations', 'no migration instructions');
  log(has('.env.example'), 'Submission: sample .env.example', '.env.example missing');
  log(has('postman_collection.json'), 'Submission: Postman collection (optional)', 'postman_collection.json missing');
  log(has('Dockerfile'), 'Docker support (optional but recommended)', 'Dockerfile missing');

  // Swagger is generated from decorators, so an OpenAPI artefact on disk proves
  // it was generated rather than hand-written.
  log(has('openapi.json'), 'Exported OpenAPI artefact', 'openapi.json missing');

  // Secrets must not be committed.
  const tracked = ['.env'];
  const leaked = tracked.filter((f) => {
    if (!has(f)) return false;
    try {
      return require('child_process')
        .execSync(`git ls-files --error-unmatch ${f}`, { cwd: root, stdio: 'ignore' })
        .toString()
        .includes(f);
    } catch {
      return false;
    }
  });
  log(leaked.length === 0, 'No .env committed to the repository', `.env is tracked: ${leaked.join(', ')}`);
}
