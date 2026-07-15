# Self-hosted Proliferate control plane

This directory is the canonical self-hosted deploy bundle: the Docker Compose
stack, the guided installer, and the operator scripts for the Proliferate
control plane. Every `server-v*` release publishes it as
`proliferate-deploy.tar.gz` (checksummed in `self-hosted-assets.SHA256SUMS`), so
operators do not need to clone the monorepo.

The authoritative operating doc is
[`specs/developing/deploying/self-hosted-deploy.md`](../../specs/developing/deploying/self-hosted-deploy.md).
For AWS, see
[`server/infra/self-hosted-aws/`](../infra/self-hosted-aws/README.md).

## Install

Guided installer (Linux host with Docker + Compose v2). Inspect first, then run:

```bash
curl -fsSLO https://raw.githubusercontent.com/proliferate-ai/proliferate/main/server/deploy/install.sh
less install.sh
sudo bash install.sh --domain api.company.com

# or, no domain (sslip.io host from the public IP, real Let's Encrypt TLS):
sudo bash install.sh --eval
```

The installer resolves the newest `server-v*` release (never GitHub's generic
`latest`), verifies the bundle checksum before extracting, installs to
`/opt/proliferate`, generates or preserves `.env.static`, validates the config,
and boots to the claim page. Rerunning is safe. `install.sh --help` lists all
flags (`--version`, `--eval`, `--no-start`, `--dry-run`, `--yes`).

## What's here

| File | Purpose |
| --- | --- |
| `install.sh` | Guided installer + one-line entrypoint (self-contained). |
| `docker-compose.production.yml` | The stack: `caddy`, `db`, `migrate`, `api`, and the profiled `litellm`/`litellm-db` (agent-gateway) and `redis` (cloud-workspaces). |
| `Caddyfile` | Public HTTPS via Caddy (Let's Encrypt), plus the `/llm` route to the agent gateway when enabled. |
| `.env.production.example` | Copy to `.env.static` and fill in; the installer does this for you. |
| `bootstrap.sh` | First-run: generate secrets, migrate, boot, wait for health, print the claim token. |
| `update.sh` | Pull + migrate + restart, including any enabled optional profile. |
| `preflight.sh` | Validate config before replacing a running stack. |
| `doctor.sh` | Redacting diagnostics for the running instance. |
| `ensure-secrets.sh` | Merge `.env.static` + `.env.local` into `.env.runtime`; generate/persist secrets. |
| `install-runtime.sh` | Place the Linux runtime binaries for cloud workspaces. |
| `registry-login.sh` | Authenticate to private ECR when the image lives there. |
| `wait-for-health.sh` | Health gate + first-run claim instructions. |
| `common.sh` | Shared helpers (release resolution, env read, compose profiles). |

## Manage

Run from the install directory (`/opt/proliferate/server/deploy` by default):

```bash
sudo ./update.sh     # upgrade / apply config changes
sudo ./doctor.sh     # diagnose (redacts secrets)
./preflight.sh       # validate .env before an update
docker compose --env-file .env.runtime -f docker-compose.production.yml logs -f
```

Config lives in `.env.static` (operator settings) and `.env.local` (host-local
overrides that survive infra rewrites). Secrets are generated into
`.env.generated`; never commit either.

## Optional add-ons

- **Cloud workspaces:** set `E2B_API_KEY` **and** `E2B_TEMPLATE_NAME` together
  (setting only the key refuses to boot). Requires the Linux runtime bundle.
  `bootstrap.sh`/`update.sh` bring up the bundled `redis` service (the cloud
  materialization lock) automatically via the `cloud-workspaces` profile.
  Cloud repo access additionally needs a GitHub App (`GITHUB_APP_*`, separate
  from GitHub OAuth sign-in below) — see `.env.production.example`.
- **Agent LLM gateway:** set `AGENT_GATEWAY_ENABLED=true` and the paired
  `LITELLM_MASTER_KEY`/`AGENT_GATEWAY_LITELLM_MASTER_KEY` +
  `LITELLM_POSTGRES_PASSWORD` + `AGENT_GATEWAY_LITELLM_PUBLIC_BASE_URL`
  (`https://<host>/llm`) + at least one provider key. `bootstrap.sh`/`update.sh`
  then manage the `agent-gateway` profile automatically and wait for `litellm`
  to report healthy before finishing.
- **GitHub sign-in / SSO / invitation email:** `GITHUB_OAUTH_CLIENT_ID`+`_SECRET`,
  `SSO_ENABLED`+`SSO_OIDC_*`, and `RESEND_API_KEY`+`RESEND_FROM_EMAIL` are all
  optional and independent of each other — see `.env.production.example` for
  the full set and `preflight.sh`/`doctor.sh` for the completeness checks each
  one gets.
- **Instance branding:** `INSTANCE_NAME`, `INSTANCE_LOGO_URL`,
  `INSTANCE_SUPPORT_EMAIL`, `INSTANCE_SUPPORT_URL` — shown in the connected
  Desktop app; all optional.

Run `./preflight.sh` any time to check for a half-configured add-on before it
takes down a healthy instance, and `./doctor.sh` to see live status.

Point the official desktop app at the control plane by writing
`~/.proliferate/config.json`: `{ "apiBaseUrl": "https://api.company.com" }`.
