# syntax=docker/dockerfile:1.7
#
# apps/runner: pull-based execution runner (docs/sandbox-security.md, docs/architecture.md section 8).
# Build from the REPO ROOT:
#   docker build -f apps/runner/Dockerfile -t ai-interview-runner .
#
# STATUS: written against the contract while apps/runner was being written. Confirmed from
# apps/runner/package.json: package @ai-interview/runner, start = `tsx src/main.ts`, deps
# @ai-interview/shared + tsx + zod. Still depending on code not present when this was written:
#   - TODO(runner): apps/runner must be in the root "workspaces" array (npm ci --workspace fails
#     otherwise) and in package-lock.json.
#   - TODO(runner): src/main.ts did not exist yet.
#   - TODO(runner): heartbeat file at $RUNNER_HEARTBEAT_FILE, touched after every lease poll
#     (the runner has no inbound port by design, so the healthcheck cannot be an HTTP probe).
#   - TODO(runner): config variable names (see docker-compose.yml runner service).
#
# What this image is, and is not:
#   - It holds the trusted harness and the scheduler client (lease, compare, sign, push result).
#   - It does NOT isolate candidate code by itself. Candidate code runs in a per-run sandbox created
#     through the runner's Sandbox interface. The Docker adapter is DEV-ONLY (shared host kernel,
#     needs a container runtime). Production requires gVisor (runsc) or Firecracker hosts
#     (sandbox-security.md S1, S4). Never mount docker.sock into this container (F1).
#   - No secrets are baked in. The per-runner Ed25519 private key is mounted at run time as a file
#     ($RUNNER_PRIVATE_KEY_FILE) from the secret manager.

# Index digest from Docker Hub (verified 2026-10-08). Bump tag and digest together.
ARG NODE_IMAGE=node:24.18.1-alpine3.24@sha256:f70403e87646dc51b45295f4b8b70cdad0b63d2297c4c9899119b03f7af7a6b3

# ---- deps ----
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/runner/package.json apps/runner/
COPY packages/shared/package.json packages/shared/
COPY packages/prompts/package.json packages/prompts/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspace @ai-interview/runner --omit=dev --ignore-scripts --no-audit --no-fund

# ---- runtime ----
FROM ${NODE_IMAGE} AS runtime
# Drop npm/yarn/corepack, then add a dedicated unprivileged UID for the runner process, distinct
# from the node user (1000) and from the sandbox UID (65534) that candidate code runs as.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg \
 && addgroup -S -g 10001 runner && adduser -S -D -H -u 10001 -G runner runner
ENV NODE_ENV=production \
    TMPDIR=/tmp \
    RUNNER_HEARTBEAT_FILE=/tmp/runner-heartbeat
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY packages/shared packages/shared
COPY apps/runner/package.json apps/runner/
COPY apps/runner/src apps/runner/src
COPY apps/runner/seccomp apps/runner/seccomp
WORKDIR /app/apps/runner
USER 10001:10001
# No EXPOSE: the runner accepts no inbound connections.
# Healthy when the heartbeat file was touched in the last 60 s (TODO(runner): runner must write it).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "const f=process.env.RUNNER_HEARTBEAT_FILE;try{process.exit(Date.now()-require('fs').statSync(f).mtimeMs<60000?0:1)}catch{process.exit(1)}"]
CMD ["node", "--import", "tsx", "src/main.ts"]
