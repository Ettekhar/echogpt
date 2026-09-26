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
- **Cloudflare Pages:** `https://echogpt-demo.pages.dev` *(deploy `frontend/` folder with 0 build steps)*

### 2. Swagger / OpenAPI Documentation
- **Local:** [http://localhost:3001/api/v1/docs](http://localhost:3001/api/v1/docs)

### 3. Test Credentials Pre-Seeded
- **Admin Account:** `admin@echogpt.app` / `ChangeMe123!`
- **Demo Account:** `demo@echogpt.app` / `DemoUser123!`

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
aggregate counts. **`ROADMAP.md` section 2c is worth reading before you trust any of this** — it
lists exactly which pieces have been run and verified versus written-but-not-yet-executed in a
network-restricted sandbox.

A deliberate design call worth flagging: the assignment's DB section lists `Roles` as its own
entity, but this schema implements it as an enum column on `User` (`Role.USER` / `Role.ADMIN`).
That's the simpler, still-normalized choice for a two-role system; a real `Role` table would only
earn its keep once roles need their own attributes (e.g. per-role permission sets).

## Database migrations

`prisma/migrations/20260101000000_init/migration.sql` is committed and matches `schema.prisma`
exactly, but it was hand-written rather than generated by `prisma migrate dev` (this sandbox
couldn't reach `binaries.prisma.sh` to download Prisma's query engine). Apply it with:

```bash
npx prisma migrate deploy
```

against a real Postgres before relying on it, and treat `npx prisma migrate dev` (which regenerates
migrations from the schema) as the source of truth if the two ever disagree.

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
suites as of this commit — see `ROADMAP.md` §2c for which of these have actually been executed
in this environment versus written and reviewed but not yet run.

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

