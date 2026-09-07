<div align="center">

<p>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/readme/proliferate-wordmark-dark.svg" />
    <img src="./assets/readme/proliferate-wordmark-light.svg" width="320" alt="Proliferate" />
  </picture>
</p>

<h3>Your AI engineering team. Open source.</h3>

<p>
  <a href="https://github.com/proliferate-ai/proliferate/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/proliferate-ai/proliferate?style=flat&amp;logo=github&amp;label=stars" /></a>
  <a href="https://proliferate.com/changelog"><img alt="Latest release" src="https://img.shields.io/badge/release-changelog-0969DA?style=flat" /></a>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat" /></a>
  <a href="https://proliferate.com/docs"><img alt="Docs" src="https://img.shields.io/badge/docs-view-0969DA?style=flat" /></a>
  <a href="https://proliferate.com"><img alt="Website" src="https://img.shields.io/badge/website-visit-0969DA?style=flat" /></a>
  <a href="https://discord.gg/2RVNNzEZnj"><img alt="Discord" src="https://img.shields.io/badge/discord-join-5865F2?style=flat&amp;logo=discord&amp;logoColor=white" /></a>
</p>

<br />

Run coding agents in parallel and give them real engineering work.<br />
Keep their conversations, branches, terminals, and reviews in one place.

<br />

<p>
  <a href="https://proliferate.com"><strong>Download for macOS</strong></a>
  &nbsp;&bull;&nbsp;
  <a href="#self-hosting">Self-host</a>
  &nbsp;&bull;&nbsp;
  <a href="https://proliferate.com">Managed cloud</a>
  &nbsp;&bull;&nbsp;
  <a href="https://proliferate.com/docs">Documentation</a>
  &nbsp;&bull;&nbsp;
  <a href="https://proliferate.com/changelog">Changelog</a>
  &nbsp;&bull;&nbsp;
  <a href="https://discord.gg/2RVNNzEZnj">Discord</a>
</p>

<img width="1200" alt="Illustrative workflow, not a product recording: a human assigns a webhook retry bug, agents investigate, implement and review, and a patch is ready to inspect." src="./assets/readme/engineering-team-preview.svg" />

<p><sub>Concept illustration for this README preview. It is not a recording of a completed product run.</sub></p>

</div>

## Who's on your team?

Start with the work you wish someone could take on. Give an agent the
instructions, workspace, and connected tools for the job.

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>Your on-call engineer</h3>
      <p>"Investigate this error spike. Trace it back to a change and propose a fix."</p>
    </td>
    <td width="50%" valign="top">
      <h3>Your product engineer</h3>
      <p>"Add CSV export to the activity page, using our existing permissions."</p>
    </td>
  </tr>
  <tr>
    <td valign="top">
      <h3>Your code reviewer</h3>
      <p>"Review this PR for regressions and missing tests. Show me what needs attention."</p>
    </td>
    <td valign="top">
      <h3>Your QA engineer</h3>
      <p>"Exercise the new invite flow, including expired links and existing accounts."</p>
    </td>
  </tr>
  <tr>
    <td valign="top">
      <h3>Your support engineer</h3>
      <p>"Turn this customer's bug report into a reproduction and a proposed fix."</p>
    </td>
    <td valign="top">
      <h3>Your release engineer</h3>
      <p>"Review what changed since the last release. Flag migrations and draft the release notes."</p>
    </td>
  </tr>
</table>

These are example assignments for agents you configure. Ready-made employee
templates are not included in this preview.

## Bring the tools your team already uses

The work is in your repositories, issue tracker, docs, and production systems.
Connect those tools so your agents can work with the relevant context.

| Your team's work | Connections in this repository |
| --- | --- |
| Code and planning | **GitHub repositories**, **GitLab.com**, **Linear** |
| Errors and analytics | **Sentry**, **PostHog**, **Axiom** |
| Knowledge and communication | **Notion**, **Slack** (gated read/search connector) |
| Data and infrastructure | **Supabase**, **Neon Postgres**, **Render** |
| Documentation and research | **Context7**, **Exa**, **Tavily** |

GitHub uses the repository integration. The other names are built-in connection
definitions for remote MCP servers; connect your accounts and configure access
before using them. Organization admins can also add **custom remote MCP servers**.

<details>
<summary>Current connection support</summary>

- **Slack is still in development.** Its MCP read/search connection is gated by
  deployment configuration. The conversational Slack app and agent message
  delivery are not included in this release.
- **GitHub access here is repository access.** A built-in agent-tool connection
  for GitHub issues and comments is not included.
- Supabase defaults to read-only, and the Neon connection is configured
  read-only. Available actions depend on the provider, connection, and grants.
- Custom connections use remote HTTP(S) MCP endpoints. Authentication support
  depends on the connection type.

See the [connector catalog](./server/proliferate/server/integration_gateway/connections/seeds.py)
and [integration docs](https://proliferate.com/docs/product/integrations) for
configuration. Provider availability can change; the catalog is not a record
of live connectivity checks.

</details>

## Give your agents somewhere to work

Start with one useful job. Investigate an issue, work on a change, or ask another
agent to review it. Keep the work and the evidence somewhere you can inspect.

- **[Parallel agents](https://proliferate.com/docs/concepts/parallel-agents):** run agents side by side and follow their progress.
- **[Worktree workspaces](https://proliferate.com/docs/product/workspaces):** give each task an isolated branch and working directory.
- **[Subagents](https://proliferate.com/docs/features/subagents):** delegate scoped work and pick up the results when it finishes.
- **[Connected tools](https://proliferate.com/docs/product/integrations):** configure MCPs, skills, computer use, browser use, and custom tools for your agents.
- **[Recurring work](https://proliferate.com/docs/product/workflows):** configure workflows for review passes, alert triage, and other ongoing jobs.

## Supported agents

Use the agents you already work with. Proliferate runs each through its native
harness, including Claude Code, Codex, OpenCode, Cursor, and Grok. Model choice
and authentication depend on the harness you use.

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

## Software your company can own

We want a small team to be able to accomplish far more, with people and agents
working together. As more work happens this way, the platform underneath it
becomes important company infrastructure.

We believe companies should be able to understand that software, change it,
and operate it themselves.

Proliferate's source is available under **[AGPL-3.0](./LICENSE)**. Full-product
self-hostability is the direction we're building toward. Managed hosting is
the option where we operate the infrastructure for you.

## Where things stand

**Proliferate is under active development.** This repository includes the
desktop app, web client, control plane, and agent runtime. The broader team
platform and managed-cloud experience are still evolving.

You can self-host the current control plane and web app. **Cloud workspaces
currently depend on E2B:** this release does not yet include a fully self-hosted
sandbox stack. The [deployment guide](./guides/deploying/self-hosted-deploy.md)
describes the supported base installation and optional service requirements.

You can explore the source and self-hosting instructions while the broader
platform is being built. See the [website](https://proliferate.com) for current
managed access and availability, and the [changelog](https://proliferate.com/changelog)
for released changes.

## Get started

### Desktop

[Download the desktop app](https://proliferate.com), or run it from source with
the instructions below. Start with a repository and one task whose result you
can review.

### Self-hosting

Run the control plane and web app on your infrastructure, then connect the
desktop app to that installation. The base stack runs Caddy, Postgres, a
migration job, and the API with the compiled web client. It has its own instance
setup and sign-in flow.

Start with the [guided installer](./guides/deploying/self-hosted-deploy.md#guided-installer-recommended)
on a Linux host with Docker and Docker Compose v2. The guide takes you through
configuration, startup, and claiming the instance with a one-time setup token.
Model access and cloud workspaces require additional configuration.

- **Docker Compose:** [self-hosted-deploy.md](./guides/deploying/self-hosted-deploy.md)
  covers the installer, web app, bootstrap, updates, and diagnostics
- **AWS (one-click):** [self-hosted-aws.md](./guides/deploying/self-hosted-aws.md)
  is a CloudFormation wrapper that provisions the stack on EC2
- **Configuration:** [`server/deploy/.env.production.example`](./server/deploy/.env.production.example)
  documents every required and optional setting

Point the desktop app at your control plane by following
[configure desktop](https://proliferate.com/docs/deployment/configure-desktop).
[Open an issue](https://github.com/proliferate-ai/proliferate/issues/new/choose) or ask in
[Discord](https://discord.gg/2RVNNzEZnj) if you hit problems, and see
[SECURITY.md](./SECURITY.md) for reporting vulnerabilities.

### Run from source

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

## Build with us

Try Proliferate on a real piece of work. Tell us what helped, what broke, and
what you wish you could hand off next.

Share a useful workflow, improve an integration, or contribute a fix. We'd love
to see what your team builds.

**[Join the community](https://discord.gg/2RVNNzEZnj) ·
[Report an issue](https://github.com/proliferate-ai/proliferate/issues/new/choose) ·
[Contribute](./CONTRIBUTING.md)**

## License

[AGPL-3.0](./LICENSE)
