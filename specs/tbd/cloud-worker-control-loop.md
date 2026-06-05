# Cloud Worker Control Loop Load Reduction

Status: draft implementation spec.

Date: 2026-05-31.

Owners touched by this design:

- Server cloud worker API and service code.
- Proliferate Worker command downlink and event uplink loops.
- Desktop native dispatch worker launch guard.
- Cloud observability for API load and DB pool pressure.

This document is in `specs/tbd/` while the design is being reviewed. When the
implementation lands, the durable contract should move to
`specs/codebase/primitives/cloud-worker-control-loop.md` or be folded into
`specs/codebase/primitives/cloud-commands.md` plus the worker focused guides.

Redis/wake ownership is ratified in
`specs/tbd/shared-redis-wake-ownership.md`. In short: the worker control-loop
owns the worker-control doorbell semantics through the shared `PubSubBus`
contract; worker-tier durable jobs conform to that boundary and keep RabbitMQ,
not Redis, as the durable job broker.

## 1. Purpose

Production web requests became slow because the Cloud API DB pool saturated
under worker polling load. The acute failure mode was API handlers timing out
while waiting for a SQLAlchemy pool checkout. Static web delivery was not the
problem; normal web endpoints were collateral damage behind the same API
service and DB pool.

The observed production shape was:

- `/v1/cloud/worker/exposures` was the largest request source because the
  worker event uplink loop refreshes Cloud exposure state every 500 ms.
- `/v1/cloud/worker/commands/lease` was second because the command downlink
  loop asks Cloud for work every 2 seconds when idle.
- Multiple desktop-launched workers for the same target/config amplified both
  loops after desktop restarts left orphan worker processes running.
- The prod API task used SQLAlchemy's default async adapted queue pool shape:
  pool size 5, max overflow 10, pool timeout 30 seconds. The database
  connection count reached 15 and normal product traffic started failing.

The goal is to preserve fast local event tailing and quick Cloud command
delivery while making idle workers cheap. Idle workers should not continuously
hit DB-backed Cloud endpoints.

## 2. Mental Model

Separate "local freshness" from "Cloud control freshness".

```text
Desktop / target
  Proliferate Worker
    local event loop
      reads local AnyHarness frequently
      uploads only real event batches

    Cloud control loop
      long-polls Cloud for command or exposure/topology changes
      reconciles exposure snapshots only when Cloud says they changed

    target status loop
      heartbeats/inventory/update status at low frequency

Cloud API
  short DB transactions
  target-scoped control cursor
  publish after commit
  no DB connection held while a worker waits
```

The DB is the source of truth for worker authentication, target state, command
leasing, exposure policy, projection cursors, and event ingest. The worker
should still treat Cloud as authoritative. The change is not to bypass Cloud;
it is to replace high-frequency empty polling with a bounded wait that only
touches the DB at the beginning and end of a request.

## 3. Current Implementation

Worker composition is currently one process with separate loops:

- `anyharness/crates/proliferate-worker/src/runtime.rs` starts the command
  loop, event sync loop, revoked-JTI loop, and heartbeat loop.
- `anyharness/crates/proliferate-worker/src/commands/dispatcher.rs` flushes
  pending results, probes AnyHarness, calls `/worker/commands/lease`, and
  sleeps for 2 seconds when no command is returned.
- `anyharness/crates/proliferate-worker/src/sync/tailer.rs` probes
  AnyHarness, calls `/worker/exposures` inside `reconcile_projection_cursors`,
  discovers sessions, tails active local cursors, uploads batches when events
  exist, and sleeps for 500 ms.
- `anyharness/crates/proliferate-worker/src/cloud_client/mod.rs` uses a global
  30 second reqwest timeout.

Server endpoints are DB-backed:

- `server/proliferate/server/cloud/worker/api.py` exposes
  `/worker/commands/lease` and `/worker/exposures` with the standard
  `get_async_session` dependency.
- `server/proliferate/server/cloud/worker/service.py` authenticates every
  worker request by token hash and target lookup.
- `lease_worker_command` normalizes supported kinds, checks target state,
  expires stale commands, calls `commands_store.lease_next_command`, commits
  if it leased or expired anything, and returns immediately when there is no
  command.
- `list_worker_exposures` loads active workspace exposures and projection
  cursors for the target, then loads Cloud workspaces while building the
  response.

Desktop process ownership is process-local:

- `apps/desktop/src-tauri/src/commands/cloud_worker.rs` stores one child in
  Tauri state and uses `kill_on_drop(true)`.
- There is no cross-process lock. If Desktop crashes or restarts, old workers
  can keep running under `ppid=1` and a new Desktop process can spawn another
  worker for the same target/config.

## 4. Target Behavior

Idle steady state should be roughly:

- One control long poll every 20 seconds per worker.
- One heartbeat on the configured low-frequency interval.
- One revoked-JTI poll on its existing low-frequency interval.
- Zero exposure refresh requests while exposure/projection state is unchanged.
- Zero command lease requests while no command is available, except the
  bounded long-poll returns.

Active state should remain quick:

- A newly queued command wakes the worker control loop immediately after the
  command commit.
- Exposure/projection control-fingerprint changes wake the worker control loop
  immediately after the exposure/projection commit.
- Local AnyHarness event tailing still runs at the local cadence for known
  active cursors and uploads batches as soon as it observes new events.

## 5. API Contract

Add a worker-facing control endpoint:

```text
POST /v1/cloud/worker/control/wait
```

Request:

```json
{
  "supportedKinds": ["start_session", "send_prompt"],
  "controlCursor": "target-control:42:17",
  "waitSeconds": 20,
  "leaseTimeoutSeconds": 300
}
```

Response:

```json
{
  "serverTime": "2026-05-31T22:18:30Z",
  "reason": "command",
  "controlCursor": "target-control:43:17",
  "command": {
    "commandId": "...",
    "idempotencyKey": "...",
    "targetId": "...",
    "workspaceId": "...",
    "cloudWorkspaceId": "...",
    "sandboxProfileId": "...",
    "sessionId": "...",
    "kind": "send_prompt",
    "payload": {},
    "observedEventSeq": 42,
    "preconditions": null,
    "leaseId": "...",
    "leaseExpiresAt": "..."
  },
  "exposures": null
}
```

`reason` values:

- `command`: a command was leased and returned.
- `exposures`: the worker's exposure/projection snapshot changed.
- `command_and_exposures`: both happened before the response was produced.
- `state_changed`: the cursor advanced, but no leaseable command or exposure
  payload is relevant to this worker's request.
- `timeout`: no relevant change arrived before `waitSeconds`.

Semantics:

- `controlCursor` is target-scoped and opaque to the worker. The worker stores
  and echoes it.
- A missing `controlCursor` means first call or fallback recovery; Cloud should
  return the current exposure snapshot and cursor.
- A malformed, unknown, ahead-of-current, or obsolete `controlCursor` is
  treated as missing/stale. Cloud returns the current full exposure snapshot
  and cursor instead of failing the request.
- The worker stores the returned `controlCursor` from every successful
  response, including `timeout` and `state_changed` responses.
- `waitSeconds` is clamped server-side. V1 target: minimum 1 second, maximum
  20 seconds. This leaves margin under the worker's current 30 second reqwest
  timeout and reduces the chance of committing a lease whose response cannot
  reach the worker before the client deadline.
- `leaseTimeoutSeconds` keeps the existing command lease reservation meaning.
  It intentionally mirrors the existing `/commands/lease` request field. It is
  not the long-poll wait.
- If a command is available, Cloud should lease at most one command, same as
  the current lease endpoint.
- `command` is the full existing `WorkerCommandEnvelope | null`.
- If exposures did not change, `exposures` is `null`, not an empty list.
- If exposures changed, `exposures` is `list[WorkerExposureSnapshotResponse]`
  with the same item shape as the current `/worker/exposures` endpoint so the
  worker can reuse reconciliation.

Keep existing endpoints for compatibility:

- `/worker/commands/lease`
- `/worker/exposures`

New workers try `control/wait` first. On 404/405 or an explicit unsupported
response, they fall back to throttled legacy paths. They must not fall back on
401, 403, 409, stale-target responses, or malformed successful responses.

## 6. Server Design

### 6.1 Control Cursor

Create a target-scoped worker control cursor. The cursor advances when any
state change could make an idle worker's next Cloud decision different:

- A command is queued by any producer, including web, mobile, desktop,
  automation, Slack, agent-auth refresh, runtime-config refresh, and internal
  target-config flows.
- A queued command becomes leaseable because a blocker clears, such as
  agent-auth applied state, runtime-config applied state, workspace lifecycle
  state, or target status.
- A workspace exposure is created, archived, claimed, materialized, or has its
  revision/commandability/workspace mapping changed.
- A session projection is created or updated in a way that changes the worker
  exposure snapshot.
- The target is archived or replaced (a worker bound to a retired target may no
  longer lease or upload).

Do not advance this cursor for ordinary event progress. In particular,
`last_uploaded_seq`, `last_event_seq`, transcript row changes, and live UI
patches should not wake the worker control loop. The running worker already
updates its local cursor from event-batch acknowledgements. A restarted worker
gets current sequence state by sending no `controlCursor` and receiving a full
snapshot.

Define the cursor over a control fingerprint, not over the whole exposure
response. The fingerprint includes membership and routing fields that affect
which local work the worker should tail or which commands it can lease:

- exposure id/status/revision
- cloud workspace id
- AnyHarness workspace id
- session projection id
- AnyHarness session id
- projection level
- commandable flag
- target availability for the authenticated worker

The fingerprint excludes upload-ack-only and UI projection progress fields:

- `lastUploadedSeq`
- `lastEventSeq`
- transcript item updates
- pending interaction display changes

Those excluded fields may still be present in a full snapshot response when
the worker's cursor is missing or stale; they must not by themselves advance
the target control cursor.

V1 should add a small table instead of deriving the cursor from wide existing
state:

```text
cloud_worker_target_control_state
  target_id uuid primary key
  control_revision bigint not null
  exposure_revision bigint not null
  exposure_fingerprint_hash text not null
  updated_at timestamptz not null
  exposure_updated_at timestamptz not null
```

Command-only changes increment `control_revision` only. Exposure/projection
fingerprint changes increment both `control_revision` and `exposure_revision`
and update `exposure_fingerprint_hash`. This lets the server distinguish a
stale cursor that needs an exposure payload from a command-only or
state-only wake that should return `exposures: null`.

Add store helpers under `server/proliferate/db/store/cloud_sync/`:

- `get_worker_control_state(db, target_id)`
- `bump_worker_control_state(db, target_id, now)`
- `bump_worker_exposure_control_state(db, target_id, exposure_fingerprint_hash, now)`
- `bump_worker_control_state_for_targets(db, target_ids, now)` if a producer
  changes several targets at once.
- `list_worker_control_exposure_snapshot(db, target_id)` returning the current
  frozen store dataclasses in one store-level read path.
- `has_leaseable_command(db, target_id, supported_kinds, now)` if a cheap
  pre-wait check is useful before taking a lease lock.

Because existing stores must not call peer stores, prefer service-level bump
calls around the mutation surfaces. If a store hides command/exposure side
effects internally, change that store to return a small "worker control dirty"
flag or enough changed target ids for the service to bump after the store call.

`bump_worker_control_state` must be atomic: a single insert-on-conflict/update
that increments `revision` inside the same database transaction as the
mutation. It must not be a read-modify-write helper.

Pydantic response construction stays in `server/cloud/worker/models.py`.
Stores return frozen dataclasses such as `WorkerControlExposureSnapshot`;
models expose constructors that turn those dataclasses into
`WorkerExposureSnapshotResponse`.

The same batched exposure snapshot helper must back both the new
`control/wait` endpoint and the existing `/worker/exposures` endpoint. The
legacy endpoint is still on the hot path for old workers, so it should not keep
the current service-level loop that re-fetches Cloud workspaces one by one.

Control cursor invalidation must be owned at concrete mutation surfaces:

| Mutation surface | Transaction owner | Bump scope | Wake |
| --- | --- | --- | --- |
| Command enqueue from web/mobile/desktop/API | `server/cloud/commands/service.py` | target-wide control revision | yes |
| Idempotent command reuse | `server/cloud/commands/service.py` | target-wide control revision only if existing command is active or may become leaseable | yes only for active/nonterminal reuse |
| Command enqueue from Slack | `server/cloud/slack/service.py` or shared enqueue helper | target-wide | yes |
| Command enqueue from automations | `server/automations/worker/cloud_executor_commands.py` or shared enqueue helper | target-wide | yes |
| Internal agent-auth/runtime-config/target-config command enqueue | owning service or shared enqueue helper | target-wide | yes |
| Stale command expiry, supersede, or blocker transition | command lease/wait service that mutates status | target-wide | yes, may return `state_changed` |
| Exposure upsert/archive/claim/materialization clear | workspace/claims/mobility/Slack service around `exposures_store` | target-wide | yes |
| Exposure workspace mapping or commandable revision changed by command result | command result service/store result surfaced to service | target-wide | yes |
| Session projection membership/config created, ended, or reattached | event ingest or command result service, only when control fingerprint changes | target-wide | yes |
| Upload ack or transcript/projection progress only | event ingest | none | no |
| Target archive/status or target replacement | target/runtime/provisioning service | target-wide | yes |
| Worker archive/token replacement | worker/admin service | target-wide | yes |
| Agent-auth/runtime-config applied state clears a lease blocker | worker report/status service | target-wide | yes |

### 6.2 Wake Publishing

The shared Redis/wake decision is ratified in
`specs/tbd/shared-redis-wake-ownership.md`: this control-loop owns the
worker-control doorbell semantics and uses the shared `PubSubBus` integration
contract. Worker-tier durable jobs may use the same Redis deployment for
redbeat/locks/rate limits, but they do not redefine this channel or use Redis
as the job broker.

Add a worker control channel:

```python
def worker_control_channel(*, target_id: UUID) -> str:
    return f"worker-control:{target_id}"
```

Publish after commit whenever `bump_worker_control_state` is called. The
payload only needs the new cursor/revision; the response still reads DB truth
before returning.

All command producers must participate. Today commands can be created through
`server/cloud/commands/service.py`, Slack service code, agent-auth service
code, runtime-config service code, and automation cloud executor code. The
control bump should live in a shared command enqueue helper where possible; if
not, tests must cover each producer.

The current live bus is process-local. That is acceptable for the current
single ECS API task only because the long-poll also has a timeout fallback. If
the API service scales horizontally, this channel must move to a shared
backend such as Redis/NATS before relying on immediate wake across tasks.
Production rollout must therefore assert one of these gates:

- API desired/running task count is 1, and immediate worker wake is
  best-effort with timeout fallback. The deployment must also use a single app
  worker process per task while the bus is process-local, and deploy config
  must avoid overlapping old/new API tasks while relying on immediate wake.
- A shared pub/sub backend is deployed before API horizontal scaling.

### 6.3 Wait Flow

The endpoint must not hold a DB connection while waiting for a wake signal.

Flow:

```text
1. Authenticate worker in a short DB session.
2. Validate the worker's target is current (not archived) before waiting.
3. Read current control cursor.
4. Expire stale commands and apply any blocker-status transitions that the
   existing lease path would apply.
5. Bump the control revision if expiry or blocker transitions mutated state.
6. Try to lease a command immediately, regardless of whether the supplied
   cursor matches. A worker's local supported-kind set can change without a
   Cloud-side cursor bump.
7. If command, exposure delta, or cursor-only state change exists, commit any
   lease/expiry/blocker mutations, close the session, and return immediately.
8. Subscribe to worker_control_channel(target_id).
9. Re-check DB after subscribing to close the subscribe/check race.
10. If still no relevant change, close the recheck session and await pub/sub
    or timeout without a DB session.
11. Open a fresh short DB session.
12. Re-authenticate and validate the captured worker identity is still current.
13. Validate the target is still current (not archived) again.
14. Expire stale commands and apply any blocker-status transitions again.
15. Bump the control revision if expiry or blocker transitions mutated state.
16. Lease one command if available.
17. Fetch exposures only if the exposure revision changed or the request had
    no usable cursor.
18. Commit any lease/expiry/blocker mutations and close the session before
    returning a command response.
19. Return response.
```

The subscribe-before-recheck step prevents missing a commit that lands between
the first DB check and subscription registration.

Session scopes are part of the contract: the precheck session closes before
waiting; the subscribe-after-check recheck uses its own short session; final
wake/timeout processing uses a fresh session. No database session is held
across the pub/sub wait.

The wait deadline should be the minimum of the request `waitSeconds` and the
next known time-based command expiry that could change the response for this
target. This keeps expiry/status cleanup from depending on a brand-new worker
request arriving at exactly the right moment.

For cursor-only changes caused by expiry, supersede, blocker transition,
target change (archive/replacement), or worker archive, return:

```json
{
  "reason": "state_changed",
  "command": null,
  "exposures": null
}
```

with the updated `controlCursor`.

If the worker's target is no longer current (archived/replaced), `control/wait`
should fail closed with the same stale-target/auth error family used by lease
and event upload paths. Target replacement must bump the control cursor and
publish so old waiters wake and stop tailing.

### 6.4 Session Lifetime Exception

The normal server pattern is `db: AsyncSession = Depends(get_async_session)`.
For this long-poll endpoint, using a request-scoped yielded DB dependency would
make it too easy to keep the session open across the wait. FastAPI's yield
dependency docs state that default request-scoped cleanup happens after the
response is sent, while SQLAlchemy's async pool uses the same QueuePool limits
as the synchronous pool. This endpoint needs explicit short session scopes.

Use a small, documented exception rather than scattering session factory usage:

- Promote a narrow subdomain at
  `server/proliferate/server/cloud/worker/control/`.
- `worker/api.py` remains transport-only for the route registration and calls
  the control subdomain service.
- `worker/control/service.py` is the session-owning long-poll orchestrator.
- `worker/control/models.py` owns the new request/response Pydantic models if
  keeping them in parent `worker/models.py` would make the file too crowded.
- Keep ordinary worker auth, command, and exposure snapshot builders in parent
  `worker/service.py` only when they remain broadly shared; otherwise move
  control-only orchestration into the subdomain service.
- Keep raw SQLAlchemy query construction inside stores.
- Update server docs or add a short note in this spec when the code lands so
  reviewers know this endpoint intentionally owns short DB sessions.

## 7. Worker Design

### 7.1 Cloud Control Coordinator

Add a narrow `cloud_control` coordinator. It owns only:

- `control/wait` cadence and request cancellation.
- The durable control cursor.
- Fallback mode state.
- Delegating returned command envelopes to command downlink.
- Delegating returned exposure snapshots to event uplink.

It does not own command lifecycle, command mapping, AnyHarness dispatch, event
cursor policy, workspace discovery, event tailing, or Cloud exposure policy.
Those stay in command downlink and event uplink. If this module is added, the
worker structure docs must be updated in the same PR to name the coordinator
and its dependency direction.

Persist the control cursor only alongside a compatible local exposure-cache
generation. On process start, the first control request sends
`controlCursor: null` unless the worker has both a persisted cursor and a
current-version local exposure cache. Store the returned cursor after every
successful response.

Loop shape:

```text
flush pending command results
compute supported command kinds from local capability/health
POST /worker/control/wait
  if command: process one command through existing command processor
  if exposures present: reconcile projection cursors
  if timeout: loop
on unsupported endpoint: run legacy command lease + exposure polling fallback
on transient error: back off
```

The loop should not read local AnyHarness events. It only coordinates Cloud
control decisions.

Local capability changes are also wake signals. If AnyHarness health changes
while a long poll is pending, the worker may otherwise wait until timeout with
an obsolete `supportedKinds` list. The implementation should either keep the
server max wait low enough that this delay is acceptable or run the wait under
a `tokio::select!` with a local capability timer that cancels and restarts the
control request when supported kinds change.

Pending command result retry must not be trapped behind a 20 second idle wait.
Either keep result flushing in a short independent retry task, or make the
control wait cancellable on a result-retry timer.

The event uplink loop must receive an initial full control snapshot before it
tails local projection cursors in control mode. Until that first snapshot
lands, the worker should either pause event uplink or use the throttled legacy
exposure refresh path.

Command processing must not accidentally starve exposure reconciliation. The
safest V1 is still one command in flight per worker, but the coordinator should
make that tradeoff explicit:

- If command processing remains inline, run a fresh control pass immediately
  after the command result/reporting path completes, and accept that exposure
  changes during a long command wait until that point.
- If long materialization/backfill commands make that delay unacceptable,
  split command processing into a single-flight command task and let
  `cloud_control` continue waiting for exposure changes while refusing to lease
  another command until the current command reaches a terminal delivery result.

### 7.2 Fallback State

Fallback exists for deployment compatibility only. It must be cheaper than the
current production load.

Rules:

- 404/405 or an explicit unsupported-control response enters fallback.
- 5xx, network errors, and client timeouts are transient control errors; back
  off and retry `control/wait`.
- 401/403/409/stale-target responses are terminal for the worker's current
  identity and must not fall back.
- In fallback, command lease polling is no faster than every 5-10 seconds.
- In fallback, exposure refresh is no faster than every 15-30 seconds.
- Fallback periodically probes `control/wait` again so a newly deployed server
  can recover without a worker restart.

### 7.3 Event Uplink Loop

Keep local event tailing frequent, but remove Cloud exposure fetches from the
500 ms path.

After the control loop reconciles exposures into local cursors, the event loop
does:

```text
probe local AnyHarness
read active workspace-level exposure snapshots from the local worker store
discover sessions for those workspace exposures on the existing discovery
  throttle
tail active local projection cursors
upload batches only when events exist
sleep 500 ms
```

If the control endpoint is unavailable and the worker is using fallback, the
exposure refresh path uses that fallback mode.

The current local store only persists session projection cursors. To remove
Cloud exposure fetches from the 500 ms loop, add a worker-local exposure cache:

```text
worker_workspace_exposure
  exposure_id text primary key
  cloud_workspace_id text not null
  anyharness_workspace_id text not null
  projection_level text not null
  commandable integer not null
  status text not null
  revision integer
  updated_at text not null
```

Control responses reconcile both:

- workspace-level exposures into `worker_workspace_exposure`
- session-level exposures into `worker_projection_cursor`

The event loop reads active workspace-level exposures from
`worker_workspace_exposure` for discovery and active session cursors from
`worker_projection_cursor` for event tailing.

### 7.4 Client Timeout

`CloudClient::new` currently sets a 30 second global timeout. Either:

- clamp server `waitSeconds` to at most 20 seconds and keep the existing client
  timeout, or
- add a per-request timeout for `control/wait` that is
  `waitSeconds + 5-10 seconds`.

Prefer the first implementation unless real network conditions make it too
tight. Client timeouts on `control/wait` are transient control errors and do
not trigger legacy fallback.

Add small client-side jitter before reconnecting after timeout/error so a fleet
does not synchronize retries. Server-side wait handlers must clean up
subscriptions on client disconnect or cancellation.

### 7.5 Single Instance Guard

Add a cross-process worker guard before network loops start.

Rules:

- The guard key is the worker config path or worker DB path. For desktop, this
  naturally scopes to one target's `~/.proliferate/cloud-worker/<target>/`.
- The guard is acquired immediately after config load and canonical path
  resolution, before `WorkerStore::open`, migrations, identity enrollment,
  heartbeat, or polling.
- If another live worker holds the guard, the new worker logs a clear message
  and exits cleanly before enrolling, heartbeating, or polling.
- The guard must release on normal exit and must not leave stale state after a
  process crash.

Preferred implementation:

- Use an OS file lock on a lock file next to `worker.sqlite3` or
  `config.toml`.
- Keep the lock handle alive for the whole worker runtime.
- Write best-effort metadata next to the lock file: pid, started_at,
  config_path, worker_db_path, target_id when known, and anyharness_base_url.
- Add Rust tests for the lock helper.

Desktop can still keep its process-local child management. The worker-level
guard is the correctness boundary because it also covers orphaned processes and
multiple Desktop processes.

Desktop must respect the same guard before destructive credential actions. In
particular, it must not remove or replace `worker.sqlite3` when another worker
holds the DB-path lock. When a fresh enrollment token is present and the lock is
held, Desktop should surface a distinct status rather than deleting under the
running worker.

### 7.6 Desktop Lifecycle UX

Desktop should learn quickly whether the spawned worker actually became the
active owner:

- The worker exits with a recognizable duplicate-lock code or emits a startup
  status that Desktop can map to `already_running_elsewhere`.
- `ensure_desktop_dispatch_worker` may wait briefly after spawn for early
  duplicate-lock exit instead of reporting `started` immediately.
- If a duplicate worker already holds the lock but is clearly stale because its
  AnyHarness base URL has been unhealthy or unreachable for a bounded period,
  Desktop can offer an explicit restart/replace action. Automatic orphan
  killing should be conservative and separate from the first protocol fix.

## 8. Observability

Add or preserve metrics/log fields that answer:

- Requests per minute by worker endpoint.
- API route latency p50/p95/p99 and status count by route.
- ALB `TargetResponseTime`, 5xx, and 504 counts.
- DB pool checkout timeout count.
- SQLAlchemy pool checked-out count and checkout wait duration if practical.
- RDS connections, CPU, and wait/lock signals available from CloudWatch.
- Control wait in-flight count, client disconnect count, and cancellation
  cleanup count.
- Control wait response reason counts.
- Control wait duration p50/p95/p99.
- Pub/sub subscriber count and dropped-message count for worker control
  channels.
- Current worker count by target and by source IP.
- Old-vs-new worker version adoption.
- Exposure snapshot size by target.
- Command lease attempts and leased command count.
- Fallback-to-legacy count.
- Single-instance guard contention count.
- Web workspace/chat endpoint p95 so residual product latency remains visible
  after worker load drops.

Dashboard target panels:

- API latency p50/p95/p99.
- API status counts by route.
- API 5xx by endpoint per minute.
- ALB 5xx/504 and `TargetResponseTime`.
- Top endpoints by request count.
- Worker request volume split by endpoint.
- RDS database connections, CPU, and relevant wait/lock signals.
- SQLAlchemy pool checkout timeouts and checked-out count.
- Control wait reason split.
- Control wait in-flight count, duration, and client disconnects.
- Pub/sub subscribers and drops.
- Worker version adoption.
- Duplicate worker guard exits.
- Web workspace/chat endpoint latency.

Use target id and source IP as structured log fields or top-K dashboard
dimensions, not unbounded high-cardinality metric labels.

Do not create or update production dashboards without explicit operator
approval.

## 9. Rollout

Order:

1. Add worker single-instance guard. This immediately prevents one class of
   amplification and is independent of the protocol work.
2. Decouple legacy event uplink's 500 ms local tailing from Cloud exposure
   refresh, with exposure refresh no faster than every 15-30 seconds. This is
   no longer an emergency-only option; it is the first hot-path reduction.
3. Replace `/worker/exposures` response construction with the shared batched
   exposure snapshot helper so old workers are cheaper while they still exist.
4. Add server control cursor, wake publishing, and `control/wait` endpoint
   behind the existing worker routes.
5. Add worker `control/wait` client and `cloud_control` coordinator with
   throttled legacy fallback.
6. Ship a worker/desktop release and verify request volume drop in production.
7. Gate production rollout on observed endpoint RPM, DB connection usage, pool
   timeout count, and worker version adoption.
8. After all active workers are new enough, consider slowing further or
   removing the legacy idle polling paths.

Already-running old workers need an explicit brake/adoption plan because they
will not change cadence until restarted or updated. Production rollout must
choose at least one of:

- A Desktop/worker adoption plan that restarts or replaces old local workers
  and verifies worker-version adoption.
- Server-side short-TTL and singleflight caching for legacy `/worker/exposures`
  after worker authentication, keyed by target/worker token, so repeated old
  requests do not repeatedly execute the full exposure/projection snapshot
  query.
- A guarded legacy `/worker/exposures` rate brake for abusive duplicate
  workers, using response behavior old workers already back off from, with an
  operator-reviewed safety switch.

The first implementation includes a short-TTL server cache for legacy exposure
snapshots after worker authentication. That lowers the worst query path for old
workers, but it is not a substitute for version-adoption tracking or explicit
production dashboards.

## 10. Verification

Server tests:

- `control/wait` returns immediately with a leased command when a command is
  queued.
- `control/wait` returns changed exposures when the request cursor is missing
  or stale.
- `control/wait` with a current cursor does not execute the exposure snapshot
  query.
- Command blocker transitions advance the control cursor before returning
  `state_changed`.
- `control/wait` times out with no command/exposure payload and a current
  cursor when nothing changes.
- A pub/sub wake after subscription causes the wait to return before timeout.
- The subscribe-then-recheck race is covered.
- No DB session/connection is held during the wait. This can be tested with a
  fake session factory or instrumentation around session enter/exit.
- A command leased through `control/wait` is committed before the response is
  returned, so immediate delivery/result reporting cannot race the lease
  commit.
- Time-based command expiry can wake or shorten a wait and returns an updated
  cursor.
- The shared batched exposure snapshot helper backs both `control/wait` and
  `/worker/exposures`.
- Existing `/commands/lease` and `/exposures` behavior remains compatible.

Worker tests:

- Client serializes/deserializes `control/wait` request/response.
- 404/405 from `control/wait` triggers legacy fallback.
- Exposure reconciliation is driven by control responses, not the 500 ms event
  loop in the new mode.
- The event uplink waits for an initial full control snapshot before tailing
  local cursors in control mode.
- Fallback command and exposure polling use the throttled cadences and do not
  activate on auth/stale-target errors.
- Event batches still upload promptly for existing local cursors.
- The process lock prevents a second worker for the same config/DB.

Integration/manual verification:

- Start one local Desktop worker and confirm idle Cloud request rate is near
  the long-poll cadence.
- Queue a command and confirm the worker wakes before long-poll timeout.
- Change an exposure/projection and confirm the worker reconciles without the
  old 500 ms exposure polling.
- Restart Desktop while a worker is running and confirm the duplicate exits or
  is not spawned.
- Watch production RDS connections remain below pool capacity during idle
  workers.

## 11. Residual Web Performance

This spec reduces worker-induced DB pressure. It does not by itself optimize
all Web slowness.

After worker load drops, Web can still be slow because:

- Workspace and chat screens issue several DB-backed snapshot/list/live
  requests during navigation.
- Workspace summaries and related enrichment paths can have their own N+1 or
  fan-out costs.
- Command-status polling and SSE delivery still share the same API and DB
  resources.
- The current process-local pub/sub limitation also affects Web live streams
  under multiple API tasks or app worker processes.

Keep Web workspace/chat endpoint latency on the dashboard after worker endpoint
RPM and DB pool timeouts are controlled.
