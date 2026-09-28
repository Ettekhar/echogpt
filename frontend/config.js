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
 */
window.ECHOGPT_CONFIG = {
  // Publicly reachable backend, exposed from localhost:3001 via a Cloudflare
  // Tunnel. A quick tunnel's hostname is assigned per-process, so this changes
  // whenever the tunnel restarts - see the "Tunnel" section of README.md.
  apiBase: 'https://bernard-designing-organization-grad.trycloudflare.com/api/v1',
};
