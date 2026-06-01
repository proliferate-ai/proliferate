# Agent Catalog And Readiness

Status: authoritative for AnyHarness agent catalog/readiness truth sources and
the current catalog migration.

## Goal

The agents domain answers one product question:

```text
For this AnyHarness target, which agent families are supported, installable,
authenticated, ready, and launchable?
```

It does not answer:

- what the cloud product wants to show optimistically in every UI
- what an already-running ACP session currently reports as live model/config
  truth
- how to speak provider-specific CLI, ACP registry, or MCP protocols
- how a session actor processes turns

The current migration establishes one supported catalog input and removes the
old split model/launch catalog paths. It promotes the cheap ownership folders
for registry, credentials, readiness resolution, and reconcile execution.
Install files remain transitional until the install/update boundary is promoted
cleanly. The current `installer.rs` facade delegates to focused child modules
for native artifacts, agent-process artifacts, npm/source-build mechanics, and
download helpers. All install, credentials, registry, reconcile, readiness, and
seed code must live outside `catalog/**`.

## Truth Sources

There are four distinct truths. Do not collapse them.

```text
Cloud product catalog
  Product/UI catalog for optimistic rendering in desktop, web, mobile, and
  automation creation. This can be newer than a target runtime.

AnyHarness agent catalog
  Target-runtime support manifest. It says what this runtime knows how to
  install, discover, authenticate, and launch.

AnyHarness dynamic model registry snapshot
  Target-local, runtime-refreshed model list for provider-agnostic harnesses
  such as Cursor and OpenCode. It may be workspace-scoped when the provider's
  model list depends on workspace config. It never carries trusted executable,
  install, auth, or launch metadata.

Live ACP session config
  Actual truth for an active session after the agent process starts and reports
  its live model/config capabilities.
```

Consequences:

- Desktop may render optimistically from cloud/catalog product data.
- AnyHarness must still validate and resolve what the target can actually run.
- Dynamic model registry snapshots may refine target model availability but
  must not mutate the bundled catalog or influence trusted executable behavior.
- A live session's active model/config truth comes from ACP live config, not
  from the static AnyHarness catalog.
- AnyHarness catalog endpoints, if exposed, are target capability/readiness
  endpoints, not the primary product UI catalog.

## Single Catalog Input

The only supported AnyHarness catalog schema is:

```text
catalogs/agents/v1/catalog.json
catalogs/agents/v1/schema.json
```

The catalog document describes supported agent families:

- agent kind and display name
- install support for native CLI artifacts
- install support for ACP-facing agent-process artifacts
- launch executable and default args
- credential discovery kind and login command
- fallback session model/control metadata
- compatibility and status metadata

There must be no split legacy catalog inputs:

```text
old model-catalog document type
old launch-catalog document type
old model-catalog URL environment variable
old launch-catalog URL environment variable
old model/launch cache readers
old model/launch cache writers
legacy split launch catalog directory
```

Runtime catalog refresh/fetch/cache behavior is not supported in the migrated
runtime. The bundled `AgentCatalogDocument` is the only runtime catalog input.
Dynamic model refresh is a separate `model_registry/**` concern and stores
target-local snapshots in SQLite; it must not rewrite catalog JSON.

## Trust Boundary

Executable behavior is security-sensitive.

The trusted bundled catalog may define:

- install methods
- binary/package URLs
- executable names
- launch args
- credential discovery kind
- login command

This boundary should be visible in code. The projection that produces
`AgentDescriptor` must be sourced from trusted catalog data only.

## Catalog Migration Source Shape

Required shape for this migration:

```text
anyharness-lib/src/domains/agents/
  model.rs
  catalog/
    mod.rs
    schema.rs
    bundled.rs
    validation.rs
    projection/
      descriptors.rs
      models.rs
  readiness/
    mod.rs
    launch_options.rs
    resolver.rs
  model_registry/
    mod.rs
    model.rs
    store.rs
    projection.rs
    refresh.rs
    resolution.rs
    service.rs
  credentials/
    mod.rs
  installer.rs                # transitional facade: outside catalog/**
  installer/
    agent_process.rs
    downloads.rs
    native.rs
    npm.rs
  install_lock.rs             # transitional: outside catalog/**
  registry/
    mod.rs
  reconcile/
    mod.rs
    execution.rs
  seed/
    mod.rs
  portability/
    mod.rs
```

Follow-up topology may promote those transitional files into focused folders
once their boundaries are split cleanly:

```text
anyharness-lib/src/domains/agents/
  registry/
    mod.rs
  credentials/
    mod.rs
  readiness/
    mod.rs
    launch_options.rs
    resolver.rs
    artifacts.rs
    spawn.rs
    compatibility.rs
  install/
    mod.rs
    native.rs
    agent_process.rs
    launcher.rs
    locks.rs
  reconcile/
    mod.rs
  seed/
    mod.rs
```

Use direct imports. Do not add barrel-only convenience files. `mod.rs` may
define the public surface for that module and re-export intentionally public
types/functions from its children.

## Module Ownership

### `catalog/`

Owns the static support manifest.

Allowed:

- parse `AgentCatalogDocument`
- validate schema invariants
- read bundled catalog JSON
- project trusted catalog data into `AgentDescriptor`
- project fallback model metadata
- expose catalog data to readiness-owned launch-option projection

Banned:

- checking local filesystem/PATH readiness
- checking user credentials
- executing install/update
- generating launchers
- starting ACP sessions
- treating static model metadata as active-session truth
- parsing old model/launch catalog formats

### `registry/`

Owns the supported-agent registry exposed to runtime callers.

It should answer:

```text
Which agent kinds does this runtime know how to support?
```

It is built from trusted catalog descriptor projection. It should not perform
readiness checks or installation.

### `credentials/`

Owns runtime credential readiness mapping.

Allowed:

- check required env vars
- ask `anyharness-credential-discovery` for provider-local auth state
- map provider-local auth into `CredentialState`
- report login guidance from the descriptor

Banned:

- storing cloud credential sync policy
- installing agents
- changing catalog data
- starting live sessions

Provider credential file parsing that is reusable across desktop/cloud sync
belongs in `anyharness-credential-discovery`. The agents domain consumes that
crate and maps results into runtime readiness.

### `readiness/`

Owns target-local readiness.

Inputs:

- `AgentDescriptor`
- runtime home
- platform/architecture
- managed artifact state
- PATH-discovered artifact state
- credential state

Outputs:

- `ResolvedArtifact`
- `ResolvedAgent`
- `ResolvedAgentStatus`
- `SpawnSpec` when launchable

Readiness does not install anything. It reports the current target state.

Dynamic providers such as OpenCode may expose model lists at live ACP runtime.
Readiness should say whether the provider is launchable; it should not try to
precompute every live model choice when the provider owns that dynamically.

### `install/` Or Transitional Install Files

Owns managed install/update workflows.

Allowed:

- install native CLI artifacts when the descriptor supports managed install
- install ACP-facing agent-process artifacts
- generate managed launchers
- use runtime-home install locks
- return install results
- re-run readiness after mutation

Banned:

- defining what agents exist
- checking credentials except when needed for a provider-specific install step
- writing static catalog files
- starting a session actor

Low-level vendor mechanics belong under `integrations/agent_cli/**`.
`install/` uses those mechanics to implement product install/update behavior.

### `reconcile/`

Owns batch repair/sync.

It can iterate supported agents and call install/readiness flows to make the
runtime match desired local state.

It should not own per-provider install mechanics.

### `seed/`

Owns prepackaged desktop/runtime artifacts.

Allowed:

- inspect seeded artifacts
- hydrate runtime-home artifacts from packaged binaries
- validate seed metadata
- quarantine or ignore invalid seeds
- regenerate launchers for seeded artifacts

Banned:

- deciding product launch defaults
- replacing readiness checks
- parsing credential files

## External Boundaries

### `integrations/agent_cli/**`

Provider/vendor mechanics:

- ACP registry document fetching
- provider CLI probe/path/version helpers
- launcher mechanics that are reusable across install/readiness
- package manager or binary-distribution mechanics

No product readiness decisions live here.

### `sessions/runtime/**`

Session runtime uses agents as an input:

```text
agent kind + launch selection
  -> registry descriptor
  -> readiness resolution
  -> spawn spec
  -> live session startup
```

It should not parse catalog JSON or inspect credential files directly.

### `live/sessions/**`

Live session code starts and supervises the ACP process from a resolved
`SpawnSpec`. It should not decide which agents exist or how to install them.

## Runtime Flow

### Listing target agents

```text
API handler
  -> agents registry
  -> readiness resolver for each supported descriptor
  -> response includes target-local readiness and fallback metadata
```

### Installing an agent

```text
API handler
  -> install service
    -> descriptor from registry
    -> install native artifact if supported and needed
    -> install agent-process artifact if supported and needed
    -> regenerate launcher if needed
    -> readiness resolver
  -> response includes fresh readiness
```

### Creating a session

```text
SessionRuntime
  -> descriptor from registry
  -> readiness resolver
  -> reject if not launchable
  -> build spawn spec
  -> assemble MCP/session launch extras
  -> LiveSessionManager starts actor
  -> live ACP config becomes active-session truth
```

### Model/config display

```text
Before live session:
  client may show cloud product catalog optimism

At target/session creation:
  AnyHarness validates against target support/readiness

After live session starts:
  client uses live ACP config/session events as actual truth
```

## Public API Behavior

AnyHarness does not expose public runtime catalog endpoints in this migration.
The remaining public target capability endpoints are:

- agent list/readiness endpoint: target-local support and readiness
- install endpoint: mutate target-local managed artifacts

SessionRuntime, cowork, and subagent flows may use internal target-local launch
options projected from the bundled agents catalog plus readiness filtering.
That internal projection should be named as resolved launch options, not as a
public catalog response, and should carry only the fields those internal flows
need.

## Banned Shapes

Do not add:

- `domains/agents/catalog.rs`
- `catalog/legacy.rs`
- the old model-catalog document type
- the old launch-catalog document type
- the legacy split launch catalog directory
- old model/launch remote catalog URL environment variables
- direct catalog JSON parsing from `sessions/**`, `live/**`, or `api/**`
- credential detection inside `catalog/**`
- install/update execution inside `catalog/**`
- provider CLI mechanics inside `catalog/**`

## Migration Acceptance

The catalog migration is done only when:

- `domains/agents/catalog.rs` is gone.
- `domains/agents/catalog/**` exists with focused submodules.
- legacy split launch catalog files are gone.
- old split catalog structs/functions/env vars are gone.
- all launch/model metadata AnyHarness still uses is projected from
  `AgentCatalogDocument`.
- executable/process/auth descriptor projection is sourced only from trusted
  catalog data.
- install, credential detection, readiness, reconcile, seed, and portability
  behavior live outside `catalog/**`.
- tests are split by responsibility:
  - catalog validation
  - descriptor projection
  - fallback model projection
  - internal launch-option projection
  - readiness code touched by the migration

Agents-domain topology promotion is a separate cleanup. It is not complete
until transitional files such as `installer.rs` and `install_lock.rs` are
either promoted into final focused folders or documented as intentionally flat.

Verification examples:

```bash
cargo test -p anyharness-lib domains::agents
```

Run a stale-symbol search for the removed split launch path, old catalog service
names, old runtime catalog hooks, and old remote catalog environment variables.
It should return no code references after the migration.
