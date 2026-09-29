/**
 * EchoGPT Frontend Application Logic
 * Integrates directly with the NestJS backend
 */

(function () {
  'use strict';

  // Resolve the API base URL. See frontend/config.js for the precedence rules.
  // A previously saved override always wins so a user who pointed the switcher at
  // their own backend is never silently moved to a different one.
  function resolveApiBase() {
    const saved = localStorage.getItem('echogpt_api_base');
    if (saved) return saved;

    // If this page is being served from a local address, the API is almost
    // certainly the server that served it - src/main.ts mounts frontend/ as
    // static assets. Prefer same-origin in that case.
    //
    // This has to be checked BEFORE the configured apiBase, and the reason is
    // that config.js carries whatever public URL the demo was last published
    // with. A quick-tunnel hostname goes stale the moment the tunnel restarts,
    // and a freshly cloned repo ships that stale value. Trusting it first meant
    // a local run pointed at a dead tunnel instead of the working API on the
    // same origin, which looked exactly like "the demo does not connect".
    const host = window.location.hostname;
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
    if (isLocal) {
      return `${window.location.origin}/api/v1`;
    }

    const configured = window.ECHOGPT_CONFIG && window.ECHOGPT_CONFIG.apiBase;
    if (configured) return configured.replace(/\/+$/, '');

    return 'http://localhost:3001/api/v1';
  }

  // Every base worth trying, primary first. A quick tunnel's hostname changes on
  // every restart, so having a second permanent host in the list is what keeps
  // the deployed demo from going dark when that happens.
  function apiBaseCandidates() {
    const configured = window.ECHOGPT_CONFIG || {};
    const list = [state.apiBase];
    const fallbacks = Array.isArray(configured.apiBaseFallbacks) ? configured.apiBaseFallbacks : [];
    for (const fb of fallbacks) {
      const clean = String(fb || '').trim().replace(/\/+$/, '');
      if (clean && !list.includes(clean)) list.push(clean);
    }
    return list;
  }

  // State
  const state = {
    apiBase: resolveApiBase(),
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

  // The login/refresh/logout calls themselves must not trigger the
  // session-expired handler, or a failed sign-in would clear state that is
  // about to be replaced and loop.
  function isAuthEndpoint(endpoint) {
    return /^\/(auth|health)/.test(endpoint);
  }

  // =========================================================================
  // API REQUEST MONITOR
  // Every call this page makes to the backend is logged live. During a demo
  // this is the difference between "trust me, it works" and a reviewer watching
  // POST /chat/messages go out and come back 201. Clicking a row copies the
  // request as curl so it can be replayed in Postman or a terminal.
  // =========================================================================
  const apiLog = [];
  const API_LOG_MAX = 60;
  let _apiLogSeq = 0;

  // ==========================================================================
  // WHICH DOCUMENT THE CONSOLE IS IN
  //
  // The console can be docked in this page or floating in a window of its own,
  // the way devtools can be undocked. A second window is a second document with
  // its own viewport, its own copy of every element and its own user activation,
  // so nothing in this section may reach for the global `document` or `window`:
  // a lookup there silently returns null once the console has been moved out, and
  // the log would stop updating in the very window the user is watching.
  //
  // Only the two elements that belong to the *page* - the tab button and its
  // request counter - are still looked up in the global document, because the
  // counter has to keep ticking while the console is somewhere else.
  // ==========================================================================
  const AM_STORE = 'echogpt_api_monitor_window';
  const AM_FLOAT_FLAG = 'echogpt_api_monitor_floating';
  const AM_FLOAT_NAME = 'echogpt_api_console';

  let _amDocked = null;   // the panel as it lives in the page
  let _amRoot = null;     // the panel currently on screen
  let _amFloatWin = null; // its window, while floating

  function amDockedPanel() {
    if (!_amDocked) _amDocked = document.getElementById('apiMonitorPanel');
    return _amDocked;
  }

  function amRoot() {
    return _amRoot || amDockedPanel();
  }

  function amIsFloating() {
    const p = _amRoot;
    return !!(p && p.ownerDocument && p.ownerDocument !== document);
  }

  function amDoc() {
    const p = amRoot();
    return (p && p.ownerDocument) || document;
  }

  function amWin() {
    return amDoc().defaultView || window;
  }

  function amFind(id) {
    const p = amRoot();
    return p ? p.querySelector('#' + id) : null;
  }

  function amViewport() {
    const w = amWin();
    return { w: w.innerWidth || 0, h: w.innerHeight || 0 };
  }

  function apiMonitorEls() {
    return {
      panel: amRoot(),
      list: amFind('apiMonitorList'),
      summary: amFind('apiMonitorSummary'),
      host: amFind('apiMonitorHost'),
      // Page furniture, not console furniture: always resolved in the page.
      badge: document.getElementById('apiMonitorBadge'),
      toggle: document.getElementById('apiMonitorToggle'),
    };
  }

  function setApiMonitorHost() {
    // Deliberately not cached: the element belongs to whichever document the
    // console is in, and that changes when it is popped out and docked again.
    const host = amFind('apiMonitorHost');
    if (!host) return;
    try {
      host.textContent = state.apiBase.replace(/^https?:\/\//, '').replace(/\/api\/v1\/?$/, '');
    } catch (_) { /* ignore */ }
  }

  function renderApiLog() {
    const { list, badge, summary, toggle } = apiMonitorEls();
    if (!list) return;

    if (apiLog.length === 0) {
      list.innerHTML = '<div class="api-monitor-empty">No requests yet. Interact with the app to see live API traffic.</div>';
    } else {
      list.innerHTML = apiLog
        .map((e) => {
          const m = e.method.toUpperCase();
          const statusClass =
            e.status === null ? 's-pending'
              : e.status === 0 ? 's-error'
              : `s-${String(Math.floor(e.status / 100))}xx`;
          const statusText =
            e.status === null ? '...' : e.status === 0 ? 'ERR' : e.status;
          const ms = e.ms == null ? '' : `${e.ms}ms`;
          return `<div class="api-row${e.status === null ? ' is-pending' : ''}" data-log-index="${e.index}">
            <span class="api-method m-${m}">${m}</span>
            <span class="api-path" title="${e.endpoint}">${e.endpoint}</span>
            <span class="api-status ${statusClass}">${statusText}</span>
            <span class="api-ms">${ms}</span>
          </div>`;
        })
        .join('');
    }

    const failed = apiLog.filter((e) => e.status !== null && e.status >= 400).length;
    if (badge) {
      badge.textContent = String(apiLog.length);
      badge.classList.toggle('is-error', failed > 0);
    }
    if (summary) {
      const totalMs = apiLog.filter((e) => e.ms != null);
      const avg = totalMs.length
        ? Math.round(totalMs.reduce((a, b) => a + b.ms, 0) / totalMs.length)
        : 0;
      summary.textContent =
        `${apiLog.length} request${apiLog.length === 1 ? '' : 's'}` +
        `${failed ? ` · ${failed} failed` : ''}` +
        `${avg ? ` · avg ${avg}ms` : ''}`;
    }
    if (toggle) {
      const pending = apiLog.some((e) => e.status === null);
      toggle.classList.toggle('is-busy', pending);
      toggle.classList.toggle('is-error', failed > 0 && !pending);
    }
  }

  function logApiStart(method, endpoint, options) {
    const entry = {
      // Monotonic, because apiLog is unshift-ed and trimmed: apiLog.length is
      // not a unique id and would collide once old rows fall off the end.
      index: _apiLogSeq++,
      method,
      endpoint,
      status: null,
      ms: null,
      startedAt: Date.now(),
      body: options && options.body,
      token: state.token,
    };
    apiLog.unshift(entry);
    if (apiLog.length > API_LOG_MAX) apiLog.length = API_LOG_MAX;
    renderApiLog();
    return entry;
  }

  function logApiEnd(entry, status) {
    if (!entry) return;
    // Entries shift index when the list is trimmed, so match on identity.
    const found = apiLog.find((e) => e === entry);
    if (!found) return;
    found.status = status;
    found.ms = Date.now() - found.startedAt;
    renderApiLog();
  }

  // ---------------------------------------------------------------------------
  // Monitor window: drag to move, edges and corners to resize.
  //
  // The point is to let a reviewer put the request log wherever they want and
  // make it as large as their screen allows, instead of it being stuck in a
  // 460x340 corner box that covers the thing they are trying to click. Geometry
  // is saved so a reload does not throw the layout away mid-demo.
  // ---------------------------------------------------------------------------
  const AM_MIN_W = 320;
  const AM_MIN_H = 180;
  // The window may hang off any edge of the browser, the way a desktop window
  // can hang off the edge of a screen. It may not go *entirely* off, though:
  // the only drag handles are the header and the footer, so a strip of the
  // panel has to stay on screen for there to be anything to grab.
  const AM_VISIBLE = 32;

  function amDefaultRect() {
    // A console in a window of its own has no default rect to compute: CSS sizes
    // it to that window, so this only ever runs for the docked panel.
    const v = amViewport();
    const width = Math.min(460, Math.max(AM_MIN_W, v.w - 32));
    const height = Math.min(340, Math.max(AM_MIN_H, v.h - 100));
    return { left: 16, top: Math.max(8, v.h - height - 52), width, height };
  }

  /**
   * Keep the window draggable-back, and otherwise get out of the way.
   *
   * Left, right, top and bottom are all free: the panel can be parked mostly or
   * entirely past an edge, so it never sits on top of the part of the app you
   * are trying to click. The single rule is that `AM_VISIBLE` pixels of it stay
   * on screen.
   *
   * That rule is only safe because of two things that are easy to get wrong. The
   * footer is a drag handle as well as the header, because a panel hung off the
   * top of the browser shows nothing but its footer. And the header's buttons do
   * *not* refuse to start a drag, because a panel hung off the left edge shows
   * nothing but the right-hand end of the header - which is exactly where Clear
   * and Hide sit. Either one of those missing and the window can be moved out
   * of reach but never moved back.
   */
  function amClamp(rect) {
    const v = amViewport();
    const vw = v.w;
    const vh = v.h;
    const width = Math.min(Math.max(rect.width, AM_MIN_W), Math.max(vw - 16, AM_MIN_W));
    const height = Math.min(Math.max(rect.height, AM_MIN_H), Math.max(vh - 16, AM_MIN_H));
    return {
      left: Math.min(Math.max(rect.left, AM_VISIBLE - width), Math.max(vw - AM_VISIBLE, AM_VISIBLE - width)),
      top: Math.min(Math.max(rect.top, AM_VISIBLE - height), Math.max(vh - AM_VISIBLE, AM_VISIBLE - height)),
      width,
      height,
    };
  }

  function amApply(rect) {
    const panel = amRoot();
    if (!panel) return;
    // While floating there is nothing to place. The panel is the whole content of
    // a window dedicated to it, so CSS fills that window and the window's own
    // edges are the size control. Measuring here instead would fight the
    // stylesheet, and would read a zero-sized viewport if it ran during window
    // creation - which is exactly when this first runs.
    if (amIsFloating()) return;
    panel.style.left = `${Math.round(rect.left)}px`;
    panel.style.top = `${Math.round(rect.top)}px`;
    panel.style.width = `${Math.round(rect.width)}px`;
    panel.style.height = `${Math.round(rect.height)}px`;
    // The stylesheet anchors the panel with `bottom` for its first paint. Once
    // JS owns the geometry, top and bottom together would stretch the window.
    panel.style.bottom = 'auto';
  }

  /** Read the live geometry, so a drag starts from where the window actually is. */
  function amLiveRect() {
    const panel = amRoot();
    if (!panel) return { left: 0, top: 0, width: AM_MIN_W, height: AM_MIN_H };
    const r = panel.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }

  function amSave() {
    try {
      localStorage.setItem(AM_STORE, JSON.stringify(amLiveRect()));
    } catch (_) {
      /* private mode / quota: the window still works, it just will not persist */
    }
  }

  function amSaved() {
    try {
      const raw = localStorage.getItem(AM_STORE);
      if (!raw) return null;
      const v = JSON.parse(raw);
      if (![v.left, v.top, v.width, v.height].every((n) => typeof n === 'number' && isFinite(n))) {
        return null;
      }
      return v;
    } catch (_) {
      return null;
    }
  }

  function amSetFlag(on) {
    try {
      if (on) localStorage.setItem(AM_FLOAT_FLAG, '1');
      else localStorage.removeItem(AM_FLOAT_FLAG);
    } catch (_) { /* ignore */ }
  }

  function amReadFlag() {
    try {
      return localStorage.getItem(AM_FLOAT_FLAG) === '1';
    } catch (_) {
      return false;
    }
  }

  /** Put the window back where it belongs. Safe to call while the panel is hidden. */
  function amRefresh() {
    amApply(amClamp(amSaved() || amDefaultRect()));
  }

  /**
   * Resize from a starting rect. The edge opposite the grip stays pinned, which
   * is what makes dragging `w` or `n` feel like pulling a wall rather than
   * growing a new box out of a fixed corner.
   */
  function amResized(start, grip, dx, dy) {
    let { left, top, width, height } = start;
    if (grip.includes('e')) width = Math.max(AM_MIN_W, start.width + dx);
    if (grip.includes('s')) height = Math.max(AM_MIN_H, start.height + dy);
    if (grip.includes('w')) {
      // Pinned opposite edge: the right side stays put and the width changes.
      const w = Math.max(AM_MIN_W, start.width - dx);
      left = start.left + (start.width - w);
      width = w;
    }
    if (grip.includes('n')) {
      // Same idea vertically, so a corner grip moves two edges at once.
      const h = Math.max(AM_MIN_H, start.height - dy);
      top = start.top + (start.height - h);
      height = h;
    }
    return { left, top, width, height };
  }

  /**
   * Bind a console panel: dragging, resizing, and its three buttons.
   *
   * Takes the panel rather than using the global one, because the same markup
   * exists twice once the console is floating - once docked and hidden in the
   * page, once cloned into its own window. Each is wired independently and the
   * guards below make only the one actually on screen respond, so a drag that
   * started in one cannot be continued in the other.
   */
  // A WeakSet rather than a data attribute: the floating console is a clone of
  // the docked panel, and a clone copies the attribute, which would make the
  // panel look already wired and leave the console window with dead buttons.
  const _amWired = new WeakSet();

  function amWirePanel(panel) {
    if (!panel || _amWired.has(panel)) return;
    _amWired.add(panel);

    // Everything a drag needs is bound to the panel's own window and document,
    // not the page's: a pointermove inside a popup never reaches the opener.
    const win = panel.ownerDocument.defaultView || window;
    const doc = panel.ownerDocument;
    const handles = Array.prototype.slice.call(panel.querySelectorAll('[data-am-drag]'));
    const isActive = () => amRoot() === panel;

    let mode = null;
    let grip = '';
    let startX = 0;
    let startY = 0;
    let startRect = null;
    let moved = false;
    let swallowClick = false;

    const stop = () => {
      win.removeEventListener('pointermove', onMove);
      if (doc.body) doc.body.classList.remove('am-dragging', 'am-resizing');
      // A drag that actually moved the window must not also press whatever was
      // under the pointer - otherwise grabbing the window by its Hide button
      // hides the panel. The click is dispatched after pointerup, so flagging it
      // here is early enough to catch it.
      swallowClick = moved;
      if (moved) amSave();
      mode = null;
      moved = false;
    };

    const begin = (ev, m, g) => {
      if (ev.button !== undefined && ev.button !== 0) return;
      mode = m;
      grip = g || '';
      startX = ev.clientX;
      startY = ev.clientY;
      startRect = panel.getBoundingClientRect();
      moved = false;
      swallowClick = false;
      if (doc.body) doc.body.classList.add(m === 'move' ? 'am-dragging' : 'am-resizing');
      win.addEventListener('pointermove', onMove);
      win.addEventListener('pointerup', stop, { once: true });
      win.addEventListener('pointercancel', stop, { once: true });
      // preventDefault() is skipped for a move on purpose. It suppresses the
      // compatibility mouse events, which would take the click on the buttons
      // down with it. Text selection is stopped in CSS instead, and the grips
      // have nothing to lose.
      if (m === 'resize') ev.preventDefault();
    };

    function onMove(ev) {
      if (!mode || !isActive()) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      // A few pixels of slop so that clicking the header does not shift it.
      if (!moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      moved = true;
      const next = mode === 'move'
        ? { left: startRect.left + dx, top: startRect.top + dy, width: startRect.width, height: startRect.height }
        : amResized(startRect, grip, dx, dy);
      amApply(amClamp(next));
    }

    // The button rows live inside the drag handles, so the handles cannot simply
    // ignore pointerdowns that land on them - a window hung off the left edge is
    // dragged back by the buttons, because that is all that is left on screen.
    // Instead the click is dropped only when the drag really moved.
    panel.addEventListener('click', (ev) => {
      if (!swallowClick) return;
      swallowClick = false;
      ev.stopPropagation();
      ev.preventDefault();
    }, true);

    // Any press inside the panel re-arms clicks, including on the request list,
    // which is not a handle and so never reaches begin(). Without this a drag
    // that ended off the panel - where the browser dispatches its click to some
    // ancestor outside, so the swallower above never sees it - would leave the
    // flag set and eat the next unrelated click.
    panel.addEventListener('pointerdown', () => {
      swallowClick = false;
    }, true);

    handles.forEach((el) => {
      el.addEventListener('pointerdown', (ev) => begin(ev, 'move'));
      // Double-click either bar to undo any dragging and resizing.
      el.addEventListener('dblclick', (ev) => {
        // Not on a button: double-clicking Hide should hide, not also reset.
        if (ev.target && ev.target.closest && ev.target.closest('button')) return;
        amApply(amClamp(amDefaultRect()));
        amSave();
      });
    });

    panel.querySelectorAll('[data-am-grip]').forEach((el) => {
      el.addEventListener('pointerdown', (ev) => begin(ev, 'resize', el.dataset.amGrip));
    });

    // Delegated so a click on a row copies its curl, whichever document the row
    // is in. Registered here rather than in init() because the floating console
    // is a clone that did not exist at startup.
    panel.addEventListener('click', (ev) => {
      const row = ev.target && ev.target.closest && ev.target.closest('[data-log-index]');
      if (row) copyCurl(Number(row.dataset.logIndex));
    });

    const on = (id, fn) => {
      const b = panel.querySelector('#' + id);
      if (b) b.addEventListener('click', fn);
    };
    on('apiMonitorFloatBtn', () => (amIsFloating() ? amDock() : amFloat()));
    on('apiMonitorClearBtn', clearApiLog);
    on('apiMonitorHideBtn', () => {
      if (amIsFloating()) amDock();
      else {
        panel.classList.add('hidden');
        amUpdateToggle(false);
      }
    });

    // A viewport that shrinks under a saved position would otherwise strand the
    // window off-screen with no way to drag it back. While floating there is
    // nothing to do: the panel is sized to the window by CSS, so it follows the
    // window's own resize for free.
    win.addEventListener('resize', () => {
      if (!isActive() || panel.classList.contains('hidden')) return;
      if (amIsFloating()) return;
      amApply(amClamp(amLiveRect()));
    });
  }

  function amInitWindow() {
    const panel = amDockedPanel();
    if (!panel) return;
    amWirePanel(panel);
    // A console that was detached when the page was last closed cannot be
    // reopened on load: a popup has to be opened by a click. It stays out of the
    // way and the tab button offers the click that brings it back.
    const detached = amReadFlag();
    if (detached) panel.classList.add('hidden');
    amUpdateToggle(detached);
    if (!detached) amRefresh();
  }

  // ==========================================================================
  // POPPING THE CONSOLE OUT INTO ITS OWN WINDOW
  //
  // The panel markup is *cloned* into the new document rather than moved. Moving
  // it would work, but the clone is far harder to get wrong: the docked panel
  // stays intact and hidden, so closing the window is a matter of revealing it
  // again rather than rescuing a node from a document that is being destroyed.
  // ==========================================================================

  /** Re-point the page's tab button at wherever the console actually is. */
  function amUpdateToggle(detached) {
    const toggle = document.getElementById('apiMonitorToggle');
    if (!toggle) return;
    const label = document.getElementById('apiMonitorToggleLabel');
    if (label) {
      // A popup cannot be reopened without a user gesture, so when the console
      // was detached at load time the tab has to offer the click that brings it
      // back.
      label.textContent = detached ? 'API Monitor · reopen' : 'API Monitor';
    }
    toggle.classList.toggle('is-detached', !!detached);
  }

  /** Button captions and chrome for docked vs floating. */
  function amSetChrome(floating) {
    const docked = amDockedPanel();
    [docked, _amRoot].filter(Boolean).forEach((root) => {
      const fl = root.querySelector('#apiMonitorFloatBtn');
      if (fl) {
        fl.textContent = floating ? 'Dock' : 'Pop out';
        fl.title = floating
          ? 'Move the console back into the page'
          : 'Open the console in a window of its own';
      }
      // Nothing to Hide when the window *is* the console: closing it is how you
      // dismiss it, and closing docks the console back into the page.
      const hide = root.querySelector('#apiMonitorHideBtn');
      if (hide) hide.style.display = floating ? 'none' : '';
      const foot = root.querySelector('.api-monitor-foot');
      if (foot && foot.lastElementChild) {
        foot.lastElementChild.textContent = floating
          ? 'This is a separate window · Dock to move it back'
          : 'Drag to move · edges to resize · click a row for curl';
      }
    });
    amUpdateToggle(floating);
  }

  function amFloat() {
    if (_amFloatWin && !_amFloatWin.closed) {
      try { _amFloatWin.focus(); } catch (_) { /* ignore */ }
      return;
    }
    const docked = amDockedPanel();
    if (!docked) return;

    let w = null;
    try {
      w = window.open('', AM_FLOAT_NAME, 'popup=yes,width=700,height=520,left=140,top=110');
    } catch (_) {
      w = null;
    }
    if (!w) {
      amToast('Your browser blocked the console window - allow pop-ups for this page', 'warning', 5000);
      return;
    }

    const doc = w.document;
    doc.open();
    doc.write('<!doctype html><html><head><meta charset="utf-8">'
      + '<title>EchoGPT API Console</title></head>'
      + '<body class="am-floating"></body></html>');
    doc.close();

    // Copy the page's own stylesheets across instead of naming URLs here, so the
    // console window cannot drift away from the app's styling. The new document
    // is about:blank, which has no base URL to resolve a relative path against,
    // so the resolved absolute href is what gets used.
    Array.prototype.slice.call(document.querySelectorAll('link[rel="stylesheet"]')).forEach((l) => {
      const copy = doc.createElement('link');
      copy.rel = 'stylesheet';
      copy.href = l.href;
      doc.head.appendChild(copy);
    });

    _amFloatWin = w;
    // The clone, wired and hidden-class-free. _amRoot must be set before any
    // geometry or render call, because those resolve through it.
    const clone = doc.importNode(docked, true);
    clone.id = 'apiMonitorPanel';
    clone.classList.remove('hidden');
    clone.classList.add('is-floating');
    // The clone carries the docked panel's geometry in its style attribute.
    // Clear it: while floating, CSS sizes the panel to the window, and any
    // inline geometry would override that.
    clone.removeAttribute('style');
    _amRoot = clone;
    doc.body.appendChild(clone);

    docked.classList.add('hidden');
    amWirePanel(clone);
    amSetChrome(true);
    amSetFlag(true);
    setApiMonitorHost();
    renderApiLog();

    // The user can close this with the title-bar X. Put the console back in the
    // page rather than leaving it in a document that is about to die.
    try {
      w.addEventListener('beforeunload', amOnFloatClosed);
    } catch (_) { /* ignore */ }
  }

  function amDock() {
    const w = _amFloatWin;
    _amFloatWin = null;
    if (w) {
      try {
        w.removeEventListener('beforeunload', amOnFloatClosed);
        w.close();
      } catch (_) { /* ignore */ }
    }
    const docked = amDockedPanel();
    if (!docked) return;
    // Back to resolving through the page's own panel.
    _amRoot = null;
    docked.classList.remove('hidden');
    docked.classList.remove('is-floating');
    amSetChrome(false);
    amSetFlag(false);
    amApply(amClamp(amSaved() || amDefaultRect()));
    setApiMonitorHost();
    renderApiLog();
  }

  function amOnFloatClosed() {
    // Runs while the popup's document is being torn down, so it defers the
    // actual hand-back by a tick.
    setTimeout(() => {
      if (_amFloatWin && _amFloatWin.closed) _amFloatWin = null;
      amDock();
    }, 0);
  }

  /** Toasts have to land in the console's own document or they are off-screen. */
  function amToast(message, type, duration) {
    return showToast(message, type, duration, amDoc());
  }

  function toggleApiMonitor() {
    // While the console is in its own window the page tab re-focuses it, or
    // brings it back if it was closed, rather than toggling a panel that is not
    // on screen.
    // The flag covers the reload case: the console is neither floating nor
    // docked, but the tab is offering to bring it back.
    if (amIsFloating() || amReadFlag()) {
      amFloat();
      return;
    }
    const panel = amDockedPanel();
    if (!panel) return;
    panel.classList.toggle('hidden');
    // Re-apply geometry on the way in: the viewport may have changed while the
    // panel was closed, and a hidden panel has no rect to correct from.
    if (!panel.classList.contains('hidden')) amRefresh();
    amUpdateToggle(false);
    setApiMonitorHost();
  }

  function clearApiLog() {
    apiLog.length = 0;
    renderApiLog();
  }

  // The console window's controls, exported for the console and for anything
  // driving it from a keyboard shortcut.
  function floatApiMonitor() {
    amFloat();
  }

  function dockApiMonitor() {
    if (amIsFloating()) amDock();
  }

  function copyCurl(index) {
    const e = apiLog.find((x) => x.index === index);
    if (!e) return;
    const url = `${state.apiBase}${e.endpoint}`;
    const parts = [`curl -i -X ${e.method.toUpperCase()} '${url}'`];
    if (e.token) parts.push(`-H 'Authorization: Bearer ${e.token}'`);
    if (e.body) parts.push(`-H 'Content-Type: application/json'`, `-d '${e.body}'`);
    const cmd = parts.join(' \\\n  ');
    const done = () => amToast('curl command copied to clipboard', 'info', 2200);
    // Ask the console's own window for the clipboard, not the page's. The async
    // clipboard API insists on transient user activation, and the click that got
    // us here belongs to the console window, not the one running this code.
    const w = amWin();
    const clip = w.navigator && w.navigator.clipboard;
    if (clip && clip.writeText) {
      clip.writeText(cmd).then(done, () => fallbackCopy(cmd, done));
    } else {
      fallbackCopy(cmd, done);
    }
  }

  function fallbackCopy(text, done) {
    // execCommand is the only option on non-HTTPS origins, where the async
    // clipboard API is unavailable.
    const doc = amDoc();
    const ta = doc.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    doc.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = doc.execCommand('copy');
    } catch (_) {
      ok = false;
    }
    if (ok) {
      done();
    } else {
      amToast('Could not copy automatically - see console', 'warning', 4000);
      // eslint-disable-next-line no-console
      console.log('[EchoGPT] curl command:\n' + text);
    }
    ta.remove();
  }

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

    let res;
    const logEntry = logApiStart(options.method || 'GET', endpoint, options);
    try {
      res = await fetch(url, { ...options, headers });
      logApiEnd(logEntry, res.status);
    } catch (err) {
      logApiEnd(logEntry, 0); // 0 == transport failure, not an HTTP status
      // fetch only rejects on a transport failure (backend down, DNS failure,
      // blocked mixed content). Surface the likely cause instead of a bare
      // "Failed to fetch", which is what made this impossible to debug before.
      const isLocalTarget = /localhost|127\.0\.0\.1/.test(state.apiBase);
      const hint = isLocalTarget
        ? `The API at ${state.apiBase} is unreachable. If you are viewing this page from a deployed site, localhost refers to the visitor's own machine — point the API Base URL at a publicly reachable backend instead.`
        : `Could not reach the API at ${state.apiBase}. Check that the backend is running and that it allows cross-origin requests from this page.`;
      console.warn(`[API] Network failure on ${endpoint}:`, err);
      const wrapped = new Error(hint);
      wrapped.isNetworkError = true;
      throw wrapped;
    }

    // Not every response is JSON (proxies, error pages, empty bodies).
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} from ${url}: ${text.slice(0, 200)}`);
        }
        return data;
      }
    }

    if (!res.ok) {
      const message =
        (data && (data.message || data.error)) || `HTTP error ${res.status}`;

      // Access tokens are short-lived (15m by default). Once one expires every
      // subsequent call 401s and the UI just stops working, so drop the dead
      // credentials once and tell the user, instead of failing forever.
      // This covers the signed-out case too: a raw "Unauthorized" string tells
      // the user nothing, whereas "your session expired" tells them what to do.
      if (res.status === 401 && !isAuthEndpoint(endpoint)) {
        logout();
        showToast('Your session has expired. Please sign in again.', 'warning', 5000);
        const err = new Error('Your session has expired. Please sign in again.');
        err.status = 401;
        err.isSessionExpired = true;
        throw err;
      }

      const err = new Error(message);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // =========================================================================
  // TOAST NOTIFICATION SYSTEM
  // =========================================================================
  // One container per document. The console window is a second document, and a
  // toast anchored to the page's body would be invisible while the user is
  // looking at the console, which is where the message came from.
  const _toastContainers = new Map();

  function getToastContainer(doc) {
    const d = doc || document;
    let c = _toastContainers.get(d);
    if (!c || !c.isConnected) {
      c = d.createElement('div');
      c.id = 'toastContainer';
      c.style.cssText = [
        'position:fixed',
        'bottom:24px',
        'right:24px',
        'z-index:99999',
        'display:flex',
        'flex-direction:column-reverse',
        'gap:10px',
        'pointer-events:none',
        'max-width:360px',
      ].join(';');
      d.body.appendChild(c);
      _toastContainers.set(d, c);
    }
    return c;
  }

  function showToast(message, type = 'success', duration = 3500, doc) {
    const d = doc || document;
    const container = getToastContainer(d);
    const toast = d.createElement('div');

    const icons = {
      success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>',
      error:   '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
      info:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
      warning: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    };
    const colors = {
      success: { bg: '#0f172a', border: '#10b981', icon: '#10b981' },
      error:   { bg: '#0f172a', border: '#ef4444', icon: '#ef4444' },
      info:    { bg: '#0f172a', border: '#6366f1', icon: '#6366f1' },
      warning: { bg: '#0f172a', border: '#f59e0b', icon: '#f59e0b' },
    };
    const c = colors[type] || colors.info;

    toast.style.cssText = [
      `background:${c.bg}`,
      'color:#e2e8f0',
      `border-left:3px solid ${c.border}`,
      'border-radius:10px',
      'padding:12px 16px',
      'display:flex',
      'align-items:flex-start',
      'gap:10px',
      'box-shadow:0 8px 32px rgba(0,0,0,0.45)',
      'pointer-events:all',
      'cursor:pointer',
      'font-family:Plus Jakarta Sans,Inter,sans-serif',
      'font-size:13px',
      'line-height:1.4',
      'min-width:260px',
      'max-width:360px',
      'transform:translateX(120%)',
      'transition:transform 0.3s cubic-bezier(0.34,1.56,0.64,1), opacity 0.25s ease',
      'opacity:0',
    ].join(';');

    toast.innerHTML = `
      <span style="color:${c.icon};flex-shrink:0;margin-top:1px;">${icons[type] || icons.info}</span>
      <span style="flex:1;">${message}</span>
      <button style="background:none;border:none;color:#64748b;cursor:pointer;font-size:16px;line-height:1;padding:0;margin-left:4px;flex-shrink:0;" onclick="this.parentElement.remove()">&times;</button>
    `;

    container.appendChild(toast);
    // That window's own rAF, not the page's: a backgrounded tab has its frames
    // throttled to a crawl, so the toast would never animate in while the
    // console window is the one being looked at.
    const raf = (d.defaultView && d.defaultView.requestAnimationFrame)
      || ((fn) => setTimeout(fn, 16));
    raf(() => {
      raf(() => {
        toast.style.transform = 'translateX(0)';
        toast.style.opacity = '1';
      });
    });

    toast.addEventListener('click', (e) => {
      if (e.target.tagName !== 'BUTTON') dismissToast(toast);
    });

    setTimeout(() => dismissToast(toast), duration);
    return toast;
  }

  function dismissToast(toast) {
    toast.style.transform = 'translateX(120%)';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }

  // Async confirm dialog (replaces native confirm())
  function showConfirm(message, title = 'Confirm Action') {
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.style.cssText = [
        'position:fixed','inset:0','background:rgba(0,0,0,0.6)',
        'z-index:99998','display:flex','align-items:center','justify-content:center',
        'backdrop-filter:blur(4px)',
      ].join(';');

      backdrop.innerHTML = `
        <div style="background:#0f172a;border:1px solid #1e293b;border-radius:16px;padding:28px 32px;max-width:380px;width:90%;box-shadow:0 25px 60px rgba(0,0,0,0.6);font-family:Plus Jakarta Sans,Inter,sans-serif;">
          <div style="font-size:15px;font-weight:700;color:#f1f5f9;margin-bottom:8px;">${title}</div>
          <div style="font-size:13px;color:#94a3b8;line-height:1.6;margin-bottom:24px;">${message}</div>
          <div style="display:flex;gap:10px;justify-content:flex-end;">
            <button id="confirmNo" style="background:#1e293b;border:1px solid #334155;color:#94a3b8;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;">Cancel</button>
            <button id="confirmYes" style="background:linear-gradient(135deg,#6366f1,#8b5cf6);border:none;color:#fff;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;">Confirm</button>
          </div>
        </div>
      `;

      document.body.appendChild(backdrop);
      backdrop.querySelector('#confirmYes').addEventListener('click', () => { backdrop.remove(); resolve(true); });
      backdrop.querySelector('#confirmNo').addEventListener('click', () => { backdrop.remove(); resolve(false); });
      backdrop.addEventListener('click', (e) => { if (e.target === backdrop) { backdrop.remove(); resolve(false); } });
    });
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
  let _initLoginPromise = null; // Tracks the auto-login so admin view can await it

  async function init() {
    updateSwaggerLink();
    setApiMonitorHost();
    // Open the monitor by default: the first thing a reviewer should see is
    // `GET /health 200` arriving, not an empty panel.
    document.getElementById('apiMonitorPanel')?.classList.remove('hidden');
    // Rows are wired by delegation inside amWirePanel, not here, so the console
    // behaves the same whichever document it is in.
    amInitWindow();
    checkHealth();
    renderUserUI();
    setupEventListeners();

    // Auto-login so the hosted demo is immediately usable. This signs in as the
    // seeded *demo* account (USER role), not the admin one: auto-signing every
    // anonymous visitor in as an administrator published the admin panel, and
    // the whole user table, to anyone who opened the page.
    if (!state.user) {
      _initLoginPromise = loginWithCredentials('demo@echogpt.app', 'DemoUser123!')
        .catch(() => {}); // suppress errors
      await _initLoginPromise;
      _initLoginPromise = null;
      // If the admin view button was clicked before login resolved, reload now
      if (state.viewMode === 'admin') loadAdminDashboard();
    } else {
      refreshSubscription();
      loadProviders();
    }
  }

  function updateSwaggerLink() {
    if (el.linkSwagger) {
      el.linkSwagger.href = `${state.apiBase}/docs`;
    }
    // These two were hardcoded to localhost:3001, which resolves to the
    // *visitor's* machine when the demo is opened on someone else's PC.
    const adminSwagger = document.getElementById('linkSwaggerAdmin');
    if (adminSwagger) adminSwagger.href = `${state.apiBase}/docs`;
    const postman = document.getElementById('linkPostman');
    if (postman) {
      // The collection is served by the API at the site root, so swap the
      // /api/v1 prefix the other links carry.
      postman.href = `${state.apiBase.replace(/\/api\/v1\/?$/, '')}/postman_collection.json`;
    }
  }

  async function checkHealth() {
    // Use the PUBLIC /health endpoint. The previous call to /admin/system-health
    // is ADMIN-gated, so it returned 401 for every signed-out or non-admin
    // visitor and the UI incorrectly reported "API Offline" against a perfectly
    // healthy backend.
    const candidates = apiBaseCandidates();
    const timeout = (window.ECHOGPT_CONFIG && window.ECHOGPT_CONFIG.healthProbeTimeoutMs) || 6000;
    const label = (b) => b.replace(/^https?:\/\//, '').replace(/\/api\/v1\/?$/, '');
    let live = null;

    for (const base of candidates) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const res = await fetch(`${base}/health`, { signal: controller.signal });
        const json = await res.json().catch(() => null);
        // TransformInterceptor wraps every response as { success, data }, so the
        // status field lives under `data` - a bare `json.status` is undefined and
        // would report a healthy backend as offline.
        const healthy = json && (json.status === 'ok' || (json.data && json.data.status === 'ok'));
        if (res.ok && healthy) { live = base; break; }
      } catch (_) {
        // Unreachable, timed out, or not JSON - try the next candidate.
      } finally {
        clearTimeout(timer);
      }
    }

    if (live) {
      // A working fallback means the tunnel is down; move to the healthy host
      // and remember it, so the rest of the session uses the reachable one.
      if (live !== state.apiBase) {
        state.apiBase = live;
        localStorage.setItem('echogpt_api_base', live);
        updateSwaggerLink();
        setApiMonitorHost();
        showToast(`Primary backend unreachable - switched to ${label(live)}`, 'warning', 6000);
      }
      el.apiStatusLabel.textContent = `API Connected · ${label(live)}`;
      el.apiStatusPill.querySelector('.status-dot').className = 'status-dot';
      el.apiStatusPill.title = `Connected to ${live} — click to change`;
      hideOfflineBanner();
    } else {
      el.apiStatusLabel.textContent = 'API Offline';
      el.apiStatusPill.querySelector('.status-dot').className = 'status-dot disconnected';
      el.apiStatusPill.title = `Could not reach any backend — click to change`;
      showOfflineBanner(candidates.map(label));
    }
  }

  function showOfflineBanner(triedHosts) {
    const banner = document.getElementById('offlineBanner');
    if (!banner) return;
    banner.innerHTML = `
      <div class="offline-banner-inner">
        <div class="offline-banner-text">
          <strong>Backend unreachable.</strong>
          Tried ${triedHosts.map((h) => `<code>${h}</code>`).join(', ')} and none answered
          <code>GET /health</code>.
          The demo backend is served from a tunnel whose hostname changes whenever it
          restarts — if you are reviewing this on your own machine, the API is
          probably not running right now.
        </div>
        <div class="offline-banner-actions">
          <button class="offline-banner-btn" onclick="window.EchoApp.retryHealth()">Retry</button>
          <button class="offline-banner-btn primary" onclick="window.EchoApp.openApiModal()">Set API URL</button>
        </div>
      </div>`;
    banner.classList.remove('hidden');
  }

  function hideOfflineBanner() {
    const banner = document.getElementById('offlineBanner');
    if (banner) banner.classList.add('hidden');
  }

  function retryHealth() {
    showToast('Re-checking backend...', 'info', 2000);
    checkHealth();
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
      // If auto-login is still in progress, wait for it before loading dashboard
      if (_initLoginPromise) {
        _initLoginPromise.then(() => loadAdminDashboard());
      } else {
        loadAdminDashboard();
      }
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
  state.authMode = 'login';

  function setAuthMode(mode) {
    state.authMode = mode;
    const tabLogin = document.getElementById('tabAuthLogin');
    const tabRegister = document.getElementById('tabAuthRegister');
    const groupName = document.getElementById('groupAuthName');
    const authName = document.getElementById('authName');
    const btnSubmit = document.getElementById('btnSubmitAuth');
    const switchText = document.getElementById('authSwitchText');
    const switchLink = document.getElementById('authSwitchLink');
    const modalTagline = document.getElementById('authModalTagline');
    const modalTitle = document.getElementById('authModalTitle');
    const recruiterBox = document.getElementById('recruiterQuickBox');
    const authDivider = document.getElementById('authDivider');
    const emailInput = document.getElementById('authEmail');
    const passInput = document.getElementById('authPassword');
    const errorNotice = el.authErrorNotice || document.getElementById('authErrorNotice');

    if (errorNotice) errorNotice.classList.add('hidden');

    if (mode === 'register') {
      tabLogin?.classList.remove('active');
      tabRegister?.classList.add('active');
      groupName?.classList.remove('hidden');
      if (authName) authName.required = true;
      if (btnSubmit) btnSubmit.textContent = 'Create Account';
      if (switchText) switchText.textContent = 'Already have an account?';
      if (switchLink) switchLink.textContent = 'Sign In';
      if (modalTitle) modalTitle.textContent = 'Create EchoGPT Account';
      if (modalTagline) modalTagline.textContent = 'Register a new account to test full backend capabilities.';
      if (recruiterBox) recruiterBox.style.display = 'none';
      if (authDivider) authDivider.style.display = 'none';
      if (emailInput && emailInput.value === 'admin@echogpt.app') emailInput.value = '';
      if (passInput && passInput.value === 'ChangeMe123!') passInput.value = '';
    } else {
      tabLogin?.classList.add('active');
      tabRegister?.classList.remove('active');
      groupName?.classList.add('hidden');
      if (authName) authName.required = false;
      if (btnSubmit) btnSubmit.textContent = 'Sign In';
      if (switchText) switchText.textContent = "Don't have an account?";
      if (switchLink) switchLink.textContent = 'Create Account';
      if (modalTitle) modalTitle.textContent = 'EchoGPT Access';
      if (modalTagline) modalTagline.textContent = 'Sign in or create an account to test full backend capabilities.';
      if (recruiterBox) recruiterBox.style.display = 'block';
      if (authDivider) authDivider.style.display = 'block';
    }
  }

  function toggleAuthMode() {
    setAuthMode(state.authMode === 'register' ? 'login' : 'register');
  }

  async function handleAuthSubmit(event) {
    if (event) event.preventDefault();
    if (state.authMode === 'register') {
      await handleRegister();
    } else {
      const email = document.getElementById('authEmail').value;
      const password = document.getElementById('authPassword').value;
      await loginWithCredentials(email, password);
    }
  }

  async function loginWithCredentials(email, password) {
    const submitBtn = document.getElementById('btnSubmitAuth');
    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Signing In...';
      }
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
        showToast(`Welcome back, ${state.user.name || state.user.email}!`);
        return res;
      }
    } catch (err) {
      el.authErrorNotice.textContent = err.message || 'Login failed. Please check credentials.';
      el.authErrorNotice.classList.remove('hidden');
      throw err;
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign In';
      }
    }
  }

  async function handleRegister() {
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    const name = (document.getElementById('authName')?.value || '').trim() || email.split('@')[0];
    const submitBtn = document.getElementById('btnSubmitAuth');

    if (!email || !password) {
      el.authErrorNotice.textContent = 'Please provide an email and password.';
      el.authErrorNotice.classList.remove('hidden');
      return;
    }

    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating Account...';
      }
      el.authErrorNotice.classList.add('hidden');
      const res = await apiRequest('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, name }),
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
        showToast(`Account created! Welcome, ${state.user.name || state.user.email}.`);
      }
    } catch (err) {
      el.authErrorNotice.textContent = err.message || 'Registration failed.';
      el.authErrorNotice.classList.remove('hidden');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = state.authMode === 'register' ? 'Create Account' : 'Sign In';
      }
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
      showToast('Please select a valid AI provider from the dropdown.', 'warning');
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
      showToast('Provider API key saved and encrypted at rest! 🔒', 'success');
    } catch (err) {
      showToast(`Error saving provider: ${err.message}`, 'error');
    }
  }

  async function testProviderHealth(id) {
    showToast('Testing provider connection...', 'info', 1500);
    try {
      const res = await apiRequest(`/providers/${id}/health-check`, { method: 'POST' });
      const isOk = res.data && (res.data.healthy ?? res.data.isHealthy);
      showToast(`Health Check: ${isOk ? 'Provider is Healthy ✅' : 'Provider Unavailable ❌'}`, isOk ? 'success' : 'error', 4000);
    } catch (err) {
      showToast(`Health Check failed: ${err.message}`, 'error');
    }
  }

  async function deleteProvider(id) {
    const ok = await showConfirm('This will permanently remove this provider and its encrypted API key.', 'Remove Provider?');
    if (!ok) return;
    try {
      await apiRequest(`/providers/${id}`, { method: 'DELETE' });
      loadProviders();
      showToast('Provider removed successfully.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
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
      showToast(`Subscription updated to ${planType} plan! 🎉`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // =========================================================================
  // ADMIN DASHBOARD — FULL ANALYTICS
  // =========================================================================
  let _usageChartInst = null;
  let _subChartInst = null;
  let _allUsersCache = [];
  let _logsPage = 1;

  async function loadAdminDashboard() {
    if (!state.token) { openAuthModal(); return; }

    const days = (document.getElementById('selAnalyticsDays') || {}).value || 7;

    const [dashRes, healthRes, usersRes, analyticsRes, providersRes, logsRes] = await Promise.allSettled([
      apiRequest('/admin/dashboard'),
      apiRequest('/admin/system-health'),
      apiRequest('/admin/users?pageSize=50'),
      apiRequest(`/admin/usage-analytics?days=${days}`),
      apiRequest('/admin/providers'),
      apiRequest('/admin/logs?pageSize=20'),
    ]);

    // KPI Cards
    if (dashRes.status === 'fulfilled' && dashRes.value?.data) {
      const d = dashRes.value.data;
      const totalUsers = d.users?.total ?? 0;
      const activeUsers = d.users?.active ?? 0;
      const premiumSubs = d.subscriptions?.premium ?? 0;
      const freeSubs = d.subscriptions?.free ?? 0;
      const conversations = d.usage?.conversations ?? 0;
      const messages = d.usage?.messages ?? 0;
      const searches = d.usage?.searches ?? 0;
      const reqToday = d.requestsToday ?? 0;

      safeSet('valTotalUsers', totalUsers);
      safeSet('valActiveUsers', `${activeUsers} active`);
      safeSet('valActiveSubscriptions', premiumSubs);
      safeSet('valFreeSubs', `${freeSubs} free`);
      safeSet('valTotalRequests', reqToday);
      safeSet('valTotalMessages', `${messages} messages`);
      safeSet('valTotalConversations', conversations);
      safeSet('valTotalSearches', `${searches} searches`);

      // Subscription doughnut
      buildSubChart(premiumSubs, freeSubs);
    } else if (dashRes.status === 'rejected') {
      // Blank the cards instead of leaving the previous session's numbers on
      // screen. A stale "44 total users" reads as live data, which is exactly
      // the wrong impression when the call was refused.
      for (const id of [
        'valTotalUsers', 'valActiveUsers', 'valActiveSubscriptions', 'valFreeSubs',
        'valTotalRequests', 'valTotalMessages', 'valTotalConversations', 'valTotalSearches',
      ]) safeSet(id, '—');
    }

    // System Health
    if (healthRes.status === 'fulfilled' && healthRes.value?.data) {
      const h = healthRes.value.data;
      const status = (h.status || 'OK').toUpperCase();
      safeSet('valSystemHealth', status);
      const uptimeSec = h.uptimeSeconds || 0;
      const uptimeStr = uptimeSec > 3600
        ? `${Math.floor(uptimeSec/3600)}h ${Math.floor((uptimeSec%3600)/60)}m`
        : `${Math.floor(uptimeSec/60)}m ${uptimeSec%60}s`;
      safeSet('valUptimeBadge', uptimeStr);
      safeSet('lblUptime', `DB: ${h.database || 'up'}`);
      safeSet('perfUptime', uptimeStr);
    } else if (healthRes.status === 'rejected') {
      safeSet('valSystemHealth', '—');
      safeSet('valUptimeBadge', '—');
      safeSet('lblUptime', 'DB: —');
      safeSet('perfUptime', '—');
    }

    // Users Table
    const usersBody = document.getElementById('tblUsersBody');
    if (usersRes.status === 'fulfilled' && usersRes.value?.data) {
      const rawUsers = usersRes.value.data;
      _allUsersCache = Array.isArray(rawUsers) ? rawUsers : (rawUsers?.data || []);
      renderUsersTable(_allUsersCache, 1);
    } else if (usersRes.status === 'rejected' && usersBody) {
      usersBody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:#ef4444;padding:16px;">Failed to load users: ${usersRes.reason?.message || 'Admin auth required.'}</td></tr>`;
    }

    // Usage Analytics + Chart
    if (analyticsRes.status === 'fulfilled' && analyticsRes.value?.data) {
      const a = analyticsRes.value.data;
      buildUsageChart(a.byDay || {});
      renderPerfMetrics(a.byDay || {});
    }

    // Provider Overview
    if (providersRes.status === 'fulfilled') {
      const provData = providersRes.value?.data || [];
      renderProviderOverview(Array.isArray(provData) ? provData : []);
    }

    // Recent Logs
    if (logsRes.status === 'fulfilled' && logsRes.value?.data) {
      const logData = logsRes.value.data;
      const logList = Array.isArray(logData) ? logData : (logData?.data || []);
      renderRecentLogs(logList);
    }

    // Promise.allSettled keeps one bad panel from blanking the whole dashboard,
    // but it also means a failure is invisible: the card just sits at "—".
    // Surface which panels failed so a broken dashboard is never mistaken for
    // a dashboard with no data.
    const failures = [
      ['Dashboard stats', dashRes],
      ['System health', healthRes],
      ['User list', usersRes],
      ['Usage analytics', analyticsRes],
      ['Provider overview', providersRes],
      ['Request logs', logsRes],
    ].filter(([, r]) => r.status === 'rejected');

    if (failures.length) {
      const detail = failures
        .map(([name, r]) => `${name}: ${r.reason?.message || r.reason?.status || 'failed'}`)
        .join(' · ');
      showToast(`Admin dashboard partially failed — ${detail}`, 'error', 8000);
      const banner = document.getElementById('adminErrorBanner');
      if (banner) {
        banner.textContent = `Some panels failed to load — ${detail}`;
        banner.classList.remove('hidden');
      }
      // eslint-disable-next-line no-console
      console.warn('[Admin] partial dashboard failure:', detail);
    } else {
      const banner = document.getElementById('adminErrorBanner');
      if (banner) banner.classList.add('hidden');
    }
  }

  function safeSet(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function buildUsageChart(byDay) {
    const canvas = document.getElementById('usageChart');
    if (!canvas) return;
    const emptyHint = document.getElementById('usageChartEmpty');
    const days = Object.keys(byDay).sort();
    if (days.length === 0) {
      if (emptyHint) emptyHint.classList.remove('hidden');
      return;
    }
    if (emptyHint) emptyHint.classList.add('hidden');

    if (_usageChartInst) _usageChartInst.destroy();
    _usageChartInst = new Chart(canvas, {
      type: 'line',
      data: {
        labels: days.map(d => {
          const dt = new Date(d);
          return dt.toLocaleDateString('en', { month: 'short', day: 'numeric' });
        }),
        datasets: [
          {
            label: 'Requests',
            data: days.map(d => byDay[d].count),
            borderColor: '#6366f1',
            backgroundColor: 'rgba(99,102,241,0.12)',
            fill: true,
            tension: 0.4,
            pointRadius: 4,
            pointBackgroundColor: '#6366f1',
          },
          {
            label: 'Errors',
            data: days.map(d => byDay[d].errors),
            borderColor: '#f43f5e',
            backgroundColor: 'rgba(244,63,94,0.08)',
            fill: true,
            tension: 0.4,
            pointRadius: 4,
            pointBackgroundColor: '#f43f5e',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 } } },
          y: { beginAtZero: true, grid: { color: '#f1f5f9' }, ticks: { font: { size: 10 }, precision: 0 } },
        },
      },
    });
  }

  function buildSubChart(premium, free) {
    const canvas = document.getElementById('subChart');
    const legend = document.getElementById('subChartLegend');
    if (!canvas) return;
    if (_subChartInst) _subChartInst.destroy();
    const total = premium + free || 1;
    _subChartInst = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: ['Premium', 'Free'],
        datasets: [{ data: [premium, free], backgroundColor: ['#6366f1', '#e2e8f0'], borderWidth: 0, hoverOffset: 4 }],
      },
      options: {
        responsive: false,
        cutout: '65%',
        plugins: { legend: { display: false } },
      },
    });
    if (legend) {
      legend.innerHTML = [
        { label: 'Premium', color: '#6366f1', count: premium },
        { label: 'Free', color: '#94a3b8', count: free },
      ].map(i => `
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <span style="display:flex;align-items:center;gap:6px;">
            <span style="width:8px;height:8px;border-radius:50%;background:${i.color};display:inline-block;"></span>
            <span style="font-size:11px;color:#64748b;">${i.label}</span>
          </span>
          <span style="font-size:12px;font-weight:700;color:#0f172a;">${i.count} <span style="font-size:10px;color:#94a3b8;font-weight:400;">(${Math.round(i.count/total*100)}%)</span></span>
        </div>
      `).join('');
    }
  }

  function renderProviderOverview(provData) {
    const el = document.getElementById('providerOverviewList');
    if (!el) return;
    const provNames = { OPENAI: 'OpenAI GPT', CLAUDE: 'Anthropic Claude', GEMINI: 'Google Gemini' };
    // Group by provider name
    const grouped = {};
    provData.forEach(p => {
      const key = p.provider || p.name || 'Unknown';
      if (!grouped[key]) grouped[key] = { total: 0, enabled: 0 };
      grouped[key].total += p.count || 1;
      if (p.enabled) grouped[key].enabled += p.count || 1;
    });

    const totalProviders = Object.values(grouped).reduce((s, g) => s + g.total, 0);
    const enabledProviders = Object.values(grouped).reduce((s, g) => s + g.enabled, 0);
    safeSet('valTotalProviders', totalProviders);
    safeSet('valEnabledProviders', `${enabledProviders} enabled`);

    if (Object.keys(grouped).length === 0) {
      el.innerHTML = '<div style="font-size:12px;color:#94a3b8;text-align:center;padding:12px;">No providers configured yet.</div>';
      return;
    }

    el.innerHTML = Object.entries(grouped).map(([name, g]) => `
      <div class="provider-ov-row">
        <div>
          <div class="provider-ov-name">${provNames[name] || name}</div>
          <div class="provider-ov-meta">${g.enabled} enabled &middot; ${g.total} total</div>
        </div>
        <div class="provider-ov-count">${g.total}</div>
      </div>
    `).join('');
  }

  function renderPerfMetrics(byDay) {
    const days = Object.keys(byDay);
    if (days.length === 0) return;
    let totalCalls = 0, totalErrors = 0, totalDur = 0;
    let peakDay = days[0], peakCount = 0;
    days.forEach(d => {
      totalCalls += byDay[d].count;
      totalErrors += byDay[d].errors;
      totalDur += byDay[d].avgDurationMs * byDay[d].count;
      if (byDay[d].count > peakCount) { peakCount = byDay[d].count; peakDay = d; }
    });
    const avgDur = totalCalls > 0 ? Math.round(totalDur / totalCalls) : 0;
    const errorRate = totalCalls > 0 ? ((totalErrors / totalCalls) * 100).toFixed(1) : '0.0';
    const successRate = (100 - parseFloat(errorRate)).toFixed(1);
    safeSet('perfAvgDuration', `${avgDur}ms`);
    safeSet('perfTotalCalls', totalCalls.toLocaleString());
    safeSet('perfErrorRate', `${errorRate}%`);
    safeSet('perfSuccessRate', `${successRate}%`);
    const peakDt = new Date(peakDay);
    safeSet('perfPeakDay', peakDt.toLocaleDateString('en', { month: 'short', day: 'numeric' }) + ` (${peakCount})`);
  }

  function renderRecentLogs(logs) {
    const el = document.getElementById('recentLogsList');
    if (!el) return;
    if (!logs || logs.length === 0) {
      el.innerHTML = '<div style="font-size:12px;color:#94a3b8;text-align:center;padding:12px;">No logs yet.</div>';
      return;
    }
    el.innerHTML = logs.map(log => {
      const isErr = (log.statusCode || 200) >= 400;
      const t = new Date(log.createdAt);
      return `
        <div class="log-row">
          <span class="log-method">${log.method || 'GET'}</span>
          <span class="log-path" title="${log.path || ''}">/${(log.path || '').replace(/^\//, '')}</span>
          <span class="log-status ${isErr ? 'err' : 'ok'}">${log.statusCode || 200}</span>
          <span class="log-dur">${log.durationMs || 0}ms</span>
          <span class="log-time">${t.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      `;
    }).join('');
  }

  async function loadMoreLogs() {
    _logsPage += 1;
    try {
      const res = await apiRequest(`/admin/logs?page=${_logsPage}&pageSize=20`);
      if (res?.data) {
        const logList = Array.isArray(res.data) ? res.data : (res.data?.data || []);
        renderRecentLogs(logList);
      }
    } catch (err) {
      console.warn('loadMoreLogs:', err);
    }
  }

  function renderUsersTable(users, page = 1) {
    const tbody = document.getElementById('tblUsersBody');
    const pagination = document.getElementById('userTablePagination');
    if (!tbody) return;

    const PAGE_SIZE = 10;
    const total = users.length;
    const totalPages = Math.ceil(total / PAGE_SIZE);
    const start = (page - 1) * PAGE_SIZE;
    const slice = users.slice(start, start + PAGE_SIZE);

    if (slice.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:16px;color:#64748b;">No users found.</td></tr>`;
      if (pagination) pagination.innerHTML = '';
      return;
    }

    tbody.innerHTML = slice.map(u => `
      <tr${u.deletedAt ? ' style="opacity:.62;"' : ''}>
        <td style="font-family:var(--font-mono);font-size:10px;color:#94a3b8;">${(u.id||'').substring(0, 8)}…</td>
        <td style="font-weight:600;font-size:12px;">${u.email}</td>
        <td style="font-size:12px;">${u.name || '—'}</td>
        <td><span class="badge-role">${u.role}</span></td>
        <td style="font-size:12px;">${u.isEmailVerified ? '✅' : '❌'}</td>
        <td>${u.deletedAt
          ? `<span style="color:#94a3b8;font-weight:700;font-size:11px;" title="Soft-deleted ${new Date(u.deletedAt).toLocaleString()}">● Deleted</span>`
          : u.isActive
            ? '<span style="color:#10b981;font-weight:700;font-size:11px;">● Active</span>'
            : '<span style="color:#ef4444;font-weight:700;font-size:11px;">● Suspended</span>'}</td>
        <td><span style="font-size:10px;background:${u.subscription?.plan==='PREMIUM'?'#e0e7ff':'#f1f5f9'};color:${u.subscription?.plan==='PREMIUM'?'#3730a3':'#64748b'};padding:2px 7px;border-radius:999px;font-weight:700;">${u.subscription?.plan || 'FREE'}</span></td>
        <td style="color:#94a3b8;font-size:11px;">${new Date(u.createdAt).toLocaleDateString()}</td>
        <td style="white-space:nowrap;">
          ${u.deletedAt
            // Reactivate would flip isActive but login still rejects on deletedAt,
            // so offering it implies a restore that cannot actually happen.
            ? '<span style="font-size:10.5px;color:#94a3b8;">Retained for audit log</span>'
            : u.isActive
              ? `<button class="tbl-action-btn suspend" onclick="window.EchoApp.adminSuspend('${u.id}')">Suspend</button>`
              : `<button class="tbl-action-btn activate" onclick="window.EchoApp.adminReactivate('${u.id}')">Reactivate</button>`}
          <button class="tbl-action-btn role" onclick="window.EchoApp.adminChangeRole('${u.id}','${u.role}')">${u.role === 'ADMIN' ? 'Make User' : 'Make Admin'}</button>
        </td>
      </tr>
    `).join('');

    // Pagination
    if (pagination && totalPages > 1) {
      let pHtml = `<span style="font-size:11px;color:#94a3b8;margin-right:8px;">${total} users</span>`;
      pHtml += `<button class="page-btn" onclick="window.EchoApp.goUsersPage(${page-1})" ${page<=1?'disabled':''}>‹ Prev</button>`;
      const startP = Math.max(1, page - 2);
      const endP = Math.min(totalPages, page + 2);
      for (let p = startP; p <= endP; p++) {
        pHtml += `<button class="page-btn ${p===page?'active':''}" onclick="window.EchoApp.goUsersPage(${p})">${p}</button>`;
      }
      pHtml += `<button class="page-btn" onclick="window.EchoApp.goUsersPage(${page+1})" ${page>=totalPages?'disabled':''}>Next ›</button>`;
      pagination.innerHTML = pHtml;
    } else if (pagination) {
      pagination.innerHTML = `<span style="font-size:11px;color:#94a3b8;">${total} users</span>`;
    }
  }

  function goUsersPage(page) {
    if (page < 1) return;
    renderUsersTable(_allUsersCache, page);
  }

  function filterUsersTable(query) {
    const q = (query || '').toLowerCase();
    const filtered = q ? _allUsersCache.filter(u =>
      (u.email || '').toLowerCase().includes(q) ||
      (u.name || '').toLowerCase().includes(q)
    ) : _allUsersCache;
    renderUsersTable(filtered, 1);
  }

  async function adminSuspend(userId) {
    const ok = await showConfirm('This will prevent the user from logging in and using the service.', 'Suspend User Account?');
    if (!ok) return;
    try {
      await apiRequest(`/admin/users/${userId}/suspend`, { method: 'PATCH' });
      const u = _allUsersCache.find(u => u.id === userId);
      if (u) u.isActive = false;
      renderUsersTable(_allUsersCache, 1);
      showToast('User account suspended.', 'warning');
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function adminReactivate(userId) {
    const ok = await showConfirm('This will restore the user\'s access to the platform.', 'Reactivate User Account?');
    if (!ok) return;
    try {
      await apiRequest(`/admin/users/${userId}/reactivate`, { method: 'PATCH' });
      const u = _allUsersCache.find(u => u.id === userId);
      if (u) u.isActive = true;
      renderUsersTable(_allUsersCache, 1);
      showToast('User account reactivated! ✅', 'success');
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function adminChangeRole(userId, currentRole) {
    const newRole = currentRole === 'ADMIN' ? 'USER' : 'ADMIN';
    const ok = await showConfirm(`This will change the user's role to <strong>${newRole}</strong>.`, 'Change User Role?');
    if (!ok) return;
    try {
      await apiRequest(`/admin/users/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role: newRole }),
      });
      const u = _allUsersCache.find(u => u.id === userId);
      if (u) u.role = newRole;
      renderUsersTable(_allUsersCache, 1);
      showToast(`User role changed to ${newRole}.`, 'success');
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function applySubOverride() {
    const userId = (document.getElementById('subOverrideUserId') || {}).value?.trim();
    const plan = (document.getElementById('subOverridePlan') || {}).value;
    const status = (document.getElementById('subOverrideStatus') || {}).value;
    const limitRaw = (document.getElementById('subOverrideLimit') || {}).value;
    if (!userId) { showToast('Please enter a User ID first.', 'warning'); return; }
    const body = { plan, status };
    if (limitRaw) body.dailyLimit = parseInt(limitRaw, 10);
    try {
      await apiRequest(`/admin/subscriptions/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      showToast(`Subscription updated to ${plan} / ${status} 🎉`, 'success');
      document.getElementById('subOverridePanel').style.display = 'none';
    } catch (err) { showToast(err.message, 'error'); }
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

    // Analytics day range selector
    const daysSel = document.getElementById('selAnalyticsDays');
    if (daysSel) daysSel.addEventListener('change', loadAdminDashboard);

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
      setApiMonitorHost();
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
    setAuthMode,
    toggleAuthMode,
    handleAuthSubmit,
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
    toggleApiMonitor,
    floatApiMonitor,
    dockApiMonitor,
    clearApiLog,
    retryHealth,
    // Admin
    filterUsersTable,
    goUsersPage,
    adminSuspend,
    adminReactivate,
    adminChangeRole,
    applySubOverride,
    loadMoreLogs,
  };

  // Launch app
  document.addEventListener('DOMContentLoaded', init);
})();
