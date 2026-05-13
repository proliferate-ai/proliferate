# Plugins and skills product architecture

Status: reference architecture for plugin packages, skills, plugin-owned MCP
servers, the plugins UI, and the session bundle boundary.

This document does not define the Cloud worker, target enrollment, command
delivery, event upload, or Cloud session sync system. Those belong to the
[cloud worker and control plane architecture](cloud-worker-control-plane.md).

## Core model

A plugin is a package boundary. It groups the capabilities an agent may need
for one product area.

```text
plugin package
  manifest
  skill markdown files
  MCP server definitions
  credential requirements
  compute/runtime requirements
  UI/catalog metadata
  optional assets/resources
```

Examples:

```text
plugins/github/
  plugin.json
  skills/
    review-pr.md
    triage-issue.md
  mcp/
    github-tools.json
  assets/

plugins/browser-use/
  plugin.json
  skills/
    inspect-page.md
  mcp/
    browser-tools.json
```

Installing a plugin means registering a versioned package in the relevant
plugin registry. It does not mean every compute target already has every
runtime dependency installed.

Plugin package registries:

- hosted Proliferate Cloud registry for first-party and hosted team plugins
- self-hosted Proliferate Cloud registry for self-hosted deployments
- desktop-local registry/cache for local-only plugins

Skill `.md` files remain package source. They are read while resolving a
session launch bundle. AnyHarness should not discover arbitrary skill files
from disk at session time.

## Package versus session bundle

There are two separate objects.

```text
Plugin package
  durable catalog/config artifact
  versioned
  contains manifests, skill markdown, MCP server definitions, requirements, UI data
  owned by cloud/desktop/self-hosted plugin registry

SessionPluginBundle
  concrete session launch snapshot
  contains only selected enabled components
  includes full selected skill instructions
  includes selected plugin MCP server definitions
  includes credential binding references, never broad raw secrets
  sent to AnyHarness during session create/resume
```

The package is durable product/config state. The bundle is the resolved
runtime input for one session.

Running sessions use the plugin versions they launched with. New package
versions affect new sessions by default. Existing sessions update only when
explicitly resumed or restarted with a new resolved bundle.

## State terms

Use these words consistently.

- `available`: the plugin exists in a catalog or registry.
- `installed`: the plugin package is available to this user/team/deployment.
- `connected`: the plugin has the required account/auth connection.
- `enabled`: the plugin or child capability is selected for a surface or
  session type.
- `ready`: the selected compute target can run the required MCP/provider
  runtime pieces.
- `mounted`: the session launched with that MCP server or the skills MCP
  server.
- `activated`: the agent requested full instructions for a specific skill
  through the skills MCP server.

Do not collapse these states. A plugin can be installed but not enabled,
connected but not granted to a session, enabled but not target-ready, or
available but never activated by the agent.

## Product surfaces

The plugins UI should be plugin-package-first, not connector-first.

### Plugins list

The top-level page shows plugin packages, not raw MCP servers or credential
records.

Recommended shape:

```text
Plugins
  search / filters / installed / available

  GitHub
    status: connected
    includes: App, MCP server, 3 skills
    enabled for: sessions, automations

  Browser Use
    status: needs setup
    includes: MCP server, skill bundle
    requires: browser sidecar
```

Use a dense operational list rather than a marketing-card grid:

- compact rows
- small plugin icon
- plugin name and one-line description
- status chip
- included capability count
- enabled scopes
- row-level actions

### Plugin detail

The detail surface owns package configuration.

Recommended shape:

```text
Plugins > GitHub

[icon] GitHub
Connect repositories, issues, PRs, and repo-aware skills.

Actions:
  Try in chat
  Enable / Disable
  More

Includes:
  App/Auth      GitHub account connection        Connected
  MCP server    github_tools                     Enabled
  Skill         review-pull-request              Enabled
  Skill         triage-issue                     Disabled

Settings:
  Enabled in new coding sessions
  Enabled in automations
  Enabled in cowork sessions
  Enabled for selected teams/users

Readiness:
  Credentials        Connected
  Runtime            Target-dependent
  Required software  node >= 20
```

Child rows should expose type and state clearly:

- `App/Auth`: account connection and credential binding state
- `MCP server`: mounted tool server candidate
- `Skill`: markdown-backed instructions that can be activated by the agent
- `Requirement`: runtime/software prerequisite

### Session launch

Session launch should show a compact selection surface, not the full catalog.

It should answer:

- which plugins are enabled for this session
- which selected plugins have missing credentials
- which selected plugins may not be ready on the selected target
- what MCP servers and skills will be added at launch

The launch UI should not construct prompt text. It collects intent and calls
the owning resolver to produce a `SessionPluginBundle`.

### In-session visibility

The session UI may show:

- active plugins
- mounted MCP servers
- available skills
- activated skills
- warnings from bundle resolution

The session UI should not mutate skill instructions or rebuild the prompt.
Skill activation is an agent/runtime action through the skills MCP server.

## UI ownership

Frontend code should preserve the same architectural split as the rest of the
desktop app.

```text
components/plugins/**
  render plugin package lists, detail rows, modals, toggles, and warnings

hooks/plugins/**
  own React state, effects, URL/modal state, query/mutation wiring, and
  UI-facing orchestration

lib/domain/plugins/**
  pure package/view-model/bundle selection logic

lib/workflows/sessions/**
  session launch assembly that calls plugin bundle resolution

lib/access/**
  raw Cloud, AnyHarness, or local platform access
```

Components should not construct AnyHarness clients, call raw endpoint paths,
or build prompt text. They render view models and invoke hooks/workflows.

## Bundle resolution

Bundle resolution is the act of turning package policy and UI selections into
one concrete session input.

Inputs:

- installed plugin packages
- enabled plugin scopes
- selected session type
- selected compute target readiness
- credential binding state
- team/user/automation policy
- per-session overrides

Output:

```text
SessionPluginBundle
  plugins[]
    pluginId
    version
    skills[]
      skillId
      displayName
      description
      instructions
      resources[]
      requiredMcpServers[]
      credentialBindingIds[]
    mcpServers[]
    mcpBindingSummaries[]
    credentialBindings[]
```

Local desktop may resolve bundles locally when using local plugin packages and
local policy. Hosted or self-hosted Cloud resolves bundles for cloud-managed
sessions, team sessions, automations, Slack, mobile, web, and API flows.

The resolved bundle is a snapshot. It should not contain mutable pointers to
plugin files that can change under a running session.

## Skills and prompt injection

The frontend and Cloud control plane should not build final agent prompt text
by hand.

AnyHarness turns `SessionPluginBundle` into runtime prompt/MCP state:

```text
SessionPluginBundle.skills[]
  -> AnyHarness renders compact skill index
  -> skill index is added to prompt context
  -> AnyHarness mounts the skills MCP server
  -> agent lists available skills
  -> agent activates a skill by id
  -> AnyHarness returns full markdown instructions/resources
```

Do not dump every enabled skill markdown body into the system prompt by
default. The prompt gets the compact index. Full instructions are returned when
the agent activates the skill.

## Plugin MCP servers

A plugin MCP server is an MCP server packaged with or referenced by a plugin.

The package declares:

- MCP server id
- display name and description
- command/runtime definition
- required credentials
- required runtime/software
- whether it is enabled by default for a scope
- skills that require it

Product behavior still belongs in the owning product domain. Shared MCP
protocol scaffolding belongs in the AnyHarness MCP integration layer described
by [MCP in AnyHarness](../anyharness/specs/mcp.md). The plugin package selects
and configures capabilities; it should not become a dumping ground for product
business logic.

## Runtime requirements

Plugin packages should declare target requirements explicitly.

Examples:

- node/npm/npx/pnpm
- Python/uv
- Docker
- managed binary
- browser/display server
- sidecar process
- filesystem access
- network egress
- credential binding

Bundle resolution may mark a plugin as blocked or degraded when a selected
target cannot satisfy its requirements. The mechanism that probes and reports
target readiness is outside this architecture note.

## Credential bindings

Plugins declare credential requirements. Resolvers select credential bindings.

Credential binding references may appear in `SessionPluginBundle`; broad raw
secret material should not.

Good:

- session-scoped grants
- narrow resource scope
- short expiry where possible
- process-local runtime injection
- audit records with grant ids
- redacted logs/events

Bad:

- copying broad team tokens into plugin package files
- long-lived secrets in plugin manifests
- target-wide environment variables for unrelated processes
- prompt text containing secrets

## Adding a plugin

Adding a plugin should include:

- package manifest
- display metadata and category
- skill markdown files
- MCP server definitions if any
- credential requirement declarations
- runtime requirement declarations
- default enablement policy
- package validation tests
- bundle resolution tests
- UI list and detail coverage for package rows and child capability rows

If the plugin introduces product behavior, add that behavior to the owning
product domain and expose it through MCP or session extension boundaries.

## Implementation invariants

- Plugin package is durable product/config state.
- `SessionPluginBundle` is the resolved launch snapshot.
- Skill markdown remains package source.
- AnyHarness injects compact skill index text and serves full skill
  instructions through the skills MCP server.
- UI is plugin-package-first, with auth, MCP servers, skills, and requirements
  as children.
- Installed, connected, enabled, ready, mounted, and activated are separate
  states.
- Components do not build prompt text or call raw access clients.
- Existing sessions do not silently change behavior when a plugin package is
  updated.
