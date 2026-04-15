# Proliferate

**Run coding agents locally or in the cloud.**

Proliferate is a Mac app for working with coding agents at scale: many agents,
many workspaces, local and cloud execution, automations, teams, and artifacts.

![Proliferate overview](./assets/readme/overview.png)

## What It Does

### One Place For Your Agents

Run Codex, Claude Code, Gemini CLI, and custom agents from one app, using the
auth and subscriptions you already have.

![Agent selector](./assets/readme/agents.gif)

### Local And Cloud Workspaces

Give each agent its own isolated workspace. Work locally when you want control,
or move sessions to the cloud when you want them to keep running.

![Local to cloud handoff](./assets/readme/local-to-cloud.gif)

### Multi-Agent Workflows

Agents can create other agents, wait for them, read their chats, send messages,
and bring results back into the main workflow.

![Subagents](./assets/readme/subagents.gif)

### Automations

Schedule recurring agent runs for bug triage, docs drift, PR review, repo
hygiene, morning briefs, customer feedback, and other work you keep asking
agents to do manually.

![Automations](./assets/readme/automations.gif)

### Teams

Share cloud workspaces, collaborate in the same agent session, run team-wide
automations, and claim results together.

![Teams](./assets/readme/teams.gif)

### Cowork And Artifacts

Use agents for work that does not start in a repo. Chat with an LLM, use your
tools, create live artifacts, and spin up coding agents when the work becomes
concrete.

![Cowork artifacts](./assets/readme/cowork-artifacts.gif)

## Architecture

Proliferate is built around AnyHarness, a Rust runtime that runs and controls
coding agents through a shared interface.

```text
desktop/              Tauri app and React UI
anyharness/crates/    Rust runtime, sessions, workspaces, tools, git, SSE
anyharness/sdk/       TypeScript client
anyharness/sdk-react/ React hooks
server/               FastAPI cloud control plane
```

AnyHarness parses agent activity into structured events: messages, tool calls,
approvals, plans, mode changes, task state, workspace state, and results.

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

Cloud workspaces and hosted team features use the Python control plane.

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

Self-hosting and deployment guides live in
[`docs/reference`](./docs/reference).

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

Read the relevant docs before making changes:

- [`docs/frontend/README.md`](./docs/frontend/README.md)
- [`docs/anyharness/README.md`](./docs/anyharness/README.md)
- [`docs/sdk/README.md`](./docs/sdk/README.md)
- [`docs/server/README.md`](./docs/server/README.md)
- [`docs/ci-cd/README.md`](./docs/ci-cd/README.md)

## Release

Desktop releases are tag-based.

```bash
git tag desktop-v<VERSION>
git push origin desktop-v<VERSION>
```

Do not run the desktop release workflow from `main`. See
[`AGENTS.md`](./AGENTS.md) and [`docs/ci-cd/README.md`](./docs/ci-cd/README.md)
for the full release procedure.

## Contributing

Issues, feedback, and pull requests are welcome.

## License

[AGPL-3.0](./LICENSE)
