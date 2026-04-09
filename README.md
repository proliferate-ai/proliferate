# Proliferate

**One app to run every coding agent.** Switch between Claude Code, Codex, Gemini, and more — using your existing subscriptions, in isolated workspaces, locally or in the cloud.

![Screenshot of Proliferate](./screenshot.png)

Proliferate is a 35 MB desktop app built in Tauri that gives you a unified workspace for any coding agent. No lock-in, no bloat, no extra subscriptions.

## Why

Coding agents are changing fast. The best model today might not be the best model tomorrow. Proliferate lets you:

- **Run any agent** — Claude Code, Codex, Gemini, Amp, Cursor, and more coming
- **Switch instantly** — change agents mid-project without losing context
- **Use your own keys** — bring your existing subscriptions, no middleman
- **Isolate work** — every task gets its own git worktree, no conflicts
- **Go cloud** — spin up E2B sandboxes for long-running tasks and close your laptop

## Install

Download from [proliferate.com](https://proliferate.com) or grab the latest release:

| Platform              | Download                                                               |
|-----------------------|------------------------------------------------------------------------|
| macOS (Apple Silicon) | [DMG](https://github.com/proliferate-ai/proliferate/releases/latest)  |
| macOS (Intel)         | [DMG](https://github.com/proliferate-ai/proliferate/releases/latest)  |
| Windows (x64)         | [Installer](https://github.com/proliferate-ai/proliferate/releases/latest) |

## Run it yourself

Proliferate can be entirely self-hosted with just your own API keys. No account required for local use.

**You'll need:** [Rust](https://rustup.rs), [Node.js 22+](https://nodejs.org), [pnpm](https://pnpm.io/installation)

```bash
pnpm install
make sdk-build
make dev
```

That's it. The desktop app and runtime start together.

### Cloud workspaces (optional)

For cloud sandboxes that keep running even when you close the app, spin up the backend control plane:

**Additional requirements:** [Python 3.12+](https://www.python.org), [uv](https://docs.astral.sh/uv/), [Docker](https://www.docker.com/)

```bash
make server-install
make dev-server
```

`make dev-server` and `make server-migrate` automatically start the local PostgreSQL container, wait for it to become healthy, and then apply Alembic migrations.

For the fast default cloud runtime, set:

```env
E2B_API_KEY=...
E2B_TEMPLATE_NAME=TEAM_SLUG/proliferate-runtime-cloud:production
```

Replace `TEAM_SLUG` with the published E2B team slug. `base` remains a low-level fallback for debugging, not the recommended cloud template.

Cloud sandboxes persist across disconnects — reconnect and pick up where you left off. For production hosting of the control plane, see the [server deployment docs](https://docs.proliferate.com).

## How it works

Proliferate is three pieces:

**Desktop app** (`desktop/`) — Tauri 2 (React + Rust). Handles workspace UI, agent configuration, session management. The Rust layer manages the runtime sidecar, keychain, and native integrations.

**AnyHarness runtime** (`anyharness/crates/`) — A Rust HTTP server that runs as a local sidecar. Manages agent processes, terminals, file ops, and git. Each agent runs as an isolated subprocess. Exposes an SSE streaming API consumed by the desktop app and the TypeScript SDK (`anyharness/sdk/`).

**Control plane** (`server/`) — FastAPI backend for cloud features: auth, credential sync, E2B sandbox provisioning, and billing. Only needed for cloud workspaces — local use runs entirely without it.

## Development

```bash
make dev              # Start runtime, backend, desktop, and local Postgres
make dev-runtime      # AnyHarness runtime on :8457
make server-db-up     # Start local Postgres
make server-db-down   # Stop local Postgres
make server-migrate   # Apply backend DB migrations
make dev-server       # Backend on :8000
make dev-desktop      # Desktop app
```

## Release

Tag-based releases via GitHub Actions:

- `desktop-v*` — builds the desktop app for macOS and Windows
- `runtime-v*` — builds the AnyHarness runtime for all platforms and publishes the SDK to npm
- `main` — builds and publishes the public E2B cloud template with immutable `sha-*` tags and rolling `staging`
- `Promote Cloud Template` — manually moves a tested immutable template tag to `production`

## Community

Join the [Discord](https://discord.gg/eEUTBMXF) to chat with us, ask questions, share feedback, or see what's coming next.

## Contributing

We'd love contributions. See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

[AGPL-3.0](./LICENSE)
