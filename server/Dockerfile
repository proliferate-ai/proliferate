# syntax=docker/dockerfile:1

# ── Web builder ──────────────────────────────────────────────────────────────
# Compile the shared ProductClient Web application into apps/web/dist so the
# self-hosted server image can serve it same-origin. This stage runs Node only
# at build time; the final Python runtime image copies just the compiled output
# and runs no Node server. The self-host build bakes NO managed API hostname:
# VITE_PROLIFERATE_API_BASE_URL is intentionally unset, so the Web artifact
# resolves its API from window.location.origin at runtime (see
# apps/web/src/config/env.ts).
FROM node:22-slim AS web-builder

# Match the repository's pinned pnpm (see .github/workflows CI and vercel.json).
ENV PNPM_VERSION=10.11.0
RUN npm install --global "pnpm@${PNPM_VERSION}"

WORKDIR /build

# Copy only the workspace manifests + lockfile first so a dependency install
# layer caches across source-only changes.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY anyharness/sdk/package.json anyharness/sdk/
COPY anyharness/sdk-react/package.json anyharness/sdk-react/
COPY anyharness/tests/package.json anyharness/tests/
COPY cloud/sdk/package.json cloud/sdk/
COPY cloud/sdk-react/package.json cloud/sdk-react/
COPY apps/desktop/package.json apps/desktop/
COPY apps/mobile/package.json apps/mobile/
COPY apps/packages/design/package.json apps/packages/design/
COPY apps/packages/product-client/package.json apps/packages/product-client/
COPY apps/packages/product-domain/package.json apps/packages/product-domain/
COPY apps/packages/product-surfaces/package.json apps/packages/product-surfaces/
COPY apps/packages/product-ui/package.json apps/packages/product-ui/
COPY apps/packages/ui/package.json apps/packages/ui/
COPY server/artifact-runtime/package.json server/artifact-runtime/
COPY apps/web/package.json apps/web/
COPY tests/intent/package.json tests/intent/
COPY tests/release/package.json tests/release/

# product-client runs a `prepare` lifecycle script during install; copy just
# that script so the install's prepare step resolves. It gracefully skips the
# catalog sync when /catalogs is absent (the full catalog is copied and synced
# again at build time), so this stays in the cached dependency layer.
COPY apps/packages/product-client/scripts apps/packages/product-client/scripts

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Now copy the sources every workspace package apps/web needs. The agent catalog
# is copied because product-client's build syncs it into its generated tree.
COPY anyharness/sdk anyharness/sdk
COPY anyharness/sdk-react anyharness/sdk-react
COPY cloud/sdk cloud/sdk
COPY cloud/sdk-react cloud/sdk-react
COPY apps/packages apps/packages
COPY apps/web apps/web
COPY catalogs catalogs
COPY VERSION VERSION

# Optional release identity for Web telemetry, mirroring vercel.json. Empty in a
# plain build; release CI can pass it. Never carries a managed API hostname.
ARG VITE_PROLIFERATE_RELEASE=""
ENV VITE_PROLIFERATE_RELEASE=${VITE_PROLIFERATE_RELEASE}

# Build the shared packages, then the Web app -> apps/web/dist.
RUN pnpm shared:build && pnpm web:build

# ── Python runtime ───────────────────────────────────────────────────────────
FROM python:3.12-slim AS base

WORKDIR /app
ENV PYTHONPATH=/app

RUN pip install --no-cache-dir uv

COPY server/pyproject.toml ./
COPY server/proliferate/ proliferate/
COPY server/alembic/ alembic/
COPY server/alembic.ini .
# Operational scripts (e.g. the analytics ingestion job run by the
# proliferate-analytics-ingest ECS scheduled task). Not part of the installed
# package; invoked directly as `python /app/scripts/<name>.py`.
COPY server/scripts/ scripts/
COPY catalogs/ catalogs/
# Copied so the server can report a real version even when built without the
# version build args below (the app walks up to find a VERSION file).
COPY VERSION ./VERSION
RUN uv pip install --system --no-cache .

# Compiled ProductClient Web distribution, served same-origin by the API when
# WEB_DIST_DIR points here (docker-compose.production.yml sets it by default).
# Only the compiled output is copied; no Node runtime ships in this image.
COPY --from=web-builder /build/apps/web/dist /app/web-dist

# Version pins the API reports via /health and /meta. Release CI stamps these
# from the root VERSION file and the desktop/runtime/worker package manifests;
# a plain `docker build` with no args falls back to the copied VERSION file
# above.
ARG SERVER_VERSION=""
ARG DESKTOP_VERSION=""
ARG RUNTIME_VERSION=""
ARG WORKER_VERSION=""
ARG MIN_DESKTOP_VERSION=""
ENV SERVER_VERSION=${SERVER_VERSION} \
    DESKTOP_VERSION=${DESKTOP_VERSION} \
    RUNTIME_VERSION=${RUNTIME_VERSION} \
    WORKER_VERSION=${WORKER_VERSION} \
    MIN_DESKTOP_VERSION=${MIN_DESKTOP_VERSION}

EXPOSE 8000

CMD ["uvicorn", "proliferate.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
