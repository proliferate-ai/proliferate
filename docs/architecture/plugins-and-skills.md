# Plugins and Skills Architecture

Status: authoritative for plugin packages, plugin skills, plugin-owned MCP
servers, the Desktop plugins UI, and the `SessionPluginBundle` runtime
boundary.

This document does not define Cloud worker registration, command delivery,
event upload, target enrollment, or Cloud session sync. Those systems are being
redesigned separately. This document only records the plugin/skill model they
should eventually use: Cloud or Desktop resolves a session-scoped plugin
bundle; AnyHarness runs that bundle; the worker, when it exists, only
materializes and delivers already-authorized session inputs.

Implementation work in this area usually crosses multiple repo areas. Read the
area docs before editing:

- `docs/server/README.md` for Cloud catalog and materialization code.
- `docs/frontend/README.md`, `docs/frontend/guides/components.md`,
  `docs/frontend/guides/hooks.md`, `docs/frontend/guides/styling.md`, and
  `docs/frontend/specs/chat-transcript.md` for Desktop UI and transcript work.
- `docs/sdk/README.md` for generated Cloud and AnyHarness clients.
- `docs/anyharness/README.md`, `docs/anyharness/contract.md`,
  `docs/anyharness/guides/api.md`, `docs/anyharness/guides/domains.md`, and
  `docs/anyharness/specs/mcp.md` for runtime contract/API/MCP changes.

## Problem

Plugins need to be one product concept even though they contain several
different technical pieces:

```text
plugin package
  app/account connection
  MCP server definitions
  skill instructions
  credential requirements
  runtime requirements
  UI/catalog metadata
```

Users should think "enable GitHub" or "enable Browser Use", not "mount this raw
MCP server, inject this prompt snippet, and attach this credential row".

Agents should receive one resolved session input that says which plugin pieces
are available for this run. AnyHarness should not discover arbitrary plugin
files from disk at session time, and Desktop components should not build final
prompt text.

## Current Implementation

The current implementation keeps MCP connector launch metadata and plugin
package metadata adjacent but separate.

```text
MCP connector catalog entry
  -> concrete MCP server launch/materialization

Plugin package catalog entry
  -> reviewed optional skills for that connector

Installed MCP connection
  -> Desktop plugin package row
  -> optional SessionPluginBundle entry at session launch
  -> AnyHarness plugin launch extension
  -> plugin MCP servers plus proliferate_skills MCP server
```

Implemented now:

- Desktop presents MCP connectors as plugin packages in the Plugins page.
- Server exposes MCP connector entries from `cloud/mcp_catalog/**`.
- Server exposes one plugin package per visible connector from
  `cloud/plugins/catalog/**`.
- First-party skill bodies are file-backed under
  `cloud/plugins/catalog/first_party/**`, not embedded as Python strings.
- Imported/adapted skills carry source repo, source path, source ref, source
  hash, adapted hash, license, review status, reviewer, and review date.
- Enabled applied connector summaries are projected into `SessionPluginBundle`.
- `CreateSessionRequest` and `ResumeSessionRequest` accept `pluginBundle`.
- AnyHarness validates and stores a per-session bundle in
  `PluginBundleRegistry`.
- AnyHarness appends plugin MCP servers to launch MCP bindings.
- AnyHarness injects a compact skill index into session prompt context when
  skills exist.
- AnyHarness mounts the `proliferate_skills` product MCP server for the
  session.
- The skills MCP server supports `list_available_skills`, `activate_skill`,
  and `get_skill_resource`.
- Skill instructions are currently sent inline in `SessionPluginBundle` and
  served from the in-memory bundle registry.
- MCP-only packages are valid. They mount plugin MCP servers and no skills.
- Desktop never creates synthetic "use this connector" skills.
- On create, missing `pluginBundle` means no plugins for that session. On
  resume, missing `pluginBundle` preserves current in-memory bundle state, and
  explicit `{ "plugins": [] }` clears it.

Not implemented in this slice:

- Durable Cloud/team plugin registry.
- Team install policy and per-team plugin catalogs.
- Per-child capability toggles in the UI.
- Target readiness probing for arbitrary plugin runtime requirements.
- Persisting `SessionPluginBundle` as durable session state across process
  restarts.
- Ref-backed skill storage and remote target materialization. This is the
  future Cloud/worker model, not a required change for the current Desktop
  plugin UI slice.
- Versioned plugin package updates and rollback.

## Core Objects

Use these object boundaries consistently.

```text
Plugin package
  durable catalog/config artifact
  versioned
  contains metadata, skill source refs, MCP server definitions, requirements, defaults
  owned by Desktop-local, hosted Cloud, or self-hosted Cloud plugin registry

SessionPluginBundle
  concrete launch/resume snapshot for one AnyHarness session
  contains selected enabled components only
  includes selected skill metadata plus inline instructions or session-scoped refs
  includes selected plugin MCP server definitions
  includes credential binding references
  sent to AnyHarness through the session API contract

Runtime mounted state
  what the live session actually launched with
  owned by AnyHarness session startup and MCP binding assembly
```

The package is product/config state. The bundle is runtime input. Mounted state
is what the live session is actually using.

The long-term model is ref-backed for large or reusable skill bodies:

```text
Skill source store
  canonical skill markdown/resources
  Desktop local package cache, hosted Cloud registry, or self-hosted registry

SessionPluginBundle
  session-scoped allowlist/manifest
  selected skill ids, metadata, hashes, and local/session-scoped refs

AnyHarness runtime
  validates and stores the manifest
  serves only skills allowed by that manifest
```

The current v0 schema supports inline `instructions`. Inline instructions are
acceptable for small/simple skills and early connector-backed plugins. The
target architecture should also support file/ref-backed skill bodies so a
session bundle does not need to carry hundreds of full markdown files.

Existing sessions must not silently change behavior when a plugin package is
updated. New package versions affect new sessions by default. Existing sessions
only change on cold resume or restart with a newly resolved bundle. A bundle
change for an already-live AnyHarness actor is rejected until actor-side MCP
remount support exists.

## Predefined Packages and Catalogs

First-party plugins should be predefined by seeding a package registry, not by
teaching clients special cases.

Current implementation:

```text
server/proliferate/server/cloud/mcp_catalog/catalog.py
  BASE_CONNECTOR_CATALOG
  hard-coded first-party MCP connector entries

server/proliferate/server/cloud/mcp_catalog/domain/types.py
  CatalogEntry
  HttpLaunchTemplate
  ArgTemplate / EnvTemplate
  credential and setting field shapes

server/proliferate/server/cloud/mcp_catalog/api.py
  GET /v1/cloud/mcp/catalog

server/proliferate/server/cloud/plugins/catalog/
  service.py
    produces one PluginPackage per visible connector entry
  models.py
    Pydantic API schemas for plugin package responses
  domain/types.py
    dataclass domain structs for package, skill, provenance
  provenance.py
    file loader and adapted skill hash calculation
  first_party.py
    curated first-party package skill definitions
  first_party/<plugin>/*.md
    reviewed adapted skill instruction files

desktop/src/lib/access/cloud/mcp_catalog.ts
  raw Desktop access to Cloud MCP catalog

desktop/src/lib/workflows/mcp/connector-persistence.ts
  maps Cloud catalog entries and plugin packages to Desktop records
```

Today, predefined "plugins" such as GitHub, Linear, Sheets, or Context7 are
represented by two records:

```text
MCP connector entry
  transport, auth, credential fields, settings, launch template, capabilities

Plugin package entry
  package metadata and optional reviewed skills
```

`CatalogEntry` stays connector-only. Do not add skill bodies, package
components, or product plugin policy to `mcp_catalog/domain/types.py`.

The current API transports plugin package records as a `pluginPackages` sidecar
on MCP catalog and MCP materialization responses because Desktop needs both
records during connector setup and session launch. That is transport
composition, not ownership. The plugin package model, loader, provenance
checks, and first-party skill files live under `cloud/plugins/catalog/**`.

### Skill Eligibility And Safety

First-party skills must be eligible by construction in the current slice. The
server catalog only exposes adapted skill files that are safe for the connector
shape Proliferate mounts today:

- read-only connectors expose read-only skills only;
- write-heavy source skills are either rewritten to require explicit user
  intent before mutation, or they are not included;
- Codex-only paths, connector ids, `$CODEX_HOME`, app ids, restart
  instructions, and unsupported publish/deploy flows are removed;
- MCP-only packages remain valid and expose no placeholder skills.

This is an intentional resolver rule, not a prompt-style suggestion. If a
source skill requires scopes, settings, target capabilities, or writable
credentials that the current Proliferate connector cannot guarantee, that skill
does not appear in the package response for this slice.

The future Cloud package resolver should promote this into explicit eligibility
metadata:

```text
skill_eligibility
  required_settings
  required_oauth_scopes
  required_target_capabilities
  required_credential_grants
  required_policy_flags
```

Until that resolver exists, do not ship a skill that depends on hidden dynamic
eligibility. Prefer MCP-only packages over broad or optimistic skills.

Future Cloud/worker rewrite target:

```text
server/proliferate/server/cloud/plugins/catalog/first_party/
  github/
    plugin.json
    skills/
      review-pr.md
      triage-issue.md
    mcp/
      github.json

  linear/
    plugin.json
    skills/
      triage-issue.md
      update-ticket.md
    mcp/
      linear.json

  google-sheets/
    plugin.json
    skills/
      analyze-sheet.md
      update-report.md
    mcp/
      sheets.json
```

The exact path can change during the Cloud rewrite, but the object model should
not: first-party packages are versioned manifests plus skill source files plus
MCP server definitions. Skills imported from Codex-style skill bundles should
be represented as skill source files in a package or as standalone skill
sources. They should not become global prompt text.

Example target manifest:

```json
{
  "id": "linear",
  "version": "2026.05.13",
  "displayName": "Linear",
  "description": "Read, triage, and update Linear issues.",
  "iconId": "linear",
  "category": "Project management",
  "components": {
    "mcpServers": [
      {
        "id": "linear",
        "definitionRef": "mcp/linear.json",
        "defaultEnabled": true
      }
    ],
    "skills": [
      {
        "id": "linear.triage-issue",
        "sourceRef": "skills/triage-issue.md",
        "displayName": "Triage Linear issue",
        "description": "Use Linear context to understand and route an issue.",
        "requiredMcpServers": ["linear"],
        "defaultEnabled": true
      }
    ]
  },
  "credentials": [
    {
      "id": "linear.oauth",
      "kind": "oauth",
      "requiredBy": ["linear"]
    }
  ],
  "requirements": [
    {
      "id": "network-egress",
      "kind": "network"
    }
  ]
}
```

Plugins are groupings. MCP server definitions and skill sources must remain
addressable independently so the product can support:

- plugin packages that include MCP servers and skills
- plugin packages that include only skills
- plugin packages that include only MCP servers
- one-off user/team MCP servers
- one-off user/team skills

## Durable Storage Model

The current branch does not add a dedicated plugin package database. It uses
file-backed first-party package definitions plus existing connector install
records.

The target durable model should separate package source, installation/config,
reusable MCP/skill definitions, and resolved session state:

```text
plugin_packages
  id
  slug
  owner_scope: first_party | user | team | org | self_hosted
  visibility
  latest_version

plugin_package_versions
  plugin_id
  version
  manifest_json
  created_at

mcp_server_definitions
  id
  owner_scope: first_party | user | team | org | self_hosted
  version
  transport/config_json
  requirements_json
  credential_requirement_ids[]

skill_sources
  id
  owner_scope: first_party | user | team | org | self_hosted
  version
  skill_id
  display_name
  description
  body_ref or body_inline
  content_hash

plugin_package_components
  plugin_version_id
  component_kind: mcp_server | skill
  component_id
  default_enabled

plugin_installations
  plugin_id
  scope: user | team | org | automation
  selected_version_policy
  enabled

plugin_component_settings
  installation_id
  component_kind: mcp_server | skill | requirement
  component_id
  enabled
  enabled_scopes

plugin_credential_bindings
  installation_id
  requirement_id
  credential_ref
  status

standalone_component_settings
  scope: user | team | org | automation
  component_kind: mcp_server | skill
  component_id
  enabled
  enabled_scopes

session_plugin_bundles
  session_id
  resolved_bundle_json
  resolved_at
  resolver_source
```

Cloud/self-hosted deployments should eventually own the durable team/org
package registry. Desktop may own a local package cache for local-only
packages. AnyHarness does not own the durable plugin package DB.

The important modeling point: a plugin package is a grouping of component
definitions, not the only way a skill or MCP server can exist.

## State Terms

These states are separate and should not be collapsed.

- `available`: the plugin exists in a catalog or registry.
- `installed`: the plugin package is available to this user, team, or
  deployment.
- `connected`: the plugin has the required account, token, or local setup.
- `enabled`: the plugin or child capability is selected for a surface or
  session type.
- `ready`: the selected compute target can run the plugin runtime pieces.
- `mounted`: the session launched with that MCP server or skills MCP server.
- `activated`: the agent requested full instructions for one skill through
  `proliferate_skills`.

Examples:

- A plugin can be installed but not enabled.
- A plugin can be connected but not granted to a session.
- A plugin can be enabled but not target-ready.
- A skill can be available but never activated by the agent.

## Contract Shape

The wire boundary lives in AnyHarness contract schemas:

```text
anyharness/crates/anyharness-contract/src/v1/plugins.rs
anyharness/crates/anyharness-contract/src/v1/sessions.rs
```

`SessionPluginBundle` is intentionally explicit:

```text
SessionPluginBundle
  plugins[]

SessionPlugin
  pluginId
  version?
  skills[]
  mcpServers[]
  mcpBindingSummaries[]
  credentialBindings[]

SessionPluginSkill
  skillId
  displayName
  description
  instructions
  resources[]
  requiredMcpServers[]
  credentialBindingIds[]

SessionPluginSkillResource
  resourceId
  displayName?
  contentType
  content

SessionPluginCredentialBinding
  id
  displayName?
  status: ready | missing | needs_reconnect | unsupported_target
```

This is the current v0 wire shape. To support the ref-backed model, evolve
`SessionPluginSkill` without breaking the same boundary:

```text
SessionPluginSkill
  skillId
  displayName
  description
  instructions?       # small/simple inline v0 path
  instructionsRef?    # session-scoped local path or signed artifact ref
  contentHash?
  resources[]
  requiredMcpServers[]
  credentialBindingIds[]
```

AnyHarness must receive either inline content or a session-scoped way to load
content. It must not receive only a global skill id and then discover arbitrary
skills.

`SessionPluginBundle` is accepted by:

```text
CreateSessionRequest.pluginBundle
ResumeSessionRequest.pluginBundle
```

The SDK exposes the same types from:

```text
anyharness/sdk/src/types/sessions.ts
anyharness/sdk/src/index.ts
```

Skill provenance is catalog metadata, not runtime contract metadata. The Cloud
plugin package response exposes source/review fields so Desktop and future
admin surfaces can audit packaged skills. Desktop does not forward provenance
into `SessionPluginBundle`, and AnyHarness does not use provenance when
mounting a session.

Do not add plugin fields directly to ad hoc Desktop-only request payloads when
they affect session runtime behavior. Runtime-affecting plugin data must cross
the `SessionPluginBundle` contract.

## Desktop Ownership

Desktop owns local presentation, local install/connect actions, and local
bundle resolution for local sessions.

```text
desktop/src/pages/PluginsPage.tsx
  route-level page

desktop/src/components/plugins/catalog/
  plugin package list and package cards

desktop/src/components/plugins/detail/
  configure/tools/about modal content

desktop/src/components/plugins/status/
  icons, status chips, overflow actions

desktop/src/components/plugins/fields/
  plugin/account setup fields

desktop/src/hooks/mcp/**
  connector catalog/load/install/toggle/delete/reconnect workflows

desktop/src/lib/domain/plugins/
  pure plugin package projection and session bundle construction

desktop/src/lib/workflows/sessions/session-mcp-launch.ts
  resolves MCP servers and plugin bundle for launch

desktop/src/lib/workflows/sessions/session-runtime.ts
  passes resolved plugin bundle to session create/resume
```

Components render plugin UI. Hooks own React state, modal state, and mutations.
`lib/domain/plugins/**` owns pure projection logic. Session workflows call the
bundle builder and pass the bundle to the AnyHarness SDK.

Components must not:

- construct AnyHarness clients
- call raw endpoint paths
- serialize `SessionPluginBundle` by hand
- build final session prompt text
- decide AnyHarness MCP binding assembly

## Desktop Plugins UI

The top-level Plugins page is plugin-package-first. It should not expose raw
connector internals as the primary model.

Current list layout:

```text
Plugins
  sticky search field

  Installed
    two-column plugin package grid on desktop
    one-column grid on narrow screens

  Available
    two-column plugin package grid on desktop
    one-column grid on narrow screens
```

Package card rules:

- Show icon, package name, one-line description, and a compact action area.
- Do not show capability chips, metadata rows, or "includes" text in the
  catalog card.
- Available packages use a compact plus icon action.
- Installed packages use a compact enabled switch.
- Installed package overflow actions are hidden until hover or focus.
- The whole card opens setup/manage/recovery as appropriate.
- Child capability details belong in the detail modal, not in the catalog card.

Detail modal rules:

- `Configure` owns connection/setup fields and primary setup actions.
- `Tools` lists what Proliferate can do with that plugin in compact divided
  rows.
- `About` owns description, auth label, availability label, and docs link.
- Details can mention app/auth, MCP tools, skills, and runtime requirements as
  children of the package.

The current implementation keeps old `Connector*` component names where they
still wrap connector state, but the user-facing page and view model must treat
each connector as a plugin package.

## User Preference

Plugins are not injected into coding sessions unless the user preference is
enabled.

```text
desktop/src/lib/domain/preferences/user/model.ts
  pluginsInCodingSessionsEnabled

desktop/src/components/settings/panes/GeneralPane.tsx
  "Use plugins in coding sessions"
  "Plugins setup"
```

Launch behavior:

- Coding sessions use plugin bundles only when
  `pluginsInCodingSessionsEnabled` is true.
- Cowork/session surfaces may still resolve MCP launch state according to their
  own policy.
- On create, when the policy is disabled,
  `resolveSessionMcpServersForLaunch` returns no plugin bundle.
- On resume, when the policy is disabled or no connectors apply,
  `resolveSessionMcpServersForLaunch` returns explicit `{ plugins: [] }` so
  AnyHarness clears stale in-memory plugin state. Desktop sends this with an
  MCP refresh so durable MCP summaries are replaced by the user-visible current
  launch state.

## Bundle Resolution Flow

For the current Desktop path:

```text
1. User installs/connects a plugin package in the Plugins UI.
2. Connector catalog state records installed connection metadata.
3. User enables "Use plugins in coding sessions".
4. Session creation asks session launch workflow for MCP launch state.
5. session-mcp-launch.ts materializes cloud/http and local/stdio MCP servers.
6. Cloud materialization also returns plugin package records for the user's
   configured connectors.
7. buildSessionPluginBundle() filters applied MCP binding summaries and matches
   concrete MCP servers by `connectionId` only.
8. Each applied summary with a concrete server becomes one runtime plugin entry:
     pluginId = connector.<connectionId>
     version = package version or local
     mcpServers = matching session MCP servers
     mcpBindingSummaries = applied summary
     credentialBindings = ready binding for that connection
     skills = selected reviewed package skills, if any
9. Skill `requiredMcpServerRefs` are rewritten by Desktop to concrete mounted
   MCP `serverName` values before the bundle is sent to AnyHarness.
10. Session create/resume sends pluginBundle to AnyHarness.
```

Current Cloud MCP materialization path:

```text
server/proliferate/server/cloud/mcp_materialization/service.py
  materialize_cloud_mcp_servers()
  reads enabled user MCP connections
  returns concrete SessionMcpServer payloads, summaries, stdio candidates,
  plugin package records, and warnings

server/proliferate/server/cloud/mcp_materialization/record_materialization.py
  materialize_record()
  resolves one configured connection against target_location

server/proliferate/server/cloud/mcp_materialization/http_launch.py
  renders HTTP MCP server launch payloads

server/proliferate/server/cloud/mcp_materialization/stdio_launch.py
  renders local stdio candidates

desktop/src/lib/access/cloud/mcp_materialization.ts
  raw Desktop access to materialization endpoint

desktop/src/lib/workflows/sessions/session-mcp-launch.ts
  calls Cloud materialization
  finalizes local stdio candidates
  returns mcpServers, mcpBindingSummaries, warnings, and pluginBundle
```

Current bundle builder:

```text
desktop/src/lib/domain/plugins/session-plugin-bundle.ts
```

Current projection helper:

```text
desktop/src/lib/domain/plugins/plugin-package-view-model.ts
```

The current local connector bridge must not create default or synthetic skills.
Skills enter sessions only from reviewed package skill files in the package
catalog or from a future user/team skill source.

Future resolver ownership:

```text
Plugin/session resolver
  inputs:
    selected plugin packages
    standalone selected MCP servers
    standalone selected skills
    user/team/automation policy
    credential binding state
    target readiness
    session surface: coding | cowork | automation | slack | api

  outputs:
    concrete SessionMcpServer definitions
    SessionMcpBindingSummary rows
    selected skill metadata and inline/ref-backed content
    credential binding refs/status
    warnings for blocked/degraded components
    SessionPluginBundle
```

Possible target file placement after the Cloud rewrite:

```text
server/proliferate/server/cloud/plugins/
  catalog/
    service.py              # package catalog read API
    seed.py                 # first-party package seed/load
    models.py               # package manifest API models

  install/
    service.py              # install/enable package for user/team/org
    models.py

  resolver/
    service.py              # package + standalone component -> SessionPluginBundle
    mcp_resolution.py       # MCP server definition -> SessionMcpServer
    skill_resolution.py     # skill source -> inline/ref-backed session skill
    credential_resolution.py
    readiness.py

  materialization/
    service.py              # remote skill/artifact materialization contract
```

Desktop should keep local-only resolution in:

```text
desktop/src/lib/domain/plugins/
  package-manifest.ts       # target shape for local manifests
  session-plugin-bundle.ts  # local package/component -> SessionPluginBundle
  skill-source.ts           # local skill source metadata/ref helper

desktop/src/lib/workflows/sessions/session-mcp-launch.ts
  session-facing orchestration only
```

For the future target file/ref-backed path:

```text
Desktop local session
  Desktop has local plugin/skill cache
  Desktop resolves selected skills
  Desktop sends skill metadata + local refs/hashes in SessionPluginBundle
  AnyHarness reads allowed refs lazily through proliferate_skills

Cloud or remote target session, after the Cloud/worker rewrite exists
  Cloud has plugin registry and selected skill source
  Cloud resolves selected skills and creates SessionPluginBundle
  worker receives command
  worker materializes missing selected skill artifacts into target cache
  worker calls AnyHarness with refs to materialized files
  AnyHarness reads allowed refs lazily through proliferate_skills
```

In that future path, the worker materializes selected artifacts. It does not
decide which skills are allowed.

Resolution rule:

```text
Product resolver decides what is selected and allowed.
Worker/materializer ensures selected artifacts exist on the target.
AnyHarness serves only selected artifacts listed in the session bundle.
```

## AnyHarness Ownership

AnyHarness owns validation, live session registration, MCP launch assembly, and
the skills MCP server.

```text
anyharness/crates/anyharness-lib/src/domains/plugins/
  mod.rs
  registry.rs
  validation.rs
  session_extension.rs
  skills.rs
  mcp/
    auth.rs
    definition.rs
    mod.rs
    tools.rs
```

Responsibilities:

- `validation.rs` validates bundle shape before launch/resume.
- `registry.rs` stores process-local session bundle snapshots by session id.
- `session_extension.rs` turns a registered bundle into session launch extras.
- `skills.rs` renders the compact skill index and implements skill lookup.
- `mcp/**` exposes the `proliferate_skills` product MCP server.

The bundle registry is currently process-local. It is enough for launch-time
runtime assembly but is not a durable plugin package store. If exact plugin
bundle replay across AnyHarness process restarts becomes required, persist the
resolved bundle or reconstruct it explicitly at resume.

Target responsibility for ref-backed skills:

```text
SkillContentStore / SkillLoader
  loads only skill refs present in the session bundle
  verifies content hash when provided
  rejects refs outside the session/package cache
  returns full instructions/resources to proliferate_skills
```

This loader should be an AnyHarness runtime helper. It should not scan global
skill folders or infer access from files that happen to exist on disk.

## AnyHarness Launch Flow

Create session:

```text
api/http/sessions.rs
  parses CreateSessionRequest.pluginBundle

sessions/runtime/creation.rs
  validate_session_plugin_bundle()
  create durable session row
  PluginBundleRegistry.set_session_bundle(session_id, bundle)
  start persisted session
  clear bundle if start fails

sessions/mcp_bindings/assembly.rs
  resolves normal user MCP bindings
  resolves product MCP launch catalog
  resolves session extensions
  merges plugin MCP servers and summaries
```

Resume session:

```text
api/http/sessions.rs
  parses ResumeSessionRequest.pluginBundle
  rejects pluginBundle changes when the session actor is already live
  SessionRuntime.set_session_plugin_bundle()
  ensure_live_session()
```

Resume plugin bundles are a cold-start/restart input. If a live actor already
exists, AnyHarness returns `409 SESSION_RESTART_REQUIRED` for any
`pluginBundle` field instead of mutating `PluginBundleRegistry` behind a running
session. Missing `pluginBundle` preserves the current in-memory bundle.

App wiring:

```text
app/mod.rs
  creates PluginBundleRegistry
  creates SkillsMcpAuth
  creates PluginSessionLaunchExtension
  adds extension to session_extensions
  passes registry to SessionRuntime
```

MCP server assembly:

```text
PluginSessionLaunchExtension.resolve_launch_extras()
  for each plugin:
    append plugin.mcpServers
    append plugin.mcpBindingSummaries
  if bundle has skills:
    append compact skill index to system prompt context
    mount proliferate_skills MCP server
```

The session actor should receive already-assembled launch MCP servers and
prompt append text. It should not discover plugins or interpret plugin package
policy.

## Skills Runtime

Skills are package-provided instructions that the agent can activate only when
they are relevant.

Prompt injection is intentionally small:

```text
Proliferate session skills are available through proliferate_skills.
Use list_available_skills and activate_skill before relying on full instructions.
Available skills:
- skill id, display name, description
```

Full instructions are not dumped into the session prompt by default. The agent
loads them through the mounted skills MCP server.

Current v0 behavior:

```text
activate_skill(skillId)
  reads full instructions from the in-memory SessionPluginBundle
```

Target ref-backed behavior:

```text
activate_skill(skillId)
  checks the session bundle allowlist
  loads the allowed file/ref through SkillContentStore
  returns full instructions
```

Skills MCP tools:

```text
list_available_skills
  returns skill ids, names, descriptions, required MCP servers,
  credential binding ids, and resource counts

activate_skill
  returns one skill's full instructions and resource handles

get_skill_resource
  returns one inline resource attached to a skill
```

The skills MCP server is a product MCP. It is routed through the same product
MCP infrastructure as other AnyHarness product MCPs and uses a session-scoped
capability token.

## Plugin MCP Servers

A plugin MCP server is an MCP server selected by a plugin package.

The bundle carries concrete `SessionMcpServer` definitions. AnyHarness converts
those contract definitions to runtime MCP binding models through the existing
session MCP binding conversion path.

Rules:

- Plugin MCP servers are mounted like normal session MCP servers.
- Plugin MCP binding summaries are merged into the session's visible binding
  summaries.
- Product behavior still belongs in the owning product domain.
- Shared MCP protocol scaffolding belongs in AnyHarness MCP integrations and
  product MCP server infrastructure.
- The plugin package selects and configures capabilities; it should not become
  a dumping ground for unrelated product business logic.

Concrete MCP placement:

```text
Package/catalog layer
  stores MCP server definitions:
    id
    display name
    transport: http | stdio
    launch template
    credential requirements
    runtime requirements

Installation/config layer
  stores whether this user/team/automation enabled that MCP server
  stores settings and credential binding refs

Resolver/materialization layer
  turns definition + settings + credential refs + target into:
    SessionMcpServer
    SessionMcpBindingSummary
    warnings

SessionPluginBundle
  carries selected plugin-owned SessionMcpServer definitions and summaries

AnyHarness launch assembly
  converts contract SessionMcpServer into runtime MCP binding models
  appends them to normal session MCP servers
  dedupes launch servers by transport/connection/server name

Session actor
  receives final assembled MCP server list
  does not know which package selected them
```

Current AnyHarness files:

```text
anyharness/crates/anyharness-contract/src/v1/sessions.rs
  SessionMcpServer wire schema

anyharness/crates/anyharness-lib/src/sessions/mcp_bindings/contract.rs
  converts contract MCP servers to runtime binding models

anyharness/crates/anyharness-lib/src/domains/plugins/session_extension.rs
  appends plugin-owned MCP servers and summaries

anyharness/crates/anyharness-lib/src/sessions/mcp_bindings/assembly.rs
  merges user MCP bindings, product MCP launch catalog, and session extensions
```

Current Desktop/server files:

```text
server/proliferate/server/cloud/mcp_catalog/catalog.py
  predefined MCP connector definitions

server/proliferate/server/cloud/plugins/catalog/first_party.py
  predefined package skill definitions and provenance

server/proliferate/server/cloud/mcp_materialization/service.py
  configured connector -> concrete session MCP payloads plus package records

desktop/src/lib/workflows/sessions/session-mcp-launch.ts
  launch-time MCP resolution orchestration

desktop/src/lib/domain/plugins/session-plugin-bundle.ts
  wraps applied MCP results into current plugin bundle entries
```

## Credential Bindings

Plugins declare credential requirements. Resolvers select credential bindings.

`SessionPluginBundle` may carry credential binding references and readiness
status. In the current v0 shape it also embeds concrete `SessionMcpServer`
launch definitions inside each selected plugin entry. HTTP server definitions
can contain secret-bearing headers after Cloud materialization, so the bundle is
secret-bearing launch input even though plugin package catalog files are not.

Do not log `SessionPluginBundle` payloads, persist them as plaintext, expose
them in UI/debug surfaces, or treat them as durable package metadata. The
long-term ref-backed model should replace embedded secret-bearing launch data
with session-scoped credential grants or references where possible.

Allowed:

- credential binding ids
- display names
- readiness status
- session-scoped grants
- narrow resource scope
- short expiry where available
- audit references with grant ids

Not allowed:

- broad team tokens in plugin package files
- long-lived secrets in plugin manifests
- target-wide environment variables for unrelated processes
- secrets in prompt text
- raw secret values in skill resources

## Runtime Requirements

Plugin packages should declare target requirements explicitly.

Examples:

- Node/npm/npx/pnpm
- Python/uv
- Docker
- managed binary
- browser/display server
- sidecar process
- filesystem access
- network egress
- credential injection support

This spec defines how requirements are represented as part of plugin package
and bundle resolution. It does not define target enrollment or worker
inventory. A Cloud or Desktop resolver may use target readiness as an input
when deciding whether a plugin is ready for a session.

For future remote/cloud targets, worker materialization is part of runtime
readiness:

```text
Cloud-resolved session bundle
  selected skill refs and hashes

worker on target
  checks target cache
  fetches missing selected skill artifacts using session-scoped access
  writes them into the target package/skill cache
  calls AnyHarness only after required artifacts are present
```

Local Desktop sessions normally do not need this step because the selected
local package cache already exists on the machine running AnyHarness. The
current branch does not implement the Cloud/worker materialization path.

## Cloud and Team Sessions

When the Cloud/worker rewrite lands, Cloud and self-hosted deployments should
use the same product boundary:

```text
plugin package registry
  -> resolver applies user/team/automation policy
  -> resolver creates SessionPluginBundle
  -> AnyHarness receives bundle through create/resume session API
```

Cloud may own durable team plugin install state, org policy, credential grants,
and package versions. It should not bypass the bundle boundary by teaching a
future worker or client to mutate AnyHarness plugin internals directly.

Web, mobile, Slack, automations, and developer API should all resolve plugin
intent into the same `SessionPluginBundle` shape before the target AnyHarness
session starts or resumes.

## File Structure Rules

Desktop:

```text
components/plugins/catalog/
  package list, search sections, card rows

components/plugins/detail/
  package configuration and child capability detail

components/plugins/status/
  icon, status chip, overflow menu

components/plugins/fields/
  connection/setup input fields

lib/domain/plugins/
  pure package presentation and bundle construction

lib/workflows/sessions/
  session launch orchestration that calls bundle construction
```

AnyHarness:

```text
domains/plugins/validation.rs
  contract validation only

domains/plugins/registry.rs
  session id -> SessionPluginBundle runtime registry / allowlist

domains/plugins/session_extension.rs
  SessionExtension implementation that contributes launch extras

domains/plugins/skills.rs
  pure skill index/list/activate/resource logic

domains/plugins/content_store.rs        # target shape, not implemented yet
  session-scoped skill file/ref loading and hash verification

domains/plugins/mcp/
  product MCP definition, auth, tools, and request dispatch
```

Contract and SDK:

```text
anyharness-contract/src/v1/plugins.rs
  wire schema

anyharness-contract/src/v1/sessions.rs
  create/resume request fields

anyharness/sdk/src/types/sessions.ts
  generated/exported client types
```

Do not add a parallel plugin package implementation in session actor code,
Desktop components, Cloud sync code, or worker code.

## Adding a Plugin

For the current connector-backed implementation, adding a plugin usually means
adding or updating the connector catalog entry and ensuring the installed
connector can produce applied MCP binding summaries.

For the target package-registry implementation, adding a plugin should include:

- package manifest
- display metadata and category
- skill markdown files
- MCP server definitions if any
- credential requirement declarations
- runtime requirement declarations
- default enablement policy
- package validation tests
- bundle resolution tests
- UI list/detail coverage for package rows and child capability rows

If the plugin introduces product behavior, put that behavior in the owning
product domain and expose it through MCP or session extension boundaries.

## Invariants

- Plugin package is durable product/config state.
- `SessionPluginBundle` is the resolved launch/resume snapshot.
- Skill markdown source lives in package source stores or package caches, not
  arbitrary runtime disk discovery.
- v0 may carry inline skill instructions; the target path should support
  session-scoped refs/hashes for larger skill sets.
- AnyHarness validates the bundle before using it.
- AnyHarness stores a session-scoped runtime bundle and turns it into launch
  extras through `PluginSessionLaunchExtension`.
- AnyHarness injects only a compact skill index into prompt context.
- Full skill instructions are served through `proliferate_skills`.
- `proliferate_skills` may read from inline bundle content today and from an
  allowlisted content store later.
- UI is plugin-package-first, with auth, MCP servers, skills, and requirements
  as package children.
- Installed, connected, enabled, ready, mounted, and activated are separate
  states.
- Components do not build prompt text or call raw access clients.
- Existing sessions do not silently change behavior when a plugin package is
  updated.
