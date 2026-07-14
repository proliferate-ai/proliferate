# Worker Lifecycle And Convergence

Status: authoritative for
`anyharness/crates/proliferate-worker/src/lifecycle/**`, `catalog_sync.rs`,
`self_update.rs`, and `anyharness_update.rs`.

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

## Worker Binary Convergence

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

## AnyHarness Binary Convergence

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
stop, or swap failures are retried on a later heartbeat.

## Launch Policy

Both update gates default to disabled. Desktop owns its bundled binaries and
leaves them disabled. The current cloud-sandbox sidecar configuration enables
both. There is no Worker-to-Supervisor update mailbox in this implementation.

## Hard Rules

- Treat every convergence action as non-fatal to the heartbeat loop.
- Verify the artifact and exact desired version before replacing a binary.
- Keep Worker and AnyHarness update gates independent.
- Preserve `.prev` rollback for AnyHarness; do not claim equivalent rollback
  for the Worker's own `exec` update.
- Do not add Supervisor lifecycle behavior to this crate.
