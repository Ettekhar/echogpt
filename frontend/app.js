/**
 * EchoGPT Frontend Application Logic
 * Integrates directly with the NestJS backend
 */

(function () {
  'use strict';

  // State
  const state = {
    apiBase: localStorage.getItem('echogpt_api_base') || (
      window.location.origin.includes(':3001') ? `${window.location.origin}/api/v1` : 'http://localhost:3001/api/v1'
    ),
    token: localStorage.getItem('echogpt_token') || null,
    user: JSON.parse(localStorage.getItem('echogpt_user') || 'null'),
    currentProvider: 'OPENAI',
    currentModel: 'gpt-4o',
    webSearchEnabled: false,
    streamingEnabled: false,
    activeTab: 'chat',
    viewMode: 'sidebar', // 'sidebar' | 'admin'
    currentConversationId: null,
  };

  // Helper: API Request
  async function apiRequest(endpoint, options = {}) {
    const url = `${state.apiBase}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };

    if (state.token) {
      headers['Authorization'] = `Bearer ${state.token}`;
    }

    try {
      const res = await fetch(url, { ...options, headers });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || `HTTP error ${res.status}`);
      }
      return data;
    } catch (err) {
      console.warn(`[API] Error on ${endpoint}:`, err);
      throw err;
    }
  }

  // DOM Elements
  const el = {
    // Topbar
    apiStatusPill: document.getElementById('apiStatusPill'),
    apiStatusLabel: document.getElementById('apiStatusLabel'),
    btnViewSidebar: document.getElementById('btnViewSidebar'),
    btnViewAdmin: document.getElementById('btnViewAdmin'),
    userProfileArea: document.getElementById('userProfileArea'),
    btnOpenAuth: document.getElementById('btnOpenAuth'),
    linkSwagger: document.getElementById('linkSwagger'),

    // Views
    mockWebpage: document.getElementById('mockWebpage'),
    echogptSidebar: document.getElementById('echogptSidebar'),
    adminPortalView: document.getElementById('adminPortalView'),

    // Chat
    chatMessages: document.getElementById('chatMessages'),
    chatWelcome: document.getElementById('chatWelcome'),
    txtChatInput: document.getElementById('txtChatInput'),
    btnSendChat: document.getElementById('btnSendChat'),
    btnNewChat: document.getElementById('btnNewChat'),
    btnProviderSelect: document.getElementById('btnProviderSelect'),
    lblCurrentProvider: document.getElementById('lblCurrentProvider'),
    providerMenu: document.getElementById('providerMenu'),
    btnToggleWebSearch: document.getElementById('btnToggleWebSearch'),
    lblSearchIndicator: document.getElementById('lblSearchIndicator'),
    btnStreamingToggle: document.getElementById('btnStreamingToggle'),

    // Write Studio
    txtWriteTopic: document.getElementById('txtWriteTopic'),
    pillsFormat: document.getElementById('pillsFormat'),
    pillsTone: document.getElementById('pillsTone'),
    pillsLength: document.getElementById('pillsLength'),
    selWriteLanguage: document.getElementById('selWriteLanguage'),
    btnGenerateWrite: document.getElementById('btnGenerateWrite'),
    writeResultCard: document.getElementById('writeResultCard'),
    writeResultBody: document.getElementById('writeResultBody'),

    // Translate
    selTransSource: document.getElementById('selTransSource'),
    selTransTarget: document.getElementById('selTransTarget'),
    btnSwapLanguages: document.getElementById('btnSwapLanguages'),
    txtTranslateSource: document.getElementById('txtTranslateSource'),
    btnRunTranslate: document.getElementById('btnRunTranslate'),
    transResultCard: document.getElementById('transResultCard'),
    transResultBody: document.getElementById('transResultBody'),

    // Search
    txtSearchQuery: document.getElementById('txtSearchQuery'),
    btnExecuteSearch: document.getElementById('btnExecuteSearch'),
    searchResultsArea: document.getElementById('searchResultsArea'),

    // Providers
    providersList: document.getElementById('providersList'),
    btnOpenAddProviderModal: document.getElementById('btnOpenAddProviderModal'),

    // Usage
    lblPlanBadge: document.getElementById('lblPlanBadge'),
    lblRequestsUsed: document.getElementById('lblRequestsUsed'),
    lblDailyLimit: document.getElementById('lblDailyLimit'),
    meterFill: document.getElementById('meterFill'),
    btnUpgradePremium: document.getElementById('btnUpgradePremium'),
    btnDowngradeFree: document.getElementById('btnDowngradeFree'),

    // Admin
    valTotalUsers: document.getElementById('valTotalUsers'),
    valActiveSubscriptions: document.getElementById('valActiveSubscriptions'),
    valTotalRequests: document.getElementById('valTotalRequests'),
    valSystemHealth: document.getElementById('valSystemHealth'),
    lblUptime: document.getElementById('lblUptime'),
    tblUsersBody: document.getElementById('tblUsersBody'),
    btnRefreshAdminStats: document.getElementById('btnRefreshAdminStats'),
    btnReturnToExtension: document.getElementById('btnReturnToExtension'),

    // Modals
    modalAuth: document.getElementById('modalAuth'),
    modalAddProvider: document.getElementById('modalAddProvider'),
    modalConfigApi: document.getElementById('modalConfigApi'),
    authErrorNotice: document.getElementById('authErrorNotice'),
    txtApiBaseUrl: document.getElementById('txtApiBaseUrl'),
  };

  // =========================================================================
  // INITIALIZATION & CONNECTION TEST
  // =========================================================================
  async function init() {
    updateSwaggerLink();
    checkHealth();
    renderUserUI();
    setupEventListeners();

    // Auto login as admin if no user exists so demo is immediately usable
    if (!state.user) {
      try {
        await loginWithCredentials('admin@echogpt.app', 'ChangeMe123!');
      } catch (_) {
        // If not seeded, user can use modal
      }
    } else {
      refreshSubscription();
      loadProviders();
    }
  }

  function updateSwaggerLink() {
    if (el.linkSwagger) {
      el.linkSwagger.href = `${state.apiBase}/docs`;
    }
  }

  async function checkHealth() {
    try {
      const res = await apiRequest('/admin/system-health');
      if (res && res.data && res.data.status === 'ok') {
        el.apiStatusLabel.textContent = 'API Connected';
        el.apiStatusPill.querySelector('.status-dot').className = 'status-dot';
      }
    } catch (_) {
      el.apiStatusLabel.textContent = 'API Offline';
      el.apiStatusPill.querySelector('.status-dot').className = 'status-dot disconnected';
    }
  }

  // =========================================================================
  // VIEW & TAB SWITCHING
  // =========================================================================
  function setViewMode(mode) {
    state.viewMode = mode;
    if (mode === 'admin') {
      el.btnViewSidebar.classList.remove('active');
      el.btnViewAdmin.classList.add('active');
      el.mockWebpage.classList.add('hidden');
      el.echogptSidebar.classList.add('collapsed');
      el.adminPortalView.classList.remove('hidden');
      loadAdminDashboard();
    } else {
      el.btnViewAdmin.classList.remove('active');
      el.btnViewSidebar.classList.add('active');
      el.adminPortalView.classList.add('hidden');
      el.mockWebpage.classList.remove('hidden');
      el.echogptSidebar.classList.remove('collapsed');
    }
  }

  function switchTab(tabId) {
    state.activeTab = tabId;
    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
    });

    document.querySelectorAll('.tab-pane').forEach(pane => {
      pane.classList.remove('active');
    });

    const targetPaneId = `pane${tabId.charAt(0).toUpperCase() + tabId.slice(1)}`;
    const targetPane = document.getElementById(targetPaneId);
    if (targetPane) {
      targetPane.classList.add('active');
    }

    if (tabId === 'usage') refreshSubscription();
    if (tabId === 'providers') loadProviders();
  }

  // =========================================================================
  // AUTHENTICATION
  // =========================================================================
  async function loginWithCredentials(email, password) {
    try {
      el.authErrorNotice.classList.add('hidden');
      const res = await apiRequest('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });

      if (res.data && res.data.accessToken) {
        state.token = res.data.accessToken;
        state.user = res.data.user;
        localStorage.setItem('echogpt_token', state.token);
        localStorage.setItem('echogpt_user', JSON.stringify(state.user));

        renderUserUI();
        closeAuthModal();
        refreshSubscription();
        loadProviders();
        return res;
      }
    } catch (err) {
      el.authErrorNotice.textContent = err.message || 'Login failed. Please check credentials.';
      el.authErrorNotice.classList.remove('hidden');
      throw err;
    }
  }

  async function handleRegister() {
    const email = document.getElementById('authEmail').value;
    const password = document.getElementById('authPassword').value;
    try {
      el.authErrorNotice.classList.add('hidden');
      const res = await apiRequest('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, name: email.split('@')[0] }),
      });
      if (res.data && res.data.accessToken) {
        state.token = res.data.accessToken;
        state.user = res.data.user;
        localStorage.setItem('echogpt_token', state.token);
        localStorage.setItem('echogpt_user', JSON.stringify(state.user));
        renderUserUI();
        closeAuthModal();
      }
    } catch (err) {
      el.authErrorNotice.textContent = err.message || 'Registration failed.';
      el.authErrorNotice.classList.remove('hidden');
    }
  }

  function logout() {
    state.token = null;
    state.user = null;
    localStorage.removeItem('echogpt_token');
    localStorage.removeItem('echogpt_user');
    renderUserUI();
  }

  function renderUserUI() {
    if (state.user) {
      el.userProfileArea.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:12px;color:#cbd5e1;font-weight:600;">${state.user.name || state.user.email}</span>
          <span class="badge-role" style="font-size:10px;">${state.user.role}</span>
          <button id="btnLogout" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:12px;text-decoration:underline;">Logout</button>
        </div>
      `;
      document.getElementById('btnLogout').addEventListener('click', logout);
      const avatar = document.getElementById('avatarBadge');
      if (avatar) avatar.textContent = (state.user.name || state.user.email).charAt(0).toUpperCase();
    } else {
      el.userProfileArea.innerHTML = `
        <button id="btnOpenAuth" class="btn-auth-primary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          Sign In
        </button>
      `;
      document.getElementById('btnOpenAuth').addEventListener('click', openAuthModal);
    }
  }

  // =========================================================================
  // CHAT LOGIC
  // =========================================================================
  function quickPrompt(text) {
    switchTab('chat');
    el.txtChatInput.value = text;
    sendChatMessage();
  }

  async function sendChatMessage() {
    const text = el.txtChatInput.value.trim();
    if (!text) return;

    if (el.chatWelcome) {
      el.chatWelcome.classList.add('hidden');
    }

    // Append User Message
    appendMessageBubble('user', text);
    el.txtChatInput.value = '';

    // Append Assistant Loading Indicator
    const assistantBubble = appendMessageBubble('assistant', 'Thinking...');

    try {
      const payload = {
        prompt: text,
      };
      if (state.currentConversationId) {
        payload.conversationId = state.currentConversationId;
      }

      const res = await apiRequest('/chat/messages', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (res && res.data) {
        state.currentConversationId = res.data.conversationId;
        const replyText = res.data.message?.content || res.data.reply || 'No content received.';
        assistantBubble.querySelector('.msg-bubble').innerHTML = formatMarkdown(replyText);

        if (res.data.citations && res.data.citations.length > 0) {
          const citBox = document.createElement('div');
          citBox.className = 'citations-box';
          citBox.innerHTML = `<strong>Sources:</strong> ` + res.data.citations.map((c, i) =>
            `<a href="${c.url}" target="_blank" style="color:var(--primary);margin-right:6px;">[${i+1}] ${c.title || 'Source'}</a>`
          ).join('');
          assistantBubble.appendChild(citBox);
        }
      }
    } catch (err) {
      assistantBubble.querySelector('.msg-bubble').innerHTML = `
        <span style="color:#ef4444;">⚠️ ${err.message || 'Unable to connect to AI provider. Please configure an API key in AI Models tab.'}</span>
      `;
    }

    el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
  }

  function appendMessageBubble(role, content) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-msg ${role}`;
    msgDiv.innerHTML = `
      <div class="msg-header">${role === 'user' ? 'You' : 'EchoGPT (' + state.currentProvider + ')'}</div>
      <div class="msg-bubble">${formatMarkdown(content)}</div>
    `;
    el.chatMessages.appendChild(msgDiv);
    el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
    return msgDiv;
  }

  function formatMarkdown(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code style="background:rgba(0,0,0,0.06);padding:2px 4px;border-radius:4px;">$1</code>')
      .replace(/\n/g, '<br/>');
  }

  function startNewChat() {
    state.currentConversationId = null;
    el.chatMessages.innerHTML = '';
    if (el.chatWelcome) {
      el.chatMessages.appendChild(el.chatWelcome);
      el.chatWelcome.classList.remove('hidden');
    }
  }

  // =========================================================================
  // WRITE STUDIO LOGIC (Matches screenshot 4)
  // =========================================================================
  function getSelectedPillVal(container) {
    const active = container.querySelector('.filter-pill.active');
    return active ? active.getAttribute('data-val') : 'Automatic';
  }

  async function generateWriteContent() {
    const topic = el.txtWriteTopic.value.trim();
    if (!topic) {
      alert('Please enter a topic to write about.');
      return;
    }

    const mode = document.querySelector('#writeModeTabs .seg-btn.active').getAttribute('data-mode');
    const format = getSelectedPillVal(el.pillsFormat);
    const tone = getSelectedPillVal(el.pillsTone);
    const length = getSelectedPillVal(el.pillsLength);
    const language = el.selWriteLanguage.value;

    const prompt = `Mode: ${mode}. Write a ${format} with ${tone} tone and ${length} length about: "${topic}". Output language: ${language}.`;

    el.btnGenerateWrite.disabled = true;
    el.btnGenerateWrite.innerHTML = '<span class="btn-sparkle">✦</span> Generating...';

    try {
      const res = await apiRequest('/chat/messages', {
        method: 'POST',
        body: JSON.stringify({ prompt }),
      });

      if (res && res.data) {
        el.writeResultBody.textContent = res.data.message?.content || res.data.reply || '';
        el.writeResultCard.classList.remove('hidden');
      }
    } catch (err) {
      alert(`Error generating content: ${err.message}`);
    } finally {
      el.btnGenerateWrite.disabled = false;
      el.btnGenerateWrite.innerHTML = '<span class="btn-sparkle">✦</span> Generate Content';
    }
  }

  function resetWriteForm() {
    el.txtWriteTopic.value = '';
    el.writeResultCard.classList.add('hidden');
  }

  function copyWriteResult() {
    const text = el.writeResultBody.textContent;
    navigator.clipboard.writeText(text);
    alert('Copied generated text to clipboard!');
  }

  // =========================================================================
  // TRANSLATE LOGIC
  // =========================================================================
  async function runTranslation() {
    const text = el.txtTranslateSource.value.trim();
    if (!text) return;

    const source = el.selTransSource.value;
    const target = el.selTransTarget.value;
    const prompt = `Translate the following text from ${source} to ${target}. Output only the translation:\n\n${text}`;

    el.btnRunTranslate.disabled = true;
    el.btnRunTranslate.textContent = 'Translating...';

    try {
      const res = await apiRequest('/chat/messages', {
        method: 'POST',
        body: JSON.stringify({ prompt }),
      });

      if (res && res.data) {
        el.transResultBody.textContent = res.data.message?.content || res.data.reply || '';
        el.transResultCard.classList.remove('hidden');
      }
    } catch (err) {
      alert(`Translation error: ${err.message}`);
    } finally {
      el.btnRunTranslate.disabled = false;
      el.btnRunTranslate.textContent = 'Translate Text';
    }
  }

  function swapLanguages() {
    const src = el.selTransSource.value;
    const tgt = el.selTransTarget.value;
    if (src !== 'Automatic') {
      el.selTransSource.value = tgt;
      el.selTransTarget.value = src;
    }
  }

  function copyTranslateResult() {
    const text = el.transResultBody.textContent;
    navigator.clipboard.writeText(text);
    alert('Copied translation to clipboard!');
  }

  // =========================================================================
  // AI WEB SEARCH LOGIC
  // =========================================================================
  async function runSearch(queryText) {
    const q = queryText || el.txtSearchQuery.value.trim();
    if (!q) return;
    el.txtSearchQuery.value = q;
    el.searchResultsArea.innerHTML = `<div class="empty-hint">Searching web and generating AI answer...</div>`;

    try {
      const res = await apiRequest('/search/query', {
        method: 'POST',
        body: JSON.stringify({ query: q }),
      });

      if (res && res.data) {
        const d = res.data;
        let html = `
          <div style="background:#f8fafc;padding:14px;border-radius:12px;border:1px solid #e2e8f0;margin-bottom:12px;">
            <div style="font-weight:700;margin-bottom:6px;font-size:13px;">AI Search Summary:</div>
            <div style="font-size:13px;line-height:1.5;">${formatMarkdown(d.answer || d.summary || 'Search complete.')}</div>
          </div>
        `;

        const items = Array.isArray(d.results) ? d.results : (d.results?.items || d.items || []);

        if (items.length > 0) {
          html += `<div style="font-weight:700;font-size:12px;margin-bottom:8px;color:#64748b;">Web Sources (${items.length}):</div>`;
          items.forEach(item => {
            html += `
              <div style="margin-bottom:10px;padding:10px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;">
                <a href="${item.url}" target="_blank" rel="noopener noreferrer" style="font-weight:600;font-size:13px;color:var(--primary);text-decoration:none;">${item.title || item.url}</a>
                <div style="font-size:11.5px;color:#64748b;margin-top:2px;">${item.snippet || ''}</div>
              </div>
            `;
          });
        }

        el.searchResultsArea.innerHTML = html;
      }
    } catch (err) {
      el.searchResultsArea.innerHTML = `<div class="error-notice">Search error: ${err.message}</div>`;
    }
  }

  // =========================================================================
  // PROVIDERS LOGIC
  // =========================================================================
  async function loadProviders() {
    if (!state.token) return;
    try {
      const res = await apiRequest('/providers');
      if (res && res.data) {
        renderProvidersList(res.data);
      }
    } catch (_) {}
  }

  function renderProvidersList(providers) {
    if (!providers || providers.length === 0) {
      el.providersList.innerHTML = `
        <div style="background:#f8fafc;border:1px dashed #cbd5e1;padding:18px;border-radius:12px;text-align:center;">
          <p style="font-size:13px;color:#64748b;margin-bottom:10px;">No custom API keys added yet.</p>
          <button class="pill-btn primary" onclick="window.EchoApp.openProviderModal()">+ Add OpenAI / Claude / Gemini Key</button>
        </div>
      `;
      return;
    }

    el.providersList.innerHTML = providers.map(p => `
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-weight:700;font-size:13px;">${p.label || p.name} <span class="badge-role" style="font-size:9.5px;">${p.name}</span></div>
          <div style="font-size:11px;color:#64748b;font-family:var(--font-mono);margin-top:2px;">Key: ${p.encryptedApiKey ? 'sk-••••••••' : 'Configured'}</div>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="pill-btn" style="background:#f1f5f9;font-size:11px;" onclick="window.EchoApp.testProviderHealth('${p.id}')">Test</button>
          <button class="pill-btn" style="background:#fee2e2;color:#b91c1c;font-size:11px;" onclick="window.EchoApp.deleteProvider('${p.id}')">Delete</button>
        </div>
      </div>
    `).join('');
  }

  async function handleAddProviderSubmit(e) {
    e.preventDefault();
    const name = document.getElementById('newProviderName').value;
    if (!name) {
      alert('Please select a valid AI provider from the dropdown.');
      return;
    }
    const apiKey = document.getElementById('newProviderKey').value.trim();
    const label = document.getElementById('newProviderLabel').value.trim() || undefined;
    const model = document.getElementById('newProviderModel')?.value.trim() || undefined;
    const baseUrl = document.getElementById('newProviderBaseUrl')?.value.trim() || undefined;

    try {
      await apiRequest('/providers', {
        method: 'POST',
        body: JSON.stringify({ name, apiKey, label, model, baseUrl, isDefault: true }),
      });
      closeProviderModal();
      loadProviders();
      alert('Provider API key saved and encrypted at rest!');
    } catch (err) {
      alert(`Error saving provider: ${err.message}`);
    }
  }

  async function testProviderHealth(id) {
    try {
      const res = await apiRequest(`/providers/${id}/health-check`, { method: 'POST' });
      const isOk = res.data && (res.data.healthy ?? res.data.isHealthy);
      alert(`Health Check: ${isOk ? 'Healthy ✅' : 'Unavailable ❌'}`);
    } catch (err) {
      alert(`Health Check result: ${err.message}`);
    }
  }

  async function deleteProvider(id) {
    if (!confirm('Are you sure you want to remove this provider?')) return;
    try {
      await apiRequest(`/providers/${id}`, { method: 'DELETE' });
      loadProviders();
    } catch (err) {
      alert(err.message);
    }
  }

  // =========================================================================
  // SUBSCRIPTION & USAGE
  // =========================================================================
  async function refreshSubscription() {
    if (!state.token) return;
    try {
      const res = await apiRequest('/subscriptions/status');
      if (res && res.data) {
        const sub = res.data;
        el.lblPlanBadge.textContent = `${sub.plan} PLAN`;
        el.lblRequestsUsed.textContent = `${sub.requestsUsed} used`;
        el.lblDailyLimit.textContent = `${sub.dailyLimit} daily limit`;
        const pct = Math.min(100, Math.round((sub.requestsUsed / (sub.dailyLimit || 1)) * 100));
        el.meterFill.style.width = `${Math.max(5, pct)}%`;
      }
    } catch (_) {}
  }

  async function changePlan(planType) {
    try {
      await apiRequest('/subscriptions/plan', {
        method: 'PATCH',
        body: JSON.stringify({ plan: planType }),
      });
      refreshSubscription();
      alert(`Updated subscription to ${planType} plan!`);
    } catch (err) {
      alert(err.message);
    }
  }

  // =========================================================================
  // ADMIN DASHBOARD
  // =========================================================================
  async function loadAdminDashboard() {
    if (!state.token) {
      openAuthModal();
      return;
    }

    try {
      const [dashRes, healthRes, usersRes] = await Promise.allSettled([
        apiRequest('/admin/dashboard'),
        apiRequest('/admin/system-health'),
        apiRequest('/admin/users'),
      ]);

      if (dashRes.status === 'fulfilled' && dashRes.value && dashRes.value.data) {
        const d = dashRes.value.data;
        el.valTotalUsers.textContent = d.users?.total ?? d.totalUsers ?? 1;
        el.valActiveSubscriptions.textContent = d.subscriptions?.premium ?? d.activeSubscriptions ?? 1;
        el.valTotalRequests.textContent = d.requestsToday ?? d.usage?.messages ?? d.totalRequests ?? 0;
      }

      if (healthRes.status === 'fulfilled' && healthRes.value && healthRes.value.data) {
        const h = healthRes.value.data;
        el.valSystemHealth.textContent = (h.status || 'OK').toUpperCase();
        el.lblUptime.textContent = `Uptime: ${h.uptimeSeconds || 0}s · Database: ${h.database || 'up'}`;
      }

      if (usersRes.status === 'fulfilled' && usersRes.value && usersRes.value.data) {
        renderUsersTable(usersRes.value.data);
      } else if (usersRes.status === 'rejected') {
        el.tblUsersBody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#ef4444;padding:16px;">Failed to load users: ${usersRes.reason?.message || 'Admin authentication required.'}</td></tr>`;
      }
    } catch (err) {
      console.error('Error loading admin metrics:', err);
      el.tblUsersBody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#ef4444;padding:16px;">Error: ${err.message}</td></tr>`;
    }
  }

  function renderUsersTable(users) {
    const list = Array.isArray(users) ? users : (users && Array.isArray(users.data) ? users.data : []);
    if (!list || list.length === 0) {
      el.tblUsersBody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:16px;color:#64748b;">No registered users found.</td></tr>`;
      return;
    }

    el.tblUsersBody.innerHTML = list.map(u => `
      <tr>
        <td style="font-family:var(--font-mono);font-size:11px;">${u.id.substring(0, 8)}...</td>
        <td style="font-weight:600;">${u.email}</td>
        <td>${u.name || '—'}</td>
        <td><span class="badge-role">${u.role}</span></td>
        <td>${u.isEmailVerified ? '✅ Yes' : '❌ No'}</td>
        <td>${u.isActive ? '<span style="color:#10b981;">Active</span>' : '<span style="color:#ef4444;">Suspended</span>'}</td>
        <td style="color:#64748b;font-size:11.5px;">${new Date(u.createdAt).toLocaleDateString()}</td>
      </tr>
    `).join('');
  }

  // =========================================================================
  // EVENT LISTENERS & SETUP
  // =========================================================================
  function setupEventListeners() {
    // View Toggles
    el.btnViewSidebar.addEventListener('click', () => setViewMode('sidebar'));
    el.btnViewAdmin.addEventListener('click', () => setViewMode('admin'));
    document.getElementById('btnAdminShortcut').addEventListener('click', () => setViewMode('admin'));
    el.btnReturnToExtension.addEventListener('click', () => setViewMode('sidebar'));
    el.btnRefreshAdminStats.addEventListener('click', loadAdminDashboard);

    // Sidebar tab buttons
    document.querySelectorAll('.nav-tab-btn[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        switchTab(btn.getAttribute('data-tab'));
      });
    });

    // Chat events
    el.btnSendChat.addEventListener('click', sendChatMessage);
    el.txtChatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    });
    el.btnNewChat.addEventListener('click', startNewChat);

    // Provider dropdown toggle
    el.btnProviderSelect.addEventListener('click', (e) => {
      e.stopPropagation();
      el.providerMenu.classList.toggle('show');
    });

    document.querySelectorAll('.provider-menu .menu-item').forEach(item => {
      item.addEventListener('click', () => {
        state.currentProvider = item.getAttribute('data-provider');
        state.currentModel = item.getAttribute('data-model');
        el.lblCurrentProvider.textContent = item.textContent.trim();
        document.querySelectorAll('.provider-menu .menu-item').forEach(m => m.classList.remove('active'));
        item.classList.add('active');
        el.providerMenu.classList.remove('show');
      });
    });

    document.addEventListener('click', () => {
      el.providerMenu.classList.remove('show');
    });

    // Web Search Toggle in Chat
    el.btnToggleWebSearch.addEventListener('click', () => {
      state.webSearchEnabled = !state.webSearchEnabled;
      el.btnToggleWebSearch.classList.toggle('active', state.webSearchEnabled);
      el.lblSearchIndicator.classList.toggle('hidden', !state.webSearchEnabled);
    });

    // Streaming Toggle in Chat
    el.btnStreamingToggle.addEventListener('click', () => {
      state.streamingEnabled = !state.streamingEnabled;
      el.btnStreamingToggle.classList.toggle('active', state.streamingEnabled);
    });

    // Write Studio Pill filters
    ['pillsFormat', 'pillsTone', 'pillsLength'].forEach(id => {
      const container = document.getElementById(id);
      if (container) {
        container.querySelectorAll('.filter-pill').forEach(pill => {
          pill.addEventListener('click', () => {
            container.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
          });
        });
      }
    });

    document.querySelectorAll('#writeModeTabs .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#writeModeTabs .seg-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    el.btnGenerateWrite.addEventListener('click', generateWriteContent);

    // Translate events
    el.btnRunTranslate.addEventListener('click', runTranslation);
    el.btnSwapLanguages.addEventListener('click', swapLanguages);

    // Search events
    el.btnExecuteSearch.addEventListener('click', () => runSearch());
    el.txtSearchQuery.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') runSearch();
    });

    // Subscriptions
    el.btnUpgradePremium.addEventListener('click', () => changePlan('PREMIUM'));
    el.btnDowngradeFree.addEventListener('click', () => changePlan('FREE'));

    // Sidebar Close / Toggle in Mock Webpage
    document.getElementById('btnCloseSidebar').addEventListener('click', () => {
      el.echogptSidebar.classList.toggle('collapsed');
    });
    document.getElementById('btnToggleSidebarMock').addEventListener('click', () => {
      el.echogptSidebar.classList.toggle('collapsed');
    });

    // API Config Pill
    el.apiStatusPill.addEventListener('click', openApiModal);
    if (el.btnOpenAddProviderModal) {
      el.btnOpenAddProviderModal.addEventListener('click', openProviderModal);
    }
  }

  // Modal helpers
  function openAuthModal() { el.modalAuth.classList.remove('hidden'); }
  function closeAuthModal() { el.modalAuth.classList.add('hidden'); }
  function openProviderModal() { el.modalAddProvider.classList.remove('hidden'); }
  function closeProviderModal() { el.modalAddProvider.classList.add('hidden'); }
  function openApiModal() {
    el.txtApiBaseUrl.value = state.apiBase;
    el.modalConfigApi.classList.remove('hidden');
  }
  function closeApiModal() { el.modalConfigApi.classList.add('hidden'); }

  function saveApiBaseUrl() {
    const val = el.txtApiBaseUrl.value.trim();
    if (val) {
      state.apiBase = val.replace(/\/+$/, '');
      localStorage.setItem('echogpt_api_base', state.apiBase);
      updateSwaggerLink();
      closeApiModal();
      checkHealth();
    }
  }

  // Export to window for inline onclick handlers
  window.EchoApp = {
    switchTab,
    quickPrompt,
    resetWriteForm,
    copyWriteResult,
    copyTranslateResult,
    runSearch,
    openAuthModal,
    closeAuthModal,
    loginWithCredentials,
    handleRegister,
    openProviderModal,
    closeProviderModal,
    handleAddProviderSubmit,
    testProviderHealth,
    deleteProvider,
    openApiModal,
    closeApiModal,
    saveApiBaseUrl,
  };

  // Launch app
  document.addEventListener('DOMContentLoaded', init);
})();
