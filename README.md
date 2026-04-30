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
make dev PROFILE=main
```

`make dev PROFILE=<name>` starts local Postgres, creates and migrates a
profile-specific database, starts AnyHarness, starts the server, and opens the
desktop app. Each profile gets stable local ports and state under
`~/.proliferate-local/dev/profiles/<name>`, so multiple worktrees can run the
full stack at the same time. Profile names use lowercase letters, numbers,
hyphens, and underscores.

```bash
make dev-init PROFILE=main  # prepare profile state without launching
make dev-list               # show known profiles and live port status
make dev PROFILE=main       # runtime + server + desktop + local Postgres
make dev PROFILE=main STRIPE=1  # also start Stripe webhook forwarding
```

The individual `make dev-runtime`, `make dev-server`, and `make dev-desktop`
shortcuts remain default-port workflows. Use `make dev PROFILE=<name>` for
multi-worktree development.

See [`docs/reference/dev-profiles.md`](docs/reference/dev-profiles.md) for the
profile state model, override rules, and app-label behavior.

For cloud sandbox development, configure `server/.env.local` with:

```env
E2B_API_KEY=...
E2B_TEMPLATE_NAME=...
```

## Development

```bash
make dev-local          # Desktop app with bundled local runtime
make dev PROFILE=main   # Runtime + server + desktop + local Postgres
make dev-list           # List prepared/running dev profiles
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
