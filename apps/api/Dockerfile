# syntax=docker/dockerfile:1.7
#
# apps/api: Fastify API, queue worker and migration runner (one image, three commands).
# Build from the REPO ROOT (the API imports packages/shared and packages/prompts, and the migrator
# reads supabase/migrations via a path relative to apps/api/src/db):
#   docker build -f apps/api/Dockerfile -t ai-interview-api .
#
# Commands (same image):
#   api      node --import tsx src/main.ts         (default CMD)
#   worker   node --import tsx src/worker.ts
#   migrate  node --import tsx src/db/migrate-cli.ts
#
# Why tsx at runtime instead of a compiled build: packages/shared and packages/prompts export raw
# .ts ("exports": "./src/index.ts"), and package.json scripts already run through tsx (a production
# dependency). A tsc build would also need those packages compiled and their exports rewritten,
# which is an application change. `node --import tsx` keeps one process (clean SIGTERM handling)
# instead of the tsx CLI's parent/child pair.
#
# No secrets are baked in. Every credential arrives as an environment variable or mounted file at
# run time (docs/deployment.md, "Secrets").

# Index digest from Docker Hub (verified 2026-10-08). Bump tag and digest together.
ARG NODE_IMAGE=node:24.18.1-alpine3.24@sha256:f70403e87646dc51b45295f4b8b70cdad0b63d2297c4c9899119b03f7af7a6b3

# ---- deps: production dependencies for the api workspace only ----
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/prompts/package.json packages/prompts/
# --ignore-scripts: no install-time code from dependencies. esbuild (used by tsx) ships its binary
# as an optional platform package, so it does not need its postinstall script.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspace @ai-interview/api --omit=dev --ignore-scripts --no-audit --no-fund

# ---- runtime ----
FROM ${NODE_IMAGE} AS runtime
# npm, npx, yarn and corepack are not used at run time and carry their own CVEs.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg
# tsx keeps its transform cache in the OS temp dir. With a read-only rootfs, mount a tmpfs at /tmp.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    TMPDIR=/tmp
WORKDIR /app
# Root-owned, read-only to the app user. Layout mirrors the repo so relative paths resolve:
# apps/api/src/db/migrate.ts -> ../../../../supabase/migrations, packages/prompts/templates.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY packages/shared packages/shared
COPY packages/prompts packages/prompts
COPY supabase/migrations supabase/migrations
COPY apps/api/package.json apps/api/tsconfig.json apps/api/
COPY apps/api/src apps/api/src
WORKDIR /app/apps/api
USER node
EXPOSE 4000 4001
# /health is public and unauthenticated (apps/api/src/app.ts). It proves the process serves HTTP;
# it does not check the database. TODO(app): add /ready that checks DB connectivity.
# The worker has no HTTP listener: compose and the orchestrator disable this check for it.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "--import", "tsx", "src/main.ts"]
