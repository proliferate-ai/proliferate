# Sim Architecture Spec

> Comprehensive architectural analysis of the [Sim](https://github.com/simstudioai/sim) codebase — an open-source AI agent workflow platform. Written for the Proliferate engineering team as a reference for architectural comparison and feature inspiration.
>
> **Date**: 2026-02-24

---

## 1. What Sim Is

Sim is a **visual AI workflow builder**. Users design workflows on a canvas by connecting blocks (LLM calls, API requests, code execution, integrations) into directed graphs. Workflows can be triggered manually, via webhooks, on schedules, or through the API. The platform includes a copilot (AI assistant for building workflows), a knowledge base (RAG), deployed chat/form surfaces, and 170+ tool integrations.

**Key difference from Proliferate**: Sim is a workflow orchestration platform (think Zapier/n8n for AI agents). Proliferate is a coding agent platform (think Devin/Cursor in the cloud). They share infrastructure concerns (OAuth, triggers, billing, real-time) but have fundamentally different core domains.

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (Bun 1.3.9 + Node 20+) |
| Frontend | Next.js 16 + React 19 + ReactFlow + Tailwind + shadcn/ui |
| State | Zustand (client) + TanStack Query (server) |
| Database | PostgreSQL + Drizzle ORM + pgvector |
| Real-time | Socket.IO (separate process, port 3002) |
| Background jobs | Trigger.dev (hosted) + PostgreSQL fallback (`asyncJobs` table) |
| Auth | better-auth |
| Billing | Stripe + credit system |
| Sandbox | E2B (code execution blocks only) |
| Monorepo | Turborepo + Bun workspaces |
| Linting | Biome (2-space indent, single quotes) |
| License | Apache 2.0 |

---

## 3. Repository Structure

```
sim/
├── apps/
│   ├── sim/                    # Main Next.js application (everything lives here)
│   │   ├── app/                # Next.js App Router (pages + API routes)
│   │   ├── blocks/             # ~180 block definitions + registry
│   │   ├── tools/              # ~170 tool integrations + registry
│   │   ├── triggers/           # ~100 trigger definitions + registry
│   │   ├── executor/           # Workflow execution engine (DAG, handlers, orchestrators)
│   │   ├── providers/          # 15+ LLM provider adapters
│   │   ├── stores/             # Zustand stores (workflow, execution, canvas, etc.)
│   │   ├── components/         # React components (emcn/ui fork of shadcn)
│   │   ├── hooks/              # React hooks
│   │   ├── lib/                # 30+ feature modules (auth, billing, copilot, etc.)
│   │   ├── socket/             # Socket.IO server + handlers
│   │   ├── serializer/         # Workflow serialization/deserialization
│   │   └── emails/             # Transactional email templates (React Email)
│   └── docs/                   # Documentation site (Fumadocs)
├── packages/
│   ├── db/                     # Drizzle schema + migrations (161 migration files)
│   ├── logger/                 # Pino-based structured logging
│   ├── cli/                    # `simstudio` CLI (npx simstudio)
│   ├── ts-sdk/                 # TypeScript SDK for programmatic access
│   ├── python-sdk/             # Python SDK wrapper
│   └── testing/                # Vitest utilities, mocks, factories
├── docker/                     # Multi-stage Dockerfiles
├── helm/                       # Kubernetes Helm charts
└── scripts/                    # Release + doc generation
```

**Notable**: Unlike Proliferate's multi-app architecture (web, gateway, worker, trigger-service), Sim puts almost everything in a single Next.js app. The only separate process is the Socket.IO server. Background jobs run via Trigger.dev (external service).

---

## 4. Core Domain: The Workflow Execution Engine

This is the heart of Sim and the most architecturally sophisticated part. It compiles visual workflows into executable DAGs and runs them with support for loops, parallel branches, conditions, human-in-the-loop pauses, and partial re-execution.

### 4.1 DAG Compilation

**Location**: `apps/sim/executor/dag/`

A workflow is a visual graph of blocks and edges on a canvas. Before execution, the `DAGBuilder` compiles it into an executable `DAG`:

```
Serialized Workflow (blocks + edges + loops + parallels)
    ↓ PathConstructor       → Identify reachable blocks from trigger
    ↓ LoopConstructor       → Extract loop metadata, create sentinel nodes
    ↓ ParallelConstructor   → Extract parallel metadata, create sentinel nodes
    ↓ NodeConstructor       → Create DAGNodes with metadata
    ↓ EdgeConstructor       → Wire control flow (conditions, routers, errors)
    ↓
DAG { nodes: Map<string, DAGNode>, loopConfigs, parallelConfigs }
```

Each `DAGNode` tracks:
- `incomingEdges: Set<string>` — sources that must complete first
- `outgoingEdges: Map<string, DAGEdge>` — targets with routing handles
- `metadata` — loop/parallel membership, sentinel type

**Sentinel nodes** are injected infrastructure nodes for loop start/end and parallel start/end. They participate in the same ready-queue execution model as regular blocks.

### 4.2 Execution Engine (Ready-Queue Concurrency)

**Location**: `apps/sim/executor/execution/engine.ts`

The engine is a single-threaded async executor driven by a **ready queue**:

```typescript
class ExecutionEngine {
  private readyQueue: string[] = []          // Nodes ready to execute
  private executing = new Set<Promise<void>>() // In-flight executions
  private queueLock = Promise.resolve()       // Serializes queue mutations
}
```

**Execution loop**:
1. Seed the ready queue with the trigger node (or resume points)
2. While work remains:
   - Drain `readyQueue`, firing `executeNodeAsync()` for each node concurrently
   - Wait for at least one execution to complete
   - On completion: process outgoing edges, add newly ready nodes to queue
   - Check cancellation every 500ms (AbortSignal or Redis flag)
3. Return `ExecutionResult` with outputs, logs, pause points

**Key property**: All ready nodes fire immediately (natural concurrency). No thread pool — just async/await. The `queueLock` serializes state mutations to prevent races.

### 4.3 Edge Management & Control Flow

**Location**: `apps/sim/executor/execution/edge-manager.ts`

All routing is expressed as **edge activation rules**:

| Edge Handle | Activates When |
|---|---|
| (none / `source`) | Block succeeds (no error) |
| `error` | Block output has error |
| `cond:<value>` | Condition block selects this option |
| `router:<routeId>` | Router block selects this route |
| `loop_continue` | Loop should iterate again |
| `loop_exit` | Loop is done |
| `parallel_exit` | All parallel branches complete |

When an edge deactivates, it **cascades** — all downstream descendants are pruned unless they have other active incoming edges. This prevents executing dead branches.

A node becomes ready when `incomingEdges.size === 0` (all dependencies resolved).

### 4.4 Block Handlers (Plugin Architecture)

**Location**: `apps/sim/executor/handlers/`

Each block type has a handler:

| Handler | Purpose |
|---|---|
| `TriggerBlockHandler` | No-op, returns trigger payload |
| `AgentBlockHandler` | LLM inference with tool calling |
| `ApiBlockHandler` | HTTP requests |
| `FunctionBlockHandler` | User JavaScript (isolated-vm) |
| `ConditionBlockHandler` | Boolean expression evaluation |
| `RouterBlockHandler` | LLM-based routing to next block |
| `HumanInTheLoopBlockHandler` | Pause execution, wait for human input |
| `WorkflowBlockHandler` | Child workflow invocation |
| `WaitBlockHandler` | Delay execution |
| `VariablesBlockHandler` | Store/transform variables |
| `ResponseBlockHandler` | Workflow output |
| `GenericBlockHandler` | **Fallback** — executes tool from registry |

The `GenericBlockHandler` is the workhorse: any block that maps to a tool (Slack, GitHub, Jira, etc.) routes through it. It looks up the tool config, resolves params, calls `executeTool()`, and returns the result.

**Handlers are stateless**. All state lives in `ExecutionContext` and `ExecutionState`, making replay, pause/resume, and snapshotting possible.

### 4.5 Variable Resolution (Late-Binding)

**Location**: `apps/sim/executor/variables/`

Variables are resolved at execution time, not compile time. The syntax is template-based:

- `<BlockName.field>` — reference another block's output
- `<loop:index>` / `<loop:item>` — current loop iteration
- `<parallel:branchIndex>` — current parallel branch
- `<workflow:variableName>` — workflow-level variable
- `<env:VAR_NAME>` — environment variable

Resolvers chain in priority order: Loop → Parallel → Workflow → Env → Block.

### 4.6 Loop Orchestration

**Location**: `apps/sim/executor/orchestrators/loop.ts`

Four loop types: `for`, `forEach`, `while`, `doWhile`.

The loop orchestrator manages `LoopScope`:
- `iteration` counter, `maxIterations` limit
- `currentIterationOutputs` (cleared each iteration)
- `allIterationOutputs` (accumulated across iterations)
- Continuation evaluated at **loop end sentinel** (VM for `while` conditions)

Safety: max 1000 iterations, max 1000 forEach items.

### 4.7 Parallel Orchestration

**Location**: `apps/sim/executor/orchestrators/parallel.ts`

Parallel blocks dynamically expand at runtime:
1. **Parallel start sentinel** clones interior nodes N times (suffixed `__branch-0`, `__branch-1`, etc.)
2. Branches execute concurrently via the ready queue (natural concurrency)
3. **Parallel end sentinel** aggregates results when all branches complete

Each branch has `branchIndex` and `branchTotal` available via `<parallel:branchIndex>`.

### 4.8 Pause/Resume (Human-in-the-Loop)

When a `HumanInTheLoopBlockHandler` executes:
1. Generates a `contextId` from block ID + scope (loop/parallel position)
2. Returns output with `_pauseMetadata` marker
3. Engine detects marker, serializes full execution state to JSON snapshot
4. Returns `ExecutionResult` with `status: 'paused'` and `pausePoints` array

On resume (via API):
1. Deserialize snapshot, restore execution state
2. Queue the paused block with submitted data
3. Remove incoming edges from paused block (unblock it)
4. Resume engine execution normally

**Key insight**: The entire execution state is serializable to JSON. No closures, no continuations — just data. This enables cross-process resumption and long-lived pauses.

### 4.9 Run-From-Block (Partial Re-execution)

Users can re-run from a specific block without re-executing expensive upstream:
1. Compute `dirtySet` (block + all descendants)
2. Keep cached outputs for clean upstream blocks
3. Remove incoming edges from dirty blocks to non-dirty sources
4. Queue the target block and execute normally

---

## 5. Block & Tool System (Extensibility Model)

### 5.1 Block Definitions

**Location**: `apps/sim/blocks/`

Each block is a `BlockConfig` object — pure data, no class hierarchy:

```typescript
interface BlockConfig {
  type: string                    // 'slack', 'agent', 'api', etc.
  name: string
  description: string
  category: 'blocks' | 'tools' | 'triggers'
  icon: React.ComponentType
  bgColor: string
  subBlocks: SubBlockConfig[]    // UI configuration fields
  tools: { access: string[] }    // Which tools this block uses
  inputs: Record<string, ParamConfig>
  outputs: Record<string, OutputFieldDefinition>
  authMode?: AuthMode            // OAuth / ApiKey / BotToken
}
```

`subBlocks` drive the UI — each subblock is a typed form field (text input, code editor, dropdown, OAuth selector, etc.). They support conditional visibility, dependencies, and AI-assisted generation ("wand" configs).

**~180 blocks** are registered in a flat `registry` object. Adding a new block = create a file + import in registry.

### 5.2 Tool Definitions

**Location**: `apps/sim/tools/`

Each tool is a `ToolConfig` — a declarative HTTP request template:

```typescript
interface ToolConfig {
  id: string
  name: string
  description: string
  version: string
  params: Record<string, { type, required?, visibility?, default? }>
  outputs: Record<string, { type: OutputType }>
  oauth?: { required, provider, requiredScopes }
  request: {
    url: string | ((params) => string)
    method: HttpMethod | ((params) => HttpMethod)
    headers: (params) => Record<string, string>
    body?: (params) => Record<string, any>
  }
  transformResponse?: (response, params?) => Promise<ToolResponse>
  directExecution?: (params) => Promise<ToolResponse>  // bypass HTTP
}
```

**~170 tools** across integrations. Each tool has typed params with **visibility** (`user-or-llm`, `user-only`, `llm-only`, `hidden`) — this controls whether the parameter appears in the UI, is sent to the LLM as a tool schema, or both.

**Tool execution pipeline**: Lookup → param validation → URL construction → header building → body serialization → fetch with timeout → response transform → post-processing.

### 5.3 Trigger Definitions

**Location**: `apps/sim/triggers/`

~100 triggers (webhook-based, polling-based, or mixed). Each defines `subBlocks` (UI config) and `outputs` (event payload schema). Triggers are the entry point to workflow execution.

### 5.4 The Extensibility Pattern

Adding a new integration (e.g., "Notion") requires:
1. **Tool file** (`tools/notion/create_page.ts`) — declarative HTTP template
2. **Block file** (`blocks/blocks/notion.ts`) — UI configuration + tool reference
3. **Trigger file** (`triggers/notion/page_created.ts`) — event definition (optional)
4. **Registry imports** — add to `tools/registry.ts`, `blocks/registry.ts`, `triggers/registry.ts`

No handler code needed — `GenericBlockHandler` handles all tool-backed blocks automatically.

---

## 6. LLM Provider Abstraction

**Location**: `apps/sim/providers/`

15+ LLM providers, each implementing a `ProviderConfig` with `executeRequest()`:

- OpenAI, Anthropic, Google Gemini, Groq, Mistral, Azure OpenAI, AWS Bedrock, Deepseek, Fireworks, Together AI, XAI, Ollama, vLLM, OpenRouter, Cerebras

Each provider:
- Normalizes request/response format
- Handles streaming
- Tracks token usage and cost
- Sanitizes unsupported parameters per model
- Supports tool calling (function calling)

Provider selection is per-block (users pick model in the agent block UI).

---

## 7. Frontend Architecture

### 7.1 State Management

Sim uses a **multi-store Zustand architecture**:

| Store | Purpose |
|---|---|
| Workflow Registry | Workspace-wide workflow metadata, active workflow, deployment status |
| Workflow Editor | Canvas state (blocks, edges, loops, parallels), undo/redo |
| Execution | Per-workflow run state, active blocks, last run path |
| Panel/Editor | Current block selection, panel width, tab state |
| Copilot | Chat messages, streaming state |
| Variables | Workflow-level variables (React Query backed) |
| Canvas Mode | View mode, zoom level |
| Notifications, Terminal, Logs, Sidebar, Folders, Settings | UI chrome |

**Key pattern**: Optimistic updates via `withOptimisticUpdate()` — capture state, update UI, API call, rollback on failure.

### 7.2 Workflow Canvas

The visual editor uses **ReactFlow** with custom node/edge types:
- `workflowBlock` — standard block
- `noteBlock` — text annotations
- `subflowNode` — loop/parallel containers

Supports drag-and-drop, copy/paste (with block ID regeneration), keyboard shortcuts, auto-layout, snap-to-grid.

### 7.3 Real-Time Collaboration

**Socket.IO** server (separate process, port 3002):
- Room-based broadcasting (workspace + workflow scoping)
- Handlers: workflow sync, subblock updates, undo/redo, presence (cursors), permissions
- **MemoryRoomManager** (single-pod) or **RedisRoomManager** (multi-pod)
- Ping/pong for stale connection detection (25s ping, 60s timeout)

### 7.4 Workflow Serialization

`SerializedWorkflow` is the transport format:
```typescript
{
  version: '1.0',
  blocks: SerializedBlock[],
  connections: SerializedConnection[],
  loops: Record<string, SerializedLoop>,
  parallels: Record<string, SerializedParallel>
}
```

Serialization handles: subblock visibility evaluation, canonical mode pairs (basic/advanced UI), legacy migration (e.g., agent prompt format changes).

---

## 8. Deployment Surfaces

### 8.1 Chat Interface

Workflows can be deployed as **chat interfaces** at `/chat/[identifier]`:
- Auth support: public, password, email allowlist, SSO
- Streaming responses (SSE)
- Voice input/output (ElevenLabs TTS)
- File uploads
- Custom branding (logo, colors, welcome message)
- Conversation threading

### 8.2 Form Interface

Workflows can be deployed as **forms** at `/form/[identifier]`:
- Dynamic field rendering from workflow input schema
- Auth support: public, password, email
- File upload
- Custom styling and thank-you message

### 8.3 API

Deployed workflows are callable via REST API with API key auth.

### 8.4 MCP Server

Workflows can be exposed as **MCP tools** via `workflowMcpServer` and `workflowMcpTool` tables. Other AI agents can discover and call Sim workflows via the MCP protocol.

### 8.5 A2A (Agent-to-Agent)

Sim implements the A2A protocol for inter-agent communication. Workflows can:
- Send messages to external agents (LangGraph, Google ADK, other Sim instances)
- Receive tasks from external agents
- Push notifications for async task updates

---

## 9. Database Schema (Key Entities)

**~80 tables** in PostgreSQL with pgvector. The major entity groups:

### Auth & Identity
- `user`, `session`, `account`, `verification` — better-auth managed
- `organization`, `member`, `invitation` — multi-tenant
- `workspace`, `workspaceInvitation`, `permissions`, `permissionGroup` — RBAC

### Workflows
- `workflow` — name, description, color, isDeployed, variables (JSONB)
- `workflowBlocks` — individual blocks with positions, outputs, subblocks
- `workflowEdges` — block connections
- `workflowSubflows` — loop/parallel configurations
- `workflowDeploymentVersion` — immutable deployment snapshots

### Execution
- `workflowExecutionLogs` — execution history (status, trigger type, cost, duration)
- `workflowExecutionSnapshots` — state snapshots for pause/resume
- `pausedExecutions` — human-in-the-loop pause state
- `resumeQueue` — queue for resuming paused executions

### Integrations & Auth
- `credential` — user/workspace credentials
- `credentialSet`, `credentialSetMember` — shared credential sets
- `oauthApplication`, `oauthAccessToken`, `oauthConsent` — OAuth provider
- `apiKey` — API keys (plain `sim_...` or encrypted `sk-sim-...` with AES-256-GCM)
- `ssoProvider` — SSO configurations

### Knowledge Base (RAG)
- `knowledgeBase` — KB instances (embedding model, chunking config)
- `document` — documents (processing status, token count)
- `embedding` — vector chunks (`vector(1536)` + `tsvector` for hybrid search)
- `knowledgeBaseTagDefinitions` — custom tag schemas (17 slots: 7 text, 5 number, 2 date, 3 boolean)
- HNSW index on embeddings with cosine similarity

### Triggers & Scheduling
- `webhook` — webhook endpoints (path, provider, isActive, failedCount)
- `workflowSchedule` — cron schedules (expression, timezone, nextRunAt)
- `idempotencyKey` — webhook deduplication

### Billing
- `subscription` — Stripe subscriptions (plan, seats, trial dates)
- `usageLog` — per-execution cost tracking (source: workflow/wand/copilot/mcp)
- `userStats` — aggregate usage + credit balance
- `referralCampaigns`, `referralAttribution` — referral system

### MCP & A2A
- `mcpServers` — external MCP server configs (transport, URL, headers, timeout, retries)
- `workflowMcpServer`, `workflowMcpTool` — workflows exposed as MCP
- `a2aAgent` — A2A agent configs (capabilities, skills, authentication)
- `a2aTask` — A2A task tracking (status state machine)

### Misc
- `environment`, `workspaceEnvironment` — env vars
- `workspaceBYOKKeys` — bring-your-own-key provider credentials (encrypted)
- `userTableDefinitions`, `userTableRows` — user-created tables (JSONB rows)
- `asyncJobs` — PostgreSQL-backed job queue fallback
- `auditLog` — action audit trail
- `rateLimitBucket` — token bucket rate limiting (DB-backed)

---

## 10. API Layer

### 10.1 Architecture

All API routes live in `apps/sim/app/api/`. REST endpoints under `/api/v1/` with middleware-based auth.

**Auth methods**:
- API key via `x-api-key` header (supports plain `sim_...` and encrypted `sk-sim-...`)
- Admin key via `x-admin-key` header (constant-time SHA-256 comparison)
- Session cookie (better-auth, for web UI)

### 10.2 Rate Limiting

Token bucket algorithm backed by PostgreSQL `rateLimitBucket` table:
- Key types: `sync` (triggers), `async` (background), `api-endpoint` (direct API)
- Limits vary by subscription plan (free/pro/team/enterprise)
- **Fails open** on storage errors (prevents cascading failures)

### 10.3 Major Endpoint Groups

```
/api/v1/
├── workflows/         Workflow CRUD & execution
├── webhooks/          Webhook management
├── auth/              OAuth, SSO
├── chat/              Chat interface operations
├── form/              Form submission
├── copilot/           Copilot chat & generation
├── knowledge/         Knowledge base operations
├── credential-sets/   Shared credentials
├── files/             File upload/download
├── billing/           Stripe webhooks, usage
├── organizations/     Org CRUD & billing
├── mcp/               MCP server operations
├── a2a/               Agent-to-Agent API
├── admin/             Admin-only operations
├── logs/              Execution logs
├── cron/              Schedule management
└── ... (25+ more)
```

---

## 11. Background Jobs

### Trigger.dev (Primary)

Sim uses **Trigger.dev** as its primary background job system:

| Job | Purpose |
|---|---|
| `executeWorkflowJob` | Workflow execution with timeout + abort |
| `executeWebhookJob` | Webhook trigger processing with idempotency |
| `scheduleExecutionJob` | Cron trigger execution |
| `knowledgeProcessingJob` | Document chunking + embedding |
| `workspaceNotificationDeliveryJob` | Notification dispatch |
| `a2aPushNotificationDeliveryJob` | A2A webhook notifications |

Config: Node 22 runtime, 90-minute max duration, configurable retries.

### PostgreSQL Fallback

`asyncJobs` table provides a DB-backed job queue for self-hosted deployments without Trigger.dev. Schema: `type`, `status`, `runAt`, `attempts`, `payload` (JSONB).

---

## 12. Copilot (Builder AI Assistant)

**Location**: `apps/sim/lib/copilot/`

The copilot is an AI assistant that helps users build workflows. It has a server-side tool router:

| Tool | Purpose |
|---|---|
| `getBlocksAndTools` | List available blocks + tools |
| `getBlockConfig` | Get block configuration details |
| `editWorkflow` | Apply block updates to canvas |
| `getWorkflowConsole` | Stream execution logs |
| `searchDocumentation` | Query block/tool docs |
| `searchOnline` | Web search |
| `setEnvironmentVariables` | Manage env vars |
| `getCredentials` | Fetch user's OAuth credentials |
| `makeApiRequest` | Make test API calls |
| `knowledgeBase` | Query knowledge base |

Each tool declares `inputSchema` and `outputSchema` (Zod validated).

---

## 13. Key Architectural Decisions

### 13.1 Single App vs. Microservices

Sim puts everything in one Next.js app (API routes, executor, tools, blocks, frontend). The only separate process is Socket.IO. Background jobs are offloaded to Trigger.dev (external service).

**Trade-off**: Simpler deployment (one container + Postgres) at the cost of less independent scaling. The executor runs in the same process as the API server.

### 13.2 Declarative Everything

Blocks, tools, and triggers are **pure data objects** — no imperative wiring, no class hierarchies. Adding a new integration is a JSON-like object + registry import. The `GenericBlockHandler` handles all tool-backed blocks automatically.

**Trade-off**: Extremely fast to add new integrations (~100 lines per tool), but complex behaviors require escape hatches (`directExecution`, `postProcess`, `schemaEnrichment`).

### 13.3 Ready-Queue DAG Execution

The executor uses an async ready-queue model: all nodes whose dependencies are met fire concurrently. No explicit thread pool or worker allocation.

**Trade-off**: Simple, elegant, and naturally concurrent. But everything runs in one process — a single slow LLM call blocks a Node.js event loop tick (mitigated by async I/O).

### 13.4 Full-State Serialization for Pause/Resume

The entire execution state (block outputs, loop scopes, parallel scopes, edge states) is serializable to JSON. Pause/resume works by snapshotting and restoring this state.

**Trade-off**: Enables cross-process resumption and long-lived pauses. But state can get large for complex workflows with many iterations.

### 13.5 PostgreSQL for Everything (No Redis Required)

Rate limiting, job queue fallback, session storage, vector search — all in PostgreSQL. Redis is optional (only for multi-pod Socket.IO broadcasting).

**Trade-off**: Drastically simpler self-hosting story (just Postgres). But loses Redis's speed for high-frequency operations like rate limiting.

### 13.6 Bring-Your-Own-Key (BYOK)

Users can supply their own LLM API keys per workspace. Keys are encrypted with AES-256-GCM and stored in `workspaceBYOKKeys`.

**Trade-off**: Users control costs directly. But the platform can't track or limit LLM spend as precisely.

### 13.7 Knowledge Base with pgvector

RAG is built on PostgreSQL's `pgvector` extension with HNSW indexes and cosine similarity. Full-text search via `tsvector` for hybrid retrieval.

**Trade-off**: No separate vector database (Pinecone, Weaviate) needed. But pgvector performance degrades at very large scale (millions of embeddings).

### 13.8 Credential Sets (Shared OAuth)

OAuth connections can be shared across organizations via `credentialSet` + `credentialSetMember`. Invitations and status tracking (active/pending/revoked).

**Trade-off**: Enables team credential sharing without individual OAuth flows. Proliferate's advisor recommended this same pattern.

---

## 14. Patterns Worth Noting

### 14.1 Parameter Visibility

Tools declare parameter visibility: `user-or-llm`, `user-only`, `llm-only`, `hidden`. This controls whether params appear in the canvas UI, are sent to the LLM as tool schemas, or both. Clean separation of human-configured vs. AI-determined values.

### 14.2 Schema Enrichment

Some tool parameters have schemas that depend on runtime values. For example, a "knowledge base tag filter" parameter's schema depends on which knowledge base is selected. `schemaEnrichment` configs dynamically fetch and inject schemas at runtime.

### 14.3 Canonical Modes (Basic/Advanced UI)

SubBlocks can have canonical pairs (e.g., a dropdown selector vs. a manual ID input). The UI shows one or the other based on `displayAdvancedOptions`, and the serializer resolves which value to use.

### 14.4 Edge Deactivation Cascading

When a condition/router deactivates an edge, the deactivation cascades to all descendants (pruning entire sub-DAGs). Prevents spurious execution of dead branches. Elegant unified model where errors, conditions, and routing all work through the same edge activation mechanism.

### 14.5 Audit Log

An `auditLog` table tracks all significant actions with `action`, `resourceType`, `resourceId`, `actorId`, and `metadata` (JSONB). Enterprise compliance feature.

---

## 15. What Proliferate Can Learn From Sim

### Things Sim Does Well

1. **Declarative extensibility** — Adding integrations is trivially fast. The block/tool/trigger registry pattern with `GenericBlockHandler` is elegant.

2. **PostgreSQL-native** — Rate limiting, job queue, vector search all in Postgres. No Redis required for core functionality. Validates the advisor's recommendation.

3. **Credential sets** — Shared OAuth across organizations. Proliferate's advisor recommended this same pattern.

4. **Parameter visibility** — The `user-or-llm` / `user-only` / `llm-only` taxonomy is a clean way to handle the human-vs-agent parameter boundary.

5. **Full-state serialization** — Pause/resume via JSON snapshots. No closures, no continuations. Proliferate could adopt this for session state recovery.

6. **Schema enrichment** — Dynamic parameter schemas based on runtime values. Useful for MCP tool configuration.

7. **A2A protocol support** — Forward-looking inter-agent communication.

### Things Sim Does Differently (Not Necessarily Better)

1. **Single-process executor** — Sim runs workflows in the API server process. Proliferate correctly separates the streaming path (Gateway) from the API.

2. **Trigger.dev dependency** — Background jobs depend on an external service. Proliferate's move to Graphile Worker (Postgres-native) is simpler for self-hosting.

3. **No sandbox isolation for general execution** — Sim uses E2B only for "code" blocks. Proliferate's sandbox-per-session model provides stronger isolation.

4. **Socket.IO vs. raw WebSocket** — Sim uses Socket.IO (heavier, more features). Proliferate uses raw WebSocket (lighter, more control).

5. **No actor model** — Sim doesn't have a session actor pattern. Workflow executions are stateless function calls. This works for short-lived workflows but wouldn't work for persistent coding agents.
