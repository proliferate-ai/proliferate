# Proliferate Worker Standards

Status: authoritative for `anyharness/crates/proliferate-worker/**`.

## Scope

These standards apply to the target-side Proliferate Worker binary:

- `anyharness/crates/proliferate-worker/**`

Proliferate Worker is the target-side bridge between Proliferate Cloud and the
local AnyHarness runtime. It runs on the target, connects outbound to Cloud,
leases commands, calls local AnyHarness or performs target-local preparation,
and uploads results, status, inventory, and runtime events back to Cloud.

The worker is not Cloud, not AnyHarness, and not supervisor.

```text
Cloud -> Worker -> AnyHarness / target
  command downlink

AnyHarness -> Worker -> Cloud
  event uplink

target -> Worker -> Cloud
  target status
```

## Goal

The worker is organized into distinct folders for process composition, Cloud
command delivery, AnyHarness event uplink, target health reporting, target-local
effects, raw clients, local durability, identity, and root support files.

The explicit goals are:

- make the two bridge directions obvious from the path
- keep loops boring and keep workflow semantics in the owning folder
- separate raw HTTP access from Worker-owned command, event, and target logic
- keep target-local filesystem/Git/auth effects out of Cloud and AnyHarness
  clients
- make restart recovery, idempotency, stale-slot checks, and cursor durability
  visible instead of incidental

A file path should tell a developer whether the code is downlink, uplink,
target status, target-local effect, client access, store persistence, identity,
or runtime composition before they open the file.

## Target Shape

Existing code that violates this shape is a migration exception, not precedent.
Do not create empty folders; add a file or folder when it has real
responsibility to own.

```text
src/
  main.rs

  runtime/
    mod.rs
    context.rs
    tasks.rs
    shutdown.rs

  command_downlink/
    mod.rs
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

  event_uplink/
    mod.rs
    loop.rs
    exposures.rs
    cursors.rs
    discovery.rs
    tailer.rs
    event_mapping.rs
    gaps.rs
    backfill.rs

  target_status/
    mod.rs
    loop.rs
    health.rs
    heartbeat.rs
    inventory_report.rs
    update_observation.rs

  target/
    mod.rs
    materialization/
      mod.rs
    inventory/
      mod.rs
    updates/
      mod.rs

  clients/
    mod.rs
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
    mod.rs
    enrollment.rs
    credentials.rs
    fingerprint.rs

  config.rs
  error.rs
  logging.rs
  observability.rs
  versions.rs
```

## What Goes Where

Use the lowest layer that can own the logic cleanly.

| Area | Path | Owns | Must Not Own | Canon |
| --- | --- | --- | --- | --- |
| Process entry | `src/main.rs` | CLI/config entry, logging bootstrap, and call into `runtime::run`. | Worker workflows or subsystem policy. | This doc, [guides/runtime.md](guides/runtime.md) |
| Runtime | `src/runtime/**` | Process composition, shared context construction, task spawning, task joins, and shutdown. | Command kinds, event cursors, heartbeat payload semantics, target materialization, raw workflow logic. | [guides/runtime.md](guides/runtime.md) |
| Command downlink | `src/command_downlink/**` | Cloud command lease polling, supported-kind policy, one-command lifecycle, AnyHarness dispatch mapping, custom handlers, delivery/result reporting, idempotency, stale-slot checks. | Cloud authorization, exposure policy, event tailing, target inventory, raw HTTP implementation, supervisor update application. | [guides/command-downlink.md](guides/command-downlink.md) |
| Event uplink | `src/event_uplink/**` | Cloud exposure interpretation, local event cursors, AnyHarness event tailing, gap detection, event mapping, backfill, Cloud batch upload, ack application. | Exposure policy, Cloud projection persistence, transcript reconstruction, AnyHarness mutation, command delivery. | [guides/event-uplink.md](guides/event-uplink.md) |
| Target status | `src/target_status/**` | Target health/status loop, AnyHarness health probe summaries, heartbeat payloads, inventory upload orchestration, desired-version observation. | Applying updates, target materialization, command processing, Cloud policy. | [guides/target-status.md](guides/target-status.md) |
| Target-local effects | `src/target/**` | Filesystem/Git/env/auth/runtime-config materialization, local inventory inspection, capability inspection, supervisor update mailbox writing. | Raw Cloud HTTP, Cloud policy, AnyHarness execution semantics, supervisor process management. | [guides/target.md](guides/target.md) |
| Clients | `src/clients/**` | Raw Worker-facing Cloud HTTP endpoints, local AnyHarness HTTP endpoints, request/response wire types, auth headers, status parsing. | Product workflows, retry loops beyond request mechanics, store writes, filesystem effects. | [guides/clients.md](guides/clients.md) |
| Store | `src/store/**` | Worker-local SQLite, migrations, identity row access, pending command results, event cursors, workspace/session mapping caches, discovery throttles. | Cloud/AnyHarness HTTP, command processing, event uplink workflows, product authorization, service-layer reconciliation. | [guides/store.md](guides/store.md) |
| Identity | `src/identity/**` | Enrollment, durable Worker identity, credential load/save coordination, fingerprint and hostname hints. | Heartbeat scheduling, command leasing, supported-kind policy, AnyHarness auth behavior, target inventory. | [guides/identity.md](guides/identity.md) |
| Root support files | `src/config.rs`, `src/error.rs`, `src/logging.rs`, `src/observability.rs`, `src/versions.rs` | Cross-cutting support that is small, boring, and not a subsystem. | Workflows, generic utilities, hidden service layers. | [guides/root-support.md](guides/root-support.md) |

## Read Order

Always start here. Then read the focused guide for the folder being changed:

- [guides/runtime.md](guides/runtime.md)
- [guides/command-downlink.md](guides/command-downlink.md)
- [guides/event-uplink.md](guides/event-uplink.md)
- [guides/target-status.md](guides/target-status.md)
- [guides/target.md](guides/target.md)
- [guides/clients.md](guides/clients.md)
- [guides/store.md](guides/store.md)
- [guides/identity.md](guides/identity.md)
- [guides/root-support.md](guides/root-support.md)

When behavior crosses Worker boundaries, also read the primitive or system doc
that owns the external contract:

- Cloud commands: `docs/primitives/cloud-commands.md`
- Sandbox provisioning: `docs/primitives/sandbox-provisioning.md`
- Workspace lifecycle: `docs/primitives/workspace-lifecycle.md`
- Agent auth: `docs/primitives/agent-auth.md`
- MCPs and skills: `docs/primitives/mcp-runtime.md` and
  `docs/primitives/mcp-skills.md`
- Server control plane: `docs/structures/server/README.md`
- AnyHarness runtime: `docs/structures/anyharness/README.md`

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

Supervisor structure rules live in
`docs/structures/proliferate-supervisor/README.md`.

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

## Hard Rules

- Worker must not own Cloud authorization or exposure policy.
- Worker must not own AnyHarness execution truth or transcript reconstruction.
- Worker must not mutate AnyHarness SQLite directly.
- Worker must not own supervisor install, restart, rollback, or binary
  replacement.
- Worker must not implement broad bidirectional sync. Use `event_uplink`, not
  `sync`, for AnyHarness-to-Cloud event/projection feeding.
- Use `command_downlink`, not generic `commands`, for the Cloud-to-target
  command flow.
- Use `target/materialization` for filesystem/Git/env/auth local effects.
- Do not use `handlers/materialization.rs`; name handlers by command family.
- Do not add `utils.rs`, `helpers.rs`, `misc.rs`, or broad service buckets.
- Preserve current behavior unless an explicit behavior change is requested.
- Delete dead code when replacing an implementation.

## Review Checklist

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
- Are stale-slot, idempotency, pending-result recovery, and event cursor
  recovery still visible?
- Do logs include the relevant correlation fields for the flow:
  `command_id`, `lease_id`, `target_id`, `worker_id`, `sandbox_profile_id`,
  `slot_generation`, `cloud_workspace_id`, `anyharness_workspace_id`,
  `session_id`, `session_projection_id`, and `exposure_id` when available?
