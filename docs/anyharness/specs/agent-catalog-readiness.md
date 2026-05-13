# Agent Catalog And Readiness

Status: authoritative for the fully migrated AnyHarness agent catalog,
installation, credentials, and readiness architecture.

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

The fully migrated architecture has one supported catalog input, one agents
domain, and separate modules for catalog, install, credentials, readiness, and
launch resolution.

## Truth Sources

There are three distinct truths. Do not collapse them.

```text
Cloud product catalog
  Product/UI catalog for optimistic rendering in desktop, web, mobile, and
  automation creation. This can be newer than a target runtime.

AnyHarness agent catalog
  Target-runtime support manifest. It says what this runtime knows how to
  install, discover, authenticate, and launch.

Live ACP session config
  Actual truth for an active session after the agent process starts and reports
  its live model/config capabilities.
```

Consequences:

- Desktop may render optimistically from cloud/catalog product data.
- AnyHarness must still validate and resolve what the target can actually run.
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
catalogs/launch/**
ModelCatalogDocument
LaunchCatalogDocument
ANYHARNESS_MODEL_CATALOG_URL
ANYHARNESS_LAUNCH_CATALOG_URL
old model/launch cache readers
old model/launch cache writers
```

If remote catalog refresh is supported, it must use the same
`AgentCatalogDocument` schema. Remote refresh must not reintroduce separate
model or launch catalog formats.

## Trust Boundary

Executable behavior is security-sensitive.

The trusted bundled catalog may define:

- install methods
- binary/package URLs
- executable names
- launch args
- credential discovery kind
- login command

An unsigned remote catalog may only update non-executable metadata:

- model display names
- model status
- launch-remediation text
- fallback launch controls
- fallback session default controls

Remote catalog data must not silently change process/install/auth behavior
unless the remote catalog is signed and verified by an explicitly documented
trust path.

This boundary should be visible in code. The projection that produces
`AgentDescriptor` must be sourced from trusted catalog data only.

## Target Source Shape

Final agents domain:

```text
anyharness-lib/src/domains/agents/
  model.rs
  catalog/
    mod.rs
    schema.rs
    bundled.rs
    validation.rs
    cache.rs
    remote.rs
    projection/
      descriptors.rs
      models.rs
      launch.rs
    tests/
  registry/
    mod.rs
  credentials/
    mod.rs
  readiness/
    mod.rs
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
- refresh/cache same-schema remote catalog metadata, if enabled
- project trusted catalog data into `AgentDescriptor`
- project fallback model metadata
- project fallback launch metadata when an API still needs that response shape

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

### `install/`

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

AnyHarness may expose target capability endpoints, but their semantics must be
clear:

- agent list/readiness endpoint: target-local support and readiness
- install endpoint: mutate target-local managed artifacts
- session-launch endpoint, if retained: target-local launch metadata projected
  from the single agents catalog plus readiness filtering
- model registry endpoint, if retained: fallback metadata projected from the
  single agents catalog, not active live-session truth

No API should expose or depend on the removed split launch/model catalog files.

## Banned Shapes

Do not add:

- `domains/agents/catalog.rs`
- `catalog/legacy.rs`
- `ModelCatalogDocument`
- `LaunchCatalogDocument`
- `catalogs/launch/**`
- `ANYHARNESS_MODEL_CATALOG_URL`
- `ANYHARNESS_LAUNCH_CATALOG_URL`
- direct catalog JSON parsing from `sessions/**`, `live/**`, or `api/**`
- credential detection inside `catalog/**`
- install/update execution inside `catalog/**`
- provider CLI mechanics inside `catalog/**`

## Migration Acceptance

A full migration is done only when:

- `domains/agents/catalog.rs` is gone.
- `domains/agents/catalog/**` exists with focused submodules.
- `catalogs/launch/**` is gone.
- old split catalog structs/functions/env vars are gone.
- all launch/model metadata AnyHarness still exposes is projected from
  `AgentCatalogDocument`.
- executable/process/auth descriptor projection is sourced only from trusted
  catalog data.
- install, credential detection, readiness, reconcile, and seed behavior live
  outside `catalog/**`.
- tests are split by responsibility:
  - catalog validation
  - descriptor projection
  - fallback model projection
  - fallback launch projection
  - unified remote/cache behavior, if retained
  - readiness
  - install
  - credentials

Verification examples:

```bash
rg "ModelCatalogDocument|LaunchCatalogDocument|ANYHARNESS_MODEL_CATALOG_URL|ANYHARNESS_LAUNCH_CATALOG_URL" anyharness catalogs scripts
rg "catalogs/launch" anyharness catalogs scripts docs
cargo test -p anyharness-lib domains::agents
```

The first two commands should return no code references after the migration.
