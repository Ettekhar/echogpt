/**
 * EchoGPT demo frontend - runtime configuration.
 *
 * This file is intentionally NOT bundled. It is plain static JS served as-is,
 * so the deployed API base URL can be changed (and re-deployed) without
 * touching or rebuilding app.js.
 *
 * Resolution order used by app.js:
 *   1. localStorage 'echogpt_api_base'   (per-browser override via the UI switcher)
 *   2. window.ECHOGPT_CONFIG.apiBase     (this file - deployment default)
 *   3. same-origin /api/v1               (when the API serves the frontend itself)
 *   4. http://localhost:3001/api/v1      (last-resort local development default)
 *
 * CORS: the backend allows cross-origin requests, so a public backend URL works
 * from the Cloudflare-hosted page. The backend must be reachable over the public
 * internet for that to succeed - localhost will NOT work for visitors.
 *
 * FAILOVER: a Cloudflare quick tunnel hands out a *different* hostname every
 * time it restarts, so the URL below can go stale without warning. Put a
 * permanent host (Render/Railway/Fly) in `apiBaseFallbacks` and the app will
 * probe each entry until one answers /health, so the demo keeps working even
 * when the tunnel is down. Put the most reliable host FIRST - the probe order
 * is the order below.
 */
window.ECHOGPT_CONFIG = {
  // Primary backend. Currently exposed from localhost:3001 via a Cloudflare
  // quick Tunnel, whose hostname is assigned per-process and changes on every
  // restart. Treat this as disposable.
  apiBase: 'https://could-golden-nitrogen-pan.trycloudflare.com/api/v1',

  // Tried in order when the primary does not answer GET /health.
  // Add a permanent host here (e.g. 'https://echogpt-api.onrender.com/api/v1')
  // to make the demo resilient to tunnel restarts.
  apiBaseFallbacks: [
    // 'https://echogpt-api.onrender.com/api/v1',
  ],

  // How long each candidate gets to answer /health before moving to the next.
  healthProbeTimeoutMs: 6000,
};
