<div align="center">

<p>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/readme/proliferate-wordmark-dark.svg" />
    <img src="./assets/readme/proliferate-wordmark-light.svg" width="320" alt="Proliferate" />
  </picture>
</p>

<h3>The open-source AI IDE</h3>

<p>
  <a href="https://github.com/proliferate-ai/proliferate/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/proliferate-ai/proliferate?style=flat&amp;logo=github&amp;label=stars" /></a>
  <a href="https://proliferate.com/changelog"><img alt="Latest release" src="https://img.shields.io/badge/release-changelog-0969DA?style=flat" /></a>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat" /></a>
  <a href="https://proliferate.com/docs"><img alt="Docs" src="https://img.shields.io/badge/docs-view-0969DA?style=flat" /></a>
  <a href="https://proliferate.com"><img alt="Website" src="https://img.shields.io/badge/website-visit-0969DA?style=flat" /></a>
  <a href="https://discord.gg/2RVNNzEZnj"><img alt="Discord" src="https://img.shields.io/badge/discord-join-5865F2?style=flat&amp;logo=discord&amp;logoColor=white" /></a>
</p>

<br />

Run Claude Code, Codex, OpenCode, and any other coding agent in parallel, in one workspace.<br />
Each task gets an isolated git worktree — branch, terminal, conversation, and review state kept together.

<br />

<p>
  <a href="https://proliferate.com"><strong>Download for macOS</strong></a>
  &nbsp;&bull;&nbsp;
  <a href="https://proliferate.com/docs">Documentation</a>
  &nbsp;&bull;&nbsp;
  <a href="https://proliferate.com/changelog">Changelog</a>
  &nbsp;&bull;&nbsp;
  <a href="https://discord.gg/2RVNNzEZnj">Discord</a>
</p>

<img width="full" alt="Proliferate" src="./assets/readme/hero.png" />

</div>

<br />

Proliferate is a desktop app for running coding agents in parallel.

- **Run any mix of agents in parallel**, each in its own isolated worktree, with native tools, auth, and config intact
- **Let your agents manage each other**, like having Codex hand design work to Claude Code
- **Set up MCPs and skills once**, shared across every agent

## Features

- 🤖 **[Native harnesses](https://proliferate.com/docs/product/agents)** - Claude Code, Codex, OpenCode, Cursor, Grok, and more
- 🌳 **[Worktree workspaces](https://proliferate.com/docs/product/workspaces)** - an isolated branch and working directory for every task
- 🔍 **[Git & diff review](https://proliferate.com/docs/product/workspaces/review-and-publish)** - inspect and edit agent changes without leaving the app
- 🛡️ **[Plan & code review agents](https://proliferate.com/docs/product/workspaces/review-and-publish)** - reviewer agents check plans, diffs, risks, and branch readiness before you do
- 🪆 **[Parallel agents & subagents](https://proliferate.com/docs/product/workspaces/parallel-agents)** - run agents side by side, or let them delegate scoped work to other agents
- 🧩 **[Integrations](https://proliferate.com/docs/product/integrations)** - MCPs, skills, Computer Use, Browser Use, and custom tools, configured once and shared by every agent
- ⏰ **[Workflows](https://proliferate.com/docs/product/workflows)** - recurring and event-driven agent runs: nightly review passes, triage on alerts, dependency bumps
- 🖼️ **[Artifacts](https://proliferate.com/docs/product/learn/cowork-and-artifacts)** - docs, UI, demos, and components rendered inline as agents produce them

## Supported agents

Each agent runs through its native harness, so auth, tools, models, permissions, and transcript behavior stay intact. New harness features show up in Proliferate the day they ship.

<table>
  <tr>
    <td align="center" width="120">
      <img src="./apps/desktop/public/provider-icons/claude.svg" width="40" height="40" alt="Claude" /><br />
      <strong>Claude</strong>
    </td>
    <td align="center" width="120">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="./apps/desktop/public/provider-icons/codex-dark.svg" />
        <img src="./apps/desktop/public/provider-icons/codex.svg" width="40" height="40" alt="Codex" />
      </picture><br />
      <strong>Codex</strong>
    </td>
    <td align="center" width="120">
      <img src="./apps/desktop/public/provider-icons/opencode.png" width="40" height="40" alt="OpenCode" /><br />
      <strong>OpenCode</strong>
    </td>
    <td align="center" width="120">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="./assets/readme/cursor-dark.svg" />
        <img src="./apps/desktop/public/provider-icons/cursor.svg" width="40" height="40" alt="Cursor" />
      </picture><br />
      <strong>Cursor</strong>
    </td>
    <td align="center" width="120">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="./assets/readme/grok-dark.svg" />
        <img src="./assets/readme/grok.svg" width="40" height="40" alt="Grok" />
      </picture><br />
      <strong>Grok</strong>
    </td>
  </tr>
</table>

## Self-hosting

Proliferate is AGPL-3.0 — the whole stack: desktop client, web app, and cloud
control plane. Download the app from [proliferate.com](https://proliferate.com)
or follow the [quickstart](https://proliferate.com/docs/product/quickstart) to
get going in a minute.

The full Proliferate control plane is self-hostable. Start with the
[deployment docs](https://proliferate.com/docs/deployment) — Docker, AWS, GCP,
Azure, Kubernetes, and air-gapped operation.

- **Docker Compose:** [self-hosted-deploy.md](./guides/deploying/self-hosted-deploy.md) —
  Caddy + Postgres + API, with bootstrap and update scripts
- **AWS (one-click):** [self-hosted-aws.md](./guides/deploying/self-hosted-aws.md) —
  CloudFormation wrapper that provisions the stack on EC2
- **Configuration:** [`server/deploy/.env.production.example`](./server/deploy/.env.production.example)
  documents every required and optional setting

Point the desktop app at your control plane by following
[configure desktop](https://proliferate.com/docs/deployment/configure-desktop).
[Open an issue](https://github.com/proliferate-ai/proliferate/issues/new/choose) or ask in
[Discord](https://discord.gg/2RVNNzEZnj) if you hit problems, and see
[SECURITY.md](./SECURITY.md) for reporting vulnerabilities.

<details>
<summary>Run from source</summary>

<br />

Requirements:

- Rust stable
- Node.js 22+
- pnpm

Run the desktop app with the bundled local AnyHarness runtime:

```bash
make install
make dev-local
```

**Local full-stack development** additionally requires Python 3.12+, `uv`, and
Docker for the local control plane database. Use named dev profiles when
multiple worktrees run at the same time.

```bash
make server-install
make setup PROFILE=main
make build # first clean worktree, or after generated/Rust/frontend artifacts change
make dev-list
make run PROFILE=main
```

See [dev profiles](./guides/local/dev-profiles.md) for profile state, ports,
generated Tauri config, and app labels.

</details>

## Cloud Sandbox

> Proliferate Cloud is not part of the initial launch — we're rebuilding the
> sandbox infrastructure to remove the E2B dependency and will ship Cloud in a
> follow-up release. Everything local above is available today.

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
- 🏗️ **Self-hosted Proliferate Cloud** - run the full cloud control plane yourself ([docs](#self-hosting))

Like everything else, Proliferate Cloud will be open source (AGPL-3.0) and
self-hostable.

## Community

Join our community on [Discord](https://discord.gg/2RVNNzEZnj)!

## Contributing

Contributing? See the [Contribution Guide](./CONTRIBUTING.md).

## License

[AGPL-3.0](./LICENSE)
