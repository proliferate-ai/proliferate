# Self-Hosting Proliferate

This guide covers how to run Proliferate on your own infrastructure.

**Policy:** Core Proliferate services are fully self-hostable. Sandbox execution (Modal or E2B) and LLM providers are external by default. Enterprise deployments can run the sandbox layer inside your VPC/BYOC environment.

**Deployment options:** Docker Compose is the primary supported path today. Pulumi templates for AWS/GCP/Azure are in progress for repeatable infrastructure provisioning.

## Quick Start

### Prerequisites

- **Docker & Docker Compose** - For running services
- **Sandbox provider credentials** - Modal or E2B
- **Anthropic API key** - For Claude (get one at [console.anthropic.com](https://console.anthropic.com))
- **GitHub App** - Required for private repo access (see `docs/ENVIRONMENT.md`)

### Install the CLI (Optional)

The Proliferate CLI lets you interact with your deployment from the terminal:

```bash
curl -fsSL https://proliferate.com/install.sh | bash
```

To install a specific version:

```bash
curl -fsSL https://proliferate.com/install.sh | bash -s 0.2.0
```

The CLI installs to `~/.proliferate/bin` and auto-adds itself to your PATH.

### 1. Clone and Configure

```bash
git clone https://github.com/proliferate-ai/cloud
cd cloud
cp .env.example .env
```

Edit `.env` and fill in the required values (docker-compose reads `.env` by default):

```bash
# Deployment profile
DEPLOYMENT_PROFILE=self_host

# Generate secure keys
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
SERVICE_TO_SERVICE_AUTH_TOKEN=$(openssl rand -base64 32)
USER_SECRETS_ENCRYPTION_KEY=$(openssl rand -hex 32)

# Required
ANTHROPIC_API_KEY=your-anthropic-api-key

# Public URLs
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:3000
NEXT_PUBLIC_GATEWAY_URL=ws://localhost:8787

# Optional feature flags
NEXT_PUBLIC_BILLING_ENABLED=false
NEXT_PUBLIC_INTEGRATIONS_ENABLED=false
NEXT_PUBLIC_ENFORCE_EMAIL_VERIFICATION=false
```

See `docs/ENVIRONMENT.md` for the full list of variables and when each is required.

### GitHub App (Required for Private Repos)

Create a GitHub App and set:

```
GITHUB_APP_ID=...
GITHUB_APP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
GITHUB_APP_WEBHOOK_SECRET=...
NEXT_PUBLIC_GITHUB_APP_SLUG=...
```

Full setup checklist and manifest JSON are in the self‑hosting docs.

**LLM proxy note:** The LLM proxy is optional. If `LLM_PROXY_URL` is unset, sandboxes call Anthropic directly using `ANTHROPIC_API_KEY`. If you enable the proxy, it must be publicly reachable by your sandbox provider.

### 2. Start the Database

Start PostgreSQL using docker-compose:

```bash
# Start PostgreSQL
docker compose up -d postgres

# Run database migrations
pnpm -C packages/db db:migrate
```

The default connection string is already configured in docker-compose:
```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/proliferate
```

If you're using a managed Postgres instance (for example, AWS RDS), add TLS:
```bash
DATABASE_URL=postgresql://user:pass@host:5432/dbname?sslmode=require
```

### 3. Start All Services

```bash
docker-compose up
```

This starts:
- **Web** (port 3000) - Next.js frontend and API
- **Gateway** (port 8787) - WebSocket server for real-time streaming
- **Worker** - Background job processor
- **Redis** (port 6379) - Job queue and caching
- **LiteLLM** (port 4000) - LLM API proxy

### Optional: MinIO for Verification Media

The `verify` tool uploads screenshots/logs to S3-compatible storage. You can use local MinIO:

1. Ensure these values are set in `.env`:
```bash
S3_BUCKET=proliferate-verification
S3_REGION=us-east-1
S3_ENDPOINT_URL=http://minio:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
```

2. Start MinIO with the `minio` profile:
```bash
docker compose --profile minio up -d minio minio-init
```

MinIO console: http://localhost:9001  
MinIO is only used by the gateway; the web UI proxies verification media through the app, so MinIO does **not** need to be publicly accessible.

### 4. Access the App

- **Application**: http://localhost:3000

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Browser   │────▶│     Web     │────▶│  PostgreSQL │
│             │     │  (Next.js)  │     │             │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │
       │ WebSocket         │
       ▼                   ▼
┌─────────────┐     ┌─────────────┐
│   Gateway   │────▶│    Redis    │
│    (ws)     │     │             │
└─────────────┘     └─────────────┘
       │                   │
       │ SSE               │
       ▼                   ▼
┌─────────────┐     ┌─────────────┐
│  E2B Cloud  │     │   Worker    │
│  (Sandbox)  │     │  (BullMQ)   │
└─────────────┘     └─────────────┘
```

## Authentication

### Email/Password Auth

Email/password authentication is always available. If you don’t configure OAuth providers, users can still sign up with email and a password.

### OAuth Providers (Optional)

For GitHub or Google login, configure the OAuth credentials in `.env.local`:

```bash
# GitHub OAuth
GITHUB_OAUTH_APP_ID=your-app-id
GITHUB_OAUTH_APP_SECRET=your-app-secret

# Google OAuth
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
```

## Custom Domain Setup

To run Proliferate on your own domain (e.g., `proliferate.example.com`):

### 1. Configure Environment Variables

Update your `.env` file with your domain:

```bash
# Your custom domain
NEXT_PUBLIC_APP_URL=https://proliferate.example.com

# Gateway URL - can be same domain or subdomain
NEXT_PUBLIC_GATEWAY_URL=https://proliferate.example.com/gateway
# or use a subdomain:
# NEXT_PUBLIC_GATEWAY_URL=https://gateway.proliferate.example.com
```

### 2. Set Up SSL/HTTPS with Caddy (Recommended)

Create a `Caddyfile` for automatic HTTPS:

```caddyfile
proliferate.example.com {
    # Web app
    reverse_proxy web:3000

    # Gateway WebSocket (path-based routing)
    handle /gateway/* {
        uri strip_prefix /gateway
        reverse_proxy gateway:8787
    }
}
```

Or use docker-compose with Caddy:

```yaml
# docker-compose.override.yml
services:
  caddy:
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
    depends_on:
      - web
      - gateway

volumes:
  caddy_data:
```

### 3. Configure OAuth Callbacks (If Using OAuth)

When using GitHub or Google OAuth with a custom domain, update the callback URLs in your OAuth app settings:

**GitHub OAuth App:**
- Authorization callback URL: `https://proliferate.example.com/api/auth/callback/github`

**Google OAuth:**
- Authorized redirect URIs: `https://proliferate.example.com/api/auth/callback/google`

### 4. DNS Configuration

Point your domain to your server:

```
# A record for root domain or subdomain
proliferate.example.com  A  YOUR_SERVER_IP

# Or use CNAME if behind a load balancer
proliferate.example.com  CNAME  your-load-balancer.example.com
```

### Alternative: Nginx Configuration

If you prefer nginx:

```nginx
server {
    listen 443 ssl http2;
    server_name proliferate.example.com;

    ssl_certificate /etc/letsencrypt/live/proliferate.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/proliferate.example.com/privkey.pem;

    # Web app
    location / {
        proxy_pass http://web:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Gateway WebSocket
    location /gateway/ {
        rewrite ^/gateway/(.*) /$1 break;
        proxy_pass http://gateway:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
```

## Production Deployment

For production environments, we recommend:

### Automated Deployment (Recommended)

The interactive deployment wizard handles the full setup: infrastructure provisioning, image builds, and application deployment.

**Prerequisites:**
- Node.js 20+
- [Pulumi CLI](https://www.pulumi.com/docs/install/)
- Docker
- `aws` CLI (for AWS) or `gcloud` CLI (for GCP)

**Run the wizard:**

```bash
node scripts/install-platform.cjs
```

The wizard will:
1. Validate that required tools are installed
2. Set up a Pulumi state backend (S3 + DynamoDB for AWS, GCS for GCP)
3. Prompt for region, project name, and sandbox provider
4. Generate secrets and configuration
5. Provision infrastructure (VPC, EKS/GKE, RDS/Cloud SQL, Redis, ECR/Artifact Registry)
6. Build and push Docker images
7. Deploy all services via Helm

To preview what the wizard would do without making changes:

```bash
node scripts/install-platform.cjs --dry-run
```

Both AWS and GCP are supported. For AWS credential setup, see `docs/ONBOARDING.md`.

For details on the Pulumi infrastructure architecture, see [Pulumi Overview](pulumi-overview.md).

### EC2 Quick Bootstrap

If you're starting from a fresh EC2 instance, the bootstrap script installs Docker, Docker Compose, and Git:

```bash
curl -fsSL https://raw.githubusercontent.com/proliferate-ai/cloud/main/scripts/setup-ec2.sh | bash
```

Supports Amazon Linux, Ubuntu, and Debian. After running, clone the repo and follow the Docker Compose quick start above.

### Manual Infrastructure

You can also provision infrastructure manually:

**Database** - Use any PostgreSQL 15+ service:
- AWS RDS, Google Cloud SQL, Neon, or any compatible provider

**Redis** - Use any Redis-compatible service:
- AWS ElastiCache, Upstash, Redis Cloud

**Container Orchestration:**
- Kubernetes - Helm chart in `infra/helm/proliferate/`
- AWS ECS - Legacy Terraform configs in `infra/terraform/`
- Fly.io, Railway, or any container platform

## Local Development

For contributing or local testing, the dev script starts backing services and an ngrok tunnel for the LLM proxy:

**Prerequisites:** Docker, ngrok (authenticated), `ANTHROPIC_API_KEY` in `.env.local`

```bash
./scripts/dev-start.sh
```

This starts PostgreSQL, Redis, and LiteLLM via Docker, runs database migrations, and opens an ngrok tunnel so sandboxes can reach the proxy. Then start the app:

```bash
LLM_PROXY_URL=<ngrok-url-from-output> pnpm dev
```

See also the "From source" section in the [README](../README.md#from-source).

## Troubleshooting

### Container Build Issues

If the web container fails to build:

```bash
# Build with verbose output
docker-compose build --no-cache web

# Check Next.js standalone output is enabled
grep "standalone" apps/web/next.config.js
```

### Database Connection Issues

```bash
# Check PostgreSQL container is running
docker compose ps postgres

# Test database connection
psql postgresql://postgres:postgres@localhost:5432/proliferate -c "SELECT 1"

# Run migrations if needed
pnpm -C packages/db db:migrate
```

### WebSocket Connection Issues

```bash
# Check gateway is healthy
curl http://localhost:8787/health

# Check logs
docker-compose logs gateway
```

### Sandbox Issues

```bash
# Verify E2B API key
curl -H "Authorization: Bearer $E2B_API_KEY" https://api.e2b.dev/health

# Check web logs for sandbox errors
docker-compose logs web | grep -i sandbox
```

## Environment Variables Reference

See `docs/ENVIRONMENT.md` for the complete list of environment variables and required vs optional rules.

## Updating

To update to a new version:

```bash
git pull origin main
docker-compose build
docker-compose up -d
```

For database migrations:

```bash
pnpm -C packages/db db:migrate
```
