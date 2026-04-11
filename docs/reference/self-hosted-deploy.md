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

Services:

- `caddy`: public HTTPS endpoint
- `db`: bundled Postgres 16
- `migrate`: one-shot Alembic job
- `api`: Proliferate control plane

If you want self-hosted cloud workspace provisioning, the control plane host
also needs a Linux `anyharness` runtime binary on disk. The production Compose
stack mounts `${PROLIFERATE_HOST_BIN_DIR:-/opt/proliferate/bin}` into the API
container read-only so `CLOUD_RUNTIME_SOURCE_BINARY_PATH` can point at a host
path like `/opt/proliferate/bin/anyharness-linux`. You can either place that
binary there manually or set `RUNTIME_BINARY_URL` to a tarball that contains
the binary and let `install-runtime.sh` fetch it during bootstrap and updates.

Public traffic goes only to the control plane:

```text
Desktop -> https://api.company.com -> Caddy -> API
```

Cloud workspace runtimes are still provider-hosted. The control plane returns a
`runtimeUrl`, and the desktop talks to that runtime directly.

## First-Time Setup

1. Provision a Linux host with Docker and Docker Compose v2.
2. Point DNS for `api.company.com` at that host.
3. Copy `server/deploy/.env.production.example` to `server/deploy/.env.static`.
4. Fill in the required values:
   - `SITE_ADDRESS`
   - `PROLIFERATE_TELEMETRY_MODE`
   - `PROLIFERATE_HOST_BIN_DIR`
   - `PROLIFERATE_SERVER_IMAGE`
   - `PROLIFERATE_SERVER_IMAGE_TAG`
   - `GITHUB_OAUTH_CLIENT_ID`
   - `GITHUB_OAUTH_CLIENT_SECRET`
   - `SANDBOX_PROVIDER`
   - `E2B_API_KEY` or `DAYTONA_API_KEY`
   - `CLOUD_RUNTIME_SOURCE_BINARY_PATH` if you want cloud workspaces
   - for advanced auth-flow, sandbox template, timeout, or runtime-path
     overrides, add the extra env vars manually from
     [docs/reference/env-secrets-matrix.md](/Users/pablo/proliferate/docs/reference/env-secrets-matrix.md)
5. Leave `POSTGRES_PASSWORD`, `JWT_SECRET`, and `CLOUD_SECRET_KEY` blank if you want
   `bootstrap.sh` to generate and persist them in `server/deploy/.env.generated`
   on first startup.
6. Either place a Linux `anyharness` binary on the host at
   `${PROLIFERATE_HOST_BIN_DIR:-/opt/proliferate/bin}/anyharness-linux` and set:

```text
CLOUD_RUNTIME_SOURCE_BINARY_PATH=/opt/proliferate/bin/anyharness-linux
```

Or set:

```text
CLOUD_RUNTIME_SOURCE_BINARY_PATH=/opt/proliferate/bin/anyharness-linux
RUNTIME_BINARY_URL=https://github.com/proliferate-ai/proliferate/releases/download/server-vX.Y.Z/anyharness-x86_64-unknown-linux-musl.tar.gz
RUNTIME_BINARY_SHA256_URL=https://github.com/proliferate-ai/proliferate/releases/download/server-vX.Y.Z/self-hosted-assets.SHA256SUMS
```

If you want `bootstrap.sh` and `update.sh` to verify the public HTTPS endpoint
after the local API passes health, also set:

```text
PROLIFERATE_PUBLIC_HEALTHCHECK_URL=https://api.company.com/health
```

7. Run:

```bash
./server/deploy/bootstrap.sh
```

8. Give desktop users this config:

```json
{
  "apiBaseUrl": "https://api.company.com"
}
```

## Update Flow

The canonical self-hosted update flow is:

```bash
./server/deploy/update.sh
```

That script runs:

```bash
docker compose -f docker-compose.production.yml pull
docker compose -f docker-compose.production.yml run --rm migrate
docker compose -f docker-compose.production.yml up -d
```

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
[server/infra/self-hosted-aws/template.yaml](/Users/pablo/proliferate/server/infra/self-hosted-aws/template.yaml)
provisions this same deployment on a single EC2 host. See
[docs/reference/self-hosted-aws.md](/Users/pablo/proliferate/docs/reference/self-hosted-aws.md)
for the full install and update flow.
