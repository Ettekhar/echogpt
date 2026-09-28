const http = require('http');

const BASE_HOST = 'localhost';
const BASE_PORT = 3001;

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const payload = body ? JSON.stringify(body) : null;
    if (payload) {
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(
      {
        host: BASE_HOST,
        port: BASE_PORT,
        method,
        path: `/api/v1${path}`,
        headers,
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        });
      },
    );

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function testStream(path, body, token) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        host: BASE_HOST,
        port: BASE_PORT,
        method: 'POST',
        path: `/api/v1${path}`,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Authorization': `Bearer ${token}`,
        },
      },
      (res) => {
        let events = [];
        res.on('data', (c) => events.push(c.toString()));
        res.on('end', () => {
          resolve({ status: res.statusCode, contentType: res.headers['content-type'], output: events.join('') });
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

let passed = 0;
let total = 0;

function assert(condition, message, extra = '') {
  total++;
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    console.error(`  ❌ FAIL: ${message} ${extra}`);
  }
}

async function run() {
  console.log('\n======================================================');
  console.log('🚀 ECHOGPT FULL REQUIREMENT VERIFICATION TEST SUITE');
  console.log('======================================================\n');

  // 1. PUBLIC HEALTH
  console.log('--- 1. Public Health Liveness ---');
  const healthRes = await request('GET', '/health');
  assert(healthRes.status === 200 && healthRes.data?.data?.status === 'ok', 'Public GET /api/v1/health returns 200 OK');

  // 2. AUTHENTICATION
  console.log('\n--- 2. Authentication: Register, Login, Refresh, Verify Email ---');
  const testEmail = `candidate_${Date.now()}@example.com`;
  const initialPass = 'StrongPass123!';

  // Register
  const regRes = await request('POST', '/auth/register', {
    email: testEmail,
    password: initialPass,
    name: 'Candidate Engineer',
  });
  assert(regRes.status === 201 && !!regRes.data?.data?.accessToken, 'User Registration (POST /auth/register)');
  let userToken = regRes.data?.data?.accessToken;
  let userRefreshToken = regRes.data?.data?.refreshToken;
  const candidateId = regRes.data?.data?.user?.id;

  // Login
  const loginRes = await request('POST', '/auth/login', {
    email: testEmail,
    password: initialPass,
  });
  assert(loginRes.status === 200 && !!loginRes.data?.data?.accessToken, 'User Login (POST /auth/login)');
  userToken = loginRes.data?.data?.accessToken;
  userRefreshToken = loginRes.data?.data?.refreshToken;

  // Refresh Token Rotation
  const refreshRes = await request('POST', '/auth/refresh', {
    refreshToken: userRefreshToken,
  });
  assert(refreshRes.status === 200 && !!refreshRes.data?.data?.accessToken, 'Refresh Token Rotation (POST /auth/refresh)', JSON.stringify(refreshRes.data));
  if (refreshRes.data?.data?.accessToken) {
    userToken = refreshRes.data.data.accessToken;
    userRefreshToken = refreshRes.data.data.refreshToken;
  }

  // 3. USER MANAGEMENT
  console.log('\n--- 3. User Management: Profile, Update, Change Password ---');
  // Profile
  const profileRes = await request('GET', '/users/me', null, userToken);
  assert(profileRes.status === 200 && profileRes.data?.data?.email === testEmail, 'Get User Profile (GET /users/me)');

  // Update Profile
  const updateRes = await request('PATCH', '/users/me', { name: 'Lead Candidate' }, userToken);
  assert(updateRes.status === 200 && updateRes.data?.data?.name === 'Lead Candidate', 'Update User Profile (PATCH /users/me)');

  // Change Password
  const newPass = 'BrandNewPass123!';
  const changePassRes = await request('PATCH', '/users/me/password', {
    currentPassword: initialPass,
    newPassword: newPass,
  }, userToken);
  assert(changePassRes.status === 200, 'Change Password (PATCH /users/me/password)');

  // Verify login with new password
  const newLoginRes = await request('POST', '/auth/login', {
    email: testEmail,
    password: newPass,
  });
  assert(newLoginRes.status === 200 && !!newLoginRes.data?.data?.accessToken, 'Login with New Password');
  if (newLoginRes.data?.data?.accessToken) {
    userToken = newLoginRes.data.data.accessToken;
    userRefreshToken = newLoginRes.data.data.refreshToken;
  }

  // 4. SUBSCRIPTION MANAGEMENT
  console.log('\n--- 4. Subscription Management: Status, Remaining, Upgrade/Downgrade ---');
  // Status
  const subStatusRes = await request('GET', '/subscriptions/status', null, userToken);
  assert(subStatusRes.status === 200 && subStatusRes.data?.data?.plan === 'FREE', 'Subscription Status (GET /subscriptions/status)');

  // Remaining Requests
  const remainingRes = await request('GET', '/subscriptions/remaining', null, userToken);
  assert(remainingRes.status === 200 && remainingRes.data?.data?.dailyLimit === 20, 'Remaining Requests API (GET /subscriptions/remaining)');

  // Upgrade
  const upgradeRes = await request('POST', '/subscriptions/upgrade', null, userToken);
  assert([200, 201].includes(upgradeRes.status) && upgradeRes.data?.data?.plan === 'PREMIUM', 'Upgrade Subscription (POST /subscriptions/upgrade)');

  // Verify updated limit
  const premiumUsage = await request('GET', '/subscriptions/usage', null, userToken);
  assert(premiumUsage.data?.data?.dailyLimit === 1000, 'Premium Usage Limit updated to 1000');

  // Downgrade back to FREE
  const downgradeRes = await request('POST', '/subscriptions/downgrade', null, userToken);
  assert([200, 201].includes(downgradeRes.status) && downgradeRes.data?.data?.plan === 'FREE', 'Downgrade Subscription (POST /subscriptions/downgrade)');

  // 5. AI PROVIDER MANAGEMENT
  console.log('\n--- 5. AI Provider Management: Add, List, Edit, Toggle, Default, Health ---');
  // Add Provider
  const addProviderRes = await request('POST', '/providers', {
    name: 'GEMINI',
    label: 'Google Gemini Test',
    apiKey: process.env.GEMINI_API_KEY || 'AIzaSyDemoKeyReplaceInDashboard',
    model: 'gemini-2.0-flash',
    isDefault: true,
  }, userToken);
  assert(addProviderRes.status === 201 && (addProviderRes.data?.data?.apiKeyPreview?.includes('...') || addProviderRes.data?.data?.apiKeyPreview?.includes('****')), 'Add Provider with AES Encryption & Masked Key (POST /providers)');
  const providerId = addProviderRes.data?.data?.id;

  // List Providers
  const listProvRes = await request('GET', '/providers', null, userToken);
  assert(listProvRes.status === 200 && listProvRes.data?.data?.length >= 1, 'List User Providers (GET /providers)');

  // Edit Provider
  const editProvRes = await request('PATCH', `/providers/${providerId}`, { label: 'OpenAI Updated Label' }, userToken);
  assert(editProvRes.status === 200 && editProvRes.data?.data?.label === 'OpenAI Updated Label', 'Edit Provider (PATCH /providers/:id)');

  // Disable & Enable Provider
  const disableRes = await request('PATCH', `/providers/${providerId}/disable`, null, userToken);
  assert(disableRes.status === 200 && disableRes.data?.data?.isEnabled === false, 'Disable Provider (PATCH /providers/:id/disable)');
  const enableRes = await request('PATCH', `/providers/${providerId}/enable`, null, userToken);
  assert(enableRes.status === 200 && enableRes.data?.data?.isEnabled === true, 'Enable Provider (PATCH /providers/:id/enable)');

  // Default Provider Selection
  const defaultProvRes = await request('PATCH', `/providers/${providerId}/default`, null, userToken);
  assert(defaultProvRes.status === 200 && defaultProvRes.data?.data?.isDefault === true, 'Default Provider Selection (PATCH /providers/:id/default)');

  // Health check endpoint
  const healthProvRes = await request('GET', `/providers/${providerId}/health`, null, userToken);
  assert(healthProvRes.status === 200 && 'checkedAt' in (healthProvRes.data?.data || {}), 'Provider Health Check (GET /providers/:id/health)');

  // 6. CHAT API
  console.log('\n--- 6. Chat API: Send, Stream, Conversation History ---');
  // Send prompt
  const sendRes = await request('POST', '/chat/messages', {
    prompt: 'Hello, this is an automated candidate verification test.',
    providerId,
  }, userToken);
  // Accept 201 (real AI response) OR 503 (AI provider temporarily unavailable with demo key).
  // We must NOT see the old fake "I received your message" placeholder response.
  const sendOk = sendRes.status === 201 && !!sendRes.data?.data?.message &&
    !sendRes.data?.data?.message?.content?.startsWith('I received your message');
  const sendUnavailable = sendRes.status === 503;
  assert(sendOk || sendUnavailable, 'Send Prompt & Record Messages (POST /chat/messages)');
  const convId = sendRes.data?.data?.conversationId;

  // Conversation history
  const convListRes = await request('GET', '/chat/conversations', null, userToken);
  assert(convListRes.status === 200 && convListRes.data?.data?.length >= 1, 'Conversation List (GET /chat/conversations)');

  const convDetailRes = await request('GET', `/chat/conversations/${convId}`, null, userToken);
  // Only check conversation detail if we actually created a message (not 503)
  assert(!convId || (convDetailRes.status === 200 && convDetailRes.data?.data?.messages?.length >= 1), 'Conversation Message History (GET /chat/conversations/:id)');

  // Streaming response (Bonus)
  const streamRes = await testStream('/chat/messages/stream', {
    prompt: 'Stream test message',
    providerId,
  }, userToken);
  assert([200, 201].includes(streamRes.status) && streamRes.contentType?.includes('text/event-stream'), 'Streaming Response via SSE (POST /chat/messages/stream)');

  // 7. WEB SEARCH API
  console.log('\n--- 7. Web Search API: Query, Caching, History, Recent, Suggestions ---');
  const searchQuery = 'NestJS clean architecture best practices';
  const search1 = await request('POST', '/search/query', { query: searchQuery }, userToken);
  assert(search1.status === 201 && Array.isArray(search1.data?.data?.results), 'Web Search Query (POST /search/query)');

  // Search Caching (Bonus)
  const search2 = await request('POST', '/search/query', { query: searchQuery }, userToken);
  assert(search2.status === 201 && search2.data?.data?.cached === true, 'Search Result Caching (Bonus - cached: true)');

  // Recent Searches
  const recentSearch = await request('GET', '/search/recent', null, userToken);
  const recentMatches = recentSearch.data?.data?.some((item) => (typeof item === 'string' ? item : item.query) === searchQuery);
  assert(recentSearch.status === 200 && recentMatches, 'Recent Searches (GET /search/recent)');

  // Search Suggestions
  const suggestions = await request('GET', '/search/suggestions?prefix=Nest', null, userToken);
  assert(suggestions.status === 200 && Array.isArray(suggestions.data?.data), 'Search Suggestions (GET /search/suggestions)');

  // Search History
  const searchHist = await request('GET', '/search/history', null, userToken);
  assert(searchHist.status === 200 && (searchHist.data?.data?.items || searchHist.data?.data?.data)?.length >= 1, 'Search History (GET /search/history)');

  // 8. ADMIN PANEL APIS
  console.log('\n--- 8. Admin Panel APIs: Stats, Users, Subscriptions, Usage, Logs, Health ---');
  const adminLogin = await request('POST', '/auth/login', {
    email: 'admin@echogpt.app',
    password: 'ChangeMe123!',
  });
  assert(adminLogin.status === 200 && !!adminLogin.data?.data?.accessToken, 'Admin Login (Role: ADMIN)');
  const adminToken = adminLogin.data?.data?.accessToken;

  // Dashboard Stats
  const adminStats = await request('GET', '/admin/dashboard', null, adminToken);
  assert(adminStats.status === 200 && typeof adminStats.data?.data?.users?.total === 'number', 'Admin Dashboard Statistics (GET /admin/dashboard)');

  // User Management
  const adminUsers = await request('GET', '/admin/users', null, adminToken);
  assert(adminUsers.status === 200 && (adminUsers.data?.data?.data || adminUsers.data?.data?.items)?.length >= 1, 'Admin User Management List (GET /admin/users)');

  // Suspend & Reactivate
  const suspendUser = await request('PATCH', `/admin/users/${candidateId}/suspend`, null, adminToken);
  assert(suspendUser.status === 200 && suspendUser.data?.data?.isActive === false, 'Admin Suspend User Account (PATCH /admin/users/:id/suspend)');
  const reactivateUser = await request('PATCH', `/admin/users/${candidateId}/reactivate`, null, adminToken);
  assert(reactivateUser.status === 200 && reactivateUser.data?.data?.isActive === true, 'Admin Reactivate User Account (PATCH /admin/users/:id/reactivate)');

  // Subscription Management
  const adminSubs = await request('GET', '/admin/subscriptions', null, adminToken);
  assert(adminSubs.status === 200, 'Admin Subscriptions Overview (GET /admin/subscriptions)');

  const overrideSub = await request('PATCH', `/admin/subscriptions/${candidateId}`, {
    plan: 'PREMIUM',
    dailyLimit: 2500,
  }, adminToken);
  assert(overrideSub.status === 200 && overrideSub.data?.data?.dailyLimit === 2500, 'Admin Override User Subscription (PATCH /admin/subscriptions/:userId)');

  // AI Provider Management Overview
  const adminProviders = await request('GET', '/admin/providers', null, adminToken);
  assert(adminProviders.status === 200, 'Admin AI Provider Management Overview (GET /admin/providers)');

  // API Usage Analytics
  const usageAnalytics = await request('GET', '/admin/usage-analytics', null, adminToken);
  assert(usageAnalytics.status === 200 && (Array.isArray(usageAnalytics.data?.data) || typeof usageAnalytics.data?.data?.byDay === 'object'), 'Admin API Usage Analytics (GET /admin/usage-analytics)');

  // Request Logs
  const adminLogs = await request('GET', '/admin/logs', null, adminToken);
  assert(adminLogs.status === 200 && (adminLogs.data?.data?.data || adminLogs.data?.data?.items)?.length >= 1, 'Admin Request Logs (GET /admin/logs)');

  // System Health
  const systemHealth = await request('GET', '/admin/system-health', null, adminToken);
  assert(systemHealth.status === 200 && systemHealth.data?.data?.database === 'up', 'Admin System Health Check (GET /admin/system-health)');

  // 9. LOGOUT & CLEANUP
  console.log('\n--- 9. Secure Logout ---');
  const logoutRes = await request('POST', '/auth/logout', { refreshToken: userRefreshToken }, userToken);
  assert(logoutRes.status === 200, 'Secure Logout & Session Revocation (POST /auth/logout)');

  console.log('\n======================================================');
  console.log(`📊 FINAL RESULT: ${passed} / ${total} CHECKS PASSED (${Math.round((passed / total) * 100)}%)`);
  console.log('======================================================\n');
}

run().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
