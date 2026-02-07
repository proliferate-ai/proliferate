# E2B Sandbox Template

Cloud sandboxes for Proliferate with full Docker support.

## Quick Start (E2B Cloud)

The fastest way to get started is using E2B's managed cloud service:

1. Get an API key from [e2b.dev](https://e2b.dev)
2. Set environment variable:
   ```bash
   export E2B_API_KEY=your_api_key
   ```
3. Build the template:
   ```bash
   cd packages/e2b-sandbox
   pnpm build:template
   ```

## Self-Hosted Deployment

For customers who need to run their own E2B infrastructure (data residency, air-gapped environments, etc.), see:

- https://docs.proliferate.com/self-hosting/environment (E2B env vars)
- https://docs.proliferate.com/self-hosting/deployment-options

### Quick Self-Hosted Setup

1. Deploy E2B infrastructure using [e2b-dev/infra](https://github.com/e2b-dev/infra)
2. Configure DNS with wildcard pointing to your E2B load balancer
3. Build template for your self-hosted registry:
   ```bash
   E2B_API_KEY=xxx E2B_DOMAIN=e2b.company.com pnpm build:template
   ```

## Environment Variables

### Build Time

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `E2B_API_KEY` | Yes | - | API key for E2B authentication |
| `E2B_DOMAIN` | No | E2B Cloud | Custom domain for self-hosted E2B |
| `E2B_TEMPLATE_ALIAS` | Yes | - | Custom template name |

### Runtime

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `E2B_API_KEY` | Yes | - | API key for E2B authentication |
| `E2B_DOMAIN` | No | E2B Cloud | Custom domain for self-hosted E2B |
| `E2B_TEMPLATE` | Yes (if using E2B) | - | Template name to use |
| `DEFAULT_SANDBOX_PROVIDER` | No | `modal` | Set to `e2b` to use E2B |

## Template Contents

The sandbox image includes a complete development environment:

### Languages & Package Managers
- **Node.js 20** with `pnpm` (preferred) and `yarn`
- **Python 3.11** with `uv` (preferred) and `pip`

### Databases & Services
- **PostgreSQL 15**: `localhost:5432` (user: `postgres`, no password)
- **Redis**: `localhost:6379`
- **Mailcatcher**: SMTP on `localhost:1025`, Web UI on `localhost:1080`

### Development Tools
- Git, curl, wget, build-essential
- Playwright with Chromium browser
- Caddy (reverse proxy for dev server preview on port 20000)
- OpenCode CLI (AI coding agent)

### Container Support
- **Docker & Docker Compose** (full native support, unlike Modal)

### Resource Allocation
- CPU: 4 cores
- Memory: 8 GB

## Differences from Modal

| Feature | Modal | E2B |
|---------|-------|-----|
| Docker support | No (gVisor limitation) | Yes (native) |
| Snapshot mechanism | Filesystem snapshot | Pause/Resume (sandbox state) |
| Self-hosting | No | Yes |
| API deployment | Modal-hosted FastAPI | Direct TypeScript SDK calls |
| Template building | Python image definition | Dockerfile + CLI/SDK |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     E2B Infrastructure                       │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   E2B API   │  │  Template   │  │   Sandbox VMs       │ │
│  │   Server    │  │  Registry   │  │   (Firecracker)     │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
│                                                             │
└─────────────────────────────────────────────────────────────┘
            ▲
            │ E2B SDK (TypeScript)
            │
┌───────────┴─────────────────────────────────────────────────┐
│                    Proliferate                               │
│                                                             │
│  packages/shared/src/providers/e2b.ts                       │
│  - createSandbox(): Create/resume sandbox                   │
│  - snapshot(): Pause sandbox                                │
│  - terminate(): Kill sandbox                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Building the Template

### Using npm/pnpm

```bash
cd packages/e2b-sandbox
pnpm build:template
```

### Using E2B CLI

```bash
# Install CLI
pip install e2b-cli

# Login
e2b auth login

# Build
cd packages/e2b-sandbox
e2b template build
```

### For Self-Hosted

```bash
E2B_API_KEY=xxx E2B_DOMAIN=e2b.company.com e2b template build
```

## Testing

Run the integration test to verify E2B is working:

```bash
# E2B Cloud
E2B_API_KEY=xxx pnpm tsx scripts/test-e2b.ts

# Self-hosted
E2B_API_KEY=xxx E2B_DOMAIN=e2b.company.com pnpm tsx scripts/test-e2b.ts
```

## Troubleshooting

### Template Build Fails

1. Verify Dockerfile builds locally:
   ```bash
   docker build -f e2b.Dockerfile .
   ```
2. Check E2B build logs in the output
3. Ensure API key has build permissions

### Sandbox Creation Fails

1. Check API connectivity:
   ```bash
   # E2B Cloud
   curl https://api.e2b.dev/health

   # Self-hosted
   curl https://api.e2b.company.com/health
   ```
2. Verify template exists:
   ```bash
   e2b template list
   ```
3. Check sandbox logs via E2B dashboard

### Docker Not Working in Sandbox

E2B supports Docker natively, but there are some limitations:
- Privileged mode may be restricted
- Some volume mount patterns may not work
- Check Docker daemon status: `docker info`

### Services Not Starting

Services (PostgreSQL, Redis, Mailcatcher) start automatically via `/usr/local/bin/start-services.sh`. To debug:
```bash
# Check PostgreSQL
pg_isready

# Check Redis
redis-cli ping

# Check Mailcatcher
curl localhost:1080
```

## Files

| File | Purpose |
|------|---------|
| `e2b.Dockerfile` | Template image definition |
| `e2b.toml` | Template configuration (resources, start command) |
| `build.ts` | TypeScript build script using E2B SDK |
| `template.ts` | Template definition export |
| `package.json` | Build dependencies |
