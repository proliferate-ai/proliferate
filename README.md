<div align="center">

<p>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./specs/developing/assets/readme/proliferate-lockup-dark.svg" />
    <img src="./specs/developing/assets/readme/proliferate-lockup-light.svg" width="180" alt="Proliferate" />
  </picture>
</p>

<p>
  <a href="https://github.com/proliferate-ai/proliferate/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/proliferate-ai/proliferate?style=flat&label=%E2%98%85&color=2f363d" /></a>
  <a href="./LICENSE"><img alt="License: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-45618E?style=flat" /></a>
  <a href="https://discord.gg/wCEgUnEuF"><img alt="Join the Discord" src="https://img.shields.io/badge/Discord-5865F2?style=flat&logo=discord&logoColor=white" /></a>
  <img alt="Platform: macOS" src="https://img.shields.io/badge/macOS-2f363d?style=flat&logo=apple&logoColor=white" />
</p>

<p>
  The open-source AI IDE for working with any coding agent locally or in the cloud.
</p>

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

<!-- TODO(asset): hero.gif — composite: desktop app running 3-4 agents in parallel worktrees, one cloud session visible; see SHOTLIST.md -->
<picture>
  <source srcset="./specs/developing/assets/readme/hero.gif" type="image/gif" />
  <img width="100%" alt="Proliferate running multiple coding agents in parallel" src="./specs/developing/assets/readme/hero.png" />
</picture>

<p>
  <!-- Same video as the Show HN / launch posts -->
  <a href="{DEMO_LINK}"><b>▶ Watch: how I use Proliferate day to day (2 min)</b></a>
</p>

</div>

## Features

<table>
<tr>
<td width="50%" valign="middle">

### Move sessions between laptop and cloud

Start an agent locally, hand the running session to a cloud sandbox — or pull it back — mid-task, with history and changes intact.

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

Fan work across any mix of agents, each in its own worktree or cloud sandbox, with native tools, auth, and config intact. Kick off long-running work, close your laptop, check in later.

[Docs →](https://proliferate.com/docs/concepts/workspaces)

</td>
<td width="50%">
  <!-- TODO(asset): feature-wall/parallel-agents.{gif,jpg} — see SHOTLIST.md -->
  <a href="https://proliferate.com/docs/concepts/workspaces"><picture><source srcset="./specs/developing/assets/readme/feature-wall/parallel-agents.gif" type="image/gif"><img src="./specs/developing/assets/readme/feature-wall/parallel-agents.jpg" alt="Multiple agents working in parallel worktrees" width="100%" /></picture></a>
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Automate work by chaining agents

Chain prompts, goals, shell checks, approvals, and PR opening into workflows any agent can run — on demand or on a schedule. The release-QA workflow on this repo runs on GLM 5.2 and costs ~$0.04 a pass.

[Docs →](https://proliferate.com/docs/concepts/automations)

</td>
<td width="50%">
  <!-- TODO(asset): feature-wall/workflows.{gif,jpg} — workflow run view w/ step timeline + cost readout; see SHOTLIST.md -->
  <a href="https://proliferate.com/docs/concepts/automations"><picture><source srcset="./specs/developing/assets/readme/feature-wall/workflows.gif" type="image/gif"><img src="./specs/developing/assets/readme/feature-wall/workflows.jpg" alt="A workflow chaining agents with a visible cost readout" width="100%" /></picture></a>
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Agents managing agents

Delegate across harnesses: Codex hands design work to Claude Code, and subagents take on investigation, implementation, and review.

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

Inspect and edit agent diffs in-app — down to staging or reverting individual hunks — and let reviewer agents check plans, changes, and branch readiness before you do.

[Docs →](https://proliferate.com/docs/concepts/review)

</td>
<td width="50%">
  <!-- TODO(asset): feature-wall/review.{gif,jpg} — see SHOTLIST.md -->
  <a href="https://proliferate.com/docs/concepts/review"><picture><source srcset="./specs/developing/assets/readme/feature-wall/review.gif" type="image/gif"><img src="./specs/developing/assets/readme/feature-wall/review.jpg" alt="Reviewing agent diffs in Proliferate" width="100%" /></picture></a>
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Self-host the whole thing

AGPL, one Docker Compose stack — the app, the gateway, and the cloud itself. Point the official desktop app at your own server: your infra, your keys, your data. Attach your own machines over SSH as runners.

[Docs →](https://proliferate.com/docs/deployment)

</td>
<td width="50%">
  <!-- TODO(asset): feature-wall/self-host.{gif,jpg} — see SHOTLIST.md -->
  <a href="https://proliferate.com/docs/deployment"><picture><source srcset="./specs/developing/assets/readme/feature-wall/self-host.gif" type="image/gif"><img src="./specs/developing/assets/readme/feature-wall/self-host.jpg" alt="Self-hosting Proliferate with Docker Compose" width="100%" /></picture></a>
</td>
</tr>
</table>

**Also in the box:**

- **AI gateway &amp; budgets**: bring your own provider keys or agent subscriptions; agents and sandboxes only ever see short-lived per-user keys. See and cap what every person and every agent spends.
- **Native features, preserved**: goals an agent iterates toward, recurring in-session loops, plan modes, subagents — each through the harness's own machinery, not a re-implementation.
- **MCPs &amp; skills**: configured once, shared by every agent — plus Computer Use, Browser Use, and custom tools.
- **[Artifacts](https://proliferate.com/docs/concepts/artifacts)**: docs, UI, demos, and components rendered inline as agents produce them.
- **SSH access**: drop into any cloud sandbox from your terminal.
- **Teams (early)**: shared cloud sessions, org settings, per-member budgets — expanding over the coming weeks.
- **Mobile**: coming soon. Dispatch work, approve actions, and follow runs from your phone.
- **And more, constantly**: the [changelog](https://proliferate.com/changelog) is the real feature list.

---

## Bring Your Agent

Any coding agent, frontier or open. Each one runs through its native harness, so auth, tools, models, permissions, and transcript behavior stay intact — and new harness features show up in Proliferate the day they ship.

<p>
  <a href="https://proliferate.com/docs/concepts/agents-and-harnesses"><kbd><img src="./apps/desktop/public/provider-icons/claude.svg" alt="Claude" width="16" valign="middle" /> Claude Code</kbd></a> &nbsp;
  <a href="https://proliferate.com/docs/concepts/agents-and-harnesses"><kbd><img src="./apps/desktop/public/provider-icons/codex.svg" alt="Codex" width="16" valign="middle" /> Codex</kbd></a> &nbsp;
  <a href="https://proliferate.com/docs/concepts/agents-and-harnesses"><kbd><img src="./apps/desktop/public/provider-icons/opencode.png" alt="OpenCode" width="16" valign="middle" /> OpenCode</kbd></a> &nbsp;
  <a href="https://proliferate.com/docs/concepts/agents-and-harnesses"><kbd><img src="./apps/desktop/public/provider-icons/cursor.svg" alt="Cursor" width="16" valign="middle" /> Cursor</kbd></a> &nbsp;
  <a href="https://proliferate.com/docs/concepts/agents-and-harnesses"><kbd><img src="./apps/desktop/public/provider-icons/grok.svg" alt="Grok" width="16" valign="middle" /> Grok</kbd></a> &nbsp;
  <kbd>+ any coding agent</kbd>
</p>

Sign in with the subscriptions you already pay for, plug in API keys, or use the managed gateway — per agent, your choice.

---

## Install

**[Download for macOS](https://proliferate.com)**, or follow the [installation guide](https://proliferate.com/docs/installation).

<details>
<summary>Run from source</summary>

Requirements: Rust stable, Node.js 22+, pnpm.

```bash
make install
make dev-local
```

That runs the desktop app with the bundled local runtime. No server needed.

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

Run the whole Proliferate server yourself (beta) — one line:

```bash
curl -fsSL https://raw.githubusercontent.com/proliferate-ai/proliferate/main/scripts/self-host/install.sh | sh
```

That boots the full stack — app server, gateway, and cloud control plane — with Docker Compose on your box. Point the official desktop app at your server and you're on your own infrastructure. Optional add-ons: cloud sandboxes (E2B — the one external dependency) and the LiteLLM gateway; or attach your own machines over SSH as runners.

- **[Self-hosting docs](https://proliferate.com/docs/deployment)**: quickstart, add-ons, BYO certificates, and operations

Expect rough edges while in beta: [open an issue](../../issues/new/choose) or ask in [Discord](https://discord.gg/wCEgUnEuF). See [SECURITY.md](./SECURITY.md) for reporting vulnerabilities.

> **Proliferate Cloud** (hosted) is in beta and rolling out in waves; request access at [proliferate.com](https://proliferate.com). Everything local is open today.

## Community

- **Discord:** join us on [Discord](https://discord.gg/wCEgUnEuF)
- **Feedback &amp; ideas:** we ship every day; [request a feature](../../issues/new/choose) and there's a decent chance it exists by Friday
- **Show support:** [star this repo](https://github.com/proliferate-ai/proliferate) to follow along

## Contributing

Contributions welcome. See the [Contribution Guide](./CONTRIBUTING.md).

## License

[AGPL-3.0](./LICENSE)
