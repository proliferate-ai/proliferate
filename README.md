# Proliferate

**Run coding agents locally or in the cloud.**

Proliferate is a Mac app for running Codex, Claude Code, Gemini CLI, and other
coding agents in isolated workspaces with one clean interface.



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

- Parallelize feature work, test fixes, and code review follow-ups across
  multiple isolated agent sessions.
- Compare Codex, Claude Code, Gemini CLI, and custom agents on the same repo
  before choosing the best patch.
- Triage failing CI, flaky tests, and pull request feedback while keeping your
  local workspace focused on the next task.
- Move long-running jobs to a cloud workspace so they can continue after you
  close your laptop.
- Review transcripts, approvals, tool calls, and diffs before deciding what to
  merge.
- Build custom agent workflows on top of AnyHarness through the HTTP and SSE
  runtime APIs.

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

## Diff Test

This short note is intentionally small so local diff rendering can be checked
without changing product behavior.

## License

[AGPL-3.0](./LICENSE)
