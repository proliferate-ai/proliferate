# Proliferate

<p align="center">
  <strong>Clawdbot for product builders. An open source cloud harness for coding agents.</strong>
</p>

<p align="center">
  <a href="https://github.com/proliferate-ai/cloud/actions"><img src="https://img.shields.io/github/actions/workflow/status/proliferate-ai/cloud/ci.yml?branch=main&style=for-the-badge" alt="CI status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
</p>

> **Beta** -- Proliferate is under active development. A managed hosted version is coming extremely soon. We'd love your feedback via [issues](https://github.com/proliferate-ai/cloud/issues) or [contributions](CONTRIBUTING.md).

Proliferate is an open source cloud harness for coding agents. It lets you run many agents in parallel, each in an isolated cloud session with a real dev environment and access to your toolchain (Docker, GitHub, Sentry, PostHog, Linear, Slack, Chrome, Gmail, internal docs, infra, etc.).

Example workflows:

- Watch a PostHog session replay -> identify a UX issue -> create a Linear ticket -> open a PR
- Triggered by a Sentry exception -> reproduce it -> draft a PR + tag the teammate who introduced it (and optionally draft a customer update)
- Tag an agent in Slack -> let it iterate -> jump into the same session from web or the terminal when you want

Two things we focus on:

- **Access + integration**: agents need safe, real access to your stack. Most teams wire this up with custom wrappers / MCP servers / glue code, and it tends to be brittle and hard to share.
- **Verification**: even when an agent ships a PR, someone still has to answer "does this actually work?" Proliferate makes each run a shareable session with a live environment so review isn't "pull the branch locally just to verify."

If this is useful, please star the repo. For feedback or questions, reach out at [pablo@proliferate.com](mailto:pablo@proliferate.com) (or open an issue).

[Docs](docs/) &middot; [Self-Hosting](docs/SELF_HOSTING.md) &middot; [Contributing](CONTRIBUTING.md)

<p align="center">
  <img src="product-screenshot.png" alt="Proliferate in action" width="100%">
</p>

## What you can do

- **Snapshot your dev environment** -- Connect your GitHub repos via GitHub App. Agents get a real, isolated sandbox to clone, build, run, and push code -- not just a repo checkout.

- **Wire up triggers and automations** -- Kick off agents from the events that matter: GitHub issues, Sentry exceptions, PostHog session replays, Linear tickets, Slack messages, webhooks, or cron schedules.

- **Review what agents actually did** -- Stream agent output live to the web UI or CLI. Every session is a link you can share with anyone on the team: same session, different surfaces (Slack, GitHub, web).

- **Deploy it your way** -- Self-host on your own infra, or wait for the managed version (coming soon). `docker compose up` to run locally; see the docs for AWS, GCP, and other production setups.

## Quick start

```bash
# Install the CLI (optional)
curl -fsSL https://proliferate.com/install.sh | bash

# Clone and configure
git clone https://github.com/proliferate-ai/cloud
cd cloud
cp .env.example .env
```

Edit `.env` with your keys -- you need an `ANTHROPIC_API_KEY` and a sandbox provider ([Modal](https://modal.com) or [E2B](https://e2b.dev) credentials). Then:

```bash
docker compose up -d
```

Open http://localhost:3000.

For production deployments (AWS, GCP), run the interactive deployment wizard:

```bash
node scripts/install-platform.cjs
```

See the [Self-Hosting Guide](docs/SELF_HOSTING.md) for full details, and [Infrastructure docs](docs/pulumi-overview.md) for the Pulumi architecture.

## From source

```bash
pnpm install
pnpm services:up          # Postgres + Redis via Docker
pnpm -C packages/db db:migrate
pnpm dev                   # Web + Gateway + Worker
```

Requires **Node.js 20+** and **pnpm**. See [Environment Reference](docs/ENVIRONMENT.md) for all config options.

## How it works

```
Sentry / PostHog / GitHub / Linear / Slack / Webhooks / Cron
                         |
                         v
                  +------+------+
                  |   Web App   |    Sessions, automations, integrations
                  +------+------+
                         |
               +---------+---------+
               |                   |
          +----+----+        +----+----+
          | Gateway |        | Worker  |
          |  (ws)   |        | (BullMQ)|
          +----+----+        +---------+
               |
          +----+----+
          | Sandbox |    Isolated cloud session (Modal or E2B)
          +---------+
```

Every run gets an **isolated sandbox** on [Modal](https://modal.com) or [E2B](https://e2b.dev) -- a real environment where agents can clone, build, and run your code. The **gateway** streams output live over WebSocket. The **worker** handles the automation pipeline: enrich context, execute the agent, finalize results. An optional **[LLM proxy](docs/llm-proxy-guide.md)** can issue scoped virtual keys for cost tracking.

## Docs

- [Self-Hosting Guide](docs/SELF_HOSTING.md) -- Docker Compose, custom domains, production deployment
- [Infrastructure (Pulumi)](docs/pulumi-overview.md) -- AWS/GCP infrastructure architecture
- [Architecture](docs/guides/ARCHITECTURE_OVERVIEW.md) -- System design and data flow
- [Environment Reference](docs/ENVIRONMENT.md) -- All environment variables
- [Automation Triggers](docs/AUTOMATION_TRIGGERS.md) -- Trigger types and configuration
- [Automation Runs](docs/AUTOMATION_RUNS.md) -- Run lifecycle and state machine
- [LLM Proxy](docs/llm-proxy-guide.md) -- Virtual keys, cost tracking, provider setup
- [Slack Integration](docs/guides/SLACK_INTEGRATION.md) -- Bot setup

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Security

See [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)