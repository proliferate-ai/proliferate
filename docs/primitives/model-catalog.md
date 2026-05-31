# Model Catalog And Dynamic Registries

Status: reference architecture for product model catalogs, target-discovered
model registries, model visibility, and launch-time model resolution.

Scope:

- Cloud catalog and default model selection for desktop, web, mobile, Slack,
  automations, and API surfaces
- AnyHarness target-side model discovery for dynamic harnesses such as Cursor
  and OpenCode
- Worker sync of target-discovered model registries to Cloud
- Desktop and Cloud UI model picker/default behavior
- Launch-time resolution of saved model intent against target capability

Related docs:

- `docs/primitives/agent-catalog-readiness.md`
- `docs/primitives/cloud-commands.md`
- `docs/structures/frontend/README.md`
- `docs/structures/server/README.md`

## Target File Hierarchy

Use this hierarchy for the full implementation. Do not scatter model registry
logic through existing picker, target, readiness, or catalog files without
these ownership boundaries.

```text
catalogs/agents/v1/
  catalog.json
    Cloud/desktop/AnyHarness seed catalog. Curated support/default metadata.
    Not rewritten by runtime discovery.

  schema.json
    Static catalog schema. Add only fields that belong in curated catalog data,
    not target-discovered runtime facts.

docs/primitives/
  model-catalog-and-dynamic-registries.md
    Cross-product architecture for catalog, live registry, sync, visibility,
    and launch resolution.

docs/primitives/
  agent-catalog-readiness.md
    AnyHarness catalog/readiness migration rules. Links here for dynamic model
    registry snapshots.

anyharness/crates/anyharness-contract/src/v1/
  agents.rs or model_registry.rs
    Public request/response structs only if the refresh/read endpoints need new
    wire types. Keep generated SDK compatibility in mind.

anyharness/crates/anyharness-lib/src/api/http/
  agents.rs
    Existing or new thin HTTP handlers for launch options and model registry
    refresh/read endpoints.

anyharness/crates/anyharness-lib/src/domains/agents/
  catalog/
    bundled.rs
    schema.rs
    validation.rs
    projection/
      descriptors.rs
      models.rs

  model_registry/
    mod.rs
    model.rs
    store.rs or store/
    service.rs
    refresh.rs
    resolution.rs
    projection.rs
    visibility.rs
    tests/

  readiness/
    launch_options.rs
    resolver.rs

anyharness/crates/anyharness-lib/src/integrations/agent_cli/
  model_discovery.rs
    Run and parse Cursor/OpenCode model discovery commands.

anyharness/crates/anyharness-lib/src/persistence/sql/
  00xx_agent_model_registry_snapshots.sql
    SQLite migration for target-local dynamic model registry snapshots.

anyharness/sdk/
  generated code only
    Regenerate if contract endpoints change. Do not hand-edit generated output.

apps/desktop/src/lib/access/
  anyharness/agents.ts or existing AnyHarness access module
    Raw calls to AnyHarness launch options and model registry refresh/read.

  cloud/model-registries.ts
    Raw calls to Cloud synced registry projections if a first-class Cloud API is
    added.

apps/desktop/src/lib/domain/chat/models/
  model-display.ts
  model-selection.ts
  model-visibility.ts
  model-registry.ts
    Pure model descriptor merge, display fallback, visibility, and picker list
    logic. No network calls.

apps/desktop/src/lib/domain/settings/
  agent-defaults.ts
  model-registries.ts
    Pure settings/default-model view-model logic.

apps/desktop/src/hooks/
  chat/derived/use-chat-launch-catalog.ts
  settings/workflows/use-model-registry-settings.ts
    Query/mutation wiring and UI orchestration.

apps/desktop/src/components/settings/
  panes/AgentDefaultsPane.tsx
  panes/ModelRegistryPane.tsx
    Render settings and per-model visibility controls only.

server/proliferate/server/cloud/
  targets/
    models.py
    service.py
    domain/readiness.py
      Target snapshot/readiness should include last synced registry summary.

  projections/
    models.py
    service.py
    domain/target.py
      Projection application for target model registry summary.

  model_registries/          # promote here when it has first-class APIs
    api.py
    models.py
    service.py
    domain/
      visibility.py
      resolution.py

server/proliferate/db/models/
  cloud_model_registries.py  # promote when first-class persistence is needed

server/proliferate/db/store/cloud_sync/
  model_registries.py        # store synced user/target registry snapshots

anyharness/crates/proliferate-worker/src/
  inventory/providers.rs
    Include dynamic model registry freshness/status in target inventory when
    needed.

  commands/dispatcher.rs
    Dispatch Cloud-triggered refresh-model-registry commands to local
    AnyHarness.

  sync/mapper.rs
    Map AnyHarness registry snapshots into Cloud projection payloads.

scripts/
  inspect-opencode-models.mjs
    Local investigation helper for OpenCode live model output.

  inspect-cursor-models.mjs
    Optional matching helper if Cursor investigation is repeated often.
```

## Goal

The product needs two things at once:

```text
Cloud product catalog
  Lets Proliferate render model defaults, launch forms, automations, Slack
  setup, and team defaults without requiring every target to be online.

Target-discovered model registries
  Let Proliferate know what a specific AnyHarness target can actually launch,
  especially for model-agnostic harnesses whose available models change by
  account, config, provider, or CLI version.
```

The architecture must support both without making Cloud pretend to know exact
target capability and without making AnyHarness own org/team product policy.

## Core Invariant

Use this split everywhere:

```text
Catalog:
  what Proliferate recommends and can render optimistically

Cloud saved intent:
  what a user, team, automation, Slack thread, or API caller wants to run

AnyHarness model registry:
  what a specific target currently appears able to run

Launch resolution:
  whether saved intent can become an exact harness launch on that target
```

Do not collapse these into one data source.

## Truth Sources

### Cloud Product Catalog

Cloud owns the product catalog used for UI defaults and product setup.

It may be backed by the same `catalogs/agents/v1/catalog.json` schema family,
or by a Cloud-hosted version of that catalog.

It answers:

```text
Which agent families should Proliferate show?
Which models should be recommended by default?
What display names, tags, aliases, and descriptions should product UI prefer?
Which models should be default-visible?
Which harnesses support dynamic model discovery?
```

It does not answer:

```text
Can Pablo's local Cursor install run this exact model right now?
Did this SSH target's OpenCode config add a custom model?
Did a provider whitelist/blacklist remove this model on this target?
Which exact live ACP model id is active in an already-running session?
```

### AnyHarness Bundled Catalog

AnyHarness ships with a bundled target-support catalog.

It answers:

```text
Which harnesses does this runtime know how to install, authenticate, and
launch?
What are fallback model defaults if no dynamic model registry exists?
What trusted executable/install metadata may this target use?
```

The bundled catalog must not be rewritten at runtime. Runtime refresh creates
model registry snapshots, not a mutated catalog file.

### AnyHarness Model Registry Snapshot

AnyHarness owns target-side dynamic model discovery.

It answers:

```text
For this target/workspace/account, what models did Cursor/OpenCode report?
When was the registry refreshed?
Which exact live ids should be passed to the harness at launch?
Which discovered models match curated catalog entries or aliases?
Which discovered models are unknown but available?
```

Snapshots are target-scoped and may also be workspace-scoped when the harness
model list depends on workspace config.

### Cloud Synced Registry Projection

Cloud may store a synced copy of AnyHarness registry snapshots.

It answers:

```text
What local/SSH/managed target models were last reported for this user/team?
What should web/mobile/Slack show for target-specific setup?
What model choices can a user select for personal automations when the target
is offline?
```

It is a useful product projection. It is not final execution truth.

### Live ACP Session Config

Live session config remains separate.

It answers:

```text
What model/config did the already-running ACP session report?
Which model is active right now?
Which runtime config changes were accepted by the live session?
```

Do not use catalog or registry snapshots as active-session truth after the
session has started and reported live config.

## Harness Classes

### Static Or Narrow Harnesses

Examples:

```text
claude
codex
gemini
```

Default behavior:

```text
supportsDynamicModelRegistry = false
model options come from Cloud/catalog and AnyHarness bundled catalog
launch validates through normal AnyHarness readiness/session creation
```

Do not add dynamic refresh UI for these until a reliable provider-specific
listing mechanism exists and the product needs it.

### Dynamic Or Model-Agnostic Harnesses

Examples:

```text
cursor
opencode
future litellm/openrouter/local-model harnesses
```

Default behavior:

```text
supportsDynamicModelRegistry = true
catalog is curated seed/enrichment metadata
live registry refresh is target-side truth
settings may show all discovered models
picker shows default/user-visible subset
launch validates against the current target registry
```

Cursor and OpenCode should use the same product concept even if their discovery
commands differ.

## Model Descriptor Shape

Use one model descriptor shape across catalog entries, dynamic snapshots, and
effective UI registries where possible.

```text
id
  Proliferate model key. For dynamic harnesses this should usually equal the
  exact live id unless the entry is a curated alias.

liveId
  Exact model id to pass to the harness. Required for live-discovered dynamic
  models when it differs from id.

displayName
  User-facing label. Prefer harness-provided names for live-discovered Cursor
  and OpenCode models, then catalog metadata, then generated fallback.

description
  Optional product description.

provider
  Provider or harness namespace when available.

aliases
  Legacy ids, previous catalog ids, shorthand ids, or vendor aliases.

status
  active | deprecated | hidden | unknown

tags
  recommended, fast, frontier, long-context, local, experimental, etc.

defaultOptIn
  Product default for whether the model appears in normal model pickers when
  the user has no explicit override. Defaults to false for unknown live-only
  models.

  `true` and `false` are explicit product policy. An absent or `null`
  `defaultOptIn` is a compatibility state only: clients may derive legacy
  defaults from `modelDisplayPolicy.defaultVisibleModelIds`, `isDefault`, or a
  `recommended` tag. New catalog rows should set `defaultOptIn` explicitly.

capabilities
  image/audio/context/tool support where known.

compatibility
  Optional runtime/platform/account restrictions.

source
  catalog | live | live+catalog

lastSeenAt
  Present for live-discovered models.

discoverySource
  cursor-agent models, opencode models, ACP metadata, or other provider source.
```

Rules:

- `liveId` is what launch passes to the harness.
- `displayName` is what UI shows.
- `aliases` are for resolution and migration, not for rendering.
- Unknown live models are allowed. They should be marked `source = live` and
  usually have `defaultOptIn = false` unless product policy decides otherwise.
- Provider refresh output should leave `defaultOptIn` absent/null unless the
  provider itself supplies a trustworthy visibility policy. Projection then
  reapplies bundled catalog policy by id or alias and only defaults truly
  live-only rows to hidden.
- Catalog-only models may still be shown in Cloud/global setup, but target
  launch must validate them.

## Visibility Model

Visibility is not capability.

Use separate concepts:

```text
available
  The model exists in the catalog or was discovered from a target.

defaultVisible
  Legacy term. Prefer `defaultOptIn` in new code/specs.

userVisible
  Legacy term. Prefer explicit user visibility override: opt_in or opt_out.

launchable
  Target resolution says the model can be launched right now.
```

Effective picker rule:

```text
visible = user override when present,
          otherwise explicit model.defaultOptIn,
          otherwise legacy fallback for old catalog rows
```

Truth table:

```text
defaultOptIn  user override  visible
true          none           yes
true          opt_out        no
true          opt_in         yes
false         none           no
false         opt_out        no
false         opt_in         yes
absent/null   none           legacy fallback only
```

The current/previous selected model may be shown with a stale/missing warning
even when the visibility rule would otherwise hide it, so users can understand
and repair old selections.

Picker and settings surfaces must never produce an empty visible model set for
a harness that has available models. If the visibility rule hides everything,
fall back to the stored/default/isDefault/first model in that order and prevent
the user from hiding the final visible model. When a user hides the current
default model in Agent Defaults, immediately move that harness default to the
next visible model.

Agent Defaults is the main management surface:

```text
Agent Defaults
  Claude
    default model selector
    visible model toggles

  Cursor
    default model selector
    [Refresh models]
    search models
    visible model toggles across recommended and all discovered models

  OpenCode
    default model selector
    [Refresh models]
    search models
    visible model toggles grouped by provider/source when useful
```

Each harness should be an expandable section. The normal model picker remains
compact and only uses the effective visible model list.

Agent Defaults also owns local harness readiness repair for launch defaults:
managed install state, provider CLI login, credential discovery, and dynamic
model refresh. Agent Authentication remains the stored/synced/shared
credential surface for cloud and team flows.

Catalog `auth.login` commands are provider guidance, not shell instructions for
the user. Runtime login command resolution must prefer managed native,
registry binary, and registry npm executables before falling back to global
`PATH`, and PATH fallback is allowed only when the executable is resolvable.

Home launch defaults, automation defaults, Slack defaults, and other
cloud-mediated launch pickers must consume the same effective visible model
list. Existing saved or active selections may be preserved for repair, but new
default resolution should not choose a hidden model.

## Saved Model Intent

Cloud, desktop, Slack, automations, and API surfaces should save model choices
as intent, not as guaranteed execution.

```text
ModelIntent
  harnessKind
  modelKey
  liveId nullable
  displayNameAtSelection
  source nullable
  targetId nullable
  registrySnapshotId nullable
  fallbackPolicy: use-default | closest-compatible | fail
```

User-facing automation, Slack, and team defaults do not need to expose
`source`, `targetId`, or `registrySnapshotId` in V1. They can select from the
latest Cloud-effective model list, which merges product catalog models and the
most recently synced dynamic model registries available to that user/team.

Cloud may still store source/snapshot metadata internally for diagnostics,
staleness warnings, and launch preflight.

## Launch Resolution

Launch resolution happens at the AnyHarness/target boundary.

```text
ResolveModelIntent(target, intent):
  1. Load latest model registry snapshot for harness and scope.
  2. If dynamic registry is stale and target is online, refresh if policy allows.
     If current V1 launch path cannot refresh synchronously, fail with an
     actionable stale/unavailable registry error.
  3. Do not silently fall back to bundled catalog truth when a dynamic
     Cursor/OpenCode snapshot exists but is stale, empty, or failed.
  4. Match exact liveId.
  5. Match modelKey against discovered ids.
  6. Match modelKey against catalog aliases.
  7. Apply fallback policy.
  8. Return exact liveId or fail with actionable error.
```

Resolution outputs:

```text
resolvedLiveId
resolvedDisplayName
resolutionSource: exact | alias | fallback | default
registrySnapshotId
warnings[]
```

Failure should be explicit:

```text
model_not_available_on_target
registry_stale_and_target_offline
target_harness_not_authenticated
target_harness_not_installed
dynamic_registry_refresh_failed
fallback_not_allowed
```

Do not silently swap to a materially different model unless the saved
`fallbackPolicy` allows it.

## Refresh Flow

Dynamic refresh is target-side.

```text
Desktop direct:
  Desktop -> AnyHarness refresh endpoint
  AnyHarness -> harness-specific discovery
  AnyHarness -> SQLite snapshot
  Desktop -> fetch effective launch options

Cloud-mediated:
  Cloud -> command queue
  Worker -> local AnyHarness refresh endpoint
  AnyHarness -> harness-specific discovery
  Worker -> upload registry projection
  Cloud -> store user/target registry snapshot projection
  Web/mobile/Slack -> render synced projection
```

Refresh should run:

- when a dynamic harness is first installed or authenticated
- when a target comes online and the snapshot is missing or stale
- when a user clicks refresh in settings
- before launch if the selected model came from a stale snapshot and the target
  is reachable
- after harness update when model availability may have changed

Do not refresh on every picker open.

Suggested default TTL:

```text
interactive desktop target: 24 hours
managed cloud target: image/version dependent, refresh on first use
SSH/self-hosted target: 24 hours or after worker inventory changes
```

## Harness Discovery Implementations

Discovery mechanics are harness-specific and belong behind provider-specific
adapters.

Cursor:

```text
source command:
  cursor-agent models
  cursor-agent --list-models

parse:
  id - display name

example:
  gpt-5.3-codex - Codex 5.3
  composer-2-fast - Composer 2 Fast
```

Cursor model IDs from live discovery should be preferred over older catalog ids
such as `gpt-5.3-codex[reasoning=medium,fast=false]`. Older ids should become
aliases when possible.

OpenCode:

```text
source command:
  opencode models
  opencode models --verbose
  opencode models --refresh

parse:
  provider/model
  verbose metadata when available

example:
  opencode/big-pickle
  amazon-bedrock/anthropic.claude-sonnet-4-6
```

OpenCode may expose provider config overrides, plugin-mutated models,
provider-level whitelist/blacklist behavior, and models from remote/cached
metadata. Treat the discovered registry as target/config dependent.

Discovery executable resolution:

- use the resolved provider CLI executable for discovery, not the ACP session
  launcher when those differ
- managed npm installs may expose both a generated `*-launcher` and the real
  `node_modules/.bin/...` binary; refresh must run the real provider binary
  that supports `models`
- PATH fallback is allowed only after checking the resolved/managed target
  install
- run commands without shell interpolation
- apply timeouts and cancellation
- capture stdout/stderr in a way that cannot deadlock on large model lists
- strip ANSI output and redact stderr before surfacing user-facing errors

## AnyHarness Placement

Target shape:

```text
anyharness/crates/anyharness-lib/src/api/http/agents_model_registry.rs
  Thin route handlers only:
    GET launch options
    GET model registry snapshot
    POST refresh model registry

anyharness/crates/anyharness-lib/src/domains/agents/
  catalog/
    mod.rs
    bundled.rs
      Reads bundled `catalogs/agents/v1/catalog.json`.

    schema.rs
      Static catalog structs only. Do not add target-discovered fields here
      unless they are also valid curated catalog fields.

    validation.rs
      Validates catalog invariants.

    projection/
      descriptors.rs
        Trusted catalog -> install/launch descriptors.

      models.rs
        Trusted catalog -> fallback model metadata.

  model_registry/
    mod.rs
      Public module surface. Re-export intentional types/functions only.

    model.rs
      ModelRegistrySnapshot, ModelRegistryModel, ModelIntent,
      ModelResolution, RegistryScope, RefreshStatus.

    store.rs or store/
      SQL for `agent_model_registry_snapshots`.
      No vendor process execution. No catalog parsing.

    service.rs
      Reads catalog projection + latest snapshot, computes effective registry,
      stale state, and launch-option model list.

    refresh.rs
      Target-side workflow:
        choose harness discovery implementation
        run discovery
        normalize discovered models
        persist snapshot
        return refresh result

    resolution.rs
      ModelIntent -> exact liveId.
      Handles exact, alias, stale snapshot, fallback, and error cases.

    projection.rs
      Effective registry -> API/internal launch option structs.

    visibility.rs
      Default-visible and user-visible filtering helpers. Pure logic only.

    tests/
      Unit tests for merge, stale handling, visibility, and resolution.

  readiness/
    launch_options.rs
      Includes effective model registry in launch-option responses.

    resolver.rs
      Still owns install/auth/readiness status. It does not run model refresh.

anyharness/crates/anyharness-lib/src/integrations/agent_cli/
  model_discovery.rs
    Run and parse `cursor-agent models`, `opencode models`, and related
    provider commands. Return neutral discovered model records.

anyharness/crates/anyharness-lib/src/persistence/sql/
  00xx_agent_model_registry_snapshots.sql
    Creates the snapshot table. Domain store owns SQL access after migration.
```

`model_registry/` owns the product workflow and persistence. `integrations/`
owns vendor command mechanics.

AnyHarness API endpoints should be thin wrappers:

```text
GET  /v1/agents/launch-options?workspace_id=...
POST /v1/agents/{agent_kind}/model-registry/refresh
GET  /v1/agents/{agent_kind}/model-registry?workspace_id=...
```

Exact route names may follow existing API conventions. Do not create duplicate
behavior in API handlers.

Suggested SQLite table:

```text
agent_model_registry_snapshots
  id TEXT PRIMARY KEY
  agent_kind TEXT NOT NULL
  scope_kind TEXT NOT NULL       -- global | workspace | repo_root
  scope_id TEXT NULL
  catalog_version TEXT NULL
  discovery_source TEXT NOT NULL -- cursor-agent models, opencode models, etc.
  models_json TEXT NOT NULL
  refreshed_at TEXT NOT NULL
  expires_at TEXT NULL
  error_json TEXT NULL
  UNIQUE(agent_kind, scope_kind, scope_id)
```

Use SQLite for target-local snapshots. Do not write runtime-discovered models
back into `catalogs/agents/v1/catalog.json`.

## Contract And SDK Placement

Add contract types only if current contract surfaces cannot represent the
registry responses cleanly.

```text
anyharness/crates/anyharness-contract/src/v1/
  agents.rs
    Preferred if launch options already live there.

  model_registry.rs
    Use only if model registry wire types become large enough to deserve their
    own file.

anyharness/sdk/
  generated SDK output
    Regenerate from contract/OpenAPI. Do not hand-edit generated files.

anyharness/sdk-react/
  no model-selection business logic
    React SDK may expose generated query hooks if that is the SDK pattern, but
    product visibility/default behavior belongs in desktop/cloud frontend
    domain code.
```

Wire types should expose model registry facts, not product policy decisions
that belong to Cloud or Desktop settings.

## Cloud Placement

Cloud stores product defaults and synced projections.

Suggested server ownership:

```text
server/proliferate/server/cloud/targets/
  models.py
    Target snapshot schemas should include registry freshness and summary
    counts when useful: dynamic harnesses present, last refreshed, stale.

  service.py
    Target detail reads may join or embed latest registry summary.

  domain/readiness.py
    Pure target-readiness verdicts may consider whether a selected ModelIntent
    has a compatible synced registry projection.

server/proliferate/server/cloud/projections/
  models.py
    Projection response schemas for target/session/workspace snapshots.

  service.py
    Applies worker-uploaded target inventory/registry projection events.

  domain/target.py
    Target projection includes registry summary, not full model list unless
    the specific endpoint needs it.

server/proliferate/server/cloud/model_registries/  # optional if it grows
  api.py
    User/team reads for synced target registries and visibility preferences.

  models.py
    Request/response schemas for registry reads, visibility changes, and saved
    ModelIntent values.

  service.py
    Auth, target access checks, snapshot reads, preference writes.

  domain/
    visibility.py
      Pure default/user/team visibility merge.

    resolution.py
      Cloud-side preflight only. Final resolution remains AnyHarness-side.

server/proliferate/db/models/
  cloud_model_registries.py
    CloudUserModelRegistrySnapshot, CloudModelVisibilityPreference if promoted
    to first-class tables.

server/proliferate/db/store/cloud_sync/
  model_registries.py
    Store functions for synced snapshots and visibility preferences.
```

Start inside `targets` or `projections` if the implementation is small. Promote
`model_registries/` when it gains its own API/service/store lifecycle.

Cloud durable records:

```text
global_model_catalog
  product catalog version, catalog models, defaultOptIn metadata

user_model_registry_snapshots
  user_id
  org_id nullable
  target_id
  agent_kind
  registry_snapshot_id
  models_json
  refreshed_at
  synced_at
  stale_after

model_visibility_preferences
  owner_scope: user | team | org
  owner_id
  agent_kind
  model_key
  override: opt_in | opt_out
```

Cloud may remember where a discovered model came from:

```text
global catalog
Pablo's local Cursor target
team SSH target
managed cloud target pool
OpenCode on workspace config X
```

That provenance is useful for diagnostics and preflight. V1 automation, Slack,
and team-default UI should not force users to choose a source/target for model
visibility; it should use the latest Cloud-effective model list.

## Worker Sync Placement

Worker moves target-discovered registry facts from AnyHarness to Cloud. It does
not parse Cursor/OpenCode model commands directly and does not decide
visibility.

```text
anyharness/crates/proliferate-worker/src/commands/
  dispatcher.rs
    Dispatch Cloud command kind `refresh_model_registry` to the local
    AnyHarness refresh endpoint.

  mapping.rs
    Map Cloud command payload into AnyHarness refresh request:
      target agent kind
      workspace/repo-root scope when present
      command metadata

anyharness/crates/proliferate-worker/src/anyharness_client/
  agents.rs or runtime.rs
    Local client methods:
      refresh_model_registry(agent_kind, scope)
      get_model_registry(agent_kind, scope)
      get_launch_options(scope)

anyharness/crates/proliferate-worker/src/inventory/
  providers.rs
    Include dynamic registry freshness and supported dynamic harnesses in
    target inventory. Do not include full model arrays in every heartbeat.

anyharness/crates/proliferate-worker/src/sync/
  mapper.rs
    Map AnyHarness registry snapshots into Cloud upload payloads.

  event_batch.rs
    Batch registry projection updates with other low-frequency target state.

  outbox.rs
    Retry registry projection upload idempotently.
```

Cloud command/event names should be explicit:

```text
Command:
  refresh_model_registry

Worker upload/projection event:
  target.model_registry_refreshed
  target.model_registry_refresh_failed
```

Registry projection uploads should be low-frequency. Do not send full model
arrays in every heartbeat.

## Desktop Placement

Desktop should not invent model truth.

It may cache:

```text
last fetched effective launch options from AnyHarness
last synced Cloud registry projection
user model visibility preferences
selected default model intents
```

Frontend code should preserve the normal boundary:

```text
apps/desktop/src/lib/access/
  anyharness/agents.ts or existing AnyHarness agent access file
    Raw AnyHarness launch-option and refresh/read calls.

  cloud/model-registries.ts
    Raw Cloud synced registry/projection calls if a Cloud endpoint exists.

apps/desktop/src/lib/domain/chat/models/
  model-display.ts
    Display fallback only: prefer displayName, then catalog enriched name, then
    generated name from id.

  model-selection.ts
    Current selected model resolution for picker state.
    Any branch that reads live active-session model controls must still
    intersect with visible model ids from the effective launch registry,
    preserving only the selected hidden/stale value for repair.

  model-visibility.ts
    Pure defaultOptIn + user opt_in/opt_out override rules.

  model-registry.ts
    Merge catalog models, AnyHarness live registry models, synced Cloud
    registry models, and current selection into one effective list.

apps/desktop/src/lib/domain/settings/
  agent-defaults.ts
    Saved default ModelIntent logic and per-harness defaults.

  model-registries.ts
    Agent Defaults section view models for dynamic harness registry management,
    search, and visibility toggles.
    Merge logic must preserve catalog aliases so old/default preference ids can
    continue resolving after runtime launch options are merged.

apps/desktop/src/hooks/
  chat/derived/use-chat-launch-catalog.ts
    Reads effective launch options and feeds chat picker state.

  settings/workflows/use-model-registry-settings.ts
    Query/mutation wiring for refresh and visibility overrides.

  workspaces/use-workspace-bootstrap-actions.ts
    Empty-workspace auto-launch must use the same Cloud catalog + AnyHarness
    runtime launch-option merge as the chat picker before resolving the default
    model to launch.

apps/desktop/src/components/
  workspace/chat/input/ModelSelector.tsx
    Render effective picker list only.

  settings/panes/AgentDefaultsPane.tsx
    Render expandable harness sections, default model selectors, search, model
    visibility toggles, and refresh buttons for dynamic harnesses.

  settings/panes/ModelRegistryPane.tsx
    Optional child pane/component if AgentDefaultsPane becomes too large.
```

Agent Defaults target UX:

```text
Agent Defaults
  Search all models...

  Claude
    Default: Sonnet
    Visible models
      Sonnet                 on   default
      Opus 4.7               off  default off

  Cursor
    Default: Codex 5.3
    Last refreshed 3 minutes ago     [Refresh models]
    Search Cursor models...
    Visible models
      Composer 2 Fast        on   default
      Codex 5.3              on   default
      Codex 5.3 High         off
      Grok 4.3 1M            off
      Kimi K2.5              off

  OpenCode
    Default: Big Pickle
    Last refreshed today             [Refresh models]
    Search OpenCode models...
    Visible models
      Big Pickle             on   default
      DeepSeek V4 Flash      off
      amazon-bedrock/...     off
```

Rules:

- every harness has an expandable section
- every model has a toggle backed by user override state
- no override means follow `defaultOptIn`
- toggling on writes `opt_in`
- toggling off writes `opt_out`
- resetting/removing the override returns to `defaultOptIn`
- Cursor/OpenCode sections include a clean refresh button
- refresh button refreshes target-discovered models; it does not mutate
  bundled `catalog.json`
- a global, non-workspace-scoped refresh invalidates all workspace-scoped
  launch-option caches for that runtime because model availability may affect
  workspace-scoped picker state

The UI should render:

- Cloud catalog defaults before a target is selected
- target synced registry projection when configuring a cloud/SSH/remote target
- direct AnyHarness launch options when connected to a local target
- stale/missing warnings when saved intent came from an old registry snapshot

## Automations And Slack

Automation and Slack config should save model intent, but V1 UI should not make
users choose a model source or target registry.

Selection source:

```text
Cloud-effective model list =
  Cloud product catalog
  + most recently synced user/team target dynamic registries
  + user/team visibility overrides
```

The UI can simply show:

```text
Automation model
  Cursor · Codex 5.3

Slack thread model
  OpenCode · Big Pickle
```

It does not need to show:

```text
Source: Pablo's local Cursor registry
Target: Pablo's Mac
Registry snapshot: abc123
```

Execution still resolves against the target that runs the work:

```text
start automation / Slack session
  -> choose execution target by normal compute rules
  -> resolve saved model intent against that target
  -> refresh dynamic registry if stale and target online
  -> run, fallback, or fail according to policy
```

If target capability changes, Cloud should mark affected automation/Slack
config as needing review rather than silently changing model class.

## Open Questions

These are intentionally deferred:

- Whether team admins can define org-wide visibility defaults over
  user-discovered models.
- Whether Cloud should periodically prune old user model registry snapshots.
- Whether model capability metadata should be normalized across providers or
  mostly displayed as harness-specific metadata.
- Whether managed cloud targets should have precomputed model registry
  snapshots per image version.

## Implementation Sequence

Recommended order:

1. Preserve Cloud product catalog as the optimistic default source.
2. Add AnyHarness model registry snapshot table and internal model shape.
3. Add Cursor discovery through `cursor-agent models`.
4. Add OpenCode discovery through `opencode models --verbose`.
5. Expose AnyHarness refresh/read endpoints for dynamic harnesses.
6. Merge catalog metadata with live snapshots in AnyHarness launch options.
7. Add Agent Defaults expandable per-harness visibility over effective
   registries.
8. Sync registry projections through Worker to Cloud.
9. Save automation/Slack defaults as `ModelIntent`.
10. Validate/resolve model intent at launch and report actionable errors.

## Non-Goals

Do not implement these as part of the first model-registry pass:

- rewriting bundled catalog files at runtime
- making Cloud the execution authority for target model capability
- dynamic model refresh for Claude/Codex/Gemini unless a reliable list source
  exists
- broad team policy over user-local discovered models beyond latest
  Cloud-effective visibility/defaults
- automatic fallback to different model families without explicit fallback
  policy
- treating catalog metadata as live ACP session config truth
