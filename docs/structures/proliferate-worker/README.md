# Proliferate Worker Structure

Status: target standard for `proliferate-worker` code.

Scope:

- `anyharness/crates/proliferate-worker/**`

This document defines the intended source structure and ownership rules for the
target-side Proliferate Worker binary. Existing code may still be migrating
toward this shape, but new code should follow this structure.

## Purpose

Proliferate Worker is the target-side bridge between Proliferate Cloud and the
local AnyHarness runtime.

The worker exists because Cloud-mediated clients often cannot call a target
directly. The worker runs on the target, connects outbound to Cloud, leases
commands, calls local AnyHarness or performs target-local preparation, and
uploads results, status, inventory, and runtime events back to Cloud.

The worker is not Cloud, not AnyHarness, and not supervisor.

```text
Cloud -> Worker -> AnyHarness / target
  command downlink

AnyHarness -> Worker -> Cloud
  event uplink

target -> Worker -> Cloud
  target status
```

## Ownership Boundaries

Cloud owns:

- org, team, user, and actor authorization
- target registry and enrollment token issuance
- command queue admission, leasing, and terminal command state
- Cloud workspace and session projection records
- exposure and projection policy
- billing, audit, and compute policy
- target materialization plans and credential grants

AnyHarness owns:

- target-local workspace records
- target-local session execution
- prompt/config/cancel/close semantics
- session event ordering and transcript truth
- agent subprocesses, MCP launch, provider launch, and local runtime behavior

Supervisor owns:

- process lifecycle
- binary installation and replacement
- restart behavior
- applying update requests

Worker owns:

- outbound Cloud communication from the target
- Cloud command delivery to AnyHarness or target-local code
- target-local materialization effects
- AnyHarness event uplink to Cloud
- target status, health, inventory, and version reporting
- local bridge durability for identity, command-result retry, cursors, and
  mappings
- writing a narrow supervisor update-request mailbox when Cloud desired
  versions differ from installed versions

Worker must not own:

- Cloud authorization or exposure policy
- AnyHarness execution truth or transcript reconstruction
- direct mutation of AnyHarness SQLite
- supervisor install, restart, rollback, or binary replacement
- broad bidirectional state sync

## Target Source Shape

```text
src/
  main.rs

  runtime/
    mod.rs
    context.rs
    tasks.rs
    shutdown.rs

  command_downlink/
    loop.rs
    lease_state.rs
    catalog.rs
    processor.rs
    mapping.rs
    anyharness_dispatch.rs
    reporting.rs
    idempotency.rs
    stale_slot.rs
    handlers/
      git_identity.rs
      repo_checkout.rs
      environment.rs
      agent_auth.rs
      runtime_config.rs
      pruning.rs
      backfill.rs

  event_uplink/
    loop.rs
    exposures.rs
    projection_cursors.rs
    discovery.rs
    tailer.rs
    event_mapping.rs
    gaps.rs
    backfill.rs

  target_status/
    loop.rs
    health.rs
    heartbeat.rs
    inventory_report.rs
    update_observation.rs

  target/
    materialization/
      mod.rs
      paths.rs
      files.rs
      env.rs
      git.rs
      git_identity.rs
      repo_checkout.rs
      runtime_config.rs
      agent_auth.rs
      manifest.rs

    inventory/
      mod.rs
      platform.rs
      versions.rs
      capabilities.rs
      providers.rs
      mcp.rs

    updates/
      desired_versions.rs
      supervisor_mailbox.rs
      status.rs

  clients/
    cloud/
    anyharness/

  store/
    mod.rs
    connection.rs
    migrations.rs
    identity.rs
    pending_command_results.rs
    projection_cursors.rs
    workspace_mappings.rs
    workspace_discovery.rs

  identity/
    enrollment.rs
    credentials.rs
    fingerprint.rs

  config.rs
  error.rs
  logging.rs
  observability.rs
  versions.rs
```

Do not create empty folders. Introduce a file or folder when it has real
responsibility to own.

## Runtime

`runtime/` owns process composition and lifecycle.

High-level goal:

```text
initialize -> build shared context -> start named flows -> coordinate shutdown
```

Files:

- `runtime/mod.rs`: top-level `run(config, once)` orchestration.
- `runtime/context.rs`: shared `WorkerContext` containing config, store,
  clients, identity, and static process metadata.
- `runtime/tasks.rs`: named task spawning and task join behavior.
- `runtime/shutdown.rs`: cancellation, signal handling, graceful drain, and
  clean exit coordination.

Allowed:

- opening the store
- building clients
- ensuring worker identity
- creating shared context
- starting `command_downlink`, `event_uplink`, `target_status`, and other named
  loops
- coordinating shutdown and final drains

Banned:

- command kind logic
- event cursor mechanics
- target materialization details
- Cloud command result shaping
- AnyHarness payload mapping
- heartbeat payload semantics beyond delegating to `target_status`

`runtime/` may know every subsystem exists. It should not implement those
subsystems.

## Command Downlink

`command_downlink/` owns the Cloud command delivery path.

```text
Cloud command queue
  -> worker lease
  -> command processor
  -> target-local handler or AnyHarness dispatch
  -> Cloud delivery/result report
```

### Files

- `command_downlink/loop.rs`: long-running lease loop. Flushes pending results,
  builds lease state, leases one command from Cloud, passes it to the processor,
  and sleeps/backoffs.
- `command_downlink/lease_state.rs`: builds a snapshot of what this worker can
  currently handle, such as AnyHarness configured, AnyHarness healthy,
  materialization root available, slot current, and worker version.
- `command_downlink/catalog.rs`: canonical command names, command categories,
  and requirements. Pure policy over command specs.
- `command_downlink/processor.rs`: one-command lifecycle. Validates context,
  classifies the command, calls the right handler or generic AnyHarness path,
  coordinates delivery and final result reporting.
- `command_downlink/mapping.rs`: pure Cloud command envelope to internal
  `AnyHarnessCommand` mapping for commands that use the generic AnyHarness
  path.
- `command_downlink/anyharness_dispatch.rs`: internal `AnyHarnessCommand` to
  local AnyHarness HTTP call.
- `command_downlink/reporting.rs`: Cloud delivery reports, terminal result
  reports, failure classification, safe result payload shaping, and
  pending-result retry.
- `command_downlink/idempotency.rs`: duplicate lease, crash recovery, and safe
  retry rules once they become non-trivial.
- `command_downlink/stale_slot.rs`: worker-side stale sandbox/profile/slot
  checks once they become non-trivial.
- `command_downlink/handlers/**`: command kinds that need Worker-owned behavior
  beyond simple AnyHarness mapping and dispatch.

### Lease State And Supported Kinds

The command lease loop asks Cloud for a command the worker can currently
handle. It sends Cloud a list of supported command kinds in the lease request.

That list is not Cloud policy. It is worker capability policy.

Examples:

```text
AnyHarness healthy
  Worker can lease AnyHarness-backed commands such as send_prompt,
  start_session, cancel_turn, close_session, materialize_workspace, and
  backfill_exposed_workspace.

AnyHarness missing or unhealthy
  Worker should lease only target-local materialization commands that do not
  need AnyHarness, such as configure_git_identity, ensure_repo_checkout, and
  materialize_environment.
```

`lease_state.rs` builds the current state snapshot. `catalog.rs` decides which
command specs are satisfied by that state.

### Processor

`processor.rs` is the canonical place to understand one-command deliverability.

It owns this lifecycle:

```text
leased Cloud command
  -> validate lease and slot context
  -> classify command kind
  -> enforce requirements from catalog
  -> call custom handler if needed
  -> otherwise map to AnyHarnessCommand
  -> report delivery when appropriate
  -> dispatch to AnyHarness when appropriate
  -> classify handler or AnyHarness response
  -> save pending result before Cloud upload
  -> report terminal result to Cloud
  -> clear pending result after successful upload
```

Do not bury this pipeline in the lease loop or in a command-family handler.

### Generic AnyHarness Path

Many commands should not have a custom handler. If a command is simply:

```text
Cloud payload -> AnyHarness request -> Cloud result
```

it should use:

```text
mapping.rs -> anyharness_dispatch.rs -> reporting.rs
```

Examples:

- `send_prompt`
- `resolve_interaction`
- `update_session_config`
- `cancel_turn`
- `close_session`

Add a custom handler only when the command has Worker-owned target effects,
special Cloud status reporting, cross-boundary orchestration, or command-family
logic that does not belong in the generic path.

### Handlers

Handlers own command-family-specific behavior.

- `handlers/git_identity.rs`: `configure_git_identity`. Fetch Cloud material
  and write target-local Git credential/config.
- `handlers/repo_checkout.rs`: `ensure_repo_checkout`. Clone/fetch/verify repo
  checkout on the target.
- `handlers/environment.rs`: `materialize_environment`. Fetch target config
  plan, write env/files/config, and coordinate runtime config apply if needed.
- `handlers/agent_auth.rs`: `refresh_agent_auth_config`. Fetch agent auth plan,
  materialize gateway/synced-file auth, call AnyHarness apply endpoint, and
  report agent auth status.
- `handlers/runtime_config.rs`: runtime config apply orchestration when it grows
  large enough to split from environment handling.
- `handlers/pruning.rs`: `prune_workspace_worktree`. Call AnyHarness
  retire/cleanup APIs and report Cloud workspace materialization state.
- `handlers/backfill.rs`: command entry for `backfill_exposed_workspace`.
  Delegates actual backfill mechanics to `event_uplink/backfill.rs`.

Avoid `handlers/materialization.rs`; it collides with `target/materialization/`
and hides which command family is being handled.

## Event Uplink

`event_uplink/` owns the AnyHarness-to-Cloud runtime event path.

```text
AnyHarness events / snapshots
  -> Worker event uplink
  -> Cloud ingest / projection read models
```

Use `event_uplink`, not `sync`. Worker does not own broad bidirectional sync.
Cloud owns projection read models; Worker owns the uplink mechanics that feed
them.

Files:

- `event_uplink/loop.rs`: long-running event uplink loop. Probes AnyHarness,
  runs one uplink pass, sleeps/backoffs, and observes shutdown.
- `event_uplink/exposures.rs`: fetches and interprets Cloud exposure snapshots
  for this worker.
- `event_uplink/projection_cursors.rs`: reconciles Cloud exposure snapshots
  into local projection cursors.
- `event_uplink/discovery.rs`: discovers sessions inside exposed workspaces
  and triggers backfill when Cloud is missing session mappings.
- `event_uplink/tailer.rs`: tails AnyHarness session events after local cursor
  sequence.
- `event_uplink/event_mapping.rs`: maps AnyHarness event envelopes into worker
  event batch payloads for Cloud.
- `event_uplink/gaps.rs`: detects sequence gaps, reports them to Cloud, and
  marks local cursors paused when needed.
- `event_uplink/backfill.rs`: builds and uploads bounded workspace/session
  snapshots for exposed work.

Allowed:

- reading Cloud exposure/projection inputs
- maintaining local projection cursors
- reading AnyHarness events and snapshots
- uploading event batches and backfill batches to Cloud
- applying Cloud event acknowledgements to local cursors

Banned:

- deciding exposure policy
- owning Cloud projection read model persistence
- reconstructing transcript truth
- mutating AnyHarness state
- command delivery

## Target Status

`target_status/` owns the target health and status reporting flow.

```text
target / AnyHarness / versions
  -> Worker status loop
  -> Cloud heartbeat, inventory, desired-version status
```

Files:

- `target_status/loop.rs`: recurring status loop. Sleeps on the heartbeat
  interval, probes health, sends heartbeat/status, observes desired versions,
  and handles shutdown.
- `target_status/health.rs`: health probes and health summaries, especially
  AnyHarness availability.
- `target_status/heartbeat.rs`: Cloud heartbeat request construction and
  response interpretation.
- `target_status/inventory_report.rs`: target inventory upload orchestration.
- `target_status/update_observation.rs`: desired-version observation and
  delegation to `target/updates`.

`target_status/` may report update status, but it must not apply updates.
Applying updates belongs to supervisor.

## Target

`target/` owns target-local facts and effects.

It can inspect the target and write target-local files. It should not call raw
Cloud endpoints or decide Cloud product policy.

### Target Materialization

`target/materialization/` owns target-local preparation work.

Files:

- `paths.rs`: allowed-root checks, home expansion, symlink traversal defense,
  path normalization, and path safety.
- `files.rs`: atomic/private file writes, directory creation, permissions, and
  common file helpers.
- `env.rs`: environment file materialization.
- `git.rs`: focused Git helpers.
- `git_identity.rs`: target-scoped Git credential/config materialization.
- `repo_checkout.rs`: clone/fetch/checkout and repo identity validation.
- `runtime_config.rs`: runtime config projection files, artifact integrity
  checks, and credential reference helpers.
- `agent_auth.rs`: target-local agent auth synced-file and gateway config
  materialization helpers.
- `manifest.rs`: `.proliferate/**` manifest writing.

Allowed:

- filesystem writes under allowed roots
- Git operations required for checkout/bootstrap
- local credential file writes approved by Cloud-provided plans
- artifact/hash validation
- target-local manifest generation

Banned:

- Cloud materialization plan creation
- Cloud authorization decisions
- raw Cloud HTTP calls
- AnyHarness execution semantics
- supervisor process management

### Target Inventory

`target/inventory/` owns local facts about the machine.

Files:

- `platform.rs`: OS, arch, distro, shell.
- `versions.rs`: local tool version probes.
- `capabilities.rs`: local capability facts.
- `providers.rs`: agent/provider readiness facts.
- `mcp.rs`: local MCP capability facts.

Inventory code should be read-only. It should not mutate target state.

### Target Updates

`target/updates/` owns the worker side of desired-version observation.

Files:

- `desired_versions.rs`: compare Cloud desired versions with observed installed
  versions.
- `supervisor_mailbox.rs`: write and clear supervisor update request files.
- `status.rs`: construct worker update status reports.

Allowed:

- compare desired and installed versions
- write a narrow supervisor mailbox request
- report staged/failed status through callers

Banned:

- downloading binaries
- replacing binaries
- restarting processes
- rollback
- supervisor lifecycle decisions

## Clients

`clients/` owns raw HTTP access boundaries.

Clients are not services. They do not own product workflows.

### Cloud Client

`clients/cloud/` owns worker-facing Cloud HTTP endpoints and wire types.

Examples:

- enrollment
- heartbeat
- inventory upload
- command lease/delivery/result
- exposure listing
- event batch upload
- backfill upload
- target config materialization fetch
- target Git identity materialization fetch
- agent auth materialization fetch/status
- revoked-token listing
- update status

### AnyHarness Client

`clients/anyharness/` owns local AnyHarness HTTP endpoints and wire types.

Examples:

- health/version probe
- workspace resolve/worktree/retire APIs
- session start/prompt/config/cancel/close APIs
- interaction resolution APIs
- event listing
- backfill snapshot
- runtime config apply
- agent auth config apply

Allowed in clients:

- URL construction
- auth headers
- request/response structs
- HTTP status parsing
- small wire compatibility shims

Banned in clients:

- command lifecycle
- retry loops beyond focused request mechanics
- filesystem effects
- store writes
- Cloud policy
- AnyHarness execution semantics

## Store

`store/` owns worker-local SQLite and bridge durability.

The worker store is not product truth. It exists so the bridge can recover from
restarts and transient Cloud failures.

Files:

- `connection.rs`: SQLite connection setup, pragmas, busy timeout.
- `migrations.rs`: worker DB schema creation and migration helpers.
- `identity.rs`: persisted worker identity row.
- `pending_command_results.rs`: command result retry records.
- `projection_cursors.rs`: event uplink cursor state, ack state, and gap state.
- `workspace_mappings.rs`: local AnyHarness workspace/session to Cloud mapping
  cache.
- `workspace_discovery.rs`: exposed-workspace discovery throttling.

Allowed:

- table-shaped CRUD
- row mapping
- local transactions
- migration helpers

Banned:

- Cloud HTTP calls
- AnyHarness HTTP calls
- command processing workflows
- event uplink workflows
- product authorization
- broad "reconcile everything" service methods

Good store APIs are boring:

```rust
save_pending_command_result(...)
list_pending_command_results(...)
delete_pending_command_result(...)
reconcile_projection_cursors(...)
list_active_projection_cursors(...)
update_projection_cursor_ack(...)
upsert_workspace_mapping(...)
```

Bad store APIs hide workflows:

```rust
process_command_result(...)
apply_projection_state(...)
reconcile_everything_for_workspace(...)
```

## Identity

`identity/` owns the worker's Cloud identity lifecycle.

Files:

- `enrollment.rs`: one-time enrollment token exchange and enroll request
  construction.
- `credentials.rs`: in-memory worker identity/credential shape and save/load
  coordination.
- `fingerprint.rs`: target machine fingerprint and hostname helpers.

Persistence for the identity row belongs in `store/identity.rs`.

Conceptual split:

```text
identity/
  Cloud identity lifecycle

store/identity.rs
  SQLite persistence for the identity row
```

## Root Support Files

Keep these boring support files at `src/` root unless they grow enough to earn
a folder:

- `config.rs`: worker config load, parse, sanitize, and private config writes.
- `error.rs`: worker error enum and conversions.
- `logging.rs`: tracing/Sentry/log initialization.
- `observability.rs`: shared diagnostic helpers and correlation conventions.
- `versions.rs`: worker, AnyHarness, and supervisor version helpers.

Do not create an `infra/` folder unless root support files become a real source
of clutter. `infra/` must not become a `utils/` bucket.

## Dependency Direction

Preferred direction:

```text
runtime -> command_downlink / event_uplink / target_status / clients / store / identity

command_downlink -> clients/cloud
command_downlink -> clients/anyharness
command_downlink -> target
command_downlink -> store

event_uplink -> clients/cloud
event_uplink -> clients/anyharness
event_uplink -> store

target_status -> clients/cloud
target_status -> clients/anyharness
target_status -> target

target -> root support files
target -> no clients
target -> no store unless explicitly required for local-only target state

clients -> root support files only
store -> root support files only
identity -> clients/cloud types only when constructing enrollment requests
identity -> store only through narrow save/load helpers
```

When a dependency feels awkward, prefer moving a small DTO or pure helper to the
owning boundary over importing across layers casually.

## Naming Rules

- Use `command_downlink`, not generic `commands`, when naming the whole flow.
- Use `event_uplink`, not `sync`, for AnyHarness-to-Cloud event/projection
  feeding.
- Use `target/materialization` for filesystem/Git/env/auth local effects.
- Do not use `handlers/materialization.rs`; name handlers by command family.
- Do not add `utils.rs`, `helpers.rs`, or `misc.rs`.
- Do not use broad "service" names unless the file owns a clearly named
  workflow boundary.

## Review Checklist

Ask these before adding or moving Worker code:

- Can I tell from the path whether this is command downlink, event uplink,
  target status, target-local effect, client access, store state, identity, or
  runtime composition?
- Is a loop file still boring?
- Did command lifecycle logic land in `processor.rs` instead of the loop?
- Does this command need a custom handler, or can it use the generic AnyHarness
  mapping/dispatch path?
- Did a client start making product decisions?
- Did target materialization start calling Cloud directly?
- Did store become a workflow/service layer?
- Did Worker start owning Cloud auth/exposure policy?
- Did Worker start owning AnyHarness execution or transcript truth?
- Did Worker start owning supervisor update application?
- Are stale-slot, idempotency, and pending-result recovery still visible?
- Do logs include the relevant correlation fields for the flow:
  `command_id`, `lease_id`, `target_id`, `worker_id`, `sandbox_profile_id`,
  `slot_generation`, `cloud_workspace_id`, `anyharness_workspace_id`,
  `session_id`, `session_projection_id`, and `exposure_id` when available?

