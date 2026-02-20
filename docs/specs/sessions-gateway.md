# Sessions & Gateway — System Spec

## 1. Scope & Purpose

### In Scope
- Session lifecycle: create, pause, resume, snapshot, delete, rename
- Session state machine and status transitions
- Gateway hub manager, session hub, session runtime
- Multi-instance coordination (session ownership leases, runtime boot locks)
- Hub eviction (idle TTL, hard cap) and memory safety
- Event processor (sandbox SSE → client WebSocket)
- SSE bridge to sandbox OpenCode
- WebSocket streaming (client ↔ gateway)
- HTTP message/status/cancel routes
- Gateway-mediated tool execution plumbing (synchronous callbacks, idempotency)
- Streaming backpressure (token batching, slow-consumer handling)
- Session migration controller (expiry, idle)
- Preview/sharing URLs
- Port forwarding proxy (gateway → sandbox)
- Git operations (gateway-side)
- Session store (in-memory state + DB context loading)
- Session connections (DB)
- Gateway middleware (auth, CORS, error handling, request logging)
- Gateway client libraries (`packages/gateway-clients`)

### Out of Scope
- Sandbox boot mechanics and provider interface — see `sandbox-providers.md`
- Tool schemas and prompt modes — see `agent-contract.md`
- Automation-initiated session orchestration (run lifecycle) — see `automations-runs.md`
- Repo/configuration resolution — see `repos-prebuilds.md`
- LLM key generation — see `llm-proxy.md`
- Billing gating for session creation — see `billing-metering.md`

### Mental Model

The gateway is a stateful Express + WebSocket server that bridges web clients and sandbox agents. When a client connects to a session, the gateway ensures there is exactly one **hub** (a per-session runtime) responsible for that session across the entire gateway deployment. The hub owns the sandbox connection (SSE to OpenCode), client WebSocket connections, event translation, and migration orchestration.

Sessions can be created via two different pipelines. The **oRPC path** (`apps/web/src/server/routers/sessions-create.ts`) is lightweight: billing check, agent config, configuration lookup, snapshot resolution, and a `sessions.createSessionRecord()` call — no idempotency, no session connections, no sandbox provisioning. The **gateway HTTP path** (`POST /proliferate/sessions` via `apps/gateway/src/lib/session-creator.ts`) is the full pipeline: configuration resolution, integration token resolution, session connections, SSH options, and optionally immediate sandbox creation. Both support DB-based idempotency via the `sessions.idempotency_key` column. Runtime provisioning remains lazy by default: the first hub connection triggers `ensureRuntimeReady()` unless the session was created with `"immediate"` provisioning.

**Core entities:**
- **Session** — a DB record tracking sandbox association, status, snapshot, and config. Statuses: `pending`, `starting`, `running`, `paused`, `stopped`, `failed`. Resume is implicit — connecting to a paused session's hub triggers `ensureRuntimeReady()`, which provisions a new sandbox from the stored snapshot.
- **Hub** — gateway-side per-session object (`SessionHub`) managing WebSocket clients, SSE bridge, event processing, and migration. Exists only while the gateway process is alive. Hubs are evicted on idle TTL or when exceeding a hard cap to bound gateway memory usage.
- **Runtime** — inner component of a hub (`SessionRuntime`) owning sandbox provisioning, OpenCode session management, and SSE connection state.
- **Event processor** — translates OpenCode SSE events into client-facing `ServerMessage` payloads. Handles tool interception routing.

**Key invariants:**
- Messages never flow through API routes. All real-time streaming is Client ↔ Gateway ↔ Sandbox.
- Exactly one gateway instance may act as the **owner** for a session at a time (Redis ownership lease).
- `HubManager` deduplicates concurrent `getOrCreate` calls for the same session ID within an instance via a pending-promise map.
- `ensureRuntimeReady()` is idempotent within an instance — coalesces concurrent callers into a single promise.
- `SessionHub.ensureRuntimeReady()` acquires the cross-pod owner lease before runtime lifecycle work. Non-owner hubs must abort before provisioning.
- Hubs are evicted on idle TTL (no connected WS clients) and under a hard cap to bound gateway memory.
- Sandbox creation is always delegated to the `SandboxProvider` interface (see `sandbox-providers.md`).

---

## 2. Core Concepts

### Hub Manager
Singleton registry mapping session IDs to `SessionHub` instances. Lazy-creates hubs on first access and deduplicates concurrent `getOrCreate()` calls via a `pending` promise map **within an instance**.

The hub manager is also responsible for:
- **Ownership gating**: a hub may only be created/used by the instance holding the session ownership lease.
- **Eviction**: hubs are evicted on idle TTL (no connected WS clients) and under a hard cap using LRU selection to bound memory.
- **Full cleanup**: `remove()` is a real lifecycle operation (disconnect SSE, cancel timers, release leases, dereference hub). Called via `onEvict` callback from `SessionHub`.
- **Graceful shutdown**: `releaseAllLeases()` stops all migration monitors and removes all hubs so a restarted instance can immediately re-acquire sessions.

- Key detail agents get wrong: Hub state remains in-memory, but hubs do not leak indefinitely. Eviction is expected in steady state.
- Reference: `apps/gateway/src/hub/hub-manager.ts`

### Session Ownership Leases
Distributed coordination primitive that ensures exactly one gateway instance is allowed to "own" a session's hub at a time. Each active hub uses Redis leases to prevent split-brain across gateway pods.

- **Owner lease** (`lease:owner:{sessionId}`) — only the owner may run runtime lifecycle work. TTL: 30s, renewed every ~10s.
- **Runtime lease** (`lease:runtime:{sessionId}`) — indicates a live runtime for orphan detection. TTL: 20s.
- Acquisition: `SET lease:owner:{sessionId} {instanceId} NX PX 30000` with a Lua-scripted atomic check-and-extend for re-acquisition by the same instance.
- Renewal: heartbeat every ~10s (OWNER_LEASE_TTL_MS / 3) while the hub is alive.
- Release: best-effort atomic check-and-delete via Lua script on hub cleanup.

Only the owner instance may:
- Connect SSE to the sandbox OpenCode server
- Run `ensureRuntimeReady()` (sandbox provisioning)
- Execute gateway-mediated tool callbacks
- Execute sandbox-originated action invocations (server-side)
- Perform migration

Non-owner instances must reject WebSocket connections (close reason like `"Session is owned by another instance"`) so the client can reconnect and be routed to the correct owner.

- Key detail agents get wrong: Owner lease acquisition happens before `runtime.ensureRuntimeReady()`. A hub that cannot acquire ownership must fail fast and avoid sandbox/OpenCode provisioning.
- Reference: `apps/gateway/src/lib/session-leases.ts`, `apps/gateway/src/hub/session-hub.ts`

### Lease Heartbeat Lag Guard (Split-Brain Suicide)
Node event-loop lag can delay lease renewal long enough for the Redis TTL to expire. If renewal lateness exceeds lease TTL, the current owner must assume ownership may already have moved and terminate itself immediately.

Fail-safe behavior when `Date.now() - lastLeaseRenewAt > OWNER_LEASE_TTL_MS`:
- Stop lease renewal timer.
- Release leases (best-effort).
- Drop all WebSocket clients with close reason `"Session ownership transferred"`.
- Disconnect SSE from sandbox.
- Remove hub from `HubManager` via `onEvict` callback.

This is intentionally disruptive and prevents split-brain execution.

Reference: `apps/gateway/src/hub/session-hub.ts:startLeaseRenewal`

### Runtime Boot Lock
Short-lived distributed lock to prevent concurrent sandbox provisioning across instances:

- Acquisition: `SET lease:runtime:{sessionId} 1 PX 20000`
- Renewal: heartbeat during provisioning
- Release: `DEL lease:runtime:{sessionId}` once runtime is ready or on hub cleanup

This lock is intentionally separate from the ownership lease: ownership is "hub lifetime," runtime lock is "boot sequence only."

Reference: `apps/gateway/src/lib/session-leases.ts`

### Deferred vs Immediate Sandbox Mode
Session creation defaults to `"deferred"` — the DB record is written immediately, but sandbox provisioning waits until the first WebSocket client connects. `"immediate"` mode provisions the sandbox during session creation and returns connection info for SSH/CLI/automation flows.
- Key detail agents get wrong: Even in deferred mode, the sandbox is NOT created by the oRPC route. The gateway hub's `ensureRuntimeReady()` creates it.
- Reference: `apps/gateway/src/lib/session-creator.ts:sandboxMode`

### SSE Bridge
The gateway maintains a persistent SSE connection to OpenCode (`GET /event` on the sandbox tunnel URL). The `SseClient` reads the stream, parses events via `eventsource-parser`, and forwards them to the `EventProcessor`. Disconnections trigger reconnection via the hub.
- Key detail agents get wrong: The SSE connection is unidirectional (sandbox → gateway). Prompts flow via HTTP POST to OpenCode, not via SSE.
- Reference: `apps/gateway/src/hub/sse-client.ts`

### Migration Controller
Handles sandbox expiry by either migrating to a new sandbox (if clients are connected) or snapshotting and stopping (if idle). Uses a distributed lock to prevent concurrent migrations.
- Key detail agents get wrong: Expiry uses **two triggers**. An in-process timer on the hub is the primary trigger (precise). A BullMQ job remains as a fallback for sessions whose hubs were evicted. The controller also tracks `shouldIdleSnapshot()` state to prevent false-idle during active HTTP tool callbacks.
- Reference: `apps/gateway/src/hub/migration-controller.ts`, `apps/gateway/src/expiry/expiry-queue.ts`

### Synchronous Tool Callbacks + Idempotency
Gateway-mediated tools execute through synchronous sandbox callbacks (`POST /proliferate/:sessionId/tools/:toolName`) authenticated by sandbox HMAC token.

Idempotency model:
- In-memory per-process map: `inflightCalls: Map<tool_call_id, Promise<ToolCallResult>>` plus `completedResults: Map<tool_call_id, ToolCallResult>`.
- If a duplicate callback arrives while the first execution is still running, await the existing in-flight promise rather than re-running the tool.
- Completed results are retained for 5 minutes (`RESULT_RETENTION_MS`) to handle post-completion retries.
- Tool invocations are also persisted in the `session_tool_invocations` table for auditing and observability.

Key detail agents get wrong: Callback retries are expected (e.g., snapshot TCP drop where containers freeze/thaw) and must not create duplicate side effects.

Reference: `apps/gateway/src/api/proliferate/http/tools.ts`, `apps/gateway/src/hub/capabilities/tools/`

### Idle Snapshotting Guardrails
Idle hub eviction and snapshotting must account for synchronous callback execution time.

Rules:
- Track `activeHttpToolCalls` in the hub.
- Idle snapshot timer must not pause/snapshot/evict while `activeHttpToolCalls > 0`, even if SSE appears quiet.
- On normal idle (no active callbacks, no WS clients), snapshot then pause + evict.

Automation fast-path:
- When `automation.complete` is executed, bypass idle snapshot timers.
- Immediately terminate provider runtime, mark session `stopped`, and evict hub.
- Goal: reduce compute/runtime tail and avoid unnecessary snapshot writes for completed automation sessions.

Reference: `apps/gateway/src/hub/session-hub.ts:shouldIdleSnapshot`

---

## 3. File Tree

```
apps/gateway/src/
├── hub/
│   ├── index.ts                          # Barrel exports
│   ├── hub-manager.ts                    # HubManager — hub registry + eviction + lease release
│   ├── session-hub.ts                    # SessionHub — per-session runtime + client management + lease heartbeat
│   ├── session-runtime.ts                # SessionRuntime — sandbox/OpenCode/SSE lifecycle
│   ├── event-processor.ts                # EventProcessor — SSE → ServerMessage translation
│   ├── sse-client.ts                     # SseClient — transport-only SSE reader
│   ├── migration-controller.ts           # MigrationController — expiry/idle migration
│   ├── git-operations.ts                 # GitOperations — stateless git/gh via sandbox exec
│   ├── session-telemetry.ts             # SessionTelemetry — in-memory counter + periodic DB flush
│   ├── types.ts                          # PromptOptions, MigrationState, MigrationConfig
│   └── capabilities/tools/
│       ├── index.ts                      # Tool handler registry (invoked via tool callbacks; see agent-contract.md)
│       ├── automation-complete.ts        # automation.complete handler
│       ├── save-env-files.ts             # save_env_files handler
│       ├── save-service-commands.ts      # save_service_commands handler
│       ├── save-snapshot.ts              # save_snapshot handler
│       └── verify.ts                     # verify handler
├── api/
│   ├── proliferate/
│   │   ├── http/
│   │   │   ├── index.ts                 # Router aggregation
│   │   │   ├── sessions.ts              # POST /sessions, GET /:sessionId/status
│   │   │   ├── message.ts              # POST /:sessionId/message
│   │   │   ├── cancel.ts               # POST /:sessionId/cancel
│   │   │   ├── info.ts                 # GET /:sessionId (sandbox info)
│   │   │   ├── heartbeat.ts            # POST /:sessionId/heartbeat (idle timer reset)
│   │   │   ├── tools.ts               # POST /:sessionId/tools/:toolName (sandbox callbacks)
│   │   │   └── actions.ts              # Action routes (see actions.md)
│   │   └── ws/
│   │       └── index.ts                 # WS /proliferate/:sessionId
│   ├── ws-multiplexer.ts                    # WS upgrade routing — first-match handler dispatch
│   └── proxy/
│       ├── opencode.ts                  # /proxy/:sid/:token/opencode passthrough
│       ├── devtools.ts                  # /proxy/:sid/:token/devtools/mcp passthrough
│       ├── terminal.ts                  # /proxy/:sid/:token/devtools/terminal WS proxy
│       └── vscode.ts                    # /proxy/:sid/:token/devtools/vscode HTTP + WS proxy
├── lib/
│   ├── session-creator.ts               # createSession() — DB + optional sandbox
│   ├── session-store.ts                 # loadSessionContext() — DB → SessionContext
│   ├── session-leases.ts                # Redis ownership lease + runtime lease helpers
│   ├── env.ts                           # GatewayEnv config
│   ├── opencode.ts                      # OpenCode HTTP helpers (create session, send prompt, etc.)
│   ├── redis.ts                         # Redis pub/sub for session events
│   ├── s3.ts                            # S3 verification file upload
│   ├── lock.ts                          # Distributed migration lock
│   ├── idempotency.ts                   # Redis-based idempotency keys (legacy — see also DB idempotency_key)
│   ├── configuration-resolver.ts        # Configuration resolution (see repos-prebuilds.md)
│   ├── github-auth.ts                   # GitHub token resolution
│   └── sandbox-mcp-token.ts             # HMAC-SHA256 token derivation
├── expiry/
│   └── expiry-queue.ts                  # BullMQ session expiry scheduler + worker
├── middleware/
│   ├── auth.ts                          # verifyToken(), createRequireAuth(), createRequireProxyAuth()
│   ├── cors.ts                          # CORS headers (allow *)
│   ├── error-handler.ts                 # ApiError class + error handler middleware
│   ├── lifecycle.ts                     # createEnsureSessionReady() — hub + sandbox readiness middleware
│   └── index.ts                         # Barrel exports
└── types.ts                             # AuthResult, OpenCodeEvent, SandboxInfo, etc.

apps/web/src/server/routers/
└── sessions.ts                          # oRPC session routes (list, get, create, delete, rename, pause, snapshot, status, submitEnv)

apps/web/src/
├── components/sessions/
│   ├── session-card.tsx                 # SessionListRow — session list rows with telemetry enrichment
│   └── session-peek-drawer.tsx          # SessionPeekDrawer — URL-routable right-side sheet
├── components/ui/
│   └── sanitized-markdown.tsx           # SanitizedMarkdown — AST-sanitized markdown renderer
├── lib/
│   └── session-display.ts              # Session display helpers (formatActiveTime, getOutcomeDisplay, parsePrUrl)
└── app/(command-center)/dashboard/sessions/
    └── page.tsx                          # Sessions page — peek drawer wiring + URL param sync

packages/gateway-clients/src/
├── index.ts                             # Barrel exports
├── client.ts                            # Client interface
├── server.ts                            # Server-only exports (BullMQ-based async client)
├── types.ts                             # Shared types
├── auth/index.ts                        # Auth utilities
├── clients/
│   ├── index.ts                         # Client barrel exports
│   ├── sync/
│   │   ├── index.ts                     # createSyncClient() factory
│   │   ├── http.ts                      # HTTP methods (create, post, cancel, info, status)
│   │   └── websocket.ts                 # WebSocket with auto-reconnection
│   ├── async/
│   │   ├── index.ts                     # AsyncClient — BullMQ-based base class (Slack, etc.)
│   │   ├── receiver.ts                  # Async message receiver
│   │   └── types.ts                     # Async client types
│   └── external/
│       ├── index.ts                     # ExternalClient exports
│       └── opencode.ts                  # OpenCodeClient — proxy passthrough
└── capabilities/tools/
    ├── index.ts                         # Tool exports
    └── verify.ts                        # Verification file tools

packages/db/src/schema/
├── sessions.ts                          # sessions + sessionConnections tables
└── schema.ts                            # sessions (with idempotency_key, configuration_id) + session_tool_invocations table

packages/services/src/sessions/
├── db.ts                                # Session DB operations
├── service.ts                           # Session service (list, get, rename, delete, status)
├── mapper.ts                            # DB row → Session mapping (includes slackThreadUrl derivation)
├── sandbox-env.ts                       # Sandbox environment variable building
└── index.ts                             # Barrel exports
```

---

## 4. Data Models & Schemas

### Database Tables

```sql
sessions
├── id                    UUID PRIMARY KEY
├── organization_id       TEXT NOT NULL (FK → organization)
├── created_by            TEXT (FK → user)
├── configuration_id      UUID (FK → configurations, CASCADE on delete)
├── repo_id               UUID (FK → repos, CASCADE — legacy)
├── session_type           TEXT DEFAULT 'coding'   -- 'setup' | 'coding' | 'cli' | 'terminal' (see note)
├── status                TEXT DEFAULT 'starting'  -- 'starting' | 'running' | 'paused' | 'stopped' | 'failed'
├── sandbox_id            TEXT
├── sandbox_provider      TEXT DEFAULT 'modal' NOT NULL  -- CHECK: 'modal' | 'e2b'
├── snapshot_id           TEXT
├── branch_name           TEXT
├── base_commit_sha       TEXT
├── client_type           TEXT                     -- 'web' | 'slack' | 'cli' | 'automation'
├── client_metadata       JSONB
├── coding_agent_session_id TEXT
├── open_code_tunnel_url  TEXT
├── preview_tunnel_url    TEXT
├── sandbox_url           TEXT
├── agent_config          JSONB                    -- { modelId?: string; tools?: string[] }
├── system_prompt         TEXT
├── initial_prompt        TEXT
├── title                 TEXT
├── automation_id         UUID (FK → automations, SET NULL on delete)
├── trigger_id            UUID (FK → triggers, SET NULL on delete)
├── trigger_event_id      UUID (FK → trigger_events, SET NULL on delete)
├── parent_session_id     UUID (self-FK)
├── idempotency_key       TEXT                     -- per-session dedup (no unique index currently)
├── origin                TEXT DEFAULT 'web'       -- 'web' | 'cli'
├── source                TEXT DEFAULT 'web'
├── local_path_hash       TEXT
├── sandbox_expires_at    TIMESTAMPTZ
├── started_at            TIMESTAMPTZ DEFAULT now()
├── last_activity_at      TIMESTAMPTZ DEFAULT now()
├── paused_at             TIMESTAMPTZ
├── ended_at              TIMESTAMPTZ
├── idle_timeout_minutes  INT DEFAULT 30
├── auto_delete_days      INT DEFAULT 7
├── metered_through_at    TIMESTAMPTZ
├── last_seen_alive_at    TIMESTAMPTZ
├── alive_check_failures  INT DEFAULT 0
├── pause_reason          TEXT
├── stop_reason           TEXT
├── outcome               TEXT                     -- 'completed' | 'failed' | 'succeeded' | 'needs_human'
├── summary               TEXT                     -- LLM-generated markdown (automation sessions)
├── pr_urls               JSONB                    -- string[] of GitHub PR URLs
├── metrics               JSONB                    -- { toolCalls, messagesExchanged, activeSeconds }
└── latest_task           TEXT                     -- last known agent activity from tool_metadata

session_connections
├── id                    UUID PRIMARY KEY
├── session_id            UUID NOT NULL (FK → sessions, CASCADE)
├── integration_id        UUID NOT NULL (FK → integrations, CASCADE)
├── created_at            TIMESTAMPTZ DEFAULT now()
└── UNIQUE(session_id, integration_id)

session_tool_invocations
├── id                    UUID PRIMARY KEY
├── session_id            UUID NOT NULL (FK → sessions, CASCADE)
├── organization_id       TEXT NOT NULL (FK → organization, CASCADE)
├── tool_name             TEXT NOT NULL
├── tool_source           TEXT
├── status                TEXT DEFAULT 'pending'   -- 'pending' | 'executing' | 'completed' | 'failed'
├── input                 JSONB
├── output                JSONB
├── error                 TEXT
├── duration_ms           INT
├── started_at            TIMESTAMPTZ
├── completed_at          TIMESTAMPTZ
└── created_at            TIMESTAMPTZ DEFAULT now()
```

Source: `packages/db/src/schema/sessions.ts`, `packages/db/src/schema/schema.ts`

**`session_type` inconsistency:** The gateway creator (`session-creator.ts:42`) defines `SessionType = "coding" | "setup" | "cli"`, but the oRPC CLI route (`cli.ts:431`) writes `"terminal"` and the DB schema comment also says `'terminal'`. Both `"cli"` and `"terminal"` exist in production data for CLI-originated sessions.

### Key Indexes
- `idx_sessions_org` on `organization_id`
- `idx_sessions_repo` on `repo_id`
- `idx_sessions_status` on `status`
- `idx_sessions_parent` on `parent_session_id`
- `idx_sessions_automation` on `automation_id`
- `idx_sessions_trigger` on `trigger_id`
- `idx_sessions_configuration` on `configuration_id`
- `idx_sessions_local_path_hash` on `local_path_hash` (partial: where not null)
- `idx_sessions_client_type` on `client_type`
- `idx_sessions_sandbox_expires_at` on `sandbox_expires_at` (partial: where not null)
- `idx_sessions_sandbox_provider` on `sandbox_provider`
- `idx_sessions_slack_lookup` on `(client_metadata->>'installationId', client_metadata->>'channelId', client_metadata->>'threadTs')` (partial: where `client_type = 'slack'`)
- `idx_sessions_automation_trigger_event` UNIQUE on `(automation_id, trigger_event_id)`
- `idx_session_tool_invocations_session` on `session_tool_invocations.session_id`
- `idx_session_tool_invocations_org` on `session_tool_invocations.organization_id`
- `idx_session_tool_invocations_status` on `session_tool_invocations.status`

### Core TypeScript Types

```typescript
// apps/gateway/src/lib/session-store.ts
interface SessionContext {
  session: SessionRecord;
  repos: RepoSpec[];
  primaryRepo: RepoRecord;
  systemPrompt: string;
  agentConfig: AgentConfig & { tools?: string[] };
  envVars: Record<string, string>;
  sshPublicKey?: string;
  snapshotHasDeps: boolean;
  serviceCommands?: ConfigurationServiceCommand[];
}

// apps/gateway/src/hub/types.ts
type MigrationState = "normal" | "migrating";

const MigrationConfig = {
  GRACE_MS: 5 * 60 * 1000,              // Start migration 5 min before expiry
  CHECK_INTERVAL_MS: 30_000,             // Polling interval
  MESSAGE_COMPLETE_TIMEOUT_MS: 30_000,   // Wait for agent to finish before abort
};
```

---

## 5. Conventions & Patterns

### Do
- Use `hubManager.getOrCreate(sessionId)` to obtain a hub — never construct `SessionHub` directly.
- Use `createSyncClient()` from `@proliferate/gateway-clients` for all programmatic gateway access.
- Use `GIT_READONLY_ENV` (with `GIT_OPTIONAL_LOCKS=0`) for read-only git operations to avoid contention with the agent's index lock.

### Don't
- Route messages through API routes — all streaming goes Client ↔ Gateway ↔ Sandbox.
- Trust client-supplied `userId` in WebSocket messages — derive from authenticated connection.
- Call `provider.createSandbox()` directly from gateway code — use `provider.ensureSandbox()` which handles recovery.

### Error Handling

```typescript
// apps/gateway/src/middleware/error-handler.ts
class ApiError extends Error {
  constructor(public readonly statusCode: number, message: string, public readonly details?: unknown);
}
// Thrown in routes, caught by errorHandler middleware → JSON response
```

### Reliability
- **SSE read timeout**: Configurable via `env.sseReadTimeoutMs`. Stream read uses `readWithTimeout()` to detect stuck connections.
- **Heartbeat monitoring**: `SseClient` checks for event activity every ~`heartbeatTimeoutMs / 3`. Exceeding the timeout triggers reconnection.
- **Reconnection**: Exponential backoff via `env.reconnectDelaysMs` array. Stops if all clients disconnect (unless automation session).
- **Ownership lease**: A hub must hold a Redis ownership lease (`lease:owner:{sessionId}`) to act as the session owner; renewed by heartbeat (~10s interval) while the hub is alive. Lease loss triggers split-brain suicide (see §2).
- **Runtime lease**: Sandbox-alive signal (`lease:runtime:{sessionId}`) with 20s TTL, set after successful runtime boot and used for orphan detection.
- **Hub eviction**: Hubs are evicted on idle TTL (no connected WS clients) and under a hard cap (LRU) to bound memory usage. `HubManager.remove()` is called via `onEvict` callback.
- **Session create idempotency**: DB-based via `sessions.idempotency_key` column. Redis-based idempotency (`idempotency.ts`) still exists as a legacy path.
- **Tool call idempotency**: In-memory `inflightCalls` + `completedResults` maps per process, keyed by `tool_call_id`, with 5-minute retention for completed results.
- **Tool result patching**: `updateToolResult()` retries up to 5x with 1s delay (see `agent-contract.md` §5).
- **Migration lock**: Distributed Redis lock with 60s TTL prevents concurrent migrations for the same session.
- **Expiry triggers**: Hub schedules an in-process expiry timer (primary) plus a BullMQ job as a fallback for evicted hubs.
- **Streaming backpressure**: Token batching (50-100ms) and slow-consumer disconnect based on `ws.bufferedAmount` thresholds.

### Testing Conventions
- Gateway tests are colocated with source files (e.g., `git-operations.test.ts`, `ws-handler.test.ts`, `actions.test.ts`). No central `__tests__/` directory.
- Mock the `SandboxProvider` interface — never call real Modal/E2B from tests.
- Git operations parsers (`parseStatusV2`, `parseLogOutput`, `parseBusyState`) are exported for unit testing independently of sandbox exec.
- Hub and runtime tests should use `loadSessionContext` stubs to avoid DB dependency.

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
- `pause` → loads session, calls `provider.snapshot()` + `provider.terminate()`, finalizes billing, updates DB status to `"paused"` (`sessions-pause.ts`).
- `resume` → no dedicated handler. Resume is implicit: connecting a WebSocket client to a paused session triggers `ensureRuntimeReady()`, which creates a new sandbox from the stored snapshot.
- `delete` → calls `sessions.deleteSession()`.
- `rename` → calls `sessions.renameSession()`.
- `snapshot` → calls `snapshotSessionHandler()` (`sessions-snapshot.ts`).
- `submitEnv` → writes secrets to DB, writes env file to sandbox via provider.

**Idempotency:**
- The `sessions` table has an `idempotency_key` TEXT column. When provided, callers can detect duplicate creation attempts.
- Redis-based idempotency (`apps/gateway/src/lib/idempotency.ts`) also exists as a legacy deduplication path for the gateway HTTP route.

**Files touched:** `apps/gateway/src/api/proliferate/http/sessions.ts`, `apps/gateway/src/lib/session-creator.ts`, `apps/web/src/server/routers/sessions.ts`

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
3. Snapshot current sandbox.
4. Disconnect SSE, reset sandbox state.
5. Call `ensureRuntimeReady()` — creates new sandbox from snapshot.
6. Broadcast `status: "running"`.

**Idle migration (no clients):**
1. Acquire lock, stop OpenCode.
2. Guard against false-idle by checking `shouldIdleSnapshot()` (accounts for `activeHttpToolCalls > 0` and proxy connections).
3. Pause (if E2B) or snapshot + terminate (if Modal).
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
| `sandbox-providers.md` | This → Provider | `SandboxProvider.ensureSandbox()`, `.snapshot()`, `.pause()`, `.terminate()` | Runtime calls provider for sandbox lifecycle |
| `agent-contract.md` | This → Tools | `POST /proliferate/:sessionId/tools/:toolName`, `getInterceptedToolHandler()` | Gateway-mediated tools executed via synchronous sandbox callbacks; schemas in agent-contract |
| `automations-runs.md` | Runs → This | `createSyncClient().createSession()` + `.postMessage()` | Worker creates session and posts initial prompt |
| `automations-runs.md` | Notifications → This | `sessions.findByIdInternal()`, `notifications.listSubscriptionsForSession()` | Session completion DMs look up session + subscribers |
| `repos-prebuilds.md` | This → Configurations | `resolveConfiguration()`, `configurations.getConfigurationReposWithDetails()` | Session creator resolves configuration at creation |
| `llm-proxy.md` | Proxy → This | `sessions.buildSandboxEnvVars()` | Env vars include `ANTHROPIC_API_KEY`/`ANTHROPIC_BASE_URL` |
| `secrets-environment.md` | Secrets → This | `secrets.buildEnvFilesFromBundles()` | Env files passed to provider at sandbox creation |
| `integrations.md` | This → Integrations | `integrations.getRepoConnectionsWithIntegrations()` | Token resolution for git clone |
| `billing-metering.md` | Billing → This | `sessions` billing columns | Metering reads `lastSeenAliveAt`, `meteredThroughAt` |

### Security & Auth
- Four auth sources: User JWT, Service JWT, Sandbox HMAC, CLI API key.
- WebSocket auth via query param `?token=` or `Authorization` header.
- Client-supplied `userId` in WebSocket messages is ignored; always derived from authenticated connection (`session-hub.ts:214`).
- Mutation operations (git commit/push/PR) require user to match `session.created_by`.
- Sandbox-mcp token derived via HMAC-SHA256 — per-session, never stored in DB.
- Tool callback routes authenticated via sandbox HMAC token.

### Observability
- Structured logging via `@proliferate/logger` with `service: "gateway"` and module-level children (`hub`, `runtime`, `sse-client`, `event-processor`, `migration`, `sessions-route`, `proxy`, `session-leases`, `http-tools`).
- Latency events logged at every lifecycle step: `runtime.ensure_ready.start`, `.load_context`, `.provider.ensure_sandbox`, `.opencode_session.ensure`, `.sse.connect`, `.complete`.
- Request logging via `pino-http` (`createHttpLogger`).

---

## 8. Acceptance Gates

- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] Gateway tests pass (`pnpm -C apps/gateway test`)
- [ ] Gateway client tests pass (`pnpm -C packages/gateway-clients test`)
- [ ] This spec is updated (file tree, data models, deep dives)

---

## 9. Known Limitations & Tech Debt

- [ ] **Hub state remains in-memory** — The hub is an in-process object and must be re-created after a gateway restart. DB + snapshots provide recovery, but streaming state is not persisted. Impact: brief reconnection delay.
- [ ] **Sticky routing recommended** — Ownership leases enforce correctness, but without L7 stickiness sessions may bounce across instances and see reconnect churn when lease acquisition fails. Impact: latency spikes during reconnect storms. Expected fix: consistent hashing on `sessionId`.
- [ ] **Lease loss is disruptive by design** — If Redis is unavailable and the owner cannot renew, the gateway tears down its hub to avoid split-brain. Impact: short interruptions; clients reconnect and another instance claims ownership.
- [ ] **Duplicate GitHub token resolution** — Both `session-store.ts:resolveGitHubToken` and `session-creator.ts:resolveGitHubToken` contain near-identical token resolution logic. Impact: code duplication. Expected fix: extract into shared `github-auth.ts` utility.
- [ ] **No WebSocket message persistence** — Messages live only in OpenCode's in-memory session. If OpenCode restarts, message history is lost. Impact: users see empty chat on sandbox recreation. Expected fix: message persistence layer (out of scope for current design).
- [ ] **CORS allows all origins** — `Access-Control-Allow-Origin: *` is permissive. Impact: any domain can make requests if they have a valid token. Expected fix: restrict to known domains in production.
- [ ] **Session status enum not enforced at DB level** — `status` is a `TEXT` column with no CHECK constraint. Impact: invalid states possible via direct DB writes. Expected fix: add DB-level enum or check constraint.
- [ ] **Legacy `repo_id` FK on sessions** — Sessions table still has `repo_id` FK to repos (with CASCADE delete). Repos are now associated via `configuration_repos` junction. Impact: schema inconsistency. Expected fix: drop `repo_id` column after confirming no reads.
- [ ] **Dual idempotency paths** — Session creation has both a DB-based `idempotency_key` column and a legacy Redis-based idempotency module (`lib/idempotency.ts`). Impact: two parallel dedup mechanisms. Expected fix: consolidate on DB-based idempotency and remove Redis path.
- [ ] **Dual session creation pipelines** — The oRPC path and gateway HTTP path remain separate codepaths rather than a unified `SessionService.create()`. Impact: divergent behavior and code duplication. Expected fix: consolidate into a canonical service-layer creation function.
