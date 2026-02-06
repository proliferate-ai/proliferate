# Proliferate

<p align="center">
  <strong>Clawdbot for product builders. An open source cloud harness for coding agents.</strong>
</p>

<p align="center">
  <a href="https://github.com/proliferate-ai/cloud/actions"><img src="https://img.shields.io/github/actions/workflow/status/proliferate-ai/cloud/ci.yml?branch=main&style=for-the-badge" alt="CI status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
</p>

> **Beta** -- Proliferate is under active development. A managed hosted version is coming soon. We'd love your feedback via [issues](https://github.com/proliferate-ai/cloud/issues) or [contributions](CONTRIBUTING.md).

We're building a cloud harness that lets you run many coding agents in parallel and give them access to the same tools an engineer on your team would (Docker, GitHub, Sentry, PostHog, Linear, Slack, Chrome, Gmail, internal docs, infra, etc.).

Some workflows we're enabling:

- Watch a PostHog session replay -> identify a UX issue -> create a Linear ticket -> open a PR
- Triggered by a Sentry exception -> reproduce it -> draft a PR + tag the teammate who introduced it (and optionally draft a customer update)
- Tag an agent in Slack -> let it iterate -> jump into the same session from web or the terminal when you want

## Some context: what's happening right now?

The agents space is going a bit bonkers (I believe that's the technical term for it). Agents show up everywhere overnight -- your terminal, your messages, your browser -- and they're finally capable of doing real tasks end-to-end.

But the way people use agents personally and the way agents show up inside companies are still worlds apart. Inside a team, two things keep coming up:

1) **Access + integration**: agents need safe, real access to your stack (Sentry, PostHog, Slack, GitHub, docs, infra). Most teams are wiring this up with custom wrappers / MCP servers / glue code. Every company rebuilds it, and it ends up fragile, insecure, and hard to share.

2) **Verification**: even when an agent ships a PR, someone still has to answer "does this actually work?" Today that usually means reading a lot of agent-generated code, or pulling branches locally just to verify. That doesn't scale.

## What we think agent-driven product work should look like

- **Build from anywhere**: if an agent can do the work, you should be able to kick it off and interact from wherever you already are (Slack, web, terminal).
- **Handle small reactive issues without you in the loop**: exceptions, rageclicks, support issues, small UI bugs. The default should be an agent run that attempts a fix and shows you the result.
- **Verify at a higher level than code**: if the agent opened a PR, it should also give you evidence: a preview you can click through, screenshots/videos when it's visual, and test results when it's backend.

## What we built

**Proliferate** runs coding agents in isolated cloud sandboxes. Every run gets its own shareable session with a real environment: clone/build/run code, access your toolchain, open a PR, and a live preview you can share to verify changes without pulling anything locally.

## Why open source

We're open sourcing this and making it self-hostable because we think teams need to own their code, data, and infrastructure here. Also: everyone rebuilding this harness layer privately feels like the wrong equilibrium.

## The ask

- If this is useful, star the repo.
- If you're already running agents and still pulling branches locally just to verify, we'd love to talk.
- We'd also love feedback: what would you automate first, and which triggers/clients matter most for you?
- Reach out at [pablo@proliferate.com](mailto:pablo@proliferate.com).

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
- [Ops Runbook](docs/OPS-RUNBOOK.md) -- Operations and troubleshooting

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Security

See [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
