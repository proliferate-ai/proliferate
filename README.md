<div align="center">

<p>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./specs/developing/assets/readme/proliferate-wordmark-dark.svg" />
    <img src="./specs/developing/assets/readme/proliferate-wordmark-light.svg" width="320" alt="Proliferate" />
  </picture>
</p>

<h3>The Open Source AI IDE</h3>

<p>
  <a href="https://github.com/proliferate-ai/proliferate/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/proliferate-ai/proliferate?style=flat&logo=github&label=stars" /></a>
  <a href="https://proliferate.com/changelog"><img alt="Latest release" src="https://img.shields.io/badge/release-changelog-0969DA?style=flat" /></a>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat" /></a>
  <a href="https://proliferate.com/docs"><img alt="Docs" src="https://img.shields.io/badge/docs-view-0969DA?style=flat" /></a>
  <a href="https://discord.gg/wCEgUnEuF"><img alt="Discord" src="https://img.shields.io/badge/discord-join-5865F2?style=flat&logo=discord&logoColor=white" /></a>
  <img alt="Platforms" src="https://img.shields.io/badge/macOS-000000?style=flat&logo=apple&logoColor=white" />
</p>

<br />

Run Claude Code, Codex, Gemini, and any coding agent in parallel — on your machine,<br />
in cloud sandboxes, or on your own servers. Move running sessions between them.

<br />

<h3><a href="https://proliferate.com"><ins>Download for macOS</ins></a></h3>

<p>
  <a href="https://proliferate.com/docs">Documentation</a>
  &nbsp;&bull;&nbsp;
  <a href="https://proliferate.com/changelog">Changelog</a>
  &nbsp;&bull;&nbsp;
  <a href="https://proliferate.com/docs/deployment">Self-hosting</a>
  &nbsp;&bull;&nbsp;
  <a href="https://discord.gg/wCEgUnEuF">Discord</a>
</p>

<!-- TODO(asset): hero.gif — composite: desktop app running 3-4 agents in parallel worktrees, web/cloud session visible; see SHOTLIST.md -->
<picture>
  <source srcset="./specs/developing/assets/readme/hero.gif" type="image/gif" />
  <img width="full" alt="Proliferate running multiple coding agents in parallel" src="./specs/developing/assets/readme/hero.png" />
</picture>

</div>

## Features

<table>
<tr>
<td width="50%" valign="middle">

### Move sessions between laptop and cloud

Start an agent locally, hand the running session to a cloud sandbox — or pull it back — mid-task, with changes and history intact.

[Docs →](https://proliferate.com/docs/concepts/workspaces)

</td>
<td width="50%">
  <!-- TODO(asset): feature-wall/session-handoff.{gif,jpg} — see SHOTLIST.md -->
  <a href="https://proliferate.com/docs/concepts/workspaces"><picture><source srcset="./specs/developing/assets/readme/feature-wall/session-handoff.gif" type="image/gif"><img src="./specs/developing/assets/readme/feature-wall/session-handoff.jpg" alt="Moving a running agent session from laptop to cloud" width="100%" /></picture></a>
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Parallel agents, isolated worktrees

Fan work across any mix of agents, each in its own worktree or sandbox — native tools, auth, and config intact. Compare results, merge the winner.

[Docs →](https://proliferate.com/docs/concepts/workspaces)

</td>
<td width="50%">
  <!-- TODO(asset): feature-wall/parallel-agents.{gif,jpg} — see SHOTLIST.md -->
  <a href="https://proliferate.com/docs/concepts/workspaces"><picture><source srcset="./specs/developing/assets/readme/feature-wall/parallel-agents.gif" type="image/gif"><img src="./specs/developing/assets/readme/feature-wall/parallel-agents.jpg" alt="Multiple agents working in parallel worktrees" width="100%" /></picture></a>
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Agents managing agents

Delegate across harnesses — Codex hands design work to Claude Code; subagents take on investigation, implementation, and review.

[Docs →](https://proliferate.com/docs/concepts/subagents)

</td>
<td width="50%">
  <!-- TODO(asset): feature-wall/agent-delegation.{gif,jpg} — see SHOTLIST.md -->
  <a href="https://proliferate.com/docs/concepts/subagents"><picture><source srcset="./specs/developing/assets/readme/feature-wall/agent-delegation.gif" type="image/gif"><img src="./specs/developing/assets/readme/feature-wall/agent-delegation.jpg" alt="One agent delegating work to another" width="100%" /></picture></a>
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Review before you merge

Inspect and edit agent diffs in-app, and let reviewer agents check plans, changes, risks, and branch readiness before you do.

[Docs →](https://proliferate.com/docs/concepts/review)

</td>
<td width="50%">
  <!-- TODO(asset): feature-wall/review.{gif,jpg} — see SHOTLIST.md -->
  <a href="https://proliferate.com/docs/concepts/review"><picture><source srcset="./specs/developing/assets/readme/feature-wall/review.gif" type="image/gif"><img src="./specs/developing/assets/readme/feature-wall/review.jpg" alt="Reviewing agent diffs in Proliferate" width="100%" /></picture></a>
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Automations &amp; Slack

Run any agent on a schedule, or turn a Slack message into shared agent work your whole team can follow.

[Docs →](https://proliferate.com/docs/concepts/automations)

</td>
<td width="50%">
  <!-- TODO(asset): feature-wall/automations-slack.{gif,jpg} — see SHOTLIST.md -->
  <a href="https://proliferate.com/docs/concepts/automations"><picture><source srcset="./specs/developing/assets/readme/feature-wall/automations-slack.gif" type="image/gif"><img src="./specs/developing/assets/readme/feature-wall/automations-slack.jpg" alt="Scheduled automations and Slack-triggered agent work" width="100%" /></picture></a>
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Self-host the whole thing

AGPL, one Docker Compose stack (or one-click AWS). Point the official desktop app at your own server — your infra, your keys.

[Docs →](https://proliferate.com/docs/deployment)

</td>
<td width="50%">
  <!-- TODO(asset): feature-wall/self-host.{gif,jpg} — see SHOTLIST.md -->
  <a href="https://proliferate.com/docs/deployment"><picture><source srcset="./specs/developing/assets/readme/feature-wall/self-host.gif" type="image/gif"><img src="./specs/developing/assets/readme/feature-wall/self-host.jpg" alt="Self-hosting Proliferate with Docker Compose" width="100%" /></picture></a>
</td>
</tr>
</table>

**Also in the box:**

- **[Plugins](https://proliferate.com/docs/concepts/plugins)** — MCPs, skills, Computer Use, Browser Use, and custom tools, configured once and shared by every agent
- **[Artifacts](https://proliferate.com/docs/concepts/artifacts)** — docs, UI, demos, and components rendered inline as agents produce them
- **Remote dispatch &amp; SSH** — kick off and steer work from the web; drop into any cloud sandbox from your terminal
- **Credential gateway** — your keys and subscriptions never touch the sandbox; sandboxes only get short-lived tokens
- **Multiplayer cloud chats &amp; organizations** — live sessions your team can inspect, claim, and continue; seats, shared settings, and governance
- **Mobile** — coming soon: dispatch work, approve actions, and follow runs from your phone
- **And more, constantly** — the [changelog](https://proliferate.com/changelog) is the real feature list.

---

## Bring Your Agent

Each agent runs through its native harness, so auth, tools, models, permissions, and transcript behavior stay intact. New harness features show up in Proliferate the day they ship.

<p>
  <a href="https://proliferate.com/docs/concepts/agents-and-harnesses"><kbd><img src="./apps/desktop/public/provider-icons/claude.svg" alt="Claude" width="16" valign="middle" /> Claude Code</kbd></a> &nbsp;
  <a href="https://proliferate.com/docs/concepts/agents-and-harnesses"><kbd><img src="./apps/desktop/public/provider-icons/codex.svg" alt="Codex" width="16" valign="middle" /> Codex</kbd></a> &nbsp;
  <a href="https://proliferate.com/docs/concepts/agents-and-harnesses"><kbd><img src="./apps/desktop/public/provider-icons/gemini.svg" alt="Gemini CLI" width="16" valign="middle" /> Gemini CLI</kbd></a> &nbsp;
  <a href="https://proliferate.com/docs/concepts/agents-and-harnesses"><kbd><img src="./apps/desktop/public/provider-icons/opencode.png" alt="OpenCode" width="16" valign="middle" /> OpenCode</kbd></a> &nbsp;
  <a href="https://proliferate.com/docs/concepts/agents-and-harnesses"><kbd><img src="./apps/desktop/public/provider-icons/cursor.svg" alt="Cursor" width="16" valign="middle" /> Cursor</kbd></a> &nbsp;
  <kbd>+ any coding agent</kbd>
</p>

---

## Install

**[Download for macOS](https://proliferate.com)** — or follow the [installation guide](https://proliferate.com/docs/installation).

<details>
<summary>Run from source</summary>

Requirements: Rust stable, Node.js 22+, pnpm.

```bash
make install
make dev-local
```

That runs the desktop app with the bundled local runtime — no server needed.

For full-stack development (Python 3.12+, `uv`, and Docker also required), use named dev profiles:

```bash
make server-install
make setup PROFILE=main
make build
make run PROFILE=main
```

See [dev profiles](./specs/developing/local/dev-profiles.md) and [CONTRIBUTING.md](./CONTRIBUTING.md).

</details>

## Self-hosting

Run the whole Proliferate server yourself (beta): one Docker Compose stack, or a one-click AWS deployment. Point the official desktop app at your server and your team is on your infrastructure.

- **[Self-hosting docs](https://proliferate.com/docs/deployment)** — overview, quickstart, add-ons, and operations
- Source-of-truth deploy references in-repo: [Docker Compose](./specs/developing/deploying/self-hosted-deploy.md) · [AWS one-click](./specs/developing/deploying/self-hosted-aws.md) · [`.env.production.example`](./server/deploy/.env.production.example)

Expect rough edges while in beta — [open an issue](../../issues/new/choose) or ask in [Discord](https://discord.gg/wCEgUnEuF). See [SECURITY.md](./SECURITY.md) for reporting vulnerabilities.

> **Proliferate Cloud** (hosted) is in beta and rolling out in waves — request access at [proliferate.com](https://proliferate.com). Everything local is open today.

## Community

- **Discord:** join us on [Discord](https://discord.gg/wCEgUnEuF)
- **Feedback &amp; ideas:** we ship fast — [request a feature](../../issues/new/choose)
- **Show support:** [star this repo](https://github.com/proliferate-ai/proliferate) to follow along

## Contributing

See the [Contribution Guide](./CONTRIBUTING.md).

<a href="https://github.com/proliferate-ai/proliferate/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=proliferate-ai/proliferate" alt="Proliferate contributors" />
</a>

## License

[AGPL-3.0](./LICENSE)
