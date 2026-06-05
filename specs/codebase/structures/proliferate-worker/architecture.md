# Proliferate Worker + Supervisor — Architecture

Status: consolidated architecture reference for the two runtime-side Rust crates —
`anyharness/crates/proliferate-worker` and
`anyharness/crates/proliferate-supervisor`. Covers purpose/ownership, the
20k-foot model, core workflows, and per-module best practices for **both**. The
identity/lifecycle decisions live in
`specs/tbd/runtime-worker-supervisor-design.md`; the up/down contracts in
`specs/tbd/cloud-worker-protocol-design.md`.

---

## 1. Purpose / Ownership

These two crates run **inside the sandbox**, next to AnyHarness, as a
**watchdog chain**:

```text
systemd  ──supervises──►  proliferate-supervisor  ──supervises──►  proliferate-worker  +  anyharness
 (Restart=always)              (process + update)                   (cloud comms)        (the runtime)
```

- **proliferate-worker** owns **cloud communication**: enroll, heartbeat, run the
  two polls (control down, events up), reconcile config to local AnyHarness,
  report state. It drives the *local* AnyHarness and talks to the *cloud*; it
  holds the only durable local state (SQLite).
- **proliferate-supervisor** owns **process lifecycle + binary updates**: keep the
  worker + AnyHarness alive and current. It is the *stable parent* over the
  *volatile children*; systemd is *its* parent.

Premise (decided): **one runtime = one sandbox = one Target (1:1), ephemeral** —
no slots, no `slot_generation`, no fencing. A sandbox death = a fresh runtime; the
worker just enrolls anew. Product state is the cloud's concern and is ephemeral.

---

## 2. 20k-Foot Detailed View

### The worker is two polls + a lifecycle + reporting

```text
ENROLL (once, at startup):  one-time token (env for managed / install cmd for ssh) → durable worker token
AUTH (every cloud call):    Bearer worker_token

TWO POLLS (spawned tokio tasks):
  control (DOWN)  long-poll → commands (execute on AnyHarness) + ALL reconcile (config/exposures/revoked-jti)
  events  (UP)    tail AnyHarness by after_seq → ship batches

MAIN LOOP:  heartbeat (every stale/3) — liveness; self-update check rides its response
ONE-SHOT:   inventory (capabilities) at startup
EVENT-DRIVEN: materialization report (on command completion)
```

Folding revoked-JTI into the control channel is what makes it **two** polls, not
three. The control long-poll is a parked coroutine woken by a Redis doorbell + a
per-domain RevisionMap cursor (cloud side).

### The supervisor is process management + updates

```text
process/  keep worker + anyharness alive (spawn, health, restart-on-crash with backoff)
update/   apply the worker's update request: stage → verify SHA-256 → swap → restart → rollback on failure
install/  binary layout + the systemd unit (Restart=always)
```
Per-component (the mailbox lists only stale components). **Self-update** = stage
own binary → exit → systemd relaunches it.

### The seam between them (the only coupling)

```text
WORKER lifecycle/update  ── writes ──►  desired-update.json (mailbox)  ── read by ──►  SUPERVISOR update
        (cloud-facing: knows desired)     atomic · idempotent · private        (process-facing: swaps + restarts)
```
The worker can only *request* an update (it can't restart itself); the supervisor
*applies* it. A file (not IPC) so it survives a restart of either process.

### Local state, clients, cadences

- **Local SQLite (`store/`)** — the only durable worker state: up-cursor
  (`last_uploaded_seq`), applied-revisions + per-domain backoff, exposure cache,
  worker token.
- **Two clients** — `cloud_client/` (transport TO cloud, one file per endpoint),
  `anyharness_client/` (the local runtime substrate: execute, push config,
  health-probe, pull events).
- **Cadences** — heartbeat `stale/3` (≥10s); control = continuous long-poll;
  tail ≈ 500ms; revoked-jti folds into control; inventory once; materialization
  on-event.

---

## 3. Core Workflows

**Enrollment (bootstrap):**
```text
worker boots → process-lock (single instance) → read enrollment token (env / install cmd)
  → POST /enroll { token, fingerprint=sha256(OS:ARCH:HOST), hostname, versions, inventory }
  → store worker token (credentials) → spawn the loops
(no slot validation; on a dead sandbox it's a brand-new Target, not a re-enroll)
```

**Control loop (DOWN):**
```text
hold the control long-poll → on response, route news:
  command        → commands/: execute (forward to AnyHarness; per-kind handler if it needs local work)
  revision signal → reconcile/: per-domain compare (applied vs desired)
```

**Reconcile (per domain — config/exposures/revoked-jti):**
```text
if desired > applied AND now >= next_attempt[domain]:
    fetch bundle (cloud) → apply to local AnyHarness → read-back-verify applied → reset backoff
  on failure: bump backoff; after N tries mark 'failed' + surface; retry on backoff or next desired bump
```

**Event tail (UP):**
```text
every ~500ms, per exposed session:
  pull AnyHarness events since last_uploaded_seq → batch → POST /events/batches
  → advance cursor to the acked contiguous seq → backfill any gap
```

**Heartbeat + self-update:**
```text
every stale/3:  POST /heartbeat { versions, status } → response carries DESIRED versions
  → compare desired vs installed → if stale, write desired-update.json (atomic, idempotent) to the mailbox
```

**Supervisor update flow:**
```text
run loop keeps children alive; on an update request:
  per stale component: fetch manifest → verify SHA-256 → stage (atomic) → swap → restart child
                       (rollback on failure)
  SELF-update: swap own binary → exit → systemd (Restart=always) relaunches it
```

---

## 4. Each Module's Best Practices

### Worker

**`main.rs` / `runtime.rs`**
- `main.rs` is thin (parse args → `runtime::run`). `runtime.rs` is the **internal
  loop supervisor**: enroll → spawn control + tail + revoked-jti tasks → run the
  heartbeat main loop. Keep it wiring; no business logic.

**`identity/`** (enrollment · credentials · fingerprint)
- Owns the one-time **bootstrap**: redeem the enrollment token, store the durable
  worker token, compute the machine fingerprint. Pure identity; no command/config
  logic.

**`cloud_client/`** (transport TO cloud)
- One file per endpoint; typed request/response DTOs (generated from the shared
  contract). **Never** business logic — it sends/receives, callers decide.

**`anyharness_client/`** (the local runtime substrate)
- The only path to local AnyHarness: execute commands, push config
  (`PUT /runtime-config`, `/agents/auth-config`), health-probe, pull events.
  Everything that touches the runtime goes through here.

**`control/`** (DOWN — the single control long-poll)
- `loop.rs` holds the long-poll and **routes** news; it doesn't execute.
- `commands/` executes acts (mapping + per-kind handlers **only** for kinds with
  real local work — most are thin pass-throughs to AnyHarness).
- `reconcile/manager.rs` is **generic**: tracks applied/desired/backoff per domain,
  decides what's due. `reconcile/handlers/<domain>.rs` are **per-domain**: fetch
  bundle → apply → verify. Keep the manager domain-agnostic; keep apply-logic in
  handlers.

**`tail/`** (UP — event tailer + backfill)
- Tails AnyHarness per *exposed* session, ships batches, advances the cursor,
  backfills gaps. A **dumb pump** — it forwards the normalized event stream; it
  doesn't reshape events. (Renamed from `sync/` to avoid colliding with config
  reconcile.)

**`lifecycle/`** (heartbeat + self-update)
- Heartbeat = liveness ping. Self-update = compare desired (from heartbeat
  response) vs installed → write the supervisor mailbox. The worker **requests**
  updates here; it never applies them.

**`inventory/`** (capability introspection)
- Introspect the environment (os/arch, tool versions, providers, MCPs, declared
  capabilities) and report **once at startup**. Read-only introspection.

**`store/`** (local SQLite)
- The only durable local state: up-cursor, applied-revisions + backoff, exposure
  cache, worker token. Atomic writes; survives restarts.

**Cross-cutting** (`config` · `error` · `logging` · `observability` ·
`process_lock` · `versions`)
- `process_lock` guarantees single-instance. `config` = runtime settings
  (anyharness url, intervals, paths). Keep these thin and dependency-free.

### Supervisor

**`main.rs`**
- CLI with explicit subcommands: `Run` (the loop), `PrintService` (emit the
  systemd unit), `VerifyUpdate` / `StageUpdate` (discrete, testable update steps).
  Exposing update steps as subcommands is deliberate — debuggable in isolation.

**`process/`** (child · health · restart · run loop)
- Owns **keeping children alive**: spawn worker + AnyHarness, health-check,
  restart-on-crash with backoff. The run loop is the supervise loop. No update
  logic here beyond restarting after a swap.

**`update/`** (manifest · staging · rollback)
- **Staged, SHA-verified, rollback-able** updates. `manifest` parses + verifies
  `sha256`; `staging` writes the artifact atomically (temp → fsync → rename);
  `rollback` reverts a bad swap. A bad artifact must **never** brick the runtime.
  Applies **per-component** (only the stale ones from the mailbox).

**`install/`** (layout · service)
- `layout` owns where binaries live (versioned paths / current pointer). `service`
  emits the **systemd unit** (`Restart=always`, `RestartSec=5`) — which is what
  makes supervisor self-update possible (stage → exit → systemd relaunch).

**Cross-cutting** (`config` · `error` · `logging` · `observability`)
- Keep the supervisor **small and stable** — it's the dependable parent; it should
  change far less often than its children.

---

## The Compression

**The worker is one process running two polls (control down: commands + per-domain
reconcile incl. revoked-jti ; events up: tail → ship) plus a heartbeat that
carries the self-update check, with all durable state in local SQLite and all
runtime access through the AnyHarness client.** **The supervisor is the stable
parent that keeps the worker + AnyHarness alive (process/) and current (staged,
verified, rollback-able updates/), self-updating via systemd.** They couple
through exactly one thing — the atomic `desired-update.json` mailbox — because the
worker is cloud-facing ("what version") and the supervisor is process-facing
("swap + restart"). Identity is collapsed and ephemeral, so enrollment is simple
and there is no fencing.
