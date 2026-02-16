# Idle-Based Snapshotting

Snapshot sandboxes when idle instead of running them until expiry. Applies to all session types (web, automation, Slack).

## Problem

- Modal sandboxes have a configurable lifetime (`SANDBOX_TIMEOUT_SECONDS`, default 3600s / 60 min, max 24h)
- Currently we keep them alive the entire time and migrate at the 55-min mark (snapshot → new sandbox)
- Paying for idle compute after the agent finishes and the user disconnects
- Automation sessions burn ~50 min of idle compute after the agent completes
- Complex migration dance every 55 minutes

## Proposal

When no clients are connected and the agent is idle, snapshot the sandbox and terminate it. Resume on demand when a client reconnects or a new prompt arrives.

## Design Constraints

1. **Don't evict hub immediately on idle snapshot** — keep the hub through the snapshot/resume handoff window; evict later via a safe TTL policy.
   - Without this: `getOrCreate()` deduplicates by session ID via a pending-promise map. If we evict too early, a reconnecting client may create a new hub while the old hub still has in-flight work (e.g. a prompt blocked on the migration lock). Two hubs for the same session means split state and duplicate SSE connections.
   - v1 policy: no immediate eviction. Post-v1: allow delayed eviction for paused, untouched hubs (e.g. >2h) to bound memory growth.

2. **`shouldIdleSnapshot()` re-check includes grace period** — the full idle predicate (including grace period) is re-evaluated inside the migration lock, not just "are there still 0 clients."
   - Without this: an HTTP request arrives between the 30s interval check and the lock acquisition. `touchActivity()` updates `lastActivityAt`, but if the re-check inside the lock only verifies `clients.size === 0` and skips the grace period, it won't see that `lastActivityAt` was just refreshed. The snapshot proceeds despite active HTTP traffic.

3. **`touchActivity()` before `ensureRuntimeReady()` in lifecycle middleware** — the activity timestamp must be set before blocking on the migration lock.
   - Without this: `ensureRuntimeReady()` calls `waitForMigrationLockRelease()`, which blocks while `runIdleSnapshot()` holds the lock. If `touchActivity()` comes after, it runs only after the snapshot completes — too late to abort. Calling it before means the `shouldIdleSnapshot()` re-check inside the lock sees the fresh `lastActivityAt` and aborts the snapshot.

4. **Only `touchActivity()` mutates `lastActivityAt`** — no artificial `lastActivityAt = Date.now()` inside the idle check when the agent is busy.
   - Without this: if `checkIdleSnapshot()` sets `lastActivityAt = Date.now()` every time it sees the agent is working, it conflates "I polled and the agent was busy" with "a human or system actually interacted with this session." The grace period restarts every 30s poll, meaning a long-running agent task (e.g. 20-minute build) would never allow the grace period to elapse after the agent finishes — the artificial resets push it out indefinitely.

5. **Memory restore failure = restartable, not terminal** — on `mem:` restore failure, clear `snapshotId` in DB so the next reconnect creates a fresh sandbox. Surface the error to the user.
   - Without this: if a 7-day-old memory snapshot has expired and `restoreFromMemorySnapshot()` throws, the session is stuck in a loop — every reconnect attempt retries the same dead `mem:` snapshot ID and fails again. Clearing `snapshotId` breaks the loop. We don't silently fall back to a fresh sandbox because conversation history lives inside OpenCode in the sandbox — a fresh sandbox has empty history, and the user should know their conversation was lost.

6. **Lock TTL must cover worst-case snapshot time** — lock TTL is 300s (5 min); `sandboxSnapshotWait` timeout is 120s.
   - Without this: if the lock TTL is shorter than the snapshot operation (e.g. 60s lock for a 120s snapshot), a Redis blip could prevent Redlock auto-extension, causing the lock to expire mid-snapshot. Another operation (e.g. a resume from `ensureRuntimeReady()`) acquires the now-free lock and starts creating a new sandbox while the snapshot is still in progress on the old one. 300s provides generous headroom over the 120s snapshot + terminate + DB update.

7. **Stop idle interval after snapshot, restart on resume** — call `clearInterval` after successful snapshot; re-start from `startMigrationMonitor()` on resume.
   - Without this: the 30s `setInterval` keeps firing on a hub that has no sandbox. Over time, as sessions accumulate on a gateway instance, hundreds of idle hubs each run a timer that checks conditions, finds no sandbox, and returns — wasting CPU. Worse, if `lastKnownAgentIdleAt` is accidentally left set, the timer could attempt repeated snapshot calls on an already-paused hub.

8. **`removeProxy()` must be idempotent** — the cleanup closure uses a `removed` flag and `Set.delete()` to avoid drift in proxy presence tracking.
   - Without this: if terminal/VS Code WS cleanup fires twice (e.g. error then close), integer counters can drift positive/negative and become permanently wrong. A `Set<string>` by connection ID makes add/remove idempotent and keeps `proxyConnections.size` trustworthy.

9. **Agent-idle boundary via state transition** — detect `wasBusy → nowIdle` (check `getCurrentAssistantMessageId()` before and after `eventProcessor.process()`) rather than matching specific SSE event types like `session.idle`.
   - Without this: matching event types requires knowing every event that signals completion — `session.idle`, `session.status(idle)`, assistant message end, etc. If OpenCode adds a new completion event type or changes the event name, the idle detection breaks silently. The state-transition approach is robust: it works regardless of which event caused the transition, because it checks the result (is the agent idle now?) rather than the trigger.

10. **SSE-drop safety with `lastKnownAgentIdleAt`** — if the SSE connection drops after the agent was known-idle, allow snapshot instead of requiring `runtime.isReady()`.
    - Without this: if the user closes the tab, the agent finishes, and then the SSE connection drops (e.g. network timeout, Modal reclaim), `runtime.isReady()` returns false. The idle check requires SSE to be connected (`isReady()`), so it never fires. The sandbox burns compute for its entire lifetime (up to 24h) with no clients and no agent work — the exact waste this feature is meant to prevent. `lastKnownAgentIdleAt` records when we last saw the agent go idle, allowing the snapshot to proceed even after SSE drops. Cleared on: prompt (new work invalidates the idle state), resume (fresh sandbox, agent state unknown), and successful snapshot (no longer needed).

11. **Expiry idle path → "paused"** — change the existing `createNewSandbox: false` branch in expiry migration from `status: "stopped"` + `markSessionStopped()` to `status: "paused"` + `pauseReason: "inactivity"`.
    - Without this: the expiry idle path and the new idle snapshot path produce different states for the same semantic event (session went idle, sandbox torn down). Expiry would produce `stopped` + `endedAt` (non-resumable), while idle snapshot produces `paused` (resumable). This inconsistency means a session that happens to hit the 55-min expiry before idle snapshot fires gets permanently stopped, while one that idle-snapshots at 5 min is resumable. Since there are no existing consumers of the `createNewSandbox: false` path, unifying to "paused" is safe.

12. **Cancel pending reconnect before idle snapshot** — clear the pending `scheduleReconnect()` timer and guard resume side effects with lock-scoped state revalidation.
    - Without this: automation sessions have `shouldReconnectWithoutClients() === true`. When SSE drops, `handleSseDisconnect()` calls `scheduleReconnect()`, which sets a `setTimeout` to call `ensureRuntimeReady()`. If idle snapshot fires during that delay window, it snapshots and terminates the sandbox. But the pending timer callback can still fire, call `ensureRuntimeReady()`, and restore the sandbox with 0 clients — reintroducing idle burn.
    - Important nuance: a generation counter check at timeout entry is not sufficient by itself if the callback already entered `ensureRuntimeReady()` and is blocked on the migration lock. Keep revalidation after lock wait and before resume side effects.

13. **`shouldIdleSnapshot()` checks `sandbox_id`** — include `Boolean(runtime.getContext().session.sandbox_id)` in the idle predicate.
    - Without this: after a successful idle snapshot, `resetSandboxState()` clears `sandbox_id` in memory, but `lastKnownAgentIdleAt` might not be cleared yet (or could be set by a late SSE event). The idle check passes all other conditions (0 clients, agent idle, grace elapsed, `lastKnownAgentIdleAt` set) and calls `runIdleSnapshot()` again on a hub that's already paused. While the lock and re-read inside `runIdleSnapshot()` would catch this, the `sandbox_id` check prevents the unnecessary lock acquisition entirely.

14. **Re-read context after lock acquisition** — `runIdleSnapshot()` re-reads `sandbox_id` from `runtime.getContext()` after acquiring the migration lock, not just before.
    - Without this: `runIdleSnapshot()` reads `sandbox_id` before trying to acquire the lock. While waiting for the lock (another operation may hold it), the context can change — e.g. `ensureRuntimeReady()` creates a new sandbox and updates the context. If we act on the stale pre-lock `sandbox_id`, we might try to snapshot a sandbox that no longer exists or has already been replaced.

15. **`MigrationController.start()/stop()` just toggle a flag** — they don't create or destroy timers. The idle timer (`setInterval`) lives in `SessionHub`.
    - Without this: if `MigrationController.stop()` (called from `runIdleSnapshot()` step 8) also stopped the idle timer, and `MigrationController.start()` also started it, the lifecycle coupling gets confusing — `runIdleSnapshot()` would be stopping its own timer mid-execution via `stop()`. Keeping the idle timer in `SessionHub` and managing it via `startIdleMonitor()`/`stopIdleMonitor()` (called from `onIdleSnapshotComplete`) keeps the control flow clear: the hub owns the timer, the migration controller owns the snapshot logic.

## Trigger

The idle snapshot triggers when **all conditions** are true:

1. **No WS clients connected** — `clients.size === 0`
2. **No proxy connections** — `proxyConnections.size === 0` (terminal/VS Code WS proxies)
3. **Agent is idle** — `eventProcessor.getCurrentAssistantMessageId() === null`
4. **SSE is ready OR agent was known-idle** — `runtime.isReady() || lastKnownAgentIdleAt !== null`
5. **Sandbox exists** — `sandbox_id` is non-null (prevents repeated calls on already-paused hubs)
6. **Grace period elapsed** — time since `lastActivityAt` exceeds the per-session-type grace

### Control Plane Ownership Model

`SessionHub` is the real-time decider (best live signals), not the sole durable source of truth.

- **Hub (in-memory):** WS/proxy presence, agent state transitions, grace timing hints.
- **DB + provider state (durable):** session status/snapshot/sandbox identifiers and final lifecycle state.
- **Redis lock/lease (distributed safety):** prevents split-brain mutations and concurrent migration/resume races.

Design intent: loss of in-memory hints should degrade to temporary cost inefficiency (false negatives for idleness), not correctness failures.

### Activity detection

`getCurrentAssistantMessageId()` is robust for detecting agent work:

- Returns non-null for the entire duration of a message, including long-running tool calls (e.g. `sleep 120`)
- `hasRunningTools()` prevents premature completion — tool state stays `"running"` until OpenCode reports it done
- Only clears when `session.idle` or `session.status(idle)` fires from OpenCode
- Conservative on SSE disconnect — stale non-null state prevents snapshot, never causes a false idle

### Per session type

| Session type | WS clients when active | Grace period | Idle snapshot trigger |
|---|---|---|---|
| **Web** | > 0 | `IDLE_SNAPSHOT_DELAY_SECONDS` (default 300s / 5 min) | User closes tab → clients = 0 → agent finishes → grace period → snapshot |
| **Automation** | Always 0 (HTTP only) | 30s (hardcoded) | Agent finishes (calls `automation.complete`) → grace period → snapshot |
| **Slack** | Always 0 (async receiver) | 30s (hardcoded) | Agent finishes → grace period → snapshot |

## Snapshot mechanism

### Modal — memory snapshots (via gRPC)

Modal supports memory snapshots that preserve the **entire sandbox state**: filesystem + RAM + all running processes. The high-level JS SDK only exposes `snapshotFilesystem()`, but the gRPC methods are available via the public `client.cpClient`:

```ts
// Create sandbox with snapshotting enabled
// (need to pass enableSnapshot: true at the proto level in SandboxCreateParams)

// Snapshot (memory + filesystem + processes)
const { snapshotId } = await client.cpClient.sandboxSnapshot({ sandboxId });
await client.cpClient.sandboxSnapshotWait({ snapshotId, timeout: 120 });

// Restore (exact clone — processes still running)
const { sandboxId } = await client.cpClient.sandboxRestore({ snapshotId });
```

`mem:` prefix distinguishes memory snapshot IDs from legacy filesystem image IDs. Only the Modal provider interprets this prefix.

**Why memory snapshots over filesystem snapshots:**

| | Memory snapshot | Filesystem snapshot |
|---|---|---|
| What's preserved | Files + RAM + running processes | Files only |
| Resume latency | Near-instant (no boot sequence) | ~10-20s (must restart OpenCode, services, Caddy, sandbox-mcp) |
| Dev servers after resume | Still running | Must re-run service commands |
| Redis/Postgres data | Preserved (in-memory state intact) | Postgres survives (on disk), Redis data lost |
| Snapshot expiry | 7 days | Indefinite |
| Maturity | Pre-beta (`_experimental` in Python SDK) | Stable, GA |

The 7-day expiry aligns with `auto_delete_days` (default 7). The pre-beta limitations don't affect our use case:
- **Can't snapshot during `exec`** — we only snapshot when the agent is idle (no exec running)
- **TCP connections closed** — fine; we disconnect SSE before snapshot, and server processes (Postgres, Caddy) re-bind their ports on restore
- **No GPU support** — we don't use GPUs
- **Snapshotting terminates the sandbox** — we want to terminate it anyway

**Memory-only policy:** for Modal idle snapshotting, do not fall back to filesystem snapshots. If memory snapshotting fails at snapshot-time, abort idle snapshot and keep the session running; retry on the next idle check until circuit breaker thresholds are hit.

If memory snapshot restore fails (e.g. expired after 7 days), the error is surfaced to the user and `snapshotId` is cleared in DB. The next reconnect creates a fresh sandbox from configuration with empty history (restartable, not terminal).

### E2B — native pause

E2B already supports full-state pause/resume via `betaPause()` / `Sandbox.connect()`. The existing idle migration path in migration-controller.ts already uses this (`if (provider.supportsPause)`). No changes needed for E2B — idle snapshotting just triggers the existing pause path sooner.

## Snapshot flow (gateway-side)

```
runIdleSnapshot():
  0. Early exit if migrationState !== "normal" or sandbox_id is null
  1. Acquire migration lock (runWithMigrationLock, 300s TTL)
  2. Re-read sandbox_id from context (may have changed while waiting for lock)
  3. Re-check ALL idle conditions via shouldIdleSnapshot() (includes grace period)
  4. Cancel pending reconnect timer (prevents automation reconnect race)
  5. Disconnect SSE (runtime.disconnectSse())
     — MUST be before terminate to prevent reconnect cycle
     — sseClient.disconnect() aborts the AbortController
     — readLoop sees abort → silent return, no onDisconnect callback
  6. Snapshot:
     — E2B: provider.pause() (native)
     — Modal: cpClient.sandboxSnapshot() → mem: prefixed ID (memory-only; no filesystem fallback)
  7. Terminate (non-pause providers only): provider.terminate()
     — Before terminate, verify the lock is still valid / operation still owned
       (defensive against lock expiry during long snapshot operations)
     — If terminate fails, keep `sandboxId` in DB for sweeper retry
  8. Update DB (CAS/fencing):
     — snapshotId, status: "paused", pausedAt: now(), pauseReason: "inactivity"
     — sandboxId handling:
       - pause-capable providers: keep live sandboxId
       - non-pause providers: set sandboxId null only if terminate succeeded
       - if terminate failed, keep sandboxId for sweeper retry
     — NOT markSessionStopped() — session is alive, no endedAt
     — MUST include `WHERE sandbox_id = freshSandboxId`; if 0 rows updated, abort
  9. Cancel BullMQ expiry job (cancelSessionExpiry)
 10. Reset sandbox state (runtime.resetSandboxState())
 11. Signal hub: stop idle timer, clear lastKnownAgentIdleAt
 12. Release migration lock
```

**Key difference from current expiry idle migration:** status is `"paused"` (not `"stopped"`), no `endedAt`, SSE is disconnected before terminate, and reconnect timer is cancelled.

## Resume flow (existing, no changes needed)

Resume is triggered when a client connects or a prompt arrives via HTTP:

```
Web client opens session → addClient() → initializeClient()
  → ensureRuntimeReady()
    → waitForMigrationLockRelease() (instant — lock already released)
    → loadSessionContext() — sees status: "paused", snapshot_id, sandbox_id: null
    → provider.ensureSandbox({ snapshotId })
      → For memory snapshots (mem: prefix): cpClient.sandboxRestore({ snapshotId }) → new sandboxId
    → DB update: sandboxId, status: "running", pauseReason: null
    → scheduleSessionExpiry() (new expiry for new sandbox)
    → SSE connects
    → broadcastStatus("running")
  → lastKnownAgentIdleAt = null (agent state unknown on fresh sandbox)
  → startMigrationMonitor() (restarts idle timer)

Automation prompt via HTTP → handlePrompt()
  → ensureRuntimeReady() (same flow as above)
  → prompt sent to OpenCode
```

**Prompt during snapshot:** if a prompt arrives while the snapshot is in progress, `handlePrompt()` proceeds (migration state is `"normal"`), calls `ensureRuntimeReady()`, which blocks on `waitForMigrationLockRelease()`. Lock releases after snapshot completes. `ensureRuntimeReady()` then creates a new sandbox from the snapshot. No prompt is dropped, no queueing mechanism needed.

---

## Implementation

### 1. Modal Provider — Memory Snapshot + Restore

**File:** `packages/shared/src/providers/modal-libmodal.ts`

#### 1a. `enableSnapshot: true` at creation

In the `createSandbox()` method, add to the `client.sandboxes.create()` options:

```ts
enableSnapshot: true,
```

> Verify JS SDK passes this through. If not, drop to `cpClient.sandboxCreate()` — treat this as a likely integration bump.

#### 1b. `SandboxOperation` union

**File:** `packages/shared/src/sandbox/errors.ts`

Add `"memorySnapshot"` and `"restoreFromMemorySnapshot"` to the union.

#### 1c. `memorySnapshot()` method

```ts
async memorySnapshot(sessionId: string, sandboxId: string): Promise<SnapshotResult> {
  await this.ensureModalAuth("memorySnapshot");
  const { snapshotId } = await this.client.cpClient.sandboxSnapshot({ sandboxId });
  await this.client.cpClient.sandboxSnapshotWait({ snapshotId, timeout: 120 });
  return { snapshotId: `mem:${snapshotId}` };
}
```

#### 1d. `restoreFromMemorySnapshot()` method

```ts
private async restoreFromMemorySnapshot(
  sessionId: string,
  memorySnapshotId: string,
  log: Logger,
): Promise<CreateSandboxResult> {
  await this.ensureModalAuth("restoreFromMemorySnapshot");
  const { sandboxId: newSandboxId } = await this.client.cpClient.sandboxRestore({
    snapshotId: memorySnapshotId,
    sandboxNameOverride: sessionId, // keeps sandbox discoverable via fromName()
    sandboxNameOverrideType: 2, // STRING (Modal gRPC enum)
  });
  const sandbox = await this.client.sandboxes.fromId(newSandboxId);
  const tunnels = await sandbox.tunnels(30000);
  return {
    sandboxId: newSandboxId,
    tunnelUrl: tunnels[SANDBOX_PORTS.opencode]?.url || "",
    previewUrl: tunnels[SANDBOX_PORTS.preview]?.url || "",
    sshHost: tunnels[SANDBOX_PORTS.ssh]?.unencryptedHost,
    sshPort: tunnels[SANDBOX_PORTS.ssh]?.unencryptedPort,
    expiresAt: Date.now() + SANDBOX_TIMEOUT_MS,
  };
}
```

No `setupSandbox()`, `setupEssentialDependencies()`, or `waitForOpenCodeReady()` — processes are already running.

#### 1e. Modify `ensureSandbox()`

After `findSandbox()` returns null, before `createSandbox()`:

```ts
if (opts.snapshotId?.startsWith("mem:")) {
  const memId = opts.snapshotId.slice(4);
  log.info({ memorySnapshotId: memId }, "Restoring from memory snapshot");
  try {
    const result = await this.restoreFromMemorySnapshot(opts.sessionId, memId, log);
    return { ...result, recovered: false };
  } catch (err) {
    log.error({ err, memorySnapshotId: memId }, "Memory restore failed — session unrecoverable");
    throw new SandboxProviderError({
      provider: "modal",
      operation: "restoreFromMemorySnapshot",
      message: `Memory snapshot restore failed: ${err instanceof Error ? err.message : String(err)}`,
      cause: err instanceof Error ? err : undefined,
    });
  }
}
```

No silent fallback — conversation history lives in OpenCode inside the sandbox. A fresh sandbox would lose it. The caller (`doEnsureRuntimeReady`) catches this, clears `snapshotId` in DB, and re-throws so the user sees an error. A subsequent reconnect will create a fresh sandbox with empty history (restartable, not terminal — see section 5c).

#### 1f. Capability flag

```ts
readonly supportsMemorySnapshot = true;
```

### 2. SandboxProvider Interface

**File:** `packages/shared/src/sandbox-provider.ts`

```ts
readonly supportsMemorySnapshot?: boolean;
memorySnapshot?(sessionId: string, sandboxId: string): Promise<SnapshotResult>;
```

### 3. Idle Detection in SessionHub

**File:** `apps/gateway/src/hub/session-hub.ts`

#### 3a. New fields

```ts
private proxyConnections = new Set<string>();
private lastActivityAt: number = Date.now();
private lastKnownAgentIdleAt: number | null = null;
private idleCheckTimer: NodeJS.Timeout | null = null;
private idleSnapshotInFlight = false;
```

#### 3b. Public methods

```ts
addProxyConnection(): () => void {
  const connectionId = randomUUID();
  this.proxyConnections.add(connectionId);
  this.touchActivity();
  let removed = false;
  return () => {
    if (removed) return; // idempotent
    removed = true;
    this.proxyConnections.delete(connectionId);
    this.touchActivity();
  };
}

touchActivity(): void {
  this.lastActivityAt = Date.now();
}
```

`removeProxy()` uses a closure flag + `Set.delete()` idempotency to prevent drift from early error paths and duplicate close/error events.

#### 3c. Wire `touchActivity()` into existing event handlers

- `addClient()` — `touchActivity()`
- `removeClient()` — `touchActivity()`
- `handlePrompt()` — `touchActivity()` + `this.lastKnownAgentIdleAt = null` (new work starting, invalidates previous idle state)

#### 3d. Agent-idle detection via state transition

In the SSE event handler (where `handleOpenCodeEvent()` calls `eventProcessor.process()`), detect the transition rather than matching event types:

```ts
const wasBusy = this.eventProcessor.getCurrentAssistantMessageId() !== null;
this.eventProcessor.process(event);
const nowIdle = this.eventProcessor.getCurrentAssistantMessageId() === null;

if (wasBusy && nowIdle) {
  this.touchActivity(); // marks agent-done boundary, starts grace period
  this.lastKnownAgentIdleAt = Date.now();
}
```

This catches all completion paths consistently (e.g. `session.idle`, `session.status(idle)`, message end).

#### 3e. Idle check (30s interval)

```ts
private getIdleGraceMs(): number {
  // Automation/Slack: no human tab-refreshing, use short grace (30s)
  const sessionType = this.runtime.getContext().session.client_type;
  if (sessionType === "automation" || sessionType === "slack") {
    return 30_000;
  }
  // Web: protect against tab refresh / blips
  return this.env.idleSnapshotGraceSeconds * 1000;
}

private checkIdleSnapshot(): void {
  if (this.idleSnapshotInFlight) return;
  if (this.clients.size > 0 || this.proxyConnections.size > 0) return;
  if (this.eventProcessor.getCurrentAssistantMessageId() !== null) return;

  // Allow snapshot if either:
  // (a) SSE is connected and runtime is ready, OR
  // (b) SSE dropped but agent was known-idle before the drop
  const sseReady = this.runtime.isReady();
  if (!sseReady && this.lastKnownAgentIdleAt === null) return;

  const graceMs = this.getIdleGraceMs();
  if (Date.now() - this.lastActivityAt < graceMs) return;

  this.idleSnapshotInFlight = true;
  this.migrationController.runIdleSnapshot()
    .catch((err) => this.logError("Idle snapshot failed", err))
    .finally(() => { this.idleSnapshotInFlight = false; });
}
```

#### 3f. Start/stop idle monitor

```ts
private startIdleMonitor(): void {
  if (this.idleCheckTimer) return;
  this.idleCheckTimer = setInterval(() => this.checkIdleSnapshot(), 30_000);
}

private stopIdleMonitor(): void {
  if (this.idleCheckTimer) {
    clearInterval(this.idleCheckTimer);
    this.idleCheckTimer = null;
  }
}
```

- `startIdleMonitor()` called from `startMigrationMonitor()` (which is called from `ensureRuntimeReady()`)
- `stopIdleMonitor()` called from `stopMigrationMonitor()` and from `onIdleSnapshotComplete()`

`startMigrationMonitor()` becomes:
```ts
private startMigrationMonitor(): void {
  this.migrationController.start();
  this.startIdleMonitor();
}
```

`stopMigrationMonitor()` becomes:
```ts
stopMigrationMonitor(): void {
  this.migrationController.stop();
  this.stopIdleMonitor();
}
```

#### 3g. Pass `shouldIdleSnapshot` to MigrationController

```ts
shouldIdleSnapshot: () => {
  const graceMs = this.getIdleGraceMs();
  const sseReady = this.runtime.isReady();
  const hasSandbox = Boolean(this.runtime.getContext().session.sandbox_id);
  return hasSandbox
    && this.clients.size === 0
    && this.proxyConnections.size === 0
    && this.eventProcessor.getCurrentAssistantMessageId() === null
    && (sseReady || this.lastKnownAgentIdleAt !== null)
    && Date.now() - this.lastActivityAt >= graceMs;
},
```

`hasSandbox` prevents repeated calls on already-paused hubs. Grace-period check ensures HTTP requests arriving between interval and lock acquisition can abort via `touchActivity()`.

#### 3h. Reset `lastKnownAgentIdleAt` centrally on resume

In `ensureRuntimeReady()` (covers WS + HTTP + proxy callers):

```ts
async ensureRuntimeReady(): Promise<void> {
  this.lifecycleStartTime = Date.now();
  await this.runtime.ensureRuntimeReady();
  this.lastKnownAgentIdleAt = null; // fresh sandbox, agent state unknown
  this.startMigrationMonitor();
}
```

#### 3i. Store reconnect timer, cancellation guards, and reconnect intent

The existing `scheduleReconnect()` uses a bare `setTimeout`. Store the timer ID and an optional generation guard so idle snapshot can cancel pending callbacks. Keep lock-scoped state revalidation as the primary safety mechanism.

```ts
private reconnectTimerId: NodeJS.Timeout | null = null;
private reconnectGeneration = 0;

private scheduleReconnect(): void {
  // ... existing delay logic ...
  const generation = this.reconnectGeneration;
  this.reconnectTimerId = setTimeout(() => {
    this.reconnectTimerId = null;

    // Bail if cancelled after timer fired but before we start work
    if (generation !== this.reconnectGeneration) {
      this.log("Reconnect cancelled by idle snapshot (generation mismatch)");
      return;
    }

    // Check again - clients may have disconnected during delay
    if (this.clients.size === 0 && !this.shouldReconnectWithoutClients()) {
      this.log("No clients connected, aborting reconnection");
      this.reconnectAttempt = 0;
      return;
    }

    this.ensureRuntimeReady({ reason: "auto_reconnect" })
      .then(() => { this.reconnectAttempt = 0; })
      .catch((err) => {
        this.logError("Reconnection failed, retrying...", err);
        this.scheduleReconnect();
      });
  }, delay);
}

cancelReconnect(): void {
  this.reconnectGeneration++; // invalidates any in-flight callback
  if (this.reconnectTimerId) {
    clearTimeout(this.reconnectTimerId);
    this.reconnectTimerId = null;
  }
  this.reconnectAttempt = 0;
}
```

Important: generation checks at timeout entry are a best-effort optimization only. If a callback has already entered `ensureRuntimeReady()` and is blocked on migration lock, correctness must come from post-lock state revalidation before resume side effects.

In `SessionRuntime.doEnsureRuntimeReady()` after lock wait + context reload:

```ts
if (
  options?.reason === "auto_reconnect" &&
  this.context.session.status === "paused"
) {
  this.log("Auto-reconnect aborted: session already paused by idle snapshot");
  return;
}
```

### 4. Wire Proxy Routes to Activity Tracking

#### 4a. Lifecycle middleware — HTTP proxy activity

**File:** `apps/gateway/src/middleware/lifecycle.ts`

Call `touchActivity()` **before** `ensureRuntimeReady()`:

```ts
const hub = await hubManager.getOrCreate(proliferateSessionId);
hub.touchActivity(); // BEFORE ensureRuntimeReady — must not block on migration lock
await hub.ensureRuntimeReady();
```

If `touchActivity()` is after `ensureRuntimeReady()`, the HTTP request blocks on the migration lock and can't abort a pending snapshot. Calling it before means the `shouldIdleSnapshot()` re-check inside the lock sees the updated `lastActivityAt` and aborts.

#### 4b. Terminal WS proxy

**File:** `apps/gateway/src/api/proxy/terminal.ts`

```ts
const hub = await hubManager.getOrCreate(sessionId);
hub.touchActivity();
await hub.ensureRuntimeReady();
const removeProxy = hub.addProxyConnection();

ws.on("close", () => {
  removeProxy(); // idempotent, safe to call multiple times
  // ... existing close logic
});
```

#### 4c. VS Code WS proxy

**File:** `apps/gateway/src/api/proxy/vscode.ts`

Same pattern as terminal.

### 5. `runIdleSnapshot()` in MigrationController

**File:** `apps/gateway/src/hub/migration-controller.ts`

#### 5a. New options

```ts
export interface MigrationControllerOptions {
  // ... existing ...
  env: GatewayEnv;
  shouldIdleSnapshot: () => boolean;
  cancelReconnect: () => void;
  onIdleSnapshotComplete: () => void;
}
```

#### 5b. `runIdleSnapshot()` method

```ts
async runIdleSnapshot(): Promise<void> {
  if (this.migrationState !== "normal") return;

  // Read sandbox_id before lock — early exit if already paused
  const sandboxId = this.options.runtime.getContext().session.sandbox_id;
  if (!sandboxId) return;

  const ran = await runWithMigrationLock(this.options.sessionId, 300_000, async () => {
    // Re-read context after lock (may have changed while waiting)
    const freshSandboxId = this.options.runtime.getContext().session.sandbox_id;
    if (!freshSandboxId) {
      this.logger.info("Idle snapshot aborted: sandbox already gone");
      return;
    }

    // Re-check ALL conditions inside lock, including grace period + sandbox_id
    if (!this.options.shouldIdleSnapshot()) {
      this.logger.info("Idle snapshot aborted: conditions no longer met");
      return;
    }

    const providerType = this.options.runtime.getContext().session.sandbox_provider as SandboxProviderType;
    const provider = getSandboxProvider(providerType);

    // 1. Cancel any pending reconnect timer (prevents automation reconnect
    //    from restoring the sandbox after we snapshot it)
    this.options.cancelReconnect();

    // 2. Disconnect SSE BEFORE terminate (prevents reconnect cycle)
    this.options.runtime.disconnectSse();

    // 3. Snapshot
    let snapshotId: string;
    if (provider.supportsPause) {
      const result = await provider.pause(this.options.sessionId, freshSandboxId);
      snapshotId = result.snapshotId;
    } else if (provider.supportsMemorySnapshot && provider.memorySnapshot) {
      const result = await provider.memorySnapshot(this.options.sessionId, freshSandboxId);
      snapshotId = result.snapshotId; // has "mem:" prefix
    } else {
      const result = await provider.snapshot(this.options.sessionId, freshSandboxId);
      snapshotId = result.snapshotId;
    }

    // 4. Terminate (not needed for pause-capable providers)
    // If terminate fails, keep sandboxId in DB for sweeper retry.
    let terminated = provider.supportsPause;
    if (!provider.supportsPause) {
      try {
        await provider.terminate(this.options.sessionId, freshSandboxId);
        terminated = true;
      } catch (err) {
        this.logger.error({ err }, "Failed to terminate after idle snapshot");
        terminated = false;
      }
    }

    // 5. DB update (CAS/fencing): only update if sandbox_id still matches freshSandboxId.
    // If 0 rows are affected, another actor already advanced the session state.
    await sessions.updateWhereSandboxIdMatches(this.options.sessionId, freshSandboxId, {
      snapshotId,
      sandboxId: provider.supportsPause ? freshSandboxId : (terminated ? null : freshSandboxId),
      status: "paused",
      pausedAt: new Date().toISOString(),
      pauseReason: "inactivity",
    });

    // 6. Cancel BullMQ expiry job
    await cancelSessionExpiry(this.options.env, this.options.sessionId);

    // 7. Reset sandbox state (clears sandbox_id in memory)
    this.options.runtime.resetSandboxState();

    // 8. Signal hub to stop idle timer and clear state
    this.options.onIdleSnapshotComplete();

    this.logger.info({ sandboxId: freshSandboxId, snapshotId }, "Idle snapshot complete");
  });

  if (ran === null) {
    this.logger.info("Idle snapshot skipped: lock already held");
  }
}
```

In `session-hub.ts`, the `onIdleSnapshotComplete` callback:

```ts
// MigrationController options:
onIdleSnapshotComplete: () => {
  this.stopIdleMonitor();
  this.lastKnownAgentIdleAt = null;
},
cancelReconnect: () => this.cancelReconnect(),
```

**Lock TTL: 300s** (5 min). Generously covers worst case: `sandboxSnapshotWait` timeout (120s) + terminate + DB update + network delays.

**Memory snapshot failure at snapshot time**: abort idle snapshot and keep the session running. Do not fall back to filesystem snapshots in this design.

**Circuit breaker requirement:** track consecutive snapshot failures (`snapshotFailures`) per session. If 3 idle cycles fail in a row, stop retrying indefinitely and transition to a terminal safe state (`stopped` + alert) to avoid infinite idle-billing loops on unsnapshotable sandboxes.

#### 5c. Memory restore failure — DB cleanup (restartable)

**File:** `apps/gateway/src/hub/session-runtime.ts`

In `doEnsureRuntimeReady()`, wrap the `ensureSandbox()` call to catch `mem:` restore failures and clear `snapshotId` before re-throwing:

```ts
try {
  const result = await provider.ensureSandbox({ ... });
  // ... existing success path
} catch (err) {
  // If this was a memory snapshot restore failure, clear snapshotId
  // so the next reconnect creates a fresh sandbox (restartable, not terminal)
  if (
    err instanceof SandboxProviderError
    && err.operation === "restoreFromMemorySnapshot"
  ) {
    this.log("Memory snapshot expired or unrecoverable, clearing snapshotId for fresh restart");
    await sessions.update(this.sessionId, {
      snapshotId: null,
    });
  }
  throw err; // re-throw so existing error handling runs (onStatus("error"), etc.)
}
```

**Restartable, not terminal.** Clearing `snapshotId` ensures the next reconnect attempt creates a fresh sandbox from configuration instead of retrying the dead `mem:` ID. The user sees an error on the current attempt; reconnecting creates a fresh sandbox with empty OpenCode history.

**UX note:** The existing `onStatus("error", message)` path sends the error to the client. The client should display something like "Session expired — your previous conversation has been reset" rather than a generic error. This is a UI-only change in the web app's error handling for the `"error"` status — defer to post-v1 if needed, but at minimum the error message from the `SandboxProviderError` will be visible.

### 6. Unify Expiry Idle Path

**File:** `apps/gateway/src/hub/migration-controller.ts`

Since there are no existing users to preserve, change the existing `createNewSandbox: false` branch to produce "paused" state instead of "stopped":

```ts
await sessions.update(this.options.sessionId, {
  snapshotId,
  sandboxId: provider.supportsPause ? sandboxId : null,
  status: "paused",
  pausedAt: new Date().toISOString(),
  pauseReason: "inactivity",
});

// Remove the markSessionStopped() call
// Keep the terminate call for non-pause providers
```

Also move `disconnectSse()` BEFORE `terminate()` in the existing path (currently it's after):

```ts
// Current order (wrong for preventing reconnect):
this.options.runtime.resetSandboxState();
this.options.runtime.disconnectSse();

// Fixed order:
this.options.runtime.disconnectSse();  // BEFORE terminate
// ... terminate ...
this.options.runtime.resetSandboxState();
```

This makes idle shutdown behavior consistent everywhere: both idle snapshot and expiry produce resumable "paused" sessions.

### 7. Export `cancelSessionExpiry()`

**File:** `apps/gateway/src/expiry/expiry-queue.ts`

```ts
export async function cancelSessionExpiry(env: GatewayEnv, sessionId: string): Promise<void> {
  const q = getQueue(env);
  const jobId = `${JOB_PREFIX}${sessionId}`;
  const existing = await q.getJob(jobId);
  if (existing) {
    await existing.remove();
  }
}
```

### 8. Environment Config

#### 8a. Schema

**File:** `packages/environment/src/schema.ts`

```ts
IDLE_SNAPSHOT_DELAY_SECONDS: optionalSeconds(300), // 5 minutes default
```

#### 8b. Gateway env

**File:** `apps/gateway/src/lib/env.ts`

```ts
idleSnapshotGraceSeconds: number;
```

In `loadGatewayEnv()`:

```ts
idleSnapshotGraceSeconds: env.IDLE_SNAPSHOT_DELAY_SECONDS,
```

`IDLE_SNAPSHOT_DELAY_SECONDS` sets the **web session** grace period (default 300s / 5 min). Automation and Slack sessions use a hardcoded 30s grace — see `getIdleGraceMs()` in section 3e.

### 9. DB + Data Layer — Wire `pauseReason`

#### 9a. `UpdateSessionInput`

**File:** `packages/services/src/types/sessions.ts`

```ts
pauseReason?: string | null;
```

#### 9b. DB update functions

**File:** `packages/services/src/sessions/db.ts`

In `update()` and `updateWithOrgCheck()`:

```ts
if (input.pauseReason !== undefined) updates.pauseReason = input.pauseReason;
```

#### 9c. Frontend contract

**File:** `packages/shared/src/contracts/sessions.ts`

```ts
pauseReason: z.string().nullable(),
```

#### 9d. Session mapper

**File:** `packages/services/src/sessions/mapper.ts`

In `toSession()` and `toSessionPartial()`:

```ts
pauseReason: row.pauseReason ?? null,
```

#### 9e. Clear on resume

**File:** `apps/gateway/src/hub/session-runtime.ts`

In `doEnsureRuntimeReady()` DB update, add `pauseReason: null`.

### 10. UI — Paused Session Indicators

#### 10a. `SessionItem` (sidebar)

**File:** `apps/web/src/components/dashboard/session-item.tsx`

Add `StatusDot` for paused/running sessions alongside the title.

#### 10b. `SessionRow` (command search)

**File:** `apps/web/src/components/dashboard/session-row.tsx`

Extend to show paused status dot.

#### 10c. `SessionCard` — no changes needed

Already renders yellow "Paused" badge.

### 11. Orphan Sweeper Backstop (Required)

Idle snapshoting is hub-driven and in-memory. If a gateway process dies, its timers die too. A backstop sweeper is required to prevent orphaned running sandboxes from burning compute until provider hard timeout.

Mandatory v1 behavior:

- Run every 10-15 minutes.
- Query DB for sessions still marked `running`.
- Check active gateway lease/heartbeat ownership.
- For sessions without active ownership and past idle threshold, force idle pause/terminate flow.
- Reuse the same lock path (`runWithMigrationLock`) to avoid conflicting with live gateways.

This sweeper is a safety net, not the primary idle controller.

### 11b. UI Heartbeat Requirement (Mandatory)

Preview and SSH traffic can bypass gateway connection counters. To avoid false-idle snapshots while users are active outside the main WS channel:

- Web app emits `POST /api/sessions/:id/heartbeat` every ~60s while session UI or preview is visible.
- Heartbeat handler calls `hub.touchActivity()`.
- Heartbeat refreshes idle grace only; it does not force runtime resume.

### 12. Snapshot Mode Decision (Locked)

v1 is locked to **memory-only** snapshots for Modal idle snapshotting.

- No filesystem fallback in the idle snapshot path.
- On memory snapshot failure at snapshot-time, abort idle snapshot and keep the session running.
- On memory restore failure, clear `snapshotId`, surface a user-visible reset error, and allow next reconnect to create a fresh sandbox.

---

## What's New vs. What Exists

| Component | Status |
|---|---|
| Memory snapshot + restore from snapshot | **New** (gRPC calls to Modal, new provider method) |
| `enableSnapshot: true` at sandbox creation | **New** (wire into create params) |
| `mem:` prefix for memory snapshot IDs | **New** (Modal provider only) |
| `ensureRuntimeReady()` from paused state | **Exists** |
| Idle detection timer + grace period | **New** (30s interval in SessionHub) |
| Activity tracking (`lastActivityAt`, `lastKnownAgentIdleAt`) | **New** (in-memory, reset on prompt/client/proxy events) |
| Proxy connection tracking | **New** (terminal/VS Code WS proxies) |
| Reconnect cancellation + reconnect intent guard | **New** (prevents automation reconnect race) |
| Cancel expiry job on idle snapshot | **New** (export `cancelSessionExpiry()`) |
| Expiry idle path → "paused" | **Changed** (was "stopped" + `markSessionStopped()`) |
| E2B pause on idle | **Exists** (idle migration path already uses `provider.pause()`) |

## Files Modified (Summary)

| File | Change |
|---|---|
| `packages/shared/src/sandbox/errors.ts` | Add `"memorySnapshot"`, `"restoreFromMemorySnapshot"` to `SandboxOperation` |
| `packages/shared/src/providers/modal-libmodal.ts` | `enableSnapshot`, `memorySnapshot()`, `restoreFromMemorySnapshot()`, `ensureSandbox()` mem: path |
| `packages/shared/src/sandbox-provider.ts` | `supportsMemorySnapshot`, `memorySnapshot()` |
| `apps/gateway/src/hub/session-hub.ts` | `proxyConnections`, `lastActivityAt`, `lastKnownAgentIdleAt`, `touchActivity()`, `addProxyConnection()`, idle timer, `shouldIdleSnapshot` (with grace + sandbox_id + SSE-drop check), agent-idle transition detection, `cancelReconnect()`, `reconnectTimerId` |
| `apps/gateway/src/hub/migration-controller.ts` | `runIdleSnapshot()` (300s lock TTL, re-reads context after lock, cancels reconnect), unify expiry idle path to "paused", fix `disconnectSse()` ordering |
| `apps/gateway/src/hub/session-runtime.ts` | Clear `pauseReason` on resume; catch `mem:` restore failure → clear snapshotId (restartable) |
| `apps/gateway/src/expiry/expiry-queue.ts` | Export `cancelSessionExpiry()` |
| `apps/gateway/src/middleware/lifecycle.ts` | `hub.touchActivity()` **before** `ensureRuntimeReady()` |
| `apps/gateway/src/api/proxy/terminal.ts` | `hub.addProxyConnection()` + idempotent cleanup |
| `apps/gateway/src/api/proxy/vscode.ts` | `hub.addProxyConnection()` + idempotent cleanup |
| `packages/environment/src/schema.ts` | `IDLE_SNAPSHOT_DELAY_SECONDS` |
| `apps/gateway/src/lib/env.ts` | `idleSnapshotGraceSeconds` |
| `packages/services/src/types/sessions.ts` | `pauseReason` in `UpdateSessionInput` |
| `packages/services/src/sessions/db.ts` | Wire `pauseReason` in update functions |
| `packages/shared/src/contracts/sessions.ts` | `pauseReason` in `SessionSchema` |
| `packages/services/src/sessions/mapper.ts` | Map `pauseReason` |
| `apps/web/src/components/dashboard/session-item.tsx` | StatusDot for paused/running |
| `apps/web/src/components/dashboard/session-row.tsx` | StatusDot for paused |

**No changes needed:** `sse-client.ts`, `event-processor.ts`, `hub/types.ts`.

## Edge Cases

- **Agent mid-message when last client disconnects** — idle timer checks `getCurrentAssistantMessageId()`. If non-null, timer reschedules. Only snapshots once agent is fully idle.
- **Prompt arrives during snapshot** — blocks on migration lock, then restores from the snapshot just taken. No data loss.
- **Tab refresh / network blip** — grace period (5 min for web) prevents snapshotting. Client reconnects, `ensureRuntimeReady()` finds sandbox still alive.
- **Rapid idle→resume cycles** — `touchActivity()` on resume gives the full grace period before next idle snapshot.
- **Preview URLs** — dead while sandbox is down. Resume restores them.
- **Automation finalizer compatibility** — if the agent called `automation.complete`, the run is already in a terminal state before idle snapshot. Finalizer ignores it. If the agent didn't complete, finalizer eventually fails the run after 30 min — same existing behavior.
- **Memory snapshot failure at snapshot time** — idle snapshot aborts; session remains running and is retried on next idle check.
- **Memory restore failure** — error surfaced to user, `snapshotId` cleared in DB. Next reconnect creates fresh sandbox from configuration (empty history).
- **SSE reconnect for automation sessions** — `shouldReconnectWithoutClients()` returns true for automations, but reconnect timer is cancelled before snapshot. If a callback already entered `ensureRuntimeReady()`, post-lock `auto_reconnect` intent checks must abort resume when session is now paused.
- **SSE drop + known idle** — if agent finishes → SSE drops (network) → user doesn't reconnect, snapshot still fires because `lastKnownAgentIdleAt` is set. Prevents burning compute for hours/24h.

## Verification

1. **TypeScript**: `pnpm typecheck`
2. **Lint**: `pnpm lint`
3. **Idle trigger**: Create session → close tab → wait grace period → check DB: `status = "paused"`, `pause_reason = "inactivity"`, `snapshot_id` starts with `mem:`, `sandbox_id = null`, no `ended_at`
4. **Resume**: Reopen paused session → sandbox restores from memory snapshot, processes running, conversation preserved. DB: `status = "running"`, `pause_reason = null`
5. **Hub reuse + delayed eviction safety**: After idle snapshot, hub remains available for resume handoff. If delayed eviction TTL is enabled, reconnect after eviction recreates a new hub cleanly from DB state.
6. **Proxy keepalive**: Open terminal while idle timer is ticking → verify snapshot does NOT fire
7. **HTTP activity aborts snapshot**: VS Code HTTP request arrives during lock acquisition wait → `touchActivity()` fires before `ensureRuntimeReady()` → re-check inside lock returns false → snapshot aborts
8. **removeProxy idempotent**: Call cleanup function twice → `proxyConnections.size` stays consistent and returns to baseline
9. **Memory snapshot failure (in runIdleSnapshot)**: Force memory snapshot failure → idle snapshot aborts, session remains running, no filesystem fallback path is taken
10. **Memory restore failure (in ensureSandbox)**: Use expired `mem:` ID → throws → DB `snapshotId` cleared → user sees error → subsequent reconnect creates fresh sandbox from configuration (empty history)
11. **SSE drop + known idle**: Agent finishes → SSE drops (network) → user doesn't reconnect → after grace period, snapshot still fires (because `lastKnownAgentIdleAt` is set)
12. **Expiry idle path**: Close tab → session has no clients → expiry fires at 55 min (if idle snapshot hasn't already fired) → DB shows `paused` (not `stopped`), no `endedAt`. Note: with clients connected, expiry takes `createNewSandbox: true` path (keeps running)
13. **Prompt during snapshot**: Send prompt while idle snapshot in progress → blocks on migration lock, restores from snapshot
14. **UI**: Paused sessions show status dot in sidebar and command search
15. **Gateway crash recovery**: Kill gateway mid-snapshot and verify lock expiry + orphan sweeper eventually converges to a correct paused/stopped state without split-brain side effects.
16. **Reconnect race**: Simulate SSE drop + scheduled reconnect + concurrent idle snapshot. Verify reconnect does not immediately undo a completed idle snapshot.
17. **Lock-expiry guard**: Simulate snapshot operations near lock TTL and verify destructive operations are skipped/aborted when lock ownership is uncertain.
18. **CAS/fencing race**: Expire lock mid-snapshot, let another actor resume with a new sandbox ID, then ensure stale idle-path DB update affects 0 rows and does not overwrite running state.
19. **Snapshot circuit breaker**: Force deterministic memory snapshot failures and verify max 3 retries before terminal safe-state transition + alert.
20. **Heartbeat blind-spot mitigation**: Keep preview active with no WS clients; periodic heartbeat prevents idle snapshot while active.

## Known Limitations

1. **Preview/SSH visibility depends on heartbeat reliability.** Modal `previewUrl` and SSH tunnels are direct-to-Modal URLs, not routed through Gateway. Heartbeat mitigates this blind spot, but false-idle snapshots remain possible if heartbeat delivery fails or tab-visibility heuristics are wrong.

2. **`touchActivity()` in lifecycle middleware applies broadly.** `createEnsureSessionReady()` is mounted for index.ts routes (info/message/cancel), devtools proxy, and VS Code proxy — not just "proxy routes." Any authenticated HTTP call to these endpoints resets the idle timer. This is intentional: any HTTP activity to the session indicates someone cares about it.

3. **Hub accumulation.** Not evicting immediately avoids races, but hub objects can accumulate in `hub-manager.ts`. Stopping `setInterval` after snapshot prevents CPU leaks, but memory growth can still become material on long-lived gateway instances.
   - Required mitigation: delayed eviction policy for paused, untouched hubs plus process-level memory monitoring.

4. **Expiry-path "paused" semantics.** Changing the `createNewSandbox: false` branch from `status: "stopped"` + `markSessionStopped()` to `status: "paused"` makes these sessions resumable. Any consumers interpreting `endedAt` / `status === "stopped"` as "session is over forever" should be checked — but since there are no existing users, this is a greenfield decision.
   - Cross-spec dependency: billing/metering must treat `status: "paused"` + `pauseReason: "inactivity"` as meter-stopping equivalent to legacy `stopped`.

5. **Mem-restore failure invariant.** After `restoreFromMemorySnapshot` failure, `session-runtime.ts` clears `snapshot_id` but keeps `status: "paused"`. This creates a transient state ("paused session with no snapshot") until the next reconnect creates a fresh sandbox and sets `status: "running"`. The web client should display "Session reset — previous conversation has been cleared" rather than a generic error.

## Open Questions

1. **`enableSnapshot` JS SDK support**: Verify `sandboxes.create()` accepts this. If not, drop to `cpClient.sandboxCreate()`.
2. **`SandboxRestoreRequest_SandboxNameOverrideType` enum**: Verify which value sets sandbox name to `sandboxNameOverride`. Critical for `findSandbox()` discoverability.

## Trade-offs

**Pros:**
- Sessions survive idle periods without paying for compute
- Automation sessions stop burning ~50 min of idle compute per run
- Near-instant resume with memory snapshots (processes preserved)
- Simpler than the 55-min migration dance for idle sessions
- Works across all session types

**Cons:**
- Memory snapshots are pre-beta — stability risk
- 7-day snapshot expiry — sessions can't resume after 7 days of inactivity (acceptable, matches `auto_delete_days`)
- Using low-level gRPC API — could break on Modal SDK updates (typed proto definitions provide some stability)
- Grace period tuning — too short = unnecessary snapshot/restore cycles on brief disconnects; too long = paying for idle compute
- Restore failure on expired memory snapshots can reset conversation state (must be explicit in UX)
