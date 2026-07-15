# Worker Lifecycle And Convergence

The Worker heartbeat is both its liveness signal and the carrier for desired
catalog and binary versions.

```text
POST /v1/cloud/worker/heartbeat
  request: status=online, Worker version, current AnyHarness version
  response: acknowledgement + optional desiredVersions
```

The interval is `heartbeat_interval_seconds` from local configuration with a
10-second minimum. The enrollment response also includes an interval, but the
current Worker does not apply that response value.

Cloud derives liveness from an `online` row with a recent `last_seen_at`. The
Worker reports `online`; current application code does not transition the row
to the schema's `offline` status.

## Catalog Convergence

When `desiredVersions.catalogVersion` differs from AnyHarness's active
catalog version:

```text
GET AnyHarness /v1/catalogs/agents/version
  -> GET Cloud /v1/catalogs/agents (ETag-aware)
  -> PUT the catalog bytes to AnyHarness /v1/catalogs/agents
```

Catalog state (the last ETag) is in memory. A 404 from the runtime version
endpoint is treated as an older runtime without catalog-sync support. Other
failures are logged and retried on a later heartbeat.

## Supervisor-Owned Convergence (mailbox)

`heartbeat_and_converge` in `runtime.rs` branches on
`supervisor_bridge::is_supervisor_owned(config)` (whether
`supervisor_update_request_dir` is set). The D5 bridge (`maybe_run_bridge`) runs
first on the `supervisor_owned` topology signal from either branch; then
supervisor-owned targets route to `converge_via_mailbox` (the mailbox write)
instead of `converge_anyharness_runtime` + the legacy `self_update` swap;
non-supervisor targets keep the legacy path unchanged. The module, its config
fields, and its inline tests are in place and the wiring is live.

When `WorkerConfig.supervisor_update_request_dir` is set (a supervisor-owned
target — the server sets this instead of the legacy update-enabled flags),
AnyHarness and Worker binary divergence is **not** actioned in this crate.
Instead `supervisor_bridge::write_update_request` resolves the same artifact
coordinates the legacy path would (public artifact redirect, sibling
`.sha256`, size) and atomically writes one request into
`.proliferate/supervisor/updates`:

```text
desiredVersions diverges from the running AnyHarness/Worker version
  -> resolve artifact_url / sha256 / size_bytes (no download)
  -> build UpdateRequestV1 { request_id = deterministic(component, version), ... }
  -> write_request(dir, &request)   # atomic tmp+rename, 0700/0600
```

`request_id` is derived deterministically from `(component, version)`, so a
replayed heartbeat for the same divergence overwrites the same file rather
than enqueuing a duplicate; Proliferate Supervisor's own idempotency check
(`result_exists`) guarantees exactly one activation. The Worker never reads
the result file to drive behavior — convergence is observed the ordinary way,
through the next heartbeat reporting the version AnyHarness/`--version`
actually serves after Supervisor restarts it.

See [`proliferate-supervisor/README.md`](../../proliferate-supervisor/README.md)
for the consumer side (verify, download, stage, activate, health-gate,
rollback).

### One-time bridge to Supervisor ownership

When a heartbeat ack carries `desired_topology == "supervisor_owned"`, a
legacy Worker on an already-provisioned target performs a one-time hand-off:
write Supervisor config, start Supervisor detached, confirm it took ownership
(adopted/started AnyHarness, spawned its own Worker child), then exit cleanly.
This is idempotent and crash-safe: a `bridge.started`/`bridge.done` marker
pair plus a Supervisor-liveness check prevent starting a second Supervisor
after a crash mid-bridge. The live bridge proof against a real target is
deferred with the rest of Tier 4; this crate's tests cover idempotency,
marker-file crash recovery, and the no-double-Supervisor invariant
deterministically.

## Worker Binary Convergence (legacy, non-supervisor-owned targets)

`self_update_enabled` defaults to false. When enabled and the desired Worker
version differs:

```text
download public Worker artifact through Cloud redirect
  -> download sibling .sha256 from the resolved artifact directory
  -> verify checksum
  -> stage beside current executable
  -> preflight --version against the desired version
  -> atomically rename over the current executable
  -> exec the new binary with the current arguments
```

The Worker update does not keep a `.prev` health rollback. Failures before the
rename leave the current binary in place. A version marker carried across
`exec` prevents repeated swaps for the same pin if the replacement still does
not report that version.

This path is deprecated: it stays compilable only for legacy
(non-supervisor-owned) targets during the bridge window and logs a
deprecation warning when it runs. Its deletion is a named follow-up after
that window closes.

## AnyHarness Binary Convergence (legacy, non-supervisor-owned targets)

`anyharness_update_enabled` also defaults to false and has independent config
for the fixed binary, launcher, and working-directory paths. When enabled and
the desired AnyHarness version differs:

```text
download + checksum + preflight candidate
  -> stop only the AnyHarness process identified by the fixed binary path
  -> move current binary to .prev and candidate to the fixed path
  -> relaunch through the existing launcher
  -> require /health to report the desired version
  -> on failure, restore .prev and relaunch
```

The store records the last health-verified version. After a relaunch or health
gate failure it also records the failed pin; that recorded pin is not retried
until a different desired version supersedes it. Earlier staging, preflight,
stop, or swap failures are retried on a later heartbeat. This path is
deprecated: it stays compilable only for legacy targets during the bridge
window and logs a deprecation warning when it runs.

## Launch Policy

Both legacy update gates (`self_update_enabled`, `anyharness_update_enabled`)
default to disabled. Desktop owns its bundled binaries and leaves them
disabled. On a supervisor-owned cloud-sandbox target the server writer stops
emitting `anyharness_update_enabled=true` and instead emits
`supervisor_update_request_dir`, so the mailbox path in the previous section
runs and the legacy gates stay off. A non-supervisor-owned (legacy) target
still gets the same `anyharness_update_enabled=true` sidecar configuration as
before. `supervisor_owned_runtime` is a server-side flag, default off at
merge; it does not change local Worker behavior directly, only which config
the server writes.

## Hard Rules

- Treat every convergence action as non-fatal to the heartbeat loop.
- Verify the artifact and exact desired version before replacing a binary or
  before writing it into a mailbox request.
- Keep Worker and AnyHarness update gates independent.
- Preserve `.prev` rollback for AnyHarness; do not claim equivalent rollback
  for the Worker's own legacy `exec` update. On a supervisor-owned target,
  rollback for both AnyHarness and Worker is Proliferate Supervisor's
  responsibility, not this crate's.
- Do not add Supervisor lifecycle behavior (download, stage, activate,
  health-gate, or rollback) to this crate; the mailbox write is the only new
  surface here.
