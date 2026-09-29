# Deploying the API so the demo survives your PC being off

## The problem this solves

`npm run host` runs the API and a Cloudflare quick tunnel **on your machine**. Both die when
you shut down or restart. The Worker URL keeps serving the page, but every API call fails, so a
reviewer sees the offline banner instead of a working demo.

The link a reviewer uses should never depend on your laptop. This document moves the API to a
host that is always on, and repoints the frontend at it. After that, `npm run host` is no longer
needed for the demo.

## Why not Cloudflare Workers or Vercel

Worth stating plainly, because both were suggested and both are the wrong shape for this app:

- **Cloudflare Workers** execute for a few seconds and can only make `fetch` calls. The chat
  endpoint streams over Server-Sent Events (`@Sse`, `text/event-stream`), and Prisma needs a
  persistent TCP connection to Postgres. Neither is possible.
- **Vercel serverless functions** freeze between requests and time out. An SSE stream held open
  for a 25-second LLM response does not fit the execution model, and the Prisma connection pool
  is not reliable across invocations.

The frontend stays on Cloudflare Workers - that is a genuinely good fit for static files. Only
the backend needs to move.

The backend needs a platform that runs a long-lived Node process against a real database:
Render, Fly.io, Railway, or any VPS. **Fly.io is recommended** - see below.

---

## Option A (recommended): Fly.io

### Why Fly and not Render's free tier

A free Render web service **idles out after ~15 minutes of inactivity** and cold-starts on the
next request, taking 30-60 seconds. A reviewer clicking the link would sit through an
"API Offline" banner on the first visit, which looks broken. Fly's free allowance runs a
continuously-resident machine, and `fly.toml` sets `auto_stop_machines = "off"`, so the link
just works.

### 1. Create a free Postgres that does not expire

Render's free Postgres expires after 30 days. **Neon** does not, and its free tier is enough for
a demo.

- Sign up at <https://neon.tech>
- **Create a project** → region closest to you
- **Connection details** → copy the **pooled** connection string

It looks like:

```
postgresql://USER:PASSWORD@ep-xxxx-pooler.REGION.aws.neon.tech/neondb?sslmode=require
```

Keep it. It is the `DATABASE_URL` for step 3.

### 2. Install the Fly CLI and log in

```powershell
winget install -i Fly.WL --accept-source-agreements --accept-package-agreements
fly auth login
```

### 3. Create the app and set its secrets

```powershell
fly launch --no-deploy --copy-config --name echogpt-api
```

`--copy-config` uses the committed `fly.toml` instead of generating one. Then set the secrets -
type them here and nowhere else, so they cannot be committed by accident:

```powershell
fly secrets set `
  DATABASE_URL="postgresql://USER:PASSWORD@ep-xxxx-pooler.REGION.aws.neon.tech/neondb?sslmode=require" `
  JWT_ACCESS_SECRET="<paste a long random string>" `
  JWT_REFRESH_SECRET="<paste a different long random string>" `
  PROVIDER_KEY_ENCRYPTION_SECRET="<64 hex characters - see below>" `
  CORS_ORIGIN="https://echogpt.taion16240.workers.dev" `
  GEMINI_API_KEY="<your Gemini key>" `
  SEED_ADMIN_PASSWORD="<admin demo password>" `
  SEED_DEMO_PASSWORD="<demo user password>"
```

Generate the two random values in PowerShell:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

`PROVIDER_KEY_ENCRYPTION_SECRET` must be **exactly 32 bytes of hex - 64 characters**:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

A wrong length does not fail loudly. It silently breaks decryption of stored provider keys, so
`GET /admin/provider/health-check` starts reporting every provider as broken.

### 4. Deploy

```powershell
fly deploy
```

Watch the logs. You should see the Prisma migrations apply, the two demo accounts seed, and:

```
EchoGPT backend running on http://localhost:8080/api/v1
```

Verify:

```powershell
Invoke-WebRequest https://echogpt-api.fly.dev/api/v1/health | Select-Object -ExpandProperty Content
```

### 5. Point the frontend at it

The frontend no longer needs the tunnel. Edit `frontend/config.js`:

```js
apiBase: 'https://echogpt-api.fly.dev/api/v1',
```

and clear the tunnel-specific fallbacks, since a quick-tunnel hostname is now meaningless:

```js
apiBaseFallbacks: [],
```

Then deploy the Worker:

```powershell
npm run deploy
```

### 6. Stop the local host

The tunnel and watchdog are no longer doing anything useful, and leaving them running just means
two copies of the API with separate databases:

```powershell
# Ctrl-C in the window running `npm run host`
```

### 7. Re-verify the demo

The audit takes a base URL, so it can be pointed at the new host:

```powershell
$env:GEMINI_KEY = "<your key>"
npm run verify:assignment -- https://echogpt-api.fly.dev/api/v1
```

All 109 checks should pass. Then load
<https://echogpt.taion16240.workers.dev> in a private window and confirm a chat reply comes back.

---

## Option B: Render

Already configured in `render.yaml`.

1. Push the repo to GitHub.
2. Render → **New → Blueprint** → select the repository.
3. Fill in the `sync: false` values (`PROVIDER_KEY_ENCRYPTION_SECRET`, `CORS_ORIGIN`,
   `GEMINI_API_KEY`, `SEED_ADMIN_PASSWORD`, `SEED_DEMO_PASSWORD`).
4. After it deploys, edit the service's **Environment** tab: set `DATABASE_URL` to the Neon
   connection string (overriding the bundled database), and **remove** the `databases:` block
   from `render.yaml` so the next deploy does not try to recreate it.
5. Point `frontend/config.js` at `https://echogpt-api.onrender.com/api/v1` and run `npm run deploy`.

Two caveats, both real:

- The free web service **sleeps after 15 minutes idle**. First request after a quiet period takes
  30-60 seconds. The frontend's health probe retries and the offline banner lists the hosts it
  tried, so it recovers on its own - but the reviewer's first impression is a slow load.
- The free Postgres **expires after 30 days** unless you use an external one as in step 4.

---

## Option C: Any VPS

`Dockerfile` is in the repo, so the usual path works:

```bash
git clone https://github.com/Ettekhar/echogpt.git && cd echogpt
docker build -t echogpt-api .

docker run -d --name echogpt-api -p 3001:3000 --restart unless-stopped \
  -e DATABASE_URL="postgresql://..." \
  -e JWT_ACCESS_SECRET="..." \
  -e JWT_REFRESH_SECRET="..." \
  -e PROVIDER_KEY_ENCRYPTION_SECRET="$(openssl rand -hex 32)" \
  -e CORS_ORIGIN="https://echogpt.taion16240.workers.dev" \
  -e GEMINI_API_KEY="..." \
  -e SEED_ADMIN_PASSWORD="..." \
  -e SEED_DEMO_PASSWORD="..." \
  echogpt-api
```

Then put nginx or Caddy in front for TLS, and set `frontend/config.js` to the public URL.

`--restart unless-stopped` is what makes this survive a reboot.

---

## What the container does on boot

```
npx prisma migrate deploy && node dist-seed/prisma/seed.js && node dist/main
```

Both steps are idempotent - `migrate deploy` tracks what it has already applied, and the seed is
a set of upserts - so a restart or a scale-out converges to the intended state rather than
corrupting it.

`migrate deploy` **refuses to run** if the database has schema but no migration history (Prisma
error P3005). That is correct: it is better to fail loudly at boot than to silently guess. If
you hit it against an existing database, baseline it once:

```bash
npx prisma migrate resolve --applied 20260101000000_init
```

A fresh Neon database has no such problem - the whole chain runs in order.
