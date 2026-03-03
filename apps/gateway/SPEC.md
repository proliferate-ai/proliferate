# Gateway Specification (Current)

Real-time runtime orchestration service for Proliferate sessions.  
Gateway owns session runtime readiness, WebSocket delivery, proxy surfaces, tool callbacks, and expiry/orphan safety.

## 1) Architecture

```
Client (web/worker/cli)
   ├─ WS /proliferate/:sessionId
   ├─ HTTP /proliferate/*
   └─ HTTP/WS /proxy/*
            │
            ▼
         Gateway
   ├─ SessionHub (per-session coordinator)
   ├─ SessionRuntime (sandbox + harness lifecycle)
   ├─ MigrationController (expiry/idle snapshot logic)
   ├─ BullMQ expiry worker
   └─ Orphan sweeper
            │
            ├─ PostgreSQL via @proliferate/services (session metadata, actions, telemetry)
            ├─ Redis (leases, locks, expiry queue)
            └─ Sandbox provider (Modal/E2B) + OpenCode/manager harness
```

## 2) Boot Sequence

Gateway startup (`src/index.ts`) does the following:

1. Loads env and validates required settings.
2. Connects Redis and initializes shared migration-lock client.
3. Creates server (`src/server.ts`):
	- Express middleware (`cors`, request logger, JSON body parser)
	- HTTP routes
	- WebSocket multiplexer
	- BullMQ expiry worker
	- Orphan sweeper (15m interval)
4. Registers graceful shutdown:
	- Flushes per-hub telemetry
	- Releases owner/runtime leases
	- Closes server

## 3) Runtime Models

Gateway supports two runtime families:

- **Coding sessions (`kind != "manager"`)**
	- Ensure sandbox
	- Ensure OpenCode session
	- Stream daemon events
- **Manager sessions (`kind === "manager"`)**
	- Ensure sandbox
	- Start/resume Claude manager harness
	- No OpenCode SSE session lifecycle

`SessionRuntime.ensureRuntimeReady()` is single-flight and idempotent per hub instance.

## 4) Auth Model

Unified auth middleware supports:

- **User JWT** (`source: "jwt"`)
- **CLI API key** (`source: "cli"`, verified against web internal endpoint)
- **Service JWT** (`source: "service"`)
- **Sandbox HMAC token** (`source: "sandbox"`, derived from `serviceToken + sessionId`)

Rules:

- `/proliferate/*` uses bearer token middleware.
- `/proxy/*` uses path token middleware (`/:sessionId/:token/...`).
- Tool callback routes require `source === "sandbox"`.
- Session mutations derive identity from auth context; client-supplied `userId` is never trusted for user-auth flows.

## 5) Public Routes

### Core HTTP

- `GET /health`
- `POST /proliferate/sessions`
- `GET /proliferate/sessions/:sessionId/status`
- `GET /proliferate/:sessionId/verification-media`
- `POST /proliferate/:sessionId/heartbeat`
- `POST /proliferate/:sessionId/eager-start` (service auth only)
- `GET /proliferate/:sessionId`
- `POST /proliferate/:sessionId/message`
- `POST /proliferate/:sessionId/cancel`
- `POST /proliferate/:sessionId/tools/:toolName`

### Actions Plane (under `/proliferate/:sessionId/actions`)

- `GET /available`
- `GET /guide/:integration`
- `POST /invoke`
- `GET /invocations/:invocationId`
- `POST /invocations/:invocationId/approve`
- `POST /invocations/:invocationId/deny`
- `GET /invocations`

### Source Read Plane (under `/proliferate/:sessionId/source`)

- `GET /bindings`
- `GET /query`
- `GET /get`

### Proxy HTTP

- `ALL /proxy/:sessionId/:token/opencode/*`
- `ALL /proxy/:sessionId/:token/devtools/mcp/*`
- `ALL /proxy/:sessionId/:token/devtools/vscode/*`
- `GET /proxy/:sessionId/:token/health-check?url=...`

### Daemon Proxy HTTP (mounted under `/proliferate`)

- `GET /proliferate/v1/sessions/:sessionId/fs/tree`
- `GET /proliferate/v1/sessions/:sessionId/fs/read`
- `POST /proliferate/v1/sessions/:sessionId/fs/write`
- `GET /proliferate/v1/sessions/:sessionId/pty/replay`
- `POST /proliferate/v1/sessions/:sessionId/pty/write`
- `GET /proliferate/v1/sessions/:sessionId/preview/ports`
- `GET /proliferate/v1/sessions/:sessionId/daemon/health`

### WebSocket

- `WS /proliferate/:sessionId` (primary session protocol)
- `WS /proxy/:sessionId/:token/devtools/terminal`
- `WS /proxy/:sessionId/:token/devtools/vscode/*`

WebSocket upgrades are routed by `WsMultiplexer`.

## 6) Hub and Runtime Responsibilities

### HubManager (`src/hub/hub-manager.ts`)

- In-memory registry for `SessionHub` by session ID
- Coalesces concurrent `getOrCreate` calls
- Loads fresh DB-backed session context before first hub creation
- Best-effort telemetry flush and lifecycle cleanup on shutdown

### SessionHub (`src/hub/session-hub.ts`)

- Manages connected WS clients
- Owns reconnect policy (runtime does not self-reconnect)
- Delegates runtime readiness to `SessionRuntime`
- Handles WS protocol (`prompt`, `cancel`, `get_status`, `get_messages`, git ops, snapshot)
- Tracks proxy connections + active HTTP tool calls for idle heuristics
- Publishes session events and lifecycle projections

### SessionRuntime (`src/hub/session-runtime.ts`)

`ensureRuntimeReady()` pipeline:

1. Wait for migration lock release (unless explicitly skipped by controlled migration path)
2. Reload session context from DB
3. Enforce billing gate for resume/cold start
4. Ensure sandbox via provider abstraction
5. Persist sandbox metadata (`sandboxId`, URLs, expiry)
6. Schedule expiry job (`expiresAt - 5m`)
7. Start manager harness **or** ensure OpenCode session + daemon stream
8. Broadcast runtime status

## 7) Session Creation Flow

`POST /proliferate/sessions`:

- Requires exactly one configuration mode:
	- `configurationId`
	- `managedConfiguration`
	- `cliConfiguration`
- Applies billing gate (`session_start` / `automation_trigger`)
- Uses Redis-backed idempotency envelope (`Idempotency-Key`)
- Calls `createSession(...)` for DB row plus optional immediate sandbox boot
- Returns gateway URL + status + sandbox metadata (if immediate mode)

If a managed configuration is newly created, gateway also starts a setup session and posts an initial setup prompt via HubManager.

## 8) WebSocket Protocol (Primary)

### Client -> Gateway

- `ping`
- `prompt`
- `cancel`
- `get_status`
- `get_messages`
- `save_snapshot`
- `run_auto_start`
- `get_git_status`
- `git_create_branch`
- `git_commit`
- `git_push`
- `git_create_pr`

### Gateway -> Client

- `init`
- `control_plane_snapshot`
- `status`
- `message`
- `token`
- `text_part_complete`
- `tool_start`
- `tool_metadata`
- `tool_end`
- `message_complete`
- `message_cancelled`
- `error`
- `preview_url`
- `snapshot_result`
- `git_status`
- `git_result`
- `auto_start_output`
- `pong`

Automation sessions with terminal outcomes have a no-resume fallback transcript path to avoid unnecessary runtime resurrection.

## 9) Event Processing

`EventProcessor` transforms daemon events to client protocol:

- Filters out events from stale OpenCode session IDs
- Emits assistant message creation lazily
- Streams token deltas (`token`) and completed text parts (`text_part_complete`)
- Emits tool lifecycle events from part updates (`tool_start`, `tool_metadata`, `tool_end`)
- Completes messages on `session.idle` / idle status when no tools are running
- Emits heartbeat status updates for long-running tools with no metadata progress
- Suppresses expected abort-like errors to reduce noisy user-facing failures

## 10) Intercepted Tools via HTTP Callbacks

Sandbox invokes:

- `POST /proliferate/:sessionId/tools/:toolName`

Behavior:

- Sandbox-auth only
- In-memory idempotency by `sessionId + toolName + tool_call_id`
	- dedupes in-flight retries
	- caches completed results for 5 minutes
- Tracks active tool call count on hub to block false idle snapshots
- Dispatches to handlers in `src/hub/capabilities/tools/*`

## 11) Leases, Locks, and Split-Brain Safety

### Redis Leases

- Owner lease: `lease:owner:{sessionId}` (TTL 30s)
- Runtime lease: `lease:runtime:{sessionId}` (TTL 20s)

Hub acquires owner lease before runtime work and renews both leases periodically.  
If renewal lag exceeds owner TTL or ownership is lost, hub self-terminates to avoid split-brain behavior.

### Migration Lock

- Shared lock key via services lock module (`lock:session:{sessionId}:migration`)
- Readiness waits for lock release by default
- Migration/idle/orphan cleanup paths use lock + CAS (`updateWhereSandboxIdMatches`) fencing

## 12) Expiry, Idle Snapshot, and Orphan Recovery

### Expiry Scheduling

- BullMQ delayed job `session-expiry`
- Delay = `expiresAt - now - GRACE_MS` (`GRACE_MS = 5m`)
- Rescheduled on runtime re-ensure

### Expiry Execution

- If effective clients exist: active migration path (snapshot + reinit to new sandbox)
- If no clients: idle pause/snapshot path (pause when supported; otherwise snapshot + terminate)

### Idle Snapshot Trigger

Idle snapshot runs only if all are true:

- non-automation session
- non-manager session
- no WS clients
- no proxy connections
- no active HTTP tool calls
- no running tool states
- sandbox exists
- idle grace elapsed
- agent considered idle (or runtime disconnected in allowed state)

### Orphan Sweeper

- Every 15 minutes, scans DB sessions with status `running`
- If runtime lease missing:
	- delegates to local hub idle snapshot when available, or
	- performs lock-protected direct cleanup (snapshot/pause/terminate + CAS pause update)

## 13) Control Plane Snapshot

Every init payload includes `control_plane_snapshot` with:

- `runtimeStatus`
- `operatorStatus`
- `capabilitiesVersion`
- `visibility`
- `workerId` / `workerRunId`
- `sandboxAvailable`
- `reconnectSequence`
- `emittedAt`

This keeps UI state aligned with latest DB control-plane values, even after reconnects.

## 14) Key Environment Knobs

- `REDIS_URL` (required: leases, locks, expiry queue)
- `GATEWAY_PORT`
- `NEXT_PUBLIC_GATEWAY_URL`
- `NEXT_PUBLIC_API_URL`
- `SERVICE_TO_SERVICE_AUTH_TOKEN`
- `GATEWAY_JWT_SECRET`
- `IDLE_SNAPSHOT_DELAY_SECONDS`
- `LLM_PROXY_REQUIRED`, `LLM_PROXY_URL`
- `ANTHROPIC_API_KEY`

Static runtime constants:

- SSE read timeout: 60s
- Heartbeat timeout: 45s
- Reconnect delays: `[1s, 2s, 5s, 10s, 30s]`

## 15) Source Files (Current Map)

```
src/
├── api/
│   ├── health.ts
│   ├── index.ts
│   ├── ws-multiplexer.ts
│   ├── proliferate/
│   │   ├── ws/
│   │   └── http/
│   │       ├── sessions.ts
│   │       ├── message.ts
│   │       ├── cancel.ts
│   │       ├── info.ts
│   │       ├── heartbeat.ts
│   │       ├── eager-start.ts
│   │       ├── verification-media.ts
│   │       ├── tools.ts
│   │       ├── actions.ts
│   │       └── source.ts
│   └── proxy/
│       ├── opencode.ts
│       ├── daemon.ts
│       ├── devtools.ts
│       ├── terminal.ts
│       ├── vscode.ts
│       └── preview-health.ts
├── hub/
│   ├── hub-manager.ts
│   ├── session-hub.ts
│   ├── session-runtime.ts
│   ├── migration-controller.ts
│   ├── event-processor.ts
│   ├── control-plane.ts
│   ├── session-telemetry.ts
│   ├── session-lifecycle.ts
│   └── capabilities/tools/*
├── expiry/expiry-queue.ts
├── sweeper/orphan-sweeper.ts
├── middleware/{auth,cors,lifecycle,error-handler}.ts
├── lib/{env,session-store,session-creator,session-leases,lock,...}
├── server.ts
├── types.ts
└── index.ts
```

## 16) Known Limitations

- Tool callback idempotency cache is process-local (not shared across pods).
- Connector/action invoke rate limiting is process-local (in-memory).
- Hub registry has no hard LRU cap; cleanup depends on lifecycle eviction paths.
- Some proxy and daemon routes assume preview ingress stability; upstream topology changes require route rewrite updates.
