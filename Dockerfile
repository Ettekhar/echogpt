# syntax=docker/dockerfile:1
#
# Container image for the EchoGPT API.
#
# The app is a long-running Node server (NestJS) that streams chat over
# Server-Sent Events and holds a persistent Prisma connection pool to Postgres,
# so it needs a real process and a real database - it cannot be bundled into a
# serverless function or a Cloudflare Worker. This image is what you deploy to
# any host that runs containers: Render, Fly.io, Railway, Fly, or a VPS.
#
# Debian slim rather than Alpine: bcrypt and the Prisma query engine ship
# prebuilt glibc binaries, and musl needs libc6-compat shims to run them.

# ---------- deps: install everything, including devDependencies ----------
FROM node:20-bookworm-slim AS deps
WORKDIR /app

# openssl is required by Prisma's engine at runtime; ca-certificates by fetch.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# libc6-dev is a build-time need for bcrypt's native module.
COPY package*.json ./
RUN npm ci

# ---------- build: compile TypeScript and generate the Prisma client ----------
FROM deps AS build
WORKDIR /app
COPY . .

# The client must be generated before nest build, because the generated types
# are what the TypeScript compiler reads.
RUN npx prisma generate \
    && npm run build \
    && npm run build:seed

# ---------- runtime: production dependencies only ----------
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-seed ./dist-seed
COPY --from=build /app/prisma ./prisma
COPY package.json ./

# No source tree is needed at runtime. The seeder does `require('../src/common/
# utils/crypto.util')`, but that resolves inside dist-seed/ - tsconfig.seed.json
# sets rootDir to the repo root, so the compiled output already contains
# dist-seed/src/common/{utils,enums}. Copying src/ here would be dead weight.

USER node
EXPOSE 3000

# Migrations and seeding run on every boot. They are idempotent (migrate deploy
# tracks applied migrations; the seed is a set of upserts), so a restart or a
# scale-out cannot corrupt data - it just converges to the intended state.
# `migrate deploy` refuses to run if migrations were never baselined, which is
# the correct behaviour: better to fail loudly than to guess.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist-seed/prisma/seed.js && node dist/main"]
