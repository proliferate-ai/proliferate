# Self-Hosted Production Deployment

This is the canonical self-hosted deployment story for Proliferate:

- the official desktop app reads `~/.proliferate/config.json` at startup
- the control plane runs from `server/deploy/docker-compose.production.yml`
- the server image also serves the real ProductClient Web application
  same-origin, so a browser can open the same public URL as the API
- installs and updates run through the checked-in deployment scripts
- the AWS one-click stack bootstraps this exact Docker deployment
- self-hosted control planes use anonymous telemetry by default; vendor telemetry
  stays off unless the deployment is explicitly marked as `hosted_product`

## Web served from the server image

A normal self-hosted installation serves the ProductClient Web application from
the same server image as the API:

```text
Browser -> Caddy -> Proliferate server image (FastAPI + compiled Vite Web app)
```

Caddy remains a separate Compose service. The server image does not contain
Caddy or any Node server: the Web builder stage compiles `apps/web` into
`apps/web/dist` at build time, and only that compiled output is copied into the
Python runtime image at `/app/web-dist`. The final image still runs the same
`uvicorn proliferate.main:app` command and no Node process.

`docker-compose.production.yml` sets `WEB_DIST_DIR=/app/web-dist` on the `api`
service, so Web is enabled by default for every ordinary install — local and
EC2 alike, with no new Compose profile and no new public port. The server-side
`WEB_DIST_DIR` setting gates the behavior:

- empty -> Web serving disabled, API-only behavior (the pre-existing default);
- a valid directory containing `index.html` -> the compiled Web app is served;
- a configured directory missing `index.html` -> startup fails clearly (no
  silent fallback to an unrelated directory, and files outside the distribution
  root are never served).

All API/auth/setup routes are registered before a fail-closed SPA fallback:
`/`, `/login`, `/settings`, `/auth/callback`, `/auth/error`, and other client routes serve the ProductClient
`index.html`; `/assets/<hashed file>` serves the real immutable static asset (a
missing asset is a 404, never the shell); `/v1/*`, unknown `/auth/*`, `/health`,
`/meta`, `/setup`, and `/register` remain server-owned and an unknown route in
those namespaces stays a non-200 API failure. The fallback answers only GET and
HEAD navigation; POST/PUT/PATCH/DELETE and WebSocket requests never receive the
shell. `index.html` is served `no-cache`; hashed assets are served
`public, max-age=31536000, immutable`. See
[`server/proliferate/server/web_app.py`](../../../server/proliferate/server/web_app.py).

The Web artifact bakes no managed API hostname: the self-host build leaves
`VITE_PROLIFERATE_API_BASE_URL` unset, so the browser resolves its API from
`window.location.origin` at runtime (see
[`apps/web/src/config/env.ts`](../../../apps/web/src/config/env.ts)). Because Web
and API share one origin, same-origin Web needs no extra CORS configuration.

The managed Web deployment is unaffected: it remains independently hosted on
Vercel and keeps its explicitly configured managed API URL.

### Public origin configuration

`SITE_ADDRESS` is the single public hostname Caddy serves. `bootstrap.sh`
derives BOTH `API_BASE_URL` and `FRONTEND_BASE_URL` from it (for example
`SITE_ADDRESS=proliferate.company.com` yields
`https://proliferate.company.com` for each). Explicit values may repeat that
origin, including `http://localhost` for local evaluation, but preflight rejects
a different `API_BASE_URL` or `FRONTEND_BASE_URL`. These trusted origins are
operator-configured and are never derived from an incoming `Host` or forwarded
header. Existing Desktop CORS origins are unchanged.

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
  install.sh                    # guided installer (fetch release -> verify -> configure -> bootstrap)
  docker-compose.production.yml
  Caddyfile
  .env.production.example
  common.sh                     # shared helpers (release resolution, env read, compose profiles)
  preflight.sh                  # config validation before replacing a running stack
  doctor.sh                     # redacting diagnostics
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
files above plus a `VERSION` file stamped with the release version. See
[Releases](releases.md) for the complete published asset inventory and tag
identities.

Services:

- `caddy`: public HTTPS endpoint (a separate container; never inside the server
  image)
- `db`: bundled Postgres 16
- `migrate`: one-shot Alembic job
- `api`: Proliferate control plane, which also serves the compiled Web
  application at `/app/web-dist` (`WEB_DIST_DIR`)

Server releases include Linux runtime archives containing `anyharness`,
`proliferate-worker`, and `proliferate-supervisor`, but a host-installed archive
is not a current prerequisite for E2B cloud workspaces. The E2B template build
installs the runtime binaries into the template. Current cloud materialization
launches that preinstalled AnyHarness directly and launches Worker as a
separate sidecar. Host runtime-staging and Supervisor launch helpers have no
active call site, so Supervisor process ownership remains an implementation
gap rather than an active install requirement.

Public traffic goes only to the control plane. Both Desktop and a browser reach
the same public address; Caddy proxies `/llm/*` to the optional LiteLLM gateway
and everything else (API, auth, setup, and the Web application) to the server:

```text
Desktop  -> https://api.company.com -> Caddy -> API
Browser  -> https://api.company.com -> Caddy -> API + compiled Web app
```

Cloud workspace runtimes are still provider-hosted. For those workspaces,
Desktop resolves an authenticated AnyHarness gateway URL on the self-hosted
control plane and sends runtime requests through that gateway. Desktop is
configured only with the control-plane `apiBaseUrl`; it does not connect
directly to a provider runtime URL.

The agent LLM gateway is the bundled LiteLLM proxy (compose services
`litellm` + `litellm-db`, behind `--profile agent-gateway`) for sandbox model
traffic:

```text
Sandbox harness -> https://api.company.com/llm -> LiteLLM -> provider API
```

The Proliferate API talks to LiteLLM's management API through
`AGENT_GATEWAY_LITELLM_BASE_URL` (authenticated with
`AGENT_GATEWAY_LITELLM_MASTER_KEY`). Sandboxes receive only short-lived
virtual keys and `AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL`. Enabling the gateway
requires its paired secrets and at least one configured provider credential;
the public base URL is `https://<SITE_ADDRESS>/llm`.

## First-Time Setup

### Guided installer (recommended)

`install.sh` does the whole base install: it detects OS/arch, checks
Docker/Compose/disk/ports, resolves the newest `server-v*` release (never
GitHub's generic `latest`, which is usually a bundle-less desktop/runtime/
product tag), downloads the deploy bundle and its checksum from that release,
verifies the checksum before extracting, installs to `/opt/proliferate`,
generates or preserves `.env.static`, runs `preflight.sh`, and boots the stack
to the claim page. Rerunning is safe: it refreshes the bundle scripts without
overwriting `.env.static`, generated secrets, or data.

```bash
# Inspect first, then install with a real domain (point DNS at the host first):
curl -fsSLO https://raw.githubusercontent.com/proliferate-ai/proliferate/main/server/deploy/install.sh
less install.sh
sudo bash install.sh --domain api.company.com

# Or, convenience pipe:
curl -fsSL https://raw.githubusercontent.com/proliferate-ai/proliferate/main/server/deploy/install.sh \
  | sudo bash -s -- --domain api.company.com

# Evaluation, no domain (sslip.io host from the public IP, real Let's Encrypt TLS):
sudo bash install.sh --eval
```

Pin a specific release with `--version X.Y.Z`; see `install.sh --help` for all
flags (`--eval`, `--telemetry-mode`, `--no-start`, `--dry-run`, `--yes`).
When bootstrap finishes, use the printed `/setup` URL and one-time token to
claim the instance before opening it in Desktop.

After install, manage the instance from `/opt/proliferate/server/deploy`:
`update.sh` (validated in-place update), `doctor.sh` (redacting diagnostics),
and `preflight.sh` (config validation).

### Manual setup

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

4. Fill in the base-install values in `.env.static`:
   - `SITE_ADDRESS`
   - `PROLIFERATE_TELEMETRY_MODE`
   - `PROLIFERATE_SERVER_IMAGE`
   - `PROLIFERATE_SERVER_IMAGE_TAG`
   The control plane, database, migration, Caddy, claim flow, and generated
   internal secrets make up the base install. Configure only the capabilities
   you intend to enable:
   - GitHub OAuth for GitHub-based sign-in in Proliferate Desktop (email and
     password remain available without it);
   - a GitHub App for cloud-workspace repository access;
   - `E2B_API_KEY` and `E2B_TEMPLATE_NAME` together for E2B cloud workspaces;
   - the LiteLLM gateway, SSO, or invitation email independently.
   The complete keys and pairing rules are in
   [.env.production.example](../../../server/deploy/.env.production.example)
   and [env-vars.yaml](../reference/env-vars.yaml).
   To enable the gateway, set `AGENT_GATEWAY_ENABLED=true`, use
   `AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL=https://api.company.com/llm`, set the
   paired LiteLLM secrets, and configure at least one provider key.
5. Leave `POSTGRES_PASSWORD`, `JWT_SECRET`, and `CLOUD_SECRET_KEY` blank if you
   want `bootstrap.sh` to generate and persist them in `.env.generated`
   (next to `.env.static`) on first startup.
6. Optionally put host-local overrides in `.env.local` in the same directory.
   `ensure-secrets.sh` merges `.env.static` with `.env.local` into
   `.env.runtime`, and `.env.local` wins for non-secret operator settings. This
   is mainly useful for generated/self-hosted stacks where `.env.static` may be
   rewritten by infrastructure tooling.
If you want `bootstrap.sh` and `update.sh` to verify the public HTTPS endpoint
after the local API passes health, also set:

```text
PROLIFERATE_PUBLIC_HEALTHCHECK_URL=https://api.company.com/health
```

7. Run, from the deploy directory:

```bash
./bootstrap.sh
```

8. Open the generated `https://api.company.com/setup` claim URL and use the
   one-time setup token printed by `bootstrap.sh` to create the first admin.
   This instance claim happens before ordinary registration or Desktop use;
   later users register through the configured sign-in and invitation paths.
9. Give desktop users this config, restart Desktop, and sign in:

```json
{
  "apiBaseUrl": "https://api.company.com"
}
```

## Update Flow

The canonical in-place update flow is, from the deploy directory:

```bash
./update.sh
```

`update.sh` merges the resolved environment, runs preflight and registry login,
refreshes the configured runtime archive, pulls enabled images, migrates,
reconciles the base and enabled optional-profile services, and waits for
health. Do not replace it with a few bare Compose commands; those omit the
configuration, runtime, registry, optional-service, and health behavior.

The compiled Web application ships inside the server image, so Web and API
advance and roll back together: updating or pinning `PROLIFERATE_SERVER_IMAGE_TAG`
moves both, and rolling back to a prior server image restores the matching Web
build. There is no separate Web deploy or rollback step for self-hosted Web.

The script does not resolve a newer release, fetch newer deployment scripts,
or change a pinned image tag. For a pinned manual upgrade, rerun
`install.sh --version <new-version>` so the selected release bundle and image
tag advance together. The CloudFormation path instead downloads and extracts
the selected release bundle before it invokes `update.sh`.

Optional services are managed through one mechanism: a capability flag in the
resolved env selects a compose profile, and `bootstrap.sh`/`update.sh` compute
the same `--profile` args for every `pull`/`up` call. When
`AGENT_GATEWAY_ENABLED=true`, both scripts automatically pull, start, and
update the profiled `litellm`/`litellm-db` services (compose profile
`agent-gateway`); operators do not run a separate
`docker compose --profile agent-gateway up -d`. The bundled Caddyfile exposes
the enabled gateway at `/llm`.

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

- released version tags
- a rolling `stable` tag

## AWS One-Click Deployment

The AWS CloudFormation stack at
[server/infra/self-hosted-aws/template.yaml](../../../server/infra/self-hosted-aws/template.yaml)
provisions this same deployment on a single EC2 host. See
[self-hosted-aws.md](self-hosted-aws.md)
for the full install and update flow.
