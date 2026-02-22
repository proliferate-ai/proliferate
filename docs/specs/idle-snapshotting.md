# Idle Snapshotting - System Spec

## 1. Scope & Purpose

### In Scope
- Idle detection in gateway hubs (`apps/gateway/src/hub/session-hub.ts`).
- Idle snapshot execution and expiry-idle behavior in migration controller (`apps/gateway/src/hub/migration-controller.ts`).
- Resume behavior after paused/idle sessions (`apps/gateway/src/hub/session-runtime.ts`).
- Provider capability usage for memory snapshot, pause, and filesystem snapshot (`packages/shared/src/providers/modal-libmodal.ts`, `packages/shared/src/providers/e2b.ts`).
- Distributed safety primitives used by idle snapshotting (migration lock + session leases) (`packages/services/src/lib/lock.ts`, `apps/gateway/src/lib/session-leases.ts`).
- Orphan backstop cleanup (`apps/gateway/src/sweeper/orphan-sweeper.ts`).

### Out of Scope
- Generic session creation/delete/rename lifecycle. See `docs/specs/sessions-gateway.md`.
- Sandbox boot internals and image layering. See `docs/specs/sandbox-providers.md`.
- Billing enforcement policy and org-wide pause semantics. See `docs/specs/billing-metering.md`.
- Automation run orchestration beyond the `automation.complete` fast-path integration. See `docs/specs/automations-runs.md`.

### Mental Models

1. Idle snapshotting is a coordination protocol, not a timer.
It combines hub-local signals, Redis locks/leases, and DB fencing updates. No single signal is authoritative.

2. Hub state is a hint plane; DB state is the durable plane.
`SessionHub` tracks live activity and readiness, but final lifecycle truth is written to `sessions` via CAS updates (`packages/services/src/sessions/db.ts:updateWhereSandboxIdMatches`).

3. "Idle" means no meaningful activity across all ingress channels.
No WS clients alone is insufficient. Tool callbacks, proxy WS connections, in-flight assistant messages, and grace windows all participate (`apps/gateway/src/hub/session-hub.ts:shouldIdleSnapshot`).

4. Pause reason is part of lifecycle semantics.
`pauseReason` encodes why a session left running state (`inactivity`, `orphaned`, `snapshot_failed`) and is used by UI/status derivation (`packages/shared/src/sessions/display-status.ts`).

5. Provider capability decides snapshot mechanics.
Modal prefers memory snapshots, E2B prefers pause/resume, and filesystem snapshot remains a fallback path in current code (`apps/gateway/src/hub/migration-controller.ts`).

---

## 2. Core Concepts

### Idle Predicate
A session is snapshot-eligible only when `SessionHub.shouldIdleSnapshot()` returns true, which currently requires all of:
- `activeHttpToolCalls === 0`
- no running tools in event processor
- `clients.size === 0`
- `proxyConnections.size === 0`
- no unresolved assistant turn OR explicit known-idle signal (`lastKnownAgentIdleAt !== null`)
- SSE ready OR previously observed agent-idle (`lastKnownAgentIdleAt !== null`)
- sandbox exists in context (`sandbox_id`)
- grace period elapsed (`apps/gateway/src/hub/session-hub.ts:570-587`)

### Activity Clock
`lastActivityAt` is the grace-period anchor and is updated through `touchActivity()` from multiple paths:
- websocket client connect/disconnect
- proxy connect/disconnect
- prompt ingress
- lifecycle middleware
- tool callback start/end
- SSE event handling
- heartbeat route (`apps/gateway/src/api/proliferate/http/heartbeat.ts`)

### Known-Idle Fallback
If SSE drops after the hub observed a busy->idle transition, `lastKnownAgentIdleAt` allows idle snapshotting to proceed even while `runtime.isReady()` is false (`apps/gateway/src/hub/session-hub.ts:1278-1291`, `570-579`).

### Reconnect Intent
Auto-reconnect uses timer generation guards in hub code and a post-lock intent check in runtime code. The runtime must abort `auto_reconnect` when DB status is already `paused` (`apps/gateway/src/hub/session-hub.ts:1307-1359`, `apps/gateway/src/hub/session-runtime.ts:296-300`).

### Distributed Fencing
Idle transitions are fenced by lock + CAS:
- lock: `runWithMigrationLock(sessionId, 300_000, ...)`
- CAS: `updateWhereSandboxIdMatches(sessionId, expectedSandboxId, ...)`
A stale actor must not overwrite newer sandbox state (`apps/gateway/src/hub/migration-controller.ts`, `packages/services/src/sessions/db.ts:322-345`).

### Orphan Backstop
A 15-minute sweeper scans DB `running` sessions and checks runtime lease. Missing leases trigger cleanup through local hub logic (if present) or direct locked DB/provider flow (if no hub) (`apps/gateway/src/sweeper/orphan-sweeper.ts`).

Sections 3 and 4 are intentionally omitted. File layout and data model details are code-first in this spec.

---

## 5. Lifecycle States & Ownership Boundaries

### Session State Outcomes (Idle-Related)
- `running`: active runtime is expected (normal steady state).
- `paused` + `pauseReason: "inactivity"`: idle snapshot/expiry-idle success path.
- `paused` + `pauseReason: "orphaned"`: orphan sweeper cleanup path.
- `stopped` + `pauseReason: "snapshot_failed"`: idle snapshot circuit-breaker terminal path (`apps/gateway/src/hub/migration-controller.ts:268-311`).

### Ownership Layers
- Hub-local ownership: one `SessionHub` per session per process via `HubManager.pending` dedupe (`apps/gateway/src/hub/hub-manager.ts:14-54`).
- Cross-process ownership: Redis owner lease (`lease:owner:{sessionId}`) and runtime lease (`lease:runtime:{sessionId}`) (`apps/gateway/src/lib/session-leases.ts`).
- Cross-operation exclusion: migration lock in shared services lock module (`packages/services/src/lib/lock.ts`).

---

## 6. Deep Dives (Invariants & Rules)

### 6.1 Idle Detection Invariants
- The full idle predicate must be checked both before and inside the migration lock.
- Idle eligibility must include callback/tool/proxy activity, not just websocket presence.
- Grace period depends on session client type:
  - `automation` / `slack`: fixed 30s
  - others: `IDLE_SNAPSHOT_DELAY_SECONDS`
- `sandbox_id` must be present before attempting idle snapshot.
- A busy->idle state transition is detected by comparing `currentAssistantMessageId` before/after event processing.

Evidence: `apps/gateway/src/hub/session-hub.ts:570-595`, `965-979`, `1278-1291`.

### 6.2 Ingress Activity Invariants
- Any ingress path that may race with idle snapshot must update activity before potentially blocking work:
  - lifecycle middleware calls `touchActivity()` before `ensureRuntimeReady()`.
  - proxy routes call `touchActivity()` and register proxy presence.
- Proxy cleanup must be idempotent.
- Tool callbacks must bracket execution with `trackToolCallStart()` / `trackToolCallEnd()`.
- Heartbeat only refreshes activity if a hub already exists; it must not implicitly create or resume runtime.

Evidence: `apps/gateway/src/middleware/lifecycle.ts`, `apps/gateway/src/api/proxy/terminal.ts`, `apps/gateway/src/api/proxy/vscode.ts`, `apps/gateway/src/api/proliferate/http/tools.ts`, `apps/gateway/src/api/proliferate/http/heartbeat.ts`.

### 6.3 Idle Snapshot Execution Invariants
- `runIdleSnapshot()` must only proceed from `migrationState === "normal"`.
- Reconnect timers are canceled before migration lock acquisition.
- Lock TTL for idle snapshot is 300s.
- After lock acquisition, runtime context (`sandbox_id`) must be re-read.
- SSE is disconnected before snapshot/terminate operations.
- Snapshot strategy in current implementation is capability-ordered:
  - memory snapshot if available
  - else pause if supported
  - else filesystem snapshot
- Sandbox termination is required only when snapshot method does not preserve resumable sandbox identity.
- If termination fails after snapshot capture, the system keeps `sandbox_id` in session state so later cleanup can fence against the live sandbox.
- DB update must be CAS-fenced on expected sandbox ID.
- Telemetry flush and expiry cancellation are best-effort side effects.
- Runtime state is reset after success, CAS mismatch, and caught failure paths.

Evidence: `apps/gateway/src/hub/migration-controller.ts:94-262`.

### 6.4 Resume Invariants
- `ensureRuntimeReady()` coalesces concurrent callers with a single in-flight promise.
- Resume waits for migration lock release unless explicitly bypassed for internal migration operations.
- Context is always reloaded from DB before provider operations.
- Auto-reconnect intent must abort when the reloaded session is already paused.
- Modal memory-restore failures clear `snapshotId` in DB and rethrow the error.
- Successful resume writes session status back to `running`, schedules expiry, and reconnects SSE.

Evidence: `apps/gateway/src/hub/session-runtime.ts:209-234`, `267-300`, `379-395`, `444-510`.

### 6.5 Failure & Circuit-Breaker Invariants
- Consecutive idle snapshot failures are counted per migration controller instance.
- At `MAX_SNAPSHOT_FAILURES` (3), controller force-terminates and marks session terminal (`stopped`, `snapshot_failed`, `outcome: failed`).
- Lock contention is a no-op (`runWithMigrationLock` returns `null`).

Evidence: `apps/gateway/src/hub/migration-controller.ts:38-47`, `104-112`, `246-261`, `268-311`, `packages/services/src/lib/lock.ts:80-98`.

### 6.6 Orphan Backstop Invariants
- Sweeper scans `status = running` sessions only.
- Runtime lease absence is required before considering a session orphaned.
- If local hub exists, sweeper defers to `hub.shouldIdleSnapshot()` + `hub.runIdleSnapshot()`.
- If no local hub, sweeper performs locked direct cleanup and writes `pauseReason: "orphaned"`.
- Direct orphan cleanup uses same provider capability order (memory -> pause -> filesystem).
- Direct orphan cleanup keeps `sandbox_id` when terminate fails, so future retries remain fenced.

Evidence: `apps/gateway/src/sweeper/orphan-sweeper.ts`, `packages/services/src/sessions/db.ts:587-594`.

---

## 7. Cross-Cutting Dependencies

| Dependency | Contract used by idle snapshotting | Owner spec |
|---|---|---|
| Sandbox providers | `supportsMemorySnapshot`, `supportsPause`, `memorySnapshot`, `pause`, `snapshot`, `terminate` | `sandbox-providers.md` |
| Session runtime lifecycle | `ensureRuntimeReady`, SSE bridge, migration-state interactions | `sessions-gateway.md` |
| Distributed lock | `runWithMigrationLock`, `waitForMigrationLockRelease` | `sessions-gateway.md` |
| Session leases | owner/runtime lease behavior for orphan detection and split-brain prevention | `sessions-gateway.md` |
| Billing gate during resume | `billing.checkBillingGateForOrg(..., "session_resume")` | `billing-metering.md` |
| Automation terminal path | `automation.complete` triggers direct terminate fast-path | `automations-runs.md` |

---

## 8. Things Agents Get Wrong

1. "No websocket clients means idle."
Correction: idle requires no websocket clients, no proxy connections, no active tool callbacks, no running tools, no assistant message, grace elapsed, and sandbox present (`apps/gateway/src/hub/session-hub.ts:570-587`).

2. "SSE disconnect always blocks idle snapshot."
Correction: known-idle fallback (`lastKnownAgentIdleAt`) allows idle snapshot after SSE loss if idle was previously observed (`apps/gateway/src/hub/session-hub.ts:577-579`, `1288-1291`).

3. "Modal idle path is memory-only today."
Correction: current implementation falls back from memory snapshot to pause/filesystem snapshot on failure (`apps/gateway/src/hub/migration-controller.ts:145-180`, `apps/gateway/src/sweeper/orphan-sweeper.ts:122-133`).

4. "Idle snapshot always evicts the hub."
Correction: normal timer-driven idle snapshot stops idle monitor but does not evict hub; explicit sweeper-triggered `hub.runIdleSnapshot()` calls `onEvict()` afterward (`apps/gateway/src/hub/session-hub.ts:170-172`, `825-828`).

5. "Heartbeat keeps a session alive even when no hub exists."
Correction: heartbeat returns 404 if no active hub and does not create one (`apps/gateway/src/api/proliferate/http/heartbeat.ts:23-27`).

6. "session.idle always clears assistant busy state."
Correction: `EventProcessor` may retain `currentAssistantMessageId` for text-only responses, but explicit `session.idle` / `session.status(idle)` now still marks known-idle (`lastKnownAgentIdleAt`) for snapshot eligibility (`apps/gateway/src/hub/session-hub.ts`).

7. "Generation guard in reconnect timer is enough to prevent resume races."
Correction: runtime also re-checks intent after lock wait and DB reload (`apps/gateway/src/hub/session-runtime.ts:296-300`).

8. "CAS mismatch is an error condition."
Correction: CAS mismatch is treated as benign stale-actor detection; local runtime state is still reset (`apps/gateway/src/hub/migration-controller.ts:214-220`).

9. "Orphan sweeper only inspects in-memory hubs."
Correction: it is DB-first (`listRunningSessionIds`) and lease-driven, then optionally delegates to local hub (`apps/gateway/src/sweeper/orphan-sweeper.ts:31-67`).

10. "Expiry worker recreates missing hubs to migrate sessions."
Correction: expiry worker skips jobs when hub is missing (`apps/gateway/src/expiry/expiry-queue.ts:98-104`).

11. "Resume clears pause metadata automatically."
Correction: current runtime update sets status to `running` but does not explicitly clear `pauseReason` (`apps/gateway/src/hub/session-runtime.ts:446-454`).

12. "Idle monitor keeps retrying after snapshot failures."
Correction: migration controller failure path invokes `onIdleSnapshotComplete` (stopping idle monitor) and resets runtime state; retries rely on later re-entry (reconnect/sweeper/new runtime) (`apps/gateway/src/hub/migration-controller.ts:246-256`, `apps/gateway/src/hub/session-hub.ts:170-172`).

---

## 9. Known Limitations & Concerns

1. Modal "memory-only" policy is not enforced in code.
`runIdleSnapshot()` and orphan cleanup both allow fallback to non-memory snapshot modes. If product policy is memory-only, migration and sweeper flows need a coordinated change (`apps/gateway/src/hub/migration-controller.ts`, `apps/gateway/src/sweeper/orphan-sweeper.ts`).

2. `pauseReason` is not explicitly cleared during resume.
Session status returns to `running`, but stale pause reason may persist in DB unless overwritten elsewhere (`apps/gateway/src/hub/session-runtime.ts:446-454`).

3. Text-only assistant completions rely on explicit idle signals for eligibility.
If upstream stops emitting `session.idle` / `session.status(idle)`, retained `currentAssistantMessageId` can still suppress idle eligibility (`apps/gateway/src/hub/session-hub.ts`, `apps/gateway/src/hub/event-processor.ts`).

4. Heartbeat route exists, but no direct web caller is evident in this repo.
Preview-only activity that bypasses gateway websocket/proxy channels may be under-observed without heartbeat adoption (`apps/gateway/src/api/proliferate/http/heartbeat.ts`; no `apps/web` heartbeat caller found).

5. Local idle snapshot success/failure does not evict hubs by default.
This preserves fast resume handoff but can accumulate paused hubs and ongoing lease renewal until explicit eviction/shutdown (`apps/gateway/src/hub/session-hub.ts:170-172`, `803-812`).
