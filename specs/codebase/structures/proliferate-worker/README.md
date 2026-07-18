# Proliferate Worker

Proliferate Worker is an optional process beside AnyHarness. It enrolls with
Cloud once, sends heartbeats, and converges the local catalog and, depending
on target topology, either the AnyHarness/Worker binaries directly or a
durable update request into a Proliferate Supervisor mailbox.

It is not a Cloud command runner. It does not lease commands, materialize
workspaces, upload session events, or maintain Cloud projections. Cloud
reaches AnyHarness directly for the current workspace and session flows.

On a **supervisor-owned target** (`supervisor_update_request_dir` set in
config — server-controlled, gated behind `supervisor_owned_runtime`), the
Worker never downloads, replaces, kills, or rolls back AnyHarness or itself.
It only observes heartbeat divergence and writes one durable request into
`.proliferate/supervisor/updates` for Proliferate Supervisor to act on; see
[Lifecycle](guides/lifecycle.md) and
[`proliferate-supervisor/README.md`](../proliferate-supervisor/README.md) for
the consumer side. On a **legacy (non-supervisor-owned) target** the Worker
still performs the in-place AnyHarness/Worker binary swap described below;
that path is deprecated and scheduled for deletion after the one-time
bridge window (see decision 7 in the frozen delivery spec for this change).

## Implementation Status (this PR)

The mailbox-write module described below (`supervisor_bridge.rs`, its
`WorkerConfig` fields, and the `HeartbeatResponse.desired_topology` field) is
implemented, unit-tested, and wired into the heartbeat loop.
`runtime.rs::heartbeat_and_converge` first runs `maybe_run_bridge` (the D5 bridge
on the `supervisor_owned` topology signal, reachable from BOTH branches so an
already-provisioned legacy Worker migrates too), then branches on
`supervisor_bridge::is_supervisor_owned(config)` (mailbox dir set): supervisor-owned
targets route to `converge_via_mailbox` (the mailbox write) instead
of the legacy `converge_anyharness_runtime` + `self_update` swap, which stays
byte-for-byte unchanged for non-supervisor targets. The "Current Process"
outline below describes running behavior. The live E2B N-1→N proof is deferred
with the rest of Tier 4. See
[Lifecycle](guides/lifecycle.md#supervisor-owned-convergence-mailbox) for detail.

## Current Process

```text
config + single-process lock + local SQLite
  -> load durable Worker identity, or exchange one enrollment token
  -> write integration-gateway credentials after a fresh enrollment
  -> heartbeat Cloud
  -> after each successful heartbeat, repair that fresh gateway credential if
     a revoked predecessor overwrote the shared file
  -> use desiredVersions to converge, in order:
       agent catalog
       AnyHarness binary:
         supervisor-owned target -> write a mailbox update request
         legacy target (when enabled) -> in-place swap (deprecated)
       Worker binary:
         supervisor-owned target -> write a mailbox update request
         legacy target (when enabled) -> in-place swap + exec (deprecated)
  -> on a heartbeat ack requesting supervisor-owned topology, an
     already-provisioned legacy Worker performs the one-time bridge to
     Proliferate Supervisor (idempotent, crash-safe) and exits
  -> sleep and repeat
```

Worker startup is best-effort in a cloud sandbox. The direct AnyHarness path
can remain healthy when the Worker is absent or unhealthy.

## Current Source Tree

```text
src/
├── main.rs
├── runtime.rs
├── config.rs
├── error.rs
├── logging.rs
├── observability.rs
├── process_lock.rs
├── versions.rs
├── integration_gateway.rs
├── catalog_sync.rs
├── self_update.rs
├── anyharness_update.rs
├── supervisor_bridge.rs
├── cloud_client/
│   ├── mod.rs
│   ├── auth.rs
│   └── heartbeat.rs
├── identity/
│   ├── mod.rs
│   ├── enrollment.rs
│   ├── credentials.rs
│   └── fingerprint.rs
├── lifecycle/
│   ├── mod.rs
│   └── heartbeat.rs
└── store/
    ├── mod.rs
    ├── connection.rs
    ├── migrations.rs
    ├── identity.rs
    └── anyharness_update.rs
```

Do not create folders for removed or hypothetical command, event-tail,
inventory, or materialization subsystems.

## Ownership Map

| Area | Owns | Does not own | Guide |
| --- | --- | --- | --- |
| `main.rs`, `runtime.rs` | CLI entry, dependency construction, one heartbeat-and-convergence loop | Product workflows or background task supervision | [Runtime](guides/runtime.md) |
| `identity/**` | Enrollment request, durable Worker credential, fingerprint | Sandbox identity, command identity, re-enrollment policy | [Identity](guides/identity.md) |
| `lifecycle/heartbeat.rs` | Heartbeat cadence, request, and acknowledgement | Update execution or server-side liveness policy | [Lifecycle](guides/lifecycle.md) |
| `catalog_sync.rs` | Compare catalog versions, fetch from Cloud, push to AnyHarness | General AnyHarness access | [Lifecycle](guides/lifecycle.md), [Clients](guides/clients.md) |
| `self_update.rs` | Verify, preflight, swap, and exec the Worker binary on a **legacy** (non-supervisor-owned) target; deprecated, scheduled for deletion after the bridge window | AnyHarness or Supervisor updates, any behavior on a supervisor-owned target | [Lifecycle](guides/lifecycle.md) |
| `anyharness_update.rs` | Verify, stop, swap, relaunch, health-gate, and roll back AnyHarness on a **legacy** target; deprecated, scheduled for deletion after the bridge window | General runtime lifecycle, any behavior on a supervisor-owned target | [Lifecycle](guides/lifecycle.md) |
| `supervisor_bridge.rs` | Write one durable mailbox update request per diverging heartbeat on a supervisor-owned target; the one-time D5 bridge that hands an already-provisioned legacy target to Proliferate Supervisor | Update download, verification, activation, health-gating, or rollback (Supervisor owns all of that) | [Lifecycle](guides/lifecycle.md) |
| `integration_gateway.rs` | Write the private gateway credential file returned by enrollment and repair it after an authenticated heartbeat when a predecessor overwrote it | Credential issuance or re-enrollment | [Identity](guides/identity.md) |
| `cloud_client/**` | Raw Cloud HTTP and wire shapes | Convergence decisions or local persistence | [Clients](guides/clients.md) |
| `store/**` | Durable Worker identity and AnyHarness update state in local SQLite | Cloud or AnyHarness product truth | [Store](guides/store.md) |
| Root support files | Configuration, errors, telemetry, process locking, version reporting | Hidden service layers | [Root support](guides/root-support.md) |

## Read Order

Read this file first, then the focused owner:

- [Runtime](guides/runtime.md)
- [Identity](guides/identity.md)
- [Lifecycle and convergence](guides/lifecycle.md)
- [HTTP clients](guides/clients.md)
- [Local store](guides/store.md)
- [Root support](guides/root-support.md)

For behavior outside the crate, use the current owners:

- [Server structure](../server/README.md)
- [AnyHarness structure](../anyharness/README.md)
- [Sandbox provisioning](../../platforms/product/sandbox-provisioning.md)
- [Repository environments and workspace provisioning](../../platforms/product/workspace-provisioning.md)
- [Workspace lifecycle](../../platforms/product/workspace-lifecycle.md)
- [Billing](../../platforms/product/billing.md)

## Dependency Direction

```text
main
  -> config + logging + runtime

runtime
  -> process_lock + store + cloud_client + identity
  -> lifecycle/heartbeat
  -> catalog_sync
  -> anyharness_update
  -> self_update

identity
  -> cloud_client (enroll) + store (durable identity) + config sanitation

catalog_sync
  -> cloud_client (catalog fetch) + narrow direct AnyHarness GET/PUT

self_update / anyharness_update
  -> heartbeat response + cloud_client artifact downloads
  -> legacy (non-supervisor-owned) targets only
anyharness_update
  -> store (converged version and failed pin) + narrow AnyHarness health probe

supervisor_bridge
  -> heartbeat response + cloud_client artifact-coordinate resolution
     (writes the mailbox request; never acts on it)
  -> config (bridge paths) for the one-time D5 hand-off

store and cloud_client
  -> root support only
```

`catalog_sync.rs` currently owns its narrow AnyHarness GET/PUT calls directly,
and `anyharness_update.rs` owns its health probe. There is no general
`anyharness_client` boundary in this crate.

## Hard Rules

- Keep `main.rs` thin and keep `runtime.rs` readable as process choreography.
- Treat the durable Worker token as the only credential the Worker uses for
  its own post-enrollment Cloud requests. The separately returned
  integration-gateway bearer is written for AnyHarness to consume. A Worker
  may reassert the bearer retained from its own fresh enrollment only after
  that Worker's heartbeat authenticates successfully; after heartbeat rejects
  that Worker it must not rewrite shared gateway authority again.
- Never follow redirects on authenticated Cloud requests; public artifact
  downloads use a separate redirect-following client.
- Keep update gates disabled unless the launcher owns this binary lifecycle.
  Desktop leaves both gates disabled; the cloud-sandbox sidecar enables both.
- Keep Worker-local SQLite private and limited to restart-critical Worker
  state. It is not Cloud or AnyHarness product truth.
- Do not add command polls, event tails, target/profile state, or workspace
  materialization to this crate.
- On a supervisor-owned target, the Worker never downloads, replaces, kills,
  or rolls back AnyHarness or itself — it only writes a durable mailbox
  request (`supervisor_bridge.rs`) and lets Proliferate Supervisor act.
  `self_update.rs`/`anyharness_update.rs` stay compilable only for the
  legacy-target/bridge-window path and must keep logging a deprecation
  warning when they run; do not extend them with new capability.
- A missing or invalid durable credential has no automatic re-enrollment path.
  Do not invent destructive recovery in this crate.
