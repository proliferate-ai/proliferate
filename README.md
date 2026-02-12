# Proliferate

## **The open-source company coding agent**

Proliferate is a multiplayer cloud harness for coding agents. Give agents the same tools an engineer on your team would have (code, environments, observability, tickets, chat, and internal tools), and let them run autonomously in isolated sandboxes.

#### What can you do with it?

Every coding agent session has access to a fully configurable deveoper environment, so it can run the same docker containers you would for local development, as well as secured access to your company's tools. You can spin up agents from Slack, create trigger-based automations, and share them with team members! 

This means you can do things like:
 
- Analyze PostHog sessions and ship fixes with linked Linear tickets.
- Triage production alerts from Sentry and draft PRs in a real runtime.
- Run multiple feature requests in parallel to compare outcomes before shipping.
- Let product builders execute safely with the same environments engineers use.

![Proliferate in action](product-screenshot.png)

---

## Features

- **Multiplayer:** Multiple teammates can watch, steer, or take over the same session in real time.
  **Automations:** Configure schedules and triggers from GitHub, Sentry, PostHog, Linear, Slack, or webhooks.
- **Preview environments:** Every run gets an isolated cloud sandbox (Modal or E2B), not just a repo checkout.
- **Multi-agent harness:** Run many coding sessions in parallel across separate tasks and repos.
- **Model agnostic:** Use your preferred coding models and providers.
- **Fully open source:** MIT licensed and self-hostable on your own infrastructure.
- **Action framework:** Connect internal APIs, SaaS tools, and MCP-style integrations.
- **Multi-client:** Work from web, CLI, or Slack against the same session state.
- **Permissioning:** Scoped, auditable access controls for agent actions across your org.

> 📖 Full docs: [docs.proliferate.com](https://docs.proliferate.com)

---

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
