# Proliferate Worker

Status: authoritative for `anyharness/crates/proliferate-worker/**`.

Proliferate Worker is an optional process beside AnyHarness. It enrolls with
Cloud once, sends heartbeats, and converges the local catalog, Worker binary,
and AnyHarness binary when its launch configuration enables those paths.

It is not a Cloud command runner. It does not lease commands, materialize
workspaces, upload session events, maintain Cloud projections, or send update
requests to Proliferate Supervisor. Cloud reaches AnyHarness directly for the
current workspace and session flows.

## Current Process

```text
config + single-process lock + local SQLite
  -> load durable Worker identity, or exchange one enrollment token
  -> write integration-gateway credentials after a fresh enrollment
  -> heartbeat Cloud
  -> use desiredVersions to converge, in order:
       agent catalog
       AnyHarness binary (when enabled)
       Worker binary (when enabled; successful swap execs the new binary)
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
| `self_update.rs` | Verify, preflight, swap, and exec the Worker binary | AnyHarness or Supervisor updates | [Lifecycle](guides/lifecycle.md) |
| `anyharness_update.rs` | Verify, stop, swap, relaunch, health-gate, and roll back AnyHarness | General runtime lifecycle | [Lifecycle](guides/lifecycle.md) |
| `integration_gateway.rs` | Write the private gateway credential file returned by enrollment | Credential issuance or recovery | [Identity](guides/identity.md) |
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
anyharness_update
  -> store (converged version and failed pin) + narrow AnyHarness health probe

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
  integration-gateway bearer is written for AnyHarness to consume.
- Never follow redirects on authenticated Cloud requests; public artifact
  downloads use a separate redirect-following client.
- Keep update gates disabled unless the launcher owns this binary lifecycle.
  Desktop leaves both gates disabled; the cloud-sandbox sidecar enables both.
- Keep Worker-local SQLite private and limited to restart-critical Worker
  state. It is not Cloud or AnyHarness product truth.
- Do not add command polls, event tails, target/profile state, workspace
  materialization, or a Supervisor mailbox without an approved product change.
- A missing or invalid durable credential has no automatic re-enrollment path.
  Do not invent destructive recovery in this crate.
