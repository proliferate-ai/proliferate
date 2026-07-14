# Runtime: Worker + Supervisor + Cloud — Design

Status: draft

Current gap: the collapsed Target identity, command/event loops, and hosted
Supervisor topology described here are absent from current code.

## 1. Decision: Collapsed Identity Model (Target = Sandbox, ephemeral)

The cloud records are treated as **truly ephemeral representations of the
sandbox**. There is **no durable runtime identity that outlives a sandbox**:

- **One runtime = one sandbox = one Target (1:1).** No slots, no
  `slot_generation`, no "active slot per target."
- **A sandbox death = a Target death.** Provision a brand-new Target for a fresh
  start. We do **not** recover work across a sandbox replacement.
- **Pause/resume keeps the same instance** (same Target) — only *replacement*
  ends a Target, and replacement = fresh Target.
- **All product state is ephemeral** — workspaces, sessions, projections,
  exposures, claims, commands FK to the Target and **cascade-delete** when it
  dies.

Rationale: we don't re-materialize worktrees or reliably archive chats, so the
old Target/Slot separation was an **unearned, misleading abstraction** — it made
a total failure *look* recoverable. Collapsing makes the model honest and
deletes a large amount of machinery.

If durable history is ever wanted, the durability line goes on a **separate
product record** (conversation/workspace), **not** on a runtime identity — so it
never requires reintroducing slots.

### What the collapse deletes

- `slot_generation` everywhere; the active-slot unique index; the supersession
  chain (`superseded_by/at`).
- **Fencing** (`slot_guard`, slot-identity checks on every call) → becomes
  trivial: a zombie worker's Target is gone, so its token simply won't
  authenticate.
- The re-enroll-under-the-same-Target path and `ensure_primary_profile_target`.

## 2. Entities (collapsed)

```text
TARGET (= runtime = sandbox, ephemeral)
  id, kind ('managed_cloud'|'ssh'|'local'), status ('enrolling'|'online'|'dead')
  owner_scope, owner_user_id, organization_id          # personal vs org
  provider, external_sandbox_id                         # the actual sandbox instance
  lifecycle_on_timeout ('pause'|'kill'), auto_resume    # pause/resume = same instance
  desired_{anyharness,worker,supervisor}_version, update_channel  # self-update desired-state
  worker_token_hash, machine_fingerprint, hostname,
  worker_version, anyharness_version, supervisor_version, last_heartbeat_at  # worker creds + liveness (1:1)

ENROLLMENT (one-time invite)
  id, target_id, token_hash, expires_at, consumed_at

PRODUCT STATE (ephemeral — FK target_id, cascade on Target death)
  workspaces, sessions, transcript_items, pending_interactions,
  exposures, claims, commands, event cursors, control-state, inventory
```

Worker credential + liveness can live as fields on the Target row (1:1) or a
sibling table — implementation choice.

## 3. The Three Components + the Watchdog Chain

```text
systemd  ──supervises──►  proliferate-supervisor  ──supervises──►  proliferate-worker  +  anyharness
 (Restart=always)              (process + update)                   (cloud comms)        (the runtime)
```

- **AnyHarness** — runs agents; normalizes raw ACP → the `SessionEvent` stream;
  serves events by `after_seq`; verifies direct-attach JWTs locally.
- **proliferate-worker** — the cloud-facing process: enrolls, heartbeats, runs
  the two polls, reconciles config, tails events, reports state.
- **proliferate-supervisor** — the process-facing parent: keeps the worker +
  AnyHarness alive and current. Runs as a systemd unit, so systemd is *its*
  watchdog.

Each component has a parent that can restart it after a binary swap — which is
why the supervisor can update all three (including itself, by staging + exiting
and letting systemd relaunch).

## 4. Identity + Lifecycle + State-Reporting Flows

**Enroll (once per Target, at startup):**
```text
PROVISION: create Target (status='enrolling') + mint Enrollment token
           deliver: managed → inject into sandbox env · ssh → return install command
ENROLL:    worker reads token → POST /enroll { token, fingerprint, hostname, versions, inventory }
           cloud consumes token → mark Target online + store worker_token_hash → create control-state
           returns { worker_token, heartbeat_interval = stale/3 }
```
No slot validation; no re-enroll-on-replacement (a dead sandbox is a *new*
Target).

**Auth (every call):** `Bearer <worker_token>` → cloud hashes → looks up the
Target by `token_hash`.

**Heartbeat (liveness):** periodic; updates `last_heartbeat_at`; liveness sweep
marks `dead` if `now − last_heartbeat > stale`. Resumes after pause.

**Self-update:** the heartbeat *response* carries desired versions → the worker
compares to installed → if stale, writes `desired-update.json` to the supervisor
**mailbox** (atomic, idempotent, private). The supervisor reads it and applies
(below).

**Machine fingerprint:** `sha256(OS:ARCH:HOSTNAME)` — a coarse, stable machine id
(no hardware probing).

**Inventory (capabilities):** introspect env (os/arch, git/node/python,
providers, MCPs, declared capabilities) → report **once at startup** (+ in the
enroll payload). Feeds **capability negotiation** (cloud only dispatches kinds
the worker advertised).

**Materialization reports:** **event-driven** — on a materialize command
completing, report the result (e.g. created workspace id). Not a loop.

## 5. The Two Polls (+ what isn't a poll)

```text
POLL 1  control long-poll (DOWN):  commands + ALL reconcile signals (config / exposures / revoked-jti)
POLL 2  event tail (UP):           tail AnyHarness events → ship batches

heartbeat:      a periodic liveness PING (self-update check rides its response) — not a "work poll"
inventory:      one-shot at startup
materialization: event-driven
```

Folding revoked-JTI into the control channel is what turns the old *three*
spawned loops (inbound, outbound, revoked-jti) into **two**.

Loop cadences (worker): heartbeat = `stale/3` (≥10s); control = continuous
long-poll; tail = continuous (~500ms). The control long-poll uses the
parked-coroutine + Redis-doorbell machinery (see protocol doc).

## 6. Reconcile (versioned desired-state) — summary

Config and exposures (and now revoked-JTI) are **desired-state convergence**, not
commands:
- Each domain owns a **revision**; bumps it on change; the cloud signals the
  delta on the control channel; the worker **fetches the bundle, applies it to
  local AnyHarness, verifies, with per-domain backoff**.
- `applied >= desired` is the correctness rule; a missed signal self-heals on the
  next poll. (Full model + contracts: `cloud-worker-protocol-design.md`.)
- **Revoked-JTI is just another reconcile domain** (its own revision; bundle =
  the revoked-list delta; apply = push to local AnyHarness). Better latency than
  the old 60s poll; the ~20-min token TTL is the backstop.

## 7. Up-Direction (events) — summary

AnyHarness mints normalized events (`item_started → item_delta → item_completed`,
stable `item_id`, monotonic `seq`; `item_completed` carries full content). The
worker tails by `after_seq` (cursor in SQLite) and ships batches. Cloud ingest:
exposure-gate → durable/live classify (deltas are live-only, dropped) →
idempotent insert (seq+hash) → derive projections → **after the batch**, publish
patches to Redis (post-commit) + advance the contiguous cursor. Clients get a
Postgres **snapshot + SSE patch stream**; Redis here is a *data channel*
(carries the patch), with the snapshot as recovery. (Detail in the protocol
doc + `events/` code.)

## 8. Worker Code Structure (target)

```text
proliferate-worker/src/
  main.rs · runtime.rs            # entry + loop supervisor (spawns control, tail, heartbeat)
  config/error/logging/observability/process_lock/versions.rs

  identity/                       # enroll · credentials · fingerprint (one-time bootstrap)
  cloud_client/                   # transport TO cloud (one file per endpoint)
  anyharness_client/              # the local runtime substrate (execute, push config, health, pull events)

  control/                        # DOWN — the single control long-poll
    loop.rs                       #   hold the long-poll, route news
    commands/                     #   execute commands (mapping + per-kind handlers)
    reconcile/                    #   UNIFIED reconcile
      manager.rs                  #     revision-compare + per-domain backoff + terminal-failure
      handlers/{auth,plugins,mcp,exposures,revoked_jti}.rs

  tail/                           # UP — event tailer + backfill (was `sync/`)
  lifecycle/                      # heartbeat + self-update (compare → write supervisor mailbox)
  inventory/                      # capability introspection (one-shot report)
  store/                          # local SQLite: cursors · applied-revisions+backoff · exposures · token
```
Changes vs current: rename `sync/`→`tail/`; consolidate `materialization/` +
`sync/revoked_jti` into `control/reconcile/handlers/`; promote `control/` +
`tail/` to the two pillars; add `lifecycle/`.

## 9. Supervisor Code Structure (keep as-is)

```text
proliferate-supervisor/src/
  main.rs                  # CLI: Run · PrintService · VerifyUpdate · StageUpdate
  config/error/logging/observability.rs
  process/                 # run loop · child (spawn) · health · restart (backoff)
  update/                  # manifest (parse + verify sha256) · staging (atomic) · rollback
  install/                 # layout (paths) · service (systemd unit)
```
Responsibilities: **keep children alive** (`process/`) + **staged, SHA-verified,
rollback-able updates** (`update/`) + **layout + systemd** (`install/`). Updates
are per-component (mailbox lists only stale components). Self-update = stage own
binary → exit → systemd (`Restart=always`) relaunches it. Already clean — no
restructure.

## 10. Cloud Code Structure (transport + per-domain revisions/bundles)

```text
cloud/worker/        # TRANSPORT — the channel (both polls' cloud half + identity/lifecycle)
  api.py             #   /worker/* endpoints (control/wait, commands/{lease,delivery,result},
                     #     enroll, heartbeat, inventory, materialization-reports, update-status,
                     #     events/batches, applied-revisions report, bundle routes → domains)
  control/           #   the long-poll machinery (doorbell + revision-delta + lease)
  service.py         #   enroll · authenticate · heartbeat · inventory · materialization · lease/result
  (slot_guard.py)    #   ⟵ DELETE (collapsed model)

cloud/commands/      # imperative ACTS producer: enqueue (preflight/idempotency/wake) + status

cloud/agent_auth/  plugins/  mcp_connections/  skills/  runtime_config/   ( + revoked-jti owner )
                     # each OWNS desired-state + a revision + a worker-facing bundle read
                     #   bump_<domain>_revision on change; build the bundle delta at revision N

cloud/events/        # UP ingest (gate → classify → dedup-insert → project)
cloud/live/          # live fan-out (publish→Redis; SSE snapshot+stream to clients)

db/store/cloud_sync/
  worker_control.py  # the REVISION cursor → generalize to a per-domain RevisionMap
  worker_auth.py     # worker + enrollment (token hashes)
db/models/cloud/
  targets.py         # Target (+ worker creds + enrollment) — collapsed; sandboxes merges in
```

Ownership boundary (the rule): **`cloud/worker` is transport — it must never
build a bundle or know a domain's config internals.** Auth logic in `agent_auth`,
plugin logic in `plugins`; each exposes a thin bundle read; `cloud/worker` only
carries revisions and routes fetches.

## 11. Migration Deltas (what changes vs current)

| Area | Change |
| --- | --- |
| Identity model | **collapse Target = Sandbox**; delete `slot_generation`, `slot_guard`, active-slot index, supersession, re-enroll-existing, `ensure_primary_profile_target` |
| Product state | now **ephemeral** — cascades on Target death |
| `worker_control` | generalize `{control_revision, exposure_revision}` → **per-domain `RevisionMap`** |
| Config domains | each adds a **revision + `bump_*` + worker-facing bundle read** (additive — domains exist) |
| Revoked-JTI | **fold into reconcile** (own revision + bundle); retire its separate poll |
| Config push | **retire** `refresh_agent_auth_config` etc. → revision bumps instead |
| Worker structure | `sync/`→`tail/`; `materialization/`+`revoked_jti`→`control/reconcile/handlers/`; add `lifecycle/` |
| Supervisor | no change (already clean) |
| Up/down protocol | unchanged (commands, events, live fan-out) |

## 12. The One-Frame Model

```text
ONE ephemeral Target (= sandbox = runtime, with worker creds), bootstrapped by a
ONE-TIME Enrollment, running TWO polls (control down: commands + per-domain
reconcile incl. revoked-jti ; events up: tail → projection → SSE fan-out), with a
heartbeat ping carrying the self-update check, supervised by a watchdog chain
(systemd → supervisor → worker + anyharness). Product state lives and dies with
the Target. Identity/lifecycle is dramatically simpler (no slots, no fencing);
the up/down data flows are unchanged.
```
