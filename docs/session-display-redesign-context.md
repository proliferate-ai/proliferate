# Session Display Redesign — Full Technical Context (v2)

> For a technical advisor with **no codebase access**. Contains architecture, schemas, data flows, tradeoff analysis, and all UI surfaces.

---

## 1. What is a Session?

A **session** is a cloud-hosted coding environment (sandbox) where an AI agent (OpenCode) works on a codebase. Sessions are created from the web UI, CLI, Slack, or automatically via automations (GitHub/Linear/Sentry webhooks, cron schedules).

**Lifecycle:** `starting → running → paused → stopped` (or `failed`/`suspended`).

**The core problem:** Session listings across the UI show infrastructure metadata (status, repo, branch, timestamp) but nothing about what the agent did or is doing. Users can't tell whether a session succeeded, what it accomplished, or why it paused — without reconnecting to the live workspace.

---

## 2. System Architecture

### 2.1 High-Level Flow

```
Client ──WebSocket──► Gateway ◄──SSE── Sandbox (Modal/E2B + OpenCode agent)
                         │
           Next.js API: session lifecycle only (create/pause/resume/delete)
           PostgreSQL: metadata persistence only (NOT in streaming path)
```

- **Client ↔ Gateway**: WebSocket — real-time bidirectional streaming
- **Gateway ↔ Sandbox**: Server-Sent Events (SSE) from agent + synchronous HTTP callbacks for "gateway-mediated tools"
- **PostgreSQL (Drizzle ORM)**: Session metadata, repos, billing — NOT messages or agent activity

### 2.2 The Data Pipeline: DB → Frontend

```
PostgreSQL (Drizzle)
  → Service layer (packages/services/src/sessions/)
  → Mapper (mapper.ts) — DROPS ~15 fields considered internal
  → Zod contract (SessionSchema) — validates shape
  → oRPC router — exposes as API procedure
  → TanStack Query hook — fetches & caches
  → React component (SessionListRow, etc.)
```

**Critical detail:** The mapper deliberately discards `initialPrompt`, `stopReason`, `agentConfig`, `clientMetadata`, `endedAt`, and more. These are stored in the DB but never sent to the frontend.

### 2.3 Gateway-Mediated Tools (Existing Extension Point)

The gateway has an established pipeline for tools that make synchronous HTTP callbacks from the sandbox to the gateway, which then writes to the DB. Current tools:

| Tool | What It Does |
|------|-------------|
| `save_snapshot` | Takes filesystem snapshot, updates `sessions.snapshotId` |
| `verify` | Uploads verification evidence to S3 |
| `automation.complete` | Finalizes automation run with outcome/summary |
| `save_service_commands` | Persists auto-start commands to configuration |
| `save_env_files` | Records env file spec to configuration |

Each tool: validates args → accesses session context via `hub.getContext()` → calls services layer → returns result to agent. Includes idempotency via `tool_call_id` and retry on snapshot TCP drops.

---

## 3. Critical Insight: Idle Snapshotting Makes "Paused" Ambiguous

### 3.1 The Problem

The `status` field is unreliable for user-facing display because of **idle snapshotting**. When no clients are connected to a session and the agent goes idle, the gateway automatically takes a snapshot and pauses the session to save compute costs. The session shows `status: "paused"` in the DB, but from the user's perspective, this session is still "running" — the agent finished a task and is waiting. When anyone reconnects, the session seamlessly resumes.

**Result:** A large fraction of sessions with `status: "paused"` are actually healthy, idle sessions that should display as "running" or "idle" to users — NOT as "paused" in the alarming/blocked sense.

### 3.2 All Pause Reasons (from code analysis)

The `pauseReason` field on sessions distinguishes the different causes:

| `pauseReason` value | What happened | User perception |
|---|---|---|
| `"inactivity"` | Idle snapshot — no clients connected, agent idle, grace period exceeded. Also: sandbox expired without clients, or metering detected dead sandbox. | **Should show as "running/idle"** — not blocked, just sleeping. Resumes on reconnect. |
| `null` | User clicked "Pause" button in UI | **Genuinely paused** — user intentionally stopped the session |
| `"credit_limit"` | Org exhausted credits | **Blocked** — needs billing action |
| `"payment_failed"` | Org payment failed | **Blocked** — needs billing action |
| `"overage_cap"` | Org hit overage cap | **Blocked** — needs billing action |
| `"orphaned"` | Gateway crashed, session had no runtime lease | **Infrastructure issue** — should auto-resume or show as error |

### 3.3 Stop Reasons

`stopReason` exists in the schema but is **never written by any code path today**. The `status: "stopped"` transition happens via:
- `automation.complete` tool (outcome stored on `automation_runs`, not session)
- Circuit breaker after 3+ failed idle snapshots (`pauseReason: "snapshot_failed"`)
- Session deletion

### 3.4 Implication for UI

We need a **derived display status** that translates the raw DB fields into user intent:

```
if status === "running" || status === "starting" → "Active"
if status === "paused" && pauseReason === "inactivity" → "Idle" (show as active, just sleeping)
if status === "paused" && pauseReason === null → "Paused" (user-initiated)
if status === "paused" && pauseReason in ["credit_limit","payment_failed","overage_cap"] → "Blocked"
if status === "paused" && pauseReason === "orphaned" → "Recovering"
if status === "stopped" → "Completed"
if status === "failed" → "Failed"
```

---

## 4. What the Gateway Already Captures (Passive Data)

**Key design principle:** We should NOT rely on the agent to make special tool calls to report its status. This is brittle (agent might not comply, might hallucinate, might focus on reporting instead of working) and goes against letting the agent focus on its actual task. Instead, the gateway should passively capture data it already sees flowing through.

### 4.1 PR URLs — Already Available

The gateway has a `git-operations.ts` module that handles git actions. When the agent creates a PR:

```
Agent → git_create_pr request → Gateway GitOperations.createPr() →
  Returns: { success: true, prUrl: "https://github.com/acme/app/pull/42" }
  Broadcast: GitResultMessage { type: "git_result", payload: { prUrl, success, code, message } }
```

**The `prUrl` field already exists in `GitResultMessage`.** The gateway knows the PR URL — it just doesn't persist it. This is the highest-value passive capture.

### 4.2 Tool Execution Counts — Already Tracked

The event processor maintains a `toolStates` Map tracking every tool call:
- Tool name, args, status (running/completed/error), result
- HTTP-level tracking: `activeHttpToolCalls` counter

The gateway already knows how many tools ran, which ones, and whether they succeeded.

### 4.3 File Edits — Already Streamed

`FileEditMessage` events with `{ path, diff }` flow through the event processor. The gateway could count file edits and track which files were modified.

### 4.4 Agent Idle Detection — Already Implemented

The gateway detects when the agent transitions from busy to idle:
- `session.idle` SSE events
- `currentAssistantMessageId` transitions (non-null → null = agent finished responding)
- `lastKnownAgentIdleAt` timestamp tracked on the hub

### 4.5 Tool Metadata — Live Task Context

SSE `tool_metadata` events contain:
- `title` — human-readable description of what the tool is doing
- `metadata.summary` — array of `{ id, tool, status, title }` items

This is effectively "what the agent is doing right now" — flowing through already but not captured.

### 4.6 Errors — Already Detected

- SSE errors (`session.error` events with error details)
- Tool execution errors (error status in `toolStates`)
- Connection errors (ECONNRESET, timeout)

### 4.7 What the Gateway CANNOT Capture Passively

| Data | Why not | Alternative |
|---|---|---|
| **Outcome classification** (succeeded/failed/needs_human) | Requires semantic understanding of whether the agent accomplished its goal | For automations: already captured via `automation.complete`. For regular sessions: infer from final state (PR created → likely succeeded, error → likely failed) |
| **Human-readable summary** | Requires understanding the full conversation context | For automations: already in `completionJson.summary_markdown`. For regular sessions: use `initialPrompt` + captured metrics as a proxy |
| **High-level task context** | Agent's internal planning isn't structured data | `tool_metadata.title` gives tool-level context; `initialPrompt` gives original goal |

---

## 5. The Key Tradeoff: Agent-Reported vs. Infrastructure-Captured

### 5.1 Agent-Reported (Via New Tool Calls)

The original plan proposed adding tools like `session.report_status` and `session.set_task`.

**Pros:**
- Highest-quality data — agent knows what it's doing and can summarize
- Structured outcome classification
- Human-readable summaries

**Cons:**
- **Brittle** — LLMs don't always comply. Agent might skip the call, hallucinate, or get distracted formatting reports.
- **Sudden death** — sandbox OOM, force-stop, timeout → agent dies without reporting. Need fallback anyway.
- **Distraction tax** — every reporting tool call takes time/tokens away from actual work.
- **Prompt overhead** — system prompt space for reporting instructions competes with task instructions.

### 5.2 Infrastructure-Captured (Passive Gateway Observation)

The gateway passively captures data from SSE events without agent cooperation.

**Pros:**
- Zero agent burden — agent focuses on its work
- No compliance risk — infrastructure always runs
- No sudden death gap — data captured incrementally
- No prompt engineering overhead

**Cons:**
- Lower semantic quality — can count files but can't say "fixed the auth bug"
- For non-automation sessions, no outcome classification without heuristics

### 5.3 Recommended Approach

1. **Capture passively at the gateway** for observable data (PR URLs, metrics, errors, last tool activity)
2. **Keep `automation.complete` as-is** — already working, well-tested
3. **Auto-populate session-level fields from `automation.complete`** so automation sessions get rich display
4. **For regular sessions**, rely on captured metrics + `initialPrompt` + derived display status
5. **Infer outcome heuristically** for regular sessions: PR created = likely succeeded, error = likely failed
6. **Do NOT add new agent-facing tools** for status reporting

---

## 6. Complete Database Schema

### 6.1 Sessions Table

```typescript
sessions = pgTable("sessions", {
  id: uuid().primaryKey(),
  organizationId: text().notNull(),
  repoId: uuid().nullable(),
  createdBy: text().nullable(),

  // Classification
  sessionType: text().default("coding"),       // 'setup' | 'coding' | 'terminal'
  status: text().default("starting"),           // 'starting' | 'running' | 'paused' | 'stopped' | 'failed'
  origin: text().default("web"),                // 'web' | 'cli'
  clientType: text().nullable(),                // 'slack' | 'web' | 'cli'

  // Display
  title: text().nullable(),
  initialPrompt: text().nullable(),             // ← NOT sent to frontend (dropped by mapper)

  // Git
  branchName: text().nullable(),
  baseCommitSha: text().nullable(),

  // Sandbox
  sandboxId: text().nullable(),
  sandboxProvider: text().default("modal"),
  snapshotId: text().nullable(),                // non-null = resumable
  codingAgentSessionId: text().nullable(),
  openCodeTunnelUrl: text().nullable(),
  previewTunnelUrl: text().nullable(),

  // Configuration
  configurationId: uuid().nullable(),
  agentConfig: jsonb().nullable(),              // { model, reasoningEffort, enabledTools }
  systemPrompt: text().nullable(),

  // Linkage
  automationId: uuid().nullable(),
  triggerId: uuid().nullable(),
  triggerEventId: uuid().nullable(),
  parentSessionId: uuid().nullable(),           // resumed from this session

  // Lifecycle
  pauseReason: text().nullable(),               // 'inactivity'|'credit_limit'|'payment_failed'|'overage_cap'|'orphaned'
  stopReason: text().nullable(),                // EXISTS but NEVER WRITTEN by any code path
  idleTimeoutMinutes: integer().default(30),
  autoDeleteDays: integer().default(7),

  // Timestamps
  startedAt: timestamp().defaultNow(),
  lastActivityAt: timestamp().defaultNow(),
  pausedAt: timestamp().nullable(),
  endedAt: timestamp().nullable(),              // ← NOT sent to frontend
  sandboxExpiresAt: timestamp().nullable(),

  // Client
  clientMetadata: jsonb().nullable(),           // Slack install ID, channel, thread
  localPathHash: text().nullable(),

  // Billing
  meteredThroughAt: timestamp().nullable(),
  billingTokenVersion: integer().default(1),
  lastSeenAliveAt: timestamp().nullable(),
  aliveCheckFailures: integer().default(0),
  source: text().nullable(),
});
```

### 6.2 What the Mapper Sends to Frontend (23 fields)

```
id, repoId, organizationId, createdBy, sessionType, status,
sandboxId, snapshotId, configurationId, branchName, parentSessionId,
title, startedAt, lastActivityAt, pausedAt, pauseReason,
origin, clientType, automationId,
automation: { id, name } | null,
repo: { id, organizationId, githubRepoId, githubRepoName, githubUrl, defaultBranch, createdAt, source }
```

**Dropped by mapper (never reaches frontend):**
`initialPrompt`, `stopReason`, `baseCommitSha`, `agentConfig`, `systemPrompt`, `clientMetadata`, `codingAgentSessionId`, `openCodeTunnelUrl`, `previewTunnelUrl`, `triggerId`, `triggerEventId`, `localPathHash`, `sandboxProvider`, `sandboxExpiresAt`, `endedAt`, all billing fields.

### 6.3 Related Tables

**Repos:** `{ githubRepoName, githubUrl, defaultBranch, source }`

**Automations:** `{ name, description, enabled, modelId, defaultConfigurationId }`

**Automation Runs** (the one place outcomes ARE stored):
```
{ id, automationId, sessionId, status, completionJson, errorMessage, completedAt }
completionJson: { outcome, summary_markdown, citations, side_effect_refs }
```

**Billing Events:** `{ eventType ('compute'|'llm'), quantity, credits, sessionIds[] }`

**Trigger Events:** `{ rawPayload, parsedContext, enrichedData, llmAnalysisResult }`

---

## 7. All UI Surfaces — Detailed Inventory

### 7.1 Sessions Page (`/dashboard/sessions`)

**Current display per row (`SessionListRow`):**
```
[Animated dot]  Session Title                    [origin badge]  2h ago
                repo-name · branch-name          [alert △ if pending run]
```

- Filter tabs: All / Active (running|starting|paused) / Stopped
- Origin dropdown: All / Manual / Automation / Slack / CLI
- Search: title, repo, branch, automation name
- Actions: rename, delete, save snapshot (context menu)
- Click → navigate to full workspace

**What's broken/missing:**
- Idle-snapshotted sessions show as "Paused" when they should show as "Idle/Active"
- No indication of what the agent did (no PR links, no file counts, no outcome)
- No indication of why it paused beyond the status dot color
- `initialPrompt` not shown (would explain what the session is about)
- `snapshotId` not indicated (is it resumable?)
- Duration not shown

### 7.2 My Work Page (`/dashboard/my-work`)

Three sections:

1. **Claimed Runs** — automation runs assigned to current user
   - Status icon + "Run {status}" + time + "Investigate" button → workspace
   - Type: full `AutomationRun` (includes `session_id`, `error_message`, `trigger_event`, etc.)

2. **Active Sessions** — user's running/starting/paused sessions (excludes setup/CLI/automation)
   - Uses `SessionListRow` (same issues as sessions page)
   - Same idle-snapshot ambiguity

3. **Pending Approvals** — org-wide action invocations awaiting approval
   - Shield icon + action name + integration + "View" button

**What's missing:**
- Claimed runs show no session context (what did the agent do? any PR?)
- Active sessions have the idle-snapshot status ambiguity
- No session outcome without entering workspace

### 7.3 Inbox (`/dashboard/inbox`)

Two-panel layout: queue list (left), detail card (right).

**Data sources:**
- `useOrgPendingRuns()` — runs with status `"failed"` | `"needs_human"` | `"timed_out"` (7 days, max 50, polls every 30s)
- `useOrgActions({ status: "pending" })` — action approval requests
- WebSocket-delivered approvals from current session

**Pending run type (`PendingRunSummary`):**
```
{ id, automation_id, automation_name, status, status_reason, error_message,
  session_id, assigned_to, queued_at, completed_at }
```

**Per pending run detail card:**
- Automation name + status + error message + time
- "View Session" button → workspace

**Per approval detail card:**
- Action name + integration + risk level + session title + expiration
- Approve / Deny / Always Allow buttons

**What's missing:**
- Pending runs show automation name but not what the session did
- No PR link, no summary, no metrics
- "View Session" requires entering workspace — no lightweight preview

### 7.4 Activity Page (`/dashboard/activity`)

Paginated org-wide automation run log (last 90 days, 25/page, polls every 30s).
- Status icon + "Automation run" + trigger provider + time + status badge
- Click → workspace or automation events page
- Filter pills: All / Running / Succeeded / Failed / Needs Attention

**What's missing:**
- No session outcome/summary inline
- No PR links
- Minimal context about what each run accomplished

### 7.5 Dashboard Home (`/dashboard`)

- Greeting + prompt input
- `ActivitySummary`: "{N} sessions this week · {M} running now"
- "Needs Attention" (pending automation runs)
- "Recent Activity" (5 recent sessions as `SessionListRow`)

### 7.6 Command Palette (Cmd+K)

Top 10 sessions. Minimal row: title, repo, branch, status icon, timestamp.

### 7.7 Workspace Session Info Panel

Right sidebar: status indicator, session age, concurrent users, repo, branch, snapshot ID.

---

## 8. Idle Snapshotting Flow (Complete)

### 8.1 How Idle Detection Works

The migration controller checks `shouldIdleSnapshot()`:
1. No active HTTP tool calls (`activeHttpToolCalls === 0`)
2. No running tools in event processor (`!hasRunningTools()`)
3. No WebSocket clients connected (`clients.size === 0`)
4. No proxy connections — terminal, VS Code (`proxyConnections.size === 0`)
5. No assistant message being streamed
6. Grace period exceeded (5 min for web sessions, 30s for automation/Slack)
7. Sandbox exists

### 8.2 What Happens

1. Migration lock acquired (300s TTL)
2. Context re-read from DB (may have changed)
3. Conditions re-validated inside lock
4. SSE disconnected BEFORE snapshot
5. Snapshot taken (memory → pause → filesystem, provider-dependent)
6. Sandbox terminated (for non-pause providers)
7. CAS DB update: `status: "paused"`, `pauseReason: "inactivity"`, `snapshotId`, `sandboxId: null`
8. BullMQ expiry job cancelled

### 8.3 Resume Flow

1. User reconnects via WebSocket
2. `ensureRuntimeReady()` reloads context
3. Sees `status: "paused"`, `snapshotId`, `sandboxId: null`
4. Provider restores from snapshot → new sandbox created
5. DB update: new `sandboxId`, `status: "running"`, `pauseReason: null`
6. SSE connects, agent continues where it left off

**This is transparent to the user.** The pause/resume is purely a cost optimization.

---

## 9. Gateway-Mediated Tools Pipeline (Reference)

### 9.1 Handler Interface

```typescript
interface InterceptedToolHandler {
  name: string;
  execute(hub: SessionHub, args: Record<string, unknown>): Promise<InterceptedToolResult>;
}
interface InterceptedToolResult {
  success: boolean;
  result: string;
  data?: Record<string, unknown>;
}
```

### 9.2 Registry

```typescript
const interceptedTools = new Map<string, InterceptedToolHandler>();
interceptedTools.set("save_snapshot", saveSnapshotHandler);
interceptedTools.set("verify", verifyHandler);
interceptedTools.set("automation.complete", automationCompleteHandler);
interceptedTools.set("save_service_commands", saveServiceCommandsHandler);
interceptedTools.set("save_env_files", saveEnvFilesHandler);
```

### 9.3 HTTP Dispatch (auto-routes)

```
POST /proliferate/{sessionId}/tools/{toolName}
Body: { tool_call_id, args }
Auth: Bearer SANDBOX_MCP_AUTH_TOKEN

→ Dedup check (completed results cache)
→ Inflight check (await existing promise)
→ handler.execute(hub, args)
→ Cache result (5-min TTL)
→ Return JSON to sandbox
```

### 9.4 Sandbox-Side Tool Template Pattern

Tools are string templates written to `.opencode/tool/` during sandbox init. Each embeds a shared `callGatewayTool()` helper with HTTP + retry logic. System prompts tell the agent when to use each tool.

---

## 10. File Inventory

### Database / Schema
- `packages/db/src/schema/sessions.ts` — sessions table
- `packages/db/drizzle/` — migrations

### Services
- `packages/services/src/sessions/db.ts` — query functions
- `packages/services/src/sessions/service.ts` — service interface
- `packages/services/src/sessions/mapper.ts` — DB → API mapper

### Contracts
- `packages/shared/src/contracts/sessions.ts` — Zod schema

### Gateway — Tools
- `apps/gateway/src/hub/capabilities/tools/index.ts` — tool registry
- `apps/gateway/src/hub/capabilities/tools/*.ts` — tool handlers
- `apps/gateway/src/api/proliferate/http/tools.ts` — HTTP dispatch

### Gateway — Event Processing & Lifecycle
- `apps/gateway/src/hub/event-processor.ts` — SSE event parsing, tool state tracking, message lifecycle
- `apps/gateway/src/hub/session-hub.ts` — session lifecycle, idle detection, activity tracking
- `apps/gateway/src/hub/migration-controller.ts` — idle snapshot, sandbox migration/expiry
- `apps/gateway/src/hub/git-operations.ts` — git actions, **has PR URL in return value**
- `apps/gateway/src/sweeper/orphan-sweeper.ts` — orphaned session cleanup

### Gateway — Sandbox Tools (Agent-Side)
- `packages/shared/src/opencode-tools/index.ts` — tool string templates
- `packages/shared/src/prompts.ts` — system prompt builders
- `apps/gateway/src/lib/session-store.ts` — prompt selection

### Sandbox Providers
- `packages/shared/src/providers/modal-libmodal.ts` (~line 1070-1121)
- `packages/shared/src/providers/e2b.ts` (~line 615-664)

### Billing / Pause
- `packages/services/src/billing/metering.ts` — metering, dead sandbox detection
- `packages/services/src/billing/org-pause.ts` — credit/payment pause logic
- `packages/shared/src/billing/types.ts` — `PauseReason` type definition

### API
- `apps/web/src/server/routers/sessions.ts` — session CRUD
- `apps/web/src/server/routers/sessions-pause.ts` — user-initiated pause

### Frontend — Hooks
- `apps/web/src/hooks/use-sessions.ts` — session queries
- `apps/web/src/hooks/use-my-work.ts` — my work composition
- `apps/web/src/hooks/use-attention-inbox.ts` — inbox data

### Frontend — Components
- `apps/web/src/components/sessions/session-card.tsx` — `SessionListRow`
- `apps/web/src/components/dashboard/session-row.tsx` — `SessionRow`
- `apps/web/src/components/dashboard/session-stats.tsx` — `ActivitySummary`
- `apps/web/src/components/dashboard/empty-state.tsx` — dashboard home
- `apps/web/src/components/coding-session/session-info-panel.tsx` — workspace sidebar
- `apps/web/src/components/inbox/inbox-item.tsx` — inbox detail cards

### Frontend — Pages
- `apps/web/src/app/(command-center)/dashboard/sessions/page.tsx`
- `apps/web/src/app/(command-center)/dashboard/my-work/page.tsx`
- `apps/web/src/app/(command-center)/dashboard/inbox/page.tsx`
- `apps/web/src/app/(command-center)/dashboard/activity/page.tsx`
- `apps/web/src/app/(command-center)/dashboard/page.tsx`
- `apps/web/src/app/(workspace)/workspace/[id]/page.tsx`
- `apps/web/src/components/dashboard/command-search.tsx`

---

## 11. Summary of Data Availability

### Currently in DB & shown in UI
- `status`, `title`, `branchName`, `repo.githubRepoName`
- `lastActivityAt`, `startedAt`, `pausedAt`
- `automationId`, `automation.name`, `origin`, `clientType`
- `snapshotId`, `pauseReason` (in API contract but NOT displayed in list views)

### In DB but NOT in frontend API (mapper drops them)
- `initialPrompt` — original task description
- `stopReason` — never written, column exists
- `endedAt` — when session stopped
- `agentConfig` — model, reasoning effort
- `baseCommitSha`, `clientMetadata`, `triggerId`, `triggerEventId`

### In gateway memory (ephemeral, not persisted)
- **PR URLs** from `GitResultMessage.prUrl`
- **Tool call counts** from `toolStates` Map
- **File edit counts** from `file_edit` events
- **Agent idle state** from `session.idle` events
- **Tool metadata** (title, summary) from `tool_metadata` events
- **Errors** from `session.error` and tool failures

### In `automation_runs` (automation sessions only)
- `outcome` (succeeded/failed/needs_human)
- `summary_markdown`, `side_effect_refs` (PR URLs)
- `error_message`, `enriched_data`

### Not available anywhere
- Human-readable summary for regular (non-automation) sessions
- Semantic outcome for regular sessions
- Full conversation history (ephemeral in OpenCode memory)
