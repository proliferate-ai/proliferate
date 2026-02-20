
# Proliferate

**The open source, self-hostable AI coworker.**

Securely onboard coding agents to your company — with access to your real dev environments, tools, and workflows. Agents do the work in the background and come to you with results: a live preview to test, a summary of what changed, and a PR ready to merge.

## What can you do with it?

Every agent session runs in an isolated cloud sandbox mirroring your actual Docker setup. You can connect any tool — SaaS integrations like Sentry, GitHub, and Slack, your own MCP servers, or fully custom internal tools and APIs. Once connected, every engineer (and agent) in the company gets secure, standardized access to the same toolset.

This means you can do things like:

- Automatically investigate Sentry exceptions → reproduce the issue → write a fix → post a live preview and PR to Slack
- Watch PostHog session replays → identify UX bugs → create Linear tickets → open PRs to fix them
- Kick off 10 features from a single Slack message → agents build them in parallel → come back with summaries and preview links
- Run overnight maintenance — flaky test cleanup, dependency updates, on-call triage — on a cron schedule
- Let non-technical teammates describe what they need and get a working preview without waiting on engineering

![Proliferate in action](product-screenshot.png)

## Features

- **Open source & self-hostable:** MIT licensed. Run it on your own infrastructure.
- **Any tool, any integration:** Connect SaaS tools, MCP servers, or your own custom internal APIs. Everyone in the company gets secure, standardized access.
- **Isolated sandboxes:** Every run gets its own cloud environment mirroring your actual Docker setup.
- **Background execution:** Configure triggers from Sentry, GitHub, Linear, Slack, webhooks, or cron schedules.
- **Live verification:** Every run produces a preview URL — the actual running app with the change applied.
- **Multiplayer:** Teammates can watch, steer, or take over any session in real time.
- **Multi-client:** Work from web, CLI, or Slack against the same session state.
- **Model agnostic:** Use your preferred coding models and providers.
- **Permissioning:** Scoped, auditable access controls for agent actions across your org.

📖 **Full docs:** [docs.proliferate.com](https://docs.proliferate.com)


## Deployment

### Quick Start

<details>
<summary><strong>⚡ Quick start (5 minutes)</strong></summary>

### 1) Clone and initialize

```bash
git clone https://github.com/proliferate-ai/proliferate
cd proliferate
./scripts/setup-env.sh
```

This creates `.env` from `.env.example` and auto-generates local secrets.

### 2) Create a GitHub App

Create one using the same prefilled links:

- Personal account: [Create GitHub App](https://github.com/settings/apps/new?name=proliferate-self-host&description=Proliferate+self-hosted+GitHub+App&url=http%3A%2F%2Flocalhost%3A3000&public=false&setup_url=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fintegrations%2Fgithub%2Fcallback&setup_on_update=true&metadata=read&contents=write&pull_requests=write&issues=read&webhook_active=false)
- Organization: [Create GitHub App for org](https://github.com/organizations/YOUR_ORG/settings/apps/new?name=proliferate-self-host&description=Proliferate+self-hosted+GitHub+App&url=http%3A%2F%2Flocalhost%3A3000&public=false&setup_url=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fintegrations%2Fgithub%2Fcallback&setup_on_update=true&metadata=read&contents=write&pull_requests=write&issues=read&webhook_active=false) (replace `YOUR_ORG` in the URL)

After creating the app, generate a private key in the Github App page and add these to `.env`:

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

### 3) Configure sandbox provider (defaults to Modal)

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

4. Set up your `.env`:

```bash
DEFAULT_SANDBOX_PROVIDER=modal
MODAL_TOKEN_ID=ak-...              # From your Modal token
MODAL_TOKEN_SECRET=as-...          # From your Modal token
MODAL_APP_NAME=proliferate-sandbox
MODAL_APP_SUFFIX=local             # Must match the suffix used during deploy
ANTHROPIC_API_KEY=sk-ant-...       # From console.anthropic.com
```

Modal setup guide: [docs.proliferate.com/self-hosting/modal-setup](https://docs.proliferate.com/self-hosting/modal-setup)
More E2B details: [`packages/e2b-sandbox/README.md`](packages/e2b-sandbox/README.md)

### 4) Launch

```bash
docker compose up -d
```

> The first build compiles all images from source and may take 5–10 minutes.

Open [http://localhost:3000](http://localhost:3000), sign up, and install your GitHub App on target repos.

For webhooks/public domains: [`docs/self-hosting/localhost-vs-public-domain.md`](docs/self-hosting/localhost-vs-public-domain.md)

</details>

### Deployment Options
- **Local (build from source):** `docker compose up -d`
- **Production (pre-built images):** `docker compose -f docker-compose.prod.yml up -d`
- **AWS (EKS via Pulumi + Helm):** [`infra/pulumi-k8s/README.md`](infra/pulumi-k8s/README.md)
- **GCP (GKE via Pulumi + Helm):** [`infra/pulumi-k8s-gcp/README.md`](infra/pulumi-k8s-gcp/README.md)
- **Cloud deploy helper:** `make deploy-cloud SHA=<sha> STACK=prod`

---

**Development**

```bash
pnpm install
pnpm services:up
pnpm -C packages/db db:migrate
pnpm dev
```

Requires Node.js 20+, pnpm, and Docker.

---

**Community**
- 💬 Feedback & bugs: [GitHub Issues](https://github.com/proliferate-ai/proliferate/issues)
- 🤝 Slack community: [Join us on Slack](https://join.slack.com/t/proliferatepublic/shared_invite/zt-3ngfqqttg-qyE2cgQBQQ0klmd9Vbh9Ow)
- 🗺️ Roadmap: Coming soon

**Enterprise**
- Enterprise deployment/support: [proliferate.com/enterprise](https://proliferate.com/enterprise)
- Contact: [pablo@proliferate.com](mailto:pablo@proliferate.com)
- Self-hosting docs: [docs.proliferate.com](https://docs.proliferate.com)

---

Security: See [SECURITY.md](SECURITY.md).
License:  [MIT](LICENSE)
