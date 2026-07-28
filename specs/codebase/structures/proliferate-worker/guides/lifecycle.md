# Worker Lifecycle And Convergence

The Worker heartbeat is both its liveness signal and the carrier for desired
binary versions. Binary versions are all it carries: the agent catalog rides
inside the runtime binary, so there is no catalog version on the wire.

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

After a successful heartbeat, a process that freshly enrolled compares its
in-memory integration-gateway credential with the shared runtime dotfile and
repairs the file only when it differs. The check is intentionally after
authentication: once a superseded Worker's heartbeat fails, it cannot keep
reasserting a revoked gateway token. A success returned immediately before
revocation can race one final stale write, which the active successor repairs
on its next successful heartbeat.

## Catalog Convergence (none)

There is no catalog convergence in this crate: the agent catalog ships only
inside the runtime binary, so the AnyHarness binary swap below IS the catalog
update
([agent-distribution.md](../../../platforms/product/agent-distribution.md)
"Convergence"). The Worker has no served catalog version to compare, no
document to fetch, and no push route to call. Do not reintroduce one — a
faster catalog lane would break the invariant that the active catalog is
immutable for the lifetime of the runtime process.

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
after a crash mid-bridge. The live D5 BRIDGE proof against a real target
PASSED 2026-07-26 (sandbox `iwwvadhffzxoora56f437`: a running legacy sandbox
migrated onto the Supervisor-owned topology in place, ~2.5s, no
destroy/recreate); this crate's tests separately cover idempotency,
marker-file crash recovery, and the no-double-Supervisor invariant
deterministically.

**Expected log signature of a real bridge.** The Supervisor's first spawned
Worker child cannot immediately acquire the exclusive, non-blocking `flock`
on `worker.sqlite3` (`WorkerProcessLock::acquire` in `process_lock.rs`)
because the bridging legacy Worker still holds it while it confirms
Supervisor ownership and exits. That first child therefore exits once with a
lock-contention error (`WorkerError::AlreadyRunning`); the Supervisor's
restart loop (`restart_delay_seconds`, default 5s) relaunches it, and the
second attempt acquires the now-released lock cleanly. One early exit
followed by a clean restart ~5s later, exactly once per bridge, is the
expected successful signature — not a crash loop. A signature that repeats
past that single generation indicates the bridge itself failed to hand off
ownership (the bridging Worker never exited).

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
disabled. Every managed-cloud (E2B) target is now always supervisor-owned:
the server's `build_worker_config` (`server/proliferate/server/cloud/runtime/bootstrap.py`)
only ever emits `supervisor_update_request_dir`, never
`anyharness_update_enabled=true` — calling it with `supervisor_owned=False`
raises `ValueError` because the legacy independent-launch config shape was
deleted. So the mailbox path in the previous section is the only convergence
path a cloud-sandbox target's Worker config can express.

SSH-installed targets are a separate story: `install/proliferate-target-install.sh`
does not set `self_update_enabled`, `anyharness_update_enabled`, or
`supervisor_update_request_dir` in the Worker config it writes, so all three
stay at their Rust-side defaults (both update gates false, mailbox dir
absent). An SSH target therefore gets neither the legacy in-place binary
swap nor the mailbox path — Worker binary convergence is off there today.
Proliferate Supervisor still owns process supervision for SSH targets (the
installer's systemd unit runs `proliferate-supervisor`, not the Worker
directly); only the Worker's own binary-convergence gates are unset.

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
