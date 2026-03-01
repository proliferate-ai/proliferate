# Architecture Comparison: Proliferate vs background-agents (Open-Inspect)

> **Purpose**: Technical reference for evaluating architectural trade-offs between Proliferate's current design and the patterns used by background-agents. Written for a technical advisor with no codebase access.
>
> **Date**: 2026-02-23

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Project Overviews](#2-project-overviews)
3. [Architecture Overview](#3-architecture-overview)
4. [Session Management: Durable Objects vs Gateway + Redis](#4-session-management-durable-objects-vs-gateway--redis)
5. [Modal Sandbox Implementation](#5-modal-sandbox-implementation)
6. [Commit Attribution & PR Creation](#6-commit-attribution--pr-creation)
7. [OAuth & Integration Architecture](#7-oauth--integration-architecture)
8. [Code Quality Comparison](#8-code-quality-comparison)
9. [Self-Hosting Trade-offs](#9-self-hosting-trade-offs)
10. [Recommendations](#10-recommendations)

---

## 1. Executive Summary

**Proliferate** is a multi-tenant coding agent platform (Next.js + Express Gateway + BullMQ workers + PostgreSQL + Redis, deployed on EKS). It supports persistent dev-environment sessions with Modal/E2B sandboxes, org-based billing, Nango-based OAuth, and a full automation/trigger pipeline.

**background-agents (Open-Inspect)** is a single-tenant background coding agent system built on Cloudflare primitives (Workers + Durable Objects + D1). It uses Modal sandboxes with OpenCode, supports GitHub/Slack/Linear bots, and prioritizes simplicity and zero-idle-cost infrastructure.

Both use **OpenCode** as the agent runtime and **Modal** as the primary sandbox provider. The key differences are in session orchestration, OAuth/integrations, multi-tenancy, and infrastructure philosophy.

---

## 1.5 File Trees

### background-agents (Open-Inspect) — complete source layout

```
packages/
├── control-plane/                    # Cloudflare Worker + Durable Object (core)
│   ├── src/
│   │   ├── index.ts                  # Worker entry point (exports DO class)
│   │   ├── router.ts                 # Main API router (~1124 lines)
│   │   ├── types.ts                  # All type definitions (~388 lines)
│   │   ├── logger.ts                 # Structured logging
│   │   │
│   │   ├── auth/
│   │   │   ├── crypto.ts             # AES-256-GCM encryption, SHA-256 hashing, timing-safe compare
│   │   │   ├── github.ts             # GitHub OAuth: code exchange, token refresh, commit email
│   │   │   ├── github-app.ts         # GitHub App: JWT signing, installation tokens, repo access
│   │   │   ├── internal.ts           # HMAC service-to-service auth (re-exports shared)
│   │   │   └── openai.ts             # OpenAI OAuth token refresh
│   │   │
│   │   ├── session/                  # Session Durable Object internals
│   │   │   ├── durable-object.ts     # SessionDO class (~1890 lines) — the heart of the system
│   │   │   ├── schema.ts             # SQLite schema + 23 migrations (~372 lines)
│   │   │   ├── repository.ts         # All SQL operations (~760 lines)
│   │   │   ├── websocket-manager.ts  # Client + sandbox WebSocket management (~335 lines)
│   │   │   ├── message-queue.ts      # FIFO prompt queue (pending → processing → completed)
│   │   │   ├── sandbox-events.ts     # Sandbox event processing + broadcasting
│   │   │   ├── pull-request-service.ts   # PR creation orchestration (~235 lines)
│   │   │   ├── participant-service.ts    # User management, avatar resolution
│   │   │   ├── presence-service.ts       # Multiplayer presence tracking
│   │   │   ├── callback-notification-service.ts  # Slack/Linear async notifications
│   │   │   ├── event-persistence.ts      # Event upsert + aggregation
│   │   │   ├── openai-token-refresh-service.ts   # ChatGPT OAuth refresh scheduling
│   │   │   └── types.ts                  # Row types (SessionRow, SandboxRow, etc.)
│   │   │
│   │   ├── sandbox/
│   │   │   ├── provider.ts           # SandboxProvider interface + SandboxProviderError (~299 lines)
│   │   │   ├── client.ts             # Modal HTTP client with HMAC auth (~514 lines)
│   │   │   ├── providers/
│   │   │   │   └── modal-provider.ts # Modal implementation of SandboxProvider (~277 lines)
│   │   │   └── lifecycle/
│   │   │       ├── decisions.ts      # Pure decision functions (circuit breaker, spawn, timeout)
│   │   │       └── manager.ts        # Lifecycle orchestration with DI (~810 lines)
│   │   │
│   │   ├── source-control/
│   │   │   ├── types.ts              # SourceControlProvider interface (~285 lines)
│   │   │   ├── errors.ts             # SourceControlProviderError
│   │   │   ├── config.ts             # Provider factory (reads SCM_PROVIDER env)
│   │   │   ├── branch-resolution.ts  # Head branch resolution for PRs
│   │   │   └── providers/
│   │   │       ├── github-provider.ts  # GitHub implementation (~390 lines)
│   │   │       └── types.ts            # GitHub-specific config
│   │   │
│   │   ├── db/                       # D1 (cross-session) data stores
│   │   │   ├── session-index.ts      # Session listing/search
│   │   │   ├── repo-metadata.ts      # Repository metadata cache
│   │   │   ├── repo-secrets.ts       # Encrypted per-repo secrets
│   │   │   ├── global-secrets.ts     # Encrypted global secrets
│   │   │   ├── repo-images.ts        # Pre-built repo image registry
│   │   │   ├── user-scm-tokens.ts    # Encrypted user OAuth tokens (cross-session)
│   │   │   ├── model-preferences.ts  # User model preferences
│   │   │   └── integration-settings.ts
│   │   │
│   │   ├── realtime/
│   │   │   └── events.ts             # Event classification + TokenAggregator
│   │   │
│   │   └── routes/                   # D1-backed REST endpoints (non-session)
│   │       ├── repos.ts
│   │       ├── secrets.ts
│   │       ├── repo-images.ts
│   │       ├── model-preferences.ts
│   │       └── integration-settings.ts
│   │
│   └── test/integration/             # 20+ integration tests against real D1
│       ├── durable-object.test.ts
│       ├── websocket-client.test.ts
│       ├── websocket-sandbox.test.ts
│       ├── create-pr.test.ts
│       ├── session-lifecycle.test.ts
│       └── ...
│
├── modal-infra/                      # Python — Modal sandbox image + runtime
│   ├── deploy.py                     # Modal app deployment
│   ├── src/
│   │   ├── app.py                    # Modal App definition
│   │   ├── functions.py              # Sandbox CRUD endpoints (create, restore, snapshot, warm)
│   │   ├── web_api.py                # FastAPI routes for sandbox operations
│   │   ├── cli.py                    # CLI for manual sandbox operations
│   │   ├── images/
│   │   │   └── base.py               # Base Docker image definition (Node 22, Python 3.12, etc.)
│   │   ├── sandbox/
│   │   │   ├── entrypoint.py         # PID 1 supervisor (~949 lines)
│   │   │   ├── bridge.py             # WebSocket bridge to control plane (~1540 lines)
│   │   │   ├── manager.py            # Sandbox process management
│   │   │   └── types.py              # Python type definitions
│   │   ├── auth/
│   │   │   ├── github_app.py         # GitHub App JWT + installation tokens (Python)
│   │   │   └── internal.py           # HMAC verification (Python)
│   │   ├── registry/
│   │   │   ├── models.py             # Repo image registry models
│   │   │   └── store.py              # Registry persistence
│   │   └── scheduler/
│   │       └── image_builder.py      # Scheduled repo image rebuilds
│   │
│   └── tests/                        # 19 Python test files
│       ├── test_bridge_event_buffer.py
│       ├── test_bridge_reconnection.py
│       ├── test_entrypoint_build_mode.py
│       ├── test_sandbox.py
│       └── ...
│
├── shared/                           # Shared TypeScript utilities
│   └── src/
│       ├── auth.ts                   # HMAC token generation/verification (~104 lines)
│       ├── git.ts                    # Branch name generation
│       ├── models.ts                 # Model definitions
│       ├── index.ts                  # Re-exports
│       └── types/
│           ├── index.ts              # Shared types
│           └── integrations.ts       # Integration types
│
├── web/                              # Next.js web app (Vercel)
│   └── src/
│       ├── app/api/                  # API routes (auth, sessions, repos, secrets)
│       ├── components/               # React components
│       ├── hooks/                    # Custom hooks (use-session-socket, use-repos, etc.)
│       └── lib/                      # Utilities (auth, control-plane client, formatting)
│
├── slack-bot/                        # Cloudflare Worker — Slack integration
│   └── src/
│       ├── index.ts                  # Hono-based worker
│       ├── callbacks.ts              # Session completion notifications
│       └── classifier/               # Repo selection from Slack messages
│
├── github-bot/                       # Cloudflare Worker — GitHub PR review integration
│   └── src/
│       ├── index.ts
│       ├── handlers.ts               # Webhook event handlers
│       └── prompts.ts                # PR review prompts
│
└── linear-bot/                       # Cloudflare Worker — Linear issue integration
    └── src/
        ├── index.ts
        ├── webhook-handler.ts
        └── classifier/               # Repo + plan extraction from Linear issues

terraform/
├── environments/production/          # Production config
├── modules/
│   ├── cloudflare-worker/            # Worker deployment module
│   ├── cloudflare-kv/                # KV namespace setup
│   └── modal-app/                    # Modal app configuration
```

### Proliferate — source layout (abbreviated, key directories expanded)

```
apps/
├── gateway/                          # Express + WebSocket server (session runtime)
│   └── src/
│       ├── server.ts                 # Express app + HTTP server setup
│       ├── index.ts                  # Entry point (env init, server start)
│       ├── types.ts                  # OpenCodeEvent union, ClientConnection, SandboxInfo
│       ├── api/                      # REST routes (health, sessions, tools)
│       ├── hub/
│       │   ├── session-hub.ts        # Core hub class (~1500 lines) — bridges clients + sandbox
│       │   ├── event-processor.ts    # OpenCode SSE → ServerMessage transform (~723 lines)
│       │   ├── hub-manager.ts        # Registry of SessionHub instances
│       │   ├── git-operations.ts     # Git via sandbox execCommand (~763 lines)
│       │   ├── session-runtime.ts    # SSE connection + sandbox boot
│       │   ├── migration-controller.ts   # Sandbox expiry migration (snapshot + recreate)
│       │   ├── session-telemetry.ts      # Tool call / message / PR URL tracking
│       │   ├── snapshot-scrub.ts         # Prepare sandbox for snapshot
│       │   └── types.ts                  # PromptOptions, MigrationState
│       ├── lib/
│       │   ├── opencode.ts           # OpenCode HTTP API (send prompt, fetch messages, abort)
│       │   ├── redis.ts              # Pub/sub for cross-Gateway events
│       │   ├── session-leases.ts     # Redis advisory locks (owner lease, runtime lease)
│       │   ├── session-store.ts      # PostgreSQL session context loading
│       │   ├── git-identity.ts       # Resolve user git identity from session
│       │   └── s3.ts                 # Verification file upload
│       ├── middleware/               # CORS, auth, error handling
│       ├── expiry/                   # Session expiry queue
│       └── sweeper/                  # Orphan session sweeper
│
├── web/                              # Next.js app (UI + API routes)
│   └── src/
│       ├── app/                      # ~70 route files (dashboard, settings, auth, API, etc.)
│       ├── components/               # ~100 component files (coding-session, dashboard, settings, etc.)
│       ├── server/routers/           # ~25 oRPC routers (sessions, repos, integrations, billing, etc.)
│       └── stores/                   # Zustand stores (coding-session, onboarding, help)
│
├── worker/                           # BullMQ background job processor
│   └── src/
│       ├── index.ts                  # Worker entry point (~229 lines) — starts all workers
│       ├── slack/                    # Slack inbound/receiver workers
│       ├── pubsub/                   # Redis pub/sub session subscriber
│       ├── automation/               # Automation pipeline (enrich, execute, outbox, finalizer)
│       ├── billing/                  # Billing enforcement worker
│       ├── configuration-snapshots/  # Snapshot build workers
│       ├── base-snapshots/           # Base image snapshot workers
│       ├── session-title/            # LLM title generation worker
│       └── sweepers/                 # Action expiry sweeper
│
├── trigger-service/                  # Webhook + polling + cron trigger processor
│   └── src/
│       ├── server.ts
│       ├── api/                      # Webhook receiver endpoints
│       ├── polling/                  # GitHub/Linear/PostHog polling
│       └── scheduled/               # Cron-based triggers
│
└── llm-proxy/                        # LiteLLM proxy for model routing + spend tracking

packages/
├── shared/                           # Shared types, contracts, utilities
│   └── src/
│       ├── index.ts                  # Message types, events, tool calls (~972 lines)
│       ├── sandbox-provider.ts       # SandboxProvider interface (~264 lines)
│       ├── connectors.ts             # MCP connector presets (~399 lines)
│       ├── contracts/                # oRPC API contracts (sessions, integrations, etc.)
│       ├── providers/
│       │   ├── modal-libmodal.ts     # Modal JS SDK provider (~1500 lines)
│       │   └── e2b.ts               # E2B provider
│       ├── sandbox/                  # Sandbox config, paths, OpenCode config templates
│       └── opencode-tools/           # Custom tool definitions (verify, save_snapshot, etc.)
│
├── services/                         # Business logic + DB operations
│   └── src/
│       ├── sessions/                 # Session CRUD + telemetry flush
│       │   ├── service.ts            # Business logic (~183 lines)
│       │   └── db.ts                 # Drizzle queries (~805 lines)
│       ├── integrations/
│       │   ├── service.ts            # Integration CRUD + Slack/status (~727 lines)
│       │   ├── tokens.ts             # Token resolution: Nango + GitHub App (~178 lines)
│       │   └── github-app.ts         # GitHub App installation token
│       ├── automations/              # Automation CRUD + run pipeline
│       ├── billing/                  # Autumn billing, credit gating, metering
│       ├── repos/                    # Repo CRUD + prebuild configs
│       ├── secrets/                  # Secret CRUD + encryption
│       ├── notifications/            # Slack notification dispatch
│       └── configurations/           # Configuration management
│
├── db/                               # Drizzle ORM + migrations
│   ├── src/schema/                   # ~15 table definitions (sessions, repos, integrations, etc.)
│   └── drizzle/                      # SQL migrations
│
├── environment/                      # Env var schema + validation
│   └── src/schema.ts                 # All env vars (~230 lines)
│
├── gateway-clients/                  # WebSocket client SDK
├── queue/                            # BullMQ queue definitions + connection config
├── logger/                           # Pino-based structured logging
├── modal-sandbox/                    # Modal image definition (Dockerfile + deploy.py)
├── sandbox-mcp/                      # MCP server for sandbox tools
└── cli/                              # CLI device auth + file sync

infra/
├── pulumi-k8s/                       # EKS Pulumi deployment
├── pulumi-k8s-gcp/                   # GKE Pulumi deployment
└── pulumi/                           # Legacy ECS

charts/proliferate/                   # Helm chart
docs/specs/                           # System specs (13 spec files)
```

---

## 2. Project Overviews

### Proliferate

- **Product**: Multi-tenant AI coding agent platform (SaaS + self-hostable)
- **License**: MIT, fully open source
- **Users**: Multi-org, multi-user with billing, metering, API keys
- **Clients**: Web app (Next.js), CLI, Slack bot
- **Agent**: OpenCode inside Modal/E2B sandboxes
- **Key differentiators**: Persistent sessions, repo/configuration prebuilds, automation pipelines with triggers, MCP connector marketplace, org-level secret management

### background-agents (Open-Inspect)

- **Product**: Single-tenant background coding agent (internal tool, open source)
- **License**: MIT
- **Users**: Single org (all users share one GitHub App installation)
- **Clients**: Web app (Next.js), Slack bot, GitHub bot
- **Agent**: OpenCode inside Modal sandboxes
- **Key differentiators**: Zero-idle-cost (Cloudflare hibernation), fire-and-forget async workflow, multiplayer session viewing, Cloudflare-native (no servers to manage)

---

## 3. Architecture Overview

### Proliferate

```
Web Client (Next.js on Vercel/K8s)
    ↓ HTTP (oRPC)                    ↓ WebSocket
Next.js API Routes              Gateway (Express + ws)
    ↓                                ↓ SSE
PostgreSQL (Drizzle)          Modal/E2B Sandbox (OpenCode)
    ↓
BullMQ Workers (Redis)
    ↓
Background jobs: snapshots, automations, billing, Slack
```

**Infrastructure**: EKS (Kubernetes) via Pulumi + Helm. Always-on pods for Gateway, workers, web. Redis for BullMQ + session leases + pub/sub.

### background-agents

```
Web Client (Next.js on Vercel)  ·  Slack Bot (CF Worker)  ·  GitHub Bot (CF Worker)
                    ↓ HTTP / WebSocket
          Cloudflare Worker (router + auth)
                    ↓ stub.fetch() / WebSocket
          Durable Object (one per session)
              ↓ WebSocket (via Modal sandbox bridge)
          Modal Sandbox (OpenCode + bridge.py)
```

**Infrastructure**: Cloudflare (Workers + Durable Objects + D1 + KV) + Modal + Vercel. Zero always-on servers. Pay-per-request compute.

---

## 4. Session Management: Durable Objects vs Gateway + Redis

This is the most architecturally significant difference between the two systems.

### background-agents: Durable Objects

Each session gets its own Durable Object instance with:
- **In-process SQLite** for all session state (messages, events, artifacts, participants)
- **WebSocket connections** with Cloudflare's hibernation API (zero cost when idle)
- **Built-in alarm system** for timeouts and heartbeat monitoring
- **Automatic persistence** — SQLite is durably stored by Cloudflare

**Key code — SessionDO class** (`packages/control-plane/src/session/durable-object.ts`):

```typescript
export class SessionDO extends DurableObject<Env> {
  private sql: SqlStorage;
  private repository: SessionRepository;
  private initialized = false;
  private log: Logger;

  // All services lazily initialized
  private _wsManager: SessionWebSocketManager | null = null;
  private _lifecycleManager: SandboxLifecycleManager | null = null;
  private _sourceControlProvider: SourceControlProvider | null = null;
  private _participantService: ParticipantService | null = null;
  private _messageQueue: SessionMessageQueue | null = null;
  private _sandboxEventProcessor: SessionSandboxEventProcessor | null = null;

  // Route table for internal API endpoints
  private readonly routes: InternalRoute[] = [
    { method: "POST", path: "/internal/init", handler: (req) => this.handleInit(req) },
    { method: "GET", path: "/internal/state", handler: () => this.handleGetState() },
    { method: "POST", path: "/internal/prompt", handler: (req) => this.handleEnqueuePrompt(req) },
    { method: "POST", path: "/internal/stop", handler: () => this.handleStop() },
    { method: "POST", path: "/internal/create-pr", handler: (req) => this.handleCreatePR(req) },
    { method: "POST", path: "/internal/ws-token", handler: (req) => this.handleGenerateWsToken(req) },
    { method: "POST", path: "/internal/archive", handler: (req) => this.handleArchive(req) },
    // ... more routes
  ];

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.repository = new SessionRepository(this.sql);
    this.log = createLogger("session-do", {}, parseLogLevel(env.LOG_LEVEL));
  }

  // Lifecycle manager created lazily with dependency injection
  private get lifecycleManager(): SandboxLifecycleManager {
    if (!this._lifecycleManager) {
      this._lifecycleManager = this.createLifecycleManager();
    }
    return this._lifecycleManager;
  }
  // ...
}
```

**Key code — SQLite schema** (`packages/control-plane/src/session/schema.ts`):

```typescript
const INITIAL_SCHEMA = `
  CREATE TABLE IF NOT EXISTS session (
    id TEXT PRIMARY KEY,
    session_name TEXT,
    repo_owner TEXT NOT NULL,
    repo_name TEXT NOT NULL,
    branch_name TEXT,
    model TEXT NOT NULL DEFAULT 'claude-sonnet-4-5',
    reasoning_effort TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    archived INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    provider TEXT,
    opencode_session_id TEXT
  );

  CREATE TABLE IF NOT EXISTS participants (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    login TEXT NOT NULL,
    name TEXT,
    email TEXT,
    avatar_url TEXT,
    access_token_encrypted TEXT,
    refresh_token_encrypted TEXT,
    token_expires_at INTEGER,
    token_scope TEXT,
    ws_auth_token_hash TEXT,
    ws_auth_token_created_at INTEGER,
    role TEXT NOT NULL DEFAULT 'member',
    joined_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    author_participant_id TEXT,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    opencode_message_id TEXT,
    created_at INTEGER NOT NULL,
    completed_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    message_id TEXT,
    type TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    url TEXT,
    metadata TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sandbox (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    status TEXT NOT NULL DEFAULT 'pending',
    modal_sandbox_id TEXT,
    modal_object_id TEXT,
    sandbox_auth_token_hash TEXT,
    snapshot_image_id TEXT,
    created_at INTEGER,
    last_activity INTEGER,
    last_heartbeat INTEGER,
    spawn_failure_count INTEGER DEFAULT 0,
    last_spawn_failure INTEGER,
    last_spawn_error TEXT,
    last_spawn_error_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS ws_client_mapping (
    tag TEXT PRIMARY KEY,
    participant_id TEXT NOT NULL
  );
`;
```

**Key code — Lifecycle manager with pure decision functions** (`packages/control-plane/src/sandbox/lifecycle/manager.ts`):

```typescript
/**
 * SandboxLifecycleManager - orchestrates sandbox lifecycle operations.
 *
 * Uses pure decision functions to make decisions (no side effects),
 * then executes side effects through injected dependencies.
 */

// Dependency interfaces (injected, not imported)
export interface SandboxStorage {
  getSandbox(): SandboxRow | null;
  getSandboxWithCircuitBreaker(): SandboxCircuitBreakerInfo | null;
  getSession(): SessionRow | null;
  getUserEnvVars(): Promise<Record<string, string> | undefined>;
  updateSandboxStatus(status: SandboxStatus): void;
  updateSandboxForSpawn(data: { status; createdAt; authTokenHash; modalSandboxId }): void;
  updateSandboxModalObjectId(modalObjectId: string): void;
  updateSandboxSnapshotImageId(sandboxId: string, imageId: string): void;
  incrementCircuitBreakerFailure(timestamp: number): void;
  resetCircuitBreaker(): void;
}

export interface SandboxBroadcaster {
  broadcast(message: object): void;
}

export interface WebSocketManager {
  getSandboxWebSocket(): WebSocket | null;
  closeSandboxWebSocket(code: number, reason: string): void;
  sendToSandbox(message: object): boolean;
  getConnectedClientCount(): number;
}

export interface AlarmScheduler {
  scheduleAlarm(timestamp: number): Promise<void>;
}
```

### Proliferate: Gateway + Redis + PostgreSQL

Each session is managed by a `SessionHub` instance in the Gateway process:
- **In-memory state** in the Gateway (client connections, SSE stream, event processor)
- **Redis** for session leases (owner lease, runtime lease), pub/sub for cross-Gateway events
- **PostgreSQL** for persistent session metadata (via Drizzle ORM)
- **BullMQ** for background jobs (snapshots, automations, billing)

**Key code — SessionHub** (`apps/gateway/src/hub/session-hub.ts`):

```typescript
export class SessionHub {
  private readonly env: GatewayEnv;
  private readonly sessionId: string;
  private readonly logger: Logger;
  private readonly instanceId: string;

  // Client connections (WebSocket)
  private readonly clients = new Map<WebSocket, ClientConnection>();

  // SSE and event processing
  private readonly eventProcessor: EventProcessor;
  private readonly runtime: SessionRuntime;

  // Migration controller (sandbox expiry)
  private readonly migrationController: MigrationController;

  // Reconnection state
  private reconnectAttempt = 0;
  private reconnectTimerId: ReturnType<typeof setTimeout> | null = null;

  // Session leases (Redis-backed)
  private leaseRenewTimer: ReturnType<typeof setInterval> | null = null;
  private ownsOwnerLease = false;

  // Idle snapshot tracking
  private activeHttpToolCalls = 0;
  private idleCheckTimer: ReturnType<typeof setInterval> | null = null;
  private lastActivityAt = Date.now();
  private lastKnownAgentIdleAt: number | null = null;

  // Telemetry (flushed to DB every 30s)
  private readonly telemetry: SessionTelemetry;
  private telemetryFlushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: HubDependencies) {
    this.env = deps.env;
    this.sessionId = deps.sessionId;
    this.instanceId = randomUUID();
    this.logger = createLogger({ service: "gateway" }).child({
      module: "hub",
      sessionId: deps.sessionId,
    });

    this.telemetry = new SessionTelemetry(deps.sessionId);

    this.eventProcessor = new EventProcessor(
      {
        broadcast: (msg) => this.broadcast(msg),
        getOpenCodeSessionId: () => this.runtime.getOpenCodeSessionId(),
        onToolStart: (toolCallId) => this.telemetry.recordToolCall(toolCallId),
        onMessageComplete: () => this.telemetry.recordMessageComplete(),
        onTextPartComplete: (text) => {
          for (const url of extractPrUrls(text)) {
            this.telemetry.recordPrUrl(url);
          }
        },
      },
      this.logger,
    );

    // Debounced telemetry flush (every 30s)
    this.telemetryFlushTimer = setInterval(() => {
      this.flushTelemetry().catch(/* ... */);
    }, 30_000);

    this.runtime = new SessionRuntime({
      env: this.env,
      sessionId: this.sessionId,
      context: deps.context,
      onEvent: (event) => this.handleOpenCodeEvent(event),
      onDisconnect: (reason) => this.handleSseDisconnect(reason),
      onStatus: (status, message) => this.broadcastStatus(status, message),
    });

    this.migrationController = new MigrationController({
      sessionId: this.sessionId,
      runtime: this.runtime,
      eventProcessor: this.eventProcessor,
      broadcast: (message) => this.broadcast(message),
      getClientCount: () => this.getEffectiveClientCount(),
      env: this.env,
      shouldIdleSnapshot: () => this.shouldIdleSnapshot(),
    });
  }
}
```

**Key code — Redis session leases** (`apps/gateway/src/lib/session-leases.ts`):

The Gateway uses Redis-based advisory locks to handle the split-brain problem (multiple Gateway pods competing for the same session):

```
Owner lease: "session:{id}:owner" → gateway instance ID (TTL-based, renewed every ~10s)
Runtime lease: "session:{id}:runtime" → gateway instance ID
```

### Trade-off Analysis

| Dimension | Durable Objects (background-agents) | Gateway + Redis (Proliferate) |
|---|---|---|
| **State locality** | All session state in one place (SQLite in DO) | Split across Gateway memory, Redis, PostgreSQL |
| **Idle cost** | Zero (hibernation API) | Always-on Gateway pods + Redis |
| **WebSocket management** | Built-in with hibernation recovery | Manual with reconnect logic |
| **Cross-session queries** | Requires separate D1 database | PostgreSQL handles both |
| **Horizontal scaling** | Automatic (each DO is independent) | Manual (lease-based coordination between pods) |
| **Timeout/alarm system** | Built-in DO alarm API | setInterval timers in Gateway process |
| **Persistence guarantees** | Automatic (Cloudflare manages) | Explicit (must flush to PostgreSQL) |
| **Vendor lock-in** | Cloudflare only | Runs anywhere (K8s) |
| **Self-hosting** | Cannot self-host without Cloudflare | Can self-host on any K8s cluster |
| **Background jobs** | Built into DO (alarm + message queue) | BullMQ workers (separate process) |
| **Debugging/observability** | Limited (Cloudflare dashboard) | Full control (logs, metrics, dashboards) |
| **Migration complexity** | Moving off Cloudflare = full rewrite | Standard infrastructure, easy to migrate |

---

## 5. Modal Sandbox Implementation

Both projects use Modal as their primary sandbox provider but differ significantly in implementation depth.

### background-agents: Thin TypeScript client + Python bridge

The control plane communicates with Modal via a thin HTTP client. The sandbox runs a Python supervisor (entrypoint.py) and bridge (bridge.py).

**TypeScript Modal client** (`packages/control-plane/src/sandbox/client.ts`):

```typescript
// HMAC-authenticated HTTP client for Modal operations
export class ModalClient {
  async create(config: CreateSandboxConfig): Promise<CreateSandboxResult> {
    // POST to Modal's sandbox API with HMAC auth
  }
  async restore(config: RestoreConfig): Promise<RestoreResult> {
    // Restore from filesystem snapshot
  }
  async snapshot(config: SnapshotConfig): Promise<SnapshotResult> {
    // Take filesystem snapshot
  }
  async warm(config: WarmConfig): Promise<void> {
    // Pre-warm sandbox (triggered when user types)
  }
}
```

**Python bridge** (`packages/modal-infra/src/sandbox/bridge.py`):

```python
class AgentBridge:
    """Bidirectional communication between sandbox and control plane."""

    async def run(self):
        """Main loop: connect to control plane, stream events, handle commands."""
        async with self._connect_ws() as ws:
            await asyncio.gather(
                self._heartbeat_loop(ws),
                self._event_stream_loop(ws),
                self._command_handler(ws),
            )

    async def _event_stream_loop(self, ws):
        """Stream OpenCode SSE events to control plane via WebSocket."""
        async for event in self._opencode_sse():
            await ws.send(json.dumps({
                "type": "sandbox_event",
                "event": event,
            }))

    async def _command_handler(self, ws):
        """Handle commands from control plane (prompt, stop, snapshot)."""
        async for message in ws:
            cmd = json.loads(message)
            if cmd["type"] == "prompt":
                # Configure git identity for this specific prompt author
                await self._configure_git_identity(cmd.get("git_user"))
                await self._send_prompt_to_opencode(cmd["content"])
            elif cmd["type"] == "stop":
                await self._abort_opencode()
            elif cmd["type"] == "push":
                await self._git_push(cmd)
```

**Key design**: The bridge runs *inside* the sandbox and connects *outward* to the control plane via WebSocket. This means the control plane doesn't need to know the sandbox's IP — the sandbox initiates the connection.

### Proliferate: Direct Modal SDK + SSE

Proliferate uses the Modal JavaScript SDK directly (no Python intermediary for control). The Gateway connects to OpenCode inside the sandbox via SSE.

**Modal provider** (`packages/shared/src/providers/modal-libmodal.ts`):

```typescript
export class ModalLibmodalProvider implements SandboxProvider {
  private client: ModalClient;
  private _cachedApp: App | null = null;

  async createSandbox(opts: CreateSandboxOpts): Promise<CreateSandboxResult> {
    const image = await this.resolveImage(opts);
    const sandbox = await Sandbox.create(this.client, {
      app: await this.getApp(),
      image,
      timeout: SANDBOX_TIMEOUT_SECONDS,
      encrypted_ports: [SANDBOX_PORTS.opencode, SANDBOX_PORTS.caddy],
      cpu: 2,
      memory: 2048,
      cloud: "aws",
    });

    // Setup is done IN-PROCESS via the Modal SDK:
    await this.setupSandbox(sandbox, opts);
    await this.setupEssentialDependencies(sandbox, opts);
    await this.setupAdditionalDependencies(sandbox, opts);

    return { sandboxId: sandbox.sandboxId, tunnelUrls };
  }

  // 3-layer image resolution: restore snapshot > base snapshot > base image
  private async resolveImage(opts: CreateSandboxOpts): Promise<Image> {
    if (opts.snapshotId) {
      return Image.fromId(this.client, opts.snapshotId);
    }
    if (MODAL_BASE_SNAPSHOT_ID) {
      return Image.fromId(this.client, MODAL_BASE_SNAPSHOT_ID);
    }
    return await this.getBaseImage();
  }

  // Direct file writes into sandbox via Modal SDK
  async setupEssentialDependencies(sandbox: Sandbox, opts: CreateSandboxOpts) {
    // Write plugin, tools, config, instructions — all in parallel
    await Promise.all([
      this.writeFile(sandbox, SANDBOX_PATHS.plugin, PLUGIN_MJS),
      this.writeFile(sandbox, SANDBOX_PATHS.opencodeConfig, getOpencodeConfig(opts)),
      this.writeFile(sandbox, SANDBOX_PATHS.instructions, opts.instructions),
      // ... SSH keys, env files, etc.
    ]);

    // Start OpenCode server
    await sandbox.exec("opencode", ["server", "--port", String(SANDBOX_PORTS.opencode)]);
    await waitForOpenCodeReady(sandbox, SANDBOX_PORTS.opencode);
  }
}
```

**Key design differences**:

| Aspect | background-agents | Proliferate |
|---|---|---|
| **SDK** | HTTP calls to Modal API | Modal JS SDK (libmodal) directly |
| **Sandbox communication** | WebSocket (bridge.py inside sandbox connects out) | SSE (Gateway connects to OpenCode's SSE endpoint) |
| **Setup** | Python supervisor runs git clone, starts OpenCode | TypeScript provider writes files via SDK, starts OpenCode |
| **Connection direction** | Sandbox → Control plane (outbound WS) | Gateway → Sandbox (inbound SSE via tunnel) |
| **Git operations** | Python bridge handles git push/identity | TypeScript GitOperations class via execCommand |
| **Memory snapshots** | Not supported | Supported (gRPC middleware hack for protobuf field injection) |

### Proliferate's `execCommand` pattern

Proliferate executes git operations by running commands inside the sandbox:

```typescript
export class GitOperations {
  constructor(
    private provider: SandboxProvider,
    private sandboxId: string,
    private gitIdentity: GitIdentity | null = null,
    private repos: RepoSpec[] = [],
  ) {}

  private async exec(
    argv: string[],
    opts?: { cwd?: string; timeoutMs?: number; env?: Record<string, string> },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return this.provider.execCommand(this.sandboxId, argv, opts);
  }

  async getStatus(workspacePath?: string): Promise<GitState> {
    const gitDir = this.resolveGitDir(workspacePath);
    const [statusResult, logResult] = await Promise.all([
      this.exec(
        ["git", "status", "--porcelain=v2", "--branch", "-z"],
        { cwd: gitDir, env: GIT_READONLY_ENV, timeoutMs: 15_000 },
      ),
      this.exec(
        ["git", "log", "--oneline", "-20", "--format=%H %s"],
        { cwd: gitDir, env: GIT_READONLY_ENV, timeoutMs: 10_000 },
      ),
    ]);
    return this.parseStatusV2(statusResult.stdout, logResult.stdout);
  }

  async push(workspacePath?: string): Promise<GitActionResult> {
    const gitDir = this.resolveGitDir(workspacePath);
    const authEnv = this.getAuthEnv(workspacePath);
    await this.refreshGitCredentialsFile();

    const result = await this.exec(
      ["git", "push", "-u", "origin", "HEAD"],
      { cwd: gitDir, env: { ...this.getMutableEnv(), ...authEnv }, timeoutMs: 60_000 },
    );
    // Parse result, handle shallow clone deepening, etc.
  }

  async createPr(title: string, body: string, workspacePath?: string): Promise<GitActionResult> {
    // Push first, then use `gh pr create`
    const pushResult = await this.push(workspacePath);
    if (!pushResult.success) return pushResult;

    const result = await this.exec(
      ["gh", "pr", "create", "--title", title, "--body", body, "--fill"],
      { cwd: gitDir, env: { ...this.getMutableEnv(), ...authEnv }, timeoutMs: 30_000 },
    );
    // Parse PR URL from output
  }
}
```

### background-agents' bridge.py approach

The bridge runs inside the sandbox and handles git identity per prompt:

```python
async def _configure_git_identity(self, git_user: GitUser | None):
    """Configure git identity for this specific prompt's author."""
    if not git_user:
        return

    name = git_user.get("name") or git_user.get("login", "Unknown")
    email = git_user.get("email") or f'{git_user.get("id", 0)}+{git_user.get("login", "unknown")}@users.noreply.github.com'

    await asyncio.gather(
        self._run_cmd(["git", "config", "--global", "user.name", name]),
        self._run_cmd(["git", "config", "--global", "user.email", email]),
    )

async def _handle_push_command(self, cmd: dict):
    """Push branch to remote using GitHub App token."""
    push_spec = cmd["push_spec"]
    remote_url = push_spec["remote_url"]
    refspec = push_spec["refspec"]
    force = push_spec.get("force", False)

    args = ["git", "push", remote_url, refspec]
    if force:
        args.insert(2, "--force")

    result = await self._run_cmd(args, cwd=self.repo_dir, timeout=120)
    # Report success/failure back to control plane via WebSocket
```

---

## 6. Commit Attribution & PR Creation

Both projects solve the same problem: making git commits and PRs appear as authored by the human user, not a bot.

### background-agents approach

1. **Git identity set per-prompt**: When a user sends a prompt, their GitHub identity (name, email) is sent along with it. The bridge configures `git config user.name/email` before the agent starts working.

2. **PR creation with user's OAuth token**: The control plane uses the user's encrypted OAuth token to call the GitHub API. If unavailable, falls back to the GitHub App token.

**PR Service** (`packages/control-plane/src/session/pull-request-service.ts`):

```typescript
export class SessionPullRequestService {
  async createPullRequest(input: CreatePullRequestInput): Promise<CreatePullRequestResult> {
    // 1. Generate push auth from GitHub App (for pushing the branch)
    const pushAuth = await this.deps.sourceControlProvider.generatePushAuth();

    // 2. Get repo info (default branch, etc.)
    const appAuth: SourceControlAuthContext = { authType: "app", token: pushAuth.token };
    const repoInfo = await this.deps.sourceControlProvider.getRepository(appAuth, {
      owner: session.repo_owner,
      name: session.repo_name,
    });

    // 3. Push branch using App token
    const pushSpec = this.deps.sourceControlProvider.buildGitPushSpec({
      owner: session.repo_owner,
      name: session.repo_name,
      sourceRef: "HEAD",
      targetBranch: headBranch,
      auth: pushAuth,
      force: true,
    });
    await this.deps.pushBranchToRemote(headBranch, pushSpec);

    // 4. Create PR with USER's OAuth token (falls back to App token)
    const prAuth = input.promptingAuth ?? appAuth;
    const prResult = await this.deps.sourceControlProvider.createPullRequest(prAuth, {
      repository: repoInfo,
      title: input.title,
      body: fullBody,
      sourceBranch: headBranch,
      targetBranch: baseBranch,
    });
    // PR appears as created by the USER, not the bot
  }
}
```

**GitHub provider** (`packages/control-plane/src/source-control/providers/github-provider.ts`):

```typescript
export class GitHubSourceControlProvider implements SourceControlProvider {
  readonly name = "github";

  async createPullRequest(
    auth: SourceControlAuthContext,
    config: CreatePullRequestConfig,
  ): Promise<CreatePullRequestResult> {
    const response = await fetchWithTimeout(
      `${GITHUB_API_BASE}/repos/${config.repository.owner}/${config.repository.name}/pulls`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.token}`,  // user token or app token
          "User-Agent": USER_AGENT,
        },
        body: JSON.stringify({
          title: config.title,
          body: config.body,
          head: config.sourceBranch,
          base: config.targetBranch,
        }),
      },
    );
    // Best-effort: add labels, request reviewers
  }

  async generatePushAuth(): Promise<GitPushAuthContext> {
    // Uses GitHub App installation token for git push
    const token = await getCachedInstallationToken(this.appConfig);
    return { authType: "app", token };
  }

  buildGitPushSpec(config: BuildGitPushSpecConfig): GitPushSpec {
    const remoteUrl = `https://x-access-token:${config.auth.token}@github.com/${config.owner}/${config.name}.git`;
    return {
      remoteUrl,
      redactedRemoteUrl: `https://x-access-token:<redacted>@github.com/...`,
      refspec: `${config.sourceRef}:refs/heads/${config.targetBranch}`,
      targetBranch: config.targetBranch,
      force: config.force ?? false,
    };
  }
}
```

### Proliferate approach

1. **Git identity set at session level**: When a session is created, the user's identity is configured globally in the sandbox.

2. **PR creation via `gh` CLI**: The Gateway's `GitOperations` class runs `gh pr create` inside the sandbox with the user's GitHub token in the environment.

```typescript
// From apps/gateway/src/hub/git-operations.ts
async createPr(title: string, body: string, workspacePath?: string): Promise<GitActionResult> {
  // Push first
  const pushResult = await this.push(workspacePath);
  if (!pushResult.success) return pushResult;

  // Create PR via gh CLI inside sandbox
  const result = await this.exec(
    ["gh", "pr", "create", "--title", title, "--body", body, "--fill"],
    { cwd: gitDir, env: { ...this.getMutableEnv(), ...this.getAuthEnv(workspacePath) } },
  );
}
```

### Comparison

| Aspect | background-agents | Proliferate |
|---|---|---|
| **Git identity** | Per-prompt (changes per user in multiplayer) | Per-session (set at creation) |
| **PR creation** | Direct GitHub API call from control plane | `gh pr create` CLI inside sandbox |
| **Push auth** | GitHub App installation token | User's integration token (Nango/GitHub App) |
| **PR auth** | User OAuth → App fallback | User token via `GH_TOKEN` env var |
| **Labels/reviewers** | Best-effort via API after creation | Via `gh` CLI flags |
| **Source control abstraction** | Full interface (GitHub, future Bitbucket/GitLab) | Implicit (GitHub-only via `gh` CLI) |

**Notable**: background-agents has a proper `SourceControlProvider` interface that could support Bitbucket, GitLab, etc. Proliferate's approach is GitHub-specific since it relies on `gh` CLI.

---

## 7. OAuth & Integration Architecture

### background-agents: Self-hosted GitHub OAuth only

Single integration: GitHub. All OAuth is self-managed.

**GitHub auth** (`packages/control-plane/src/auth/github.ts`):

```typescript
// Full self-hosted OAuth flow
export async function exchangeCodeForToken(
  code: string,
  config: GitHubOAuthConfig,
): Promise<GitHubTokenResponse> {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
    }),
  });
  return response.json();
}

export async function refreshAccessToken(
  refreshToken: string,
  config: GitHubOAuthConfig,
): Promise<GitHubTokenResponse> {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  return response.json();
}

// Auto-refresh with 5-minute buffer
export async function getValidAccessToken(
  stored: StoredGitHubToken,
  config: GitHubOAuthConfig,
): Promise<{ accessToken: string; refreshed: boolean; newStored?: StoredGitHubToken }> {
  const bufferMs = 5 * 60 * 1000;
  if (stored.expiresAt && stored.expiresAt - Date.now() < bufferMs) {
    if (!stored.refreshTokenEncrypted) {
      throw new Error("Token expired and no refresh token available");
    }
    const refreshToken = await decryptToken(stored.refreshTokenEncrypted, config.encryptionKey);
    const newTokens = await refreshAccessToken(refreshToken, config);
    const newStored = await encryptGitHubTokens(newTokens, config.encryptionKey);
    return { accessToken: newTokens.access_token, refreshed: true, newStored };
  }
  const accessToken = await decryptToken(stored.accessTokenEncrypted, config.encryptionKey);
  return { accessToken, refreshed: false };
}
```

**Token encryption** (`packages/control-plane/src/auth/crypto.ts`):

```typescript
// AES-256-GCM encryption for tokens at rest
const ALGORITHM = "AES-GCM";
const IV_LENGTH = 12;

export async function encryptToken(token: string, encryptionKey: string): Promise<string> {
  const key = await getEncryptionKey(encryptionKey);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(token);
  const ciphertext = await crypto.subtle.encrypt({ name: ALGORITHM, iv }, key, encoded);
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

export async function decryptToken(encrypted: string, encryptionKey: string): Promise<string> {
  const key = await getEncryptionKey(encryptionKey);
  const combined = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);
  const decrypted = await crypto.subtle.decrypt({ name: ALGORITHM, iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}
```

**HMAC service-to-service auth** (`packages/shared/src/auth.ts`):

```typescript
// Time-based HMAC-SHA256 tokens for inter-service calls
const TOKEN_VALIDITY_MS = 5 * 60 * 1000;

export async function generateInternalToken(secret: string): Promise<string> {
  const timestamp = Date.now().toString();
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(timestamp));
  const signatureHex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${timestamp}.${signatureHex}`;
}

export async function verifyInternalToken(authHeader: string | null, secret: string): Promise<boolean> {
  if (!authHeader?.startsWith("Bearer ")) return false;
  const [timestamp, signature] = authHeader.slice(7).split(".");
  if (!timestamp || !signature) return false;
  // Reject tokens outside 5-minute window
  if (Math.abs(Date.now() - parseInt(timestamp)) > TOKEN_VALIDITY_MS) return false;
  // Verify HMAC signature with timing-safe comparison
  const expectedHex = /* recompute HMAC */;
  return timingSafeEqual(signature, expectedHex);
}
```

### Proliferate: Nango + GitHub App + Slack

Multiple integrations managed through Nango (third-party OAuth service) plus native GitHub App and Slack integrations.

**Token resolution** (`packages/services/src/integrations/tokens.ts`):

```typescript
import { Nango } from "@nangohq/node";

// Dual provider support: GitHub App native + Nango for everything else
export async function getToken(integration: IntegrationForToken): Promise<string> {
  // GitHub App -> installation token (native)
  if (integration.provider === "github-app" && integration.githubInstallationId) {
    return getInstallationToken(integration.githubInstallationId);
  }

  // Nango -> OAuth token from Nango API (Linear, Sentry, GitHub OAuth, Jira, etc.)
  if (integration.provider === "nango" && integration.connectionId) {
    const nango = getNango();
    const connection = await nango.getConnection(
      integration.integrationId,
      integration.connectionId,
    );
    const credentials = connection.credentials as { access_token?: string };
    if (!credentials.access_token) {
      throw new Error(`No access token available for integration ${integration.integrationId}`);
    }
    return credentials.access_token;
  }

  throw new Error(`Unsupported provider ${integration.provider}`);
}

// Parallel resolution with partial success
export async function resolveTokens(
  integrations: IntegrationForToken[],
): Promise<ResolveTokensResult> {
  const tokens: TokenResult[] = [];
  const errors: TokenError[] = [];
  await Promise.allSettled(
    integrations.map(async (integration) => {
      try {
        const token = await getToken(integration);
        tokens.push({ integrationId: integration.id, integrationTypeId: integration.integrationId, token });
      } catch (err) {
        errors.push({ integrationId: integration.id, message: err.message });
      }
    }),
  );
  return { tokens, errors };
}
```

### Comparison

| Aspect | background-agents | Proliferate |
|---|---|---|
| **OAuth approach** | Self-hosted (GitHub only) | Nango (managed service) + native GitHub App |
| **Providers supported** | GitHub | GitHub, Linear, Sentry, Jira, Slack |
| **Token storage** | AES-256-GCM encrypted in DO SQLite | Nango manages tokens; GitHub App tokens generated on demand |
| **Token refresh** | Self-managed with 5-minute buffer | Nango handles automatically |
| **Self-hosting burden** | Register one GitHub OAuth App | Register GitHub App + deploy Nango (or use cloud) |
| **Security model** | Full control of encrypted tokens | Trust Nango with token storage |
| **Extensibility** | Add provider = write code | Add provider = configure Nango integration |

---

## 8. Code Quality Comparison

### background-agents

**Strengths:**

1. **Pure decision functions**: The lifecycle manager separates decisions from side effects. Decisions are pure functions that take state and return actions; the manager executes those actions. This is highly testable.

```typescript
// Pure function: evaluates circuit breaker state, returns decision
export function evaluateCircuitBreaker(info: SandboxCircuitBreakerInfo, config: CircuitBreakerConfig):
  | { action: "allow" }
  | { action: "block"; reason: string } {
  if (info.spawn_failure_count >= config.maxFailures) {
    const cooldownEnd = (info.last_spawn_failure ?? 0) + config.cooldownMs;
    if (Date.now() < cooldownEnd) {
      return { action: "block", reason: "Circuit breaker open" };
    }
  }
  return { action: "allow" };
}
```

2. **Dependency injection throughout**: The `SessionDO` injects storage, broadcaster, WebSocket manager, alarm scheduler into the lifecycle manager. No global imports for side-effectful operations.

3. **Strong error classification**: `SandboxProviderError` distinguishes transient (network) from permanent (config) errors. Circuit breaker only counts permanent failures.

```typescript
export class SandboxProviderError extends Error {
  constructor(message: string, public readonly errorType: "transient" | "permanent", public readonly cause?: Error) {
    super(message);
  }
  static isTransientStatus(status: number): boolean {
    return status === 502 || status === 503 || status === 504;
  }
  static isTransientNetworkError(error: unknown): boolean {
    const message = (error as Error).message?.toLowerCase() ?? "";
    return message.includes("fetch failed") || message.includes("etimedout") || /* ... */;
  }
}
```

4. **Timing-safe comparisons**: Token verification uses constant-time comparison.

5. **Structured logging with context**: Per-session loggers with structured fields.

**Weaknesses:**

1. **Magic numbers**: Timeouts scattered across files (30s WS auth, 5min execution, 24h token TTL) without centralized configuration.
2. **11-state sandbox state machine** without formal transition guards.
3. **~67 tests for ~62k LOC** — critical paths covered but gaps in WebSocket hibernation recovery and snapshot restore.
4. **`console.warn` in production code** (label/reviewer best-effort operations in GitHub provider).

### Proliferate

**Strengths:**

1. **Structured logging everywhere**: `@proliferate/logger` (Pino-based) with injectable pattern for library packages. Consistent `logger.child({ sessionId })` context propagation.

2. **Robust git operations**: The `GitOperations` class handles edge cases like shallow clone deepening, index lock detection (busy state), multi-remote credential injection, conflict detection — more battle-tested than background-agents' git handling.

3. **Provider abstraction**: `SandboxProvider` interface supports multiple providers (Modal, E2B) with feature detection (`execCommand`, `memorySnapshot`, etc.).

4. **Telemetry pipeline**: 30-second debounced flush to PostgreSQL, tracking tool calls, messages, active seconds, PR URLs, latest task.

5. **Comprehensive type system**: Rich discriminated unions for all message types (25+ server message variants, 12+ client message variants).

**Weaknesses:**

1. **Split-brain complexity**: Redis lease management with renewal timers, generations, and coordination across Gateway pods is significantly more complex than DO's automatic isolation.

2. **Nango dependency**: Token management is outsourced. If Nango has issues, integrations break. Self-hosters must also deploy Nango.

3. **No source control abstraction**: Git operations are GitHub-specific (`gh` CLI). Adding GitLab/Bitbucket would require significant refactoring.

4. **In-memory state risk**: The Gateway holds session state in memory. If the process crashes, state is lost until reconstructed from PostgreSQL + sandbox.

### Detailed code patterns

#### background-agents: Pure decision functions (no side effects)

The lifecycle manager separates *decisions* from *execution*. Decision functions are pure — they take state, return actions, and have zero side effects. This makes them trivially unit-testable.

```typescript
// packages/control-plane/src/sandbox/lifecycle/decisions.ts

// ==================== Circuit Breaker ====================

export interface CircuitBreakerState {
  failureCount: number;
  lastFailureTime: number;
}

export interface CircuitBreakerConfig {
  threshold: number;      // failures before circuit opens (default: 3)
  windowMs: number;       // reset window (default: 5 minutes)
}

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  threshold: 3,
  windowMs: 5 * 60 * 1000,
};

export interface CircuitBreakerDecision {
  shouldProceed: boolean;
  shouldReset: boolean;
  waitTimeMs?: number;
}

export function evaluateCircuitBreaker(
  state: CircuitBreakerState,
  config: CircuitBreakerConfig,
  now: number
): CircuitBreakerDecision {
  const timeSinceLastFailure = now - state.lastFailureTime;

  // Window passed — reset failures
  if (state.failureCount > 0 && timeSinceLastFailure >= config.windowMs) {
    return { shouldProceed: true, shouldReset: true };
  }

  // Circuit open — too many failures within window
  if (state.failureCount >= config.threshold && timeSinceLastFailure < config.windowMs) {
    return {
      shouldProceed: false,
      shouldReset: false,
      waitTimeMs: config.windowMs - timeSinceLastFailure,
    };
  }

  // Circuit closed — proceed
  return { shouldProceed: true, shouldReset: false };
}

// ==================== Spawn Decision ====================

export interface SandboxState {
  status: SandboxStatus;
  createdAt: number;
  snapshotImageId: string | null;
  hasActiveWebSocket: boolean;
}

export type SpawnAction =
  | { action: "spawn" }
  | { action: "restore"; snapshotImageId: string }
  | { action: "skip"; reason: string };

export function evaluateSpawnDecision(
  state: SandboxState,
  config: SpawnConfig,
  now: number
): SpawnAction {
  // Already running or connecting
  if (["spawning", "connecting", "warming", "syncing", "ready", "running"].includes(state.status)) {
    if (state.hasActiveWebSocket) {
      return { action: "skip", reason: `Sandbox is ${state.status} with active connection` };
    }
    // Spawning but no WS yet — check if we should wait
    if (state.status === "spawning" && now - state.createdAt < config.readyWaitMs) {
      return { action: "skip", reason: "Sandbox spawning, waiting for connection" };
    }
  }

  // Has snapshot → restore
  if (state.snapshotImageId) {
    return { action: "restore", snapshotImageId: state.snapshotImageId };
  }

  // Fresh spawn
  return { action: "spawn" };
}

// ==================== Inactivity Timeout ====================

export function evaluateInactivityTimeout(
  lastActivity: number,
  config: InactivityConfig,
  now: number
): { shouldTimeout: boolean; idleMs: number } {
  const idleMs = now - lastActivity;
  return {
    shouldTimeout: idleMs >= config.timeoutMs,
    idleMs,
  };
}
```

#### background-agents: Repository pattern (synchronous SQLite)

All SQL is encapsulated in the repository class. Note: reads are **synchronous** because Durable Object SQLite is in-process.

```typescript
// packages/control-plane/src/session/repository.ts (key methods)

export class SessionRepository {
  constructor(private readonly sql: SqlStorage) {}

  getSession(): SessionRow | null {
    return this.sql.exec("SELECT * FROM session LIMIT 1").one() as SessionRow | null;
  }

  getSandbox(): SandboxRow | null {
    return this.sql.exec("SELECT * FROM sandbox WHERE id = 1").one() as SandboxRow | null;
  }

  updateSandboxStatus(status: SandboxStatus): void {
    this.sql.exec("UPDATE sandbox SET status = ? WHERE id = 1", status);
  }

  updateSandboxForSpawn(data: {
    status: SandboxStatus;
    createdAt: number;
    authTokenHash: string;
    modalSandboxId: string;
  }): void {
    this.sql.exec(
      `UPDATE sandbox SET
        status = ?, created_at = ?, sandbox_auth_token_hash = ?,
        modal_sandbox_id = ?, last_activity = ?
      WHERE id = 1`,
      data.status, data.createdAt, data.authTokenHash,
      data.modalSandboxId, data.createdAt
    );
  }

  // Circuit breaker
  incrementCircuitBreakerFailure(timestamp: number): void {
    this.sql.exec(
      `UPDATE sandbox SET
        spawn_failure_count = COALESCE(spawn_failure_count, 0) + 1,
        last_spawn_failure = ?
      WHERE id = 1`,
      timestamp
    );
  }

  resetCircuitBreaker(): void {
    this.sql.exec(
      "UPDATE sandbox SET spawn_failure_count = 0, last_spawn_failure = NULL WHERE id = 1"
    );
  }

  // Message queue (FIFO)
  getNextPendingMessage(): MessageRow | null {
    return this.sql.exec(
      "SELECT * FROM messages WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1"
    ).one() as MessageRow | null;
  }

  updateMessageStatus(id: string, status: MessageStatus, completedAt?: number): void {
    if (completedAt) {
      this.sql.exec(
        "UPDATE messages SET status = ?, completed_at = ? WHERE id = ?",
        status, completedAt, id
      );
    } else {
      this.sql.exec("UPDATE messages SET status = ? WHERE id = ?", status, id);
    }
  }

  // Participant with COALESCE (only update non-null fields)
  updateParticipant(id: string, data: UpdateParticipantData): void {
    this.sql.exec(
      `UPDATE participants SET
        scm_user_id = COALESCE(?, scm_user_id),
        scm_login = COALESCE(?, scm_login),
        scm_name = COALESCE(?, scm_name),
        scm_email = COALESCE(?, scm_email),
        scm_access_token_encrypted = COALESCE(?, scm_access_token_encrypted),
        scm_refresh_token_encrypted = COALESCE(?, scm_refresh_token_encrypted),
        scm_token_expires_at = COALESCE(?, scm_token_expires_at)
      WHERE id = ?`,
      data.scmUserId, data.scmLogin, data.scmName, data.scmEmail,
      data.scmAccessTokenEncrypted, data.scmRefreshTokenEncrypted,
      data.scmTokenExpiresAt, id
    );
  }
}
```

#### background-agents: WebSocket manager with hibernation recovery

```typescript
// packages/control-plane/src/session/websocket-manager.ts

export class SessionWebSocketManagerImpl implements SessionWebSocketManager {
  private clients = new Map<WebSocket, ClientInfo>();
  private sandboxWs: WebSocket | null = null;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly repository: SessionRepository,
    private readonly log: Logger,
    private readonly config: WebSocketManagerConfig
  ) {}

  acceptClientSocket(ws: WebSocket, wsId: string): void {
    // Cloudflare hibernation tags — survive DO eviction
    this.ctx.acceptWebSocket(ws, [`wsid:${wsId}`]);
  }

  acceptAndSetSandboxSocket(ws: WebSocket, sandboxId?: string): { replaced: boolean } {
    const tags = ["sandbox", ...(sandboxId ? [`sid:${sandboxId}`] : [])];
    this.ctx.acceptWebSocket(ws, tags);

    let replaced = false;
    if (this.sandboxWs && this.sandboxWs !== ws) {
      if (this.sandboxWs.readyState === WebSocket.OPEN) {
        this.sandboxWs.close(1000, "New sandbox connecting");
        replaced = true;
      }
    }
    this.sandboxWs = ws;
    return { replaced };
  }

  // Hibernation recovery: if DO was evicted, re-classify sockets from tags
  classify(ws: WebSocket): ParsedTags {
    const tags = this.ctx.getTags(ws);
    if (tags.includes("sandbox")) {
      const sidTag = tags.find((t) => t.startsWith("sid:"));
      return { kind: "sandbox", sandboxId: sidTag?.slice(4) };
    }
    const wsIdTag = tags.find((t) => t.startsWith("wsid:"));
    return { kind: "client", wsId: wsIdTag?.slice(5) };
  }

  // Auth timeout: close unauthenticated connections after 30s
  async enforceAuthTimeout(ws: WebSocket, wsId: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, this.config.authTimeoutMs));
    if (!this.hasPersistedMapping(wsId)) {
      this.close(ws, 4001, "Authentication timeout");
    }
  }

  // Broadcast to authenticated clients only
  forEachClientSocket(
    mode: "all_clients" | "authenticated_only",
    fn: (ws: WebSocket) => void
  ): void {
    for (const ws of this.ctx.getWebSockets()) {
      const tags = this.ctx.getTags(ws);
      if (tags.includes("sandbox")) continue;
      if (mode === "authenticated_only" && !this.clients.has(ws)) continue;
      fn(ws);
    }
  }
}
```

#### background-agents: Event type system

```typescript
// packages/control-plane/src/types.ts

// Client → Server messages (discriminated union)
export type ClientMessage =
  | { type: "ping" }
  | { type: "subscribe"; token: string; clientId: string }
  | { type: "prompt"; content: string; model?: string; reasoningEffort?: string; attachments?: Attachment[] }
  | { type: "stop" }
  | { type: "typing" }
  | { type: "presence"; status: "active" | "idle"; cursor?: { line: number; file: string } }
  | { type: "fetch_history"; cursor: { timestamp: number; id: string }; limit?: number };

// Server → Client messages (discriminated union)
export type ServerMessage =
  | { type: "pong"; timestamp: number }
  | { type: "subscribed"; sessionId: string; state: SessionState; participantId: string;
      replay?: { events: SandboxEvent[]; hasMore: boolean; cursor: { timestamp: number; id: string } | null } }
  | { type: "prompt_queued"; messageId: string; position: number }
  | { type: "sandbox_event"; event: SandboxEvent }
  | { type: "presence_sync"; participants: ParticipantPresence[] }
  | { type: "presence_update"; participants: ParticipantPresence[] }
  | { type: "sandbox_warming" }
  | { type: "sandbox_spawning" }
  | { type: "sandbox_ready" }
  | { type: "sandbox_error"; error: string }
  | { type: "error"; code: string; message: string }
  | { type: "artifact_created"; artifact: { id: string; type: string; url: string; prNumber?: number } }
  | { type: "snapshot_saved"; imageId: string; reason: string }
  | { type: "session_status"; status: SessionStatus }
  | { type: "processing_status"; isProcessing: boolean };

// 11-state sandbox status machine
export type SandboxStatus =
  | "pending" | "spawning" | "connecting" | "warming" | "syncing"
  | "ready" | "running" | "stale" | "snapshotting" | "stopped" | "failed";
```

#### Proliferate: Worker entry point (BullMQ orchestration)

```typescript
// apps/worker/src/index.ts — shows the breadth of background processing

const logger: Logger = createLogger({ service: "worker" });
setServicesLogger(logger.child({ module: "services" }));
setSharedLogger(logger.child({ module: "shared" }));
setLockRedisClient(getRedisClient());

// Create shared dependencies
const db = getDb();
const syncClient = createSyncClient({
  baseUrl: GATEWAY_URL,
  auth: { type: "service", name: "worker", secret: SERVICE_TO_SERVICE_AUTH_TOKEN },
  source: "slack",
});

// Slack workers (BullMQ)
const slackClient = new SlackClient({ syncClient, db }, logger.child({ module: "slack" }));
slackClient.setup({
  connection: getConnectionOptions(),
  inboundConcurrency: 5,
  receiverConcurrency: 10,
});

// Session subscriber (Redis pub/sub for cross-platform messaging)
const subscriberRedis = getRedisClient().duplicate();
const sessionSubscriber = new SessionSubscriber(subscriberRedis, logger.child({ module: "session-subscriber" }));
sessionSubscriber.registerClient(slackClient);

// Billing worker (BullMQ)
if (billingEnabled) { startBillingWorker(logger.child({ module: "billing" })); }

// Automation pipeline workers
const automationWorkers = startAutomationWorkers(logger.child({ module: "automation" }));

// Modal-only: snapshot build workers
if (isModalConfigured) {
  startConfigurationSnapshotWorkers(logger.child({ module: "configuration-snapshots" }));
  startBaseSnapshotWorkers(logger.child({ module: "base-snapshots" }));
}

// Session title generation, action expiry sweeper
startSessionTitleWorkers(logger.child({ module: "session-title" }));
startActionExpirySweeper(logger.child({ module: "action-expiry" }));

// Health check server for K8s liveness probe
healthServer.listen(PORT, () => logger.info({ port: PORT }, "Health check server listening"));

// Graceful shutdown — stop all workers in order
async function shutdown(): Promise<void> {
  clearInterval(nullPauseCheckTimer);
  await stopBillingWorker();
  stopActionExpirySweeper();
  await sessionSubscriber.stop();
  await slackClient.close();
  await stopAutomationWorkers(automationWorkers);
  await stopConfigurationSnapshotWorkers(configurationSnapshotWorkers);
  await stopBaseSnapshotWorkers(baseSnapshotWorkers);
  await stopSessionTitleWorkers(sessionTitleWorkers);
  await closeRedisClient();
  process.exit(0);
}
```

#### Proliferate: EventProcessor (SSE → WebSocket transform)

```typescript
// apps/gateway/src/hub/event-processor.ts

export class EventProcessor {
  private static readonly toolProgressHeartbeatMs = 15_000;
  private currentAssistantMessageId: string | null = null;
  private readonly toolStates = new Map<string, ToolState>();
  private readonly runningToolWatch = new Map<string, {
    toolName: string;
    startedAt: number;
    lastUpdateAt: number;
    lastStatusBroadcastAt: number;
  }>();
  private readonly sentToolEvents = new Set<string>();

  constructor(
    private readonly callbacks: EventProcessorCallbacks,
    logger: Logger,
  ) {
    this.logger = logger.child({ module: "event-processor" });
  }

  process(event: OpenCodeEvent): void {
    this.maybeBroadcastToolProgressHeartbeat(event.type);
    switch (event.type) {
      case "server.connected":
      case "server.heartbeat":
        return; // swallow
      case "message.updated":
        this.handleMessageUpdate(event.properties);
        return;
      case "message.part.updated":
        this.handlePartUpdate(event.properties);
        return;
      case "session.idle":
        this.handleSessionIdle();
        return;
      case "session.status":
        this.handleSessionStatus(event.properties);
        return;
      case "session.error":
        this.handleSessionError(event.properties);
        return;
    }
  }
  // ... 700+ lines of tool state tracking, text streaming, metadata extraction
}
```

#### Side-by-side: Error handling

```typescript
// background-agents — typed error classification with circuit breaker semantics
export class SandboxProviderError extends Error {
  constructor(
    message: string,
    public readonly errorType: "transient" | "permanent",
    public readonly cause?: Error
  ) { super(message); }

  static isTransientStatus(status: number): boolean {
    return status === 502 || status === 503 || status === 504;
  }

  static fromFetchError(message: string, error: unknown, status?: number): SandboxProviderError {
    if (status !== undefined) {
      const errorType = SandboxProviderError.isTransientStatus(status) ? "transient" : "permanent";
      return new SandboxProviderError(message, errorType, error instanceof Error ? error : undefined);
    }
    const errorType = SandboxProviderError.isTransientNetworkError(error) ? "transient" : "permanent";
    return new SandboxProviderError(message, errorType, error instanceof Error ? error : undefined);
  }
}

// Proliferate — simpler error (no transient/permanent classification)
export class SandboxProviderError extends Error {
  constructor(message: string) { super(message); }
  // No error type, no circuit breaker integration
}
```

#### Side-by-side: Session state access

```typescript
// background-agents — synchronous SQLite read (in-process, microseconds)
const session = this.repository.getSession();    // sync
const sandbox = this.repository.getSandbox();    // sync
this.repository.updateSandboxStatus("running");  // sync

// Proliferate — async PostgreSQL via Drizzle (network round-trip, milliseconds)
const session = await sessions.getFullSession(sessionId);    // async
const sandbox = await provider.ensureSandbox(sandboxId);     // async
await sessions.update(sessionId, { status: "running" });     // async
```

---

## 9. Self-Hosting Trade-offs

### Current state

| Concern | background-agents | Proliferate |
|---|---|---|
| **Infra requirement** | Cloudflare account + Modal account + Vercel | Any K8s cluster + PostgreSQL + Redis + Modal/E2B |
| **Self-host possible?** | Only on Cloudflare (vendor-locked) | Yes, on any K8s |
| **Always-on costs** | Near zero (pay-per-request) | Gateway pods + worker pods + Redis + PostgreSQL |
| **Operational complexity** | Low (Cloudflare manages everything) | High (K8s, Helm, Pulumi, Redis, PostgreSQL) |

### Should Proliferate consider Durable Objects?

**Arguments for:**

1. **Eliminate Gateway + Redis**: DOs provide WebSocket management, session state, and persistence in one primitive. No Redis, no lease coordination, no split-brain.
2. **Zero idle cost**: Sessions with no activity cost nothing. Hibernation keeps WebSockets alive.
3. **Simpler deployment**: Fewer services to manage.
4. **Built-in alarm system**: Replaces setInterval timers for timeout/heartbeat/inactivity.

**Arguments against:**

1. **Cloudflare lock-in**: Directly contradicts "fully self-hostable" goal. There is no self-hosted DO equivalent.
2. **SQLite limitations**: Cross-session queries (admin dashboard, analytics, billing aggregation) require a separate database kept in sync.
3. **No PostgreSQL**: Proliferate's Drizzle schema is rich (sessions, repos, configurations, integrations, automations, triggers, billing). Migrating to SQLite-per-session + D1 is a major effort.
4. **BullMQ replacement**: Would need to replace with DO alarms or a separate queue system.
5. **Observability regression**: Cloudflare's debugging tools are limited vs. full K8s observability.

### Hybrid approach worth considering

Keep K8s + PostgreSQL for the product layer (auth, billing, orgs, integrations, automations) but use a DO-like pattern for session state:

- **Option A: Cloudflare DOs for session state only**, with PostgreSQL for everything else. Self-hosters who don't want Cloudflare would use the current Gateway + Redis path. Dual-mode support.
- **Option B: Build a DO-like abstraction on K8s** — each session gets its own SQLite-in-memory state with the Gateway process, persisted to PostgreSQL on snapshot/pause. Simulates the DO pattern without vendor lock-in.
- **Option C: Stay with current architecture**, borrow specific patterns (pure decision functions, error classification, dependency injection in lifecycle management).

### Borrowable patterns (no infrastructure change required)

1. **Pure decision functions** for sandbox lifecycle (circuit breaker, spawn decisions, timeout evaluation)
2. **Error type classification** (transient vs permanent) for better retry/circuit-breaker behavior
3. **HMAC time-based service-to-service auth** (currently Proliferate relies on network-level trust between Gateway and sandbox)
4. **Source control provider abstraction** for future GitLab/Bitbucket support
5. **Per-prompt git identity** for multiplayer sessions where different users send prompts
6. **Pre-warming on user typing** for perceived latency reduction

---

## 10. Recommendations

### High confidence (borrow now)

1. **Add error type classification** to sandbox provider errors (transient vs permanent). This improves retry logic and enables circuit breaker patterns.
2. **Abstract source control provider** interface for future GitLab/Bitbucket support. background-agents' `SourceControlProvider` interface is clean and well-designed.
3. **Per-prompt commit attribution**: Currently Proliferate sets git identity per-session. For multiplayer/automation scenarios, setting it per-prompt (like background-agents) is more correct.

### Medium confidence (evaluate further)

4. **Self-hosted OAuth for GitHub**: If dropping Nango for self-hosting simplicity, background-agents' pattern (self-managed OAuth + AES-256-GCM encrypted tokens + auto-refresh) is a proven template. Only ~200 lines of code for the core flow.
5. **Pre-warm on typing**: Small UX win with minimal implementation cost.

### Low confidence (architectural decision needed)

6. **Durable Objects for session state**: The benefits are real (simpler, cheaper, no split-brain) but the lock-in is severe. Only pursue if Proliferate decides Cloudflare is acceptable for the hosted product and self-hosters get a separate Gateway-based path.
