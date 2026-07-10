<div align="center">

<p>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./specs/developing/assets/readme/proliferate-wordmark-dark.svg" />
    <img src="./specs/developing/assets/readme/proliferate-wordmark-light.svg" width="320" alt="Proliferate" />
  </picture>
</p>

<p>
  <a href="https://github.com/proliferate-ai/proliferate"><img alt="GitHub stars" src="https://img.shields.io/github/stars/proliferate-ai/proliferate?style=flat&amp;logo=github&amp;label=stars" /></a>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat" /></a>
  <a href="https://discord.gg/7b5afMTqW"><img alt="Discord" src="https://img.shields.io/badge/discord-join-5865F2?style=flat&amp;logo=discord&amp;logoColor=white" /></a>
  <img alt="Platform: macOS" src="https://img.shields.io/badge/platform-macOS-black?style=flat&amp;logo=apple" />
</p>

<p>
  <strong>The open-source AI IDE for coding agents.</strong><br />
  Run Claude Code, Codex, Cursor, OpenCode, and Grok side by side—locally or in cloud workspaces, each with its own isolated environment.
</p>

<h3>
  <a href="https://proliferate.com/api/download"><u>Download Proliferate for macOS</u></a>
</h3>

<p>
  <a href="https://proliferate.com/docs/product/quickstart">Quickstart</a>
  &nbsp;&bull;&nbsp;
  <a href="https://proliferate.com/docs">Documentation</a>
  &nbsp;&bull;&nbsp;
  <a href="https://proliferate.com/docs/deployment">Self-hosting</a>
</p>

<img width="100%" alt="Proliferate agent workspace" src="./specs/developing/assets/readme/hero.png" />

</div>

## Features

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>Native agents, one workspace</h3>
      Keep each harness's authentication, models, tools, permissions, and transcript behavior. Proliferate adds the shared workspace around them.
      <br /><br />
      <a href="https://proliferate.com/docs/product/agents">Supported agents →</a>
    </td>
    <td width="50%" valign="top">
      <img width="100%" alt="Choose an agent, model, mode, and permissions in Proliferate" src="https://proliferate.com/docs-assets/home-cowork-composer.png" />
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>Parallel, local or cloud</h3>
      Give each task an isolated checkout or worktree. Keep fast work on your Mac or run long-lived work in a private cloud workspace.
      <br /><br />
      <a href="https://proliferate.com/docs/product/workspaces">Workspaces →</a>
    </td>
    <td width="50%" valign="top">
      <img width="100%" alt="Create a local checkout, worktree, or cloud workspace" src="https://proliferate.com/docs-assets/first-workspace-targets.png" />
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>Review before you merge</h3>
      Inspect plans, transcripts, terminals, files, tests, and diffs in one place. Ask one agent to review another before you merge.
    </td>
    <td width="50%" valign="top">
      <img width="100%" alt="Run a multi-agent code review in Proliferate" src="https://proliferate.com/docs-assets/review-code-review.png" />
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>Reusable workflows <sup>beta</sup></h3>
      Turn a useful routine into a workflow your team can inspect, reuse, and run across supported agents. Choose a model per step to balance capability and cost.
      <br /><br />
      <a href="https://proliferate.com/docs/product/workflows">Workflows →</a>
    </td>
    <td width="50%" valign="top">
      <img width="100%" alt="Create a reusable agent workflow in Proliferate" src="https://proliferate.com/docs-assets/automation-creation.png" />
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>Own your agent workspace</h3>
      Proliferate is AGPL-3.0. Bring existing subscriptions, provider keys, or a model gateway, and self-host the control plane when you need to operate it yourself.
      <br /><br />
      <a href="https://proliferate.com/docs/deployment">Self-hosting →</a>
    </td>
    <td width="50%" valign="top">
      <img width="100%" alt="Configure a Proliferate workspace environment" src="https://proliferate.com/docs-assets/first-workspace-configuration.png" />
    </td>
  </tr>
</table>

Self-hosting the control plane is in beta. Managed cloud workspaces still use
provider-hosted runtimes today.

### Also in the box

- Agent delegation and subagents for focused implementation, investigation, and review
- MCP servers, skills, and integrations shared across supported agents
- Built-in terminals, file browsing, git diffs, plan review, and code review
- Desktop and web access to private cloud workspaces
- Model choice per task, including lower-cost and open models exposed through supported harnesses

## Supported Agents

<p>
  <kbd><img src="./apps/desktop/public/provider-icons/claude.svg" width="18" height="18" alt="" />&nbsp; Claude Code</kbd>
  <kbd><img src="./apps/desktop/public/provider-icons/codex.svg" width="18" height="18" alt="" />&nbsp; Codex</kbd>
  <kbd><img src="./apps/desktop/public/provider-icons/cursor.svg" width="18" height="18" alt="" />&nbsp; Cursor</kbd>
  <kbd><img src="./apps/desktop/public/provider-icons/opencode.png" width="18" height="18" alt="" />&nbsp; OpenCode</kbd>
  <kbd>Grok</kbd>
</p>

Each agent runs through its native harness. Use the subscriptions you already
pay for, provider API keys, a compatible model gateway, or open models exposed
through supported harnesses. Availability varies by agent and target.

[Agent and authentication guide →](https://proliferate.com/docs/product/agents)

## Install

Download the macOS app from
[proliferate.com](https://proliferate.com/api/download), then follow the
[quickstart](https://proliferate.com/docs/product/quickstart).

To run the desktop app from source, install Rust stable, Node.js 22+, and pnpm:

~~~bash
make install
make dev-local
~~~

To operate your own control plane, follow the
[self-hosting guide](https://proliferate.com/docs/deployment).

## Community & Support

- Join [Discord](https://discord.gg/7b5afMTqW)
- Read the [documentation](https://proliferate.com/docs)
- Follow the [changelog](https://proliferate.com/changelog)
- Report vulnerabilities through [SECURITY.md](./SECURITY.md)

## Developing

Contributions are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) and the
[architecture overview](./specs/codebase/README.md).

## License

[AGPL-3.0](./LICENSE)
