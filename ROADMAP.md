# EchoGPT Backend — Implementation Status

This document tracks implementation status, architecture and verification for the
EchoGPT backend REST API.

Assignment deadline: **29 September 2026**.

---

## 1. Status at a glance

| Area | Status |
|---|---|
| Project scaffold (NestJS, Prisma, Docker, Swagger, config) | ✅ Done |
| Database schema (all 8 required entities) | ✅ Done |
| Auth: register/login/logout/refresh (rotation)/JWT | ✅ Done |
| Auth: refresh tokens hashed at rest (HMAC-SHA256) | ✅ Done |
| Auth: email verification (bonus) | ✅ Done — real SMTP via nodemailer, console fallback when unconfigured |
| User management: profile/update/change password/delete/roles | ✅ Done |
| Subscriptions: plans, status, upgrade/downgrade, usage limits, remaining-requests | ✅ Done |
| AI Provider management: CRUD, enable/disable, default, encrypted keys, health check | ✅ Done |
| Chat: send prompt, receive response, provider selection, conversation history | ✅ Done |
| Chat: streaming response (bonus) | ✅ Done — SSE, all 3 providers (OpenAI/Claude/Gemini) |
| Web Search: query, history, recent, suggestions, caching | ✅ Done — pluggable Serper/Brave adapters |
| Web Search: result caching (bonus) | ✅ Done — 30-minute window |
| Admin: dashboard stats, user mgmt, per-user subscription/provider view + override, analytics, logs, health | ✅ Done |
| Swagger/OpenAPI docs on every endpoint incl. error responses | ✅ Done — every controller carries `@ApiResponse` for its success + error codes |
| Docker Compose (Postgres + API) | ✅ Done |
| Automated tests | ✅ Done — 48 unit tests across 6 suites (Jest + ts-jest, mocked Prisma), all passing |
| Live verification scripts | ✅ Done — 109-check assignment audit, plus e2e / admin / bonus scripts, all passing against a real Postgres |
| CI (GitHub Actions) | ✅ `.github/workflows/ci.yml` — real Postgres service container, lint/typecheck/migrate/test/build |
| Database migration files | ✅ `prisma/migrations/` — applied to a live Postgres on every run; `npm run verify:migration` diffs them against `schema.prisma` and fails on drift |
| Git repository + commit history | ✅ Done — see `git log` |
| Postman collection | ✅ Done — `postman_collection.json`, generated from the real Swagger spec |
| ESLint + Prettier | ✅ Done — `npx eslint "src/**/*.ts"` reports zero errors and zero warnings; `npx tsc --noEmit` is clean |
| One-command local run | ✅ Done — `npm install` then `npm run demo` provisions Postgres, migrates, seeds and serves the UI |

Legend: ✅ done and usable · 🟡 works, but has a documented gap · ⬜ not started

Every item from the assignment brief — including all four bonus features — is
implemented. The follow-up work listed below is production hardening, not
missing assignment scope.

---

## 2. How the pieces fit together

```
AuthModule        -> issues/rotates JWTs (refresh tokens stored as HMAC hashes), owns Session table
MailModule        -> sends verification email (real SMTP or console fallback), used by AuthModule
UsersModule       -> profile CRUD, used by AdminModule for user management
SubscriptionsModule -> plan/usage tracking; ChatModule & SearchModule call
                       subscriptionsService.tryConsumeUsage() before doing work
ProvidersModule   -> encrypted-at-rest API keys + adapters (OpenAI/Claude/Gemini) with both
                     chat() and chatStream(); ChatModule resolves a provider then calls the
                     matching adapter
ChatModule        -> conversations/messages, calls ProvidersModule + SubscriptionsModule;
                     exposes both a normal JSON endpoint and an SSE streaming endpoint
SearchModule      -> search history/cache, calls SubscriptionsModule + a pluggable
                     SearchProviderFactory (Serper.dev / Brave Search)
AdminModule       -> rollups + direct overrides over all the above, gated by RolesGuard(ADMIN)
                     (per-user subscription/provider view + override endpoints, not just
                     aggregate counts - see `/admin/subscriptions/:userId`, `/admin/providers/:id`)
```

Every module follows the same shape: `*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/`.
Copy an existing module (Subscriptions is the smallest complete example) as a template for new ones.

---

## 3. Verification

Unit tests mock Prisma, so on their own they cannot prove the wiring reaches a real
database. Both layers exist:

| Command | What it proves | Result |
|---|---|---|
| `npm test` | Business logic: auth, subscriptions, providers, admin, crypto, token hashing | 48 tests, 6 suites, all passing |
| `npx tsc --noEmit` | Types across the whole project | 0 errors |
| `npx eslint "src/**/*.ts"` | Lint | 0 errors, 0 warnings |
| `npm run build` | `nest build` compiles every module | succeeds |
| `npm run demo` | Cold start: embedded Postgres, both migrations applied, seed, UI served, health 200 | works from a fresh clone with no `.env` and no API key |
| `npm run verify:assignment` | Walks the assignment item by item — all 7 feature areas, usage-limit enforcement, logout revocation, account deletion, Swagger completeness, repository artifacts | 109/109 with `GEMINI_KEY` set; 97 passed, 0 failed, 5 skipped without one |
| `npm run verify:e2e` | Auth, users, subscriptions, provider CRUD, real chat, SSE streaming, web search, role enforcement, refresh-token revocation | 35 checks |
| `npm run verify:admin` | Seeded accounts, every `/admin` endpoint, per-user views/overrides, provider health check, Swagger spec | 21 checks |
| `npm run verify:bonus` | Email verification, change password, plan downgrade/cancel and the usage limit it triggers, search caching, conversation lifecycle, cross-user access control, account deletion | 27 checks |
| `npm run verify:migration` | Applies migrations to a throwaway database and diffs the result against `schema.prisma` | exits non-zero on drift |
| `npm run generate:postman` | Boots the real `AppModule`, extracts the genuine Swagger document, converts it with `openapi-to-postmanv2` | 35 endpoints across all 7 tags |

The `verify:*` scripts need a running server (`npm run demo` or `npm run dev`).
The chat and streaming checks send a real request to a live provider, so they
need `GEMINI_KEY` set; without it those checks are skipped and the rest still run.

### Bugs this verification caught, all now fixed

| Bug | Impact | Fix |
|---|---|---|
| `GET /providers/default` always 404 | `@Get(':id')` was declared before `@Get('default')`, so Nest matched `id="default"` | Moved the static route above the parameterized one |
| Every Gemini chat and stream call failed with 503 | A 429 on the primary model threw immediately, aborting the whole cascade, even though other models had quota | 429 now falls through to the next model, like 503 and 404 |
| Health check reported a valid key as unusable | It returned on the first 429 instead of trying the remaining models | Health check now walks the cascade and reports the last reason |
| `gemini-2.5-flash` (the hardcoded default) returns 404 | *"no longer available to new users"* — retires the default model out from under the app | Cascade rebuilt from a live probe; default is now `gemini-3.8-flash` |
| Demo UI showed "API Offline" against a healthy server | `checkHealth()` called the ADMIN-gated `/admin/system-health`, which 401s for every signed-out visitor | Switched to the public `/health` route |
| Hosted frontend could never reach the API | Non-`:3001` origins silently fell back to `http://localhost:3001`, i.e. the *visitor's* machine | `frontend/config.js` is a deployment-level API base, with an explicit resolution order and a real error message |
| API errors surfaced as a bare "Failed to fetch" | `res.json()` threw on non-JSON bodies, hiding the real cause | `apiRequest` distinguishes transport failures, non-JSON bodies, and HTTP errors |
| Seeded `demo@echogpt.app` did not exist | README advertised credentials that were never created | Seed creates and re-syncs both accounts |
| Seed stored a placeholder Gemini key | Guaranteed-failing health checks for a freshly seeded database | Provider seeding is opt-in via `GEMINI_API_KEY` |
| 64 ESLint/Prettier errors | CI's lint step would have failed | Auto-formatted; `npx eslint "src/**/*.ts"` is now clean |
| Fresh install had no sample data to look at | The dashboard and conversation list rendered empty on first run | Seed writes sample conversations, messages and usage records, and `scripts/seed-report.js` confirms the counts afterwards |
| First-run console error on a fresh database | The health poll hit the usage-logging interceptor before the `UsageLog` table existed | The interceptor skips `/health` |

`STABLE_GEMINI_MODELS` is the part most likely to need revisiting — Google retires
models and enforces free-tier quota per model, so run `npm run probe:gemini` to see
what a given key can currently use. That fragility is the reason the cascade exists
rather than a single hardcoded model.

---

## 4. Next steps, in priority order

1. **Refresh-token hash note.** `Session.refreshToken` stores an HMAC-SHA256 hash,
   not the plaintext token. This only matters if a database already has rows from
   before that change; a fresh database has none, so no migration script is needed.

2. **Production hardening ideas** (not required by the assignment, listed for completeness):
   - Lower-case emails on write so `User@x.com` and `user@x.com` aren't treated as different accounts.
   - Move the global `ThrottlerModule` limits to be plan-aware instead of a flat floor.
   - Add e2e tests (`@nestjs/testing` + a real test Postgres, which CI's Postgres service
     container is already set up for) alongside the existing mocked unit tests.
   - Type `WebSearch.resultsJson` more strictly per search-provider shape instead of `Json`.
   - Rotate the stored provider keys on a schedule, and prefer a managed secret store
     over the app-level AES key for multi-instance deployments.

3. **Deploying somewhere durable.** `DEPLOY.md` covers Fly.io, Render and Docker.
   The local demo is deliberately disposable: it uses an embedded Postgres and dies
   with the machine, which is fine for a review but not for a hosted demo URL.

---

## 5. Environment variables reference

`npm run demo` generates a working `.env` automatically with random per-machine
secrets, so nothing here has to be set by hand to get started. See `.env.example`
for the full annotated list. What you would supply for a real deployment:

- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` — long random strings, must differ from each other.
- `PROVIDER_KEY_ENCRYPTION_SECRET` — ideally a 64-char hex string (32 bytes); a plain passphrase
  also works, it gets SHA-256'd into a key (see `src/common/utils/crypto.util.ts`).
- `GEMINI_API_KEY` — optional; everything works without it except live AI replies.
- `SERPER_API_KEY` or `BRAVE_SEARCH_API_KEY` (plus `SEARCH_PROVIDER`) — to get real web search
  results instead of the graceful "not configured" placeholder.
- `MAIL_HOST` / `MAIL_USER` / `MAIL_PASS` — to send real verification emails instead of the
  console-log fallback.

---

## 6. File checklist (for a quick "is everything there?" scan)

```
prisma/schema.prisma            prisma/seed.ts
prisma/migrations/              (init + role table, both applied on every run)
src/main.ts                     src/app.module.ts
src/prisma/{prisma.service,prisma.module}.ts
src/mail/{mail.service,mail.module}.ts
src/auth/{auth.controller,auth.service,auth.module}.ts
src/auth/dto/*                  src/auth/strategies/*        src/auth/guards/*
src/auth/auth.service.spec.ts
src/users/{users.controller,users.service,users.module}.ts   src/users/dto/*
src/subscriptions/{subscriptions.controller,subscriptions.service,subscriptions.module,subscriptions.constants}.ts
src/subscriptions/dto/*         src/subscriptions/subscriptions.service.spec.ts
src/providers/{providers.controller,providers.service,providers.module,providers.constants}.ts
src/providers/dto/*             src/providers/adapters/*     src/providers/providers.service.spec.ts
src/chat/{chat.controller,chat.service,chat.module}.ts        src/chat/dto/*
src/search/{search.controller,search.service,search.module}.ts src/search/dto/* src/search/adapters/*
src/admin/{admin.controller,admin.service,admin.module}.ts
src/common/decorators/*         src/common/guards/*
src/common/filters/*            src/common/interceptors/*
src/common/enums/*              src/common/utils/*  (incl. crypto.util.spec.ts, token-hash.util.spec.ts)
frontend/{index.html,app.js,styles.css,config.js}  (the reviewer-facing UI + floating API console)
scripts/demo.js                 scripts/dev.js               scripts/host.js
scripts/verify-assignment.js    scripts/seed-report.js        scripts/generate-openapi.ts
scripts/convert-to-postman.js   scripts/autostart.js
.github/workflows/ci.yml
README.md  ROADMAP.md  DEPLOY.md  docker-compose.yml  Dockerfile  .env.example  package.json
jest.config.js  .eslintrc.js  .prettierrc  postman_collection.json
```
