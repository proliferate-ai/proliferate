# Deployment Reference

Complete setup instructions for every deployment mode. Each section is
self-contained — start from the mode you need.

Related references:

- [env-vars.yaml](env-vars.yaml) — canonical list of every env var across the
  stack, with tags for which modes use each one
- [env-secrets-matrix.md](env-secrets-matrix.md) — server env var surface
  (operator-facing)

---

## Mode A: Local Desktop Only

Desktop app with the bundled AnyHarness sidecar. No server, no cloud, no
sign-in.

### Prerequisites

- Node.js (recent LTS)
- pnpm 9+
- Rust stable toolchain

### Setup

```bash
# Install dependencies (one-time)
cd desktop && pnpm install && cd ..
cd anyharness/sdk && pnpm install && cd ../..

# Run
make dev-local
```

This builds the SDK, then starts the Tauri desktop app with the bundled
AnyHarness sidecar. Click `Continue locally` on the login screen.

### Env vars

None. Cloud features are disabled for anonymous users.

---

## Mode B: Local Desktop + Local Control Plane

Full dev stack: desktop + AnyHarness + FastAPI server + PostgreSQL.

### Prerequisites

- Node.js (recent LTS)
- pnpm 9+
- Rust stable toolchain
- Python 3.12+
- `uv`
- Docker (for PostgreSQL)

### Setup

```bash
# Install server dependencies (one-time)
make server-install

# Start PostgreSQL (one-time, or after reboot)
make server-db-up

# Run database migrations
make server-migrate

# Start everything: AnyHarness :8457, server :8000, desktop
make dev
```

### Server env vars

Copy `server/.env.example` to `server/.env`. A basic boot works with no
changes — all vars have local dev defaults.

For cloud workspace support, add these to `server/.env`:

```bash
# GitHub OAuth — register callback URL:
# http://127.0.0.1:8000/auth/desktop/github/callback
GITHUB_OAUTH_CLIENT_ID=<your-client-id>
GITHUB_OAUTH_CLIENT_SECRET=<your-client-secret>

# Sandbox provider — pick one
SANDBOX_PROVIDER=e2b        # or daytona

# E2B
E2B_API_KEY=<your-e2b-key>

# Daytona
# DAYTONA_API_KEY=<your-daytona-key>
# DAYTONA_SERVER_URL=https://app.daytona.io/api
# DAYTONA_TARGET=us

# Optional
ANTHROPIC_API_KEY=<your-key>   # AI session title generation
```

### Desktop env vars

Optional. Copy `desktop/.env.example` to `desktop/.env` if you need to
override the API URL (defaults to `http://127.0.0.1:8000`).

---

## Mode C: Self-Hosted Docker Compose

Run the control plane on any Linux host. Desktop users connect via
`~/.proliferate/config.json`.

### Prerequisites

- Linux host with a public IP
- Docker and Docker Compose v2
- A domain name with DNS pointed at the host
- A GitHub OAuth app

### GitHub OAuth app setup

1. Go to GitHub → Settings → Developer settings → OAuth Apps → New.
2. Set **Homepage URL** to `https://<your-domain>`.
3. Set **Authorization callback URL** to
   `https://<your-domain>/auth/desktop/github/callback`.
4. Note the Client ID and Client Secret.

### Setup

```bash
# Get the deploy files onto the host
# (clone the repo, or copy server/deploy/ from a release)
cd server/deploy

# Create your env file from the example
cp .env.production.example .env.static
```

Edit `.env.static`:

```bash
# ── Required ──────────────────────────────────────────────
SITE_ADDRESS=api.company.com
PROLIFERATE_SERVER_IMAGE=ghcr.io/proliferate-ai/proliferate-server
PROLIFERATE_SERVER_IMAGE_TAG=0.1.0    # pin to a release version

# GitHub OAuth
GITHUB_OAUTH_CLIENT_ID=<from-step-above>
GITHUB_OAUTH_CLIENT_SECRET=<from-step-above>

# Sandbox provider — pick one
SANDBOX_PROVIDER=e2b                  # or daytona

# ── E2B provider ──────────────────────────────────────────
E2B_API_KEY=<your-e2b-key>

# ── Daytona provider ─────────────────────────────────────
# DAYTONA_API_KEY=<your-daytona-key>
# DAYTONA_SERVER_URL=https://app.daytona.io/api
# DAYTONA_TARGET=us

# ── Secrets (leave blank to auto-generate on first boot) ──
POSTGRES_PASSWORD=
JWT_SECRET=
CLOUD_SECRET_KEY=

# ── Cloud workspace runtime ──────────────────────────────
# The control plane uploads an AnyHarness binary into each
# cloud sandbox (both E2B and Daytona). The host needs this
# binary available locally.
#
# Option 1: place the binary manually at the path below.
# Option 2: set RUNTIME_BINARY_URL and let bootstrap fetch it.
CLOUD_RUNTIME_SOURCE_BINARY_PATH=/opt/proliferate/bin/anyharness-linux
PROLIFERATE_HOST_BIN_DIR=/opt/proliferate/bin
RUNTIME_BINARY_URL=https://github.com/proliferate-ai/proliferate/releases/download/server-v0.1.0/anyharness-x86_64-unknown-linux-musl.tar.gz
RUNTIME_BINARY_SHA256_URL=https://github.com/proliferate-ai/proliferate/releases/download/server-v0.1.0/self-hosted-assets.SHA256SUMS

# ── Optional observability ────────────────────────────────
# PROLIFERATE_TELEMETRY_MODE=self_managed
# PROLIFERATE_ANONYMOUS_TELEMETRY_ENDPOINT=https://api.proliferate.com/v1/telemetry/anonymous
# PROLIFERATE_ANONYMOUS_TELEMETRY_DISABLED=false
# SENTRY_DSN=
# SENTRY_ENVIRONMENT=self-hosted
# ANTHROPIC_API_KEY=               # AI session title generation
# CLOUD_RUNTIME_SENTRY_DSN=       # Hosted-product only; self-managed omits runtime Sentry injection
```

Run the bootstrap:

```bash
./bootstrap.sh
```

This will:

1. Auto-generate any blank secrets and persist them to `.env.generated`.
2. Authenticate with the container registry.
3. Download the runtime binary (if `RUNTIME_BINARY_URL` is set).
4. Start PostgreSQL, run migrations, start the API and Caddy.
5. Wait for the health check to pass.

### Desktop configuration

Give each desktop user this file at `~/.proliferate/config.json`:

```json
{ "apiBaseUrl": "https://api.company.com" }
```

### Updating

```bash
# Edit .env.static to bump PROLIFERATE_SERVER_IMAGE_TAG, then:
./update.sh
```

This pulls the new image, runs migrations, and restarts services.

---

## Mode D: AWS CloudFormation

One-click stack that provisions an EC2 host running the same Docker Compose
deployment from Mode C. Amazon Linux 2023 on Graviton (arm64).

Template: `server/infra/self-hosted-aws/template.yaml`

Full docs: [self-hosted-aws.md](self-hosted-aws.md)

### Prerequisites

- An AWS account
- A GitHub OAuth app (see Mode C for setup — use `https://<SiteAddress>` as
  the hostname)
- E2B or Daytona credentials

### Launch the stack

1. Open the CloudFormation console and create a stack from the template.
2. Fill in the parameters:

```text
ReleaseVersion:           0.1.0
SiteAddress:              api.company.com
GitHubOAuthClientId:      <your-client-id>
GitHubOAuthClientSecret:  <your-client-secret>

# Sandbox provider — pick one
SandboxProvider:          e2b        # or daytona

# E2B
E2BApiKey:                <your-e2b-key>

# Daytona
# DaytonaApiKey:          <your-daytona-key>
# DaytonaServerUrl:       https://app.daytona.io/api
# DaytonaTarget:          us
```

3. Leave `PostgresPassword`, `JwtSecret`, and `CloudSecretKey` blank to
   auto-generate.
4. For evaluation without a domain, set `UseSslipFallback=true`.
5. Create the stack and wait for completion.

### Optional parameters

| Parameter | Default | Notes |
| --- | --- | --- |
| `InstanceType` | `t4g.small` | Also `t4g.medium`, `t4g.large` |
| `ServerImageRepository` | `ghcr.io/proliferate-ai/proliferate-server` | Override for private ECR |
| `RuntimeBinaryUrl` | (from release) | Override runtime tarball URL |
| `RuntimeBinaryChecksumUrl` | (from release) | Override SHA256SUMS URL |
| `CreateRoute53Record` | `false` | Auto-create DNS A record |
| `HostedZoneId` | | Required if `CreateRoute53Record=true` |
| `ExistingVpcId` | | Use an existing VPC instead of creating one |
| `ExistingSubnetId` | | Use an existing subnet |
| `AllocateElasticIp` | `true` | Allocate a dedicated Elastic IP |

### Stack outputs

| Output | Description |
| --- | --- |
| `BaseUrl` | Public HTTPS URL for the control plane |
| `SiteAddress` | Resolved public hostname |
| `PublicIp` | IP address serving the control plane |
| `InstanceId` | EC2 instance ID |
| `SsmStartSessionCommand` | AWS CLI command to SSH into the host |

### Desktop configuration

Use the `BaseUrl` output:

```json
{ "apiBaseUrl": "https://api.company.com" }
```

Written to `~/.proliferate/config.json` on each desktop machine.

### Updating

Update `ReleaseVersion` in the CloudFormation stack parameters. `cfn-hup`
reruns the deploy flow in place (pull, migrate, restart).

---

## Mode E: Proliferate Cloud (Production)

Managed deployment for `proliferate.com`. This section documents the full
production surface for internal reference.

### Infrastructure

| Component | Service | Defined in |
| --- | --- | --- |
| Server | ECS Fargate (256 CPU / 512 MB) | `server/infra/main.tf` |
| Database | RDS PostgreSQL (`db.t4g.micro`) | `server/infra/main.tf` |
| Container registry | ECR | `server/infra/main.tf` |
| Desktop updater | S3 + CloudFront (`downloads.proliferate.com`) | `desktop/infra/main.tf` |

### CI pipelines

**Server** (`.github/workflows/server-ci.yml`):

- Lint + test on PRs
- On `main` push: build image, push to ECR + GHCR
- On `server-v*` tag: publish self-hosted release assets (binaries + CFN
  template)

**Desktop** (`.github/workflows/release-desktop.yml`):

- Build macOS / Windows / Linux desktop apps
- Code sign + notarize (macOS)
- Upload updater assets to S3, invalidate CloudFront
- Upload Sentry source maps

### CI secrets

#### Server CI

| Secret | Purpose |
| --- | --- |
| `AWS_ROLE_ARN` (var) | GitHub OIDC role for ECR push |

#### Desktop release

| Secret | Purpose |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Desktop updater signing |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Signing key password |
| `APPLE_CERTIFICATE` | Apple Developer cert (.p12, base64) |
| `APPLE_CERTIFICATE_PASSWORD` | Cert password |
| `APPLE_SIGNING_IDENTITY` | Team ID for code signing |
| `APPLE_API_KEY` | App Store Connect API key ID |
| `APPLE_API_KEY_PATH` | `.p8` key content |
| `APPLE_API_ISSUER` | Notarization issuer ID |
| `KEYCHAIN_PASSWORD` | macOS keychain password |
| `SENTRY_AUTH_TOKEN` | Source map upload |
| `AWS_DESKTOP_RELEASE_ROLE_ARN` (var) | GitHub OIDC role for S3 + CloudFront |
| `DESKTOP_DOWNLOADS_S3_BUCKET` (var) | S3 bucket for updater assets |
| `DESKTOP_CLOUDFRONT_DISTRIBUTION_ID` (var) | CloudFront distribution |

#### Desktop build vars

| Variable | Purpose |
| --- | --- |
| `VITE_PROLIFERATE_API_BASE_URL` | Production API endpoint |
| `VITE_PROLIFERATE_ANONYMOUS_TELEMETRY_ENDPOINT` | Anonymous telemetry collector |
| `VITE_PROLIFERATE_ENVIRONMENT` | `production` |
| `VITE_PROLIFERATE_SENTRY_DSN` | Renderer Sentry DSN |
| `VITE_PROLIFERATE_POSTHOG_KEY` | Renderer PostHog key |
| `VITE_PROLIFERATE_POSTHOG_HOST` | PostHog ingest host |
| `SENTRY_ORG` / `SENTRY_PROJECT` | Source map upload target |

### Production server env vars

All vars from [env-secrets-matrix.md](env-secrets-matrix.md) apply, plus:

- `PROLIFERATE_TELEMETRY_MODE=self_managed`
- Anonymous telemetry vars (`PROLIFERATE_ANONYMOUS_TELEMETRY_*`)
- Observability vars (`SENTRY_*`, `CUSTOMERIO_*`)
- `SUPPORT_SLACK_WEBHOOK_URL` — routes support messages to Proliferate's Slack
- `CLOUD_BILLING_MODE=enforce` for usage-based billing
- `E2B_WEBHOOK_SIGNATURE_SECRET` — E2B webhook verification (when using E2B)

### External dependencies

| Dependency | Used for |
| --- | --- |
| AWS (ECR, ECS, RDS, S3, CloudFront) | Infrastructure |
| GitHub OIDC | CI to AWS auth |
| Apple Developer Program | macOS code signing + notarization |
| Cloudflare | DNS for `downloads.proliferate.com` |
| Sentry | Error tracking (server + desktop) |
| PostHog | Hosted-product desktop analytics + replay |
| Customer.io | User messaging |
