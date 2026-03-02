# Proliferate — Comprehensive System Architecture

> Full architecture context for an independent technical advisor. Covers Proliferate's current state, long-term vision, and detailed comparisons with two reference systems: **Sim** (sim.so) and **background-agents** (Open-Inspect). The advisor has no codebase access — all relevant code and context is included inline.
>
> **Date**: 2026-02-23

---

## Table of Contents

0. [Architecture Goals (Long-Term Vision)](#0-architecture-goals-long-term-vision)
1. [Project Overviews & File Trees](#1-project-overviews--file-trees)
2. [Architecture Overview](#2-architecture-overview)
3. [Session Management: Durable Objects vs Gateway + Redis](#3-session-management-durable-objects-vs-gateway--redis)
4. [Sandbox Implementation & Orchestration](#4-sandbox-implementation--orchestration)
5. [Agent Tool Execution & OpenCode](#5-agent-tool-execution--opencode)
6. [Commit Attribution & PR Creation](#6-commit-attribution--pr-creation)
7. [OAuth & Integration Architecture](#7-oauth--integration-architecture)
8. [Trigger & Webhook Systems](#8-trigger--webhook-systems)
9. [Code Quality Comparison](#9-code-quality-comparison)
10. [Self-Hosting Trade-offs](#10-self-hosting-trade-offs)
11. [Advisor Feedback (Round 1)](#11-advisor-feedback-round-1)
12. [Consolidated Recommendations](#12-consolidated-recommendations)

---

## 0. Architecture Goals (Long-Term Vision)

### What Proliferate Is

An **open-source, self-hostable platform** where AI coding agents run in cloud sandboxes to do real software engineering work. Agents get a full dev environment (git, Docker, running services), make code changes, create PRs, and report back. The platform is MIT-licensed; every commit is public.

### Core Architecture Goals

#### 1. Persistent, Long-Running Agents

**Current state:** Ephemeral sessions — spin up sandbox, do task, tear down.

**Target state:** Agents that persist indefinitely, accumulate project context over time, and react to events while nobody's watching. Inspired by [OpenClaw](https://github.com/openclaw/openclaw) — a 24/7 AI agent daemon with persistent memory, heartbeat scheduling, and session management across channels. A Sentry alert at 3am should trigger the agent to investigate and have a draft PR ready by morning.

This means:
- Session lifecycle evolves from ephemeral to long-lived (pausable, resumable, hibernatable)
- Agents build up project understanding over time (not cold-start every task)
- Efficient sandbox hibernation/snapshot/restore to manage cost
- The trigger system becomes the primary input funnel, not just an automation add-on

#### 2. Team-Wide Multi-Client Access

**Any team member can interact with agents from wherever they already work.** The agent is a shared team resource, not locked to one UI.

**Current clients:** Web UI, Slack, Linear, GitHub (PR comments), CLI, VS Code extension.

**Roadmap clients:** Mobile app, desktop app.

The agent doesn't care where the message comes from — Slack, a Linear comment, a GitHub review, a CLI prompt, or a mobile push notification. All funnel into the same agent with the same context. This is a first-class architectural requirement, not a nice-to-have.

#### 3. Fully Self-Hostable with Minimal Infrastructure

**Target:** PostgreSQL + a single binary + sandbox provider. That's it.

**What this means for current architecture:**
- **Kill Redis** — Use Postgres-native queuing (Graphile Worker or pgmq) and LISTEN/NOTIFY for pub/sub
- **Kill Nango** — Self-host OAuth for core integrations (GitHub, Slack, Linear, Sentry, Jira) with tokens encrypted in Postgres
- **Kill BullMQ** — Replace with Postgres-backed job queues (transactional outbox pattern becomes even cleaner when queue and data share the same DB)

#### 4. Extensible Actions & MCP Integration

**Robust, low-friction way to add new integrations and actions.** Two tiers:

- **Core integrations** (GitHub, Slack, Linear, Sentry, Jira): Self-hosted OAuth, native API adapters, first-class trigger support. These are maintained by the Proliferate team.
- **Long-tail integrations** (everything else): Via **MCP (Model Context Protocol) servers**. The platform already has an MCP connector catalog (`org_connectors` table) where orgs can register MCP servers with encrypted credentials. The agent in the sandbox can call any MCP tool. This is the extensibility mechanism — adding a new integration means configuring an MCP server, not writing platform code.

The actions system should make it easy to:
- Add new action providers with minimal boilerplate
- Support approval flows (read actions auto-approve, write actions require human approval, danger actions denied by default)
- Classify risk automatically
- Work with both native integrations and MCP connectors

#### 5. Sandbox Provider Abstraction

**Current:** Modal (primary), E2B (secondary). Both are proprietary SaaS.

**Target:** "Bring your own compute." The sandbox provider interface already exists — the goal is to support:
- Modal / E2B for managed SaaS (fast microVM boots, snapshots)
- gVisor on Kubernetes for self-hosters (strong isolation without bare-metal nested virtualization)
- Potentially Fly Machines as a middle ground

Self-hosters shouldn't need a Modal or E2B account. They should be able to run sandboxes on their own K8s cluster.

#### 6. Enterprise-Ready Security

- **Least-privilege sandboxes:** No high-privilege tokens (GH_TOKEN) injected into sandbox environments. Source control operations (PRs, issues) happen in the control plane, not the sandbox.
- **Source control abstraction:** `SourceControlProvider` interface so the platform isn't hardcoded to GitHub. GitLab, Bitbucket support via the same interface.
- **Bot commit attribution:** Agent commits as itself (`Proliferate Bot <bot@proliferate.dev>`) with `Co-authored-by: User Name <email>` trailers. Cryptographically signed bot commits for enterprise compliance.
- **Encrypted credential storage:** AES-256-GCM envelope encryption for all stored tokens.
- **Org/role-based access control:** Already implemented — admin/owner gates on sensitive mutations.

### What We're Asking the Advisor

Given these goals and the detailed system comparisons below, we want architectural recommendations that:

1. Push toward the "Postgres-only, single-binary" self-hosting target
2. Enable persistent long-running agents without unsustainable infrastructure cost
3. Support the multi-client input model (any team member, any surface)
4. Maintain the extensibility story (core integrations + MCP long-tail)
5. Don't sacrifice the durability and reliability we've already built (durable webhook inbox, transactional outbox, trigger event audit trail)

We're especially interested in patterns for:
- **Session state management** for long-lived agents (consistent hashing? event sourcing? Restate.dev?)
- **Sandbox lifecycle** for persistent agents (hibernation strategies, cost management)
- **OAuth architecture** without Nango (self-hosted, encrypted, refreshable)
- **Queue/job replacement** for Redis/BullMQ (Postgres-native alternatives)
- **Multi-client message routing** to a persistent agent

---

## 1. Project Overviews & File Trees

### Proliferate

- **Product**: Multi-tenant AI coding agent platform (SaaS + self-hostable)
- **License**: MIT, fully open source
- **Users**: Multi-org, multi-user with billing, metering, API keys
- **Clients**: Web app (Next.js), CLI, Slack bot, Linear bot, GitHub bot, VS Code extension
- **Agent**: OpenCode inside Modal/E2B sandboxes
- **Key differentiators**: Persistent sessions, repo/configuration prebuilds, automation pipelines with triggers, MCP connector marketplace, org-level secret management

**Stack:** TypeScript monorepo, Next.js web app, Express Gateway (WebSocket hub), BullMQ workers, PostgreSQL (Drizzle ORM), Redis, Modal/E2B sandboxes.

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

### background-agents (Open-Inspect)

- **Product**: Single-tenant background coding agent (internal tool, open source)
- **License**: MIT
- **Users**: Single org (all users share one GitHub App installation)
- **Clients**: Web app (Next.js), Slack bot, GitHub bot, Linear bot
- **Agent**: OpenCode inside Modal sandboxes
- **Key differentiators**: Zero-idle-cost (Cloudflare hibernation), fire-and-forget async workflow, multiplayer session viewing, Cloudflare-native (no servers to manage)

**Stack:** Cloudflare Workers + Durable Objects + D1 + KV, Modal sandboxes, Next.js on Vercel.

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
│   │   │   └── providers/
│   │   │       └── github-provider.ts  # GitHub implementation (~390 lines)
│   │   │
│   │   ├── db/                       # D1 (cross-session) data stores
│   │   │   ├── session-index.ts      # Session listing/search
│   │   │   ├── repo-metadata.ts      # Repository metadata cache
│   │   │   ├── repo-secrets.ts       # Encrypted per-repo secrets
│   │   │   ├── global-secrets.ts     # Encrypted global secrets
│   │   │   ├── user-scm-tokens.ts    # Encrypted user OAuth tokens (cross-session)
│   │   │   └── repo-images.ts        # Pre-built repo image registry
│   │   │
│   │   └── routes/                   # D1-backed REST endpoints (non-session)
│   │
│   └── test/integration/             # 20+ integration tests against real D1
│
├── modal-infra/                      # Python — Modal sandbox image + runtime
│   ├── deploy.py                     # Modal app deployment
│   ├── src/
│   │   ├── app.py                    # Modal App definition
│   │   ├── functions.py              # Sandbox CRUD endpoints (create, restore, snapshot, warm)
│   │   ├── web_api.py                # FastAPI routes for sandbox operations
│   │   ├── sandbox/
│   │   │   ├── entrypoint.py         # PID 1 supervisor (~949 lines)
│   │   │   ├── bridge.py             # WebSocket bridge to control plane (~1540 lines)
│   │   │   └── manager.py            # Sandbox process management
│   │   └── auth/
│   │       ├── github_app.py         # GitHub App JWT + installation tokens (Python)
│   │       └── internal.py           # HMAC verification (Python)
│   │
│   └── tests/                        # 19 Python test files
│
├── shared/                           # Shared TypeScript utilities
│   └── src/
│       ├── auth.ts                   # HMAC token generation/verification (~104 lines)
│       └── git.ts                    # Branch name generation
│
├── web/                              # Next.js web app (Vercel)
├── slack-bot/                        # Cloudflare Worker — Slack integration
├── github-bot/                       # Cloudflare Worker — GitHub PR review integration
└── linear-bot/                       # Cloudflare Worker — Linear issue integration

terraform/                            # Cloudflare + Modal infrastructure
```

### Sim (sim.so)

- **Product**: Open-source AI workflow automation platform
- **License**: Apache-2.0
- **Users**: Multi-user with workspaces
- **Clients**: Web app (Next.js)
- **Agent**: LLM-powered blocks in visual DAG workflows
- **Key differentiators**: 30+ OAuth providers self-hosted, 100+ tool integrations, visual workflow builder, credential set sharing, no Redis

**Stack:** TypeScript monorepo (Turborepo), Next.js (app + API), PostgreSQL (Drizzle ORM), isolated-vm worker pool, optional E2B sandboxes.

---

## 2. Architecture Overview

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

**Key principle**: API routes are NOT in the real-time streaming path. All streaming goes Client <-> Gateway <-> Sandbox.

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

### Sim

```
Web Client (Next.js)
    ↓ HTTP
Next.js API Routes (app router)
    ↓
PostgreSQL (Drizzle)  +  isolated-vm Worker Pool
    ↓                          ↓
Workflow execution         Code block sandboxing
```

**Infrastructure**: Next.js app + PostgreSQL. That's it. No Redis, no background workers, no queue system.

---

## 3. Session Management: Durable Objects vs Gateway + Redis

This is the most architecturally significant difference between Proliferate and background-agents.

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

  // Route table for internal API endpoints
  private readonly routes: InternalRoute[] = [
    { method: "POST", path: "/internal/init", handler: (req) => this.handleInit(req) },
    { method: "GET", path: "/internal/state", handler: () => this.handleGetState() },
    { method: "POST", path: "/internal/prompt", handler: (req) => this.handleEnqueuePrompt(req) },
    { method: "POST", path: "/internal/create-pr", handler: (req) => this.handleCreatePR(req) },
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
}
```

**SQLite schema** (`packages/control-plane/src/session/schema.ts`):

```sql
CREATE TABLE session (
  id TEXT PRIMARY KEY,
  repo_owner TEXT NOT NULL, repo_name TEXT NOT NULL,
  branch_name TEXT, model TEXT NOT NULL DEFAULT 'claude-sonnet-4-5',
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE participants (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, login TEXT NOT NULL,
  access_token_encrypted TEXT, refresh_token_encrypted TEXT,
  token_expires_at INTEGER, ws_auth_token_hash TEXT,
  role TEXT NOT NULL DEFAULT 'member', joined_at INTEGER NOT NULL
);
CREATE TABLE messages (
  id TEXT PRIMARY KEY, author_participant_id TEXT,
  content TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL, completed_at INTEGER
);
CREATE TABLE sandbox (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  status TEXT NOT NULL DEFAULT 'pending',
  modal_sandbox_id TEXT, snapshot_image_id TEXT,
  spawn_failure_count INTEGER DEFAULT 0,
  last_heartbeat INTEGER
);
```

**WebSocket manager with hibernation recovery:**

```typescript
export class SessionWebSocketManagerImpl implements SessionWebSocketManager {
  acceptClientSocket(ws: WebSocket, wsId: string): void {
    // Cloudflare hibernation tags — survive DO eviction
    this.ctx.acceptWebSocket(ws, [`wsid:${wsId}`]);
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
  private readonly clients = new Map<WebSocket, ClientConnection>();
  private readonly eventProcessor: EventProcessor;
  private readonly runtime: SessionRuntime;
  private readonly migrationController: MigrationController;
  private readonly telemetry: SessionTelemetry;

  // Redis-backed session leases
  private leaseRenewTimer: ReturnType<typeof setInterval> | null = null;
  private ownsOwnerLease = false;

  constructor(deps: HubDependencies) {
    this.eventProcessor = new EventProcessor(
      {
        broadcast: (msg) => this.broadcast(msg),
        getOpenCodeSessionId: () => this.runtime.getOpenCodeSessionId(),
        onToolStart: (toolCallId) => this.telemetry.recordToolCall(toolCallId),
        onMessageComplete: () => this.telemetry.recordMessageComplete(),
        onTextPartComplete: (text) => {
          for (const url of extractPrUrls(text)) this.telemetry.recordPrUrl(url);
        },
      },
      this.logger,
    );

    // Debounced telemetry flush (every 30s)
    this.telemetryFlushTimer = setInterval(() => {
      this.flushTelemetry().catch(/* ... */);
    }, 30_000);

    this.runtime = new SessionRuntime({
      onEvent: (event) => this.handleOpenCodeEvent(event),
      onDisconnect: (reason) => this.handleSseDisconnect(reason),
      onStatus: (status, message) => this.broadcastStatus(status, message),
    });
  }
}
```

**Redis session leases** (`apps/gateway/src/lib/session-leases.ts`):

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

### Sim: No Session State

Sim has no concept of persistent sessions. Each workflow execution is stateless — trigger fires, DAG runs, results returned. No WebSocket connections, no sandbox lifecycle to manage. This is the simplest possible model but doesn't apply to interactive coding sessions.

---

## 4. Sandbox Implementation & Orchestration

Both Proliferate and background-agents use Modal as the primary sandbox provider but differ significantly in implementation.

### background-agents: Thin TypeScript client + Python bridge

The control plane communicates with Modal via a thin HTTP client. The sandbox runs a Python supervisor (entrypoint.py ~949 lines) and bridge (bridge.py ~1540 lines).

**TypeScript Modal client** (`packages/control-plane/src/sandbox/client.ts`):

```typescript
export class ModalClient {
  async create(config: CreateSandboxConfig): Promise<CreateSandboxResult> { /* POST to Modal API with HMAC auth */ }
  async restore(config: RestoreConfig): Promise<RestoreResult> { /* Restore from snapshot */ }
  async snapshot(config: SnapshotConfig): Promise<SnapshotResult> { /* Take filesystem snapshot */ }
  async warm(config: WarmConfig): Promise<void> { /* Pre-warm sandbox (triggered when user types) */ }
}
```

**Python bridge** (`packages/modal-infra/src/sandbox/bridge.py`):

```python
class AgentBridge:
    """Bidirectional communication between sandbox and control plane."""

    async def run(self):
        async with self._connect_ws() as ws:
            await asyncio.gather(
                self._heartbeat_loop(ws),
                self._event_stream_loop(ws),
                self._command_handler(ws),
            )

    async def _event_stream_loop(self, ws):
        """Stream OpenCode SSE events to control plane via WebSocket."""
        async for event in self._opencode_sse():
            await ws.send(json.dumps({"type": "sandbox_event", "event": event}))

    async def _command_handler(self, ws):
        """Handle commands from control plane (prompt, stop, snapshot)."""
        async for message in ws:
            cmd = json.loads(message)
            if cmd["type"] == "prompt":
                await self._configure_git_identity(cmd.get("git_user"))
                await self._send_prompt_to_opencode(cmd["content"])
            elif cmd["type"] == "stop":
                await self._abort_opencode()
            elif cmd["type"] == "push":
                await self._git_push(cmd)
```

**Key design**: The bridge runs *inside* the sandbox and connects *outward* to the control plane via WebSocket. The control plane doesn't need to know the sandbox's IP — the sandbox initiates the connection.

### Proliferate: Direct Modal SDK + SSE

Proliferate uses the Modal JavaScript SDK directly (no Python intermediary for control). The Gateway connects to OpenCode inside the sandbox via SSE.

**Modal provider** (`packages/shared/src/providers/modal-libmodal.ts`):

```typescript
export class ModalLibmodalProvider implements SandboxProvider {
  async createSandbox(opts: CreateSandboxOpts): Promise<CreateSandboxResult> {
    const image = await this.resolveImage(opts);
    const sandbox = await Sandbox.create(this.client, {
      app: await this.getApp(),
      image,
      timeout: SANDBOX_TIMEOUT_SECONDS,
      encrypted_ports: [SANDBOX_PORTS.opencode, SANDBOX_PORTS.caddy],
      cpu: 2, memory: 2048, cloud: "aws",
    });

    // Setup is done IN-PROCESS via the Modal SDK:
    await this.setupSandbox(sandbox, opts);
    await this.setupEssentialDependencies(sandbox, opts);
    await this.setupAdditionalDependencies(sandbox, opts);
    return { sandboxId: sandbox.sandboxId, tunnelUrls };
  }

  // 3-layer image resolution: restore snapshot > base snapshot > base image
  private async resolveImage(opts: CreateSandboxOpts): Promise<Image> {
    if (opts.snapshotId) return Image.fromId(this.client, opts.snapshotId);
    if (MODAL_BASE_SNAPSHOT_ID) return Image.fromId(this.client, MODAL_BASE_SNAPSHOT_ID);
    return await this.getBaseImage();
  }

  // Direct file writes into sandbox via Modal SDK
  async setupEssentialDependencies(sandbox: Sandbox, opts: CreateSandboxOpts) {
    await Promise.all([
      this.writeFile(sandbox, SANDBOX_PATHS.plugin, PLUGIN_MJS),
      this.writeFile(sandbox, SANDBOX_PATHS.opencodeConfig, getOpencodeConfig(opts)),
      this.writeFile(sandbox, SANDBOX_PATHS.instructions, opts.instructions),
    ]);
    await sandbox.exec("opencode", ["server", "--port", String(SANDBOX_PORTS.opencode)]);
    await waitForOpenCodeReady(sandbox, SANDBOX_PORTS.opencode);
  }
}
```

### Comparison: Sandbox Orchestration

| Aspect | background-agents | Proliferate |
|---|---|---|
| **SDK** | HTTP calls to Modal API | Modal JS SDK (libmodal) directly |
| **Sandbox communication** | WebSocket (bridge.py inside sandbox connects out) | SSE (Gateway connects to OpenCode's SSE endpoint) |
| **Connection direction** | Sandbox → Control plane (outbound WS) | Gateway → Sandbox (inbound SSE via tunnel) |
| **Setup** | Python supervisor runs git clone, starts OpenCode | TypeScript provider writes files via SDK, starts OpenCode |
| **Git operations** | Python bridge handles git push/identity | TypeScript GitOperations class via execCommand |
| **Memory snapshots** | Not supported | Supported (gRPC middleware hack for protobuf field injection) |
| **Pre-warming** | Yes (triggered on user typing) | No |

### Sim: No Sandbox Orchestration

Sim uses **isolated-vm** (V8 isolate worker pool) for running user-defined code blocks within the same process. For heavier workloads, optional E2B sandboxes. No long-lived sandbox lifecycle, no snapshots, no git operations.

---

## 5. Agent Tool Execution & OpenCode

### Proliferate: Sandbox-hosted agent with Gateway callback tools

Proliferate runs OpenCode (an LLM coding agent) inside cloud sandboxes. The agent has access to injected tools that call back to the Gateway via HTTP.

```
OpenCode (in sandbox) → tool.execute() → HTTP POST to Gateway
                                              ↓
                                    Gateway processes tool call
                                              ↓
                                    Returns result to sandbox
```

**Tool injection pattern** (`packages/shared/src/opencode-tools/index.ts`):

```typescript
export const TOOL_CALLBACK_HELPER = `
const GATEWAY_URL = process.env.PROLIFERATE_GATEWAY_URL;
const SESSION_ID = process.env.PROLIFERATE_SESSION_ID;
const AUTH_TOKEN = process.env.SANDBOX_MCP_AUTH_TOKEN;

async function callGatewayTool(toolName, toolCallId, args) {
  const url = GATEWAY_URL + "/proliferate/" + SESSION_ID + "/tools/" + toolName;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + AUTH_TOKEN,
        },
        body: JSON.stringify({ tool_call_id: toolCallId, args }),
      });
      return await res.json();
    } catch (err) {
      const isRetryable = err?.cause?.code === "ECONNRESET" || ...;
      if (isRetryable && attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_BASE_MS * Math.pow(2, attempt)));
        continue;
      }
      return { success: false, result: "Network error: " + err?.message };
    }
  }
}
`;
```

**Available tools (injected into sandbox):**

| Tool | Purpose |
|------|---------|
| `request_env_variables` | Request env vars/secrets from user via UI |
| `verify` | Upload verification evidence (screenshots, test logs) to S3 |
| `save_snapshot` | Save sandbox filesystem snapshot |
| `save_service_commands` | Configure auto-start commands for future sessions |
| `save_env_files` | Record env file generation spec for session boot |
| `automation.complete` | Mark an automation run as complete |

**Integration token delivery:** The platform resolves tokens at session creation and passes them as env vars: `{TYPE}_ACCESS_TOKEN_{shortId}` (e.g., `LINEAR_ACCESS_TOKEN_abc12345`). The agent can use these directly in CLI tools or pass them to MCP servers.

### Sim: DAG Workflow Executor with Inline Tool Calls

Sim executes tools directly within workflow blocks. Each tool is a typed configuration with an execution function that receives resolved OAuth tokens.

```typescript
export async function executeTool(toolId: string, params: Record<string, any>, context: ExecutionContext) {
  const tool = await getToolAsync(normalizeToolId(toolId));
  if (tool.oauthConfig) {
    const token = await getOAuthToken(context.userId, tool.oauthConfig.providerId);
    params._oauth = { accessToken: token, ...tool.oauthConfig };
  }
  return await tool.execute(params);
}
```

**DAG executor:**

```typescript
export class DAGExecutor {
  async execute(workflow: Workflow, inputs: Record<string, any>): Promise<ExecutionResult> {
    const graph = buildDependencyGraph(workflow);
    const readyQueue = getSourceBlocks(graph);
    while (readyQueue.length > 0) {
      const block = readyQueue.shift()!;
      const handler = getHandler(block.type); // agent, function, api, condition, router, ...
      const result = await handler.execute(block, {
        inputs: resolveBlockInputs(block, graph),
        credentials: await resolveCredentials(block),
      });
      markComplete(block, result);
      enqueueReady(graph, readyQueue);
    }
    return collectResults(graph);
  }
}
```

13 block handler types: agent, function, api, condition, router, evaluator, webhook, knowledge, workflow_executor, table, custom_tool, and more.

### background-agents: Bridge-mediated tool execution

background-agents doesn't inject custom tools into OpenCode — the bridge handles commands (prompt, stop, push) and streams OpenCode's native SSE events back to the control plane via WebSocket.

### Comparison

| Feature | Proliferate | Sim | background-agents |
|---------|-------------|-----|-------------------|
| Execution model | Single LLM agent in isolated sandbox | DAG of typed blocks with tool calls | Single LLM agent in isolated sandbox |
| Tool discovery | Agent reads tool descriptions at boot | Block config declares required tools | OpenCode native tools only |
| Token delivery | Env vars in sandbox | Injected into tool execute() params | GitHub App tokens for git ops |
| Code isolation | Full VM (Modal/E2B) | isolated-vm V8 isolates | Full VM (Modal) |
| Tool-platform communication | HTTP callback to Gateway | Direct function call | Bridge WebSocket relay |
| Custom platform tools | verify, save_snapshot, etc. | Custom tool blocks (HTTP) | None (git ops via bridge) |
| Snapshot/restore | Full filesystem snapshots | N/A | Filesystem snapshots |

---

## 6. Commit Attribution & PR Creation

### background-agents approach

1. **Git identity set per-prompt**: When a user sends a prompt, their GitHub identity is sent along. The bridge configures `git config user.name/email` before the agent starts.

2. **PR creation via GitHub API from control plane**: Uses user's encrypted OAuth token; falls back to GitHub App token.

```typescript
// packages/control-plane/src/session/pull-request-service.ts
export class SessionPullRequestService {
  async createPullRequest(input: CreatePullRequestInput): Promise<CreatePullRequestResult> {
    // 1. Push branch using App token
    const pushAuth = await this.deps.sourceControlProvider.generatePushAuth();
    const pushSpec = this.deps.sourceControlProvider.buildGitPushSpec({
      owner: session.repo_owner, name: session.repo_name,
      sourceRef: "HEAD", targetBranch: headBranch,
      auth: pushAuth, force: true,
    });
    await this.deps.pushBranchToRemote(headBranch, pushSpec);

    // 2. Create PR with USER's OAuth token (falls back to App token)
    const prAuth = input.promptingAuth ?? appAuth;
    const prResult = await this.deps.sourceControlProvider.createPullRequest(prAuth, {
      repository: repoInfo, title: input.title, body: fullBody,
      sourceBranch: headBranch, targetBranch: baseBranch,
    });
    // PR appears as created by the USER, not the bot
  }
}
```

**GitHub provider with SourceControlProvider abstraction:**

```typescript
export class GitHubSourceControlProvider implements SourceControlProvider {
  readonly name = "github";

  async createPullRequest(auth: SourceControlAuthContext, config: CreatePullRequestConfig) {
    const response = await fetchWithTimeout(
      `${GITHUB_API_BASE}/repos/${config.repository.owner}/${config.repository.name}/pulls`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${auth.token}` },
        body: JSON.stringify({
          title: config.title, body: config.body,
          head: config.sourceBranch, base: config.targetBranch,
        }),
      },
    );
  }

  buildGitPushSpec(config: BuildGitPushSpecConfig): GitPushSpec {
    const remoteUrl = `https://x-access-token:${config.auth.token}@github.com/${config.owner}/${config.name}.git`;
    return { remoteUrl, refspec: `${config.sourceRef}:refs/heads/${config.targetBranch}`, force: config.force ?? false };
  }
}
```

### Proliferate approach

1. **Git identity set at session level**: Configured globally in sandbox at creation.

2. **PR creation via `gh` CLI inside sandbox**: The Gateway runs `gh pr create` in the sandbox with the user's token in the environment.

```typescript
// apps/gateway/src/hub/git-operations.ts
async createPr(title: string, body: string, workspacePath?: string): Promise<GitActionResult> {
  const pushResult = await this.push(workspacePath);
  if (!pushResult.success) return pushResult;

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
| **PR creation** | Direct GitHub API from control plane | `gh pr create` CLI inside sandbox |
| **Push auth** | GitHub App installation token | User's integration token |
| **PR auth** | User OAuth → App fallback | User token via `GH_TOKEN` env var |
| **Source control abstraction** | Full `SourceControlProvider` interface | GitHub-only via `gh` CLI |
| **Security** | Tokens never enter sandbox | High-privilege `GH_TOKEN` inside sandbox |

---

## 7. OAuth & Integration Architecture

### 7.1 Three Approaches Compared

| Aspect | Proliferate | background-agents | Sim |
|--------|-------------|-------------------|-----|
| **OAuth broker** | Nango (3rd-party SaaS) + GitHub App | Self-hosted (GitHub only) | Self-hosted, 30+ providers |
| **Provider count** | ~5 (GitHub, Sentry, Linear, Jira, Slack) | 1 (GitHub) | 30+ providers, ~50 service-level flows |
| **Token storage** | Nango stores tokens remotely | AES-256-GCM encrypted in DO SQLite | Plaintext in `account` table |
| **Token refresh** | Nango handles automatically | Self-managed with 5-minute buffer | Self-managed per provider |
| **Credential sharing** | Org-scoped integrations | Single-org | `credentialSet` + `credentialSetMember` |
| **Self-hosting burden** | Deploy Nango (separate infra) | Register one GitHub OAuth App | CLIENT_ID/SECRET env vars per provider |

### 7.2 Proliferate's Integration System

**Architecture: Nango-brokered references + GitHub App installations**

Proliferate never stores raw OAuth access tokens for Nango-managed integrations. It stores a `connectionId` reference and fetches live tokens from Nango at use time.

```
User → Nango Connect UI → Nango stores tokens → Callback → Proliferate stores reference
                                                              ↓
                                                    At runtime: getToken()
                                                              ↓
                                                    Nango API → fresh access_token
```

**Token resolution** (`packages/services/src/integrations/tokens.ts`):

```typescript
export async function getToken(integration: IntegrationForToken): Promise<string> {
  // GitHub App → installation token (JWT → GitHub API, cached 50min)
  if (integration.provider === "github-app" && integration.githubInstallationId) {
    return getInstallationToken(integration.githubInstallationId);
  }
  // Nango → OAuth token from Nango API (never stored locally)
  if (integration.provider === "nango" && integration.connectionId) {
    const nango = getNango();
    const connection = await nango.getConnection(integration.integrationId, integration.connectionId);
    const credentials = connection.credentials as { access_token?: string };
    if (!credentials.access_token) throw new Error(`No access token`);
    return credentials.access_token;
  }
  throw new Error(`Unsupported provider ${integration.provider}`);
}

// Parallel resolution with partial success
export async function resolveTokens(integrations: IntegrationForToken[]): Promise<ResolveTokensResult> {
  const tokens: TokenResult[] = [];
  const errors: TokenError[] = [];
  await Promise.allSettled(
    integrations.map(async (integration) => {
      try {
        tokens.push({ integrationId: integration.id, token: await getToken(integration) });
      } catch (err) {
        errors.push({ integrationId: integration.id, message: err.message });
      }
    }),
  );
  return { tokens, errors };
}
```

### 7.3 background-agents' OAuth System

**Self-hosted GitHub OAuth with AES-256-GCM encryption:**

```typescript
// packages/control-plane/src/auth/crypto.ts
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

**GitHub OAuth with auto-refresh:**

```typescript
export async function getValidAccessToken(
  stored: StoredGitHubToken,
  config: GitHubOAuthConfig,
): Promise<{ accessToken: string; refreshed: boolean; newStored?: StoredGitHubToken }> {
  const bufferMs = 5 * 60 * 1000;
  if (stored.expiresAt && stored.expiresAt - Date.now() < bufferMs) {
    if (!stored.refreshTokenEncrypted) throw new Error("Token expired, no refresh token");
    const refreshToken = await decryptToken(stored.refreshTokenEncrypted, config.encryptionKey);
    const newTokens = await refreshAccessToken(refreshToken, config);
    const newStored = await encryptGitHubTokens(newTokens, config.encryptionKey);
    return { accessToken: newTokens.access_token, refreshed: true, newStored };
  }
  const accessToken = await decryptToken(stored.accessTokenEncrypted, config.encryptionKey);
  return { accessToken, refreshed: false };
}
```

**HMAC service-to-service auth** (`packages/shared/src/auth.ts`):

```typescript
const TOKEN_VALIDITY_MS = 5 * 60 * 1000;

export async function generateInternalToken(secret: string): Promise<string> {
  const timestamp = Date.now().toString();
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(timestamp));
  const signatureHex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${timestamp}.${signatureHex}`;
}

export async function verifyInternalToken(authHeader: string | null, secret: string): Promise<boolean> {
  if (!authHeader?.startsWith("Bearer ")) return false;
  const [timestamp, signature] = authHeader.slice(7).split(".");
  if (!timestamp || !signature) return false;
  if (Math.abs(Date.now() - parseInt(timestamp)) > TOKEN_VALIDITY_MS) return false;
  // Verify HMAC with timing-safe comparison
  const expectedHex = /* recompute HMAC */;
  return timingSafeEqual(signature, expectedHex);
}
```

### 7.4 Sim's OAuth System

**Self-hosted OAuth for 30+ providers via better-auth's `genericOAuth`:**

```typescript
// apps/sim/lib/oauth/oauth.ts (~1300 lines)
export const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  google: {
    services: {
      gmail: { providerId: 'google-email', scopes: ['gmail.send', 'gmail.modify', 'gmail.labels'] },
      'google-drive': { ... }, 'google-docs': { ... }, 'google-sheets': { ... },
      'google-calendar': { ... }, /* ... 8+ Google services */
    },
  },
  microsoft: {
    services: { 'microsoft-excel': { ... }, 'microsoft-teams': { ... }, /* 6+ services */ },
  },
  slack: { ... }, github: { ... }, linear: { ... }, notion: { ... },
  airtable: { ... }, hubspot: { ... }, salesforce: { ... }, jira: { ... },
  // ... 20+ more providers
};
```

**Token refresh with provider-specific quirks:**

```typescript
export async function refreshOAuthToken(providerId: string, refreshToken: string) {
  const config = getProviderAuthConfig(providerId);
  const params = new URLSearchParams({
    grant_type: 'refresh_token', refresh_token: refreshToken,
    client_id: config.clientId, client_secret: config.clientSecret,
  });
  // Provider-specific auth method selection
  const useBasicAuth = ['reddit', 'spotify', ...].includes(providerId);
  const useBodyCredentials = ['hubspot', 'salesforce', ...].includes(providerId);
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (useBasicAuth) {
    headers['Authorization'] = 'Basic ' + Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
  }
  const response = await fetch(config.tokenUrl, { method: 'POST', headers, body: params.toString() });
  const data = await response.json();
  return { accessToken: data.access_token, expiresIn: data.expires_in || 3600, refreshToken: data.refresh_token };
}
```

**Credential set sharing (team-level OAuth pooling):**

```sql
-- credentialSet table: id, name, description, workspaceId, ownerId
-- credentialSetMember table: id, credentialSetId, userId, role, status ('pending' | 'active')
-- credentialSetInvitation table: id, credentialSetId, email, role, status, invitedBy
```

This allows a team to pool OAuth credentials — e.g., 5 Gmail accounts share a single webhook path, and the system fans out executions across all members' tokens.

---

## 8. Trigger & Webhook Systems

### 8.1 Architecture Overview

| Aspect | Proliferate | Sim | background-agents |
|--------|-------------|-----|-------------------|
| **Trigger architecture** | Dedicated trigger-service with BullMQ workers | Next.js API routes with in-app processing | DO alarms + Slack/GitHub/Linear bot workers |
| **Webhook processing** | Fast-ack + async inbox worker (durable) | Synchronous in request handler | Per-bot worker (Slack, GitHub, Linear) |
| **Polling** | Poll groups with Redis distributed locks | No | No |
| **Scheduled triggers** | BullMQ repeatable jobs (cron) | No | DO alarms |
| **Execution handoff** | Transactional outbox → BullMQ → sandbox | Direct workflow execution | DO message queue → sandbox |
| **Queue backend** | Redis + BullMQ | None | In-DO SQLite message queue |

### 8.2 Proliferate's Trigger System

**Architecture: Dedicated service with durable webhook inbox**

```
Webhook → trigger-service HTTP → INSERT webhook_inbox → 200 OK (fast path)
                                        ↓
                    BullMQ worker (every 5s) → claim batch → FOR UPDATE SKIP LOCKED
                                        ↓
                    Resolve integration → Find triggers → Parse events → Match
                                        ↓
                    Atomic: INSERT trigger_event + automation_run + outbox
                                        ↓
                    Outbox dispatcher → BullMQ → Worker → Sandbox session
```

**Entry point** (`apps/trigger-service/src/index.ts`):

```typescript
registerDefaultTriggers({ nangoSecret, nangoGitHubIntegrationId, nangoLinearIntegrationId, nangoSentryIntegrationId });
const server = createServer();
const pollGroupWorker = startPollGroupWorker();
const scheduledWorker = startScheduledWorker();
const inboxWorker = await startWebhookInboxWorker();
const gcWorker = await startInboxGcWorker();
```

**Webhook inbox worker** (`apps/trigger-service/src/webhook-inbox/worker.ts`):

```typescript
async function processInboxRow(row: WebhookInboxRow): Promise<void> {
  // 1. Resolve integration identity (Nango connectionId or direct integrationId)
  const connectionId = extractConnectionId(payload);
  if (connectionId) {
    const integration = await integrations.findByConnectionIdAndProvider(connectionId, "nango");
    resolvedIntegrationId = integration.id;
  } else {
    resolvedIntegrationId = extractIntegrationId(payload);
  }
  // 2. Find active webhook triggers for this integration
  const triggerRows = await triggerService.findActiveWebhookTriggers(resolvedIntegrationId);
  // 3. Parse using trigger registry, fan out to matching triggers
  const triggerDefs = registry.webhooksByProvider(providerKey);
  for (const triggerDef of triggerDefs) {
    const events = await triggerDef.webhook(mockReq);
    for (const triggerRow of triggerRows) {
      if (triggerRow.provider !== triggerDef.provider) continue;
      await processTriggerEvents(triggerDef, triggerRow, events);
    }
  }
}
```

**Trigger event lifecycle:** `queued → processing → completed | failed | skipped`

**Poll groups:** Integration-scoped polling (one API call per org+provider+integration group):

```
trigger_poll_groups table: id, organizationId, provider, integrationId, cursor, pollingCron
BullMQ repeatable job (per group) → provider.poll(cursor) → fan-out to triggers
Redis distributed lock per group prevents concurrent polls
```

### 8.3 Sim's Webhook System

**Architecture: Direct processing in Next.js API routes**

```typescript
// apps/sim/app/api/webhooks/trigger/[path]/route.ts
export async function POST(request: NextRequest, { params }) {
  const { path } = await params;
  const { body, rawBody } = await parseWebhookBody(request, requestId);
  // Handle provider challenges (Microsoft Graph, WhatsApp, etc.)
  const challengeResponse = await handleProviderChallenges(body, request, requestId, path);
  if (challengeResponse) return challengeResponse;
  // Find all webhooks for this path (supports credential set fan-out)
  const webhooksForPath = await findAllWebhooksForPath({ requestId, path });
  for (const { webhook, workflow } of webhooksForPath) {
    const authError = await verifyProviderAuth(webhook, workflow, request, rawBody, requestId);
    if (authError) continue;
    if (shouldSkipWebhookEvent(webhook, body, requestId)) continue;
    const response = await queueWebhookExecution(webhook, workflow, body, request, { requestId, path });
    responses.push(response);
  }
}
```

No polling, no scheduled triggers — Sim is webhook-only.

### 8.4 Trigger System Comparison

| Feature | Proliferate | Sim | background-agents |
|---------|-------------|-----|-------------------|
| Durability | Durable inbox (survives crashes) | Synchronous (depends on request) | DO persistence |
| Queue | BullMQ + Redis | None | DO-internal |
| Polling | Yes (poll groups with cursors) | No | No |
| Scheduled | Yes (cron via BullMQ) | No | Yes (DO alarms) |
| Dedup | Per (trigger_id, dedup_key) | Not documented | Not documented |
| Audit trail | trigger_events table with lifecycle | No | Events in DO SQLite |
| Fan-out | Per integration → triggers | Per webhook path → credential sets | Per bot type |
| Self-host complexity | Redis + trigger-service + workers | Just Next.js | Cloudflare only |

---

## 9. Code Quality Comparison

### background-agents

**Strengths:**

1. **Pure decision functions**: Lifecycle manager separates decisions from side effects. Decisions are pure functions; the manager executes those actions. Trivially testable.

```typescript
// packages/control-plane/src/sandbox/lifecycle/decisions.ts
export function evaluateCircuitBreaker(
  state: CircuitBreakerState, config: CircuitBreakerConfig, now: number
): CircuitBreakerDecision {
  const timeSinceLastFailure = now - state.lastFailureTime;
  if (state.failureCount > 0 && timeSinceLastFailure >= config.windowMs) {
    return { shouldProceed: true, shouldReset: true };
  }
  if (state.failureCount >= config.threshold && timeSinceLastFailure < config.windowMs) {
    return { shouldProceed: false, shouldReset: false, waitTimeMs: config.windowMs - timeSinceLastFailure };
  }
  return { shouldProceed: true, shouldReset: false };
}

export function evaluateSpawnDecision(state: SandboxState, config: SpawnConfig, now: number): SpawnAction {
  if (["spawning", "connecting", "warming", "syncing", "ready", "running"].includes(state.status)) {
    if (state.hasActiveWebSocket) return { action: "skip", reason: `Sandbox is ${state.status}` };
    if (state.status === "spawning" && now - state.createdAt < config.readyWaitMs)
      return { action: "skip", reason: "Sandbox spawning, waiting" };
  }
  if (state.snapshotImageId) return { action: "restore", snapshotImageId: state.snapshotImageId };
  return { action: "spawn" };
}
```

2. **Dependency injection throughout**: Storage, broadcaster, WebSocket manager, alarm scheduler all injected — no global imports for side-effectful operations.

```typescript
export interface SandboxStorage {
  getSandbox(): SandboxRow | null;
  updateSandboxStatus(status: SandboxStatus): void;
  incrementCircuitBreakerFailure(timestamp: number): void;
  resetCircuitBreaker(): void;
}
export interface SandboxBroadcaster { broadcast(message: object): void; }
export interface WebSocketManager { getSandboxWebSocket(): WebSocket | null; sendToSandbox(message: object): boolean; }
export interface AlarmScheduler { scheduleAlarm(timestamp: number): Promise<void>; }
```

3. **Strong error classification**: `SandboxProviderError` distinguishes transient (network) from permanent (config) errors. Circuit breaker only counts permanent failures.

```typescript
export class SandboxProviderError extends Error {
  constructor(message: string, public readonly errorType: "transient" | "permanent", public readonly cause?: Error) {
    super(message);
  }
  static isTransientStatus(status: number): boolean { return status === 502 || status === 503 || status === 504; }
  static fromFetchError(message: string, error: unknown, status?: number): SandboxProviderError {
    if (status !== undefined) {
      return new SandboxProviderError(message, SandboxProviderError.isTransientStatus(status) ? "transient" : "permanent");
    }
    return new SandboxProviderError(message, SandboxProviderError.isTransientNetworkError(error) ? "transient" : "permanent");
  }
}
```

4. **Timing-safe comparisons** for token verification.
5. **Repository pattern** with synchronous SQLite (microsecond reads).

**Weaknesses:**

1. Magic numbers scattered across files without centralized configuration.
2. 11-state sandbox state machine without formal transition guards.
3. ~67 tests for ~62k LOC.

### Proliferate

**Strengths:**

1. **Structured logging everywhere**: `@proliferate/logger` (Pino-based) with injectable pattern. Consistent `logger.child({ sessionId })` context propagation.

2. **Robust git operations**: `GitOperations` handles shallow clone deepening, index lock detection, multi-remote credential injection, conflict detection — more battle-tested than background-agents.

3. **Provider abstraction**: `SandboxProvider` interface supports Modal + E2B with feature detection.

4. **Rich telemetry pipeline**: 30-second debounced flush to PostgreSQL, tracking tool calls, messages, active seconds, PR URLs.

5. **Comprehensive type system**: 25+ server message variants, 12+ client message variants.

**Weaknesses:**

1. **Split-brain complexity**: Redis lease management with renewal timers, generations — significantly more complex than DO's automatic isolation.
2. **Nango dependency**: Token management outsourced; if Nango has issues, integrations break.
3. **No source control abstraction**: GitHub-specific via `gh` CLI.
4. **In-memory state risk**: Gateway crash = state lost until reconstructed.

### Side-by-side: Session state access

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

### Side-by-side: Error handling

```typescript
// background-agents — typed error classification with circuit breaker semantics
export class SandboxProviderError extends Error {
  constructor(message: string, public readonly errorType: "transient" | "permanent") { super(message); }
}

// Proliferate — simpler error (no transient/permanent classification)
export class SandboxProviderError extends Error {
  constructor(message: string) { super(message); }
}
```

---

## 10. Self-Hosting Trade-offs

### Infrastructure Requirements

| Concern | Proliferate | background-agents | Sim |
|---|---|---|---|
| **Required infra** | K8s + PostgreSQL + Redis + Modal/E2B + Nango | Cloudflare + Modal + Vercel | PostgreSQL + Next.js |
| **Self-host possible?** | Yes, on any K8s | Only on Cloudflare | Yes, single process |
| **Always-on costs** | Gateway + worker pods + Redis + PostgreSQL | Near zero (pay-per-request) | Single app server |
| **Operational complexity** | High (K8s, Helm, Pulumi, Redis, PG) | Low (Cloudflare manages) | Very low |
| **Vendor lock-in** | None (runs on any K8s) | Complete (Cloudflare) | None |

### OAuth Self-Hosting Comparison

**Proliferate with Nango:**
1. Deploy Nango infrastructure (Docker compose with DB, workers, dashboard)
2. Configure Nango integration IDs for each provider
3. Set `NANGO_SECRET_KEY` in Proliferate
4. Users connect via Nango's hosted connect UI

**Sim without external OAuth service:**
1. Create OAuth apps with each desired provider
2. Set `{PROVIDER}_CLIENT_ID` and `{PROVIDER}_CLIENT_SECRET` env vars
3. OAuth flows work through built-in routes
4. Token refresh handled automatically

**background-agents:**
1. Register one GitHub OAuth App + GitHub App
2. Set CLIENT_ID, CLIENT_SECRET, TOKEN_ENCRYPTION_KEY
3. Self-managed OAuth + encrypted token storage

**The trade-off:** Sim requires ~25 individual OAuth app registrations for full coverage, but each is just two env vars. Proliferate requires deploying an entire Nango instance. background-agents only supports GitHub.

### Proliferate's Target Self-Hosting Stack

```
Current:                          Target:
PostgreSQL ─────────────────────→ PostgreSQL (expanded role)
Redis + BullMQ ────────────────→ (eliminated — Postgres queues + LISTEN/NOTIFY)
Nango ─────────────────────────→ (eliminated — self-hosted OAuth in Postgres)
Gateway (Express) ─────────────→ Gateway (stateless + consistent hashing)
Worker (BullMQ) ───────────────→ (merged into single binary)
Trigger-service (Express) ─────→ (merged into single binary)
Web (Next.js) ─────────────────→ Web (Next.js, optionally embedded)
Modal/E2B ─────────────────────→ Modal/E2B (SaaS) OR gVisor (self-hosted K8s)
```

---

## 11. Advisor Feedback (Round 1)

> The following is the technical advisor's first-round response to the background-agents comparison document. These recommendations directly inform Section 12.

### 1. Session State Management: Escaping the Split-Brain Trap

**The Trap:** Proliferate uses complex Redis advisory locks to pin sessions to Gateway pods — a notorious anti-pattern in Node.js where event loop lag causes lease timeouts, resulting in split-brain. background-agents avoids this with DOs, which cannot be self-hosted.

**First-Principles View:** A coding session is an **Actor**. You need exactly one active instance of a session state machine without proprietary primitives or fragile locks.

**Recommendations:**

1. **(High Impact, High Feasibility) Consistent Hashing + Postgres Event Sourcing:** Configure Ingress (Nginx, Envoy) to route WebSockets using consistent hashing on `sessionId`. All traffic for "Session A" deterministically routes to "Pod A." State mutations append to a Postgres `session_events` table. Eliminates Redis and distributed locks. *Trade-off:* Pod scaling causes temporary hash rebalance — brief latency spike while new pod rehydrates state.

2. **(High Impact, Medium Feasibility) Open-Source Durable Execution (Restate.dev):** Gives you the exact DO programming model (single-writer, durable state, suspended execution, built-in alarms) but runs anywhere. *Trade-off:* New paradigm + separate control plane binary.

### 2. Sandbox Orchestration: The Security and Network Boundary

**The Trap:** Both rely on Modal. Proliferate uses SSE to connect *inward* to the sandbox.

**First-Principles View:** Sandboxes are untrusted environments. They must dial *outward* to the control plane.

**Recommendations:**

1. **(Critical Impact, High Feasibility) Outbound WebSocket Bridge:** Adopt background-agents' network topology. Sandbox boots and initiates outbound WebSocket connection *to* the Gateway. Eliminates exposing sandbox ports. *Trade-off:* Requires maintaining a supervisor agent inside the sandbox.

2. **(High Impact, Medium Feasibility) E2B/Fly Machines (SaaS) + gVisor (Self-Hosted):** Break Modal lock-in. Use E2B or Fly.io for SaaS, gVisor on K8s for self-hosters. *Trade-off:* Lose Modal's memory snapshotting.

### 3. OAuth & Integrations: Extensibility at Scale

**The Trap:** background-agents hardcodes GitHub. Proliferate relies on Nango.

**First-Principles View:** Broker *Core Identity*, delegate *Tool Execution*.

**Recommendation:** **(High Impact, High Feasibility) Postgres Credential Vault + MCP Connector Architecture.** For 3-5 core integrations, drop Nango. Store tokens with AES-256-GCM envelope encryption. For 30+ integrations, treat as MCP servers. *Trade-off:* Must manage token refresh lifecycle yourself.

### 4. Background Job Processing: Killing the Redis Dependency

**The Trap:** Proliferate requires BullMQ + Redis. background-agents uses DO Alarms.

**Recommendation:** **(High Impact, High Feasibility) PostgreSQL-Native Queuing (Graphile Worker or pgmq).** Enables **Transactional Outbox Pattern** — update state and enqueue job in the same ACID transaction. Eliminates Redis. *Trade-off:* ~10k jobs/sec max, irrelevant at Proliferate's scale.

### 5. Source Control Abstraction: The CLI Vulnerability

**The Trap:** Proliferate executes `gh` CLI directly inside the sandbox — injecting `GH_TOKEN` into an LLM-controlled environment is a severe security vulnerability.

**Recommendation:** **(Critical Impact, High Feasibility) Strict API Boundary in the Control Plane.** Adopt background-agents' `SourceControlProvider` interface. Sandbox gets only repo-scoped deployment tokens for `git push/pull`. All proprietary API operations (PRs, issues) happen in the control plane.

### 6. Commit Attribution: Cryptographic Truth

**The Trap:** Both systems spoof git identity.

**Recommendation:** **(High Impact, High Feasibility) Bot Authorship + `Co-authored-by` Git Trailers.** Commit as `Proliferate Bot <bot@proliferate.dev>`, cryptographically sign, and append `Co-authored-by: User Name <email>`.

### 7. Overall: The "Zero-Cruft" Target State

> **PostgreSQL-Centric Modular Monolith:** PostgreSQL for relational data, JSONB state machines, Graphile Worker for jobs, LISTEN/NOTIFY for pub/sub. **Kill Redis, BullMQ, and Nango.** Result: a single binary + single database to self-host.
>
> **What to steal from background-agents:** Pure-function decision logic, outbound sandbox topology, SourceControlProvider interface.
>
> **What to keep from Proliferate:** Rich telemetry pipelines, robust TypeScript conflict-resolution logic, commitment to avoiding vendor lock-in.

---

## 12. Consolidated Recommendations

### Critical Priority (Security + Architecture)

1. **Adopt `SourceControlProvider` interface immediately.** Remove `gh` CLI from sandbox. Move all GitHub API operations (PRs, issues, labels) to the control plane. Sandbox gets only short-lived repo-scoped deployment tokens for `git push/pull`. This eliminates the highest-severity security vulnerability.

2. **Reverse sandbox connection direction.** Adopt background-agents' outbound WebSocket bridge pattern. Sandbox connects *outward* to Gateway, not the other way around. Eliminates sandbox port exposure.

3. **Bot commit attribution.** Commit as `Proliferate Bot`, sign commits cryptographically, attribute humans via `Co-authored-by` trailers.

### High Priority (Infrastructure Simplification)

4. **Drop Nango — self-host OAuth.** Port Sim's provider config pattern for the 5 core integrations (GitHub, Slack, Linear, Sentry, Jira). Add AES-256-GCM envelope encryption (steal background-agents' `crypto.ts`). Use better-auth's `genericOAuth` (Proliferate already uses better-auth). Keep GitHub App path as-is. Add credential set sharing (borrow from Sim's schema). Long-tail integrations via MCP.

5. **Replace Redis/BullMQ with Postgres-native queuing.** Use Graphile Worker or pgmq. Enables transactional outbox without distributed transaction risks. Eliminates Redis entirely from the self-hosted stack.

6. **Session state management overhaul.** Implement consistent hashing at the Ingress to route WebSockets by `sessionId`. Replace Redis session leases with in-memory ownership + Postgres event sourcing for persistence. Evaluate Restate.dev as an alternative for the DO programming model.

### Medium Priority (Code Quality)

7. **Add error type classification.** Port background-agents' `SandboxProviderError` with transient/permanent distinction. Integrate with circuit breaker pattern for sandbox spawn failures.

8. **Extract pure decision functions.** Port the pattern from background-agents' `lifecycle/decisions.ts` — circuit breaker evaluation, spawn decisions, inactivity timeouts as pure functions with injected dependencies.

9. **Per-prompt commit attribution.** For multiplayer/automation scenarios, set git identity per-prompt rather than per-session.

10. **Add pre-warming on user typing.** Small UX win — spawn/restore sandbox when typing is detected, before the prompt is submitted.

### What NOT to Borrow

- **Durable Objects** — Lock-in contradicts self-hosting goal. Borrow the *patterns* (actor model, pure decisions, DI), not the *platform*.
- **Sim's plaintext token storage** — Always encrypt tokens at rest.
- **Sim's synchronous webhook processing** — Proliferate's durable inbox is superior.
- **Sim's execution model** — DAG workflows don't apply to interactive coding sessions.
- **background-agents' single-tenancy** — Proliferate's multi-org model is a competitive advantage.
