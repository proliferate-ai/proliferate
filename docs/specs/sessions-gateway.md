# Sessions & Gateway — System Spec

## 1. Scope & Purpose

### In Scope
- Session lifecycle: create, pause, resume, snapshot, delete, rename
- Session state machine and status transitions
- Gateway hub manager, session hub, session runtime
- Event processor (sandbox SSE → client WebSocket)
- SSE bridge to sandbox OpenCode
- WebSocket streaming (client ↔ gateway)
- HTTP message/status/cancel routes
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
- Repo/prebuild config resolution — see `repos-prebuilds.md`
- LLM key generation — see `llm-proxy.md`
- Billing gating for session creation — see `billing-metering.md`

### Mental Model

The gateway is a stateful Express + WebSocket server that bridges web clients and sandbox agents. When a user opens a session, the gateway creates a **hub** — a per-session runtime that owns the sandbox connection (SSE to OpenCode), client connections (WebSocket), and event translation. The hub lazily provisions the sandbox on first client connect, then streams events bidirectionally until the session pauses, migrates, or stops.

Sessions can be created via two different pipelines. The **oRPC path** (`apps/web/src/server/routers/sessions-create.ts`) is lightweight: billing check, agent config, prebuild lookup, snapshot resolution, and a `sessions.createSessionRecord()` call — no idempotency, no session connections, no sandbox provisioning. The **gateway HTTP path** (`POST /proliferate/sessions` via `apps/gateway/src/lib/session-creator.ts`) is the full pipeline: prebuild resolution, idempotency, integration token resolution, session connections, SSH options, and optionally immediate sandbox creation. Both pipelines converge at runtime: the first WebSocket connection triggers `ensureRuntimeReady()`.

**Core entities:**
- **Session** — a DB record tracking sandbox association, status, snapshot, and config. Statuses: `pending`, `starting`, `running`, `paused`, `stopped`, `failed`. Resume is implicit — connecting to a paused session's hub triggers `ensureRuntimeReady()`, which provisions a new sandbox from the stored snapshot.
- **Hub** — gateway-side per-session object (`SessionHub`) managing WebSocket clients, SSE bridge, event processing, and migration. Exists only while the gateway process is alive.
- **Runtime** — inner component of a hub (`SessionRuntime`) owning sandbox provisioning, OpenCode session management, and SSE connection state.
- **Event processor** — translates OpenCode SSE events into client-facing `ServerMessage` payloads. Handles tool interception routing.

**Key invariants:**
- Messages never flow through API routes. All real-time streaming is Client ↔ Gateway ↔ Sandbox.
- `HubManager` deduplicates concurrent `getOrCreate` calls for the same session ID via a pending-promise map.
- `ensureRuntimeReady()` is idempotent — coalesces concurrent callers into a single promise.
- `SessionHub.ensureRuntimeReady()` acquires the cross-pod owner lease before runtime lifecycle work. Non-owner hubs must abort before provisioning.
- Sandbox creation is always delegated to the `SandboxProvider` interface (see `sandbox-providers.md`).

---

## 2. Core Concepts

### Hub Manager
Singleton registry mapping session IDs to `SessionHub` instances. Lazy-creates hubs on first access. `getOrCreate()` deduplicates concurrent requests via a `pending` promise map. A `remove()` method exists but has **no call sites** — hubs persist in-memory for the lifetime of the gateway process.
- Key detail agents get wrong: Hubs are never cleaned up at runtime. Gateway restart is the only thing that clears hub state. Sessions survive because DB + snapshot provide recovery.
- Reference: `apps/gateway/src/hub/hub-manager.ts`

### Deferred vs Immediate Sandbox Mode
Session creation defaults to `"deferred"` — the DB record is written immediately, but sandbox provisioning waits until the first WebSocket client connects. `"immediate"` mode (used for SSH/CLI sessions) creates the sandbox in the creation request and returns connection info.
- Key detail agents get wrong: Even in deferred mode, the sandbox is NOT created by the oRPC route. The gateway hub's `ensureRuntimeReady()` creates it.
- Reference: `apps/gateway/src/lib/session-creator.ts:sandboxMode`

### SSE Bridge
The gateway maintains a persistent SSE connection to OpenCode (`GET /event` on the sandbox tunnel URL). The `SseClient` reads the stream, parses events via `eventsource-parser`, and forwards them to the `EventProcessor`. Disconnections trigger reconnection via the hub.
- Key detail agents get wrong: The SSE connection is unidirectional (sandbox → gateway). Prompts flow via HTTP POST to OpenCode, not via SSE.
- Reference: `apps/gateway/src/hub/sse-client.ts`

### Migration Controller
Handles sandbox expiry by either migrating to a new sandbox (if clients are connected) or snapshotting and stopping (if idle). Uses a distributed lock to prevent concurrent migrations.
- Key detail agents get wrong: Migration does NOT use a timer in the controller itself — expiry is scheduled via a BullMQ job in `expiry-queue.ts`. The controller only runs when triggered.
- Reference: `apps/gateway/src/hub/migration-controller.ts`, `apps/gateway/src/expiry/expiry-queue.ts`

### Session Ownership Leases
Each active hub uses Redis leases to prevent split-brain across gateway pods:
- **Owner lease** (`session:owner:{sessionId}`) — only the owner may run runtime lifecycle work.
- **Runtime lease** (`session:runtime:{sessionId}`) — indicates a live runtime for orphan detection.
- Key detail agents get wrong: owner lease acquisition happens before `runtime.ensureRuntimeReady()`. A hub that cannot acquire ownership must fail fast and avoid sandbox/OpenCode provisioning.
- Reference: `apps/gateway/src/hub/session-hub.ts`, `apps/gateway/src/lib/session-leases.ts`

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
│       ├── index.ts                      # Intercepted tools registry (see agent-contract.md §6.5)
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
│   ├── session-creator.ts               # createSession() — DB + optional sandbox
│   ├── session-store.ts                 # loadSessionContext() — DB → SessionContext
│   ├── env.ts                           # GatewayEnv config
│   ├── opencode.ts                      # OpenCode HTTP helpers (create session, send prompt, etc.)
│   ├── redis.ts                         # Redis pub/sub for session events
│   ├── s3.ts                            # S3 verification file upload
│   ├── lock.ts                          # Distributed migration lock
│   ├── idempotency.ts                   # Redis-based idempotency keys
│   ├── prebuild-resolver.ts             # Prebuild resolution (see repos-prebuilds.md)
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
├── intercepted-tools.ts                 # InterceptedToolHandler interface + framework
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
└── sessions.ts                          # sessions + sessionConnections tables
```

---

## 4. Data Models & Schemas

### Database Tables

```sql
sessions
├── id                    UUID PRIMARY KEY
├── organization_id       TEXT NOT NULL (FK → organization)
├── created_by            TEXT (FK → user)
├── prebuild_id           UUID (FK → prebuilds, SET NULL on delete)
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
```

Source: `packages/db/src/schema/sessions.ts`

**`session_type` inconsistency:** The gateway creator (`session-creator.ts:42`) defines `SessionType = "coding" | "setup" | "cli"`, but the oRPC CLI route (`cli.ts:431`) writes `"terminal"` and the DB schema comment also says `'terminal'`. Both `"cli"` and `"terminal"` exist in production data for CLI-originated sessions.

### Key Indexes
- `idx_sessions_org` on `organization_id`
- `idx_sessions_repo` on `repo_id`
- `idx_sessions_status` on `status`
- `idx_sessions_parent` on `parent_session_id`
- `idx_sessions_automation` on `automation_id`
- `idx_sessions_trigger` on `trigger_id`
- `idx_sessions_prebuild` on `prebuild_id`
- `idx_sessions_local_path_hash` on `local_path_hash`
- `idx_sessions_client_type` on `client_type`
- `idx_sessions_sandbox_expires_at` on `sandbox_expires_at`

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
  serviceCommands?: PrebuildServiceCommand[];
}

// apps/gateway/src/hub/types.ts
type MigrationState = "normal" | "migrating";

const MigrationConfig = {
  GRACE_MS: 5 * 60 * 1000,              // Start migration 5 min before expiry
  CHECK_INTERVAL_MS: 30_000,             // Polling interval (unused — BullMQ now)
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
- **Tool result patching**: `updateToolResult()` retries up to 5× with 1s delay (see `agent-contract.md` §5).
- **Idempotency**: Session creation supports `Idempotency-Key` header with Redis-based deduplication. In-flight TTL guards against stale locks.
- **Migration lock**: Distributed Redis lock with 60s TTL prevents concurrent migrations for the same session.

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
2. Route validates exactly one prebuild option (explicit ID, managed, or CLI) (`apps/gateway/src/api/proliferate/http/sessions.ts:123-134`).
3. `resolvePrebuild()` resolves or creates a prebuild record (`apps/gateway/src/lib/prebuild-resolver.ts`).
4. `createSession()` writes DB record, creates session connections, and optionally creates sandbox (`apps/gateway/src/lib/session-creator.ts:121`).
5. For new managed prebuilds, fires a setup session with auto-generated prompt (`sessions.ts:startSetupSession`).

**Scratch sessions** (no prebuild):
- `prebuildId` is optional in `CreateSessionInputSchema`. When omitted, the oRPC path creates a **scratch session** with `prebuildId: null`, `snapshotId: null`.
- `sessionType: "setup"` is rejected at schema level (via `superRefine`) when `prebuildId` is absent — setup sessions always require a prebuild.
- Gateway `loadSessionContext()` handles `prebuild_id = null` with an early-return path: `repos: []`, synthetic scratch `primaryRepo`, `getScratchSystemPrompt()`, `snapshotHasDeps: false`.

**oRPC path** (`apps/web/src/server/routers/sessions.ts`):
- `create` → calls `createSessionHandler()` (`sessions-create.ts`) which writes a DB record only. This is a **separate, lighter pipeline** than the gateway HTTP route — no idempotency, no session connections, no sandbox provisioning.
- `pause` → loads session, calls `provider.snapshot()` + `provider.terminate()`, finalizes billing, updates DB status to `"paused"` (`sessions-pause.ts`).
- `resume` → no dedicated handler. Resume is implicit: connecting a WebSocket client to a paused session triggers `ensureRuntimeReady()`, which creates a new sandbox from the stored snapshot.
- `delete` → calls `sessions.deleteSession()`.
- `rename` → calls `sessions.renameSession()`.
- `snapshot` → calls `snapshotSessionHandler()` (`sessions-snapshot.ts`).
- `submitEnv` → writes secrets to DB, writes env file to sandbox via provider.

**Files touched:** `apps/gateway/src/api/proliferate/http/sessions.ts`, `apps/gateway/src/lib/session-creator.ts`, `apps/web/src/server/routers/sessions.ts`

### 6.2 Session Runtime Lifecycle — `Implemented`

**What it does:** Lazily provisions sandbox, OpenCode session, and SSE bridge on first client connect.

**SessionHub pre-step** (`apps/gateway/src/hub/session-hub.ts:ensureRuntimeReady`):
1. Acquire/renew owner lease (cross-pod ownership gate).
2. Abort if ownership is unavailable.
3. Then call `runtime.ensureRuntimeReady()`.

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
- Concurrent `ensureRuntimeReady()` calls coalesce into a single promise (`ensureReadyPromise`).
- E2B auto-pause: if provider supports auto-pause, `sandboxId` is stored as `snapshotId` for implicit recovery.
- Stored tunnel URLs are used as fallback if provider returns empty values on recovery.

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

**Intercepted tool flow:**
1. `EventProcessor` detects tool name in `interceptedTools` set.
2. Emits `tool_start` to clients, calls `onInterceptedTool` callback.
3. `SessionHub.handleInterceptedTool()` finds handler, executes server-side.
4. Result patched back to OpenCode via `updateToolResult()`.
5. `tool_end` broadcast to clients.

**Files touched:** `apps/gateway/src/hub/event-processor.ts`, `apps/gateway/src/hub/session-hub.ts`

### 6.4 WebSocket Protocol — `Implemented`

**What it does:** Bidirectional real-time communication between browser clients and the gateway.

**Connection**: `WS /proliferate/:sessionId?token=<JWT>` (`apps/gateway/src/api/proliferate/ws/index.ts`).

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

**Expiry scheduling** (`apps/gateway/src/expiry/expiry-queue.ts`):
- BullMQ queue `"session-expiry"` with per-session jobs.
- Job delay: `max(0, expiresAtMs - now - GRACE_MS)` where `GRACE_MS = 5 min`.
- Worker calls `hub.runExpiryMigration()`.

**Active migration (clients connected):**
1. Acquire distributed lock (60s TTL).
2. Wait for agent message completion (30s timeout), abort if still running.
3. Snapshot current sandbox.
4. Disconnect SSE, reset sandbox state.
5. Call `ensureRuntimeReady()` — creates new sandbox from snapshot.
6. Broadcast `status: "running"`.

**Idle migration (no clients):**
1. Acquire lock, stop OpenCode.
2. Pause (if E2B) or snapshot + terminate (if Modal).
3. Update DB: `status: "paused"` (E2B) or `status: "stopped"` (Modal).
4. Clean up hub state.

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
| `sandbox-providers.md` | This → Provider | `SandboxProvider.ensureSandbox()`, `.snapshot()`, `.pause()`, `.terminate()` | Runtime calls provider for sandbox lifecycle |
| `agent-contract.md` | This → Tools | `getInterceptedToolHandler()` | Hub executes intercepted tools; schemas defined in agent-contract |
| `automations-runs.md` | Runs → This | `createSyncClient().createSession()` + `.postMessage()` | Worker creates session and posts initial prompt |
| `repos-prebuilds.md` | This → Prebuilds | `resolvePrebuild()`, `prebuilds.getPrebuildReposWithDetails()` | Session creator resolves prebuild at creation |
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

- [ ] **Hub state is in-memory only** — Gateway restart loses all hub state. Running sessions must re-establish SSE from scratch on next client connect. Impact: brief reconnection delay. Expected fix: acceptable for single-gateway deployment; multi-gateway would need shared state.
- [ ] **Hub cleanup never runs** — `HubManager.remove()` exists but has no call sites. Hubs accumulate in memory for the process lifetime. Impact: memory growth on long-running gateways. Expected fix: call `remove()` on session termination or idle timeout.
- [ ] **Duplicate GitHub token resolution** — Both `session-store.ts:resolveGitHubToken` and `session-creator.ts:resolveGitHubToken` contain near-identical token resolution logic. Impact: code duplication. Expected fix: extract into shared `github-auth.ts` utility.
- [ ] **No WebSocket message persistence** — Messages live only in OpenCode's in-memory session. If OpenCode restarts, message history is lost. Impact: users see empty chat on sandbox recreation. Expected fix: message persistence layer (out of scope for current design).
- [ ] **CORS allows all origins** — `Access-Control-Allow-Origin: *` is permissive. Impact: any domain can make requests if they have a valid token. Expected fix: restrict to known domains in production.
- [ ] **Session status enum not enforced at DB level** — `status` is a `TEXT` column with no CHECK constraint. Impact: invalid states possible via direct DB writes. Expected fix: add DB-level enum or check constraint.
- [ ] **Legacy `repo_id` FK on sessions** — Sessions table still has `repo_id` FK to repos (with CASCADE delete). Repos are now associated via `prebuild_repos` junction. Impact: schema inconsistency. Expected fix: drop `repo_id` column after confirming no reads.
