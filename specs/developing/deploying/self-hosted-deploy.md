# Self-Hosted Production Deployment

This is the canonical self-hosted deployment story for Proliferate:

- the official desktop app reads `~/.proliferate/config.json` at startup
- the control plane runs from `server/deploy/docker-compose.production.yml`
- updates are image pull + migrate + restart
- the AWS one-click stack bootstraps this exact Docker deployment
- self-hosted control planes use anonymous telemetry by default; vendor telemetry
  stays off unless the deployment is explicitly marked as `hosted_product`

## Desktop Runtime Override

Desktop users point the official app at a self-hosted control plane with:

```json
{
  "apiBaseUrl": "https://api.company.com"
}
```

Desktop users can also disable desktop telemetry entirely with:

```json
{
  "apiBaseUrl": "https://api.company.com",
  "telemetryDisabled": true
}
```

The file path is:

```text
~/.proliferate/config.json
```

Resolution order is:

1. runtime config file
2. `VITE_PROLIFERATE_API_BASE_URL`
3. `http://127.0.0.1:8000`

The file is read once at app startup. Changes require an app restart.

## Production Docker Compose

The canonical self-hosted deploy files live under:

```text
server/deploy/
  docker-compose.production.yml
  Caddyfile
  .env.production.example
  bootstrap.sh
  ensure-secrets.sh
  install-runtime.sh
  registry-login.sh
  update.sh
  wait-for-health.sh
```

Every `server-v*` GitHub release also publishes this directory as a
standalone bundle, `proliferate-deploy.tar.gz` (checksummed in
`self-hosted-assets.SHA256SUMS`), so operators do not need to clone the
monorepo. The bundle extracts to a `proliferate-deploy/` directory with the
files above plus a `VERSION` file stamped with the release version.

Services:

- `caddy`: public HTTPS endpoint
- `db`: bundled Postgres 16
- `migrate`: one-shot Alembic job
- `api`: Proliferate control plane

If you want self-hosted cloud workspace provisioning, the control plane host
also needs the Linux runtime bundle on disk: `anyharness`,
`proliferate-worker`, and `proliferate-supervisor`. The production Compose stack
mounts `${PROLIFERATE_HOST_BIN_DIR:-/opt/proliferate/bin}` into the API
container read-only so `CLOUD_RUNTIME_SOURCE_BINARY_PATH`,
`CLOUD_WORKER_SOURCE_BINARY_PATH`, and `CLOUD_SUPERVISOR_SOURCE_BINARY_PATH` can
point at host paths such as `/opt/proliferate/bin/anyharness-linux`. You can
either place those binaries there manually or set `RUNTIME_BINARY_URL` to a
tarball that contains all three binaries and let `install-runtime.sh` fetch it
during bootstrap and updates.

Public traffic goes only to the control plane:

```text
Desktop -> https://api.company.com -> Caddy -> API
```

Cloud workspace runtimes are still provider-hosted. The control plane returns a
`runtimeUrl`, and the desktop talks to that runtime directly.

The agent LLM gateway uses a Bifrost inference endpoint for sandbox model
traffic:

```text
Sandbox harness -> https://llm.company.com/anthropic/... -> Bifrost -> provider API
```

The Proliferate API talks to the protected Bifrost management API through
`AGENT_GATEWAY_BIFROST_BASE_URL`. Sandboxes receive only virtual keys and
`AGENT_GATEWAY_BIFROST_PUBLIC_BASE_URL`.

## First-Time Setup

1. Provision a Linux host with Docker and Docker Compose v2.
2. Point DNS for `api.company.com` at that host.
3. Fetch the deploy bundle for the release you want to run and create your
   env file (no repo clone needed):

```bash
curl -fsSL https://github.com/proliferate-ai/proliferate/releases/download/server-vX.Y.Z/proliferate-deploy.tar.gz | tar xz
cd proliferate-deploy
cp .env.production.example .env.static
```

To verify the download first, fetch `self-hosted-assets.SHA256SUMS` from the
same release and run `sha256sum -c --ignore-missing` against it before
extracting. The sums file also covers the runtime binaries and the AWS
template, so without `--ignore-missing` the check always fails on this
bundle-only download. Working from a monorepo checkout instead?
`server/deploy/` is the same directory; run the steps below from there.

4. Fill in the required values in `.env.static`:
   - `SITE_ADDRESS`
   - `PROLIFERATE_TELEMETRY_MODE`
   - `PROLIFERATE_HOST_BIN_DIR`
   - `PROLIFERATE_SERVER_IMAGE`
   - `PROLIFERATE_SERVER_IMAGE_TAG`
   - `GITHUB_OAUTH_CLIENT_ID`
   - `GITHUB_OAUTH_CLIENT_SECRET`
   - `E2B_API_KEY`
   - `E2B_TEMPLATE_NAME`
   - optional agent gateway:
     - `AGENT_GATEWAY_ENABLED=true`
     - `AGENT_GATEWAY_BIFROST_BASE_URL=https://bifrost-admin.company.com`
     - `AGENT_GATEWAY_BIFROST_PUBLIC_BASE_URL=https://llm.company.com`
     - `AGENT_GATEWAY_RECONCILER_ENABLED=true`
     - `AGENT_GATEWAY_DEFAULT_MANAGED_BUDGET_USD` if managed credits should be
       available
   - `CLOUD_RUNTIME_SOURCE_BINARY_PATH`,
     `CLOUD_WORKER_SOURCE_BINARY_PATH`, and
     `CLOUD_SUPERVISOR_SOURCE_BINARY_PATH` if you want cloud workspaces
   - for advanced auth-flow, sandbox template, timeout, or runtime-path
     overrides, add the extra env vars manually from
     [env-secrets-matrix.md](../reference/env-secrets-matrix.md)
5. Leave `POSTGRES_PASSWORD`, `JWT_SECRET`, and `CLOUD_SECRET_KEY` blank if you
   want `bootstrap.sh` to generate and persist them in `.env.generated`
   (next to `.env.static`) on first startup.
6. Optionally put host-local overrides in `.env.local` in the same directory.
   `ensure-secrets.sh` merges `.env.static` with `.env.local` into
   `.env.runtime`, and `.env.local` wins for non-secret operator settings. This
   is mainly useful for generated/self-hosted stacks where `.env.static` may be
   rewritten by infrastructure tooling.
7. Either place Linux `anyharness`, `proliferate-worker`, and
   `proliferate-supervisor` binaries on the host under
   `${PROLIFERATE_HOST_BIN_DIR:-/opt/proliferate/bin}` and set:

```text
CLOUD_RUNTIME_SOURCE_BINARY_PATH=/opt/proliferate/bin/anyharness-linux
CLOUD_WORKER_SOURCE_BINARY_PATH=/opt/proliferate/bin/proliferate-worker-linux
CLOUD_SUPERVISOR_SOURCE_BINARY_PATH=/opt/proliferate/bin/proliferate-supervisor-linux
```

Or set:

```text
CLOUD_RUNTIME_SOURCE_BINARY_PATH=/opt/proliferate/bin/anyharness-linux
CLOUD_WORKER_SOURCE_BINARY_PATH=/opt/proliferate/bin/proliferate-worker-linux
CLOUD_SUPERVISOR_SOURCE_BINARY_PATH=/opt/proliferate/bin/proliferate-supervisor-linux
RUNTIME_BINARY_URL=https://github.com/proliferate-ai/proliferate/releases/download/server-vX.Y.Z/anyharness-x86_64-unknown-linux-musl.tar.gz
RUNTIME_BINARY_SHA256_URL=https://github.com/proliferate-ai/proliferate/releases/download/server-vX.Y.Z/self-hosted-assets.SHA256SUMS
```

If you want `bootstrap.sh` and `update.sh` to verify the public HTTPS endpoint
after the local API passes health, also set:

```text
PROLIFERATE_PUBLIC_HEALTHCHECK_URL=https://api.company.com/health
```

8. Run, from the deploy directory:

```bash
./bootstrap.sh
```

9. Give desktop users this config:

```json
{
  "apiBaseUrl": "https://api.company.com"
}
```

## Update Flow

The canonical self-hosted update flow is, from the deploy directory:

```bash
./update.sh
```

That script runs:

```bash
docker compose -f docker-compose.production.yml pull
docker compose -f docker-compose.production.yml run --rm migrate
docker compose -f docker-compose.production.yml up -d
```

When `AGENT_GATEWAY_ENABLED=true`, `bootstrap.sh` and `update.sh` start the same
API stack and expect the configured Bifrost endpoints to be reachable. The
Compose stack no longer creates a bundled gateway service.

Recommended image strategy:

- pin `PROLIFERATE_SERVER_IMAGE_TAG` to a released version for controlled upgrades
- use `stable` only if you want rolling updates
- if `PROLIFERATE_SERVER_IMAGE` points at private ECR, set `AWS_REGION`; `registry-login.sh` will authenticate before pull

## Image Source

Self-hosted production should pull the server image from GHCR:

```text
ghcr.io/proliferate-ai/proliferate-server
```

The CI pipeline publishes:

- commit SHA tags
- released version tags
- a rolling `stable` tag

## AWS One-Click Deployment

The AWS CloudFormation stack at
[server/infra/self-hosted-aws/template.yaml](../../../server/infra/self-hosted-aws/template.yaml)
provisions this same deployment on a single EC2 host. See
[self-hosted-aws.md](self-hosted-aws.md)
for the full install and update flow.
