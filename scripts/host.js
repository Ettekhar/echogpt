/* eslint-disable */
/**
 * One-command public host for the demo.
 *
 *   npm run host
 *
 * Starts the API (embedded Postgres + NestJS), opens a Cloudflare quick tunnel,
 * points frontend/config.js at whatever hostname the tunnel was assigned, and
 * redeploys the Worker.
 *
 * The reason this exists: a quick tunnel hands out a DIFFERENT hostname every
 * time it restarts, and the tunnel dies whenever the machine sleeps or the
 * process is killed. The previous arrangement - a hardcoded URL in config.js
 * plus a manually started tunnel - meant the demo silently went offline and
 * nobody noticed until a reviewer loaded the page.
 *
 * The fix that matters for a reviewer: they always visit the same Worker URL
 * (https://echogpt.taion16240.workers.dev). Only the tunnel target *behind* it
 * changes, and this script rewrites config.js and redeploys automatically, so
 * the link they were given never breaks.
 *
 * This still requires this machine to stay on. For a URL that survives that,
 * deploy the API to a fixed host (render.yaml).
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const CF = path.join(os.tmpdir(), 'opencode', 'cloudflared', 'cloudflared.exe');
const LOCAL_API = 'http://localhost:3001/api/v1/health';
const CONFIG = path.join(ROOT, 'frontend', 'config.js');
const RECONNECT_DEADLINE = 90_000;
const HEALTH_INTERVAL = 15_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (msg) => console.log(`[host] ${msg}`);

let apiProc = null;
let tunnelProc = null;
let currentUrl = null;

async function waitForHealth(url, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (res.ok) return true;
    } catch (_) {
      /* not up yet */
    }
    await sleep(1000);
  }
  return false;
}

/** Start the NestJS + embedded Postgres backend and wait until it answers. */
async function startApi() {
  if (await waitForHealth(LOCAL_API, 1500)) {
    say('API already listening on :3001');
    return;
  }
  say('starting API (npm run dev)...');
  const out = fs.openSync(path.join(ROOT, '.devserver.log'), 'a');
  apiProc = spawn('npm.cmd', ['run', 'dev'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });
  // Mirror child output into the log file rather than inheriting it, so this
  // script stays readable when the API spews NestJS startup banners.
  const devLog = fs.createWriteStream(path.join(ROOT, '.devserver.log'), { flags: 'a' });
  apiProc.stdout.pipe(devLog);
  apiProc.stderr.pipe(devLog);
  apiProc.on('exit', (code) => say(`API process exited (code ${code})`));
  const ok = await waitForHealth(LOCAL_API, RECONNECT_DEADLINE);
  if (!ok) throw new Error(`API did not become healthy within ${RECONNECT_DEADLINE / 1000}s — see .devserver.log`);
  say('API healthy on :3001');
}

/**
 * Start cloudflared and resolve with the hostname it was assigned.
 * A quick tunnel never picks its own URL, so this has to be scraped from its
 * startup banner - there is no API to query.
 */
function startTunnel() {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(CF)) {
      reject(new Error(`cloudflared not found at ${CF}`));
      return;
    }
    const logPath = path.join(os.tmpdir(), 'opencode', 'cloudflared', 'tunnel.log');
    say('opening Cloudflare quick tunnel...');
    // stdio must be PIPES here, not file descriptors: cloudflared prints the
    // hostname it was assigned on stderr, and there is no API to query for it.
    // Passing a descriptor makes subprocess.stderr null and the banner
    // unparseable.
    tunnelProc = spawn(CF, ['tunnel', '--url', 'http://localhost:3001', '--no-autoupdate'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    const logStream = fs.createWriteStream(logPath, { flags: 'a' });

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('tunnel did not report a hostname within 60s'));
    }, 60_000);

    const onData = (buf) => {
      const text = buf.toString();
      logStream.write(text);
      // cloudflared prints e.g. "https://some-words.trycloudflare.com" in its banner
      const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (m && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve(m[0]);
      }
    };
    tunnelProc.stderr.on('data', onData);
    tunnelProc.stdout.on('data', onData);

    tunnelProc.on('exit', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`tunnel exited early (code ${code}) — see ${logPath}`));
      }
    });
  });
}

/** Rewrite the deployed API base inside frontend/config.js, preserving comments. */
function writeConfig(url) {
  const apiBase = `${url}/api/v1`;
  let src = fs.readFileSync(CONFIG, 'utf8');
  const next = src.replace(
    /(apiBase:\s*')[^']*(')/,
    `$1${apiBase}$2`,
  );
  if (next === src && !src.includes(apiBase)) {
    throw new Error('could not find apiBase in frontend/config.js');
  }
  if (next !== src) {
    fs.writeFileSync(CONFIG, next, 'utf8');
    say(`config.js -> ${apiBase}`);
  } else {
    say(`config.js already points at ${apiBase}`);
  }
  return apiBase;
}

function deploy() {
  return new Promise((resolve, reject) => {
    say('deploying Worker...');
    const p = spawn('npx.cmd', ['wrangler', 'deploy'], { cwd: ROOT, stdio: 'inherit', shell: true });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`wrangler deploy exited ${code}`))));
    p.on('error', reject);
  });
}

/** Full cutover: tunnel up, config written, Worker redeployed. */
async function bringUp() {
  const url = await startTunnel();
  currentUrl = url;
  say(`tunnel assigned: ${url}`);

  // The tunnel resolves before it can serve traffic, so wait for it to answer.
  if (!(await waitForHealth(`${url}/api/v1/health`, RECONNECT_DEADLINE))) {
    throw new Error(`tunnel ${url} never became healthy`);
  }
  say('tunnel healthy');

  writeConfig(url);
  try {
    await deploy();
  } catch (e) {
    // A failed deploy is not fatal: the tunnel is serving, and the previous
    // Worker build still points at an older (now dead) URL. Say so loudly.
    say(`WARNING: ${e.message} - the demo will still show the old URL`);
    throw e;
  }
  say('live at https://echogpt.taion16240.workers.dev');
}

function killTunnel() {
  if (tunnelProc && !tunnelProc.killed) {
    try {
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(tunnelProc.pid), '/f', '/t']);
      else tunnelProc.kill('SIGKILL');
    } catch (_) {
      /* already gone */
    }
  }
  tunnelProc = null;
}

function shutdown() {
  say('shutting down...');
  killTunnel();
  if (apiProc && !apiProc.killed) {
    try {
      apiProc.kill();
    } catch (_) {
      /* already gone */
    }
  }
  process.exit(0);
}

(async () => {
  console.log('\n[host] EchoGPT public host');
  console.log('[host] The Worker URL stays constant even when the tunnel restarts.\n');
  try {
    await startApi();
    await bringUp();
  } catch (e) {
    console.error(`[host] FAILED: ${e.message}`);
    process.exit(1);
  }

  // Watchdog: the tunnel is a separate process on a home network and it *will*
  // die. When it does, cut a new one and republish, so the demo recovers on
  // its own instead of staying broken until someone notices.
  say('watchdog active — polling every ' + HEALTH_INTERVAL / 1000 + 's');
  setInterval(async () => {
    const alive = currentUrl && (await waitForHealth(`${currentUrl}/api/v1/health`, 2000));
    if (alive) return;
    say('tunnel is not answering — restarting');
    killTunnel();
    try {
      await bringUp();
      say('recovered');
    } catch (e) {
      say(`recovery failed: ${e.message} — retrying next cycle`);
    }
  }, HEALTH_INTERVAL);

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
})();
