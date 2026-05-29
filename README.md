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

<p>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./docs/assets/readme/proliferate-wordmark-dark.svg" />
    <img src="./docs/assets/readme/proliferate-wordmark-light.svg" width="320" alt="Proliferate" />
  </picture>
</p>

<p><strong>The Local and Cloud Agent IDE (YC S25 🔸)</strong></p>

<p>
  <a href="https://github.com/proliferate-ai/proliferate/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/proliferate-ai/proliferate?style=social" /></a>
  <a href="https://github.com/proliferate-ai/proliferate/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/proliferate-ai/proliferate?sort=semver" /></a>
  <a href="./LICENSE"><img alt="License: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-blue" /></a>
  <a href="https://proliferate.com/docs"><img alt="Docs" src="https://img.shields.io/badge/docs-view-black" /></a>
</p>

<p>
  Your personal software factory for running any agent harness locally, in the
  cloud, and across the surfaces where work happens.
</p>

<p>
  <a href="https://proliferate.com"><strong>Download for macOS</strong></a>
  ·
  <a href="https://proliferate.com/docs">Documentation</a>
  ·
  <a href="https://proliferate.com/changelog">Changelog</a>
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
| [Automations](https://proliferate.com/docs/concepts/automations) | Run any agent on a schedule whenever, wherever. |
| [Native harnesses](https://proliferate.com/docs/concepts/agents-and-harnesses) | Claude Code, Codex, Gemini CLI, OpenCode, Cursor, Amp, and more. |
| [Workspaces](https://proliferate.com/docs/concepts/workspaces) | Isolated local worktrees and cloud sandboxes for every task. |
| [Workspace mobility](https://proliferate.com/docs/concepts/cloud) | Move workspaces between local and cloud when the job changes. |
| [Subagents](https://proliferate.com/docs/concepts/subagents) | Split investigation, implementation, and review across helper agents. |
| [Code and plan review](https://proliferate.com/docs/concepts/review) | Have reviewer agents check plans, diffs, risks, and branch readiness. |
| [Plugins](https://proliferate.com/docs/concepts/plugins) | Add MCPs, skills, Computer Use, Browser Use, and custom tools per session. |
| [Artifacts](https://proliferate.com/docs/concepts/artifacts) | Render agent outputs like docs, UI, demos, and components inline. |
| [Multiplayer cloud chats](https://proliferate.com/docs/concepts/cloud) | Share cloud sessions your team can inspect, claim, and continue. |
| [Team Slackbot](https://proliferate.com/docs/concepts/organizations) | Turn Slack requests into shared agent work for the whole team. |
| [Mobile](https://proliferate.com/docs/concepts/mobile) | Coming soon: dispatch work, approve actions, and follow runs from your phone. |
| [Organizations](https://proliferate.com/docs/concepts/organizations) | Team seats, shared settings, cloud limits, and governance controls. |

## Getting Started

### Quick Start

Download Proliferate from [proliferate.com](https://proliferate.com) or follow
the [installation guide](https://proliferate.com/docs/installation).

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
