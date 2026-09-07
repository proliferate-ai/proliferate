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
</p>

<br />

Give your agents real engineering work, together with your team.

<br />

<p>
  <a href="https://proliferate.com"><strong>Download for macOS</strong></a>
  &nbsp;&bull;&nbsp;
  <a href="#self-hosting">Self-host</a>
  &nbsp;&bull;&nbsp;
  <a href="https://proliferate.com">Managed cloud</a>
</p>

<img width="1200" alt="Illustrative workflow, not a product recording: a human assigns a webhook retry bug, agents investigate, implement and review, and a patch is ready to inspect." src="./assets/readme/engineering-team-preview.svg" />

</div>

## Who's on your team?

Example roles. Your choice of agent, instructions, and tools.

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

## Bring the tools your team already uses

**GitHub repos · Linear · Sentry · PostHog · Notion · Supabase · GitLab.com ·
Render · Neon · Axiom · Context7 · Exa · Tavily**

Plus custom remote MCP servers. Slack read/search is available behind a deployment gate.

<details>
<summary>Current connection support</summary>

- **Slack is still in development.** Its MCP read/search connection is gated by
  deployment configuration. The conversational Slack app and agent message
  delivery are not included in this release.
- **GitHub access here is repository access.** A built-in agent-tool connection
  for GitHub issues and comments is not included.
- Other listed connections use remote MCP servers and require account setup.
- Supabase defaults to read-only, and the Neon connection is configured
  read-only. Available actions depend on the provider, connection, and grants.
- Custom connections use remote HTTP(S) MCP endpoints. Authentication support
  depends on the connection type.

See the [connector catalog](./server/proliferate/server/integration_gateway/connections/seeds.py)
and [integration docs](https://proliferate.com/docs/product/integrations) for
configuration. Provider availability can change; the catalog is not a record
of live connectivity checks.

</details>

## Use your agents

Native harnesses. Model choice and authentication depend on the agent.

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

Companies should own the platform their agents work through. Proliferate is
**[AGPL-3.0](./LICENSE)**, with full-product self-hostability as the goal.
Managed hosting is the option we operate for you.

**Work in progress:** the current control plane and web app are self-hostable.
Cloud workspaces still use E2B; the fully owned sandbox stack and broader team
experience are being built.

## Self-hosting

[Guided install](./guides/deploying/self-hosted-deploy.md#guided-installer-recommended) ·
[AWS deployment](./guides/deploying/self-hosted-aws.md) ·
[Configuration](./server/deploy/.env.production.example)

<details>
<summary>Run from source</summary>

Requires Rust stable, Node.js 22+, and pnpm.

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

## Build with us

Share what your team builds. Help make the next job easier.

[Community](https://discord.gg/2RVNNzEZnj) ·
[Contribute](./CONTRIBUTING.md) ·
[Docs](https://proliferate.com/docs) ·
[Changelog](https://proliferate.com/changelog) ·
[Report a vulnerability](./SECURITY.md)
