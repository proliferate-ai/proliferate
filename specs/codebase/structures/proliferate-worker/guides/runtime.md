# Worker Runtime

Status: authoritative for `anyharness/crates/proliferate-worker/src/main.rs`
and `runtime.rs`.

`main.rs` initializes telemetry, parses `--config` and `--once`, loads
`WorkerConfig`, and calls `runtime::run`. It captures a terminal error for
Sentry but does not own Worker behavior.

## Startup

`runtime::run` performs the current startup in this order:

```text
acquire the process lock beside the Worker database
  -> open and migrate Worker-local SQLite
  -> build CloudClient
  -> load durable identity or enroll once
  -> after a fresh enrollment, write integration-gateway credentials
  -> create in-memory catalog-sync state
  -> heartbeat and converge once
  -> if --once: return
  -> otherwise: sleep for the configured interval and repeat
```

There is one loop. The Worker does not spawn command, event-tail, inventory,
or materialization loops, and it has no custom shutdown coordinator.

## One Tick

```text
POST heartbeat
  -> on failure: log and retry next tick
  -> catalog convergence (non-fatal)
  -> AnyHarness binary convergence (non-fatal; optional)
  -> Worker binary convergence (non-fatal; optional)
```

The order matters. A successful Worker self-update ends by replacing the
current process image with `exec`, so catalog and AnyHarness convergence run
first.

`--once` sends one heartbeat and can synchronize the catalog, but it reports
pending binary updates without applying either binary swap.

## Failure Boundary

After startup, a failed heartbeat or convergence action does not terminate the
loop. The current Worker and runtime continue serving where possible, and a
later heartbeat retries according to the owning module's rules.

Enrollment and local-store failures are startup failures because the loop
cannot authenticate or preserve its required identity without them.

## Hard Rules

- Keep dependency construction and ordering in `runtime.rs`; keep each action
  in its owning module.
- Do not add a broad context object until multiple real consumers require it.
- Do not turn the runtime loop into a command scheduler or process supervisor.
- Preserve the convergence order unless the update safety model changes.
- Keep `--once` non-destructive for binary updates.
