# Worker Runtime

Status: authoritative for `anyharness/crates/proliferate-worker/src/runtime/**`.

`runtime/` owns process composition and lifecycle. It starts the worker, builds
shared dependencies, starts named loops, and coordinates shutdown.

## Goal

```text
initialize -> build shared context -> start named flows -> coordinate shutdown
```

`runtime/` may know every subsystem exists. It must not implement those
subsystems.

## Target Shape

```text
runtime/
  mod.rs
  context.rs
  tasks.rs
  shutdown.rs
```

## What Goes Where

| File | Owns | Must Not Own |
| --- | --- | --- |
| `mod.rs` | Public `run(config, once)` entrypoint and startup choreography. | Command, event, status, or target workflow implementation. |
| `context.rs` | `WorkerContext` construction: config, store, clients, identity, and static process metadata. | Per-loop computed state such as supported command kinds, active cursors, heartbeat payloads, or event batches. |
| `tasks.rs` | Named task spawning, task handles, unexpected-exit logging, and task joins. | Loop internals or workflow decisions. |
| `shutdown.rs` | OS signal handling, cancellation notification, join timeout, and final drain hooks. | Command processing, event tailing, or target materialization logic. |

## Worker Context

Long-lived dependencies used by multiple loops belong in `WorkerContext`.

Target shape:

```rust
pub struct WorkerContext {
    pub config: WorkerConfig,
    pub store: WorkerStore,
    pub cloud: CloudClient,
    pub identity: WorkerIdentity,
    pub anyharness: Option<AnyHarnessClient>,
    pub versions: InstalledVersions,
}
```

State that changes per loop pass does not belong in `WorkerContext`.

Examples:

- command lease state
- supported command kinds
- active event cursors
- current heartbeat request
- materialization command payload
- event batch payload

## Hard Rules

- `runtime/mod.rs` reads like process choreography.
- `context.rs` builds dependencies; it does not derive per-loop policy.
- `tasks.rs` knows which loops exist; it does not know how they work.
- Shutdown may trigger final drains, but it does not contain command or event
  workflow logic.
- Runtime delegates heartbeat semantics to `target_status`, command semantics
  to `command_downlink`, event cursor mechanics to `event_uplink`, target-local
  effects to `target`, and identity lifecycle to `identity`.
