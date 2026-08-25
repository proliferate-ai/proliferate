# Proliferate Worker

Proliferate Worker is an optional process beside AnyHarness. It enrolls with
Cloud once, sends heartbeats, and — when a heartbeat ack reports version
divergence — writes a durable update request into a Proliferate Supervisor
mailbox. The agent catalog is not converged here: it ships only inside the
runtime binary
([agent-distribution.md](codebase/platforms/product/agent-distribution.md)),
so binary convergence is catalog convergence.

It is not a Cloud command runner. It does not lease commands, materialize
workspaces, upload session events, or maintain Cloud projections. Cloud
reaches AnyHarness directly for the current workspace and session flows.

## Harness launch-option synchronization

`launch_options_sync.rs` reads the runtime's per-harness launch-option state on
the heartbeat schedule and uploads only changed basis/revision documents. The
server heartbeat eligibility bit gates all work. Payloads are copied verbatim;
the Worker does not interpret models, controls, defaults, or evidence. A server
denial after advertised eligibility is a bounded contract contradiction and
does not advance the local last-pushed revision.

On a **supervisor-owned target** (`supervisor_update_request_dir` set in
config — every managed-cloud target, unconditionally), the Worker never
downloads, replaces, kills, or rolls back AnyHarness or itself.
It only observes heartbeat divergence and writes one durable request into
`.proliferate/supervisor/updates` for Proliferate Supervisor to act on; see
the [Lifecycle](#worker-lifecycle-and-convergence) section below and [specs/supervisor.md](supervisor.md) for
the consumer side. A target with no mailbox dir (desktop, whose app bundle
owns both binaries) converges nothing: it heartbeats and syncs only. The
legacy Worker-owned in-place swaps, the Worker self-`exec` update, and the
one-time D5 bridge that migrated already-provisioned legacy sandboxes were
deleted by the cull sweep's delete-worker-legacy track, after the live E2B
UPDATE and D5 BRIDGE proofs (both 2026-07-26) and full fleet convergence.

## Current Process

```text
config + single-process lock + local SQLite
  -> load durable Worker identity, or exchange one enrollment token
  -> write integration-gateway credentials after a fresh enrollment
  -> heartbeat Cloud
  -> after each successful heartbeat, repair that fresh gateway credential if
     a revoked predecessor overwrote the shared file
  -> on a supervisor-owned target, use desiredVersions to converge:
       AnyHarness binary (which IS the agent-catalog update: the catalog
         ships inside the runtime binary — binary-only transport, see
         agent-distribution.md "Convergence") -> write a mailbox update request
       Worker binary -> write a mailbox update request
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
├── launch_options_sync.rs
├── supervisor_bridge/
│   ├── mod.rs
│   └── mailbox.rs
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
| `main.rs`, `runtime.rs` | CLI entry, dependency construction, one heartbeat-and-convergence loop | Product workflows or background task supervision | [Runtime](#worker-runtime) |
| `identity/**` | Enrollment request, durable Worker credential, fingerprint | Sandbox identity, command identity, re-enrollment policy | [Identity](#worker-identity) |
| `lifecycle/heartbeat.rs` | Heartbeat cadence, request, and acknowledgement | Update execution or server-side liveness policy | [Lifecycle](#worker-lifecycle-and-convergence) |
| `supervisor_bridge/**` | Write one durable mailbox update request per diverging heartbeat on a supervisor-owned target; reconcile the Supervisor's activation results back into the store | Update download, verification, activation, health-gating, or rollback (Supervisor owns all of that) | [Lifecycle](#worker-lifecycle-and-convergence) |
| `launch_options_sync.rs` | Consume the server's `launchOptionsUploadAllowed` verdict; when allowed, read each runtime harness's exact launch-option state and upload only a higher source revision | Deciding eligibility, interpreting options/defaults/evidence, or rebuilding the copied statement | [Lifecycle](#worker-lifecycle-and-convergence) |
| `integration_gateway.rs` | Write the private gateway credential file returned by enrollment and repair it after an authenticated heartbeat when a predecessor overwrote it | Credential issuance or re-enrollment | [Identity](#worker-identity) |
| `cloud_client/**` | Raw Cloud HTTP and wire shapes | Convergence decisions or local persistence | [Clients](#worker-http-clients) |
| `store/**` | Durable Worker identity and AnyHarness update state in local SQLite | Cloud or AnyHarness product truth | [Store](#worker-store) |
| Root support files | Configuration, errors, telemetry, process locking, version reporting | Hidden service layers | [Root support](#worker-root-support-files) |

## Read Order

Read this file first, then the focused owner:

- [Runtime](#worker-runtime)
- [Identity](#worker-identity)
- [Lifecycle and convergence](#worker-lifecycle-and-convergence)
- [HTTP clients](#worker-http-clients)
- [Local store](#worker-store)
- [Root support](#worker-root-support-files)

For behavior outside the crate, use the current owners:

- [Server structure](server/standards.md)
- [AnyHarness structure](anyharness/README.md)
- [Sandbox lifecycle](FEATURE_DOCS/SANDBOX/lifecycle.md)
- [Repository environments and workspace provisioning](codebase/platforms/product/workspace-provisioning.md)
- [Billing](FEATURE_DOCS/BILLING.md)

## Dependency Direction

```text
main
  -> config + logging + runtime

runtime
  -> process_lock + store + cloud_client + identity
  -> lifecycle/heartbeat
  -> supervisor_bridge (mailbox convergence)

identity
  -> cloud_client (enroll) + store (durable identity) + config sanitation

supervisor_bridge
  -> heartbeat response + cloud_client artifact-coordinate resolution
     (writes the mailbox request; never acts on it)
  -> store (records the converged version from an activation result)

store and cloud_client
  -> root support only
```

## Hard Rules

- Keep `main.rs` thin and keep `runtime.rs` readable as process choreography.
- Treat the durable Worker token as the only credential the Worker uses for
  its own post-enrollment Cloud requests. The separately returned
  integration-gateway bearer is written for AnyHarness to consume. A Worker
  may reassert the bearer retained from its own fresh enrollment only after
  that Worker's heartbeat authenticates successfully; after heartbeat rejects
  that Worker it must not rewrite shared gateway authority again.
- Never follow redirects on authenticated Cloud requests; public artifact
  fetches use a separate redirect-following client.
- Keep Worker-local SQLite private and limited to restart-critical Worker
  state. It is not Cloud or AnyHarness product truth.
- Do not add command polls, event tails, target/profile state, or workspace
  materialization to this crate.
- The Worker never downloads, replaces, kills, or rolls back AnyHarness or
  itself — on a supervisor-owned target it only writes a durable mailbox
  request (`supervisor_bridge/`) and lets Proliferate Supervisor act; with no
  mailbox dir it converges nothing at all. Do not reintroduce a Worker-owned
  swap of any kind.
- A missing or invalid durable credential has no automatic re-enrollment path.
  Do not invent destructive recovery in this crate.

# Worker HTTP Clients

## Cloud Client

```text
cloud_client/
├── mod.rs       CloudClient, wire DTOs, endpoint methods, response parsing
├── auth.rs      bearer-header formatting
└── heartbeat.rs heartbeat request construction
```

`CloudClient` owns the current raw Cloud HTTP surface:

- `POST /v1/cloud/worker/enroll`
- `POST /v1/cloud/worker/heartbeat`
- version-pinned artifact-coordinate resolution against the
  `GET /v1/cloud/{worker,runtime}/download/{target}/{version}/{asset}`
  redirect endpoints (`Location` + `HEAD` for size — never the binary body)
- `GET /v1/catalogs/agents` (deletion-pending: heartbeat catalog transport)
- a direct unauthenticated fetch from an already resolved CDN URL for the
  sibling checksum

It has two `reqwest` clients. Authenticated requests never follow redirects,
preventing a bearer token from crossing origins. Public artifact fetches
use a redirect-following client and a longer request timeout.

The client owns endpoint paths, headers, serialization, status checking, and
wire compatibility. It does not decide when enrollment, catalog sync, or an
update should happen, and it does not write the local store.

## AnyHarness Access

There is no general `anyharness_client` module in the current Worker; the
narrow local calls that exist (catalog-version poll, launch-option reads)
live with `launch_options_sync.rs`. These calls do not make the Worker the
general execution client for AnyHarness. Cloud performs current workspace and
session operations directly.

## Artifact Identity

The Cloud download endpoint redirects to a public artifact. The Worker reads
the redirect's `Location` (never the body) and derives the checksum URL from
that resolved binary URL, so the coordinates it writes into a mailbox request
name a binary and checksum from the same published directory. It does not
resolve the two artifacts through separate Cloud redirects.

## Hard Rules

- Never use the redirect-following client for authenticated Cloud requests.
- Never attach Worker or runtime bearer credentials to public CDN downloads.
- Keep transport parsing here and convergence decisions in their owning
  modules.
- Do not invent command, event, inventory, or projection endpoints.
- Add a broader AnyHarness client only when multiple current flows require a
  shared access boundary.

# Worker Identity

The Worker has a one-time bootstrap credential and one durable Cloud identity:

```text
enrollment_token
  -> POST /v1/cloud/worker/enroll
  -> worker_id + worker_token + integration-gateway coordinates
```

The persisted identity contains only `worker_id` and `worker_token`. Sandbox,
user, runtime kind, revocation, and liveness are Cloud-owned associations; the
Worker does not persist a Target, profile, slot, generation, or fence.

## Source Ownership

| File | Owns |
| --- | --- |
| `identity/mod.rs` | Durable-identity-first `ensure_enrolled` workflow |
| `identity/enrollment.rs` | Enrollment request construction and response split |
| `identity/credentials.rs` | `WorkerIdentity` and narrow store delegation |
| `identity/fingerprint.rs` | Diagnostic machine fingerprint and hostname hint |
| `integration_gateway.rs` | Private runtime credential file written from a fresh enrollment response |
| `store/identity.rs` | Single persisted identity row |

## Enrollment Precedence

```text
if SQLite contains an identity:
  use it
  clear any enrollment token from config best-effort
  do not call enroll

otherwise:
  require enrollment_token
  send fingerprint, hostname, Worker version, and optional AnyHarness version
  persist worker_id + worker_token
  clear enrollment token from config best-effort
  write integration-gateway credentials
```

A durable identity always wins over an enrollment token still present in the
configuration. An invalid or revoked durable token does not trigger automatic
re-enrollment.

## Credentials

- `enrollment_token` is a single-use bootstrap value and is removed from the
  private TOML configuration after enrollment when possible.
- `worker_token` is the durable opaque bearer token for authenticated Worker
  heartbeats. The Worker client also attaches it to catalog fetches, but the
  current catalog route does not enforce Worker authentication.
- The integration-gateway authorization value is distinct. On fresh
  enrollment it is written atomically to `integration-gateway.json` with
  private directory/file permissions. That process retains the response in
  memory and, after each successful authenticated heartbeat, restores the file
  only when it differs. This converges a delayed predecessor write. A heartbeat
  that succeeded immediately before revocation can race one final stale write;
  after rejection the predecessor stops writing, and the active successor
  repairs that race on its next successful heartbeat.
- `runtime_bearer_token` authenticates narrow calls to the co-located
  AnyHarness runtime. It is not Cloud auth.

The enrollment response's integration-gateway coordinates are not stored in
Worker SQLite. Repair is therefore limited to the process that freshly
enrolled and still holds those coordinates in memory. A restart that loads an
existing identity does not recreate a missing gateway file. Escalate that
state; do not silently re-enroll or mint a replacement locally.

## Fingerprint

The fingerprint is SHA-256 over OS, architecture, and hostname. It is a
diagnostic hint, not authentication or hardware attestation.

## Hard Rules

- Route enrollment through `identity::ensure_enrolled`.
- Never log, expose, or duplicate token values.
- Keep Worker identity limited to `worker_id` and `worker_token`.
- Keep private config and gateway writes atomic and permission-restricted.
- Do not implement routine token rotation, local identity deletion, or
  re-enrollment without an explicit product recovery design.

# Worker Lifecycle And Convergence

The Worker heartbeat is both its liveness signal and the carrier for desired
binary versions. Binary versions are all it carries: the agent catalog rides
inside the runtime binary, so there is no catalog version on the wire.

```text
POST /v1/cloud/worker/heartbeat
  request: status=online, Worker version, current AnyHarness version
  response: acknowledgement + optional desiredVersions
            + required launchOptionsUploadAllowed (not desired state)
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

## Harness Launch-Option Sync (server-gated, no convergence)

Launch-option sync is copied observation, not desired-state convergence. It
runs on the same tick before the mailbox convergence write.

The successful heartbeat acknowledgement carries
`launchOptionsUploadAllowed`. Absent decodes to `false`; on `false`,
`launch_options_sync::maybe_sync` returns before resolving the runtime bearer,
listing harnesses, reading launch options, or uploading anything. The Worker
does not re-derive eligibility.

On `true`, the Worker lists runtime harness kinds, reads
`GET /v1/agents/{kind}/launch-options`, serializes that response verbatim except
for runtime-only readiness decoration, and uploads it to
`/v1/cloud/harness-launch-options/{kind}`. In-memory state tracks the highest
successfully copied source revision per harness. Equal/older revisions are
skipped; a read, encoding, network, or ingest failure leaves the revision
unadvanced for a later tick. The Worker never interprets model/control IDs,
defaults, basis state, or probe evidence.

See [MODELS.md "Cloud copy"](FEATURE_DOCS/MODELS.md#cloud-copy)
for the server half of this contract.

## Catalog Convergence (none)

There is no catalog convergence in this crate: the agent catalog ships only
inside the runtime binary, so the AnyHarness binary swap below IS the catalog
update
([agent-distribution.md "Convergence"](codebase/platforms/product/agent-distribution.md#convergence)). The Worker has no served catalog version to compare, no
document to fetch, and no push route to call. Do not reintroduce one — a
faster catalog lane would break the invariant that the active catalog is
immutable for the lifetime of the runtime process.

## Supervisor-Owned Convergence (mailbox)

`heartbeat_and_converge` in `runtime.rs` branches on
`supervisor_bridge::is_supervisor_owned(config)` (whether
`supervisor_update_request_dir` is set): supervisor-owned targets route to
`converge_via_mailbox` (the mailbox write); a target with no mailbox dir
converges nothing.

When `WorkerConfig.supervisor_update_request_dir` is set (a supervisor-owned
target), AnyHarness and Worker binary divergence is **not** actioned in this
crate. Instead `supervisor_bridge::write_update_request` resolves the
artifact coordinates (public artifact redirect, sibling `.sha256`, size) and
atomically writes one request into `.proliferate/supervisor/updates`:

```text
desiredVersions diverges from the running AnyHarness/Worker version
  -> resolve artifact_url / sha256 / size_bytes (no download)
  -> build UpdateRequestV1 { request_id = deterministic(component, version), ... }
  -> write_request(dir, &request)   # atomic tmp+rename, 0700/0600
```

`request_id` is derived deterministically from `(component, version)`, so a
replayed heartbeat for the same divergence overwrites the same file rather
than enqueuing a duplicate; Proliferate Supervisor's own idempotency check
(`result_exists`) guarantees exactly one activation. The Worker reads the
Supervisor's terminal result only to reconcile: a successful AnyHarness
activation records the observed version into the store so the next heartbeat
reports convergence (R9-006), then GCs the request+result pair so a later
re-pin to the same version re-applies (R9-003); a terminal failure is left
latched so a lagging artifact is not retried until the pin changes.

See [specs/supervisor.md](supervisor.md)
for the consumer side (verify, download, stage, activate, health-gate,
rollback).

## Launch Policy

Convergence is opt-in by mailbox dir alone. Desktop owns its bundled binaries
and never sets `supervisor_update_request_dir` (its config still writes the
retired `self_update_enabled = false` key, now an ignored no-op). Every
managed-cloud (E2B) target is always supervisor-owned: the server's
`build_worker_config` (`server/proliferate/server/cloud/runtime/bootstrap.py`)
emits `supervisor_update_request_dir` — calling it with
`supervisor_owned=False` raises `ValueError` because the legacy
independent-launch config shape was deleted. So the mailbox path in the
previous section is the only convergence path any Worker config can express;
on-disk configs still carrying the deleted legacy keys parse unchanged
(serde ignores unknown fields).

## Hard Rules

- Treat every convergence action as non-fatal to the heartbeat loop.
- Resolve the exact desired version's artifact coordinates before writing
  them into a mailbox request; never a rolling label.
- Rollback for both AnyHarness and Worker is Proliferate Supervisor's
  responsibility, not this crate's.
- Do not add Supervisor lifecycle behavior (download, stage, activate,
  health-gate, or rollback) to this crate; the mailbox write is the only
  convergence surface here.

# Worker Root Support Files

Root support modules are small process-wide dependencies. The focused root
workflow modules—`integration_gateway.rs` and `launch_options_sync.rs`—are
covered by the identity and lifecycle guides rather than treated as generic
utilities.

## Ownership

| File | Owns | Does not own |
| --- | --- | --- |
| `config.rs` | TOML config loading, defaults, enrollment-token sanitation, atomic private writes | Enrollment or convergence decisions |
| `error.rs` | Worker error variants and source conversion | Recovery policy |
| `logging.rs` | Pre-config bundled diagnostics activation, tracing and Sentry initialization, release identity, privacy scrubbing | Per-flow decisions |
| `observability.rs` | Heartbeat acknowledgement event | A generic telemetry service |
| `process_lock.rs` | One Worker process per canonical database path | Process supervision |
| `versions.rs` | Stamped Worker version; the running AnyHarness version (store-converged record, else the boot-time env hint) | Desired-version policy |

## Configuration Boundary

Current configuration includes:

- Cloud base URL, optional enrollment token, and Worker database path;
- heartbeat interval;
- integration-gateway output home;
- the Supervisor mailbox directory (`supervisor_update_request_dir`), whose
  presence is what makes a target supervisor-owned;
- runtime base URL and optional runtime bearer token for narrow local calls.

Runtime URL defaults to `http://127.0.0.1:8457`. Runtime bearer auth can be
loaded from config or the `ANYHARNESS_BEARER_TOKEN` environment variable by
the focused caller. Keys from the deleted legacy convergence paths that still
appear in deployed configs are ignored as unknown fields.

## Telemetry And Privacy

`logging.rs` stamps component-specific Worker release identity, initializes
Sentry when configured, and scrubs bearer values, URL query strings, and
absolute local paths from captured text. Before config load it also activates
the bundled Desktop diagnostics adapter purely by possession of the two
reserved bridge/shutdown descriptors: when present, the bounded
`proliferate-diagnostics-client` tracing layer joins the subscriber and its
guard flushes on shutdown; when absent, activation is `Disabled` with no
producer task, file, or network behavior. Desktop keeps one continuous
identity-stable natural-exit observer after startup; an ambiguous startup or
later inspection retains the child, bridge, drainers, and tail rather than
turning an error into reap authority. Flow modules still decide what an event
means and when to emit it.

Use current identifiers such as `worker_id` and the authenticated user context
when available. Do not add removed command, Target, projection, slot, or
generation identifiers as standard Worker fields.

## Hard Rules

- Do not add catch-all `utils`, `helpers`, `misc`, or service modules.
- Keep secrets out of errors and telemetry.
- Keep private writes atomic and permission-restricted.
- Move a decision into its focused owner when a support file starts owning a
  workflow.
- The process lock prevents two Workers from sharing one local database; it is
  not a distributed lock or Supervisor contract.

# Worker Runtime

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
  -> create in-memory launch-option sync state
  -> heartbeat, repair that fresh gateway credential if needed, and converge once
  -> if --once: return
  -> otherwise: sleep for the configured interval and repeat
```

There is one loop. The Worker does not spawn command, event-tail, inventory,
or materialization loops, and it has no custom shutdown coordinator.

## One Tick

```text
POST heartbeat
  -> on failure: log and retry next tick
  -> if this process freshly enrolled and the shared gateway file differs,
     restore its credential now that heartbeat authenticated it
  -> copy changed harness launch-option state when this heartbeat permits it
  -> on a supervisor-owned target, mailbox convergence (non-fatal): reconcile
     activation results, then write update requests for any divergence
```

`--once` sends one heartbeat and may copy changed launch-option state, but it
only reports pending convergence without writing mailbox requests.

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

# Worker Store

Worker-local SQLite contains only restart-critical Worker state. It is not
Cloud workspace state, AnyHarness runtime state, or a copy of server truth.

## Current Tree

```text
store/
├── mod.rs
├── connection.rs
├── migrations.rs
├── identity.rs
└── anyharness_update.rs
```

## Current Schema

```text
identity (single row, id = 1)
  worker_id
  worker_token
  updated_at

anyharness_update (single row, id = 1)
  converged_version
  failed_pin
  updated_at
```

`identity` lets a restart reuse the opaque Worker credential without another
enrollment. `anyharness_update` keeps its historical name and shape; its
`converged_version` records the runtime version of the last Supervisor
activation the Worker reconciled from the mailbox, which is what the next
heartbeat reports (R9-006). The `failed_pin` column is a leftover of the
deleted Worker-owned swap: unread, kept only because the schema is applied
on real boxes and is not worth migrating for a dead column. The swap journal
and failure latch live with Proliferate Supervisor
([specs/supervisor.md](supervisor.md)).

## Source Ownership

| File | Owns |
| --- | --- |
| `mod.rs` | `WorkerStore` handle and module boundary |
| `connection.rs` | Database creation, private permissions, connection pragmas, and busy timeout |
| `migrations.rs` | Current table creation |
| `identity.rs` | Single-row identity load and upsert |
| `anyharness_update.rs` | Converged-version reads/writes |

The connection enables foreign keys and WAL and uses a five-second busy
timeout. The containing directory and database file are permission-restricted
on Unix.

## Hard Rules

- Keep APIs table-shaped and narrow; do not hide HTTP or convergence workflows
  behind store methods.
- Never store enrollment tokens, integration-gateway credentials, Cloud
  sandbox/workspace rows, commands, event cursors, or projections here.
- Do not log or expose `worker_token`.
- Preserve the single-row invariants unless the identity model itself changes.
- Use the schema and migrations that exist; do not document planned tables as
  current.
