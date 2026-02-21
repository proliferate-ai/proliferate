# Sessions & Gateway — System Spec

## 1. Scope & Purpose

### In Scope
- Session lifecycle orchestration: create, eager-start, pause, snapshot, stop, status, delete, rename.
- Gateway runtime orchestration: hub ownership, sandbox lifecycle, OpenCode session lifecycle, SSE streaming, reconnect.
- Distributed safety primitives: owner/runtime leases, migration locks, CAS/fencing writes, orphan sweep recovery.
- Real-time protocol surface: WebSocket session protocol, HTTP prompt/cancel/info/status/tool routes.
- Gateway-intercepted tool execution over synchronous sandbox callbacks.
- Expiry/idle behavior: BullMQ expiry jobs, idle snapshotting, automation fast-path termination.
- Session telemetry capture and flush pipeline (`metrics`, `pr_urls`, `latest_task`).
- Devtools and OpenCode proxying via gateway (`/proxy/*`) including sandbox-mcp auth token injection.
- Gateway client library contracts (`packages/gateway-clients`) used by web and workers.
- Session-focused web surfaces backed by the above contracts (session list, peek drawer, inbox session context).

### Out of Scope
- Sandbox provider internals (Modal/E2B implementation details, image contents, provider deployment) — see `sandbox-providers.md`.
- Tool schemas/prompt contract and capability policy — see `agent-contract.md`.
- Automation run DAG, scheduling, and notification fanout — see `automations-runs.md`.
- Repo/configuration CRUD and prebuild policy — see `repos-prebuilds.md`.
- OAuth connection lifecycle and Nango sync — see `integrations.md`.
- Billing policy design and pricing semantics — see `billing-metering.md`.

### Mental Models
- **Control plane vs stream plane:** Next.js/oRPC/API routes create and mutate metadata; live model streaming is only Client ↔ Gateway ↔ Sandbox.
- **Session record vs hub vs runtime:** DB session row is durable metadata; `SessionHub` is per-process coordination state; `SessionRuntime` owns sandbox/OpenCode/SSE readiness.
- **Creation vs activation:** Creating a session record does not guarantee a sandbox exists. Runtime activation happens when a hub ensures readiness (or eager-start runs).
- **Ownership vs liveness:** Owner lease answers "which gateway instance may act"; runtime lease answers "is there a live runtime heartbeat".
- **Idle is a predicate, not just "no sockets":** idle snapshot requires no WS clients, no proxy clients, no active HTTP tool callbacks, no running tools, no active assistant turn, and grace-period satisfaction.
- **Migration/snapshot writes are fenced:** DB transitions that depend on a specific sandbox use CAS (`updateWhereSandboxIdMatches`) so stale actors cannot clobber newer state.
- **Recovery is multi-path:** runtime reconnect and expiry are job-driven; orphan cleanup is DB-first + runtime-lease-based and works even when no hub exists in memory.
- **Automation sessions are logically active even when headless:** automation client type is treated as having an effective client so expiry migration/reconnect behavior remains active.

### Things Agents Get Wrong
- Assuming API routes are in the token streaming path. They are not.
- Assuming one creation path. There are two materially different pipelines: gateway HTTP creation and web oRPC creation.
- Assuming session creation always provisions sandboxes. Deferred mode and oRPC create both return before provisioning.
- Assuming `userId` from client payload is trusted. The hub derives identity from authenticated connection/auth context.
- Assuming owner lease is optional or post-runtime. Lease acquisition gates runtime lifecycle work.
- Assuming runtime lease implies ownership. It is a liveness heartbeat, not ownership authority.
- Assuming expiry migration is triggered by an in-process timer. Current code relies on BullMQ delayed jobs plus local lifecycle decisions.
- Assuming hub eviction/hard-cap LRU exists centrally. Current `HubManager` is a registry + lifecycle hooks; eviction is explicit via hub callbacks.
- Assuming tool callback idempotency is global. It is in-memory per gateway process.
- Assuming SSE carries bidirectional traffic. SSE is read-only (sandbox → gateway); prompts/cancel are HTTP.
- Assuming preview/devtools proxies can skip session readiness checks. Most proxy routes require runtime readiness to resolve targets.
- Assuming markdown summaries are safe to render raw. UI must use sanitized markdown renderer.

---

## 2. Core Concepts

### Hub Manager
`HubManager` is an in-process registry keyed by session ID.

- `getOrCreate(sessionId)` deduplicates concurrent constructors via a pending promise map.
- Hub creation always starts by loading fresh DB-backed session context.
- `remove(sessionId)` is lifecycle cleanup entrypoint for in-memory hub references.
- `releaseAllLeases()` performs best-effort telemetry flush and stops hub monitors during shutdown.

References: `apps/gateway/src/hub/hub-manager.ts`, `apps/gateway/src/server.ts`

### Session Ownership + Runtime Leases
Redis leases coordinate multi-instance safety.

- Owner lease key: `lease:owner:{sessionId}` (30s TTL). Required for runtime lifecycle authority.
- Runtime lease key: `lease:runtime:{sessionId}` (20s TTL). Used for liveness/orphan detection.
- Owner renewals use Lua check-and-extend to avoid race conditions.
- Lease cleanup is owner-aware; hubs that never owned must not clear shared runtime lease state.

References: `apps/gateway/src/lib/session-leases.ts`, `apps/gateway/src/hub/session-hub.ts`

### Split-Brain Lag Guard
Lease renewal is event-loop-sensitive.

- If renewal lag exceeds owner lease TTL, hub self-terminates to avoid split-brain execution.
- Self-termination drops clients, stops migration/idle monitors, disconnects SSE, and evicts hub.

Reference: `apps/gateway/src/hub/session-hub.ts`

### Runtime Boundary
`SessionRuntime` owns the actual runtime state machine.

- Single-flight `ensureRuntimeReady()` coalesces concurrent callers.
- Context is reloaded from DB on readiness attempts.
- Runtime waits migration lock release (unless skip flag during controlled migration re-init).
- Runtime always goes through provider abstraction (`ensureSandbox`) instead of direct create calls.

Reference: `apps/gateway/src/hub/session-runtime.ts`

### Session Creation Paths
There are two intentional creation paths.

- Gateway HTTP (`POST /proliferate/sessions`): configuration resolution, optional immediate sandbox, integration/session connections, Redis idempotency envelope.
- Web oRPC (`sessions.create`): lightweight DB-centric path (including scratch sessions) that may trigger eager-start asynchronously.

References: `apps/gateway/src/api/proliferate/http/sessions.ts`, `apps/gateway/src/lib/session-creator.ts`, `apps/web/src/server/routers/sessions-create.ts`

### SSE Bridge
SSE is transport-only and unidirectional.

- Gateway connects to sandbox `GET /event` and parses events with `eventsource-parser`.
- Hub owns reconnect strategy and policy; `SseClient` does not reconnect on its own.
- Heartbeat/read timeout failures map to disconnect reasons that drive hub reconnect logic.

References: `apps/gateway/src/hub/sse-client.ts`, `apps/gateway/src/hub/session-hub.ts`

### Migration + Idle + Orphan Recovery
Migration and cleanup are lock/fencing-driven.

- Expiry jobs are scheduled with BullMQ using `expiresAt - GRACE_MS` delay.
- Migration and idle snapshot flows are protected by distributed migration lock.
- Idle/orphan writes fence against stale sandbox IDs via CAS update methods.
- Orphan sweeper is DB-first and runtime-lease-based, so recovery works post-restart with empty hub map.

References: `apps/gateway/src/expiry/expiry-queue.ts`, `apps/gateway/src/hub/migration-controller.ts`, `apps/gateway/src/sweeper/orphan-sweeper.ts`

### Gateway-Intercepted Tool Callbacks
Intercepted tools execute through HTTP callbacks, not SSE interception.

- Route: `POST /proliferate/:sessionId/tools/:toolName`.
- Auth source must be sandbox HMAC token.
- Idempotency is per-process (`inflightCalls` + `completedResults` cache with retention).

References: `apps/gateway/src/api/proliferate/http/tools.ts`, `apps/gateway/src/hub/capabilities/tools/`

---

## 5. Conventions & Patterns

### Do
- Obtain hubs via `hubManager.getOrCreate()` only.
- Treat `SessionHub.ensureRuntimeReady()` as the lifecycle gate for runtime availability.
- Use `createSyncClient()` for programmatic gateway access.
- Use `GIT_READONLY_ENV` for read-only git operations to avoid index lock contention.

### Don't
- Do not route real-time tokens through Next.js API routes.
- Do not trust caller-supplied `userId` in WS/HTTP prompt payloads when auth already establishes identity.
- Do not call provider sandbox creation primitives directly from hub lifecycle code; use runtime/provider orchestration entrypoints.
- Do not mutate session state on snapshot/migration paths without lock + CAS safeguards.

### Error Handling
- Route-level operational failures should throw `ApiError` for explicit status and details.
- Billing gate failures map to 402 via `BillingGateError` handling.
- Unknown/unexpected exceptions are logged and returned as 500.

Reference: `apps/gateway/src/middleware/error-handler.ts`

### Reliability
- **SSE read timeout**: Configurable via `env.sseReadTimeoutMs`. Stream read uses `readWithTimeout()` to detect stuck connections.
- **Heartbeat monitoring**: `SseClient` checks for event activity every ~`heartbeatTimeoutMs / 3`. Exceeding the timeout triggers reconnection.
- **Reconnection**: Exponential backoff via `env.reconnectDelaysMs` array. Stops if all clients disconnect (unless automation session).
- **Ownership lease**: A hub must hold a Redis ownership lease (`lease:owner:{sessionId}`) to act as the session owner; renewed by heartbeat (~10s interval) while the hub is alive. Lease loss triggers split-brain suicide (see §2).
- **Runtime lease**: Sandbox-alive signal (`lease:runtime:{sessionId}`) with 20s TTL, set after successful runtime boot and used for orphan detection.
- **Hub eviction**: Hubs are evicted on idle TTL (no connected WS clients) and under a hard cap (LRU) to bound memory usage. `HubManager.remove()` is called via `onEvict` callback.
- **Session create idempotency**: DB-based via `sessions.idempotency_key` column. Redis-based idempotency (`idempotency.ts`) still exists as a legacy path.
- **Initial prompt reliability**: `maybeSendInitialPrompt()` uses an in-memory `initialPromptSending` guard to prevent concurrent sends (eager start + runtime init), marks `initial_prompt_sent_at` before dispatch to avoid duplicates, and rolls that DB marker back on send failure so a later runtime init can retry. The in-memory guard is always reset in a `finally` block.
- **Tool call idempotency**: In-memory `inflightCalls` + `completedResults` maps per process, keyed by `tool_call_id`, with 5-minute retention for completed results.
- **Tool result patching**: `updateToolResult()` retries up to 5x with 1s delay (see `agent-contract.md` §5).
- **Migration lock**: Distributed Redis lock with 60s TTL prevents concurrent migrations for the same session.
- **Expiry triggers**: Hub schedules an in-process expiry timer (primary) plus a BullMQ job as a fallback for evicted hubs.
- **Snapshot secret scrubbing**: All snapshot capture paths (`save_snapshot`, idle snapshot, expiry migration) run `proliferate env scrub` before capture when env-file spec is configured. Paths that continue running the same sandbox re-apply env files after capture; pause/stop paths skip re-apply.
- **Streaming backpressure**: Token batching (50-100ms) and slow-consumer disconnect based on `ws.bufferedAmount` thresholds.
- **Idle snapshot failure circuit-breaker**: Force-terminates after repeated failures to prevent runaway spend.

### Testing Conventions
- Colocate gateway tests near source.
- Mock sandbox providers and lease/tool dependencies for deterministic lifecycle tests.
- Validate lease ordering and prompt idempotency behaviors explicitly (existing test patterns).

References: `apps/gateway/src/hub/session-hub.test.ts`, `apps/gateway/src/api/proliferate/ws/ws-handler.test.ts`, `apps/gateway/src/hub/session-telemetry.test.ts`

---

## 6. Subsystem Deep Dives

### 6.1 Session Creation — `Implemented`

**What it does:** Creates a session record and optionally provisions a sandbox.

**Gateway HTTP path** (`POST /proliferate/sessions`):
1. Auth middleware validates JWT/CLI token (`apps/gateway/src/middleware/auth.ts:createRequireAuth`).
2. Route validates required configuration option (`apps/gateway/src/api/proliferate/http/sessions.ts`).
3. `resolveConfiguration()` resolves or creates a configuration record (`apps/gateway/src/lib/configuration-resolver.ts`).
4. `createSession()` writes DB record, creates session connections, and optionally creates sandbox (`apps/gateway/src/lib/session-creator.ts`).
5. For new managed configurations, fires a setup session with auto-generated prompt.

**Scratch sessions** (no configuration):
- `configurationId` is optional in `CreateSessionInputSchema`. When omitted, the oRPC path creates a **scratch session** with `configurationId: null`, `snapshotId: null`.
- `sessionType: "setup"` is rejected at schema level (via `superRefine`) when configuration is absent — setup sessions always require a configuration.
- Gateway `loadSessionContext()` handles `configuration_id = null` with an early-return path: `repos: []`, synthetic scratch `primaryRepo`, `getScratchSystemPrompt()`, `snapshotHasDeps: false`.

**oRPC path** (`apps/web/src/server/routers/sessions.ts`):
- `create` → calls `createSessionHandler()` (`sessions-create.ts`) which writes a DB record only. This is a **separate, lighter pipeline** than the gateway HTTP route — no session connections, no sandbox provisioning.
- Setup-session entry points in web (`dashboard/configurations`, `snapshot-selector`, `configuration-group`) pass `initialPrompt: getSetupInitialPrompt()`. `createSessionHandler()` persists this and calls gateway `eagerStart()` so setup work begins automatically before the user types.
- Setup-session UI is explicit and persistent: `SetupSessionChrome` renders a checklist describing the two required user actions (iterate with the agent until verification, and configure secrets in Environment), and setup right-panel empty state reinforces the same flow.
- When the agent calls `request_env_variables`, the web runtime opens the Environment panel and the tool UI also renders an `Open Environment Panel` CTA card so users can reopen it from the conversation. In setup sessions, Environment is **file-based only**: users create secret files with a row-based env editor (`Key`/`Value` columns), can import via `.env` paste/upload, and save by target path. In multi-repo configurations, users must pick a repository/workspace first; the entered file path is interpreted relative to that workspace.
- The Git panel is workspace-aware in multi-repo sessions: users choose the target repository/workspace, and git status + branch/commit/push/PR actions are scoped to that `workspacePath`.
- `pause` → loads session, calls `provider.snapshot()` + `provider.terminate()`, finalizes billing, updates DB status to `"paused"` (`sessions-pause.ts`).
- `resume` → no dedicated handler. Resume is implicit: connecting a WebSocket client to a paused session triggers `ensureRuntimeReady()`, which creates a new sandbox from the stored snapshot.
- `delete` → calls `sessions.deleteSession()`.
- `rename` → calls `sessions.renameSession()`.
- `snapshot` → calls `snapshotSessionHandler()` (`sessions-snapshot.ts`).
- `submitEnv` → writes secrets to DB, writes env file to sandbox via provider.

**Idempotency:**
- The `sessions` table has an `idempotency_key` TEXT column. When provided, callers can detect duplicate creation attempts.
- Redis-based idempotency (`apps/gateway/src/lib/idempotency.ts`) also exists as a legacy deduplication path for the gateway HTTP route.

**Files touched:** `apps/gateway/src/api/proliferate/http/sessions.ts`, `apps/gateway/src/lib/session-creator.ts`, `apps/web/src/server/routers/sessions.ts`, `apps/web/src/components/coding-session/setup-session-chrome.tsx`, `apps/web/src/components/coding-session/right-panel.tsx`, `apps/web/src/components/coding-session/environment-panel.tsx`, `apps/web/src/components/coding-session/runtime/message-handlers.ts`

### 6.2 Session Runtime Lifecycle — `Implemented`

**What it does:** Lazily provisions sandbox, OpenCode session, and SSE bridge on first client connect.

**SessionHub pre-step** (`apps/gateway/src/hub/session-hub.ts:ensureRuntimeReady`):
1. Start lease renewal: acquire owner lease (`lease:owner:{sessionId}`) — fail fast if another instance owns this session.
2. Begin heartbeat timer (~10s interval) with split-brain lag guard.
3. Then call `runtime.ensureRuntimeReady()`.
4. On success: set runtime lease, start migration monitor, reset agent idle state.
5. On failure: stop lease renewal to release ownership.

**Happy path** (`apps/gateway/src/hub/session-runtime.ts:doEnsureRuntimeReady`):
1. Wait for migration lock release (`lib/lock.ts:waitForMigrationLockRelease`).
2. Reload `SessionContext` from database (`lib/session-store.ts:loadSessionContext`).
3. Resolve provider, git identity, base snapshot, sandbox-mcp token.
4. Call `provider.ensureSandbox()` — recovers existing or creates new sandbox.
5. Update session DB record with `sandboxId`, `status: "running"`, tunnel URLs.
6. Schedule expiry job via BullMQ (`expiry/expiry-queue.ts:scheduleSessionExpiry`).
7. Ensure OpenCode session exists (verify stored ID or create new one).
8. Connect SSE to `{tunnelUrl}/event`.
9. Broadcast `status: "running"` to all WebSocket clients.

**Edge cases:**
- Concurrent `ensureRuntimeReady()` calls coalesce into a single promise (`ensureReadyPromise`) within an instance.
- OpenCode session creation uses bounded retry with exponential backoff for transient transport failures (fetch/socket and retryable 5xx/429), with per-attempt latency logs.
- E2B auto-pause: if provider supports auto-pause, `sandboxId` is stored as `snapshotId` for implicit recovery.
- Stored tunnel URLs are used as fallback if provider returns empty values on recovery.
- If lease renewal lag exceeds TTL during runtime work, self-terminate immediately to prevent split-brain ownership (see §2 Lease Heartbeat Lag Guard).

**Files touched:** `apps/gateway/src/hub/session-runtime.ts`, `apps/gateway/src/lib/session-store.ts`

### 6.3 Event Processing Pipeline — `Implemented`

**What it does:** Translates OpenCode SSE events into client-facing `ServerMessage` payloads.

**Event types handled** (`apps/gateway/src/hub/event-processor.ts:process`):

| SSE Event | Client Message(s) | Notes |
|-----------|-------------------|-------|
| `message.updated` (assistant) | `message` (new) | Creates assistant message stub |
| `message.part.updated` (text) | `token`, `text_part_complete` | Streaming tokens |
| `message.part.updated` (tool) | `tool_start`, `tool_metadata`, `tool_end` | Tool lifecycle |
| `session.idle` / `session.status` (idle) | `message_complete` | Marks assistant done |
| `session.error` | `error` | Skips `MessageAbortedError` |
| `server.connected`, `server.heartbeat` | (ignored) | Transport-level |

**Tool events:**
- The SSE tool lifecycle events (`tool_start` / `tool_metadata` / `tool_end`) are forwarded to clients as UI observability.
- Gateway-mediated tools are executed via synchronous sandbox callbacks (`POST /proliferate/:sessionId/tools/:toolName`) rather than SSE interception. Idempotency is provided by in-memory `inflightCalls` + `completedResults` maps, keyed by `tool_call_id`. Invocations are also persisted in `session_tool_invocations`.
- See `agent-contract.md` for the tool callback contract and tool schemas.

**Files touched:** `apps/gateway/src/hub/event-processor.ts`, `apps/gateway/src/hub/session-hub.ts`

### 6.3a Session Telemetry — `Implemented`

**What it does:** Passively captures session metrics (tool calls, messages, active time), PR URLs, and latest agent task during gateway event processing, then periodically flushes to the DB.

**Architecture:**

Each `SessionHub` owns a `SessionTelemetry` instance (pure in-memory counter class). The EventProcessor fires optional callbacks on key events; the hub wires these to telemetry recording methods.

| Event | Callback | Telemetry method |
|-------|----------|-----------------|
| First tool event per `toolCallId` | `onToolStart` | `recordToolCall(id)` — deduplicates via `Set` |
| Assistant message idle | `onMessageComplete` | `recordMessageComplete()` — increments delta counter |
| User prompt sent | (direct call in `handlePrompt`) | `recordUserPrompt()` — increments delta counter |
| Text part complete | `onTextPartComplete` | `extractPrUrls(text)` → `recordPrUrl(url)` for each |
| Tool metadata with title | `onToolMetadata` | `updateLatestTask(title)` — dirty-tracked |
| Git PR creation | (direct call in `handleGitAction`) | `recordPrUrl(result.prUrl)` |

**Active time tracking:** `startRunning()` records a timestamp; `stopRunning()` accumulates elapsed seconds into a delta counter. Both are idempotent — repeated `startRunning()` calls don't reset the timer.

**Flush lifecycle (single-flight mutex):**

1. `getFlushPayload()` snapshots current deltas (tool call IDs, message count, active seconds including in-flight time, new PR URLs, dirty latestTask). Returns `null` if nothing is dirty.
2. `flushFn()` calls `sessions.flushTelemetry()` — SQL-level atomic increment for metrics, JSONB append with dedup for PR URLs.
3. `markFlushed(payload)` subtracts only the captured snapshot from deltas (differential approach), preserving any data added during the async flush.

If a second `flush()` is called while one is in progress, it queues exactly one rerun — no data loss, no double-counting.

**Flush points** (all wrapped in `try/catch`, best-effort):

| Trigger | Location | Notes |
|---------|----------|-------|
| Idle snapshot | `migration-controller.ts` before CAS write | `stopRunning()` + flush |
| Expiry migration | `migration-controller.ts` before CAS write | `stopRunning()` + flush |
| Automation terminate | `session-hub.ts:terminateForAutomation()` | `stopRunning()` + flush |
| Force terminate | `migration-controller.ts:forceTerminate()` | Best-effort flush |
| Graceful shutdown | `hub-manager.ts:releaseAllLeases()` | Parallel flush per hub, bounded by 5s shutdown timeout |

**DB method:** `sessions.flushTelemetry(sessionId, delta, newPrUrls, latestTask)` uses SQL-level `COALESCE + increment` to avoid read-modify-write races:

```sql
UPDATE sessions SET
  metrics = jsonb_build_object(
    'toolCalls', COALESCE((metrics->>'toolCalls')::int, 0) + $delta,
    'messagesExchanged', COALESCE((metrics->>'messagesExchanged')::int, 0) + $delta,
    'activeSeconds', COALESCE((metrics->>'activeSeconds')::int, 0) + $delta
  ),
  pr_urls = (SELECT COALESCE(jsonb_agg(DISTINCT val), '[]'::jsonb)
             FROM jsonb_array_elements(COALESCE(pr_urls, '[]'::jsonb) || $new) AS val),
  latest_task = $latest_task
WHERE id = $session_id
```

**Outcome derivation:** Set at explicit terminal call sites, not in generic `markStopped()`:

| Path | Outcome | Location |
|------|---------|----------|
| `automation.complete` tool | From completion payload | `automation-complete.ts` — persists before terminate |
| CLI stop | `"completed"` | `cli/db.ts:stopSession`, `stopAllCliSessions` |
| Force terminate (circuit breaker) | `"failed"` | `migration-controller.ts:forceTerminate` |

**latestTask clearing:** All 12 non-hub write paths that transition sessions away from active states set `latestTask: null` to prevent zombie text (billing pause, manual pause, CLI stop, orphan sweeper, migration CAS).

**Files touched:** `apps/gateway/src/hub/session-telemetry.ts`, `apps/gateway/src/hub/session-hub.ts`, `apps/gateway/src/hub/event-processor.ts`, `apps/gateway/src/hub/migration-controller.ts`, `apps/gateway/src/hub/hub-manager.ts`, `packages/services/src/sessions/db.ts`

### 6.4 WebSocket Protocol — `Implemented`

**What it does:** Bidirectional real-time communication between browser clients and the gateway.

**Connection**: `WS /proliferate/:sessionId?token=<JWT>` (`apps/gateway/src/api/proliferate/ws/index.ts`).

**Multi-instance behavior:** If the request lands on a non-owner gateway instance, the hub will fail to acquire the owner lease and the connection attempt will fail, prompting the client to reconnect. With L7 sticky routing (recommended), this should be rare.

**Client → Server messages** (`session-hub.ts:handleClientMessage`):

| Type | Auth | Description |
|------|------|-------------|
| `ping` | Connection | Returns `pong` |
| `prompt` | userId required | Sends prompt to OpenCode |
| `cancel` | userId required | Aborts OpenCode session |
| `get_status` | Connection | Returns current status |
| `get_messages` | Connection | Re-sends init payload |
| `save_snapshot` | Connection | Triggers snapshot |
| `run_auto_start` | userId required | Tests service commands |
| `get_git_status` | Connection | Returns git status |
| `git_create_branch` | Mutation auth | Creates branch |
| `git_commit` | Mutation auth | Commits changes |
| `git_push` | Mutation auth | Pushes to remote |
| `git_create_pr` | Mutation auth | Creates pull request |

**Mutation auth**: Requires `userId` to match `session.created_by` (or `created_by` is null for headless sessions). Source: `session-hub.ts:assertCanMutateSession`.

**Server → Client messages**: `status`, `message`, `token`, `text_part_complete`, `tool_start`, `tool_metadata`, `tool_end`, `message_complete`, `message_cancelled`, `error`, `snapshot_result`, `init`, `preview_url`, `git_status`, `git_result`, `auto_start_output`, `pong`.

### 6.5 Session Migration — `Implemented`

**What it does:** Handles sandbox expiry by snapshotting and optionally creating a new sandbox.

**Guards:**
1. Ownership lease: only the session owner may migrate.
2. Migration lock: distributed Redis lock with 60s TTL prevents concurrent migrations for the same session.

**Expiry triggers:**
1. Primary: in-process timer on the hub (fires at expiry minus `GRACE_MS`).
2. Fallback: BullMQ job `"session-expiry"` (needed when the hub was evicted before expiry). Job delay: `max(0, expiresAtMs - now - GRACE_MS)`. Worker calls `hub.runExpiryMigration()`.

**Active migration (clients connected):**
1. Acquire distributed lock (60s TTL).
2. Wait for agent message completion (30s timeout), abort if still running.
3. Scrub configured env files from sandbox, snapshot current sandbox, then re-apply env files.
4. Disconnect SSE, reset sandbox state.
5. Call `ensureRuntimeReady()` — creates new sandbox from snapshot.
6. Broadcast `status: "running"`.

**Idle migration (no clients):**
1. Acquire lock, stop OpenCode.
2. Guard against false-idle by checking `shouldIdleSnapshot()` (accounts for `activeHttpToolCalls > 0` and proxy connections).
3. Scrub configured env files, then pause (if E2B) or snapshot + terminate (if Modal).
4. Update DB: `status: "paused"` (E2B) or `status: "stopped"` (Modal).
5. Clean up hub state, call `onEvict` for memory reclamation.

**Automation completion fast-path:**
- If `automation.complete` is invoked, bypass idle snapshotting and migration timers.
- Terminate runtime immediately, set session `status: "stopped"`, then evict hub.

**Circuit breaker:** After `MAX_SNAPSHOT_FAILURES` (3) consecutive idle snapshot failures, the migration controller stops attempting further snapshots.

Source: `apps/gateway/src/hub/migration-controller.ts`

### 6.6 Git Operations — `Implemented`

**What it does:** Stateless helper translating git commands into sandbox `execCommand` calls.

**Operations** (`apps/gateway/src/hub/git-operations.ts`):
- `getStatus()` — parallel `git status --porcelain=v2`, `git log`, and plumbing probes for busy/shallow/rebase/merge state.
- `createBranch()` — pre-checks existence, then `git checkout -b`.
- `commit()` — stages files (selective, tracked-only, or all), checks for empty diff, commits.
- `push()` — detects upstream, selects push strategy, handles shallow clone errors with `git fetch --deepen`.
- `createPr()` — pushes first, then `gh pr create`, retrieves PR URL via `gh pr view --json`.

**Security**: `resolveGitDir()` validates workspace paths stay within `/home/user/workspace/`. All commands use `GIT_TERMINAL_PROMPT=0` and `GIT_ASKPASS=/bin/false` to prevent interactive prompts.

### 6.7 Port Forwarding Proxy — `Implemented`

**What it does:** Proxies HTTP requests from the client to sandbox ports via the OpenCode tunnel URL.

**Route**: `GET/POST /proxy/:sessionId/:token/opencode/*` (`apps/gateway/src/api/proxy/opencode.ts`).

Auth is token-in-path (required for SSE clients that can't set headers). `createRequireProxyAuth()` validates the token. `createEnsureSessionReady()` ensures the hub and sandbox are ready. `http-proxy-middleware` forwards to the sandbox OpenCode URL with path rewriting.

### 6.8 Gateway Client Libraries — `Implemented`

**What it does:** TypeScript client libraries for programmatic gateway access.

**Factory**: `createSyncClient({ baseUrl, auth, source })` from `packages/gateway-clients`.

**SyncClient API**:
- `createSession(request)` → `POST /proliferate/sessions` with optional idempotency key.
- `connect(sessionId, options)` → WebSocket with auto-reconnection (exponential backoff, max 10 attempts).
- `postMessage(sessionId, { content, userId, source })` → `POST /proliferate/:sessionId/message`.
- `postCancel(sessionId)` → `POST /proliferate/:sessionId/cancel`.
- `getInfo(sessionId)` → `GET /proliferate/:sessionId`.
- `getSessionStatus(sessionId)` → `GET /proliferate/sessions/:sessionId/status`.

**Auth modes**: `ServiceAuth` (HS256 JWT signing with service name) or `TokenAuth` (pre-existing token string).

**WebSocket reconnection defaults**: `maxAttempts: 10`, `baseDelay: 1000ms`, `maxDelay: 30000ms`, `backoffMultiplier: 2`.

Source: `packages/gateway-clients/src/`

### 6.9 Gateway Middleware — `Implemented`

**Auth** (`apps/gateway/src/middleware/auth.ts`):
Token verification chain: (1) User JWT (signed with `gatewayJwtSecret`), (2) Service JWT (signed with `serviceToken`, must have `service` claim), (3) Sandbox HMAC token (HMAC-SHA256 of `serviceToken + sessionId`), (4) CLI API key (HTTP call to web app for DB lookup).

**CORS** (`apps/gateway/src/middleware/cors.ts`): Allows all origins (`*`), methods `GET/POST/PATCH/DELETE/OPTIONS`, headers `Content-Type/Authorization/Accept`, max-age 86400s.

**Error handler** (`apps/gateway/src/middleware/error-handler.ts`): Catches `ApiError` for structured JSON responses. Unhandled errors logged via `@proliferate/logger` and returned as 500.

### 6.10 Session UI Surfaces — `Implemented`

**Session list rows** (`apps/web/src/components/sessions/session-card.tsx`): Enriched with Phase 2a telemetry. Active rows show `latestTask` as subtitle; idle rows show `latestTask` → `promptSnippet` fallback; completed/failed rows show outcome label + compact metrics + PR count. An outcome badge appears for non-"completed" outcomes. A `GitPullRequest` icon + count shows when `prUrls` is populated. Sessions list now includes a dedicated **Configuration** column (short `configurationId`, fallback "No config") rendered for every row on desktop widths. The row accepts an optional `onClick` prop — when provided, it fires the callback instead of navigating directly. The sessions page uses this to open the peek drawer; other pages (my-work) omit it and navigate to `/workspace/:id`.

**Session display helpers** (`apps/web/src/lib/session-display.ts`): Pure formatting functions: `formatActiveTime(seconds)`, `formatCompactMetrics({toolCalls, activeSeconds})`, `getOutcomeDisplay(outcome)`, `formatConfigurationLabel(configurationId)`, `parsePrUrl(url)`. Used across session list rows, peek drawer, and my-work pages.

**Session peek drawer** (`apps/web/src/components/sessions/session-peek-drawer.tsx`): URL-routable right-side sheet. Opened via `?peek=<sessionId>` query param on the sessions page (`apps/web/src/app/(command-center)/dashboard/sessions/page.tsx`). Content sections: header (title + status + outcome), initial prompt, sanitized summary markdown, PR links, metrics grid, timeline, and context (repo/branch/automation). Footer has "Enter Workspace" or "Resume Session" CTA. Uses `useSessionData(id)` for detail data (includes `initialPrompt`). The sessions page wraps its content in `<Suspense>` for `useSearchParams()`.

**Sanitized markdown** (`apps/web/src/components/ui/sanitized-markdown.tsx`): Reusable markdown renderer using `react-markdown` + `rehype-sanitize` with a restrictive schema: allowed tags limited to structural/inline elements (no `img`, `iframe`, `script`, `style`), `href` restricted to `http`/`https` protocols (blocking `javascript:` URLs). Optional `maxLength` prop for truncation. Used to render LLM-generated `session.summary` safely.

**Inbox run triage enrichment** (`apps/web/src/components/inbox/inbox-item.tsx`): Run triage cards show session telemetry context — `latestTask`/`promptSnippet` fallback, sanitized summary (via `SanitizedMarkdown`), compact metrics, and PR count. The shared `getRunStatusDisplay` from `apps/web/src/lib/run-status.ts` is used consistently across inbox, activity, and my-work pages (replacing duplicated local helpers). Approval cards show `latestTask` context from the associated session.

**Activity + My-Work consistency**: Activity page (`apps/web/src/app/(command-center)/dashboard/activity/page.tsx`) shows session title or trigger name for each run instead of a generic "Automation run" label. My-work claimed runs show session title or status label. Both use the shared `getRunStatusDisplay` mapping.

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `sandbox-providers.md` | This → Provider | `ensureSandbox`, `snapshot`, `pause`, `terminate`, `memorySnapshot` | Runtime and migration delegate all sandbox lifecycle operations via provider abstraction |
| `agent-contract.md` | This → Tool contract | `/proliferate/:sessionId/tools/:toolName` | Gateway-intercepted tools execute through synchronous HTTP callbacks |
| `automations-runs.md` | Runs → This | `createSyncClient().createSession/postMessage` | Automation worker bootstraps sessions through gateway client contracts |
| `actions.md` | Shared surface | `/proliferate/:sessionId/actions/*` | Action invocation and approval lifecycle references session context and hub broadcast |
| `repos-prebuilds.md` | This → Config | `resolveConfiguration`, configuration repo/service command APIs | Gateway creation/runtime path depends on configuration resolution outputs |
| `secrets-environment.md` | This ← Secrets | `sessions.buildSandboxEnvVars`, configuration env file spec | Session runtime/build paths hydrate env vars and file instructions from services |
| `integrations.md` | This ↔ Integrations | repo/session connection token resolution | Gateway/session-store resolve git + provider tokens through integration services |
| `billing-metering.md` | This ↔ Billing | `assertBillingGateForOrg`, `checkBillingGateForOrg`, billing columns | Creation and resume are gate-protected; telemetry/status feed metering lifecycle |

### Security & Auth
- Auth sources supported by gateway: user JWT, service JWT, sandbox HMAC token, CLI API key.
- Proxy auth uses path token because some clients cannot attach headers for upgrade/streaming paths.
- Sandbox callback/tool routes require sandbox auth source explicitly.
- Session mutation operations guard against unauthorized user mutation even after connection auth.

References: `apps/gateway/src/middleware/auth.ts`, `apps/gateway/src/api/proliferate/http/tools.ts`, `apps/gateway/src/hub/session-hub.ts`

### Observability
- Structured logs are namespaced by gateway module (`hub`, `runtime`, `migration`, `sse-client`, etc.).
- Runtime readiness logs latency breakdown for major lifecycle stages.
- HTTP layer uses request logging via `pino-http` wrapper.

References: `apps/gateway/src/server.ts`, `apps/gateway/src/hub/session-runtime.ts`, `apps/gateway/src/hub/sse-client.ts`

---

## 8. Acceptance Gates

- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] Gateway tests pass (`pnpm -C apps/gateway test`)
- [ ] Gateway client tests pass (`pnpm -C packages/gateway-clients test`)
- [ ] Deep Dives section is invariant-based (no imperative step-runbooks)
- [ ] Legacy "File Tree" and "Data Models" sections are removed from this spec

---

## 9. Known Limitations & Tech Debt

- [ ] **Hub memory growth is lifecycle-driven, not cap-driven** — current `HubManager` has no explicit hard-cap/LRU policy; cleanup depends on hub lifecycle callbacks and shutdown.
- [ ] **Expiry migration trigger is queue-driven** — there is no separate in-process precise expiry timer in current gateway runtime path.
- [ ] **Tool callback idempotency is process-local** — duplicate callbacks routed to different pods can bypass in-memory dedup.
- [ ] **Session create idempotency is Redis path-dependent** — `sessions.idempotency_key` exists in schema but is not the active enforcement path in gateway creation.
- [ ] **Dual session creation pipelines remain** — gateway HTTP and web oRPC creation are still separate behavioral paths.
- [ ] **GitHub token resolution logic is duplicated** — similar selection logic exists in both `session-store.ts` and `session-creator.ts`.
- [ ] **No durable chat transcript persistence in gateway/session DB path** — message history continuity depends on sandbox/OpenCode continuity.
- [ ] **CORS is permissive (`*`)** — production hardening still depends on token controls rather than origin restrictions.
- [ ] **Session status remains a text column in DB** — invalid status writes are possible without DB enum/check constraints.
