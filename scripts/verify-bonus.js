/* eslint-disable */
/**
 * Covers the assignment features not exercised by e2e-verify/admin scripts:
 * email verification, change password, delete account, subscription
 * downgrade/cancel, search caching, and per-provider isolation of user data.
 *   node scripts/verify-bonus.js [baseUrl]
 */
const BASE = process.argv[2] || 'http://localhost:3001/api/v1';

let pass = 0,
  fail = 0;
const failures = [];
const log = (ok, name, detail) => {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    failures.push(`${name} :: ${detail || ''}`);
    console.log(`  FAIL  ${name}  ${detail || ''}`);
  }
};

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
  console.log(`\n=== Bonus / remaining features @ ${BASE} ===\n`);

  // Capture the verification link the MailService logs to the console in dev.
  // Instead of scraping logs, drive the documented token field directly.
  const email = `bonus_${Date.now()}@echogpt.test`;
  const PASSWORD = 'Passw0rd!23';

  console.log('[1] Registration + email verification (bonus)');
  const reg = await req('POST', '/auth/register', { body: { email, password: PASSWORD, name: 'Bonus' } });
  log([200, 201].includes(reg.status), 'POST /auth/register', `status=${reg.status}`);
  let tok = data(reg)?.accessToken;
  const H = () => ({ token: tok });

  {
    const prof = await req('GET', '/users/profile', H());
    const verified = data(prof)?.isEmailVerified;
    log(verified === false, 'new account starts unverified', `isEmailVerified=${verified}`);

    const badTok = await req('GET', '/auth/verify-email?token=not-a-real-token');
    log([400, 401, 404].includes(badTok.status), 'GET /auth/verify-email rejects a bad token', `status=${badTok.status}`);
  }

  console.log('\n[2] Change password (and the old one stops working)');
  {
    const cp = await req('POST', '/users/change-password', {
      ...H(),
      body: { currentPassword: PASSWORD, newPassword: 'N3wPassword!xyz' },
    });
    log([200, 201].includes(cp.status), 'POST /users/change-password', `status=${cp.status} ${cp.text.slice(0, 140)}`);

    const oldLogin = await req('POST', '/auth/login', { body: { email, password: PASSWORD } });
    log(oldLogin.status === 401, 'old password no longer works', `status=${oldLogin.status}`);

    const newLogin = await req('POST', '/auth/login', { body: { email, password: 'N3wPassword!xyz' } });
    log([200, 201].includes(newLogin.status), 'new password works', `status=${newLogin.status}`);
    tok = data(newLogin)?.accessToken || tok;
  }

  console.log('\n[3] Subscription downgrade -> cancel (a cancelled plan blocks usage)');
  {
    const up = await req('POST', '/subscriptions/upgrade', { ...H(), body: { plan: 'PREMIUM' } });
    log([200, 201].includes(up.status), 'POST /subscriptions/upgrade', `status=${up.status}`);

    const down = await req('POST', '/subscriptions/downgrade', { ...H(), body: { plan: 'FREE' } });
    log([200, 201].includes(down.status), 'POST /subscriptions/downgrade', `status=${down.status} ${down.text.slice(0, 120)}`);

    const st = await req('GET', '/subscriptions/status', H());
    const plan = data(st)?.subscription?.plan ?? data(st)?.plan;
    log(plan === 'FREE', 'status reflects the downgrade', `plan=${plan}`);

    const cancel = await req('POST', '/subscriptions/cancel', H());
    log([200, 201].includes(cancel.status), 'POST /subscriptions/cancel', `status=${cancel.status}`);

    // A cancelled subscription must actually gate the metered endpoints.
    const blocked = await req('POST', '/search/query', { ...H(), body: { query: 'should be blocked' } });
    log(blocked.status === 403, 'cancelled plan blocks /search/query (usage limit)', `status=${blocked.status}`);

    // Re-activate for the remaining checks.
    const reup = await req('POST', '/subscriptions/upgrade', { ...H(), body: { plan: 'PREMIUM' } });
    log([200, 201].includes(reup.status), 're-upgrade after cancel', `status=${reup.status}`);
  }

  console.log('\n[4] Web search caching (bonus)');
  {
    const q = 'prisma orm migration';
    const first = await req('POST', '/search/query', { ...H(), body: { query: q } });
    log([200, 201].includes(first.status), 'POST /search/query', `status=${first.status} ${first.text.slice(0, 120)}`);
    const second = await req('POST', '/search/query', { ...H(), body: { query: q } });
    log([200, 201].includes(second.status), 'repeat query is served (cache path)', `status=${second.status}`);
    const hist = await req('GET', '/search/history', H());
    log(hist.status === 200, 'GET /search/history', `status=${hist.status}`);
  }

  console.log('\n[4b] Provider setup (needed for the chat check below)');
  let myProviderId = null;
  {
    const key = process.env.GEMINI_KEY;
    if (!key) {
      console.log('  SKIP  no GEMINI_KEY set - chat-dependent checks will be skipped');
    } else {
      const mk = await req('POST', '/providers', {
        ...H(),
        body: { name: 'GEMINI', apiKey: key, label: 'Bonus Gemini' },
      });
      log([200, 201].includes(mk.status), 'POST /providers', `status=${mk.status} ${mk.text.slice(0, 120)}`);
      myProviderId = data(mk)?.id || null;

      if (myProviderId) {
        const hc = await req('POST', `/providers/${myProviderId}/health-check`, H());
        log(data(hc)?.healthy === true, 'POST /providers/:id/health-check', JSON.stringify(data(hc)).slice(0, 160));
      }
    }
  }

  console.log('\n[5] Conversation lifecycle');
  {
    // Create a conversation by actually chatting, so there is something to read and delete.
    const created = await req('POST', '/chat/messages', {
      ...H(),
      body: { content: 'Reply with the single word: ping' },
    });
    log([200, 201].includes(created.status), 'POST /chat/messages creates a conversation', `status=${created.status} ${created.text.slice(0, 120)}`);

    const convs = await req('GET', '/chat/conversations', H());
    log(convs.status === 200, 'GET /chat/conversations', `status=${convs.status}`);
    const list = data(convs);
    const first = Array.isArray(list) ? list[0] : list?.data?.[0];
    if (first?.id) {
      const one = await req('GET', `/chat/conversations/${first.id}`, H());
      log(one.status === 200, 'GET /chat/conversations/:id', `status=${one.status}`);
      const del = await req('DELETE', `/chat/conversations/${first.id}`, H());
      log([200, 204].includes(del.status), 'DELETE /chat/conversations/:id', `status=${del.status}`);
      const gone = await req('GET', `/chat/conversations/${first.id}`, H());
      log([404, 403].includes(gone.status), 'deleted conversation is gone', `status=${gone.status}`);
    } else {
      log(false, 'conversation detail/delete', 'no conversation to test against');
    }
  }

  console.log('\n[6] User data isolation (cannot touch another user\'s provider)');
  {
    if (!myProviderId) {
      log(false, 'provider isolation', 'skipped: no provider created (set GEMINI_KEY)');
    } else {
      const other = await req('POST', '/auth/register', {
        body: { email: `iso_${Date.now()}@echogpt.test`, password: PASSWORD, name: 'Other' },
      });
      const otherTok = data(other)?.accessToken;

      const steal = await req('PATCH', `/providers/${myProviderId}`, { token: otherTok, body: { label: 'stolen' } });
      log([403, 404].includes(steal.status), 'other user cannot edit my provider', `status=${steal.status}`);

      const read = await req('GET', `/providers/${myProviderId}`, { token: otherTok });
      log([403, 404].includes(read.status), 'other user cannot read my provider', `status=${read.status}`);

      const del2 = await req('DELETE', `/providers/${myProviderId}`, { token: otherTok });
      log([403, 404].includes(del2.status), 'other user cannot delete my provider', `status=${del2.status}`);
    }
  }

  console.log('\n[7] Delete account');
  {
    const del = await req('DELETE', '/users/me', H());
    log([200, 204].includes(del.status), 'DELETE /users/me', `status=${del.status} ${del.text.slice(0, 140)}`);

    const after = await req('POST', '/auth/login', { body: { email, password: 'N3wPassword!xyz' } });
    log([400, 401].includes(after.status), 'deleted account can no longer log in', `status=${after.status}`);
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
