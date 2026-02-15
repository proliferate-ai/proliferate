# Gateway Hardening: Comprehensive Changeset

> Covers all changes needed to harden the monolithic gateway for multi-instance deployment.
> These changes are infrastructure-only — they do not alter the agent-facing CLI, the integrations architecture, or the provider system.

---

## 1. Summary of Changes

Six changes, ordered by implementation dependency (later items may depend on earlier ones).

| # | Change | What It Fixes | Touches |
|---|--------|---------------|---------|
| 1 | Hub eviction (idle TTL + hard cap) | Unbounded memory growth → eventual OOM | `HubManager`, `SessionHub` |
| 2 | Redis rate limiter | In-memory rate limit multiplies with instance count | Action invocation pipeline, Redis |
| 3 | Distributed ownership leases + runtime locks | Two instances can spin up hubs for the same session → split-brain | `HubManager`, `ensureRuntimeReady()`, Redis |
| 4 | Unified session creation | Two creation paths with different invariants → ghost state bugs | `SessionService` (new), oRPC handler, gateway HTTP route, sessions table |
| 5 | Migration hardening | Lock expiry mid-migration, no two-phase cutover, dropped messages during migration | `MigrationController`, `SessionHub`, Redis |
| 6 | Synchronous HTTP callbacks for gateway-mediated tools | SSE sniffing + 5x async retry → LLM hangs forever on failure | Gateway HTTP routes, `EventProcessor`, OpenCode tool config, new `session_tool_invocations` table |

---

## 2. Change 1: Hub Eviction

### Problem

`HubManager.remove()` exists but has no call sites. Hubs accumulate for the lifetime of the gateway process. Each hub retains WS client references, an SSE client, event processor state, migration controller state, pending promises, timers, and retry loops. Memory grows with total sessions ever touched (not concurrent sessions), eventually causing OOM or GC thrash → latency spikes → cascading reconnect storms.

### What Changes

**HubManager gains an eviction system with two mechanisms:**

**Idle TTL.** When the last WebSocket client disconnects from a hub, start a 5-minute idle timer. If no client reconnects within that window:

1. If the session is running: trigger a snapshot of the sandbox.
2. Update session status to `paused` in the database.
3. Disconnect the SSE client.
4. Cancel all timers (migration, expiry).
5. Call `HubManager.remove(sessionId)` to fully deallocate the hub.

If a client reconnects during the idle window, cancel the timer and resume normally.

**Hard cap.** The HubManager enforces a maximum number of concurrent hubs (configurable, default ~500). If a new hub is requested and the cap is reached:

1. Find the least-recently-active hub with zero connected WS clients.
2. Evict it (same sequence as idle TTL eviction: snapshot → pause → remove).
3. If no hub has zero clients (all at capacity with active users), reject the new connection with a 503 and log an alert.

**What `remove()` cleans up:**

- Disconnects and dereferences all WS client connections owned by the hub.
- Disconnects the SSE client to the sandbox.
- Cancels the event processor and any pending event processing.
- Cancels the migration controller and any in-flight migration state.
- Cancels all in-process timers (idle timer, expiry timer).
- Clears any pending promises (ensureRuntimeReady coalescing).
- Deletes the hub from the HubManager's internal map.
- Releases the session ownership lease in Redis (Change 3).

After `remove()`, the hub object and everything it references is fully garbage-collectible.

### Files to Change

- `HubManager` — add idle timer management, hard cap enforcement, LRU tracking, `remove()` call sites.
- `SessionHub` — add `onLastClientDisconnected()` hook, idle timer start/cancel, cleanup method.
- `SessionRuntime` — add `disconnect()` / `cleanup()` method for SSE client teardown.
- Gateway config — add `MAX_HUBS_PER_INSTANCE` and `HUB_IDLE_TTL_MS` environment variables.

### New State

- Per-hub: `lastActivityTimestamp`, `idleTimer` handle.
- HubManager: ordered map or LRU structure for eviction priority.

### Edge Cases

- Hub is mid-migration when idle timer fires → do not evict; wait for migration to complete, then re-evaluate.
- Hub has an active automation run with no WS clients → do not evict based on idle timer; automation runs keep the hub alive until completion or timeout.
- Snapshot fails during eviction → log error, mark session `failed`, remove hub anyway (don't leak memory because of a snapshot failure).

---

## 3. Change 2: Redis Rate Limiter

### Problem

Action invocations are rate-limited at 60 calls per minute per session. This is currently enforced in-memory on the gateway instance. With multiple instances behind a load balancer, the effective rate limit becomes `60 × instance_count` because each instance tracks independently.

### What Changes

Replace the in-memory counter with a Redis-based counter:

```
On each action invocation:
  key = "ratelimit:actions:{sessionId}"
  count = INCR(key)
  if count == 1:
    EXPIRE(key, 60)   // First call in window, set TTL
  if count > 60:
    return 429 Too Many Requests
```

This is a sliding window approximation (fixed window aligned to first request). It's good enough for abuse protection. If you need precise sliding windows later, switch to Redis sorted sets — but that's unnecessary at this stage.

### Files to Change

- Action invocation handler (wherever the current in-memory rate check lives) — replace with Redis `INCR` + `EXPIRE`.
- Add Redis client dependency to the action pipeline if it doesn't already have one.
- Remove the in-memory rate limiting data structure.

### Redis Keys

```
ratelimit:actions:{sessionId}    value: integer    TTL: 60s (set on first INCR)
```

### Edge Cases

- Redis unavailable → fail open (allow the request) or fail closed (deny) — decide based on your safety posture. Recommendation: fail open with a warning log. Rate limiting is abuse protection, not security-critical.

---

## 4. Change 3: Distributed Ownership Leases + Runtime Locks

### Problem

All per-session coordination is currently in-process. The pending-promise map in `ensureRuntimeReady()` deduplicates concurrent callers, but only within a single gateway instance. With multiple instances:

- Two instances can create hubs for the same session.
- Both can call `ensureRuntimeReady()` and attempt to provision sandboxes.
- Both can connect SSE to the sandbox.
- Broadcasts (status, tool events, approvals) become nondeterministic.
- Migration can be attempted by multiple instances simultaneously.

### What Changes

**Two Redis-based coordination primitives:**

**Session ownership lease (long-lived, hub lifetime).** When a gateway instance creates or adopts a hub for a session, it acquires an ownership lease:

```
SET owner:{sessionId} {instanceId} NX PX 30000
```

- `NX` = only set if not exists (claim fails if another instance owns it).
- `PX 30000` = 30-second TTL.
- The owning instance heartbeat-renews the lease every 10 seconds while the hub is alive.
- Only the lease holder is permitted to: connect SSE, run `ensureRuntimeReady()`, execute gateway-mediated tools, process action invocations, trigger migration.

If a request arrives at an instance that does not hold the lease:

- If the lease exists (another instance owns it) → reject the request. For WebSocket connections, send a close frame with a "wrong_instance" reason. The client reconnects and the load balancer (sticky sessions) should route correctly. For HTTP requests (action invocations from sandbox CLI), return a 409 or redirect hint.
- If the lease is expired (owner crashed) → claim the lease, create a new hub, recover from DB + snapshot.

**Runtime boot lock (short-lived, boot sequence only).** Before `ensureRuntimeReady()` provisions a sandbox:

```
SET runtime:{sessionId} {instanceId} NX PX 30000
```

- Heartbeat-renewed during the boot sequence (every 10 seconds).
- Released (DEL) when the runtime is ready and SSE is connected.
- Prevents concurrent provisioning if multiple connections trigger `ensureRuntimeReady()` across instances simultaneously.

The runtime lock is separate from the ownership lease because ownership is long-lived (hub lifetime) and the runtime lock is short-lived (boot sequence only). An instance can hold ownership without actively booting (e.g., session is running, no boot needed).

### Interaction Between the Two Locks

```
Client connects to Gateway instance A:
  1. A tries to acquire ownership lease: SET owner:{sid} A NX PX 30000
  2. If acquired:
     a. Create hub
     b. Acquire runtime lock: SET runtime:{sid} A NX PX 30000
     c. Run ensureRuntimeReady()
     d. Release runtime lock: DEL runtime:{sid}
     e. Begin heartbeating ownership lease every 10s
  3. If NOT acquired (another instance B owns it):
     a. Do NOT create hub
     b. Reject client connection with "wrong_instance" close reason
     c. Client reconnects; sticky routing should land on B
```

### Instance ID

Each gateway instance needs a stable-for-process-lifetime, unique-across-cluster identifier. Options:

- UUID generated at process start (simplest).
- Hostname + PID (human-readable but may collide across deploys).
- K8s pod name (if always running in K8s).

Recommendation: UUID generated at process start, stored as a module-level constant.

### Files to Change

- `HubManager` — check/acquire ownership lease before creating a hub. Reject if owned by another instance.
- `SessionHub` — start ownership lease heartbeat on creation, stop on `remove()`.
- `ensureRuntimeReady()` — acquire/release runtime lock around the boot sequence.
- Gateway WebSocket handler — check ownership before accepting connection. Send close frame if wrong instance.
- Gateway HTTP action handler — check ownership before processing action invocations from sandbox CLI.
- New module: `session-leases.ts` (or similar) — encapsulates Redis lease operations (acquire, renew, release, check).

### Redis Keys

```
owner:{sessionId}      value: {instanceId}    TTL: 30s (renewed every 10s)
runtime:{sessionId}    value: {instanceId}    TTL: 30s (renewed every 10s during boot, DEL on completion)
```

### Edge Cases

- Gateway crash → ownership lease expires after 30s. Next connection to any instance claims it.
- Network partition between gateway and Redis → heartbeat fails, lease expires, another instance may claim. When partition heals, the original instance discovers it lost ownership and should tear down its hub (check lease before any operation).
- Ownership lease renewal fails (Redis blip) → the instance should retry immediately. If 3 consecutive renewals fail, proactively release the hub (snapshot → pause → remove) rather than risk split-brain.
- `ensureRuntimeReady()` takes longer than 30s → runtime lock heartbeat renewal keeps it alive. If the boot truly stalls (provider timeout), the runtime lock eventually expires and another instance can attempt boot.

### L7 Sticky Sessions (Deployment, Not Code)

Configure the load balancer to use consistent hashing on the `sessionId` extracted from the URL path (`/proliferate/:sessionId`). This ensures all requests for a session normally hit the same instance. The ownership lease is the correctness backstop — sticky sessions are a performance optimization that reduces lease contention and cross-instance redirects.

This is a deployment/infrastructure change, not a code change. Document the required load balancer configuration.

---

## 5. Change 4: Unified Session Creation

### Problem

Sessions can be created via two paths with different invariants:

- **oRPC path** (web app): Billing check, agent config, prebuild lookup, snapshot resolution, DB write. No idempotency. No session connections. No integration token validation.
- **Gateway HTTP path** (`POST /sessions`): Full pipeline with Redis-based idempotency, integration token resolution, session connections, SSH options, optional immediate sandbox creation.

A session created via oRPC can end up missing session connections (no actions available), can be created twice if the request is retried, and may have different prebuild/snapshot resolution than one created via the gateway.

### What Changes

**Extract a single `SessionService.create()` function** that both entry points call. This function is the canonical session creation logic:

```typescript
// packages/services/src/sessions/session-service.ts

interface CreateSessionOptions {
  organizationId: string;
  userId: string;
  idempotencyKey?: string;
  provisioning: "deferred" | "immediate";
  clientType: "browser" | "cli" | "automation";

  // Agent configuration
  agentConfig: AgentConfig;
  systemPromptId?: string;
  modelId?: string;

  // Codebase
  repoId?: string;
  prebuildId?: string;
  snapshotId?: string;

  // Integrations
  integrationIds?: string[];    // Which integrations to connect

  // Environment
  envVars?: Record<string, string>;
  serviceCommands?: ServiceCommand[];

  // SSH/CLI-specific
  sshOptions?: SshOptions;
}

interface CreateSessionResult {
  session: Session;
  alreadyExisted: boolean;     // True if idempotency key matched existing session
}

async function createSession(opts: CreateSessionOptions): Promise<CreateSessionResult> {
  // 1. Billing check
  // 2. Resolve prebuild/snapshot
  // 3. Resolve agent config + system prompt
  // 4. DB-level idempotency check (see below)
  // 5. Insert session record
  // 6. Create session_connections for each integration
  // 7. Validate integration tokens (getToken() for each)
  // 8. If provisioning === "immediate": create sandbox now
  // 9. Return session
}
```

**Move idempotency from Redis to the database.** Add an `idempotency_key` column to the sessions table with a unique index:

```sql
ALTER TABLE sessions ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX idx_sessions_idempotency
  ON sessions (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

Session creation uses `INSERT ... ON CONFLICT (organization_id, idempotency_key) DO NOTHING RETURNING ...`. If the row already exists, fetch and return it. This is safe across gateway restarts, Redis failover, and multi-instance deployments.

Redis can still be used as a fast-path cache to avoid hitting the DB on rapid retries, but the DB unique index is the source of truth.

**Both entry points call `SessionService.create()`:**

- oRPC handler: calls `createSession({ provisioning: "deferred", ... })`. Returns the session record. Sandbox provisioning waits for first WebSocket connection.
- Gateway HTTP route (`POST /proliferate/sessions`): calls `createSession({ provisioning: opts.immediate ? "immediate" : "deferred", ... })`. If immediate, the sandbox is created in the same request.
- Automation worker: calls `createSession({ provisioning: "immediate", clientType: "automation", ... })`.

### Files to Change

- **New file:** `packages/services/src/sessions/session-service.ts` — the canonical `createSession()` function.
- **oRPC handler** (`sessions-create.ts` or equivalent) — replace inline creation logic with `SessionService.create({ provisioning: "deferred" })`.
- **Gateway HTTP route** (`session-creator.ts`) — replace inline creation logic with `SessionService.create()`. Keep the HTTP-specific concerns (request parsing, response formatting) in the route handler.
- **Sessions table** — add `idempotency_key` column + unique index.
- **Migration file** — for the schema change.
- **Remove:** Redis-based idempotency logic in the gateway path (replace with DB unique index).

### What Moves Into `SessionService.create()`

Everything that establishes session invariants:

- Billing check (does the org have credits/subscription?).
- Prebuild/snapshot resolution (which codebase, which starting state?).
- Agent config resolution (model, system prompt, capabilities).
- Session record insertion (with idempotency key).
- Session connections creation (which integrations are available).
- Integration token validation (call `getToken()` for each connected integration to verify credentials are live).
- Environment variable resolution.

### What Stays in the Caller

- HTTP-specific concerns (request parsing, response formatting, auth middleware).
- The decision of `provisioning: "deferred" | "immediate"`.
- WebSocket-specific concerns (the oRPC handler doesn't touch WebSockets).

### Edge Cases

- Idempotency key collision across orgs → the unique index is scoped to `(organization_id, idempotency_key)`, so different orgs can use the same key.
- No idempotency key provided → `WHERE idempotency_key IS NOT NULL` on the index means rows without a key don't participate in uniqueness checks. This preserves backward compatibility for callers that don't provide a key.
- Integration token validation fails → the session is still created (with a warning), but the failing integration is excluded from `session_connections`. The agent guide will show fewer available actions. This is graceful degradation, not a hard failure.

---

## 6. Change 5: Migration Hardening

### Problem

The current migration controller has several failure modes:

1. **60s Redis lock with no heartbeat.** Snapshot + sandbox boot can exceed 60s. Lock expires mid-migration → another instance/worker starts a second migration → split-brain.
2. **No two-phase cutover.** The old SSE is disconnected before the new sandbox is confirmed running. If the new sandbox fails to boot, the session is stuck with no sandbox.
3. **No message queuing during migration.** If a user types during migration, the prompt is either dropped or errors.
4. **BullMQ timing drift.** If the expiry job fires late (queue backlog), the snapshot window is missed.
5. **No quiescence check.** Snapshotting while background processes are writing to disk can corrupt workspace state.

### What Changes

**5a. Heartbeat-renewed migration lock.**

Replace the static 60s TTL with a heartbeat-renewed lease:

```
Acquire: SET migration:{sessionId} {instanceId} NX PX 60000
Renew:   Every 15 seconds while migration is in progress:
           GET migration:{sessionId}
           If value === {instanceId}: PEXPIRE migration:{sessionId} 60000
           If value !== {instanceId}: ABORT migration (lost lock)
Release: DEL migration:{sessionId}
```

The 60s TTL is now a safety net (in case the gateway crashes mid-migration), not the operational timeout. Under normal operation, the heartbeat keeps the lock alive for as long as the migration takes.

**5b. Explicit MIGRATING state on the hub.**

Add `MIGRATING` to the hub's state machine:

```
RUNNING → MIGRATING → RUNNING (new sandbox)
                    → PAUSED  (if no clients at end of migration)
                    → FAILED  (if unrecoverable)
```

While in `MIGRATING` state:

- Incoming WS messages (prompts, cancels, git operations) are queued in a bounded in-memory buffer (max 100 messages). They are NOT dropped or errored.
- The client receives a `status: "migrating"` broadcast so the UI can show a migration indicator.
- After migration completes and SSE is reconnected to the new sandbox, queued messages are flushed to the new sandbox in order.
- If the buffer fills up, reject new messages with a clear error ("migration in progress, please wait").

**5c. Two-phase cutover.**

The critical change: do NOT disconnect the old SSE or tear down the old sandbox until the new sandbox is confirmed running and SSE-connectable.

```
Migration sequence:
  1. Acquire migration lock (with heartbeat).
  2. Set hub state → MIGRATING. Broadcast status: "migrating" to clients.
  3. Wait for agent to finish current message (30s timeout).
     If timeout: send cancel signal to OpenCode.
  4. Quiesce: exec `lsof +D /home/user/workspace/ 2>/dev/null | grep -c '[0-9]'`
     in the sandbox. If active file handles > 0, wait up to 10s with polling.
     If still active after 10s, proceed anyway (best-effort quiescence).
  5. Snapshot the OLD sandbox.
     - If snapshot succeeds: continue.
     - If snapshot fails: retry up to 3 times with exponential backoff (2s, 4s, 8s).
     - If all retries fail: fall back to last known good snapshot (most recent
       snapshot_id on the session record). If no prior snapshot exists, set hub
       state → FAILED, broadcast error to clients, release lock, return.
  6. Create NEW sandbox from the snapshot.
     - Wait for the new sandbox to be fully running (provider.ensureSandbox()).
     - Wait for SSE to be connectable (attempt SSE connection to new sandbox).
  7. If new sandbox boot fails:
     - The OLD sandbox is still alive and SSE-connected. Resume on old sandbox.
     - Set hub state → RUNNING. Broadcast status: "running".
     - Log alert: "Migration failed, resumed on old sandbox. Sandbox expires at {T}."
     - Schedule a retry migration in 2 minutes (if time permits before expiry).
     - Release lock. Return.
  8. Cutover:
     - Switch SSE connection to the new sandbox.
     - Update DB: new sandbox_id, new tunnel URLs, new expiry time.
     - Tear down old sandbox (provider.destroySandbox()).
  9. Flush queued WS messages to the new sandbox.
  10. Set hub state → RUNNING. Broadcast status: "running".
  11. Schedule new expiry timer (in-process + BullMQ backup).
  12. Release migration lock.
```

**5d. Dual expiry trigger (in-process timer + BullMQ backup).**

The primary expiry trigger is an in-process timer on the `SessionHub`, set to fire at T-minus-5-minutes before sandbox expiry. This is high-precision and not subject to BullMQ queue latency.

The BullMQ scheduled job serves as a backup for hubs that have been evicted from memory (idle eviction). When the BullMQ job fires:

- Check if a hub exists for this session in this instance. If yes, defer to the in-process timer (it's already handling it).
- If no hub exists (session was idle-evicted): check if the sandbox is still running (DB lookup). If yes, trigger migration or pause as appropriate.

**5e. Idle migration (no clients connected) is simpler.**

If migration fires and no WS clients are connected:

1. Snapshot the sandbox.
2. Update DB: status → `paused`, store snapshot_id.
3. Tear down sandbox.
4. Evict hub (`HubManager.remove()`).

No two-phase cutover needed because there's no user to keep alive.

### Files to Change

- `MigrationController` — rewrite the migration sequence per 5c. Add lock heartbeating. Add two-phase cutover logic. Add quiescence check.
- `SessionHub` — add `MIGRATING` state. Add message queue buffer. Add `flushQueuedMessages()` method. Add in-process expiry timer alongside BullMQ job.
- Gateway WebSocket handler — when hub state is `MIGRATING`, queue messages instead of processing them.
- BullMQ expiry job handler — add "check if hub exists, defer if so" logic.

### Redis Keys

```
migration:{sessionId}    value: {instanceId}    TTL: 60s (renewed every 15s during migration)
```

### Edge Cases

- Migration lock heartbeat fails (Redis blip) → retry immediately. If 3 consecutive renewals fail, abort migration, resume on old sandbox, log alert.
- User disconnects during migration → migration continues (the sandbox still needs to move). When migration completes, if no clients are connected, evict the hub (idle eviction takes over).
- Old sandbox expires during migration (e.g., migration took too long) → the snapshot was already taken (step 5). The new sandbox boot (step 6) uses the snapshot. If the old sandbox dies before step 8, that's fine — we weren't going to use it anymore anyway. The cutover (step 8) skips the "tear down old sandbox" step since it's already dead.
- Multiple migration attempts for the same session → the migration lock prevents concurrent attempts. If a migration fails and schedules a retry (step 7), the retry acquires the lock normally.

---

## 7. Change 6: Synchronous HTTP Callbacks for Gateway-Mediated Tools

### Problem

Gateway-mediated tools (save_snapshot, verify, automation.complete, etc.) currently work by:

1. Gateway sniffs the SSE stream from the sandbox.
2. `EventProcessor` detects a tool name in the `interceptedTools` set.
3. Gateway executes the tool server-side.
4. Gateway patches the result back to OpenCode via `updateToolResult()` with up to 5 retries (1s delay each).

This is fragile:

- **SSE sniffing is an anti-pattern.** Parsing an outbound observability stream to trigger stateful backend operations couples the gateway to SSE event structure.
- **5x retry is not durable.** If the sandbox restarts, the gateway restarts, or OpenCode's state machine isn't ready, all 5 retries fail and the LLM hangs forever waiting for a tool result.
- **No idempotency.** SSE reconnect can replay events, causing double-execution of snapshots or automation completions.
- **Security model gap.** A compromised sandbox can forge tool-call-shaped SSE events to trigger server-side operations.

### What Changes

**Replace SSE interception with synchronous HTTP callbacks from the sandbox to the gateway.**

OpenCode is configured to execute gateway-mediated tools by making a blocking HTTP POST to the gateway, rather than the gateway intercepting the tool call from the SSE stream.

**New gateway endpoint:**

```
POST /internal/tools/:toolName
Authorization: Bearer {sandbox-hmac-token}
Content-Type: application/json

{
  "session_id": "uuid",
  "tool_call_id": "unique-id-from-opencode",
  "params": { ... }
}

Response (success):
200 OK
{
  "result": { ... }
}

Response (error):
500 Internal Server Error
{
  "error": "snapshot_failed",
  "message": "..."
}
```

**Flow:**

1. LLM invokes a gateway-mediated tool (e.g., `save_snapshot`).
2. OpenCode recognizes this tool as a "remote tool" and makes a blocking HTTP POST to the gateway endpoint.
3. The gateway authenticates the request via the sandbox HMAC token.
4. The gateway checks `tool_call_id` against the `session_tool_invocations` table:
   - If already executed → return cached result (idempotency).
   - If not → insert row with `status: "executing"`, execute the handler.
5. Gateway executes the tool server-side (snapshot, verify, automation.complete, etc.).
6. Gateway updates the row: `status: "completed"`, stores the result.
7. Gateway returns the result as the HTTP response body.
8. Gateway broadcasts `tool_start` / `tool_end` to WebSocket clients (for UI visibility).
9. OpenCode receives the HTTP response and feeds the result to the LLM.

The HTTP connection stays open for the duration of the tool execution. This provides natural backpressure — if the tool takes 10 seconds (e.g., a large snapshot), the connection holds for 10 seconds and OpenCode waits.

**New database table:**

```sql
CREATE TABLE session_tool_invocations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  tool_call_id    TEXT NOT NULL,
  tool_name       TEXT NOT NULL,
  params          JSONB,
  status          TEXT NOT NULL DEFAULT 'executing',   -- 'executing' | 'completed' | 'failed'
  result          JSONB,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  CONSTRAINT uq_tool_call_id UNIQUE (tool_call_id)
);

CREATE INDEX idx_tool_invocations_session ON session_tool_invocations (session_id);
```

**Quotas (abuse protection):**

To prevent a compromised sandbox from spamming gateway-mediated tools:

- `save_snapshot`: max 10 per session per hour.
- `verify`: max 20 per session per hour.
- `automation.complete`: max 1 per session (it's a terminal action).
- `save_env_files`, `save_service_commands`: max 10 per session per hour.

Quotas are enforced by counting rows in `session_tool_invocations` for the session within the time window. This is a simple `SELECT COUNT(*)` — no Redis needed since this is not a hot path.

**What gets removed:**

- The `interceptedTools` set on the `EventProcessor`.
- The `handleInterceptedTool()` method on `SessionHub`.
- The SSE event detection logic that watches for tool names.
- The `updateToolResult()` retry loop.
- Any OpenCode-side configuration that registers these tools as "intercepted at gateway."

**What gets added:**

- New Express route: `POST /internal/tools/:toolName`.
- Authentication middleware for sandbox HMAC tokens on this route.
- Tool handler registry mapping tool names to handler functions (same handlers that exist today, just invoked differently).
- `session_tool_invocations` table + Drizzle schema.
- OpenCode configuration to call the gateway HTTP endpoint for these tools instead of using local tool execution + gateway interception.

### Dependency on OpenCode

This change requires OpenCode to support "remote tools" — tools that are executed by making an HTTP request to an external endpoint rather than running locally. If OpenCode doesn't support this today, the options are:

**Option A (preferred):** Add remote tool support to OpenCode. The tool definition includes a URL, and OpenCode makes a blocking HTTP POST to that URL when the tool is invoked. This is a general-purpose capability that's useful beyond just Proliferate.

**Option B (interim):** Use a local tool script inside the sandbox that wraps the HTTP call. The tool is registered as a local bash tool in OpenCode, and the script (`/usr/local/bin/proliferate-tool`) makes the HTTP POST and returns the result to stdout. This is essentially the same pattern as the `proliferate` CLI but for system tools.

```bash
#!/bin/bash
# /usr/local/bin/proliferate-tool
RESULT=$(curl -s -X POST \
  -H "Authorization: Bearer $SANDBOX_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"session_id\": \"$SESSION_ID\", \"tool_call_id\": \"$1\", \"params\": $2}" \
  "$GATEWAY_URL/internal/tools/$TOOL_NAME")
echo "$RESULT"
```

Option B works today with no OpenCode changes. Option A is cleaner long-term.

### Files to Change

- **New file:** Gateway route handler for `POST /internal/tools/:toolName`.
- **New file:** Tool handler registry (map of tool name → handler function).
- **New file:** Drizzle schema for `session_tool_invocations`.
- **Migration file:** Create `session_tool_invocations` table.
- **EventProcessor** — remove `interceptedTools` set and interception logic.
- **SessionHub** — remove `handleInterceptedTool()` method.
- **OpenCode configuration / sandbox setup** — register gateway-mediated tools as remote tools (or local wrapper scripts).
- **Sandbox provisioning** — ensure the gateway URL and sandbox token are available inside the sandbox for the HTTP callbacks.

### Interaction with Other Changes

- **Ownership lease (Change 3):** The gateway must verify it holds the ownership lease for the session before executing a tool. If the request arrives at the wrong instance (shouldn't happen with sticky sessions, but safety check), reject with 409.
- **Migration (Change 5):** If a tool call arrives while the hub is in `MIGRATING` state, queue it (same as WS messages) and process after migration completes. The HTTP connection stays open, providing backpressure.
- **Hub eviction (Change 1):** A tool call arriving for an evicted session should trigger hub recreation (same as a WS connection). The tool call effectively "wakes up" the session.

---

## 8. Streaming Backpressure (Bonus — Not in Original 6, But Should Be)

### Problem

Token streaming is the hot path. If a client is slow (mobile in background, bad connection), `ws.send()` buffers grow silently. Memory spikes during high-token outputs. One slow client can degrade the gateway process for all sessions on that instance.

### What Changes

**Per-socket buffer monitoring.** After each `ws.send()`, check `ws.bufferedAmount`:

- If `bufferedAmount` > 256KB: stop sending token-level events to this client. Continue sending coarse checkpoint events (status changes, tool lifecycle, periodic text snapshots every ~500ms).
- If `bufferedAmount` > 1MB for more than 10 seconds: disconnect the client with close reason `slow_consumer`. The client can reconnect and catch up from the last checkpoint.

**Token batching.** Instead of sending each token as an individual WebSocket frame:

- Buffer tokens for 50-100ms.
- Send accumulated tokens as a single frame.
- This reduces per-message overhead (framing, syscalls) and is imperceptible to users (50ms is below the threshold of perceived streaming delay).

### Files to Change

- WebSocket client management — add `bufferedAmount` monitoring after sends.
- Token streaming path in `EventProcessor` — add batching buffer with flush timer.
- WebSocket close handler — add `slow_consumer` reason code.

---

## 9. Implementation Sequence

These changes have dependencies between them. The recommended order:

```
Week 1:
  Change 2: Redis rate limiter (trivial, standalone, immediate value)
  Change 1: Hub eviction (highest ROI, no dependencies)

Week 2:
  Change 3: Ownership leases + runtime locks (enables multi-instance)
  Backpressure: Token batching + slow consumer handling

Week 3:
  Change 4: Unified session creation (depends on Change 3 for idempotency)
  Change 5: Migration hardening (depends on Change 3 for lock heartbeating)

Week 4:
  Change 6: Synchronous HTTP callbacks (largest change, depends on OpenCode support)
  Integration testing across all changes with multi-instance deployment
```

Change 6 is the only one with an external dependency (OpenCode remote tool support or wrapper script). If that dependency is blocked, use the wrapper script (Option B) as an interim solution and follow up with Option A later.

After week 4, deploy with L7 sticky sessions on 3-5 instances. This should provide months of runway before the split architecture is needed.

---

## 10. Testing Strategy

### Unit Tests

- HubManager eviction: idle timer fires → snapshot → pause → remove. Hard cap enforcement. LRU ordering.
- Redis rate limiter: counter increments, TTL sets on first call, 429 after limit.
- Ownership lease: acquire, renew, release, claim after expiry, reject when held by another.
- Session creation idempotency: duplicate key returns existing session, no key skips check.
- Migration state machine: RUNNING → MIGRATING → RUNNING, message queuing and flushing.
- Tool invocation idempotency: duplicate tool_call_id returns cached result.

### Integration Tests

- Two gateway instances, same session: verify only one holds ownership. Kill the owner, verify the other claims it.
- Migration end-to-end: trigger migration, verify snapshot, verify new sandbox boots, verify client receives events throughout.
- Tool callback: sandbox calls gateway endpoint, gateway executes tool, result returned synchronously.
- Rate limiter across instances: verify combined rate stays at 60/min.

### Load Tests

- Hub eviction under load: create 600 sessions (above hard cap), verify eviction keeps memory bounded.
- Token streaming with slow clients: connect a client that reads slowly, verify gateway doesn't OOM.
- Concurrent session creation with same idempotency key: verify exactly one session created.

---

## 11. Rollback Plan

Each change can be rolled back independently:

- **Hub eviction:** Revert to never calling `remove()`. Memory leak returns but nothing breaks.
- **Redis rate limiter:** Fall back to in-memory. Rate limit multiplies with instances but doesn't break.
- **Ownership leases:** Remove lease checks. Sticky sessions still provide de facto single-owner behavior. Split-brain risk returns but is unlikely with sticky routing.
- **Unified session creation:** Revert oRPC handler to inline logic. Two paths return but nothing breaks immediately.
- **Migration hardening:** Revert to simple migration flow. Failure modes return but migration is infrequent.
- **Synchronous HTTP callbacks:** Revert to SSE interception + retry. More fragile but functional.

None of these changes are irreversible. The database migration (new table, new column) is additive and doesn't require data migration for rollback.