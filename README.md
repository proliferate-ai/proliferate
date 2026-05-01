# Proliferate

**Run coding agents locally or in the cloud.**

Proliferate is a macOS app for running Codex, Claude Code, Gemini CLI, and other
coding agents in isolated workspaces.

## Install

Download Proliferate from [proliferate.com](https://proliferate.com) or from the
[latest GitHub release](https://github.com/proliferate-ai/proliferate/releases/latest).

## Run Locally

Requirements:

- Rust stable
- Node.js 22+
- pnpm

```bash
make install
make dev-local
```

## Use Cases

- Run multiple isolated agent sessions on one repo
- Compare patches across Codex, Claude Code, Gemini CLI, and custom agents
- Triage CI, tests, PR feedback, approvals, tool calls, and diffs
- Move long-running jobs to cloud workspaces
- Build workflows on top of the AnyHarness HTTP and SSE APIs

## Run the Full Stack
Cloud workspaces use the Python control plane.

Local requirements: Python 3.12+, `uv`, and Docker for full stack.

```bash
make server-install
make dev-init PROFILE=main  # Prepare profile state without launching
make dev-list               # show known profiles and live port status
make dev PROFILE=main       # runtime + server + desktop + local Postgres
make dev PROFILE=main STRIPE=1  # also start Stripe webhook forwarding
```

Use `make dev PROFILE=<name>` for multi-worktree development. See
[`docs/reference/dev-profiles.md`](docs/reference/dev-profiles.md) for ports,
profile state, overrides, and app labels.

For local cloud sandbox development, set `server/.env.local`:

```env
E2B_API_KEY=...
E2B_TEMPLATE_NAME=...
```

## Development

```bash
make dev-local        # Desktop app with bundled local runtime
make dev PROFILE=main # Runtime + server + desktop + local Postgres
make dev-list         # List prepared and running dev profiles
make sdk-build        # Generate and build the TypeScript SDK
make desktop-build    # Type-check and build the desktop frontend
make test             # Rust workspace tests
make test-server      # Server tests
make all              # Rust checks, boundary checks, and SDK build
```

## Architecture

```text
desktop/              Tauri app and React UI
anyharness/crates/    Rust runtime, sessions, workspaces, tools, git, SSE
anyharness/sdk/       TypeScript client
anyharness/sdk-react/ React hooks
server/               FastAPI cloud control plane
```

## Contributing

Issues and pull requests are welcome.

## License

[AGPL-3.0](./LICENSE)
