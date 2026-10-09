# syntax=docker/dockerfile:1.7
#
# apps/web: Next.js standalone server.
# Build from the REPO ROOT (the app imports packages/shared from outside apps/web):
#   docker build -f apps/web/Dockerfile \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.staging.example.com \
#     --build-arg NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co \
#     --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=<public anon key> \
#     -t ai-interview-web .
#
# NEXT_PUBLIC_* values are inlined into the client bundle at build time, so build one image per
# environment. They are public by design (the anon key is protected by RLS). Never pass a
# server secret as a build arg: build args are visible in the builder's history.
#
# Production web is expected to run on Vercel (docs/deployment.md). This image is for local
# compose, self-hosting, and CI smoke tests.

# Index digest from Docker Hub (verified 2026-10-08). Bump tag and digest together.
ARG NODE_IMAGE=node:24.18.1-alpine3.24@sha256:f70403e87646dc51b45295f4b8b70cdad0b63d2297c4c9899119b03f7af7a6b3

# ---- deps: install with the lockfiles only, so this layer caches across source edits ----
FROM ${NODE_IMAGE} AS deps
WORKDIR /repo
# Next resolves @ai-interview/shared from its real path (packages/shared), so its runtime dep (zod)
# must exist in the root node_modules. Install only that workspace from the root lockfile.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/prompts/package.json packages/prompts/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspace @ai-interview/shared --omit=dev --ignore-scripts --no-audit --no-fund
# apps/web is not a root workspace; it has its own lockfile. Dev deps are needed to build.
COPY apps/web/package.json apps/web/package-lock.json apps/web/
RUN --mount=type=cache,target=/root/.npm \
    cd apps/web && npm ci --ignore-scripts --no-audit --no-fund

# ---- build ----
FROM deps AS build
WORKDIR /repo
COPY packages/shared packages/shared
COPY apps/web apps/web
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production \
    NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL} \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}
RUN cd apps/web && npm run build
# Fail the build if the self-hosted Monaco and MediaPipe assets are missing (the app loads them
# from /monaco/vs and /vision; a CDN fallback would break the CSP and the privacy design).
RUN test -f apps/web/public/monaco/vs/loader.js || test -d apps/web/public/monaco/vs \
 && test -f apps/web/public/vision/wasm/vision_wasm_internal.wasm \
 && test -f apps/web/public/vision/models/blaze_face_short_range.tflite

# ---- runtime: standalone output only, no npm, no dev deps, non-root ----
FROM ${NODE_IMAGE} AS runtime
# npm, npx, yarn and corepack are not needed to run `node server.js` and carry their own CVEs.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
# The tracing root is the repo root, so standalone output mirrors the repo: server at apps/web/server.js.
# Files stay root-owned and read-only to the app user.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
# The only path Next writes at runtime (ISR / image cache). Mount a tmpfs here with a read-only rootfs.
RUN mkdir -p apps/web/.next/cache && chown node:node apps/web/.next/cache
USER node
EXPOSE 3000
# TODO(app): switch to a dedicated /api/health route once apps/web has one; `/` renders the landing page.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/',{redirect:'manual'}).then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "apps/web/server.js"]
