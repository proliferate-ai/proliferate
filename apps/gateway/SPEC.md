# Gateway Specification

Real-time bridge between Proliferate clients and OpenCode sandboxes.

## Architecture

```
Client ──WebSocket──► Gateway ◄──SSE── Modal Sandbox (OpenCode)
                         │
                         ▼
                     PostgreSQL (session metadata via Drizzle ORM)
```

## Request Flow

1. Client opens WebSocket to `/proliferate/:sessionId`
2. Gateway ensures runtime ready (sandbox + OpenCode session + SSE)
3. Client sends prompts via WebSocket
4. Gateway forwards to OpenCode, streams events back to all clients

## Routes

### HTTP Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/proliferate/sessions` | Create new session (unified API) |
| GET | `/proliferate/:id` | Session info |
| POST | `/proliferate/:id/message` | Send prompt |
| POST | `/proliferate/:id/cancel` | Cancel current prompt |
| ALL | `/proxy/:id/:token/opencode/*` | Proxy to OpenCode HTTP |

### WebSocket

| Path | Description |
|------|-------------|
| `/proliferate/:id` | Real-time client connection (upgrade) |

## Middleware Stack

```
cors → json → auth → ensureSessionReady → route handler → errorHandler
```

- **cors**: CORS headers + OPTIONS preflight
- **auth**: JWT or CLI token verification
- **ensureSessionReady**: Loads hub, ensures runtime ready (sandbox + OpenCode session + SSE)

## Key Components

### SessionHub

Core orchestrator per session. Responsibilities:

- Client WebSocket connection management
- Delegates runtime lifecycle to SessionRuntime
- Message routing between clients and sandbox
- Intercepted tool execution

### SessionRuntime

Owns sandbox lifecycle, OpenCode session lifecycle, and SSE connection.

- Single entry point: `ensureRuntimeReady()` (sandbox + OpenCode session + SSE)
- Reloads session context fresh before lifecycle operations
- Exposes current runtime state (openCodeUrl, sessionId, expiresAt)

### MigrationController

Schedules snapshot-before-expiry and executes migration/termination.

- Runs when runtime is ready
- Enforces the "snapshot at expiresAt - 5 minutes" rule
- Uses a distributed lock to prevent concurrent migrations

### EventProcessor

Transforms OpenCode SSE events into client messages:

- Filters events to current session
- Tracks tool execution state
- Detects and delegates intercepted tools
- Emits message, token, tool_start, tool_end, etc.

### SseClient

Transport-only SSE client:

- Connects and reads SSE stream
- Parses SSE protocol
- Reports disconnects to SessionRuntime/SessionHub
- Reconnection is owned by SessionHub

### HubManager

Factory and cache for SessionHub instances:

- Creates hubs on demand from session store
- Caches active hubs by session ID
- Coalesces concurrent `getOrCreate()` calls per session ID
- Provides `getDb()` for routes needing DB access (Drizzle ORM)

### PrebuildResolver

Handles prebuild resolution for session creation:

- Direct lookup by `prebuildId`
- Managed prebuild find/create (all org repos)
- CLI device-scoped prebuild find/create

### SessionCreator

Creates session records and optionally sandboxes:

- Inserts session record with proper fields
- Handles `immediate` vs `deferred` sandbox modes
- Loads environment variables and secrets
- Resolves GitHub tokens for repos

## Types

Express Request is augmented with:

```typescript
interface Request {
  auth?: AuthResult;        // From auth middleware
  hub?: SessionHub;         // From ensureSessionReady
  proliferateSessionId?: string;
}
```

OpenCode events use discriminated unions for type narrowing:

```typescript
type OpenCodeEvent =
  | { type: "server.connected"; properties: Record<string, unknown> }
  | { type: "message.part.updated"; properties: PartUpdateProperties }
  | { type: "session.idle"; properties: SessionStatusProperties }
  | { type: "session.error"; properties: SessionErrorProperties }
  // ...
```

## Session Creation API

`POST /proliferate/sessions` is the unified endpoint for creating sessions across all client types.

### Request

```typescript
interface CreateSessionRequest {
  organizationId: string;

  // Prebuild resolution (exactly one required)
  prebuildId?: string;                    // Direct prebuild lookup
  managedPrebuild?: { repoIds?: string[] }; // Auto-find/create managed prebuild
  cliPrebuild?: { localPathHash: string; displayName?: string }; // CLI device-scoped

  // Session config
  sessionType: "coding" | "setup" | "cli";
  clientType: "web" | "slack" | "cli" | "automation";
  clientMetadata?: Record<string, unknown>;

  // Options
  sandboxMode?: "immediate" | "deferred"; // Default: "deferred"
  snapshotId?: string;
  initialPrompt?: string;
  title?: string;
  agentConfig?: { modelId?: string };

  // SSH access (can be enabled on any session type)
  sshOptions?: {
    publicKeys: string[];
    cloneInstructions?: CloneInstructions;
    localPath?: string;
    gitToken?: string;
    envVars?: Record<string, string>;
  };
}
```

### Response

```typescript
interface CreateSessionResponse {
  sessionId: string;
  prebuildId: string;
  status: "pending" | "starting" | "running";
  gatewayUrl: string;
  hasSnapshot: boolean;
  isNewPrebuild: boolean;
  sandbox?: {
    sandboxId: string;
    previewUrl: string | null;
    sshHost?: string;
    sshPort?: number;
  };
}
```

### Prebuild Resolution

The endpoint handles three prebuild resolution strategies:

1. **Direct (`prebuildId`)**: Looks up existing prebuild by ID
2. **Managed (`managedPrebuild`)**: Finds or creates org-wide managed prebuild with all repos
3. **CLI (`cliPrebuild`)**: Finds or creates device-scoped prebuild for local directory

### Sandbox Modes

- **`deferred`** (default): Creates session record only; sandbox starts on first WebSocket connect
- **`immediate`**: Creates sandbox immediately and returns sandbox info in response

Sessions with `sshOptions` always use `immediate` mode (SSH connection info must be returned).

### Setup Sessions

When a new managed prebuild is created, the gateway automatically:
1. Creates a setup session with type `"setup"`
2. Uses HubManager to post an initial prompt that kicks off workspace setup

## Intercepted Tools

Tools that the gateway executes server-side instead of the sandbox:

- **save_snapshot**: Creates Modal snapshot, returns snapshot ID
- **verify**: Uploads verification files to S3

Registered at module load in `hub/capabilities/tools/index.ts`.

## File Structure

```
src/
├── api/
│   ├── health.ts                    # Health endpoint
│   ├── index.ts                     # Route mounting
│   ├── proliferate/
│   │   ├── http/                    # HTTP routes
│   │   │   ├── cancel.ts
│   │   │   ├── info.ts
│   │   │   ├── message.ts
│   │   │   └── sessions.ts          # Unified session creation
│   │   └── ws/                      # WebSocket handler
│   └── proxy/
│       └── opencode.ts              # OpenCode HTTP proxy
├── hub/
│   ├── session-hub.ts               # Core hub class
│   ├── hub-manager.ts               # Hub factory/cache
│   ├── session-runtime.ts           # Runtime lifecycle (sandbox + OpenCode + SSE)
│   ├── migration-controller.ts      # Snapshot/migration scheduling
│   ├── event-processor.ts           # Event transformation
│   ├── sse-client.ts                # SSE connection
│   ├── types.ts                     # Hub-specific types
│   └── capabilities/
│       └── tools/                   # Intercepted tools
├── middleware/
│   ├── auth.ts                      # Token verification
│   ├── cors.ts                      # CORS handling
│   ├── error-handler.ts             # Error formatting
│   └── lifecycle.ts                 # Session loading
├── lib/
│   ├── env.ts                       # Environment config
│   ├── opencode.ts                  # OpenCode API client
│   ├── prebuild-resolver.ts         # Prebuild resolution strategies
│   ├── redis.ts                     # Redis pub/sub
│   ├── s3.ts                        # S3 operations
│   ├── session-creator.ts           # Session creation logic
│   └── session-store.ts             # Session persistence
├── server.ts                        # Express app setup
├── types.ts                         # Shared types + Express augmentation
└── index.ts                         # Entry point
```

## Design Principles

1. **No type casts**: Express module augmentation provides typed `req.auth`, `req.hub`
2. **All routes require auth**: Applied at router level, not per-route
3. **All routes require runtime ready**: Use `ensureSessionReady` middleware
4. **Discriminated unions**: OpenCode events narrow on `type` field
5. **One middleware, one job**: CORS, auth, lifecycle are separate
6. **Fire-and-forget where appropriate**: `postCancel()` doesn't await response

## Runtime Readiness

`ensureRuntimeReady()` is the single readiness gate:

- Loads session context fresh
- Ensures sandbox exists (create or recover)
- Ensures OpenCode session exists
- Connects SSE

It is idempotent and serializes concurrent calls.

## Migration & Expiry

### Rule

**Snapshot at `expiresAt - 5 minutes` unless provider auto-pauses idle sandboxes.**

- If clients exist → migrate (create new sandbox from the snapshot)
- If no clients:
  - Pause-capable provider → call `pause()` and skip terminate
  - Otherwise → terminate sandbox after `snapshot()`

For auto-pause providers, `snapshot_id` is set to `sandbox_id` on creation
so paused sandboxes can be resumed later.

### Scheduling

Scheduling is durable via BullMQ delayed jobs:

- When a sandbox is created/recovered, gateway enqueues a delayed job
  for `expiresAt - 5 minutes`.
- `jobId = session_expiry:{sessionId}` to dedupe.
- If `expiresAt` changes, the job is rescheduled.

Redis is required for expiry scheduling and locking; gateway startup requires `REDIS_URL`.

### Migration Lock

Migration uses a distributed lock (Redlock on Redis):

- Lock key: `lock:session:{sessionId}:migration`
- Lock is auto-extended while migration runs
- If lock is held, other gateways must not migrate

### Ready Gate During Migration

While migration is in progress:

- `ensureRuntimeReady()` waits for the migration lock (no timeout)
- No new sandbox can be created until the snapshot is committed
