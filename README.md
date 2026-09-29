# EchoGPT Backend

Production-oriented backend for the **EchoGPT** Chrome Extension (multi-AI chat), built with **NestJS**, **PostgreSQL**, **Prisma**, and documented with **Swagger/OpenAPI**.

> Built as the technical assignment for the AppifyDevs Backend Software Engineering Internship.
> Complete implementation covering all 7 core modules, 4 bonus features, and interactive documentation.

## Stack

- **NestJS 10** (TypeScript, modular architecture)
- **PostgreSQL** + **Prisma ORM**
- **Swagger / OpenAPI** (`/api/v1/docs`)
- **JWT** access + refresh tokens (rotation on refresh)
- **bcrypt** password hashing
- **AES-256-GCM** encryption at rest for stored AI provider API keys
- **Docker Compose** for local Postgres + API

## 🚀 Recruiter Demo & Entry Points

Give recruiters the three convenient entry points to test the assignment:

### 1. Live Interactive Frontend
- **Local:** [http://localhost:3001/](http://localhost:3001/)
- **Deployed (Cloudflare):** https://echogpt.taion16240.workers.dev

### 2. Swagger / OpenAPI Documentation
- **Local:** [http://localhost:3001/api/v1/docs](http://localhost:3001/api/v1/docs)
- **Route:** `GET /api/v1/docs` · machine-readable spec at `GET /api/v1/docs-json`

### 3. Test Credentials Pre-Seeded
- **Admin Account:** `admin@echogpt.app` / `ChangeMe123!`
- **Demo Account:** `demo@echogpt.app` / `DemoUser123!`

Create both with `npm run seed`. The seed is idempotent and re-running it resets
the passwords, so it is the fastest way back to a known-good state.

When `GEMINI_API_KEY` is set, the seed provisions the Gemini provider for **both**
accounts, so either one can chat immediately. Without that variable the seed skips
provider setup rather than storing a placeholder key that would fail its health
check later.

The hosted demo auto-signs visitors in as the **demo** account (`USER` role), so a
reviewer can chat without credentials. It deliberately does not auto-sign in as
admin — doing so would publish the admin panel and the user table to anyone who
opened the page. Sign in as the admin account explicitly to reach it.

> These passwords are committed to this repository. Change `SEED_ADMIN_PASSWORD` /
> `SEED_DEMO_PASSWORD` before putting any real user data behind this deployment.

---

## ⚠️ Pointing the hosted frontend at a backend

The demo frontend is a static site and the API is a Node + Postgres service, so
they deploy separately: the frontend goes to Cloudflare, the API runs on a host
that supports Node and Postgres.

`localhost` in a browser means **the visitor's own machine**. A page served from
`https://echogpt.taion16240.workers.dev` therefore cannot reach a backend on
someone else's `localhost:3001` — which is why the API shows as offline for any
visitor who is not running the backend themselves.

The API base URL is resolved in this order:

1. `localStorage.echogpt_api_base` — per-browser override, set from the
   **API Base URL** box in the demo UI
2. `window.ECHOGPT_CONFIG.apiBase` — from [`frontend/config.js`](frontend/config.js)
3. same-origin `/api/v1` — when the API also serves the frontend (`npm run dev`)
4. `http://localhost:3001/api/v1` — last-resort local default

To make the hosted demo work for everyone, set `apiBase` in `frontend/config.js`
to a publicly reachable backend and redeploy. CORS is already handled: the API
reflects the requesting origin and answers preflights (configurable via
`CORS_ORIGIN`; lock it to your own domain in production).

### Exposing a local backend with a Cloudflare Tunnel

For a zero-cost public demo, a Cloudflare Tunnel fronts the API running on your
machine. Nothing about the API changes — it still serves `localhost:3001`.

```bash
# 1. Download cloudflared (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
# 2. Start the tunnel and note the assigned hostname:
cloudflared tunnel --url http://localhost:3001
#   -> https://<random-words>.trycloudflare.com

# 3. Point the frontend at it and redeploy:
#    frontend/config.js  ->  apiBase: 'https://<random-words>.trycloudflare.com/api/v1'
npx wrangler deploy
```

Verified end to end: login, subscription usage, provider health check, a live
Gemini completion, and the admin dashboard all work from
`https://echogpt.taion16240.workers.dev` against the tunneled backend.

> **A quick tunnel's hostname is assigned per-process and changes on every
> restart.** That is fine for a demo you drive yourself, but it is not something
> to hand a reviewer: `frontend/config.js` has to be edited and redeployed after
> every restart, and long requests have been observed dying with
> `context canceled`. Use the fixed-host deploy below instead.

### Running the public demo: `npm run host`

One command for the whole public setup:

```bash
npm run host
```

It starts the API (embedded Postgres + NestJS), opens a Cloudflare quick
tunnel, writes the assigned hostname into `frontend/config.js`, redeploys the
Worker, and then **watches the tunnel and republishes automatically** if it dies.

This matters because a quick tunnel is a separate process on a home connection:
it gets killed by sleep, by network changes, and by anything that reaps the
process — and its hostname is reassigned every time it restarts. The demo used
to go silently offline in exactly that situation.

**The link you hand to a reviewer never changes.** They always visit:

```
https://echogpt.taion16240.workers.dev
```

Only the tunnel target *behind* that Worker changes, and `npm run host`
rewrites `config.js` and redeploys on its own. The frontend also carries an
API-base failover list and an offline banner that names every host it tried,
so a genuine outage is visible and diagnosable instead of a dead page.

> **This still needs your PC to be on.** If you shut it down or restart, the API
> and the tunnel are both gone and the demo breaks until you run `npm run host`
> again. The Worker URL keeps loading, but every API call fails.
>
> For a link that survives that, deploy the API to a real host — see
> [`DEPLOY.md`](DEPLOY.md). That is the only way the demo stops depending on
> your laptop.

### Deploying the API to a real host

Full step-by-step in **[`DEPLOY.md`](DEPLOY.md)**. The short version:

```bash
fly launch --no-deploy --copy-config --name echogpt-api
fly secrets set DATABASE_URL="postgresql://..." JWT_ACCESS_SECRET="..." \
  JWT_REFRESH_SECRET="..." PROVIDER_KEY_ENCRYPTION_SECRET="$(openssl rand -hex 32)" \
  CORS_ORIGIN="https://echogpt.taion16240.workers.dev" GEMINI_API_KEY="..." \
  SEED_ADMIN_PASSWORD="..." SEED_DEMO_PASSWORD="..."
fly deploy
```

Then point the frontend at the result and redeploy the Worker:

```js
// frontend/config.js
apiBase: 'https://echogpt-api.fly.dev/api/v1',
apiBaseFallbacks: [],   // the tunnel hostname is meaningless now
```

```bash
npm run deploy
```

`fly.toml`, `render.yaml` and `Dockerfile` are all committed, so Fly.io, Render
and any Docker host are all one command away. The short version of which to pick:

| | Runs always | Free | Notes |
| --- | --- | --- | --- |
| **Fly.io** (`fly.toml`) | yes | yes | Recommended. Free allowance keeps a machine resident. |
| Render (`render.yaml`) | no | yes | Free web service sleeps after ~15 min idle; free Postgres expires in 30 days. |
| Any VPS (`Dockerfile`) | yes | — | Needs a server and a card. `--restart unless-stopped` survives reboots. |

> **Why not Cloudflare Workers or Vercel for the API?** Both were considered and
> neither fits. This app streams chat over Server-Sent Events and holds a
> persistent Prisma connection to Postgres. Workers only get a few seconds of
> execution and no TCP sockets; Vercel functions freeze between requests. The
> *frontend* stays on Workers — that is a good fit for static files. Only the
> backend has to move.

`PROVIDER_KEY_ENCRYPTION_SECRET` must be **exactly 32 bytes of hex (64
characters)**. A wrong length does not fail loudly — it silently breaks
decryption of stored provider keys, so every health check starts reporting the
providers as broken.

---

## ☁️ Deploying Frontend to Cloudflare Pages (100% Free)

The `frontend/` folder is designed specifically for **zero-friction, zero-cost Cloudflare Pages hosting**:
1. Connect your repository to **Cloudflare Pages** (or run `npx wrangler pages deploy frontend`).
2. Set Build command: *(leave blank - no build step required)*.
3. Set Output directory: `frontend`.
4. Done! It deploys globally on Cloudflare's CDN. The frontend includes an instant API Base URL switcher in the top bar so anyone can connect it to either local or deployed backend APIs.

---

## Quick start (Local)

```bash
# Start embedded PostgreSQL and NestJS together in one command:
npm run dev
```

- API Base: `http://localhost:3001/api/v1`
- Demo Frontend: `http://localhost:3001/`
- Swagger Docs: `http://localhost:3001/api/v1/docs`

## Project layout

```
src/
  auth/          registration, login, JWT + refresh tokens (hashed at rest), logout, email verification
  users/         profile, change password, delete account, admin user management
  subscriptions/ Free/Premium plans, usage limits, remaining-requests API
  providers/     AI provider CRUD (OpenAI/Claude/Gemini), encrypted keys, health check, streaming
  chat/          send prompt -> AI response (or SSE stream), conversation history
  search/        AI-assisted web search (Serper/Brave adapters), history, recent, suggestions, caching
  admin/         dashboard stats, user/subscription/provider management, logs, health
  mail/          SMTP email delivery (nodemailer) with console fallback
  common/        guards, decorators, filters, interceptors, crypto + token-hash utils
  prisma/        PrismaService/PrismaModule
scripts/
  generate-openapi.ts    builds the OpenAPI doc without needing a live DB
  convert-to-postman.js  converts it into postman_collection.json
.github/workflows/ci.yml lint, typecheck, migrate, test, build - on a real Postgres service container
prisma/
  schema.prisma  full normalized schema (Users, Sessions, Subscriptions, AiProvider,
                  Conversation, Message, WebSearch, ApiUsageLog)
  seed.ts        seeds one ADMIN account
```

## Auth model

- `POST /auth/register`, `/auth/login` return `{ accessToken, refreshToken, user }`.
- Access tokens are short-lived (15m default); refresh tokens are long-lived (7d default)
  and **rotated**: each `/auth/refresh` call revokes the presented token and issues a new pair,
  stored in the `Session` table so they can be revoked (logout, password change, account deletion).
- `RolesGuard` + `@Roles(Role.ADMIN)` protect the `/admin/*` routes.

## AI provider keys

Provider API keys are encrypted with AES-256-GCM (`PROVIDER_KEY_ENCRYPTION_SECRET`) before being
stored, and only a masked preview (`sk-a...wxyz`) is ever returned by the API. Decryption happens
only server-side, at the moment a chat/search request needs to call the provider.

## What's implemented vs. stubbed

Full detail lives in `ROADMAP.md`. Short version: every endpoint the assignment lists is
implemented and documented in Swagger, including the four bonus items (email verification,
streaming chat, a real pluggable web-search backend, and a search-result cache). Admin
subscription/provider management includes per-user view + override endpoints, not just the
aggregate counts.

> **Note on `scripts/dev.js`:** it starts the API but does *not* run migrations. On a database
> that was built with `prisma db push` there is no migration history, so `migrate deploy` refuses
> with P3005. Baseline it once with
> `npx prisma migrate resolve --applied 20260101000000_init`, then `npx prisma migrate deploy`.
> A fresh clone has no such problem — it runs the whole chain in order.

Everything has now been run against a live Postgres and a real Gemini key — see
`ROADMAP.md` §2c for what that uncovered and what was fixed.

`Roles` is a real entity, not an enum. The assignment's DB section lists it separately, and an
enum is not an entity — there is nothing to join against and nothing to describe. So `Role` is a
table (`id`, `name`, `description`, `isSystem`) and `User.roleId` is a non-null foreign key with
`ON DELETE RESTRICT`. The `role` *field* in every API response and in the JWT payload is still
the bare string `"USER"` / `"ADMIN"`, so the storage change is invisible to clients.

That last part is worth a note, because it is the whole risk of the change: `UsersService.sanitize`
flattens the relation back to its name and `JwtStrategy` returns `role.name`, so the frontend,
the Postman collection and every response body are untouched. Moving storage underneath should
not be visible to callers, and the live audit confirms it is not.

`RolesService` resolves a name to an id by upserting and memoising, and `prisma/seed.ts` does
the same. A role row must exist before a user can point at it, which is a real failure mode an
enum could not have — so it is handled rather than assumed away, and a database built with
`prisma db push` (which is what `scripts/dev.js` effectively implies) seeds correctly.

## Database migrations

Migrations are committed and hand-written rather than generated by `prisma migrate dev`
(interactive, so it cannot run in CI or a non-TTY shell). They have since been verified: `npm run
verify:migration` applies the full chain to a throwaway database with the real Prisma migration
engine and diffs the result against `schema.prisma`.

```
RESULT: PASS - migration matches schema.prisma exactly.
```

Apply it with:

```bash
npx prisma migrate deploy
```

against a real Postgres, and treat `npx prisma migrate dev` (which regenerates migrations
from the schema) as the source of truth if the two ever disagree.

## Postman

A ready-to-import collection is committed at `postman_collection.json` — generated directly from
this project's real Swagger spec (not hand-written), with all 35 endpoints grouped by tag and a
`{{baseUrl}}` / `{{accessToken}}` variable pair pre-wired: log in, paste the `accessToken` into
the collection variable, and every authenticated request works. Regenerate it any time the API
changes with:

```bash
npm run generate:postman
```

## Testing

```bash
npm test          # unit tests (Jest + ts-jest), no live DB required - Prisma is mocked
npm run test:cov  # same, with coverage
```

Covers: `AuthService` (register/login/refresh rotation/logout, all failure paths),
`SubscriptionsService` (daily usage reset, limit enforcement, plan changes),
`ProvidersService` (encrypted-key round-trip, ownership checks, health check), `AdminService`
(subscription override, provider enable/disable/delete, system health), and the AES-256-GCM
crypto + refresh-token-hash utilities directly (no mocks needed for those). 45 tests across 6
suites.

### End-to-end verification against a running server

Unit tests mock Prisma, so they cannot prove the wiring actually reaches Postgres and a
live AI provider. These two scripts do:

```bash
npm run dev                                  # in one terminal

# 35 checks: auth, users, subscriptions, provider CRUD, real chat, SSE streaming,
# web search, role enforcement, refresh-token revocation.
$env:GEMINI_KEY = "<your key>"; npm run verify:e2e

# 21 checks: seeded accounts, every /admin endpoint, per-user views/overrides,
# the seeded provider's health check, and the Swagger spec.
npm run verify:admin

# 27 checks: email verification, change password, plan downgrade/cancel and the
# usage limit it triggers, search caching, conversation lifecycle, cross-user
# access control, and account deletion.
$env:GEMINI_KEY = "<your key>"; npm run verify:bonus

# 109 checks: walks the assignment email item by item - all 7 feature areas,
# usage-limit enforcement, logout revocation, account deletion, Swagger
# completeness, and the repository artifacts the submission asks for.
$env:GEMINI_KEY = "<your key>"; npm run verify:assignment

# Applies the init migration to a throwaway database and diffs it against
# schema.prisma. Exits non-zero on drift.
npm run verify:migration
```

All scripts accept a base URL argument (`node scripts/verify-e2e.js https://your-api/api/v1`),
so they can be pointed at a deployed environment. The Gemini key is read from
`GEMINI_KEY` at runtime and is never written to disk.

These suites are the point of the exercise: the unit tests mock Prisma, so
they prove the code runs but not that the wiring is real. The verify scripts
talk to a live backend, and `verify:assignment` in particular is written
against the assignment itself, so a missing feature shows up as a named
failure rather than as silence.

## Gemini model selection

Google retires and re-quotas models without notice, which is the most common cause of
"the key is broken" reports. Two things protect this:

- **Model cascade** (`src/providers/adapters/gemini.adapter.ts`) — a rate limit (429),
  overload (503) or retirement (404) on one model moves to the next instead of failing
  the request. The first model that answers wins.
- **Live probe** — `npm run probe:gemini` checks which models your key can actually use
  right now, and prints the status of each.

```bash
$env:GEMINI_KEY = "<your key>"; npm run probe:gemini
```

Verified working on 2026-09-28: `gemini-3.8-flash`, `gemini-3.5-flash-lite`,
`gemini-3.1-flash-lite`, `gemini-flash-lite-latest`.
`gemini-2.5-flash` and `gemini-2.5-flash-lite` now return 404
*"no longer available to new users"*, and `gemini-3.5-flash` frequently exhausts its
free-tier per-model quota. Override the default with `GEMINI_DEFAULT_MODEL`.

## CI

`.github/workflows/ci.yml` runs on every push/PR: spins up a real Postgres service container,
installs deps, generates the Prisma client, lints, typechecks, runs migrations, runs the test
suite with coverage, and does a full production build.

## Streaming chat (bonus)

`POST /chat/messages/stream` returns `text/event-stream`: a series of `event: chunk` frames with
`{ text }` as tokens arrive, then one `event: done` frame with the persisted message (or
`event: error`). Implemented for all three providers (OpenAI SSE, Anthropic SSE, Gemini
`streamGenerateContent?alt=sse`) via a shared SSE frame reader in
`src/providers/adapters/sse-reader.util.ts`.

## Web search backend

`src/search/adapters/` wires two real providers - Serper.dev and Brave Search - selected via
`SEARCH_PROVIDER` in `.env`. Set `SERPER_API_KEY` or `BRAVE_SEARCH_API_KEY` and it returns real
results; with neither configured, it degrades gracefully to a clear "not configured" payload
instead of failing the request.

## Email verification (bonus)

`src/mail/mail.service.ts` sends real SMTP mail via nodemailer when `MAIL_HOST`/`MAIL_USER`/
`MAIL_PASS` are set in `.env`; otherwise it logs the verification link to the console so the flow
still works end-to-end in local dev without real credentials.

## Refresh token security

Refresh tokens are stored as an HMAC-SHA256 hash (`src/common/utils/token-hash.util.ts`), never in
plaintext, so a leaked `Session` table row alone can't be replayed as a live session.

