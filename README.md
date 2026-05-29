<div align="center">

<table>
  <tr>
    <td align="center">
      <br /><br /><br />
      <strong>Hero screenshot placeholder</strong><br />
      Add a Proliferate product screenshot here showing the desktop workspace,
      agent tabs, transcript, files or diffs, and local/cloud controls.
      <br /><br /><br />
    </td>
  </tr>
</table>

<h1>Proliferate</h1>

<p><strong>The Local and Cloud Agent IDE (YC S25 🔸)</strong></p>

<p>
  <a href="https://github.com/proliferate-ai/proliferate/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/proliferate-ai/proliferate?style=social" /></a>
  <a href="https://github.com/proliferate-ai/proliferate/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/proliferate-ai/proliferate?sort=semver" /></a>
  <a href="./LICENSE"><img alt="License: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-blue" /></a>
  <a href="./docs/README.md"><img alt="Docs" src="https://img.shields.io/badge/docs-view-black" /></a>
</p>

<p>Work better and deeper with a single workspace for all your agent work.</p>

<p>
  <a href="https://proliferate.com"><strong>Download for macOS</strong></a>
  ·
  <a href="./docs/README.md">Documentation</a>
  ·
  <a href="https://github.com/proliferate-ai/proliferate/releases">Changelog</a>
  ·
  <a href="#community">Community</a>
</p>

</div>

## The Agent IDE

Proliferate is one workspace for serious agent work: local when you want your
machine and credentials close, cloud when you want long-running work, shared
sandboxes, automations, or team workflows.

- Run Codex, Claude Code, Gemini CLI, OpenCode, and other agents with their
  native features.
- Isolate every task in a git worktree, local runtime, SSH target, or managed
  cloud sandbox.
- Share work through team-wide automations, shared cloud sessions, and the
  Slack bot.
- Switch agents at any time without locking your workflow into one provider.
- Move work between local and cloud targets when the job needs a different
  runtime.

## Features

| Feature | What it unlocks |
| --- | --- |
| [Automations](./docs/current/specs/06-automations.md) | Run any agent on a schedule or trigger, locally or in cloud workspaces. |
| [Harnesses](./docs/anyharness/guides/harnesses.md) | Use provider-native behavior for Claude Code, Codex, Gemini, OpenCode, and more. |
| [Subagents](./docs/anyharness/product-mcps/subagents.md) | Delegate focused work to child sessions while preserving parent context and review flow. |
| [Plugins, MCPs, and skills](./docs/current/specs/01-mcp-skills-plugins.md) | Package tools, prompts, and capabilities once and project them into local or cloud runtimes. |
| [Code and plan review](./docs/anyharness/product-mcps/reviews.md) | Launch review agents for implementation diffs or proposed plans. |
| [Workspace mobility](./docs/current/specs/10-migration.md) | Move runnable workspaces and sessions between local, cloud, and target runtimes. |
| [Multiplayer cloud chats](./docs/current/specs/08-web-mobile-dispatch.md) | Project cloud sessions into desktop, web, mobile, and shared team surfaces. |
| [Team Slack bot](./docs/current/specs/07-slack-bot.md) | Turn Slack requests into shared cloud work that teammates can claim and continue. |
| [AnyHarness API](./docs/anyharness/guides/api.md) | Build on the HTTP and SSE runtime APIs for workspaces, sessions, transcripts, and tools. |

## Getting Started

### Quick Start

Download Proliferate from [proliferate.com](https://proliferate.com) or the
[latest GitHub release](https://github.com/proliferate-ai/proliferate/releases/latest).

<details>
<summary>Run from source, develop locally, or self-host</summary>

### Run Locally From Source

Requirements:

- Rust stable
- Node.js 22+
- pnpm

Run the desktop app with the bundled local AnyHarness runtime:

```bash
make install
make dev-local
```

### Local Full-Stack Development

Requirements:

- Rust stable
- Node.js 22+
- pnpm
- Python 3.12+
- `uv`
- Docker, for the local control plane database

Use named dev profiles for full-stack development, especially when multiple
worktrees run at the same time.

```bash
make server-install
make dev-init PROFILE=main
make dev-list
make dev PROFILE=main
```

See [dev profiles](./docs/reference/dev-profiles.md) for profile state, ports,
generated Tauri config, and app labels.

### Full Self-Hosting For Proliferate Cloud

Full self-hosted Proliferate Cloud deployments are available for teams. Reach
out through [proliferate.com](https://proliferate.com) for access and deployment
support.

</details>

## Development Commands

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
apps/desktop/        Tauri app and React desktop UI
apps/web/            Cloud web client
apps/mobile/         Mobile client
anyharness/crates/   Rust runtime, sessions, workspaces, tools, git, SSE
anyharness/sdk/      TypeScript client
anyharness/sdk-react/ React hooks
server/              FastAPI cloud control plane
```

## Community

Join the open source community on
[GitHub Discussions](https://github.com/proliferate-ai/proliferate/discussions).
File bugs and feature requests in
[GitHub Issues](https://github.com/proliferate-ai/proliferate/issues), or reach
us at [pablo@proliferate.com](mailto:pablo@proliferate.com).

## Contributing

Looking to contribute? Please check out the
[Contribution Guide](./docs/README.md) first, then read the relevant area doc
before changing code in that area.

PR titles and labels must follow [CI/CD docs](./docs/ci-cd/README.md): use
exactly one `release:*` label and at least one `area:*` label before marking a
PR ready for review.

## License

[AGPL-3.0](./LICENSE)
