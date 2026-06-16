# Agent Catalog And Readiness

Status: authoritative for AnyHarness agent catalog/readiness truth sources.

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

AnyHarness uses two bundled, versioned agent inputs and does not support remote
model/launch catalog paths. `catalog.json` owns model/mode/control metadata;
`registry.json` owns trusted runtime behavior such as install, launch, auth
slots, and materialization policy. Credentials, readiness resolution, reconcile
execution, install, seed, and portability code live outside `catalog/**`.

## Truth Sources

There are four distinct truths. Do not collapse them.

```text
Cloud product catalog
  Product/UI catalog for optimistic rendering in desktop, web, mobile, and
  automation creation. This can be newer than a target runtime.

AnyHarness agent catalog + registry
  Target-runtime support manifests. The catalog says which model/mode/control
  options are statically known. The registry says what this runtime knows how
  to install, discover, authenticate, materialize, and launch.

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

## Bundled Agent Inputs

The supported AnyHarness agent input schemas are:

```text
catalogs/agents/v1/catalog.json
catalogs/agents/v1/schema.json
catalogs/agents/v1/registry.json
catalogs/agents/v1/registry.schema.json
```

The catalog document describes optimistic/static session choices:

- agent kind and display name
- fallback session model/control metadata
- compatibility/status metadata needed to display choices

The registry document describes trusted runtime behavior:

- supported agent kind and display name
- install/update support for native CLI and ACP-facing agent-process artifacts
- launch executable, default args, and process environment behavior
- auth slots, credential-provider gates, discovery kind, login command
- materialization policy for gateway env and synced files
- compatibility metadata needed to decide whether the target can launch

There must be no remote or legacy split catalog inputs:

```text
old model-catalog document type
old launch-catalog document type
old model-catalog URL environment variable
old launch-catalog URL environment variable
old model/launch cache readers
old model/launch cache writers
split launch catalog directory
```

Runtime catalog refresh/fetch/cache behavior is not supported in the migrated
runtime. The bundled `AgentCatalogDocument` and `AgentRegistryDocument` are the
only runtime agent inputs. Dynamic model refresh is a separate
`model_registry/**` concern and stores target-local snapshots in SQLite; it must
not rewrite catalog or registry JSON.

## Trust Boundary

Executable behavior is security-sensitive.

The trusted bundled registry defines the slow, hand-curated **method** and
identity:

- install method per role (direct binary / tarball / managed npm / git /
  registry-backed) and the platform map
- discovery endpoints used only at probe time (latest-version URLs, ACP
  registry ids, URL templates) and the manual adapter git refs
- executable names and launch args
- credential discovery kind, login command, auth-slot materialization policy

The catalog is the **lockfile**: each harness pin may carry a resolved
`source` — the exact, per-platform `{url, sha256}` for a binary/archive, or a
pinned npm/git specifier — produced by the probe (`resolve-pins.mjs`). Install
consumes the catalog pin, materializes EXACTLY that, and verifies the
**sha256 before use**.

The sha256 is the trust anchor. A url living in the catalog cannot fetch
unintended bytes: a mismatch hard-fails the install and leaves nothing on disk.
This is what permits resolved download URLs to live in the (bundled, versioned,
build-signed) catalog rather than the registry — the integrity check, not the
file's location, is the security boundary. The registry still owns auth,
launch, and the install method; it is never consulted for *which bytes* once a
pin declares a source.

This boundary should be visible in code. The projection that produces
`AgentDescriptor` is sourced from trusted registry data only (method, auth,
launch). Catalog data enriches it with the resolved, sha-anchored version pin
and model/control display options.

## Source Shape

Required shape:

```text
anyharness-lib/src/domains/agents/
  model.rs
  catalog/
    mod.rs
    schema.rs
    bundled.rs
    validation.rs
    projection/
      models.rs
  registry/
    mod.rs
    service.rs
    schema.rs
    bundled.rs
    validation.rs
    projection.rs
  readiness/
    mod.rs
    launch_options.rs
    service.rs
    artifacts.rs
    compatibility.rs
    overrides.rs
    paths.rs
    status.rs
  model_registry/
    mod.rs
    model.rs
    store.rs
    projection.rs
    refresh.rs
    resolution.rs
    service.rs
  auth/
    credentials.rs            # plus auth-config/login modules (see agent-auth)
  installer/
    mod.rs
    service.rs
    agent_process.rs
    downloads.rs
    lock.rs
    managed_npm.rs
    native.rs
    npm.rs
    reconcile/
      mod.rs
      execution.rs
    seed/
      mod.rs
  portability/
    mod.rs
```

Use direct imports. Do not add barrel-only convenience files. `mod.rs` may
define the public surface for that module and re-export intentionally public
types/functions from its children.

## Module Ownership

### `catalog/`

Owns the static model/mode/control manifest.

Allowed:

- parse `AgentCatalogDocument`
- validate schema invariants
- read bundled catalog JSON
- project fallback model metadata
- expose catalog data to readiness-owned launch-option projection

Banned:

- checking local filesystem/PATH readiness
- checking user credentials
- executing install/update
- generating launchers
- defining launch executables or auth slots
- starting ACP sessions
- treating static model metadata as active-session truth
- parsing old model/launch catalog formats

### `registry/`

Owns the trusted supported-agent runtime registry.

It should answer:

```text
Which agent kinds does this runtime know how to support?
How does this runtime install, authenticate, materialize auth, and launch them?
```

Allowed:

- parse `AgentRegistryDocument`
- validate schema invariants against the catalog where needed
- read bundled registry JSON
- project trusted registry data into `AgentDescriptor`
- expose auth-slot policy to credentials/auth-config/materialization code

Banned:

- performing readiness checks
- executing installation
- mutating credentials or materialized auth
- storing dynamic model refresh state

### `auth/credentials.rs`

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

### Install Files

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
`installer/` uses those mechanics to implement product install/update behavior.

### `installer/reconcile/`

Owns batch repair/sync.

It can iterate supported agents and call install/readiness flows to make the
runtime match desired local state.

It should not own per-provider install mechanics.

### `installer/seed/`

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

### `domains/sessions/runtime/**`

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
  -> readiness service for each supported descriptor
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
    -> readiness service
  -> response includes fresh readiness
```

### Creating a session

```text
SessionRuntime
  -> descriptor from trusted registry projection
  -> readiness service
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
options projected from the bundled agents catalog/registry plus readiness
filtering.
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
- direct catalog JSON parsing from `domains/sessions/**`, `live/**`, or `api/**`
- credential detection inside `catalog/**`
- install/update execution inside `catalog/**`
- provider CLI mechanics inside `catalog/**`
- **install-time latest resolution**: fetching a "latest version" URL, the ACP
  `/latest` registry, or any network index from the install path. The catalog
  pin's resolved `source` is the only install input; resolution happens at probe
  time (`resolve-pins.mjs`), never at install.
- **PATH adoption**: launching or installing a provider binary discovered on
  `PATH` instead of the pinned managed artifact.
- **non-pin install fallbacks**: `binary_hint` / npm-latest / registry-spec
  fallbacks. A role with no resolved source pin is a hard error, not a fallback.

## Acceptance

The catalog/readiness structure is complete when:

- `domains/agents/catalog.rs` is gone.
- `domains/agents/catalog/**` exists with focused submodules.
- split launch catalog files are gone.
- old split catalog structs/functions/env vars are gone.
- all launch/model metadata AnyHarness still uses is projected from
  `AgentCatalogDocument` or `AgentRegistryDocument`, according to ownership.
- executable/process/auth descriptor projection is sourced only from trusted
  registry data.
- install, credential detection, readiness, reconcile, seed, and portability
  behavior live outside `catalog/**`.
- tests are split by responsibility:
  - catalog validation
  - registry validation
  - registry descriptor projection
  - fallback model projection
  - internal launch-option projection
  - readiness code touched by the migration

Verification examples:

```bash
cargo test -p anyharness-lib domains::agents
```

Run a stale-symbol search for the removed split launch path, old catalog service
names, old runtime catalog hooks, and old remote catalog environment variables.
It should return no code references after the migration.
