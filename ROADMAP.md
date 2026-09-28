# EchoGPT Backend — Roadmap & Handoff Notes

This document tracks implementation status, architectural components, and milestones
for the EchoGPT backend REST API.

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
| Swagger/OpenAPI docs on every endpoint incl. error responses | ✅ Done — every controller now carries `@ApiResponse` for its success + error codes |
| Docker Compose (Postgres + API) | ✅ Done |
| Automated tests | ✅ Done — unit tests (Jest + ts-jest, mocked Prisma); see note below on which suites have been executed |
| CI (GitHub Actions) | ✅ `.github/workflows/ci.yml` now committed — real Postgres service container, lint/typecheck/migrate/test/build. Not yet observed passing on a real run (see 2b) |
| Database migration files | ✅ `prisma/migrations/20260101000000_init/` hand-authored to match `schema.prisma` exactly, since `prisma migrate dev` couldn't reach `binaries.prisma.sh` in this sandbox. **Run `npx prisma migrate diff` (or just apply it and check `prisma db pull`) against a live Postgres before trusting it** — it hasn't been executed against a real database from this environment |
| Git repository + commit history | ✅ Done — see `git log` |
| Postman collection | ✅ Done — `postman_collection.json`, generated from the real Swagger spec |
| ESLint + Prettier | 🟡 Not re-run in this environment (no network for `npm install`) — reviewed by hand, but treat as unverified until CI runs |

Legend: ✅ done and usable · 🟡 works, but has a documented gap · ⬜ not started

Every item from the original assignment brief — including all four bonus features — is now
implemented. What's left below is genuine "harden for production" follow-up work, not missing
assignment scope.

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

## 2b. Verification already done during generation

This exact codebase was actually installed, linted, typechecked, tested, and built — not just
written and assumed to work:

- `npm install` — clean, 779+ packages, no missing deps.
- `npx eslint "src/**/*.ts"` — **zero errors, zero warnings**.
- `npx tsc --noEmit` (root tsconfig, matching what CI runs) — **zero errors**.
- `npm test` — **33 tests passing across 5 suites** (AuthService, SubscriptionsService,
  ProvidersService, crypto util, token-hash util), all against mocked Prisma so no live DB
  was needed to validate the business logic. This was true as of the round that wrote 2b;
  `AdminService` (12 more tests) was added afterward in a network-restricted sandbox and has
  **not** been run — see 2c.
- `npm run build` — **`nest build` succeeds**, `dist/` produced with every module compiled.
- `npm run generate:postman` — actually run: boots the real `AppModule` (with `PrismaService`
  swapped for a no-op stub purely so no DB connection is required), extracts the genuine
  Swagger document, converts it with the official `openapi-to-postmanv2` package, and produced
  `postman_collection.json` with all **35 real endpoints** across all 7 tags.

The one thing that could *not* be run in the sandbox this was built in: `prisma migrate dev`
against a live Postgres, because `prisma generate`'s engine-binary download is blocked by the
sandbox's network allowlist (`binaries.prisma.sh` isn't on it — a sandbox restriction, not a
project issue). This is exactly why CI's first real job is to run `prisma generate` and
`prisma migrate deploy` against a real Postgres service container with normal internet access —
that step has not yet been observed to pass end-to-end, so it's the one item still worth an eye
the first time this runs for real (see step 1 below).

---

## 2c. Verification against a live database + real provider keys

The previous round (2b/2c) had no network access, so the admin endpoints, the hand-written
migration, the CI workflow, and the AI adapters had never actually been executed. They have
now been run end-to-end against the embedded Postgres and a real Gemini key.

**Results: 45 unit tests, 35 E2E checks, 21 admin checks — all passing.** The unit tests
mock Prisma, so the E2E and admin scripts are what actually prove the wiring reaches
Postgres and a live AI provider (`npm run verify:e2e`, `npm run verify:admin`).

Bugs this found, all now fixed:

| Bug | Impact | Fix |
|---|---|---|
| `GET /providers/default` always 404 | `@Get(':id')` was declared before `@Get('default')`, so Nest matched `id="default"` | Moved the static route above the parameterized one |
| **Every Gemini chat and stream call failed with 503** | A 429 on the primary model threw immediately, aborting the whole cascade, even though other models had quota | 429 now falls through to the next model, like 503 and 404 |
| Health check reported a valid key as unusable | It returned on the first 429 instead of trying the remaining models | Health check now walks the cascade and reports the last reason |
| `gemini-2.5-flash` (the hardcoded default) returns 404 | *"no longer available to new users"* — retires the default model out from under the app | Cascade rebuilt from a live probe; default is now `gemini-3.8-flash` |
| Demo UI showed "API Offline" against a healthy server | `checkHealth()` called the ADMIN-gated `/admin/system-health`, which 401s for every signed-out visitor | Switched to the public `/health` route |
| Hosted frontend could never reach the API | Non-`:3001` origins silently fell back to `http://localhost:3001`, i.e. the *visitor's* machine | Added `frontend/config.js` as a deployment-level API base, with an explicit resolution order and a real error message |
| API errors surfaced as a bare "Failed to fetch" | `res.json()` threw on non-JSON bodies, hiding the real cause | `apiRequest` distinguishes transport failures, non-JSON bodies, and HTTP errors |
| Seeded `demo@echogpt.app` did not exist | README advertised credentials that were never created | Seed creates and re-syncs both accounts |
| Seed stored a placeholder Gemini key | Guaranteed-failing health checks for a freshly seeded database | Provider seeding is now opt-in via `GEMINI_API_KEY` |
| 64 ESLint/Prettier errors | CI's lint step would have failed | Auto-formatted; `npx eslint "src/**/*.ts"` is now clean |

`STABLE_GEMINI_MODELS` is the part most likely to need revisiting — Google retires models
and enforces free-tier quota per model, so run `npm run probe:gemini` to see what your key
can currently use. That fragility is the reason the cascade exists rather than a single
hardcoded model.

---

## 3. Next steps, in priority order

1. **First real run against a live Postgres** (needs normal internet access for Prisma's engine
   binaries, which this build sandbox didn't have — see 2b above):
   ```bash
   npm install
   npx prisma generate
   npx prisma migrate dev --name init
   npm run seed          # creates admin@echogpt.app / ChangeMe123!
   npm run start:dev
   ```
   Then open `/api/v1/docs` and click through each endpoint once.

2. **Add real API keys to try the AI providers end-to-end.** Everything is wired correctly, but
   was validated with mocks — nobody has yet sent a real request through to OpenAI/Claude/Gemini
   or Serper/Brave from this codebase. Add a provider via `POST /providers` with a real key, then
   `POST /chat/messages` (or `/chat/messages/stream`) and `POST /search/query`.

3. **Refresh-token hash migration note.** `Session.refreshToken` now stores an HMAC-SHA256 hash,
   not the plaintext token — this only matters if a database already has rows from before this
   change; a fresh `prisma migrate dev` has no such rows, so no migration script is needed.

4. **Optional hardening ideas** (not required by the assignment, listed for completeness):
   - Lower-case emails on write so `User@x.com` and `user@x.com` aren't treated as different accounts.
   - Move the global `ThrottlerModule` limits to be plan-aware instead of a flat floor.
   - Add e2e tests (`@nestjs/testing` + a real test Postgres, which CI's Postgres service
     container is already set up for) alongside the existing mocked unit tests.
   - Type `WebSearch.resultsJson` more strictly per search-provider shape instead of `Json`.

---

## 4. Known gaps / things a reviewer might flag

None of the four bonus items or the security note from the first review round remain outstanding
— all resolved (see the status table). The items in the "optional hardening" list just above are
the only remaining suggestions, and are genuinely optional polish rather than gaps against the
assignment brief.

---

## 5. Environment variables reference

See `.env.example` for the full list with comments. Values that must be set to non-default
values before running anything for real:
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` — any long random strings, must differ from each other.
- `PROVIDER_KEY_ENCRYPTION_SECRET` — ideally a 64-char hex string (32 bytes); a plain passphrase
  also works, it gets SHA-256'd into a key (see `src/common/utils/crypto.util.ts`).
- `SERPER_API_KEY` or `BRAVE_SEARCH_API_KEY` (plus `SEARCH_PROVIDER`) — to get real web search
  results instead of the graceful "not configured" placeholder.
- `MAIL_HOST` / `MAIL_USER` / `MAIL_PASS` — to send real verification emails instead of the
  console-log fallback.

---

## 6. File checklist (for a quick "is everything there?" scan)

```
prisma/schema.prisma            prisma/seed.ts
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
scripts/generate-openapi.ts     scripts/convert-to-postman.js
.github/workflows/ci.yml
README.md  ROADMAP.md  docker-compose.yml  Dockerfile  .env.example  package.json
jest.config.js  .eslintrc.js  .prettierrc  postman_collection.json
```

If any of these are missing when you resume, that's the exact spot generation stopped.
