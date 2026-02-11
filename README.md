# Proliferate

**The open-source agentic coding platform.**

Proliferate is a multiplayer cloud harness for coding agents. Give agents the same access an engineer on your team would have (code, environments, observability, tickets, chat, and internal tools), and let them run autonomously in isolated sandboxes.

### What can you do with it?

- 📊 Analyze PostHog sessions and ship fixes with linked Linear tickets.
- 🚨 Triage production alerts from Sentry and draft PRs in a real runtime.
- 🧪 Run multiple feature requests in parallel to compare outcomes before shipping.
- 🛠️ Let product builders execute safely with the same environments engineers use.

![Proliferate in action](product-screenshot.png)

---

## Features

| Feature | Description |
| --- | --- |
| **Multiplayer Sessions** | Multiple people can watch, steer, or take over any agent session in real time |
| **Isolated Sandboxes** | Every run gets a dedicated cloud sandbox (Modal or E2B), not just a repo checkout |
| **Multi-Agent Workflows** | Run many coding sessions in parallel across different tasks |
| **Model Flexible** | Use your preferred coding models and providers |
| **Automations + Triggers** | Launch runs from GitHub, Sentry, PostHog, Linear, Slack, webhooks, or schedules |
| **Live Streaming** | Follow execution in web or CLI with a shareable session link |
| **Action Framework** | Plug into tools and MCP-style integrations across your stack |
| **Self-Hosted** | Deploy with Docker Compose or Kubernetes on your own infrastructure |
| **Open Source** | MIT licensed and fully self-hostable |

> 📖 Full docs: [docs.proliferate.com](https://docs.proliferate.com)

---

## Quick Start (about 5 minutes)

<details>
<summary><strong>⚡ Quick Setup</strong></summary>

### Prerequisites

1. Docker + Docker Compose
2. Anthropic API key ([console.anthropic.com](https://console.anthropic.com))
3. Sandbox provider account: [Modal](https://modal.com) (default) or [E2B](https://e2b.dev)
4. GitHub App (required for repository access)

### 1) Clone and initialize

```bash
git clone https://github.com/proliferate-ai/proliferate
cd proliferate
./scripts/setup-env.sh
```

This creates `.env` from `.env.example` and auto-generates local secrets.

### 2) Create a GitHub App

Each self-hosted instance needs its own GitHub App to access repos, create branches, and open PRs.

Create one using the same prefilled links:

- Personal account: [Create GitHub App](https://github.com/settings/apps/new?name=proliferate-self-host&description=Proliferate+self-hosted+GitHub+App&url=http%3A%2F%2Flocalhost%3A3000&public=false&setup_url=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fintegrations%2Fgithub%2Fcallback&setup_on_update=true&metadata=read&contents=write&pull_requests=write&issues=read&webhook_active=false)
- Organization: [Create GitHub App for org](https://github.com/organizations/YOUR_ORG/settings/apps/new?name=proliferate-self-host&description=Proliferate+self-hosted+GitHub+App&url=http%3A%2F%2Flocalhost%3A3000&public=false&setup_url=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fintegrations%2Fgithub%2Fcallback&setup_on_update=true&metadata=read&contents=write&pull_requests=write&issues=read&webhook_active=false) (replace `YOUR_ORG` in the URL)

After creating the app, generate a private key and add these to `.env`:

```bash
# IMPORTANT: The slug must match your GitHub App's URL name exactly.
# If you used the prefilled link above, the slug is "proliferate-self-host".
# Find it at: https://github.com/settings/apps -> your app -> the URL shows /apps/<slug>
NEXT_PUBLIC_GITHUB_APP_SLUG=proliferate-self-host
GITHUB_APP_ID=123456                                 # From the app's General page
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA..."           # PEM contents (\\n sequences supported)
GITHUB_APP_WEBHOOK_SECRET=any-random-string
```

If you change `NEXT_PUBLIC_*` after building the web image:

```bash
docker compose up -d --build web
```

### 3) Configure sandbox provider

Option A (default): **Modal**

1. Create a [Modal](https://modal.com) account and generate an API token from [modal.com/settings](https://modal.com/settings)
2. Install the Modal CLI and authenticate:

```bash
pip install modal
modal setup
```

3. Deploy the sandbox image (the suffix must match `MODAL_APP_SUFFIX` in your `.env`; default is `local`):

```bash
cd packages/modal-sandbox
MODAL_APP_SUFFIX=local modal deploy deploy.py
cd ../..
```

4. Set in `.env`:

```bash
DEFAULT_SANDBOX_PROVIDER=modal
MODAL_TOKEN_ID=ak-...              # From your Modal token
MODAL_TOKEN_SECRET=as-...          # From your Modal token
MODAL_APP_NAME=proliferate-sandbox
MODAL_APP_SUFFIX=local             # Must match the suffix used during deploy
ANTHROPIC_API_KEY=sk-ant-...       # From console.anthropic.com
```

Modal setup guide: [docs.proliferate.com/self-hosting/modal-setup](https://docs.proliferate.com/self-hosting/modal-setup)

Option B: **E2B**

```bash
DEFAULT_SANDBOX_PROVIDER=e2b
E2B_API_KEY=e2b_...
E2B_DOMAIN=api.e2b.dev
E2B_TEMPLATE=proliferate-base
E2B_TEMPLATE_ALIAS=proliferate-base
ANTHROPIC_API_KEY=sk-ant-...
```

Build and push the E2B template:

```bash
cd packages/e2b-sandbox
pnpm build:template
cd ../..
```

More E2B details: [`packages/e2b-sandbox/README.md`](packages/e2b-sandbox/README.md)

### 4) Launch

```bash
docker compose up -d
```

Open [http://localhost:3000](http://localhost:3000), sign up, and install your GitHub App on target repos.

For webhooks/public domains: [`docs/self-hosting/localhost-vs-public-domain.md`](docs/self-hosting/localhost-vs-public-domain.md)

</details>

---

## Deployment

| Method | Command / Guide |
| --- | --- |
| **Local (build from source)** | `docker compose up -d` |
| **Production (pre-built images)** | `docker compose -f docker-compose.prod.yml up -d` |
| **AWS (EKS, Pulumi + Helm)** | [`infra/pulumi-k8s/README.md`](infra/pulumi-k8s/README.md) |
| **GCP (GKE, Pulumi + Helm)** | [`infra/pulumi-k8s-gcp/README.md`](infra/pulumi-k8s-gcp/README.md) |
| **Cloud deploy helper** | `make deploy-cloud SHA=<sha> STACK=prod` |

---

## Development

```bash
pnpm install
pnpm services:up
pnpm -C packages/db db:migrate
pnpm dev
```

Requires Node.js 20+, pnpm, and Docker.

---

## Architecture

```text
Client (Web / CLI / Slack)
        │
        ▼
Gateway (WebSocket streaming path)
        │
        ▼
Sandbox (Modal or E2B, isolated per run)

API routes handle session lifecycle + metadata.
Worker handles triggers, automations, and background jobs.
```

More details:

- [Gateway spec](apps/gateway/SPEC.md)
- [LLM proxy](apps/llm-proxy/README.md)
- [Environment variables](https://docs.proliferate.com/self-hosting/environment)

---

## Contributing

1. Read [CONTRIBUTING.md](CONTRIBUTING.md).
2. Run checks before opening a PR:
	```bash
	pnpm typecheck
	pnpm lint
	pnpm test
	pnpm build
	```
3. Open a PR using `.github/PULL_REQUEST_TEMPLATE.md`.

---

## Cloud & Enterprise

- Managed cloud: coming soon at [proliferate.com](https://proliferate.com)
- Self-hosting docs: [docs.proliferate.com](https://docs.proliferate.com)

---

## Community

- 💬 Feedback and bugs: [GitHub Issues](https://github.com/proliferate-ai/proliferate/issues)
- 📫 Contact: [pablo@proliferate.com](mailto:pablo@proliferate.com)

## Security

See [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
