/*
 * A floating request console for the Swagger UI page.
 *
 * Swagger shows the response for the one request you made and nothing else.
 * There is no way to see what else the server is doing, no ordering between
 * calls, and no single place to look afterwards - so a reviewer has to click
 * through endpoints one at a time and remember what came back.
 *
 * This watches the requests the page makes and lists them in order with their
 * status and duration. Because it hooks fetch and XMLHttpRequest rather than
 * Swagger's internals, everything on the page is captured: a Try-it-out, an
 * Execute, or traffic from the app in another tab. Click a row for the bodies,
 * or copy it as a curl command to replay it in a terminal.
 *
 * Deliberately standalone rather than shared with frontend/app.js: that file
 * boots the whole application on load, and the docs page has no app to boot.
 * The two consoles share a look, not code.
 */
(function () {
  'use strict';

  if (window.__sgcLoaded) return;
  window.__sgcLoaded = true;

  var LOG_MAX = 60;
  var STORE = 'echogpt_swc_geom';
  var MIN_W = 320;
  var MIN_H = 180;
  var VISIBLE = 32;
  var THRESHOLD = 3;

  var panel, head, footBar, list, pre, summary;
  var log = [];
  var selected = -1;
  var nextId = 1;
  var swallow = false;

  // ---------------------------------------------------------------- geometry

  function viewport() {
    return { w: window.innerWidth, h: window.innerHeight };
  }

  // Bottom-right, 18px in from each edge. A real position rather than a sentinel
  // for CSS to anchor: applyRect always writes left/top, so a sentinel would
  // survive the clamp and park the panel just off the top-left corner.
  function defaultRect() {
    var v = viewport();
    return { l: v.w - 478, t: v.h - 358, w: 460, h: 340 };
  }

  function liveRect() {
    var b = panel.getBoundingClientRect();
    return { l: b.left, t: b.top, w: b.width, h: b.height };
  }

  /*
   * Free on all four edges, like the in-app console: a strip of it always stays
   * on screen so there is always something to grab, but the rest may hang off
   * any side so it can get out of the way of the endpoint being read.
   */
  function clampRect(r) {
    var v = viewport();
    if (!r || !isFinite(r.l) || !isFinite(r.t) || !isFinite(r.w) || !isFinite(r.h)) {
      r = defaultRect();
    }
    r.w = Math.max(MIN_W, Math.min(r.w, v.w));
    r.h = Math.max(MIN_H, Math.min(r.h, v.h));
    r.l = Math.max(VISIBLE - r.w, Math.min(r.l, v.w - VISIBLE));
    r.t = Math.max(VISIBLE - r.h, Math.min(r.t, v.h - VISIBLE));
    return r;
  }

  function applyRect(r) {
    panel.style.left = Math.round(r.l) + 'px';
    panel.style.top = Math.round(r.t) + 'px';
    panel.style.width = Math.round(r.w) + 'px';
    panel.style.height = Math.round(r.h) + 'px';
  }

  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify(liveRect()));
    } catch (e) {
      /* private mode, or quota - the console still works, it just forgets */
    }
  }

  function load() {
    try {
      return clampRect(JSON.parse(localStorage.getItem(STORE) || 'null') || defaultRect());
    } catch (e) {
      return clampRect(defaultRect());
    }
  }

  // ------------------------------------------------------------------- toast

  function toast(text) {
    var host = document.getElementById('sgcToasts');
    if (!host) return;
    var el = document.createElement('div');
    el.className = 'sgc-toast';
    el.textContent = text;
    host.appendChild(el);
    window.setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 2600);
  }

  // ---------------------------------------------------------------- the log

  function statusClass(status, failed) {
    if (failed) return 'sgc-fail';
    if (status >= 500) return 'sgc-servererr';
    if (status >= 400) return 'sgc-clienterr';
    if (status >= 300) return 'sgc-redirect';
    if (status >= 200) return 'sgc-ok';
    return 'sgc-pending';
  }

  function preview(text, max) {
    if (!text) return '(empty)';
    var out = String(text).replace(/\r\n/g, '\n');
    return out.length > max ? out.slice(0, max) + '\n…' : out;
  }

  /*
   * Every entry carries a monotonic id rather than being patched by index: the
   * log is capped, so a burst of requests shifts every index down and a
   * response landing late would otherwise patch the wrong row.
   */
  function add(entry) {
    entry.id = nextId++;
    entry.pending = entry.pending === true;
    log.push(entry);
    while (log.length > LOG_MAX) log.shift();
    // A new row invalidates the selection: keeping it would show a body that no
    // longer matches what is highlighted.
    selected = -1;
    render();
    return entry.id;
  }

  function render() {
    list.textContent = '';
    if (!log.length) {
      var empty = document.createElement('div');
      empty.className = 'sgc-empty';
      empty.textContent =
        'No requests yet. Expand an endpoint and press Execute.';
      list.appendChild(empty);
    }
    for (var i = 0; i < log.length; i++) list.appendChild(buildRow(log[i], i));

    if (selected >= 0 && log[selected]) showBody(log[selected]);
    else pre.classList.add('sgc-hidden');
    updateSummary();
  }

  function buildRow(entry, i) {
    var el = document.createElement('div');
    el.className = 'sgc-row' + (i === selected ? ' sgc-sel' : '');
    el.setAttribute('data-index', String(i));

    var m = document.createElement('span');
    m.className = 'sgc-method sgc-method-' + entry.method;
    m.textContent = entry.method;

    var p = document.createElement('span');
    p.className = 'sgc-path';
    p.textContent = entry.path;
    p.title = entry.url;

    var s = document.createElement('span');
    s.className = 'sgc-status ' + statusClass(entry.status, entry.failed);
    s.textContent = entry.pending ? '…' : entry.failed ? 'ERR' : String(entry.status);

    var d = document.createElement('span');
    d.className = 'sgc-ms';
    d.textContent = entry.pending ? '' : entry.ms + 'ms';

    el.appendChild(m);
    el.appendChild(p);
    el.appendChild(s);
    el.appendChild(d);
    return el;
  }

  function showBody(entry) {
    if (!entry) return;
    if (entry.pending) {
      pre.textContent = 'waiting for response…';
      pre.classList.remove('sgc-hidden');
      return;
    }
    var head = (entry.failed ? 'request failed' : 'HTTP ' + entry.status) + '  ·  ' + entry.ms + 'ms';
    var parts = [head, ''];
    if (entry.req) parts.push('sent:', preview(entry.req, 1200), '');
    parts.push('received:', preview(entry.res, 2400));
    pre.textContent = parts.join('\n');
    pre.classList.remove('sgc-hidden');
  }

  function updateSummary() {
    var done = log.filter(function (e) {
      return !e.pending;
    });
    if (!done.length) {
      summary.textContent = 'waiting for requests';
      return;
    }
    var avg = Math.round(
      done.reduce(function (a, e) {
        return a + e.ms;
      }, 0) / done.length
    );
    var bad = done.filter(function (e) {
      return e.failed || e.status >= 400;
    }).length;
    summary.textContent =
      done.length +
      (done.length === 1 ? ' request' : ' requests') +
      ' · avg ' +
      avg +
      'ms' +
      (bad ? ' · ' + bad + ' failing' : '');
  }

  function patch(id, status, ms, failed, body) {
    for (var i = 0; i < log.length; i++) {
      if (log[i].id !== id) continue;
      log[i].status = status;
      log[i].ms = ms;
      log[i].failed = failed;
      log[i].res = body || '';
      log[i].pending = false;
      render();
      return;
    }
    // Scrolled out of the capped log - nothing to update.
  }

  // ------------------------------------------------------------------- curl

  function shellQuote(s) {
    return "'" + String(s).replace(/'/g, "'\\''") + "'";
  }

  function toCurl(entry) {
    var lines = ['curl -i -X ' + entry.method + ' ' + shellQuote(entry.url)];
    var headers = entry.headers || {};
    ['authorization', 'content-type', 'accept'].forEach(function (name) {
      if (!headers[name]) return;
      lines.push('  -H ' + shellQuote(name + ': ' + headers[name]));
    });
    if (entry.req) lines.push('  -d ' + shellQuote(entry.req));
    return lines.join(' \\\n');
  }

  function copyText(text, okMessage) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () {
          toast(okMessage);
        },
        function () {
          fallbackCopy(text, okMessage);
        }
      );
    } else {
      fallbackCopy(text, okMessage);
    }
  }

  function fallbackCopy(text, okMessage) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      toast(okMessage);
    } catch (e) {
      toast('copy blocked - select the text instead');
    }
    document.body.removeChild(ta);
  }

  // -------------------------------------------------------- network capture

  function pathOf(url) {
    try {
      var u = new URL(url, window.location.origin);
      return u.pathname + u.search;
    } catch (e) {
      return String(url);
    }
  }

  /*
   * Only same-origin API traffic is logged. The docs page also loads Swagger's
   * own bundle and fonts, and listing those next to API calls would bury the
   * signal the console exists to show.
   */
  function isApi(url) {
    try {
      var u = new URL(String(url), window.location.origin);
      if (u.origin !== window.location.origin) return false;
      return u.pathname.indexOf('/api/') === 0;
    } catch (e) {
      return false;
    }
  }

  function headersToObject(input) {
    var out = {};
    if (!input) return out;
    try {
      if (typeof Headers !== 'undefined' && input instanceof Headers) {
        input.forEach(function (v, k) {
          out[String(k).toLowerCase()] = v;
        });
        return out;
      }
      if (Array.isArray(input)) {
        input.forEach(function (pair) {
          if (pair && pair.length >= 2) out[String(pair[0]).toLowerCase()] = String(pair[1]);
        });
        return out;
      }
      for (var k in input) {
        if (Object.prototype.hasOwnProperty.call(input, k)) {
          out[String(k).toLowerCase()] = input[k];
        }
      }
    } catch (e) {
      /* an exotic Headers implementation - not worth breaking the request over */
    }
    return out;
  }

  function statusOf(res) {
    return res && typeof res.status === 'number' ? res.status : 0;
  }

  function instrument() {
    var nativeFetch = window.fetch ? window.fetch.bind(window) : null;
    if (nativeFetch) {
      window.fetch = function (input, init) {
        var url = typeof input === 'string' ? input : input && input.url;
        var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
        if (!isApi(url)) return nativeFetch(input, init);

        var started = performance.now();
        var id = add({
          method: method,
          url: String(url),
          path: pathOf(url),
          headers: headersToObject(
            init && init.headers ? init.headers : input && input.headers
          ),
          req: init && typeof init.body === 'string' ? init.body : '',
          res: '',
          status: 0,
          ms: 0,
          failed: false,
          pending: true
        });

        return nativeFetch(input, init).then(
          function (res) {
            var ms = Math.round(performance.now() - started);
            var ctype =
              res.headers && res.headers.get ? res.headers.get('content-type') || '' : '';
            // Cloning is only safe for a buffered body. Cloning an SSE stream
            // would buffer it and the streaming endpoint would stop streaming.
            if (res.body && /json/i.test(ctype)) {
              res
                .clone()
                .text()
                .then(
                  function (text) {
                    patch(id, statusOf(res), ms, false, text);
                  },
                  function () {
                    patch(id, statusOf(res), ms, false, '');
                  }
                );
            } else {
              patch(id, statusOf(res), ms, false, '');
            }
            return res;
          },
          function (err) {
            patch(id, 0, Math.round(performance.now() - started), true, String((err && err.message) || err));
            throw err;
          }
        );
      };
    }

    // Some Swagger code paths still use XHR. Both hooks are installed: a request
    // goes through exactly one of them, so nothing is logged twice.
    var open = XMLHttpRequest.prototype.open;
    var send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__sgc = { method: String(method || 'GET').toUpperCase(), url: String(url), at: 0 };
      return open.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
      var meta = this.__sgc;
      if (!meta || meta.at || !isApi(meta.url)) return send.apply(this, arguments);
      meta.at = performance.now();
      var self = this;
      var id = add({
        method: meta.method,
        url: meta.url,
        path: pathOf(meta.url),
        headers: {},
        req: typeof body === 'string' ? body : '',
        res: '',
        status: 0,
        ms: 0,
        failed: false,
        pending: true
      });
      this.addEventListener('loadend', function () {
        var text = '';
        try {
          if (self.responseType === '' || self.responseType === 'text') {
            text = String(self.responseText || '').slice(0, 4000);
          }
        } catch (e) {
          /* responseText throws once the response is a stream */
        }
        patch(
          id,
          self.status,
          Math.round(performance.now() - meta.at),
          self.status === 0,
          text
        );
      });
      return send.apply(this, arguments);
    };
  }

  // ------------------------------------------------------------- the panel

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function wirePointer(handle, mode, dir) {
    handle.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      // No preventDefault: it suppresses the compatibility mouse events the
      // click is built from, which is what makes the buttons look dead.
      var start = liveRect();
      var x = e.clientX;
      var y = e.clientY;
      var moved = false;

      try {
        handle.setPointerCapture(e.pointerId);
      } catch (err) {
        /* capture is an optimisation, not a requirement */
      }

      if (mode === 'move') e.currentTarget.classList.add('sgc-dragging');

      var onMove = function (ev) {
        var dx = ev.clientX - x;
        var dy = ev.clientY - y;
        if (!moved && Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return;
        moved = true;
        swallow = true;
        var r = { l: start.l, t: start.t, w: start.w, h: start.h };
        if (mode === 'move') {
          r.l = start.l + dx;
          r.t = start.t + dy;
        } else {
          if (dir.indexOf('e') !== -1) r.w = start.w + dx;
          if (dir.indexOf('s') !== -1) r.h = start.h + dy;
          if (dir.indexOf('w') !== -1) {
            r.w = start.w - dx;
            r.l = start.l + dx;
          }
          if (dir.indexOf('n') !== -1) {
            r.h = start.h - dy;
            r.t = start.t + dy;
          }
          // Resizing from the top or left must not push the panel past the
          // minimum, or the far edge travels with it and the panel inverts.
          if (r.w < MIN_W && dir.indexOf('w') !== -1) {
            r.l = start.l + start.w - MIN_W;
            r.w = MIN_W;
          }
          if (r.h < MIN_H && dir.indexOf('n') !== -1) {
            r.t = start.t + start.h - MIN_H;
            r.h = MIN_H;
          }
        }
        applyRect(clampRect(r));
      };

      var onUp = function () {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        head.classList.remove('sgc-dragging');
        footBar.classList.remove('sgc-dragging');
        save();
      };

      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });

    handle.addEventListener('dblclick', function () {
      if (mode !== 'move') return;
      applyRect(clampRect(defaultRect()));
      save();
    });
  }

  function buildPanel() {
    panel = el('div', 'sgc-panel');
    panel.id = 'sgcPanel';

    head = el('div', 'sgc-head');
    head.setAttribute('data-sgc-drag', '1');
    head.appendChild(el('span', 'sgc-title', 'API console'));
    head.appendChild(el('span', 'sgc-spacer'));

    var clearBtn = el('button', 'sgc-btn', 'Clear');
    clearBtn.type = 'button';
    clearBtn.addEventListener('click', function () {
      log = [];
      selected = -1;
      render();
    });
    head.appendChild(clearBtn);

    var hideBtn = el('button', 'sgc-btn', 'Hide');
    hideBtn.type = 'button';
    hideBtn.addEventListener('click', function () {
      panel.classList.add('sgc-hidden');
    });
    head.appendChild(hideBtn);
    panel.appendChild(head);

    list = el('div', 'sgc-list');
    panel.appendChild(list);

    pre = el('pre', 'sgc-pre sgc-hidden');
    panel.appendChild(pre);

    footBar = el('div', 'sgc-foot');
    footBar.setAttribute('data-sgc-drag', '1');
    summary = el('span', null, 'waiting for requests');
    footBar.appendChild(summary);
    footBar.appendChild(el('span', 'sgc-spacer'));

    var copyBtn = el('button', 'sgc-btn', 'Copy curl');
    copyBtn.type = 'button';
    copyBtn.addEventListener('click', function () {
      if (selected >= 0 && log[selected]) copyText(toCurl(log[selected]), 'curl copied');
      else toast('select a request first');
    });
    footBar.appendChild(copyBtn);

    var showBtn = el('button', 'sgc-btn', 'Show console');
    showBtn.type = 'button';
    showBtn.addEventListener('click', function () {
      panel.classList.remove('sgc-hidden');
    });
    footBar.appendChild(showBtn);
    panel.appendChild(footBar);

    ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se'].forEach(function (dir) {
      var grip = el('div', 'sgc-grip sgc-grip-' + dir);
      grip.setAttribute('data-sgc-grip', dir);
      panel.appendChild(grip);
    });

    wirePointer(head, 'move');
    wirePointer(footBar, 'move');
    Array.prototype.forEach.call(panel.querySelectorAll('[data-sgc-grip]'), function (grip) {
      wirePointer(grip, 'resize', grip.getAttribute('data-sgc-grip'));
    });

    /*
     * A drag that ends over a button would otherwise fire it. Swallowing the
     * click is only correct once the pointer actually travelled, so the flag is
     * re-armed on every press rather than left set from an earlier drag.
     */
    panel.addEventListener(
      'pointerdown',
      function () {
        swallow = false;
      },
      true
    );
    panel.addEventListener(
      'click',
      function (e) {
        if (!swallow) return;
        swallow = false;
        e.stopPropagation();
        e.preventDefault();
      },
      true
    );

    list.addEventListener('click', function (e) {
      var rowEl = e.target && e.target.closest ? e.target.closest('.sgc-row') : null;
      if (!rowEl) return;
      var i = Number(rowEl.getAttribute('data-index'));
      if (!isFinite(i) || !log[i]) return;
      if (e.ctrlKey || e.metaKey) {
        copyText(toCurl(log[i]), 'curl copied');
        return;
      }
      selected = i;
      render();
    });

    document.body.appendChild(panel);

    var toasts = el('div', 'sgc-toasts');
    toasts.id = 'sgcToasts';
    document.body.appendChild(toasts);

    applyRect(load());
    render();
  }

  // ------------------------------------------------------------------- boot

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      buildPanel();
      instrument();
    });
  } else {
    buildPanel();
    instrument();
  }
})();
