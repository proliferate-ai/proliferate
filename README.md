<div align="center">

<p>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./specs/developing/assets/readme/proliferate-wordmark-dark.svg" />
    <img src="./specs/developing/assets/readme/proliferate-wordmark-light.svg" width="320" alt="Proliferate" />
  </picture>
</p>

<h3>The Open Source AI IDE</h3>

<p>
  <a href="https://github.com/proliferate-ai/proliferate/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/proliferate-ai/proliferate?style=flat&amp;logo=github&amp;label=stars" /></a>
  <a href="https://proliferate.com/changelog"><img alt="Latest release" src="https://img.shields.io/github/v/release/proliferate-ai/proliferate?style=flat&amp;sort=semver&amp;label=release" /></a>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/github/license/proliferate-ai/proliferate?style=flat&amp;label=license" /></a>
  <a href="https://proliferate.com/docs"><img alt="Docs" src="https://img.shields.io/badge/docs-view-0969DA?style=flat" /></a>
  <a href="https://proliferate.com"><img alt="Website" src="https://img.shields.io/badge/website-visit-0969DA?style=flat" /></a>
  <a href="https://discord.gg/wCEgUnEuF"><img alt="Discord" src="https://img.shields.io/badge/discord-join-5865F2?style=flat&amp;logo=discord&amp;logoColor=white" /></a>
</p>

<br />

Run Claude Code, Codex, Gemini, and any other coding agent in parallel, in one workspace.<br />
Move running sessions between your machine and the cloud. Works solo or across a team.

<br />

<p>
  <a href="https://proliferate.com"><strong>Download for macOS</strong></a>
  &nbsp;&bull;&nbsp;
  <a href="https://proliferate.com/docs">Documentation</a>
  &nbsp;&bull;&nbsp;
  <a href="https://proliferate.com/changelog">Changelog</a>
  &nbsp;&bull;&nbsp;
  <a href="https://discord.gg/wCEgUnEuF">Discord</a>
</p>

<!-- LAUNCH BLOCKER: full-width product screenshot or demo GIF goes here. -->
<!-- <img width="full" alt="Proliferate" src="./specs/developing/assets/readme/hero.png" /> -->

</div>

Proliferate is a desktop and web app for running coding agents in parallel, locally or in cloud sandboxes. Each agent runs through its own native harness.

- **Run any mix of agents in parallel**, each in its own isolated worktree or sandbox, with native tools, auth, and config intact
- **Let your agents manage each other**, like having Codex hand design work to Claude Code
- **Set up MCPs and skills once**, shared across every agent

## Bring Your Agent

Each agent runs through its native harness, so auth, tools, models, permissions, and transcript behavior stay intact. New harness features show up in Proliferate the day they ship.

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
        <source media="(prefers-color-scheme: dark)" srcset="./specs/developing/assets/readme/cursor-dark.svg" />
        <img src="./apps/desktop/public/provider-icons/cursor.svg" width="40" height="40" alt="Cursor" />
      </picture><br />
      <strong>Cursor</strong>
    </td>
  </tr>
</table>

## Features

- 🤖 **[Native harnesses](https://proliferate.com/docs/concepts/agents-and-harnesses)** - Claude Code, Codex, Gemini CLI, OpenCode, Cursor, and more
- 🌳 **[Worktree workspaces](https://proliferate.com/docs/concepts/workspaces)** - an isolated branch and working directory for every task
- 🔍 **[Git & diff review](https://proliferate.com/docs/concepts/review)** - inspect and edit agent changes without leaving the app
- 🛡️ **[Plan & code review agents](https://proliferate.com/docs/concepts/review)** - reviewer agents check plans, diffs, risks, and branch readiness before you do
- 🪆 **[Subagents](https://proliferate.com/docs/concepts/subagents)** - agents delegate investigation, implementation, and review to other agents
- 🧩 **[Plugins](https://proliferate.com/docs/concepts/plugins)** - MCPs, skills, Computer Use, Browser Use, and custom tools, configured once and shared by every agent
- ⏰ **[Automations](https://proliferate.com/docs/concepts/automations)** - run any agent on any schedule
- 🖼️ **[Artifacts](https://proliferate.com/docs/concepts/artifacts)** - docs, UI, demos, and components rendered inline as agents produce them

## Open Source

Proliferate is AGPL-3.0. The desktop and web apps are fully open today, and self-hosting for the complete cloud control plane is coming soon.

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

See [dev profiles](./specs/developing/local/dev-profiles.md) for profile state, ports,
generated Tauri config, and app labels.

</details>

<details>
<summary>Self-host Proliferate Cloud (coming soon)</summary>

Self-hosting the full Proliferate Cloud control plane is coming soon. Teams
that want an early self-hosted deployment can reach out through
[proliferate.com](https://proliferate.com) for access and deployment support.

</details>

## Proliferate Cloud (Beta)

> Proliferate Cloud is in beta and rolling out in waves - request access at
> [proliferate.com](https://proliferate.com). Everything local above is fully
> open and available today.

- ☁️ **Cloud sandboxes** - isolated cloud environments that keep working after you close your laptop
- 🔁 **Workspace mobility** - move a running workspace between your machine and the cloud, mid-task, with changes and history intact
- 👥 **Multiplayer cloud chats** - live sessions your team can inspect, claim, and continue
- 💬 **Team Slackbot** - turn a Slack message into shared agent work for the whole team
- 🤝 **Team automations** - shared recurring fixes and reviews the whole team can run
- 🛰️ **Remote dispatch** - kick off and steer work on your own machine from the web
- 🔑 **SSH access** - drop into any cloud sandbox from your terminal
- 🔐 **Credential gateway** - your keys and subscriptions never touch the sandbox; sandboxes only get short-lived tokens
- 🏢 **Organizations** - team seats, shared settings, cloud limits, and governance controls
- 📱 **Mobile** - coming soon: dispatch work, approve actions, and follow runs from your phone
- 🏗️ **Self-hosted Proliferate Cloud** - coming soon: run the full cloud control plane yourself

Proliferate Cloud will be fully self-hostable and open source once it's out of beta.

## Community

Join our open source community on [Discord](https://discord.gg/wCEgUnEuF)!

## Contributing

Looking to contribute? Please check out the [Contribution Guide](./CONTRIBUTING.md)
for more details.

## License

[AGPL-3.0](./LICENSE)
