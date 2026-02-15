# Sessions & Gateway — System Spec

> **vNext (target architecture)** — This spec describes the intended multi-instance-hardened gateway behavior and may not match `main` yet.
>
> Current implemented spec: `../sessions-gateway.md`  
> Design change set: `../../../session_changes.md`

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
- Session migration controller (expiry, idle)
- Gateway-mediated tool execution plumbing (synchronous callbacks, idempotency)
- Streaming backpressure (token batching, slow-consumer handling)
- Preview/sharing URLs
- Port forwarding proxy (gateway → sandbox)
- Git operations (gateway-side)
- Session store (in-memory state + DB context loading)
- Session connections (DB)
- Gateway middleware (auth, CORS, error handling, request logging)
- Gateway client libraries (`packages/gateway-clients`)

### Out of Scope
- Sandbox boot mechanics and provider interface — see `./sandbox-providers.md`
- Tool schemas and prompt modes — see `./agent-contract.md`
- Automation-initiated session orchestration (run lifecycle) — see `automations-runs.md`
- Repo/configuration resolution — see `repos-prebuilds.md` and `configurations-snapshots.md`
- LLM key generation — see `llm-proxy.md`
- Billing gating for session creation — see `billing-metering.md`

### Mental Model

The gateway is a stateful Express + WebSocket server that bridges web clients and sandbox agents. When a client connects to a session, the gateway ensures there is exactly one **hub** (a per-session runtime) responsible for that session across the entire gateway deployment. The hub owns the sandbox connection (SSE to OpenCode), client WebSocket connections, event translation, and migration orchestration.

Sessions are created through a single canonical pipeline (`SessionService.create()`), called by both the web oRPC handlers and the gateway HTTP API. Session creation is **database-idempotent** via an `idempotency_key` unique index on the `sessions` table, and always establishes session invariants (session record, session connections, integration token validation, and optional immediate sandbox provisioning). Runtime provisioning remains lazy by default: the first hub connection triggers `ensureRuntimeReady()` unless the session was created with `"immediate"` provisioning.

**Core entities:**
- **Session** — a DB record tracking sandbox association, status, snapshot, and config. Statuses: `pending`, `starting`, `running`, `paused`, `stopped`, `failed`. Resume is implicit — connecting to a paused session's hub triggers `ensureRuntimeReady()`, which provisions a new sandbox from the stored snapshot.
- **Hub** — gateway-side per-session object (`SessionHub`) managing WebSocket clients, SSE bridge, event processing, and migration. Exists only while the gateway process is alive.
- **Runtime** — inner component of a hub (`SessionRuntime`) owning sandbox provisioning, OpenCode session management, and SSE connection state.
- **Event processor** — translates OpenCode SSE events into client-facing `ServerMessage` payloads. Handles tool interception routing.

**Key invariants:**
- Messages never flow through API routes. All real-time streaming is Client ↔ Gateway ↔ Sandbox.
- Exactly one gateway instance may act as the **owner** for a session at a time (Redis ownership lease).
- `HubManager` deduplicates concurrent `getOrCreate` calls for the same session ID within an instance via a pending-promise map.
- `ensureRuntimeReady()` is idempotent within an instance and is protected across instances by a Redis runtime boot lock.
- Hubs are evicted on idle TTL or when exceeding a hard cap to bound gateway memory usage.
- Sandbox creation is always delegated to the `SandboxProvider` interface (see `./sandbox-providers.md`).

---

## 2. Core Concepts

### Hub Manager
Singleton registry mapping session IDs to `SessionHub` instances. Lazy-creates hubs on first access and deduplicates concurrent `getOrCreate()` calls via a `pending` promise map **within an instance**.

In vNext, the hub manager is also responsible for:
- **Ownership gating**: a hub may only be created/used by the instance holding the session ownership lease.
- **Eviction**: hubs are evicted on idle TTL (no connected WS clients) and under a hard cap using LRU selection to bound memory.
- **Full cleanup**: `remove()` is a real lifecycle operation (disconnect SSE, cancel timers, release leases, dereference hub).

- Key detail agents get wrong: Hub state remains in-memory, but hubs do not leak indefinitely. Eviction is expected in steady state.
- Reference: `apps/gateway/src/hub/hub-manager.ts`

### Session Ownership Lease — `Planned`
Distributed coordination primitive that ensures exactly one gateway instance is allowed to "own" a session's hub at a time.

- Acquisition: `SET owner:{sessionId} {instanceId} NX PX 30000`
- Renewal: heartbeat every ~10s while the hub is alive
- Release: best-effort `DEL owner:{sessionId}` on hub cleanup

Lease loss detection (split-brain prevention):
- The hub must detect missed heartbeats (event loop lag) by tracking the last successful renewal timestamp.
- If a heartbeat tick runs late enough that the lease may have expired (e.g., `Date.now() - lastRenewAt > LEASE_TTL`), the hub must immediately self-terminate:
  - Abort all in-flight work (AbortController)
  - Disconnect SSE
  - Close all WebSockets with a close reason like `"lease_lost"`
  - Stop accepting sandbox callbacks/actions/tools for the session

Only the owner instance may:
- Connect SSE to the sandbox OpenCode server
- Run `ensureRuntimeReady()` (sandbox provisioning)
- Execute gateway-mediated tool callbacks
- Execute sandbox-originated action invocations (server-side)
- Perform migration

Non-owner instances must reject:
- WebSocket connections with a close reason like `"wrong_instance"`
- Sandbox-originated HTTP calls (actions/tools) with a conflict status (e.g. 409)

Reference: new helper module (e.g. `apps/gateway/src/lib/session-leases.ts`)

### Runtime Boot Lock — `Planned`
Short-lived distributed lock to prevent concurrent sandbox provisioning across instances:

- Acquisition: `SET runtime:{sessionId} {instanceId} NX PX 30000`
- Renewal: heartbeat during provisioning
- Release: `DEL runtime:{sessionId}` once runtime is ready

This lock is intentionally separate from the ownership lease: ownership is "hub lifetime," runtime lock is "boot sequence only."

### Deferred vs Immediate Sandbox Mode
Session creation defaults to `"deferred"` — the DB record is written immediately, but sandbox provisioning waits until the first WebSocket client connects. `"immediate"` mode provisions the sandbox during session creation and returns connection info for SSH/CLI/automation flows.
- Key detail agents get wrong: Even in deferred mode, the sandbox is NOT created by the web oRPC route. The gateway hub's `ensureRuntimeReady()` creates it.
- Reference: new session creation service (e.g. `packages/services/src/sessions/session-service.ts:createSession`)

### SSE Bridge
The gateway maintains a persistent SSE connection to OpenCode (`GET /event` on the sandbox tunnel URL). The `SseClient` reads the stream, parses events via `eventsource-parser`, and forwards them to the `EventProcessor`. Disconnections trigger reconnection via the hub.
- Key detail agents get wrong: The SSE connection is unidirectional (sandbox → gateway). Prompts flow via HTTP POST to OpenCode, not via SSE.
- Reference: `apps/gateway/src/hub/sse-client.ts`

### Migration Controller
Handles sandbox expiry by either migrating to a new sandbox (if clients are connected) or snapshotting and stopping (if idle). Uses a distributed lock to prevent concurrent migrations.
- Key detail agents get wrong: vNext uses **two expiry triggers**. An in-process timer on the hub is the primary trigger (precise). A BullMQ job remains as a fallback for sessions whose hubs were evicted.
- Reference: `apps/gateway/src/hub/migration-controller.ts`, `apps/gateway/src/expiry/expiry-queue.ts`

---

## 3. File Tree

```
apps/gateway/src/
├── hub/
│   ├── index.ts                          # Barrel exports
│   ├── hub-manager.ts                    # HubManager — hub registry
│   ├── session-hub.ts                    # SessionHub — per-session runtime + client management
│   ├── session-runtime.ts                # SessionRuntime — sandbox/OpenCode/SSE lifecycle
│   ├── event-processor.ts                # EventProcessor — SSE → ServerMessage translation
│   ├── sse-client.ts                     # SseClient — transport-only SSE reader
│   ├── migration-controller.ts           # MigrationController — expiry/idle migration
│   ├── git-operations.ts                 # GitOperations — stateless git/gh via sandbox exec
│   ├── types.ts                          # PromptOptions, MigrationState, MigrationConfig
│   └── capabilities/tools/
│       ├── index.ts                      # Tool handler registry (invoked via tool callbacks; see ./agent-contract.md)
│       ├── automation-complete.ts        # automation.complete handler
│       ├── save-service-commands.ts      # save_service_commands handler
│       ├── save-snapshot.ts              # save_snapshot handler
│       └── verify.ts                     # verify handler
├── api/
│   ├── internal/
│   │   └── tools.ts                      # POST /internal/tools/:toolName (sandbox callbacks)
│   ├── proliferate/
│   │   ├── http/
│   │   │   ├── index.ts                 # Router aggregation
│   │   │   ├── sessions.ts              # POST /sessions, GET /:sessionId/status
│   │   │   ├── message.ts              # POST /:sessionId/message
│   │   │   ├── cancel.ts               # POST /:sessionId/cancel
│   │   │   ├── info.ts                 # GET /:sessionId (sandbox info)
│   │   │   ├── actions.ts              # Action routes (see actions.md)
│   │   │   └── verification-media.ts   # GET /:sessionId/verification-media
│   │   └── ws/
│   │       └── index.ts                 # WS /proliferate/:sessionId
│   ├── ws-multiplexer.ts                    # WS upgrade routing — first-match handler dispatch
│   └── proxy/
│       ├── opencode.ts                  # /proxy/:sid/:token/opencode passthrough
│       ├── devtools.ts                  # /proxy/:sid/:token/devtools/mcp passthrough
│       ├── terminal.ts                  # /proxy/:sid/:token/devtools/terminal WS proxy
│       └── vscode.ts                    # /proxy/:sid/:token/devtools/vscode HTTP + WS proxy
├── lib/
│   ├── session-creator.ts               # Session creation HTTP wrapper (calls SessionService.create())
│   ├── session-store.ts                 # loadSessionContext() — DB → SessionContext
│   ├── env.ts                           # GatewayEnv config
│   ├── opencode.ts                      # OpenCode HTTP helpers (create session, send prompt, etc.)
│   ├── redis.ts                         # Redis pub/sub for session events
│   ├── s3.ts                            # S3 verification file upload
│   ├── lock.ts                          # Distributed migration lock
│   ├── session-leases.ts                # Redis ownership lease + runtime lock helpers
│   ├── configuration-resolver.ts        # Configuration resolution (see configurations-snapshots.md)
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
└── sessions.ts                          # sessions + sessionConnections tables (adds idempotency_key, tool invocations)

packages/services/src/sessions/
└── session-service.ts                   # SessionService.create() — canonical creation logic
```

---

## 4. Data Models & Schemas

### Database Tables

```sql
sessions
├── id                    UUID PRIMARY KEY
├── organization_id       TEXT NOT NULL (FK → organization)
├── created_by            TEXT (FK → user)
├── configuration_id      UUID (FK → configurations, SET NULL on delete)
├── repo_id               UUID (FK → repos, CASCADE — legacy)
├── session_type           TEXT DEFAULT 'coding'   -- 'setup' | 'coding' | 'cli' | 'terminal' (see note)
├── status                TEXT DEFAULT 'starting'  -- 'pending' | 'starting' | 'running' | 'paused' | 'stopped' | 'failed'
├── sandbox_id            TEXT
├── sandbox_provider      TEXT DEFAULT 'modal'
├── snapshot_id           TEXT
├── branch_name           TEXT
├── base_commit_sha       TEXT
├── client_type           TEXT                     -- 'web' | 'slack' | 'cli' | 'automation'
├── client_metadata       JSONB
├── coding_agent_session_id TEXT
├── open_code_tunnel_url  TEXT
├── preview_tunnel_url    TEXT
├── agent_config          JSONB                    -- { modelId?: string; tools?: string[] }
├── system_prompt         TEXT
├── initial_prompt        TEXT
├── title                 TEXT
├── automation_id         UUID
├── trigger_id            UUID
├── trigger_event_id      UUID
├── parent_session_id     UUID (self-FK)
├── idempotency_key       TEXT                     -- unique per (organization_id, idempotency_key) when not null
├── origin                TEXT DEFAULT 'web'       -- 'web' | 'cli'
├── local_path_hash       TEXT
├── sandbox_expires_at    TIMESTAMPTZ
├── started_at            TIMESTAMPTZ DEFAULT now()
├── last_activity_at      TIMESTAMPTZ DEFAULT now()
├── paused_at             TIMESTAMPTZ
├── ended_at              TIMESTAMPTZ
├── idle_timeout_minutes  INT DEFAULT 30
├── auto_delete_days      INT DEFAULT 7
├── metered_through_at    TIMESTAMPTZ
├── billing_token_version INT DEFAULT 1
├── last_seen_alive_at    TIMESTAMPTZ
├── alive_check_failures  INT DEFAULT 0
├── pause_reason          TEXT
├── stop_reason           TEXT
└── source                TEXT

session_connections
├── id                    UUID PRIMARY KEY
├── session_id            UUID NOT NULL (FK → sessions, CASCADE)
├── integration_id        UUID NOT NULL (FK → integrations, CASCADE)
├── created_at            TIMESTAMPTZ DEFAULT now()
└── UNIQUE(session_id, integration_id)

session_tool_invocations
├── id                    UUID PRIMARY KEY
├── session_id            UUID NOT NULL (FK → sessions, CASCADE)
├── tool_call_id          TEXT NOT NULL            -- OpenCode tool call ID (global unique)
├── tool_name             TEXT NOT NULL
├── params                JSONB
├── status                TEXT NOT NULL            -- 'executing' | 'completed' | 'failed'
├── result                JSONB
├── error                 TEXT
├── created_at            TIMESTAMPTZ DEFAULT now()
└── completed_at          TIMESTAMPTZ
```

Source: `packages/db/src/schema/sessions.ts`

**`session_type` inconsistency:** The gateway creator (`session-creator.ts:42`) defines `SessionType = "coding" | "setup" | "cli"`, but the oRPC CLI route (`cli.ts:431`) writes `"terminal"` and the DB schema comment also says `'terminal'`. Both `"cli"` and `"terminal"` exist in production data for CLI-originated sessions.

### Key Indexes
- `idx_sessions_org` on `organization_id`
- `idx_sessions_idempotency` UNIQUE on `(organization_id, idempotency_key)` where `idempotency_key IS NOT NULL`
- `idx_sessions_repo` on `repo_id`
- `idx_sessions_status` on `status`
- `idx_sessions_parent` on `parent_session_id`
- `idx_sessions_automation` on `automation_id`
- `idx_sessions_trigger` on `trigger_id`
- `idx_sessions_configuration` on `configuration_id`
- `idx_sessions_local_path_hash` on `local_path_hash`
- `idx_sessions_client_type` on `client_type`
- `idx_sessions_sandbox_expires_at` on `sandbox_expires_at`
- `idx_tool_invocations_session` on `session_id`

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
  activeSnapshotId: string | null;
  serviceCommands?: ServiceCommand[];
}

// apps/gateway/src/hub/types.ts
type HubState = "running" | "migrating";

const MigrationConfig = {
  GRACE_MS: 5 * 60 * 1000,              // Start migration 5 min before expiry
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
- **Ownership lease**: a hub must hold a Redis ownership lease (`owner:{sessionId}`) to act as the session owner; renewed by heartbeat while hub is alive.
- **Runtime boot lock**: sandbox provisioning is guarded by a short-lived Redis lock (`runtime:{sessionId}`) with heartbeat renewal during boot.
- **Hub eviction**: hubs are evicted on idle TTL (no connected WS clients) and under a hard cap (LRU) to bound memory usage.
- **Session create idempotency**: idempotency is persisted in PostgreSQL (`sessions.idempotency_key` unique per org), not Redis.
- **Migration lock**: migration is guarded by a heartbeat-renewed Redis lease (`migration:{sessionId}`) and uses a two-phase cutover (old runtime kept alive until new runtime is confirmed).
- **Expiry triggers**: hub schedules an in-process expiry timer (primary) plus a BullMQ job fallback for evicted hubs.
- **Streaming backpressure**: token batching (50-100ms) and slow-consumer disconnect based on `ws.bufferedAmount` thresholds.

### Testing Conventions
- Gateway tests are colocated with source files (e.g., `git-operations.test.ts`, `ws-handler.test.ts`, `actions.test.ts`). No central `__tests__/` directory.
- Mock the `SandboxProvider` interface — never call real Modal/E2B from tests.
- Git operations parsers (`parseStatusV2`, `parseLogOutput`, `parseBusyState`) are exported for unit testing independently of sandbox exec.
- Hub and runtime tests should use `loadSessionContext` stubs to avoid DB dependency.

---

## 6. Subsystem Deep Dives

### 6.1 Session Creation — `Planned`

**What it does:** Creates a session record and establishes session invariants in one place (DB idempotency, session connections, integration validation), with optional immediate sandbox provisioning.

**Canonical entry point:** `SessionService.create()` (new; `packages/services/src/sessions/session-service.ts`).

**Call sites:**
1. Web oRPC session create: calls `SessionService.create({ provisioning: "deferred", clientType: "browser", ... })`.
2. Gateway HTTP `POST /proliferate/sessions`: calls `SessionService.create({ provisioning: "immediate" | "deferred", clientType: "cli" | "browser", ... })`.
3. Automation worker: calls `SessionService.create({ provisioning: "immediate", clientType: "automation", ... })`.

**Idempotency (DB, not Redis):**
1. Caller provides an idempotency key (header or explicit field).
2. `SessionService.create()` inserts the session using a unique index on `(organization_id, idempotency_key)` where the key is non-null.
3. If the insert conflicts, the existing session row is returned and `alreadyExisted: true` is surfaced to callers.

**Session connections + validation:**
1. For each requested integration, create a `session_connections` row.
2. Validate token resolution (`integrations.getToken()` for each) and exclude failing integrations from the session (graceful degradation).

**Provisioning:**
- `"deferred"`: no sandbox work during creation; first hub connection runs `ensureRuntimeReady()`.
- `"immediate"`: create sandbox and OpenCode session as part of creation, returning SSH/tunnel info.

**Files touched:** `packages/services/src/sessions/session-service.ts`, `apps/gateway/src/api/proliferate/http/sessions.ts`, `apps/web/src/server/routers/sessions.ts`

### 6.2 Session Runtime Lifecycle — `Planned`

**What it does:** Lazily provisions sandbox, OpenCode session, and SSE bridge on first client connect.

**Happy path** (`apps/gateway/src/hub/session-runtime.ts:doEnsureRuntimeReady`):
1. Assert this instance holds the session ownership lease (`owner:{sessionId}`); if not, abort and tear down.
2. Acquire the runtime boot lock (`runtime:{sessionId}`) with heartbeat renewal for the duration of provisioning.
3. Wait for migration lock release (`lib/lock.ts:waitForMigrationLockRelease`).
4. Reload `SessionContext` from database (`lib/session-store.ts:loadSessionContext`).
5. Resolve provider, git identity, base snapshot, sandbox-mcp token.
6. Call `provider.ensureSandbox()` — recovers existing or creates new sandbox.
7. Update session DB record with `sandboxId`, `status: "running"`, tunnel URLs.
8. Schedule expiry:
   - In-process timer on the hub (primary)
   - BullMQ job as a fallback (for evicted hubs)
9. Ensure OpenCode session exists (verify stored ID or create new one).
10. Connect SSE to `{tunnelUrl}/event`.
11. Release runtime boot lock.
12. Broadcast `status: "running"` to all WebSocket clients.

**Edge cases:**
- Concurrent `ensureRuntimeReady()` calls coalesce into a single promise (`ensureReadyPromise`) within an instance; the runtime boot lock prevents cross-instance duplication.
- E2B auto-pause: if provider supports auto-pause, `sandboxId` is stored as `snapshotId` for implicit recovery.
- Stored tunnel URLs are used as fallback if provider returns empty values on recovery.

**Files touched:** `apps/gateway/src/hub/session-runtime.ts`, `apps/gateway/src/lib/session-store.ts`

### 6.3 Event Processing Pipeline — `Planned`

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
- Gateway-mediated tools are executed via synchronous sandbox callbacks (`POST /internal/tools/:toolName`) rather than SSE interception. Idempotency is provided by `session_tool_invocations` keyed by `tool_call_id`.
- See `./agent-contract.md` for the tool callback contract and tool schemas.

**Files touched:** `apps/gateway/src/hub/event-processor.ts`, `apps/gateway/src/hub/session-hub.ts`

### 6.4 WebSocket Protocol — `Planned`

**What it does:** Bidirectional real-time communication between browser clients and the gateway.

**Connection**: `WS /proliferate/:sessionId?token=<JWT>` (`apps/gateway/src/api/proliferate/ws/index.ts`).

**Multi-instance behavior:** If the request lands on a non-owner gateway instance, the server must reject the connection (close reason like `"wrong_instance"`) so the client can reconnect and be routed to the correct owner.

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

**Migration backpressure:** When the hub enters `migrating` state, incoming user messages are queued in a bounded in-memory buffer (default max 100) and flushed after cutover. If the buffer is full, new messages are rejected with a clear error.

### 6.5 Session Migration — `Planned`

**What it does:** Handles sandbox expiry and hub eviction safely in a multi-instance gateway by snapshotting and (if needed) booting a replacement sandbox with a two-phase cutover.

**Guards:**
1. Ownership lease: only the session owner may migrate.
2. Migration lock: heartbeat-renewed Redis lease (`migration:{sessionId}`) prevents concurrent migrations.

**Expiry triggers:**
1. Primary: in-process timer on the hub (fires at expiry minus `GRACE_MS`).
2. Fallback: BullMQ job (needed when the hub was evicted before expiry).

**State machine:** `running → migrating → running` (or `paused`/`failed` on terminal outcomes).

**Active migration (WS clients connected):**
1. Acquire migration lock (with heartbeat renewal).
2. Set hub state to `migrating` and broadcast `status: "migrating"`.
3. Queue incoming WS messages in a bounded buffer (default max 100).
4. Best-effort quiescence + snapshot old sandbox (retry with backoff; fall back to last known snapshot when possible).
5. Boot new sandbox from snapshot and verify SSE is connectable.
6. If new boot fails: resume on old sandbox, clear migrating state, and schedule a retry.
7. Cutover: switch SSE to new sandbox, persist new sandbox metadata, then tear down old sandbox.
8. Flush queued WS messages to the new sandbox, set state `running`, release lock.

**Idle migration (no WS clients):**
1. Snapshot sandbox and persist snapshot ID.
2. Pause session, terminate sandbox, and evict hub (memory reclamation); no two-phase cutover required.

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

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `./sandbox-providers.md` | This → Provider | `SandboxProvider.ensureSandbox()`, `.snapshot()`, `.pause()`, `.terminate()` | Runtime calls provider for sandbox lifecycle |
| `./agent-contract.md` | This → Tools | `POST /internal/tools/:toolName` | Gateway-mediated tools are executed via synchronous sandbox callbacks; schemas in agent-contract |
| `automations-runs.md` | Runs → This | `createSyncClient().createSession()` + `.postMessage()` | Worker creates session and posts initial prompt |
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

### Observability
- Structured logging via `@proliferate/logger` with `service: "gateway"` and module-level children (`hub`, `runtime`, `sse-client`, `event-processor`, `migration`, `sessions-route`, `proxy`).
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
- [ ] **Sticky routing recommended** — Ownership leases enforce correctness, but without L7 stickiness sessions may bounce across instances and see `"wrong_instance"` reconnect churn. Impact: latency spikes during reconnect storms. Expected fix: consistent hashing on `sessionId`.
- [ ] **Lease loss is disruptive by design** — If Redis is unavailable and the owner cannot renew, the gateway may tear down its hub to avoid split-brain. Impact: short interruptions; clients reconnect and another instance claims ownership.
- [ ] **Duplicate GitHub token resolution** — Both `session-store.ts:resolveGitHubToken` and `session-creator.ts:resolveGitHubToken` contain near-identical token resolution logic. Impact: code duplication. Expected fix: extract into shared `github-auth.ts` utility.
- [ ] **No WebSocket message persistence** — Messages live only in OpenCode's in-memory session. If OpenCode restarts, message history is lost. Impact: users see empty chat on sandbox recreation. Expected fix: message persistence layer (out of scope for current design).
- [ ] **CORS allows all origins** — `Access-Control-Allow-Origin: *` is permissive. Impact: any domain can make requests if they have a valid token. Expected fix: restrict to known domains in production.
- [ ] **Session status enum not enforced at DB level** — `status` is a `TEXT` column with no CHECK constraint. Impact: invalid states possible via direct DB writes. Expected fix: add DB-level enum or check constraint.
- [ ] **Legacy `repo_id` FK on sessions** — Sessions table still has `repo_id` FK to repos (with CASCADE delete). Repos are now associated via `configuration_repos` junction. Impact: schema inconsistency. Expected fix: drop `repo_id` column after confirming no reads.
