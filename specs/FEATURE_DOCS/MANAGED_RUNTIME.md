# Managed Runtime

**Read before touching:** `anyharness/crates/proliferate-supervisor/**`, `anyharness/crates/proliferate-worker/**`, `server/proliferate/server/cloud/runtime/bootstrap.py`, `server/proliferate/server/cloud/worker/**`, `server/proliferate/db/models/cloud/workers.py`

**Owns:** Server ↔ supervisor ↔ worker convergence: mailbox state machine, binary-swap-is-catalog-update, enrollment/identity, process supervision topology.

**Does not own:**
- AnyHarness runtime internals → [AnyHarness structure](../anyharness/README.md)
- Sandbox lifecycle and provisioning → [Sandbox lifecycle](SANDBOX/lifecycle.md)
- Cloud workspace product flows → [Cloud workspace provisioning](../codebase/platforms/product/workspace-provisioning.md)
- Server structure → [Server structure](../server/standards.md)

## Mental Model

The managed runtime is the convergence story for cloud targets: how a server-advertised binary pin becomes the running process on a remote machine. Three processes coordinate in a hierarchy:

```text
proliferate-supervisor (OS-level parent)
  ├─ anyharness (runtime execution: workspaces, sessions, agents)
  └─ proliferate-worker (enrollment, heartbeats, version divergence observer)
```

One law: **the process that owns the children is the only process that swaps their binaries.** The supervisor starts both children, restarts them on crash, and executes all binary swaps. The worker never touches processes or binaries — it only observes heartbeat divergence and writes durable update requests into the supervisor's file mailbox.

The agent catalog rides inside the runtime binary, so binary convergence IS catalog convergence. There is no separate catalog version, no document push, and no faster lane. The active catalog is immutable for the lifetime of the runtime process.

## How It Works

### Enrollment and Identity

The worker has a one-time bootstrap credential and one durable Cloud identity:

```text
enrollment_token (single-use, written by server bootstrap)
  -> POST /v1/cloud/worker/enroll
  -> worker_id + worker_token + integration-gateway coordinates
```

The persisted identity contains only `worker_id` and `worker_token`. Sandbox, user, runtime kind, revocation, and liveness are Cloud-owned associations; the worker does not persist a target, profile, slot, generation, or fence.

Enrollment precedence:

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

A durable identity always wins over an enrollment token still present in the configuration. An invalid or revoked durable token does not trigger automatic re-enrollment.

The integration-gateway authorization value is distinct from `worker_token`. On fresh enrollment it is written atomically to `integration-gateway.json` with private directory/file permissions. That process retains the response in memory and, after each successful authenticated heartbeat, restores the file only when it differs. This converges a delayed predecessor write. A heartbeat that succeeded immediately before revocation can race one final stale write; after rejection the predecessor stops writing, and the active successor repairs that race on its next successful heartbeat.

Source: [`proliferate-worker/src/identity/`](../../anyharness/crates/proliferate-worker/src/identity/), [`store/identity.rs`](../../anyharness/crates/proliferate-worker/src/store/identity.rs), [`integration_gateway.rs`](../../anyharness/crates/proliferate-worker/src/integration_gateway.rs)

### Heartbeat and Version Divergence

The worker heartbeat is both its liveness signal and the carrier for desired binary versions:

```text
POST /v1/cloud/worker/heartbeat
  request: status=online, Worker version, current AnyHarness version
  response: acknowledgement + optional desiredVersions
```

The interval is `heartbeat_interval_seconds` from local configuration with a 10-second minimum. Cloud derives liveness from an `online` row with a recent `last_seen_at`.

**Binary versions are all the heartbeat carries as desired state.** The agent catalog ships inside the runtime binary, so there is no catalog version on the wire. A runtime binary update delivers new catalog pins by definition.

The response also transports one server-owned verdict that is **not** desired state: `launchOptionsUploadAllowed`, a required boolean on every successful authenticated 200 saying whether this Worker may upload target launch-option state. The server owns it because only the server knows the Worker's runtime kind and whether its sandbox still exists and is undestroyed. The launch-option ingest route enforces the same target rule, so the acknowledgement cannot promise an upload the route would refuse. Absent means `false`: a server too old to state a verdict cannot promise the upload is legal, so the Worker fails closed. The bit alters nothing else and never appears in a request. Authentication remains a separate boundary: an invalid Worker credential gets `401 cloud_worker_unauthorized` and no response body. See [MODELS.md "Cloud copy"](MODELS.md#cloud-copy).

The pin's provenance: release CI stamps `RUNTIME_VERSION` (and `WORKER_VERSION`) into the server image at build time ([`server/proliferate/server/version.py`](../../server/proliferate/server/version.py)); every heartbeat ack advertises them as `desired_versions`. A server deploy is therefore the fleet trigger — each sandbox converges within one heartbeat interval (~30s). A per-sandbox override column exists for targeted pinning ahead of or behind the fleet.

Source: [`proliferate-worker/src/lifecycle/heartbeat.rs`](../../anyharness/crates/proliferate-worker/src/lifecycle/heartbeat.rs), [`cloud_client/heartbeat.rs`](../../anyharness/crates/proliferate-worker/src/cloud_client/heartbeat.rs), `server/proliferate/server/cloud/worker/` (service routes)

### Mailbox State Machine (Supervisor-Owned Convergence)

When `WorkerConfig.supervisor_update_request_dir` is set (every managed-cloud target), the worker routes to **mailbox-based convergence** instead of in-place binary swaps. The worker never downloads, replaces, kills, or rolls back AnyHarness or itself — it only writes durable update requests.

#### Worker: Write Requests

`heartbeat_and_converge` in `runtime.rs` branches on `supervisor_bridge::is_supervisor_owned(config)` (whether `supervisor_update_request_dir` is set). When supervisor-owned, AnyHarness and Worker binary divergence triggers `supervisor_bridge::write_update_request`, which:

```text
desiredVersions diverges from the running AnyHarness/Worker version
  -> resolve artifact_url / sha256 / size_bytes (no download)
  -> build UpdateRequestV1 { request_id = deterministic(component, version), ... }
  -> write_request(dir, &request)   # atomic tmp+rename, 0700/0600
```

`request_id` is derived deterministically from `(component, version)`, so a replayed heartbeat for the same divergence overwrites the same file rather than enqueuing a duplicate. The worker never reads the result file to drive behavior — convergence is observed the ordinary way, through the next heartbeat reporting the version AnyHarness/`--version` actually serves after supervisor restarts it.

Source: [`proliferate-worker/src/supervisor_bridge/`](../../anyharness/crates/proliferate-worker/src/supervisor_bridge/), shared wire shapes in [`proliferate-runtime-update-protocol`](../../anyharness/crates/proliferate-runtime-update-protocol/)

#### Supervisor: Drain the Mailbox

The supervisor's main `run` workflow ([`proliferate-supervisor/src/process/mod.rs`](../../anyharness/crates/proliferate-supervisor/src/process/mod.rs)) drains the update mailbox once per supervise cycle, after children are up:

```text
load SupervisorConfig

loop:
  spawn AnyHarness with configured args/env

  loop:
    spawn Worker with:
      --config <worker_config>
      PROLIFERATE_SUPERVISOR_VERSION=<supervisor version>

    drain the update mailbox (update::activate::run_pending):
      for each next pending request with no result yet:
        verify manifest -> download -> re-verify -> stage
          -> activate atomically -> restart the changed component(s)
             in dependency order (AnyHarness before Worker)
          -> health-gate; on failure, roll back to `.prev`, restart, re-gate
        write exactly one result (activated | rolled_back | invalid)

    if AnyHarness exits:
      kill Worker
      wait for Worker
      restart both

    if Worker exits:
      wait restart delay
      restart Worker

  wait restart delay
```

The mailbox drain runs once per supervise cycle, so an update in flight cannot race an unrelated child-exit restart.

Source: [`proliferate-supervisor/src/process/mod.rs`](../../anyharness/crates/proliferate-supervisor/src/process/mod.rs), [`update/activate/`](../../anyharness/crates/proliferate-supervisor/src/update/activate/)

#### Activation State Machine

One state machine owns the swap ([`proliferate-supervisor/src/update/activate/`](../../anyharness/crates/proliferate-supervisor/src/update/activate/)):

```text
verify manifest (component valid, checksum matches, size within bounds)
  -> download artifact (bounded reqwest GET of only artifact_url)
  -> re-verify checksum and size
  -> stage (atomic write with private permissions)
  -> atomic activate (move .prev, rename staged to active path)
  -> restart changed components in dependency order (AnyHarness before Worker)
  -> health-gate: poll /health (for AnyHarness) or liveness (for Worker)
     until the desired version is reported
  -> on health gate failure: rollback plan restores .prev over active path,
     restart, re-gate
  -> write exactly one result (activated | rolled_back | invalid)
```

The supervisor records the failed pin; that pin is not retried until a different desired version supersedes it. The activation is journal-protected: a crash mid-swap is repaired at next boot from the journal.

Source: [`proliferate-supervisor/src/update/activate/`](../../anyharness/crates/proliferate-supervisor/src/update/activate/), [`update/download.rs`](../../anyharness/crates/proliferate-supervisor/src/update/download.rs), [`update/staging.rs`](../../anyharness/crates/proliferate-supervisor/src/update/staging.rs), [`update/rollback.rs`](../../anyharness/crates/proliferate-supervisor/src/update/rollback.rs), [`process/health.rs`](../../anyharness/crates/proliferate-supervisor/src/process/health.rs)

### Process Supervision Topology

The supervisor exists to make a Proliferate target boring to operate. One local process owns the lifecycle of the two long-lived child processes:

```text
proliferate-supervisor
  starts and restarts:
    anyharness
    proliferate-worker
```

Explicit goals:
- Make target process lifecycle predictable
- Keep Worker focused on Cloud transport and command delivery
- Keep AnyHarness focused on runtime execution
- Keep Cloud and installers responsible for provisioning/configuration, not child-process supervision
- Keep update staging local, narrow, verifiable, and separate from rollout policy

**The supervisor is not Cloud, not Worker, and not AnyHarness.** It knows paths, binaries, env, child exits, restart delay, and update artifacts. It does not know product workflows.

Source: [`proliferate-supervisor/src/process/`](../../anyharness/crates/proliferate-supervisor/src/process/)

### Binary Convergence IS Catalog Convergence

The agent catalog is compiled into the runtime (`include_str!` in [`catalog/bundled.rs`](../../anyharness/crates/anyharness-lib/src/domains/agents/catalog/bundled.rs); a document that fails validation fails the build), so which harness pins a machine is on is answered by one number — the runtime version.

One transport delivers a new active catalog, on every surface: **the runtime binary carries it.** A runtime binary update delivers new pins by definition. The startup pass after the swap is the entire convergence story; there is no document push, no second version to reason about, and no faster lane on any surface.

**The active catalog is immutable for the lifetime of the runtime process.** Pins can never move under a machine mid-work; harness installs mutate only across a restart, when nothing is running.

This also makes the runtime version the single rollback unit. Repinning the fleet to a previous runtime version rolls back the code, the catalog pins, and the probe-observed behavior together, atomically — there is no document state that can race the binary or survive it.

Source: [Agent distribution](../codebase/platforms/product/agent-distribution.md) "Convergence" and "Runtime binary convergence (cloud)" sections

### Launch Topology by Surface

| Surface | Supervisor owned? | Worker update gate | AnyHarness update gate | Notes |
| --- | --- | --- | --- | --- |
| Desktop | No (bundled sidecars) | Disabled | Disabled | App update replaces both binaries; neither ever self-swaps |
| Managed cloud (E2B) | Yes (always) | Mailbox (`supervisor_update_request_dir` set) | Mailbox | Server's `build_worker_config` only ever emits `supervisor_update_request_dir`; calling it with `supervisor_owned=False` raises `ValueError` |
| SSH-installed | Yes (supervisor runs) | Disabled | Disabled | Supervisor owns process supervision; Worker binary convergence is off |

Source: [Worker lifecycle guide](../worker.md) "Launch Policy", `server/proliferate/server/cloud/runtime/bootstrap.py`

## Laws

### L1: Single Update Owner

**The process that owns the children is the only process that swaps their binaries.**

On desktop that owner is the app itself (runtime and worker are bundled sidecars). On managed cloud, the supervisor owns both children and executes all swaps; the worker never downloads, replaces, kills, or rolls back binaries — it only writes mailbox requests.

Enforced by: worker code structure (the worker has no download/swap/kill/exec logic at all — the legacy in-place swap paths were deleted; the mailbox write is its only convergence surface).

Failure mode: If the worker were allowed to kill/swap processes it doesn't own, you'd have two competing update executors racing each other, violating the immutability invariant below.

### L2: Catalog Immutability

**The active catalog is immutable for the lifetime of the runtime process.**

Pins can never move under a machine mid-work. Harness installs mutate only across a restart, when nothing is running. The only transport for a new catalog is a new runtime binary.

Enforced by: `include_str!` compilation, no live document-sync layer on any surface, startup pass as the only reconcile trigger.

Failure mode: If a live document push existed, a catalog PR could change pins while sessions are running, making "which version of harness X" ambiguous mid-conversation and breaking reproducibility.

### L3: Atomic Version Unit

**The runtime version is the single rollback unit: code, catalog pins, and probe-observed behavior roll back together.**

Repinning the fleet to a previous runtime version returns code + catalog + observed facts atomically. There is no document state that can race the binary or survive it.

Enforced by: binary-only transport (both documents compiled in), release CI stamping `RUNTIME_VERSION` into the server image.

Failure mode: A separate catalog version could diverge from the runtime version during rollback, leaving the fleet on old code with new pins (or vice versa), breaking the "exactly which bytes" contract.

### L4: Deterministic Request ID

**Mailbox request IDs are deterministic: `request_id = f(component, version)`. Replayed heartbeats for the same divergence overwrite the same file rather than enqueuing duplicates.**

Supervisor's `result_exists` check guarantees exactly one activation per pin.

Enforced by: [`supervisor_bridge::deterministic_request_id`](../../anyharness/crates/proliferate-worker/src/supervisor_bridge/mailbox.rs), idempotency check in [`update/request.rs`](../../anyharness/crates/proliferate-supervisor/src/update/request.rs).

Failure mode: Random/UUID request IDs would queue unbounded duplicates for a stuck heartbeat, exhausting disk or causing repeated redundant downloads.

### L5: Health Gate + Rollback

**Every activation health-gates the new binary (AnyHarness must report the desired version at `/health`; Worker must start successfully). On failure, supervisor restores `.prev` over the active path, restarts, and re-gates.**

A failed pin is recorded and not retried until a newer pin supersedes it.

Enforced by: [`update/activate/`](../../anyharness/crates/proliferate-supervisor/src/update/activate/) state machine, [`process/health.rs`](../../anyharness/crates/proliferate-supervisor/src/process/health.rs) polling, [`update/rollback.rs`](../../anyharness/crates/proliferate-supervisor/src/update/rollback.rs) `RollbackPlan::apply`.

Failure mode: Without health-gating, a bad binary pin could brick every sandbox simultaneously. Without recording the failed pin, the fleet would retry indefinitely instead of waiting for a fix.

### L6: Dependency-Ordered Restart

**When both AnyHarness and Worker binaries change in one cycle, AnyHarness restarts before Worker.**

The worker depends on AnyHarness for health-check targets and runtime identity; starting Worker first would race an unavailable runtime.

Enforced by: activation state machine's component ordering ([`update/activate/`](../../anyharness/crates/proliferate-supervisor/src/update/activate/)).

Failure mode: Reversed order would cause Worker's health gate to spuriously fail because AnyHarness isn't up yet, triggering unnecessary rollback.

### L7: No Automatic Re-Enrollment

**An invalid or revoked durable credential has no automatic re-enrollment path.**

Enrollment is a one-time bootstrap. A missing or invalid durable credential is escalated, not silently recovered.

Enforced by: enrollment precedence logic ([`identity/mod.rs`](../../anyharness/crates/proliferate-worker/src/identity/mod.rs)), no re-enrollment hook in the heartbeat failure path.

Failure mode: Automatic re-enrollment would let a compromised worker re-authenticate itself indefinitely, bypassing revocation.

### L8: Supervisor Never Self-Updates

**The supervisor is image-bound and never self-updates.**

The shared protocol crate's `UpdateComponent` enum has no `supervisor` variant — a request naming it cannot be represented, not merely rejected.

Enforced by: no `supervisor` variant in [`proliferate-runtime-update-protocol`](../../anyharness/crates/proliferate-runtime-update-protocol/), supervisor's own activation logic only operates on `anyharness` / `worker`.

Failure mode: Self-updating the supervisor would require it to restart itself while children are running, violating the "one owner" invariant and risking orphaned processes.

## Tried And Rejected

| Approach | Why It Failed | When |
| --- | --- | --- |
| Worker-owned in-place binary swap (legacy) | Violated "single update owner" — the worker doesn't own the process tree but was killing/restarting AnyHarness. Replaced by mailbox-based convergence where the supervisor (the actual parent) owns all swaps. Deleted (with the worker self-`exec` update and the D5 bridge) by the cull sweep's delete-worker-legacy track once the fleet was fully supervisor-owned. | 2026-07-26 (supervisor mailbox proven); deleted 2026-08-25 |
| Separate catalog document push | Would break catalog immutability — pins could change mid-session. Would also require reasoning about two versions (runtime + catalog) and handling their divergence/rollback independently. Binary-only transport eliminated the problem. | Before 2026-07 (agent-distribution design) |
| Automatic re-enrollment on credential failure | Security risk: a compromised worker could re-authenticate indefinitely. Enrollment is one-time bootstrap; revocation must stick. | Ruled in worker identity design |
| Random/UUID mailbox request IDs | Would queue unbounded duplicates for a stuck heartbeat. Deterministic IDs (hash of component + version) make replays idempotent. | Mailbox protocol design (2026-07) |
| Gateway model names in catalog | Made the catalog mutable (model lists change independently of harness versions). Gateway models are discovered live with the harness key only to materialize the route needed for an override-free harness probe; Product sees the resulting target observation. The catalog is purely distribution and presentation. | Removed in the target-observed launch-options cutover |

## Gaps

### G1: Binary swaps don't wait for live sessions

The supervisor kills and restarts the runtime even mid-conversation. Desktop updates happen at app startup when no sessions exist, and in cloud the disruption window is one process restart on a fleet that updates at most daily. Deferring swaps around long-running work is a known UX gap to revisit, not an accident.

**Issue:** Intentional for now; UX improvement deferred.

## Verification

Live proofs (both PASSED on real E2B sandboxes 2026-07-26):

- **UPDATE proof**: A fresh supervisor-owned sandbox converging pins 0.3.47→0.3.48 end to end, this mailbox consumer included, zero rollbacks, ~75s convergence.
- **D5 BRIDGE proof**: In-place migration of an already-running legacy Worker's process tree onto Supervisor via the one-time bridge, not a fresh provision — sandbox `iwwvadhffzxoora56f437`, ~2.5s, no destroy/recreate. (The bridge code was deleted after full fleet convergence; the proof stands as the record that the migration completed.)

Focused tests:

- `proliferate-supervisor/src/update/activate.rs` (inline state-machine tests)
- `proliferate-worker/src/supervisor_bridge/mailbox.rs` (deterministic request ID, idempotency)
- `proliferate-worker/src/identity/` (enrollment precedence)
- `proliferate-worker/src/process_lock.rs` (exclusive flock)
- `server/tests/unit/test_worker_heartbeat.py`
- `anyharness/crates/anyharness-lib/src/domains/agents/catalog/validation.rs` (invalid catalog fails build)
