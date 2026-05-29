<div align="center">

<table>
  <tr>
    <td align="center">
      <br /><br /><br />
      <strong>Hero screenshot placeholder</strong><br />
      Add a Proliferate product screenshot here showing local and cloud
      workspaces, agent tabs, Changes, web/desktop handoff, and team automation.
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

<p>
  Your personal software factory for running any agent harness locally, in the
  cloud, and across the surfaces where work happens.
</p>

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

## Your Personal Software Factory

Proliferate is the open source workspace for using any coding agent and getting
real work done: local when you want desktop control, cloud when work needs to
keep going, and shared when a workflow is ready for the rest of your team.

- Use the agents you already trust: Codex, Claude Code, Gemini CLI, OpenCode,
  Cursor, Amp, and whatever comes next.
- Start work on your machine, keep it running in cloud when it needs time, and
  pick it back up from desktop or web.
- Spin up focused agent runs, compare plans and diffs, and review the useful
  work without juggling terminals.
- Turn repeated fixes, checks, reviews, and handoffs into automations your team
  can run from Proliferate or Slack.
- Keep control as adoption grows with open source, self-hosting, sandbox
  isolation, shared auth, and enterprise security boundaries.

## Bring Your Agent

Proliferate runs each agent through its native harness, so auth, tools, models,
permissions, and transcript behavior stay intact.

<table>
  <tr>
    <td align="center" width="120">
      <img src="./apps/desktop/public/provider-icons/claude.svg" width="40" height="40" alt="Claude" /><br />
      <strong>Claude Code</strong>
    </td>
    <td align="center" width="120">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="./apps/desktop/public/provider-icons/codex-dark.svg" />
        <img src="./apps/desktop/public/provider-icons/codex.svg" width="40" height="40" alt="Codex" />
      </picture><br />
      <strong>Codex</strong>
    </td>
    <td align="center" width="120">
      <img src="./apps/desktop/public/provider-icons/gemini.svg" width="40" height="40" alt="Gemini" /><br />
      <strong>Gemini CLI</strong>
    </td>
    <td align="center" width="120">
      <img src="./apps/desktop/public/provider-icons/opencode.png" width="40" height="40" alt="OpenCode" /><br />
      <strong>OpenCode</strong>
    </td>
    <td align="center" width="120">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="./docs/assets/readme/cursor-dark.svg" />
        <img src="./apps/desktop/public/provider-icons/cursor.svg" width="40" height="40" alt="Cursor" />
      </picture><br />
      <strong>Cursor</strong>
    </td>
    <td align="center" width="120">
      <img src="./apps/desktop/public/provider-icons/amp.svg" width="40" height="40" alt="Amp" /><br />
      <strong>Amp</strong>
    </td>
  </tr>
</table>

## Features

| Feature | What it unlocks |
| --- | --- |
| [Personal software factory](./docs/anyharness/guides/api.md) | Build, run, inspect, and improve agentic work from one open workspace. |
| [Native agent harnesses](./docs/anyharness/guides/harnesses.md) | Use Codex, Claude Code, Gemini, OpenCode, Cursor, Amp, and more with native behavior intact. |
| [Local and cloud workspaces](./docs/current/specs/00-sandbox-foundation.md) | Keep routine tasks fast and close, then send long-running work to managed or self-hosted cloud. |
| [Workspace continuity](./docs/current/specs/10-migration.md) | Carry agent context across desktop, web, local runtimes, and cloud sandboxes. |
| [Subagents and reviews](./docs/anyharness/product-mcps/reviews.md) | Split work across agents and launch code or plan review loops. |
| [Automations](./docs/current/specs/06-automations.md) | Schedule useful agent work and promote repeatable workflows into team defaults. |
| [Team workflows](./docs/current/specs/05-claiming.md) | Share work through Slack starts, shared sessions, claims, and multiplayer cloud chats. |
| [Plugins, MCPs, and skills](./docs/current/specs/01-mcp-skills-plugins.md) | Package tools, prompts, and capabilities once and project them into local or cloud runtimes. |
| [Enterprise controls](./docs/security/README.md) | Self-hosting, sandbox policy, shared auth, deployment boundaries, and security docs for companies. |

## Getting Started

### Quick Start

Download Proliferate from [proliferate.com](https://proliferate.com) or the
[latest GitHub release](https://github.com/proliferate-ai/proliferate/releases/latest).

<details>
<summary>Run from source</summary>

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

</details>

<details>
<summary>Full self-hosting for Proliferate Cloud</summary>

Full self-hosted Proliferate Cloud deployments are available for teams. Reach
out through [proliferate.com](https://proliferate.com) for access and deployment
support.

</details>

## Community

Join our open source community on [Discord](https://proliferate.com/discord)!

## Contributing

Looking to contribute? Please check out the [Contribution Guide](./CONTRIBUTING.md)
for more details.

## License

[AGPL-3.0](./LICENSE)
