# Worker Runtime

Status: authoritative for `anyharness/crates/proliferate-worker/src/runtime.rs`
(and `main.rs`).

`runtime.rs` is the internal loop supervisor. `main.rs` is thin — parse args,
bootstrap logging, call `runtime::run`. `runtime.rs` enrolls, builds the shared
context, spawns the polls, and runs the heartbeat main loop. It may know every
subsystem exists; it must not implement them.

## Goal

```text
enroll → build shared context → spawn control + tail → run the heartbeat main loop → coordinate shutdown
```

## Startup Choreography

```text
process_lock (single instance)
  → identity::ensure_enrolled
  → build WorkerContext (config, store, clients, identity, versions)
  → inventory snapshot (report once)
  → spawn task: control::run_loop   (down: commands + reconcile)
  → spawn task: tail::run_loop      (up: events)
  → run lifecycle heartbeat as the main loop (carries the self-update check)
  → on signal: cancel tasks, join with timeout, final drain
```

`control` and `tail` are the two spawned poll tasks; the heartbeat is the main
loop itself, not a third spawned poll.

## Worker Context

Long-lived dependencies used by multiple loops belong in `WorkerContext`:

```rust
pub struct WorkerContext {
    pub config: WorkerConfig,
    pub store: WorkerStore,
    pub cloud: CloudClient,
    pub anyharness: AnyHarnessClient,
    pub identity: WorkerIdentity,
    pub versions: InstalledVersions,
}
```

State that changes per loop pass does not belong in `WorkerContext` — e.g.
supported command kinds, active event cursors, the current heartbeat request, a
reconcile bundle, or an event batch payload.

## Hard Rules

- `main.rs` is thin; `runtime.rs` reads like process choreography.
- `runtime.rs` builds dependencies and spawns tasks; it does not derive per-loop
  policy.
- Shutdown may trigger final drains, but it does not contain command, reconcile,
  or event workflow logic.
- Runtime delegates command + reconcile semantics to `control`, event mechanics
  to `tail`, heartbeat + self-update to `lifecycle`, target-local effects to
  `materialization`, and identity lifecycle to `identity`.
- If `runtime.rs` grows real internal structure, split it into a `runtime/`
  folder (`context`, `tasks`, `shutdown`) rather than fattening one file.
