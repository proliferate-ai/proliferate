# Proliferate

**Run coding agents locally or in the cloud.**

Proliferate is a Mac app for running Codex, Claude Code, Gemini CLI, and other
coding agents in isolated workspaces with one clean interface.

![Proliferate screenshot](./assets/readme/overview.png)

## Core Features

- **Bring your own agent** - use your existing coding-agent auth and
  subscriptions.
- **Isolated workspaces** - give each session its own local worktree or cloud
  sandbox.
- **Local to cloud handoff** - start work locally, then move it to the cloud
  when you want it to keep running.
- **Transcript and approval UI** - review plans, approvals, tool calls, and
  results without digging through terminals.
- **Fleet view** - keep many agent sessions moving across the same repo.

## Use Cases

- Run multiple coding agents against one repo without branch/worktree chaos.
- Start a task locally, approve the plan, then send it to the cloud.
- Compare Codex, Claude Code, Gemini CLI, or custom agents on the same work.
- Keep long-running agent work alive after you close your laptop.
- Review what each agent did before merging.

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

## Run The Full Stack

Cloud workspaces use the Python control plane.

Additional requirements:

- Python 3.12+
- uv
- Docker

```bash
make server-install
make dev
```

`make dev` starts local Postgres, applies migrations, starts AnyHarness on
`:8457`, starts the server on `:8000`, and opens the desktop app.

For cloud sandbox development, configure `server/.env.local` with:

```env
E2B_API_KEY=...
E2B_TEMPLATE_NAME=...
```

## Development

```bash
make dev-local          # Desktop app with bundled local runtime
make dev                # Runtime + server + desktop + local Postgres
make dev-runtime        # AnyHarness runtime on :8457
make dev-server         # FastAPI server on :8000
make sdk-build          # Generate and build the TypeScript SDK
make desktop-build      # Type-check and build the desktop frontend
make test               # Rust workspace tests
make test-server        # Server tests
make all                # Rust checks + repo boundary checks + SDK build
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

Issues, feedback, and pull requests are welcome.

## License

[AGPL-3.0](./LICENSE)
