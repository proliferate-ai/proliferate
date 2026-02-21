

---
# FILE: docs/specs/actions.md
---

# Actions — System Spec

## 1. Scope & Purpose

### In Scope
- Action listing and invocation lifecycle: pending → approved/denied → expired
- Source-agnostic permissioning via a three-mode system: `allow` / `deny` / `require_approval`
- Mode resolution cascade (automation override → org default → inferred default)
- Provider-backed actions surfaced via code-defined integration modules (Linear, Sentry, Slack)
- Connector-backed MCP actions surfaced via `ActionSource` wrappers (dynamic, runtime-discovered tools)
- Database connector actions as `ActionSource` (planned)
- Action definition schemas via Zod, with JSON Schema export for UI and agent guides
- Connector tool drift detection via action definition hashing (admin re-review required when a tool changes)
- Gateway action routes (invoke, approve, deny, list, guide)
- Integration guide/bootstrap flow
- Invocation sweeper (expiry job)
- Actions list (org-level inbox)

### Out of Scope
- Tool schema definitions (how `proliferate` CLI tools get injected into sandboxes) — see `agent-contract.md` §6.3
- Session runtime (hub, WebSocket streaming, event processing) — see `sessions-gateway.md` §6
- Integration OAuth flows for Linear/Sentry (connection lifecycle) — see `integrations.md`
- Automation runs that invoke actions — see `automations-runs.md` §6
- Trigger ingestion and polling — see `triggers.md`

### Mental Model

Actions are platform-mediated operations the agent asks the gateway to perform on external services. The agent sees one flat action catalog for a session (`GET /:sessionId/actions/available`) that merges code-defined integration actions (e.g., Sentry), org-scoped MCP connector tools (e.g., Context7), and database connectors (planned) into a single polymorphic interface: `ActionSource`.

Every action invocation resolves to exactly one **mode**:
- `allow`: execute synchronously.
- `deny`: reject synchronously.
- `require_approval`: create a pending invocation and block until a human approves/denies (interactive sessions) or the automation is paused for human approval (unattended runs).

The agent invokes actions via the `proliferate` CLI inside the sandbox. The CLI sends HTTP requests to the gateway (`apps/gateway/src/api/proliferate/http/actions.ts`), which resolves the action source, validates parameters, resolves the mode via the three-tier cascade, and either auto-executes, denies, or queues the invocation for human approval. Users approve or deny pending invocations through the web dashboard or WebSocket events.

**Core entities:**
- **Action source** — a polymorphic origin that can list and execute actions (`ActionSource`), e.g. a provider-backed source (`linear`) or a connector-backed source (`connector:<uuid>`). All source types share the same invocation lifecycle.
- **Action definition** — schema + description + risk hint for a single action, produced by an action source. Uses Zod for parameter validation.
- **Invocation** — a persisted record of a single action request and its eventual outcome, including the resolved mode and mode source.
- **Mode override** — a persisted policy value (`allow|deny|require_approval`) keyed by `(sourceId, actionId)` at org or automation scope.

**Key invariants:**
- **Source-Agnostic Permissioning:** Mode resolution is deterministic (automation override → org default → inferred default) and blind to the underlying execution protocol.
- **Stateless Providers:** Action sources never read PostgreSQL or Redis. Tokens and configuration are dynamically injected via `ActionExecutionContext`.
- **JSON-Aware Truncation:** Results stored in the DB are redacted and structurally JSON-truncated (max 10KB) without producing invalid JSON.
- **Fail-Safe Drift Detection:** MCP tools that change since the last admin review are flagged as drifted. `allow` downgrades to `require_approval`; `deny` stays `deny`.
- A session can have at most 10 pending invocations simultaneously (`MAX_PENDING_PER_SESSION`). Source: `packages/services/src/actions/service.ts:46`
- Pending invocations expire after 5 minutes if not approved or denied (`PENDING_EXPIRY_MS`). Source: `packages/services/src/actions/service.ts:45`
- Results stored in the DB are redacted (sensitive keys removed) and truncated (max 10KB). Source: `packages/services/src/actions/service.ts:62-84`

---

## 2. Core Concepts

### 2.1 Three-Mode Permissioning

Every invocation resolves to one mode via a simple cascade:

1. **Automation override** (`automations.action_modes["<sourceId>:<actionId>"]`) — highest priority
2. **Org default** (`organizations.action_modes["<sourceId>:<actionId>"]`)
3. **Inferred default** (from action definition `riskLevel` hints: `read` → `allow`, `write` → `require_approval`, `danger` → `deny`)

Providers annotate actions with static `riskLevel: "read" | "write" | "danger"` hints. These hints are only used for inferred defaults when no explicit override exists. Enforcement is entirely via modes.

- Key detail agents get wrong: `riskLevel` is a hint for defaults only. Enforcement is entirely via mode overrides and the resolved mode recorded on each invocation.
- Reference: `packages/services/src/actions/modes.ts`

### 2.2 The `ActionSource` Interface

All action catalogs and execution paths flow through a single polymorphic interface. The gateway calls `source.listActions()` and `source.execute()` without knowing if the underlying system is REST, MCP, or any other protocol.

```typescript
// packages/providers/src/action-source.ts
interface ActionSource {
  id: string;           // e.g., "sentry", "connector:<uuid>"
  displayName: string;
  guide?: string;

  listActions(ctx: ActionExecutionContext): Promise<ActionDefinition[]>;
  execute(actionId: string, params: Record<string, unknown>, ctx: ActionExecutionContext): Promise<ActionResult>;
}

// packages/providers/src/types.ts
interface ActionDefinition {
  id: string;
  description: string;
  riskLevel: RiskLevel;     // Static hint ONLY. Enforcement via Mode Cascade.
  params: z.ZodType;        // Zod for enums, deep schemas, JSON Schema export
}

interface ActionExecutionContext {
  token: string;            // Live token resolved & injected by the platform
  orgId: string;
  sessionId: string;
}

type ActionMode = "allow" | "require_approval" | "deny";

interface ModeResolution {
  mode: ActionMode;
  source: "automation_override" | "org_default" | "inferred_default";
}
```

Two `ActionSource` archetypes are implemented:

1. **`ProviderActionSource`** (Archetype A) — wraps code-defined provider action modules (Linear, Sentry, Slack). `listActions()` returns a static list of Zod-validated definitions. `execute()` calls the provider's REST/GraphQL API with an injected OAuth token. Source: `packages/providers/src/action-source.ts:ProviderActionSource`
2. **`McpConnectorActionSource`** (Archetype B) — wraps an `org_connectors` DB row. `listActions()` dynamically discovers tools via MCP protocol (`tools/list`). `execute()` calls the MCP server's `tools/call` endpoint statelessly. Source: `packages/services/src/actions/connectors/action-source.ts`

- Key detail agents get wrong: the `ActionSource` interface is async for `listActions()` because MCP connectors discover tools over the network. Adapter implementations return a static list but the interface must accommodate dynamic discovery.
- Reference: `packages/providers/src/action-source.ts`, `packages/services/src/actions/connectors/action-source.ts`

### 2.3 Zod Schemas (Params and Results)

Action definitions use Zod for parameter validation and JSON Schema export (for UI rendering and agent guide generation). The `@proliferate/providers/helpers/schema` module provides `zodToJsonSchema()`, `jsonSchemaToZod()` (for MCP tools), and `computeDefinitionHash()`.

- Key detail agents get wrong: schema conversion must be stable for hashing; use the shared `zodToJsonSchema()` implementation. Flat `ActionParam[]` schemas are deprecated.
- Reference: `packages/providers/src/helpers/schema.ts`

### 2.4 Connector Tool Drift Detection (Hashing)

Dynamic MCP tools can change at runtime. The system stores a stable hash for each tool definition alongside its configured mode. On listing, the gateway compares the stored hash with the current hash.

Hashing rules (to avoid false-positive drift):
- Use a deterministic JSON stringifier (stable key ordering). Source: `packages/providers/src/helpers/schema.ts:stableStringify`
- Hash a normalized JSON Schema that strips `description`, `default`, and `enum` fields (these commonly contain dynamic data). Source: `packages/providers/src/helpers/schema.ts:normalizeSchemaForHash`

Drift handling rules:
- Previous `allow` → set effective mode to `require_approval` until re-confirmed.
- Previous `require_approval` → keep `require_approval`.
- Previous `deny` → keep `deny` (still drifted; must be explicitly re-enabled by an admin).
- Key detail agents get wrong: drift detection must never "upgrade" a denied tool into an approvable tool.
- Reference: `packages/services/src/actions/modes.ts:applyDriftGuard`

### 2.5 Actions Bootstrap
During sandbox setup, a markdown file (`actions-guide.md`) is written to `.proliferate/` inside the sandbox. This file documents the `proliferate actions` CLI commands (list, guide, run). The agent reads this file to discover available integrations.
- Key detail agents get wrong: the bootstrap guide is static — it does not list which integrations are connected. The agent must run `proliferate actions list` at runtime to discover connected integrations.
- Reference: `packages/shared/src/sandbox/config.ts:ACTIONS_BOOTSTRAP`

---

## 3. File Tree

```
packages/providers/src/
├── index.ts                          # Exports registry, types, ActionSource adapters
├── types.ts                          # ActionDefinition, ActionExecutionContext, ActionMode, RiskLevel
├── action-source.ts                  # ActionSource interface + ProviderActionSource adapter
├── helpers/
│   ├── schema.ts                     # zodToJsonSchema(), jsonSchemaToZod(), computeDefinitionHash()
│   └── truncation.ts                 # JSON-aware structural truncation (truncateJson)
└── providers/
    ├── registry.ts                   # ProviderActionModule registry (static Map)
    ├── linear/
    │   └── actions.ts                # Linear GraphQL adapter (5 actions)
    ├── sentry/
    │   └── actions.ts                # Sentry REST adapter (5 actions)
    └── slack/
        └── actions.ts                # Slack REST adapter (1 action)

packages/services/src/actions/
├── index.ts                          # Module exports
├── service.ts                        # Business logic (invoke, approve, deny, expire, mode resolution)
├── service.test.ts                   # Service unit tests
├── db.ts                             # Drizzle queries for action_invocations
├── modes.ts                          # Three-mode resolution cascade + drift guard
├── modes-db.ts                       # DB helpers for org/automation action_modes JSONB
└── connectors/
    ├── index.ts                      # Re-exports (listConnectorTools, callConnectorTool, etc.)
    ├── action-source.ts              # McpConnectorActionSource (Archetype B)
    ├── client.ts                     # MCP client (list tools, call tool)
    ├── client.test.ts                # MCP client unit tests
    ├── risk.ts                       # MCP annotations → risk level mapping
    ├── risk.test.ts                  # deriveRiskLevel unit tests
    └── types.ts                      # ConnectorToolList, ConnectorCallResult

apps/gateway/src/api/proliferate/http/
├── actions.ts                        # Gateway HTTP routes for actions
└── actions.test.ts                   # Route handler tests

apps/worker/src/sweepers/
└── index.ts                          # Action expiry sweeper (setInterval)

packages/sandbox-mcp/src/
└── actions-grants.ts                 # CLI grant command handlers (legacy, sandbox-side)

packages/db/src/schema/
├── schema.ts                         # actionInvocations + organizations.actionModes + automations.actionModes
└── relations.ts                      # Drizzle relations

apps/web/src/server/routers/
├── actions.ts                        # oRPC router for org-level actions inbox
└── automations.ts                    # Also hosts getIntegrationActions endpoint

apps/web/src/components/automations/
└── integration-permissions.tsx        # Unified integration cards + action permissions UI
```

---

## 4. Data Models & Schemas

### Database Tables

```sql
action_invocations
├── id                UUID PRIMARY KEY DEFAULT gen_random_uuid()
├── session_id        UUID NOT NULL FK → sessions(id) ON DELETE CASCADE
├── organization_id   TEXT NOT NULL FK → organization(id) ON DELETE CASCADE
├── integration_id    UUID FK → integrations(id) ON DELETE SET NULL
├── integration       TEXT NOT NULL                 -- sourceId (e.g. "linear", "connector:<uuid>")
├── action            TEXT NOT NULL                 -- actionId (e.g. "create_issue", "search_docs")
├── risk_level        TEXT NOT NULL                 -- "read" | "write" | "danger" (hint copied at invocation time)
├── mode              TEXT                          -- "allow" | "deny" | "require_approval" (resolved)
├── mode_source       TEXT                          -- "automation_override" | "org_default" | "inferred_default"
├── params            JSONB                         -- action parameters (redacted before store)
├── status            TEXT NOT NULL DEFAULT 'pending' -- pending | approved | executing | completed | denied | failed | expired
├── result            JSONB                         -- execution result (redacted, structurally truncated)
├── error             TEXT                          -- error message on failure
├── denied_reason     TEXT                          -- policy | human | expired | unknown_mode:<value>
├── duration_ms       INTEGER                       -- execution time
├── approved_by       TEXT                          -- user ID who approved/denied
├── approved_at       TIMESTAMPTZ
├── completed_at      TIMESTAMPTZ
├── expires_at        TIMESTAMPTZ                   -- 5min TTL for pending invocations
└── created_at        TIMESTAMPTZ DEFAULT now()

-- Mode overrides (JSONB columns on existing tables)
organizations
├── id                TEXT PRIMARY KEY
└── action_modes      JSONB                         -- { "<sourceId>:<actionId>": "allow|deny|require_approval", ... }

automations
├── id                UUID PRIMARY KEY
└── action_modes      JSONB                         -- same shape; highest priority in cascade

-- Connector tool config (persistence owned by Integrations)
org_connectors
├── id                UUID PRIMARY KEY
├── organization_id   TEXT NOT NULL
├── name              TEXT NOT NULL
├── transport         TEXT NOT NULL DEFAULT 'remote_http'
├── url               TEXT NOT NULL
├── auth              JSONB NOT NULL
├── risk_policy       JSONB                         -- default risk + per-tool overrides
├── tool_risk_overrides JSONB                       -- { "<toolName>": { mode, hash }, ... }
├── enabled           BOOLEAN NOT NULL DEFAULT true
├── created_by        TEXT
├── created_at        TIMESTAMPTZ DEFAULT now()
└── updated_at        TIMESTAMPTZ DEFAULT now()
```

### Core TypeScript Types

```typescript
// packages/providers/src/types.ts
type RiskLevel = "read" | "write" | "danger";
type ActionMode = "allow" | "require_approval" | "deny";

interface ActionDefinition {
  id: string;
  description: string;
  riskLevel: RiskLevel;
  params: z.ZodType;              // Zod schema — supports enums, nested objects, JSON Schema export
}

interface ActionExecutionContext {
  token: string;
  orgId: string;
  sessionId: string;
}

interface ActionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  durationMs?: number;
}

// packages/providers/src/action-source.ts
interface ActionSource {
  id: string;
  displayName: string;
  guide?: string;
  listActions(ctx: ActionExecutionContext): Promise<ActionDefinition[]>;
  execute(actionId: string, params: Record<string, unknown>, ctx: ActionExecutionContext): Promise<ActionResult>;
}

// packages/services/src/actions/modes.ts
interface ModeResolution {
  mode: ActionMode;
  source: "automation_override" | "org_default" | "inferred_default";
}

// packages/services/src/actions/service.ts
type ActionStatus = "pending" | "approved" | "executing" | "completed"
                  | "denied" | "failed" | "expired";
```

### Key Indexes & Query Patterns
- `idx_action_invocations_session` (session_id) — `listBySession`, `listPendingBySession`
- `idx_action_invocations_org_created` (organization_id, created_at) — `listByOrg`, `countByOrg`
- `idx_action_invocations_status_expires` (status, expires_at) — `expirePendingInvocations` sweeper
- Org policy lookup is a point read on `organizations.action_modes` (JSONB), keyed by `"<sourceId>:<actionId>"`.

---

## 5. Conventions & Patterns

### Do
- Keep mode resolution centralized and deterministic (`modes.ts`), and record `mode` + `mode_source` on every invocation.
- Validate params against Zod schema before mode resolution and execution.
- Add new provider adapters in `packages/providers/src/providers/` and register them in `providers/registry.ts`.
- Use the `ActionSource` interface for all action execution — ensures consistent listing and execution contracts.
- Set `AbortSignal.timeout(30_000)` on all external API calls — adapters enforce a 30s timeout.
- Redact results via `redactData()` before storing — sensitive keys (token, secret, password, authorization, api_key, apikey) are stripped.
- **JSON-truncate results before storing (10KB max)**. Truncation structurally prunes arrays/objects via `truncateJson()` to preserve valid JSON and includes a `_truncated: true` marker when applied. Never string-slice.
- Cache connector `tools/list` results (5 minutes) and include tool hash comparisons during listing.
- Fail safe on drift: if a tool hash changes, downgrade `allow` to `require_approval` but never relax `deny`.

### Don't
- Don't implement per-source permissioning branches in the invocation pipeline (mode resolution is uniform).
- Don't rely on provider `riskLevel` as enforcement (it is only an inferred default hint).
- Return `{ ok: false }` error objects from service functions — throw typed errors (`ActionNotFoundError`, `ActionExpiredError`, `ActionConflictError`, `PendingLimitError`).
- Store raw external API responses — always pass through `redactData()` and `truncateResult()`.
- Approve/deny from sandbox tokens — only user tokens with admin/owner role can approve or deny invocations.
- Don't store or return raw tokens from action routes.

### Error Handling

```typescript
// Gateway maps service errors to HTTP status codes
// Source: apps/gateway/src/api/proliferate/http/actions.ts
try {
  await actions.approveAction(invocationId, orgId, userId);
} catch (err) {
  if (err instanceof actions.ActionNotFoundError)  → 404
  if (err instanceof actions.ActionExpiredError)    → 410
  if (err instanceof actions.ActionConflictError)   → 409
  if (err instanceof actions.PendingLimitError)     → 429
}
```

### Reliability
- **External API timeout**: 30s on all adapters and connector calls.
- **Invocation expiry**: 5-minute TTL on pending invocations (`PENDING_EXPIRY_MS`). Source: `packages/services/src/actions/service.ts:PENDING_EXPIRY_MS`
- **Pending cap**: Max 10 pending invocations per session (`MAX_PENDING_PER_SESSION`). Source: `packages/services/src/actions/service.ts:MAX_PENDING_PER_SESSION`
- **Rate limiting**: 60 invocations per minute per session (in-memory counter in gateway). Source: `apps/gateway/src/api/proliferate/http/actions.ts:checkInvokeRateLimit`
- **Result truncation**: never string-slice JSON. Prune structurally via `truncateJson()` until under the limit and return/store a valid JSON value. Source: `packages/providers/src/helpers/truncation.ts`

### Testing Conventions
- Mock `./db` and `./modes` modules for service tests — never hit the database.
- Mock `../logger` to suppress log output.
- Use test helper factories for invocation row data.

---

## 6. Subsystem Deep Dives

### 6.1 List Available Actions — `Implemented`

**What it does:** Returns a merged catalog of actions available to a session, across all action source types.

**Happy path:**
1. Load session context: `session_connections` (provider-backed sources) and `org_connectors` (connector sources).
2. Build `ActionSource[]` for provider-backed sources (`ProviderActionSource` wrapping registry modules) and connector-backed sources (`McpConnectorActionSource`, tools cached 5 min per session).
3. For each source, call `listActions(ctx)`. For connector tools, compute drift status using normalized schema hashing.
4. Return one flat list. The list is also used to generate the sandbox guide (`.proliferate/actions-guide.md`).

**Edge cases:**
- Connector is unreachable at list-time → its tools simply do not appear in the available list. Other connectors and static adapters continue working.
- Tool hash changed since last review → mark drifted; `allow` becomes `require_approval`, `deny` stays `deny`, and the admin UI surfaces "needs re-review".

**Files touched:** `apps/gateway/src/api/proliferate/http/actions.ts`, `packages/providers/src/action-source.ts`, `packages/services/src/actions/connectors/action-source.ts`

### 6.2 Action Invocation Lifecycle — `Implemented`

**What it does:** Routes an action through mode resolution, execution or approval, and result storage.

**Invoke response contracts:**

| Outcome | HTTP | Response shape |
|---------|------|----------------|
| Auto-approved (`allow` mode) | 200 | `{ invocation, result }` |
| Pending approval (`require_approval` mode) | 202 | `{ invocation, message: "Action requires approval" }` |
| Denied (`deny` mode) | 403 | `{ invocation, error }` |
| Pending cap exceeded | 429 | `{ error }` |

**Pipeline (`POST /invoke`):**
1. Agent calls `proliferate actions run --integration linear --action create_issue --params '{...}'`
2. Sandbox-MCP CLI sends `POST /:sessionId/actions/invoke` to gateway
3. Gateway resolves the `ActionSource` by `sourceId` and locates the `ActionDefinition` by `actionId`
4. Validates params via Zod (`safeParse`) and rejects invalid payloads early
5. If source is a connector tool, computes drift status via normalized schema hashing
6. Resolves mode via three-tier cascade (`resolveMode()` in `modes.ts`): automation override → org default → inferred default
7. Applies drift guardrail (connector tools only): drifted `allow` downgrades to `require_approval`; drifted `deny` stays `deny`
8. Calls `invokeAction()` (`service.ts`) which branches on mode:
   - `deny` → persists invocation as denied with `deniedReason: "policy"`, returns HTTP 403
   - `allow` → persists invocation as approved, gateway executes `source.execute()` immediately, returns HTTP 200
   - `require_approval` → enforces pending cap, persists invocation as pending with 5-min expiry, broadcasts `action_approval_request` via WebSocket, returns HTTP 202
9. For executed responses, redacts and structurally JSON-truncates results to <=10KB, persists via `markCompleted()`, broadcasts `action_completed`
10. On execution failure: `markFailed()` with error message, broadcasts failure, returns HTTP 502

**Edge cases:**
- **Pending cap exceeded** → throws `PendingLimitError`, gateway returns HTTP 429
- **Expired before approval** → `approveAction()` marks expired via `db.ts:updateInvocationStatus`, throws `ActionExpiredError` (410)
- **Already approved/denied** → throws `ActionConflictError` (409)
- **Unknown mode from JSONB** → denied as safe fallback with `deniedReason: "unknown_mode:<value>"`

**Files touched:** `packages/services/src/actions/service.ts`, `packages/services/src/actions/modes.ts`, `apps/gateway/src/api/proliferate/http/actions.ts`

### 6.3 Approve/Deny Pending Invocations — `Implemented`

**What it does:** Resolves a pending invocation into an executed or denied state.

**Routes:**
- `POST /invocations/:invocationId/approve` — admin/owner role required
- `POST /invocations/:invocationId/deny` — admin/owner role required

**Approve modes:**
- `mode: "once"` (default) — approves this invocation only.
- `mode: "always"` — approves this invocation AND updates `organizations.action_modes` (or `automations.action_modes`) to `allow` for this `sourceId:actionId` pair, so future invocations are auto-approved.

Interactive sessions use WebSocket-connected human clients to approve/deny via the Org Inbox UI. Unattended automation runs pause, notify a Slack channel, and wait for human resumption (owned by `automations-runs.md`).

**Files touched:** `packages/services/src/actions/service.ts`, `packages/services/src/actions/modes-db.ts`, `apps/gateway/src/api/proliferate/http/actions.ts`

### 6.4 Gateway Action Routes — `Implemented`

**What it does:** HTTP API for action invocation, approval, denial, listing, and guides.

**Routes** (all prefixed with `/:proliferateSessionId/actions/`):

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/available` | Sandbox or User | List connected integrations and their actions |
| GET | `/guide/:integration` | Sandbox or User | Get markdown guide for an integration |
| POST | `/invoke` | Sandbox only | Invoke an action |
| GET | `/invocations` | Sandbox or User | List session invocations |
| GET | `/invocations/:invocationId` | Sandbox or User | Poll invocation status |
| POST | `/invocations/:invocationId/approve` | User (admin/owner) | Approve pending invocation |
| POST | `/invocations/:invocationId/deny` | User (admin/owner) | Deny pending invocation |

**Files touched:** `apps/gateway/src/api/proliferate/http/actions.ts`

### 6.5 Linear Adapter — `Implemented`

**What it does:** Provides 5 actions against the Linear GraphQL API via the `ProviderActionSource` wrapper.

| Action | Risk | Required Params |
|--------|------|-----------------|
| `list_issues` | read | — (optional: teamId, projectId, first, after) |
| `get_issue` | read | issueId |
| `create_issue` | write | teamId, title (optional: description, assigneeId, stateId, priority, labelIds, projectId) |
| `update_issue` | write | issueId (optional: title, description, assigneeId, stateId, priority) |
| `add_comment` | write | issueId, body |

**Implementation:** GraphQL queries/mutations via `fetch` to `https://api.linear.app/graphql`. Token passed as `Authorization` header. 30s timeout. Pagination via cursor (`first`/`after`), capped at 50 results.

**Files touched:** `packages/providers/src/providers/linear/actions.ts`

### 6.6 Sentry Adapter — `Implemented`

**What it does:** Provides 5 actions against the Sentry REST API via the `ProviderActionSource` wrapper.

| Action | Risk | Required Params |
|--------|------|-----------------|
| `list_issues` | read | organization_slug, project_slug (optional: query) |
| `get_issue` | read | issue_id |
| `list_issue_events` | read | issue_id |
| `get_event` | read | issue_id, event_id |
| `update_issue` | write | issue_id (optional: status, assignedTo) |

**Implementation:** REST via `fetch` to `https://sentry.io/api/0`. Token as `Bearer` in `Authorization` header. 30s timeout. URL segments properly encoded via `encodeURIComponent`.

**Files touched:** `packages/providers/src/providers/sentry/actions.ts`

### 6.7 Slack Adapter — `Implemented`

**What it does:** Provides a basic Slack write action (`send_message`) against the Slack Web API via the `ProviderActionSource` wrapper.

| Action | Risk | Required Params |
|--------|------|-----------------|
| `send_message` | write | `channel`, `text` (optional: `thread_ts`) |

**Implementation:** REST via `fetch` to `https://slack.com/api/chat.postMessage`. Token as `Bearer` in `Authorization` header. 30s timeout. Returns Slack API response JSON when `ok=true`, throws on Slack API errors.

**Files touched:** `packages/providers/src/providers/slack/actions.ts`

### 6.8 Invocation Sweeper — `Implemented`

**What it does:** Periodically marks stale pending invocations as expired.

**Mechanism:** `setInterval` every 60 seconds calling `actions.expireStaleInvocations()`, which runs `UPDATE action_invocations SET status='expired', completed_at=now() WHERE status='pending' AND expires_at <= now()`. Uses the `idx_action_invocations_status_expires` index.

**Lifecycle:** Started by `startActionExpirySweeper(logger)` in the worker process. Stopped by `stopActionExpirySweeper()` on shutdown.

**Files touched:** `apps/worker/src/sweepers/index.ts`, `packages/services/src/actions/db.ts:expirePendingInvocations`

### 6.9 Actions List (Org Inbox) — `Implemented`

**What it does:** oRPC route for querying action invocations at the org level, consumed by the inline attention inbox tray.

**Route:** `actions.list` — org-scoped procedure accepting optional `status` filter and `limit`/`offset` pagination (default 50/0, max 100). Returns invocations with session title joined, plus total count for pagination. Dates serialized to ISO strings.

**Frontend surface:** Pending approvals are surfaced via an inline **inbox tray** rendered inside the coding session thread (`apps/web/src/components/coding-session/inbox-tray.tsx`). The tray merges three data sources: current-session WebSocket approval requests, org-level polled pending approvals (via `useOrgActions`), and org-level pending automation runs (via `useOrgPendingRuns`). The merge logic deduplicates WebSocket vs polled approvals by `invocationId` and sorts all items newest-first. The UI allows administrators to quickly review the LLM's requested parameters and click `[ Approve Once ]`, `[ Deny ]`, or `[ Approve & Always Allow ]`. A standalone actions page (`apps/web/src/app/dashboard/actions/page.tsx`) also exists with full pagination, status filtering, and grant configuration — sidebar navigation to it was removed but the route remains accessible directly.

**Automation-scoped permissions UI:** The automation detail page uses a dedicated `IntegrationPermissions` component (`apps/web/src/components/automations/integration-permissions.tsx`) that fetches action metadata dynamically via `useAutomationIntegrationActions(automationId)` → `automations.getIntegrationActions` oRPC endpoint. The backend resolver (`packages/services/src/automations/service.ts:getAutomationIntegrationActions`) checks the automation's `enabledTools` and trigger providers to determine which integrations are relevant, then returns their action definitions (name, description, risk level). The UI renders grouped integration cards with per-action `PermissionControl` selectors. Action permission modes (`allow`/`require_approval`/`deny`) are persisted as automation-level overrides via the `useSetAutomationActionMode` hook.

**Files touched:** `apps/web/src/server/routers/actions.ts`, `packages/services/src/actions/db.ts:listByOrg`, `apps/web/src/components/coding-session/inbox-tray.tsx`, `apps/web/src/hooks/use-attention-inbox.ts`

### 6.10 Integration Guide Flow — `Implemented`

**What it does:** Serves integration-specific markdown guides to the agent.

**Flow:**
1. Agent calls `proliferate actions guide --integration linear`
2. CLI sends `GET /:sessionId/actions/guide/linear` to gateway (`actions.ts` guide handler)
3. Gateway resolves the `ActionSource` and returns `source.guide`
4. For provider-backed sources, returns the static guide string embedded in the action module
5. For connector-backed sources (`connector:<id>`), auto-generates a markdown guide from cached tool definitions (name, description, risk level, parameters)

**Files touched:** `packages/providers/src/providers/registry.ts:getProviderActions`, `apps/gateway/src/api/proliferate/http/actions.ts`

### 6.11 MCP Connector System — `Implemented`

**What it does:** Enables remote MCP servers to surface tools through the Actions pipeline, giving agents access to MCP-compatible services while preserving the existing mode/approval/audit flow.

**Architecture:**
```
Org connector catalog (integrations-owned) → Gateway resolves by org at session runtime
  → McpConnectorActionSource wraps connector row
  → MCP Client connects to remote server (StreamableHTTPClientTransport)
  → tools/list → ActionDefinition[] (cached 5 min per session)
  → Merged into GET /available alongside provider-backed actions
  → POST /invoke → mode resolution (three-tier cascade) → tools/call on MCP server
```

**Key components:**
- **Connector config** (`packages/shared/src/connectors.ts`): `ConnectorConfig` type + Zod schemas. Stored as rows in `org_connectors` table, managed via Integrations CRUD routes.
- **McpConnectorActionSource** (`packages/services/src/actions/connectors/action-source.ts`): Implements `ActionSource`. Constructed with a connector config and resolved secret. `listActions()` calls MCP `tools/list`, converts JSON Schema → Zod via `jsonSchemaToZod()`, and derives risk levels. `execute()` calls MCP `tools/call` statelessly.
- **MCP client** (`packages/services/src/actions/connectors/client.ts`): Stateless — creates a fresh `Client` per `listConnectorToolsRaw()` or `callConnectorTool()` call. Uses `@modelcontextprotocol/sdk` (MIT). 15s timeout for tool listing, 30s for calls. Retries once on 404 session invalidation.
- **Risk derivation** (`packages/services/src/actions/connectors/risk.ts`): Priority: per-tool policy override → MCP annotations (`destructiveHint`→danger, `readOnlyHint`→read; destructive checked first for fail-safe) → connector default risk → "write" fallback.
- **Secret resolution**: Connector `auth.secretKey` references an org-level secret by key name. Resolved at call time via `secrets.resolveSecretValue()`. Keys never enter the sandbox.
- **Gateway integration** (`apps/gateway/src/api/proliferate/http/actions.ts`): In-memory tool cache (`Map<sessionId, CachedConnectorTools[]>`, 5-min TTL). Connector branches in `GET /available`, `GET /guide/:integration`, `POST /invoke`, `POST /approve`.
- **Integration prefix**: Connector actions use `connector:<uuid>` in the `integration` column. Mode overrides match this string. `integrationId` is `null` for connector invocations.

**CRUD surface:** Org-level connector CRUD lives in `apps/web/src/server/routers/integrations.ts` (`listConnectors`, `createConnector`, `updateConnector`, `deleteConnector`, `validateConnector`). Management UI is at Settings → Tools (`apps/web/src/app/settings/tools/page.tsx`).

**Files touched:** `packages/services/src/actions/connectors/`, `packages/services/src/connectors/`, `packages/shared/src/connectors.ts`, `packages/services/src/secrets/service.ts`, `apps/gateway/src/api/proliferate/http/actions.ts`, `apps/web/src/server/routers/integrations.ts`

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `integrations.md` | Actions → Integrations | `integrations.getToken()` (`packages/services/src/integrations/tokens.ts:getToken`) | Token resolution for provider-backed action execution |
| `integrations.md` | Actions → Integrations | `sessions.listSessionConnections()` (`packages/services/src/sessions/db.ts`) | Discovers which integrations are available for a session |
| `integrations.md` | Actions ← Integrations | `connectors.listEnabledConnectors(orgId)`, `connectors.getConnector(id, orgId)` | Org-scoped connector catalog; gateway loads enabled connectors by org at session runtime |
| `secrets-environment.md` | Actions → Secrets | `secrets.resolveSecretValue(orgId, key)` | Resolves + decrypts org secrets for connector auth at call time |
| `sessions-gateway.md` | Actions → Gateway | WebSocket broadcast events | `action_approval_request` (pending write), `action_completed` (execution success/failure, includes `status` field), `action_approval_result` (denial only) |
| `agent-contract.md` | Contract → Actions | `ACTIONS_BOOTSTRAP` in sandbox config | Bootstrap guide written to `.proliferate/actions-guide.md` |
| `agent-contract.md` | Contract → Actions | `proliferate` CLI in system prompts | Prompts document CLI usage for actions |
| `auth-orgs.md` | Actions → Auth | `orgs.getUserRole(userId, orgId)` | Admin/owner role check for approve/deny |
| `automations-runs.md` | Actions ← Automations | `automations.getIntegrationActions` oRPC endpoint | Dynamic resolver returns relevant integration actions based on automation config |
| `automations-runs.md` | Actions → Automations | "needs_human" pause/resume | Unattended approvals are run-owned |
| Providers package | Actions → Providers | `ProviderActionSource`, `ActionSource`, `ActionDefinition` | Listing + execution via the polymorphic ActionSource interface |

### Security & Auth
- **Sandbox tokens** can invoke actions but cannot approve/deny.
- **User tokens** with admin/owner role can approve/deny invocations.
- **Member role** users cannot approve/deny (403).
- **Token resolution** happens server-side via the integrations token resolver (`integrations.getToken`) — the sandbox never sees integration OAuth tokens.
- **Result redaction**: sensitive keys (`token`, `secret`, `password`, `authorization`, `api_key`, `apikey`) are stripped before DB storage. Source: `packages/services/src/actions/service.ts:redactData`
- **Result truncation**: results exceeding 10KB are structurally pruned via `truncateJson()` to preserve valid JSON. Source: `packages/providers/src/helpers/truncation.ts`

### Observability
- Service functions log via `getServicesLogger().child({ module: "actions" })`.
- Key log fields: `sessionId`, `organizationId`, `sourceId`, `actionId`, `mode`, `modeSource`, `status`, `durationMs`.
- Key log events: invocation created (with mode + mode source), action denied by policy, action auto-approved, action pending approval, expiry sweep counts.
- Gateway rate limit counter cleanup runs every 60s (in-memory, not persisted).

---

## 8. Acceptance Gates

- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] `packages/services/src/actions/*.test.ts` pass
- [ ] `apps/gateway/src/api/proliferate/http/actions.test.ts` passes
- [ ] New provider adapters implement stateless action modules and are registered in `providers/registry.ts`
- [ ] Mode resolution is recorded on every invocation (`mode` + `mode_source` columns)
- [ ] Drift hashing uses a deterministic stringifier and strips `enum`, `default`, and `description`
- [ ] JSON-aware truncation correctly prunes large payloads structurally without returning malformed JSON
- [ ] This spec is updated (file tree, data models, adapter tables)

---

## 9. Known Limitations & Tech Debt

- [ ] **In-memory rate limiting** — the per-session invocation rate limit (60/min) uses an in-memory Map in the gateway. Multiple gateway instances do not share counters. Impact: effective limit is multiplied by instance count. Expected fix: move to Redis-based rate limiting (`ratelimit:actions:<sessionId>` via `INCR` + `EXPIRE`).
- [ ] **Database connectors planned** — initial architecture unifies provider-backed + MCP connector-backed actions. Database connectors (e.g. Postgres read-only queries) are planned as a third `ActionSource` archetype but not yet implemented.
- [ ] **Unattended approval pause/resume** — cross-cutting and requires coordinated changes in `automations-runs.md` and `sessions-gateway.md`. The mode resolution cascade supports automation-scoped overrides, but the full pause/resume flow for unattended runs is not yet wired end-to-end.
- [ ] **Drift hashing stability** — relies on stable JSON Schema conversion; changes to `zodToJsonSchema()` can cause false-positive drift and should be treated as a breaking change. Source: `packages/providers/src/helpers/schema.ts`.
- [ ] **Legacy grant CLI handlers** — `packages/sandbox-mcp/src/actions-grants.ts` still contains grant request/list command handlers from the old CAS grant system. These are no longer functional (the `action_grants` table and gateway grant routes have been removed) and should be cleaned up.
- [x] **Grant system removed** — the old CAS (compare-and-swap) grant system (`action_grants` table, `grants.ts`, `grants-db.ts`) has been completely replaced by the three-mode permissioning cascade. Mode overrides stored as JSONB on `organizations.action_modes` and `automations.action_modes` provide equivalent functionality without per-invocation budget tracking.
- [x] **Static adapter registry unified** — addressed by the `ActionSource` polymorphic interface and `packages/providers/` package. All action sources (provider-backed and connector-backed) implement the same `ActionSource` interface and flow through the same mode resolution pipeline.
- [x] **Connector scope is org-scoped** — addressed. Connectors are stored in the `org_connectors` table, managed via Integrations CRUD routes, and loaded by org in the gateway. Source: `apps/web/src/app/settings/tools/page.tsx`, `apps/web/src/hooks/use-org-connectors.ts`.
- [x] **Connector 404 session recovery** — addressed. `callConnectorTool` retries once on 404 session invalidation by re-initializing a fresh connection. Source: `packages/services/src/actions/connectors/client.ts`.
- [x] **Dedicated connector management UI** — addressed at org scope. Settings → Tools page provides add/edit/remove/validate flow with presets, org secret picker, and inline validation diagnostics. Source: `apps/web/src/app/settings/tools/page.tsx`.


---
# FILE: docs/specs/agent-contract.md
---

# Agent Contract — System Spec

## 1. Scope & Purpose

### In Scope
- System prompt modes: setup, coding, automation — what each injects and how they differ
- OpenCode tool schemas: `verify`, `save_snapshot`, `save_service_commands`, `automation.complete`, `request_env_variables`
- Capability injection: how tools and instructions are registered in the sandbox OpenCode config
- Tool input/output contracts and validation rules
- Agent/model configuration and selection

### Out of Scope
- How gateway-mediated tools are executed at runtime by the gateway hub — see `sessions-gateway.md`
- How tool files are written into the sandbox filesystem (provider boot) — see `sandbox-providers.md`
- Action tools / external-service operations (`proliferate actions`) — see `actions.md`
- Automation run lifecycle that calls `automation.complete` — see `automations-runs.md` §6
- LLM proxy key generation and model routing — see `llm-proxy.md`

### Mental Model

The agent contract defines **what the agent can do and how it should behave** inside a sandbox. It is the interface between the Proliferate platform and the OpenCode coding agent, expressed through three artifacts:

1. **System prompts** — mode-specific instructions that shape agent behavior
2. **Tool definitions** — TypeScript modules written into the sandbox that give the agent platform capabilities
3. **OpenCode configuration** — JSON config that sets the model, provider, plugin, and permissions

The gateway selects a system prompt based on session type and client type, then both providers (Modal and E2B) write identical tool files and config into the sandbox. OpenCode discovers tools by scanning `.opencode/tool/` at startup.

**Core entities:**
- **System prompt** — a mode-specific instruction string injected as the agent's system message. Three modes: setup, coding, automation.
- **Tool definition** — a TypeScript module + companion `.txt` description file placed in `{repoDir}/.opencode/tool/`. Defines the tool's schema and an `execute()` implementation that either (a) performs a synchronous gateway callback for gateway-mediated tools, or (b) runs locally for sandbox-local tools (`request_env_variables`).
- **OpenCode config** — JSON written to `{repoDir}/opencode.json` and `/home/user/.config/opencode/opencode.json`. Sets model, provider, plugin, permissions, and MCP servers.
- **Agent config** — model ID and optional tools array stored per-session in the database.

**Key invariants:**
- Mode-scoped tool injection: setup-only tools (`save_service_commands`) are injected only for setup sessions. Shared tools (`verify`, `save_snapshot`, `request_env_variables`, `automation.complete`) are injected for all sessions. The system prompt controls which tools the agent is encouraged to use.
- Four of five tools are gateway-mediated (executed server-side via synchronous HTTP callbacks). Only `request_env_variables` runs in the sandbox.
- Tool definitions are string templates exported from `packages/shared/src/opencode-tools/index.ts`. They are the single source of truth for tool schemas.
- The system prompt can be overridden per-session via `session.system_prompt` in the database.

---

## 2. Core Concepts

### System Prompt Modes — `Implemented`
Three prompt builders produce mode-specific system messages. The gateway selects one based on `session_type` and `client_type`. All prompts identify the agent as running inside **Proliferate** and document the `proliferate` CLI capabilities (services, actions, local workflow via `npx @proliferate/cli`). The setup prompt additionally includes a UI handoff line telling the agent to direct users to the "Done — Save Snapshot" button when setup is complete.
- Key detail agents get wrong: automation mode extends coding mode (it appends to it), not replaces it.
- Reference: `packages/shared/src/prompts.ts`

### Gateway-Mediated Tools (Synchronous Callbacks) — `Implemented`
Most platform tools are executed **server-side** by the gateway via synchronous sandbox-to-gateway HTTP callbacks. Tool execution does not use SSE interception or PATCH-based result delivery.

1. OpenCode invokes a tool.
2. For gateway-mediated tools (`verify`, `save_snapshot`, `save_service_commands`, `automation.complete`), the tool `execute()` issues a blocking `POST /proliferate/:sessionId/tools/:toolName` to the gateway using the shared `callGatewayTool()` helper.
3. The gateway authenticates the request using the sandbox HMAC token (`Authorization: Bearer <token>`, `source: "sandbox"`).
4. The gateway enforces idempotency by `tool_call_id` using in-memory inflight/completed caches (with a 5-minute retention window for completed results).
5. The gateway executes the tool handler and returns the result in the HTTP response body.

Sandbox-side retry requirement:
- The `callGatewayTool()` helper retries network-level failures (`ECONNRESET`, `ECONNREFUSED`, `fetch failed`, timeout) with exponential backoff (500ms base, up to 5 retries) using the same `tool_call_id`.
- This is required for snapshot boundaries: `save_snapshot` may freeze the sandbox and drop the active TCP socket mid-request (see Snapshot TCP-Drop Retry Trap below).

- Key detail agents get wrong: `request_env_variables` is NOT gateway-mediated — it runs in the sandbox. The gateway detects it via SSE events to show the UI prompt.
- Reference: `apps/gateway/src/api/proliferate/http/tools.ts`, `apps/gateway/src/hub/capabilities/tools/`, `packages/shared/src/opencode-tools/index.ts`

### Snapshot TCP-Drop Retry Trap — `Implemented`
`save_snapshot` can freeze the sandbox at the provider layer, which tears down active TCP sockets. When the sandbox resumes, an in-flight callback request from the sandbox tool wrapper may surface as `fetch failed`, `ECONNRESET`, or `ETIMEDOUT`.

Sandbox-side requirement:
- Generate `tool_call_id` once per logical tool execution.
- Retry network-level callback failures with the **same** `tool_call_id`.
- Keep retrying until success or a non-retriable application error.

Gateway-side requirement:
- Use in-memory inflight dedup (`tool_call_id` -> `Promise`) and completed-result cache to ensure retries do not duplicate side effects.

This pair guarantees that snapshot-boundary drops are recoverable without double execution.

Reference wrapper loop (from `TOOL_CALLBACK_HELPER` in `packages/shared/src/opencode-tools/index.ts`):

```ts
async function callGatewayTool(toolName, toolCallId, args) {
	const url = GATEWAY_URL + "/proliferate/" + SESSION_ID + "/tools/" + toolName;
	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		try {
			const res = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer " + AUTH_TOKEN,
				},
				body: JSON.stringify({ tool_call_id: toolCallId, args }),
				signal: AbortSignal.timeout(120000),
			});
			if (!res.ok) {
				return { success: false, result: "Gateway error " + res.status };
			}
			return await res.json();
		} catch (err) {
			const isRetryable = err?.cause?.code === "ECONNRESET"
				|| err?.message?.includes("fetch failed")
				|| err?.message?.includes("ECONNRESET")
				|| err?.message?.includes("ECONNREFUSED")
				|| err?.name === "AbortError";
			if (isRetryable && attempt < MAX_RETRIES) {
				await new Promise(r => setTimeout(r, RETRY_BASE_MS * Math.pow(2, attempt)));
				continue;
			}
			throw err;
		}
	}
}
```

### OpenCode Tool Discovery — `Implemented`
OpenCode automatically discovers tools by scanning `{repoDir}/.opencode/tool/*.ts` at startup. Tools are not registered in `opencode.json` — they are filesystem-discovered.
- Key detail agents get wrong: the `opencode.json` config does not list tools. Tool registration is purely file-based.
- Reference: `packages/shared/src/sandbox/opencode.ts:getOpencodeConfig`

### Agent/Model Configuration — `Implemented`
A static registry maps agent types to supported models. Currently only the `opencode` agent type exists, with three model options. Model IDs are transformed between internal canonical format, OpenCode format, and Anthropic API format.
- Key detail agents get wrong: OpenCode model IDs use a different format (`anthropic/claude-opus-4-6`) than canonical IDs (`claude-opus-4.6`) or API IDs (`claude-opus-4-6`).
- Reference: `packages/shared/src/agents.ts`

---

## 3. File Tree

```
packages/shared/src/
├── prompts.ts                          # System prompt builders (setup/coding/automation)
├── agents.ts                           # Agent/model registry and ID transforms
├── opencode-tools/
│   └── index.ts                        # All tool definitions (string templates) + descriptions
│                                       #   incl. TOOL_CALLBACK_HELPER (shared HTTP retry logic)
└── sandbox/
    ├── config.ts                       # Plugin template, env instructions, paths, ports
    └── opencode.ts                     # OpenCode config generator, readiness check

apps/gateway/src/
├── api/proliferate/http/
│   └── tools.ts                        # POST /:sessionId/tools/:toolName (sandbox callbacks)
├── lib/
│   ├── session-store.ts                # buildSystemPrompt() — mode selection logic
│   └── opencode.ts                     # OpenCode HTTP helpers (create session, send prompt, etc.)
└── hub/capabilities/tools/
    ├── index.ts                        # Intercepted tools registry
    ├── verify.ts                       # verify handler (S3 upload)
    ├── save-snapshot.ts                # save_snapshot handler (provider snapshot)
    ├── automation-complete.ts          # automation.complete handler (run finalization)
    └── save-service-commands.ts        # save_service_commands handler (configuration update)
```

---

## 4. Data Models & Schemas

### Core TypeScript Types

```typescript
// packages/shared/src/agents.ts
type ModelId = "claude-opus-4.6" | "claude-opus-4.5" | "claude-sonnet-4";
type AgentType = "opencode";

interface AgentConfig {
  agentType: AgentType;
  modelId: ModelId;
}

// apps/gateway/src/hub/capabilities/tools/index.ts
interface InterceptedToolResult {
  success: boolean;
  result: string;
  data?: Record<string, unknown>;
}

interface InterceptedToolHandler {
  name: string;
  execute(hub: SessionHub, args: Record<string, unknown>): Promise<InterceptedToolResult>;
}
```

### Tool Callback Request/Response

```typescript
// POST /proliferate/:sessionId/tools/:toolName
// Auth: sandbox HMAC token (Authorization: Bearer <token>)

// Request body
interface ToolCallbackRequest {
  tool_call_id: string;   // Unique per tool call, used for idempotency
  args: Record<string, unknown>;
}

// Response body (200 OK)
interface ToolCallbackResponse {
  success: boolean;
  result: string;
  data?: Record<string, unknown>;
}
```

### Model ID Transforms

| Context | `claude-opus-4.6` | `claude-opus-4.5` | `claude-sonnet-4` |
|---------|-------------------|--------------------|--------------------|
| Canonical (DB, internal) | `claude-opus-4.6` | `claude-opus-4.5` | `claude-sonnet-4` |
| OpenCode config | `anthropic/claude-opus-4-6` | `anthropic/claude-opus-4-5` | `anthropic/claude-sonnet-4-5` |
| Anthropic API | `claude-opus-4-6` | `claude-opus-4-5-20251101` | `claude-sonnet-4-20250514` |

Source: `packages/shared/src/agents.ts:toOpencodeModelId`, `toAnthropicApiModelId`

### Session Agent Config (DB column)

```typescript
// Stored in sessions.agent_config JSONB column
{
  modelId?: string;   // Canonical model ID
  tools?: string[];   // Optional tool filter (not currently used for filtering)
}
```

Source: `apps/gateway/src/lib/session-store.ts:SessionRecord`

### Session Tool Invocations (DB table)

```typescript
// packages/db/src/schema/schema.ts — session_tool_invocations
{
  id: uuid;                // Primary key
  sessionId: uuid;         // FK → sessions.id (cascade delete)
  organizationId: text;    // FK → organization.id (cascade delete)
  toolName: text;
  toolCallId: text;        // Idempotency key
  status: text;            // e.g. "completed", "failed"
  createdAt: timestamp;
}
// Indexes: session, organization, status
```

Source: `packages/db/src/schema/schema.ts`

---

## 5. Conventions & Patterns

### Do
- Define new tool schemas in `packages/shared/src/opencode-tools/index.ts` as string template exports — this keeps all tool definitions in one place.
- Export both a `.ts` tool definition and a `.txt` description file for each tool — OpenCode uses both.
- Use Zod validation in gateway handlers for tools with complex schemas (e.g., `save_service_commands`). Simpler tools (`verify`, `save_snapshot`) use inline type coercion.
- Return `InterceptedToolResult` from all handlers — the `success` field drives error reporting.
- Use the shared `callGatewayTool()` helper (from `TOOL_CALLBACK_HELPER`) in tool `execute()` implementations to get automatic retry-on-network-error with `tool_call_id` idempotency.

### Don't
- Register tools in `opencode.json` — OpenCode discovers them by scanning `.opencode/tool/`.
- Add new `console.*` calls in gateway tool handlers — use `@proliferate/logger`.
- Modify system prompts without considering all three modes — automation extends coding, so changes to coding affect automation too.
- Add tool-specific logic to providers — providers write files, the gateway handles execution.

### Error Handling

```typescript
// Standard pattern for gateway tool handlers
// Source: apps/gateway/src/hub/capabilities/tools/save-service-commands.ts
async execute(hub, args): Promise<InterceptedToolResult> {
  const parsed = ArgsSchema.safeParse(args);
  if (!parsed.success) {
    return {
      success: false,
      result: `Invalid arguments: ${parsed.error.issues.map(i => i.message).join(", ")}`,
    };
  }
  try {
    // ... perform operation
    return { success: true, result: "...", data: { ... } };
  } catch (err) {
    return {
      success: false,
      result: `Failed to ...: ${err instanceof Error ? err.message : "Unknown error"}`,
    };
  }
}
```

### Reliability
- **Gateway-mediated tool execution**: Tools are executed via blocking sandbox-to-gateway HTTP callbacks (`POST /proliferate/:sessionId/tools/:toolName`) and return results synchronously. No SSE interception or PATCH-based result delivery.
- **Idempotency**: Tool calls are idempotent by `tool_call_id` via in-memory inflight/completed caches in the gateway tools router. `automation.complete` additionally accepts a `completion_id` idempotency key at the domain level.
- **Retry semantics**: The `callGatewayTool()` helper retries on network-level failures (`ECONNRESET`, `ECONNREFUSED`, `fetch failed`, `AbortError`) with exponential backoff (500ms base, max 5 retries) using the same `tool_call_id`. The gateway returns the cached result for duplicate `tool_call_id`s.
- **Timeouts**: Tool callbacks use a 120-second `AbortSignal.timeout`. OpenCode readiness check uses exponential backoff (200ms base, 1.5x, max 2s per attempt, 30s total). Source: `packages/shared/src/sandbox/opencode.ts:waitForOpenCodeReady`

### Testing Conventions
- Tool handler tests live alongside handlers in gateway tests.
- Test gateway tool handlers by mocking `SessionHub` methods (e.g., `hub.uploadVerificationFiles`, `hub.saveSnapshot`) and by exercising the tools route (idempotency by `tool_call_id`).
- Verify Zod validation rejects malformed args for `save_service_commands`.
- System prompt tests: assert each mode includes the expected tool references and omits out-of-scope ones.

---

## 6. Subsystem Deep Dives

### 6.1 System Prompt Mode Selection — `Implemented`

**What it does:** Selects the appropriate system prompt based on session type and client type.

**Happy path:**
1. Gateway loads session context via `loadSessionContext()` (`apps/gateway/src/lib/session-store.ts:85`)
2. If `session.system_prompt` is set (custom override), use it directly (`session-store.ts:223-229`)
3. Otherwise, call `buildSystemPrompt(session_type, repoName, client_type)` (`session-store.ts:71-83`)
4. Selection logic:
   - `session_type === "setup"` -> `getSetupSystemPrompt(repoName)`
   - `client_type === "automation"` -> `getAutomationSystemPrompt(repoName)`
   - Otherwise -> `getCodingSystemPrompt(repoName)`

**Mode differences:**

| Aspect | Setup | Coding | Automation |
|--------|-------|--------|------------|
| Base prompt | Unique | Unique | Extends Coding |
| Goal | Get repo running, save snapshot | Implement changes, verify | Complete task, report outcome |
| `verify` | Required before snapshot | Encouraged | Available |
| `save_snapshot` | Required at end | Available | Available |
| `request_env_variables` | Emphasized | Available | Available |
| `save_service_commands` | Emphasized | Not available | Not available |
| `automation.complete` | Not mentioned | Not mentioned | **Mandatory** |
| Source code edits | Forbidden | Encouraged | Encouraged |
| `proliferate` CLI | Documented | Documented | Documented |
| Actions integration | Documented | Documented | Documented |

**Files touched:** `packages/shared/src/prompts.ts`, `apps/gateway/src/lib/session-store.ts`

### 6.2 Tool Definitions and Schemas

**What it does:** Defines all platform tools as TypeScript string templates that get written into sandbox filesystems.

Each tool is exported as two constants from `packages/shared/src/opencode-tools/index.ts`:
- `*_TOOL` — the `.ts` module source (OpenCode tool API)
- `*_DESCRIPTION` — the `.txt` guidance for agents

All gateway-mediated tools share the `TOOL_CALLBACK_HELPER` — a common `callGatewayTool()` function template that handles the synchronous HTTP callback to the gateway with retry logic for the Snapshot TCP-Drop scenario.

#### `verify` tool — `Implemented`

**Schema:**
```typescript
{
  folder?: string  // Default: ".proliferate/.verification/"
}
```

**Behavior:** Gateway executes server-side (gateway-mediated via tool callback), uploads files from the folder to S3, returns S3 key prefix. Agent collects evidence (screenshots, test logs) before calling.

**Style note:** Uses raw `export default { name, description, parameters, execute }` format (not the `tool()` API).

#### `save_snapshot` tool — `Implemented`

**Schema:**
```typescript
{
  message?: string  // Brief summary of what's configured
}
```

**Behavior:** Gateway executes server-side (gateway-mediated via tool callback), triggers provider snapshot. For setup sessions: updates configuration snapshot. For coding sessions: updates session snapshot. Returns `{ snapshotId, target }`.

#### `save_service_commands` tool — `Implemented`

**Schema:**
```typescript
{
  commands: Array<{
    name: string       // 1-100 chars
    command: string    // 1-1000 chars
    cwd?: string       // max 500 chars, relative to workspace root
    workspacePath?: string  // max 500 chars, for multi-repo setups
  }>  // min 1, max 10 items
}
```

**Behavior:** Gateway executes server-side (gateway-mediated via tool callback), validates with Zod, persists to configuration `service_commands` JSONB. Requires `session.configuration_id`. Returns `{ configurationId, commandCount }`.

**Scope:** Setup sessions only. The tool file is only injected into sandboxes when `sessionType === "setup"`. The gateway handler also rejects calls from non-setup sessions at runtime as a defense-in-depth measure.

#### `automation.complete` tool — `Implemented`

**Schema:**
```typescript
{
  run_id: string            // Required
  completion_id: string     // Required (idempotency key)
  outcome: "succeeded" | "failed" | "needs_human"
  summary_markdown?: string
  citations?: string[]
  diff_ref?: string
  test_report_ref?: string
  side_effect_refs?: string[]
}
```

**Behavior:** Gateway executes server-side (gateway-mediated via tool callback), updates run record with outcome + completion JSON, updates trigger event status. Registered under both `automation.complete` and `automation_complete` names. Source: `apps/gateway/src/hub/capabilities/tools/index.ts:41`

#### `request_env_variables` tool — `Implemented`

**Schema:**
```typescript
{
  keys: Array<{
    key: string             // Env var name
    description?: string
    type?: "env" | "secret" // env = file only, secret = file + encrypted DB
    required?: boolean      // Default: true
    suggestions?: Array<{
      label: string
      value?: string        // Preset value
      instructions?: string // Setup instructions
    }>
  }>
}
```

**Behavior:** NOT gateway-mediated. Runs in sandbox, returns immediately with a summary string. The gateway detects this tool call via SSE events and triggers a form in the user's UI. User-submitted values are written to `/tmp/.proliferate_env.json`. The agent then extracts values with `jq` into config files.

**Files touched:** `packages/shared/src/opencode-tools/index.ts`

### 6.3 Capability Injection Pipeline — `Implemented`

**What it does:** Writes tool files, config, plugin, and instructions into the sandbox so OpenCode can discover them.

**Happy path:**
1. Provider (Modal or E2B) calls `setupEssentialDependencies()` during sandbox boot (`packages/shared/src/providers/modal-libmodal.ts:988`, `packages/shared/src/providers/e2b.ts:568`)
2. Plugin written to `/home/user/.config/opencode/plugin/proliferate.mjs` — minimal SSE-mode plugin (`PLUGIN_MJS` from `packages/shared/src/sandbox/config.ts:16-31`)
3. Tool `.ts` files + `.txt` description files written to `{repoDir}/.opencode/tool/` (count varies by mode — see mode-scoped injection rules below)
4. Pre-installed `package.json` + `node_modules/` copied from `/home/user/.opencode-tools/` to `{repoDir}/.opencode/tool/`
5. OpenCode config written to both `{repoDir}/opencode.json` and `/home/user/.config/opencode/opencode.json`
6. Environment instructions appended to `{repoDir}/.opencode/instructions.md` (from `ENV_INSTRUCTIONS` in `config.ts`)
7. Actions bootstrap guide written to `{repoDir}/.proliferate/actions-guide.md` (from `ACTIONS_BOOTSTRAP` in `config.ts`). This guide identifies the agent as running inside Proliferate, documents the `proliferate actions` CLI, and mentions the local CLI (`npx @proliferate/cli`).
8. OpenCode server started: `cd {repoDir} && opencode serve --port 4096 --hostname 0.0.0.0`
9. Gateway waits for readiness via `waitForOpenCodeReady()` with exponential backoff

**Mode-scoped injection rules:**
- `save_service_commands` is injected only when `sessionType === "setup"`.
- When `sessionType !== "setup"`, providers explicitly remove `save_service_commands` files (cleanup from setup snapshots that may include them).
- Shared tools (`verify`, `save_snapshot`, `request_env_variables`, `automation.complete`) are injected for all sessions.

**Sandbox filesystem layout after injection:**
```
/home/user/.config/opencode/
├── opencode.json                        # Global config
└── plugin/
    └── proliferate.mjs                  # SSE-mode plugin (no event pushing)

{repoDir}/
├── opencode.json                        # Local config (same content)
├── .opencode/
│   ├── instructions.md                  # ENV_INSTRUCTIONS (services, tools, setup hints)
│   └── tool/
│       ├── verify.ts / verify.txt
│       ├── request_env_variables.ts / request_env_variables.txt
│       ├── save_snapshot.ts / save_snapshot.txt
│       ├── automation_complete.ts / automation_complete.txt
│       ├── save_service_commands.ts / save_service_commands.txt  [setup only]
│       ├── package.json                 # Pre-installed deps
│       └── node_modules/                # Pre-installed deps
└── .proliferate/
    └── actions-guide.md                 # CLI actions documentation
```

**Edge cases:**
- Config is written to both global and local paths for OpenCode discovery reliability.
- File write mechanics differ by provider (Modal uses shell commands, E2B uses `files.write` SDK). For provider-specific boot details, see `sandbox-providers.md` §6.

**Files touched:** `packages/shared/src/sandbox/config.ts`, `packages/shared/src/sandbox/opencode.ts`, `packages/shared/src/providers/modal-libmodal.ts`, `packages/shared/src/providers/e2b.ts`

### 6.4 OpenCode Configuration — `Implemented`

**What it does:** Generates the `opencode.json` that configures the agent's model, provider, permissions, and MCP servers.

**Generated config structure:**
```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-opus-4-6",
  "provider": {
    "anthropic": {
      "options": {
        "baseURL": "https://llm-proxy.example.com",
        "apiKey": "..."
      }
    }
  },
  "server": { "port": 4096, "hostname": "0.0.0.0" },
  "plugin": ["/home/user/.config/opencode/plugin/proliferate.mjs"],
  "permission": { "*": "allow", "question": "deny" },
  "mcp": {
    "playwright": {
      "type": "local",
      "command": ["playwright-mcp", "--headless", "--browser", "chromium",
                  "--no-sandbox", "--isolated", "--caps", "vision"],
      "enabled": true
    }
  }
}
```

**Key decisions:**
- `permission: { "*": "allow", "question": "deny" }` — agent can run any command, but cannot use native browser dialogs.
- Playwright MCP is always enabled with headless Chromium and vision capabilities.
- Server binds to `0.0.0.0:4096` so the gateway can reach it via tunnel URL.

**Files touched:** `packages/shared/src/sandbox/opencode.ts:getOpencodeConfig`

### 6.5 Gateway-Mediated Tools Contract — `Implemented`

**What it does:** Defines the contract between sandbox-side tool implementations and gateway-side handlers using synchronous HTTP callbacks.

**Gateway-mediated vs sandbox-local tools:**

| Tool | Gateway-mediated? | Reason |
|------|-------------------|--------|
| `verify` | Yes | Needs S3 credentials |
| `save_snapshot` | Yes | Needs provider API access |
| `automation.complete` | Yes | Needs database access |
| `save_service_commands` | Yes | Needs database access |
| `request_env_variables` | No | Runs locally; gateway uses SSE events to drive UI |

**Callback request:**
- Method: `POST /proliferate/:sessionId/tools/:toolName`
- Auth: sandbox HMAC token (`Authorization: Bearer <token>`, verified as `source: "sandbox"`)
- Body:
  - `tool_call_id: string` (unique per tool call, used for idempotency)
  - `args: Record<string, unknown>`

**Callback response:**
- `200`: `{ success: boolean, result: string, data?: object }`
- `4xx/5xx`: standard error response

**Idempotency:** The gateway tools router maintains in-memory inflight (`tool_call_id` -> `Promise<ToolCallResult>`) and completed-result (`tool_call_id` -> `ToolCallResult`, 5-minute retention) caches. Duplicate calls return the cached result without re-executing. The `session_tool_invocations` DB table records tool calls for audit and observability.

**Handler contract:** Every gateway tool handler implements `InterceptedToolHandler` — a `name` string and an `execute(hub, args)` method returning `InterceptedToolResult { success, result, data? }`. Handlers are registered in `apps/gateway/src/hub/capabilities/tools/index.ts`.

**Registration:** `automation.complete` is registered under two names (`automation.complete` and `automation_complete`) to handle both dot-notation and underscore-notation from agents. Source: `apps/gateway/src/hub/capabilities/tools/index.ts:40-41`

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `sessions-gateway.md` | This -> Gateway | `POST /proliferate/:sessionId/tools/:toolName` | Gateway executes tool handlers via synchronous callbacks; tool schemas defined here |
| `sandbox-providers.md` | This -> Providers | Tool file templates + `getOpencodeConfig()` | Providers consume definitions, write files into sandbox |
| `automations-runs.md` | Runs -> This | `automation.complete` tool schema | Automation runs inject `run_id`/`completion_id` via system prompt; agent calls tool to finalize |
| `repos-prebuilds.md` | This -> Prebuilds | `save_service_commands` | Tool persists config to configuration records |
| `secrets-environment.md` | Secrets -> This | `request_env_variables` + `/tmp/.proliferate_env.json` | Secrets written to env file; tool requests new ones |
| `llm-proxy.md` | Proxy -> This | `anthropicBaseUrl` / `anthropicApiKey` in OpenCode config | LLM proxy URL embedded in agent config |
| `actions.md` | This -> Actions | `proliferate actions` CLI in system prompts | Prompts document CLI usage; actions spec owns the runtime |

### Security & Auth
- Gateway-mediated tools run on the gateway with full DB/S3/provider access — sandboxes never have these credentials.
- Tool callbacks authenticate with the sandbox HMAC token and require `source: "sandbox"` — requests from other sources are rejected with 403.
- `request_env_variables` instructs agents to never `cat` or `echo` the env file directly — only extract specific keys with `jq`.
- OpenCode permissions deny `question` tool to prevent native browser dialogs.
- System prompts instruct agents never to ask for API keys for connected integrations (tokens resolved server-side).

### Observability
- Gateway tool handlers log via `@proliferate/logger` with `sessionId` context.
- Tool callback executions log `toolName`, `toolCallId`, duration, and final status. The `session_tool_invocations` DB table provides an audit trail.
- `waitForOpenCodeReady()` logs latency metrics with `[P-LATENCY]` prefix.

---

## 8. Acceptance Gates

- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] Gateway tool handler tests pass
- [ ] System prompts reference only tools that exist in `packages/shared/src/opencode-tools/index.ts`
- [ ] Tool definitions in `opencode-tools/index.ts` match handler schemas in `apps/gateway/src/hub/capabilities/tools/`
- [ ] This spec is updated (file tree, tool schemas, mode table)

---

## 9. Known Limitations & Tech Debt

- [ ] **`automation.complete` not yet mode-gated** — `automation.complete` is injected for all sessions, not just automation clients. The system prompt controls usage, but the tool file is present in non-automation sessions. Impact: possible out-of-mode calls. Expected fix: inject `automation_complete.ts` only when `clientType === "automation"`.
- [ ] **`save_env_files` tool pending removal** — The `save_env_files` tool and its gateway handler (`apps/gateway/src/hub/capabilities/tools/save-env-files.ts`) still exist in the codebase but are targeted for removal. It is injected only for setup sessions. Expected fix: remove tool definition, handler, and provider injection code.
- [ ] **Two tool definition styles** — `verify` uses raw `export default { name, description, parameters }` while other tools use the `tool()` plugin API from `@opencode-ai/plugin`. Impact: inconsistent authoring; no functional difference. Expected fix: migrate `verify` to `tool()` API.
- [ ] **Dual registration for automation.complete** — Registered under both `automation.complete` and `automation_complete` to handle agent variation. Impact: minor registry bloat. Expected fix: standardize on one name once agent behavior is stable.
- [ ] **No tool versioning** — Tool schemas are string templates with no version tracking. If a schema changes, running sessions continue with the old version until sandbox restart. Impact: potential schema mismatch during deploys. Expected fix: version stamp in tool file path or metadata.
- [ ] **Custom system prompt bypass** — `session.system_prompt` in the DB overrides mode selection entirely. No validation that the custom prompt includes required tool instructions. Impact: automation sessions with custom prompts may not call `automation.complete`. Expected fix: append mode-critical instructions even when custom prompt is set.
- [ ] **In-memory idempotency only** — Tool call idempotency uses in-memory maps on the gateway instance. If the gateway restarts between a tool call and its retry, the cached result is lost. The `session_tool_invocations` DB table exists for audit but is not currently used for idempotency lookups. Impact: rare double-execution on gateway restart during snapshot thaw. Expected fix: use `session_tool_invocations` as the idempotency store.


---
# FILE: docs/specs/auth-orgs.md
---

# Auth, Orgs & Onboarding — System Spec

## 1. Scope & Purpose

### In Scope
- User authentication via better-auth (email/password + GitHub/Google OAuth)
- Email verification flow (conditional, Resend-based)
- Auth provider metadata (`google`/`github`/`email`) for web login UI
- Gateway WebSocket token issuance via authenticated oRPC procedure
- Organization model: personal orgs, team orgs, slug-based identity
- Member management: roles (owner/admin/member), role changes, removal
- Invitation system: create, email delivery, accept/reject, expiry
- Domain suggestions: email-domain-based org matching for auto-join
- Onboarding flow: status checks, trial activation, finalization
- Trial activation trigger (credit provisioning handoff to billing)
- API keys: creation via CLI device auth, verification for Bearer auth
- Admin: super-admin detection, user/org listing, impersonation, org switching
- Auth middleware chain: session resolution, API key fallback, impersonation overlay

### Out of Scope
- Trial credit amounts and billing policy (shadow balance, metering, gating) — see `billing-metering.md`
- Gateway auth middleware for WebSocket/HTTP streaming — see `sessions-gateway.md` §7
- CLI device auth flow (device code create/authorize/poll) — see `cli.md` §6
- Integration OAuth for GitHub/Sentry/Linear/Slack via Nango — see `integrations.md`

### Mental Model

Authentication and organization management form the identity layer of Proliferate. A personal organization is created for each user at signup (best-effort — see §9). Users can also create team organizations or be invited to existing ones. All resource-scoped operations (sessions, repos, secrets, automations) are bound to an organization via `activeOrganizationId` on the auth session.

The system uses better-auth as the authentication framework, with two plugins: `organization` (multi-tenant org management, invitations) and `apiKey` (CLI token authentication). Auth state flows through three possible paths: cookie-based sessions, API key Bearer tokens, or a dev-mode bypass.

Super-admins can impersonate any user via a cookie-based overlay that transparently replaces the effective user/org context without modifying the actual session.

**Core entities:**
- **User** — authenticated identity with email, name, and optional OAuth accounts
- **Organization** — tenant boundary for all resources; either personal (auto-created) or team
- **Member** — join record linking a user to an org with a role (owner/admin/member)
- **Invitation** — pending invite with email, role, expiry, and accept/reject lifecycle
- **Auth session** — better-auth session with `activeOrganizationId` for org scoping
- **API key** — long-lived Bearer token for CLI authentication

**Intended invariants (best-effort, not guaranteed):**
- Every user should have a personal organization — created in a `user.create.after` database hook, but uses `ON CONFLICT (slug) DO NOTHING` so it silently fails if the generated slug collides (see §9)
- Auth sessions should have `activeOrganizationId` set — populated in a `session.create.before` hook from the user's first membership, but returns the session unchanged if the user has no memberships
- Only owners can modify member roles or remove members — enforced by better-auth's organization plugin endpoints
- Owner role cannot be changed or removed through better-auth's member management endpoints
- Domain update logic exists in the service layer with owner-only checks, but is not wired to any route (see §9)
- Impersonation requires super-admin status (email in `SUPER_ADMIN_EMAILS` env var)

---

## 2. Core Concepts

### better-auth
better-auth is the authentication framework providing email/password and OAuth login, session management, and plugin-based extensions. Proliferate uses two plugins: `organization` for multi-tenancy and `apiKey` for CLI tokens.
- Key detail agents get wrong: better-auth manages the `user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`, and `apikey` tables directly. Do not modify these schemas outside of better-auth's migration flow.
- Reference: `apps/web/src/lib/auth.ts`

### Organization Plugin
The better-auth organization plugin registers server-side API routes under `/api/auth/organization/*` for org CRUD, membership, invitation lifecycle, and org switching. These are first-class backend endpoints — auto-registered by the plugin at server startup, not frontend-only logic. Proliferate layers custom read-only logic (domain suggestions, onboarding status, billing fields) on top via oRPC.
- Key detail agents get wrong: Org/member/invitation _writes_ are handled by better-auth's plugin endpoints, invoked from the frontend via the client SDK (`organization.create()`, `organization.setActive()`, `organization.updateMemberRole()`, `organization.removeMember()`, `organization.inviteMember()`, `organization.acceptInvitation()`). The custom oRPC routes only _read_ (list orgs, list members, list invitations, get domain suggestions).
- Reference: `apps/web/src/lib/auth.ts:organization()`

### Impersonation
A cookie-based overlay that lets super-admins act as another user. The `requireAuth()` helper checks for the impersonation cookie and swaps the effective user/org context transparently.
- Key detail agents get wrong: Impersonation does not create a new session. It overlays the existing super-admin session with different effective user/org IDs. The `impersonation` context field tracks the real admin's identity for audit.
- Reference: `apps/web/src/lib/auth-helpers.ts:requireAuth`, `apps/web/src/lib/super-admin.ts`

---

## 3. File Tree

```
apps/web/src/lib/
├── auth.ts                          # better-auth instance + config
├── auth-helpers.ts                  # getSession, requireAuth, API key resolution
├── super-admin.ts                   # isSuperAdmin, impersonation cookie helpers
├── billing.ts                       # isBillingEnabled (used by onboarding)

apps/web/src/server/routers/
├── middleware.ts                    # protectedProcedure, orgProcedure
├── auth.ts                          # Auth provider metadata + ws token issuance
├── orgs.ts                         # Org list/get, members, invitations, domains
├── onboarding.ts                   # Status, startTrial, markComplete, finalize
├── admin.ts                        # Super-admin status, listing, impersonation

packages/services/src/orgs/
├── index.ts                        # Re-exports
├── db.ts                           # Drizzle queries for org/member/invitation
├── service.ts                      # Business logic orchestration
├── mapper.ts                       # DB row → API type transformations

packages/services/src/onboarding/
├── index.ts                        # Re-exports
├── db.ts                           # Onboarding-specific queries
├── service.ts                      # Status computation, repo upsert

packages/services/src/admin/
├── index.ts                        # Re-exports
├── db.ts                           # Admin queries (all users/orgs)
├── service.ts                      # Impersonation validation
├── mapper.ts                       # DB row → admin API types

packages/services/src/users/
├── index.ts                        # Re-exports
├── db.ts                           # User lookup (findById)

packages/db/src/schema/
├── auth.ts                         # user, session, account, verification,
│                                   # organization, member, invitation, apikey tables

packages/shared/src/
├── auth.ts                         # JWT helpers (verifyToken, signServiceToken)
├── contracts/orgs.ts               # Zod schemas + ts-rest contract
├── contracts/admin.ts              # Admin schemas + contract
├── contracts/onboarding.ts         # Onboarding schemas + contract

apps/web/src/app/invite/[id]/
├── page.tsx                        # Invitation acceptance UI
```

---

## 4. Data Models & Schemas

### Database Tables

```
user
├── id              TEXT PRIMARY KEY
├── name            TEXT NOT NULL
├── email           TEXT NOT NULL UNIQUE
├── emailVerified   BOOLEAN NOT NULL
├── image           TEXT
├── createdAt       TIMESTAMPTZ
└── updatedAt       TIMESTAMPTZ
```

```
session (auth sessions, not app sessions)
├── id                      TEXT PRIMARY KEY
├── token                   TEXT NOT NULL UNIQUE
├── expiresAt               TIMESTAMPTZ NOT NULL
├── userId                  TEXT FK → user.id (CASCADE)
├── activeOrganizationId    TEXT           -- set by session-create hook
├── ipAddress               TEXT
├── userAgent               TEXT
├── createdAt               TIMESTAMPTZ
└── updatedAt               TIMESTAMPTZ
    IDX: session_userId_idx(userId)
```

```
account
├── id                      TEXT PRIMARY KEY
├── accountId               TEXT NOT NULL   -- provider's user ID
├── providerId              TEXT NOT NULL   -- "credential", "github", "google"
├── userId                  TEXT FK → user.id (CASCADE)
├── accessToken             TEXT
├── refreshToken            TEXT
├── password                TEXT           -- hashed, credential accounts only
├── createdAt               TIMESTAMPTZ
└── updatedAt               TIMESTAMPTZ
    IDX: account_userId_idx(userId)
```

```
organization
├── id                      TEXT PRIMARY KEY
├── name                    TEXT NOT NULL
├── slug                    TEXT NOT NULL UNIQUE
├── logo                    TEXT
├── metadata                TEXT
├── createdAt               TIMESTAMPTZ NOT NULL
├── allowedDomains          TEXT[]         -- domains for auto-join suggestions
├── isPersonal              BOOLEAN        -- true for auto-created personal orgs
├── autumnCustomerId        TEXT           -- Autumn billing customer ID
├── billingSettings         TEXT           -- JSON-encoded OrgBillingSettings
├── onboardingComplete      BOOLEAN        -- onboarding finalization flag
├── billingState            TEXT NOT NULL DEFAULT 'unconfigured'
├── billingPlan             TEXT           -- "dev" or "pro"
├── shadowBalance           NUMERIC(12,6)  -- fast-path credit balance
├── shadowBalanceUpdatedAt  TIMESTAMPTZ
├── graceEnteredAt          TIMESTAMPTZ
└── graceExpiresAt          TIMESTAMPTZ
    UIDX: organization_slug_uidx(slug)
```

```
member
├── id              TEXT PRIMARY KEY
├── organizationId  TEXT FK → organization.id (CASCADE)
├── userId          TEXT FK → user.id (CASCADE)
├── role            TEXT NOT NULL   -- "owner" | "admin" | "member"
└── createdAt       TIMESTAMPTZ NOT NULL
    IDX: member_organizationId_idx, member_userId_idx
```

```
invitation
├── id              TEXT PRIMARY KEY
├── organizationId  TEXT FK → organization.id (CASCADE)
├── email           TEXT NOT NULL
├── role            TEXT           -- assigned role on acceptance
├── status          TEXT NOT NULL  -- "pending" | "accepted" | "rejected" | "canceled"
├── expiresAt       TIMESTAMPTZ NOT NULL
├── inviterId       TEXT FK → user.id (CASCADE)
└── createdAt       TIMESTAMPTZ
    IDX: invitation_organizationId_idx, invitation_email_idx
```

```
verification
├── id              TEXT PRIMARY KEY
├── identifier      TEXT NOT NULL   -- email address
├── value           TEXT NOT NULL   -- verification token
├── expiresAt       TIMESTAMPTZ NOT NULL
├── createdAt       TIMESTAMPTZ
└── updatedAt       TIMESTAMPTZ
    IDX: verification_identifier_idx
```

```
apikey
├── id              TEXT PRIMARY KEY
├── name            TEXT           -- e.g., "cli-token"
├── key             TEXT NOT NULL  -- hashed key value
├── start           TEXT           -- key prefix for display
├── prefix          TEXT
├── userId          TEXT FK → user.id (CASCADE)
├── enabled         BOOLEAN
├── expiresAt       TIMESTAMPTZ
├── requestCount    INTEGER
├── remaining       INTEGER
├── createdAt       TIMESTAMPTZ NOT NULL
└── updatedAt       TIMESTAMPTZ NOT NULL
    IDX: apikey_key_idx, apikey_userId_idx
```

All tables defined in `packages/db/src/schema/auth.ts`.

### Key Indexes & Query Patterns
- User lookup by email: `user.email` unique index — used by better-auth for login
- Session lookup by token: `session.token` unique index — used by `auth.api.getSession()`
- Member by org: `member_organizationId_idx` — list members, check membership
- Member by user: `member_userId_idx` — list user's orgs, resolve `activeOrganizationId`
- Invitation by org: `invitation_organizationId_idx` — list pending invitations
- API key by key hash: `apikey_key_idx` — verify Bearer tokens
- Domain suggestions: `organization.allowedDomains @> ARRAY[domain]::text[]` — sequential scan (no GIN index)

### Core TypeScript Types

```typescript
// packages/shared/src/contracts/orgs.ts
type OrgRole = "owner" | "admin" | "member";

interface Organization {
  id: string; name: string; slug: string; logo: string | null;
  is_personal: boolean | null; allowed_domains: string[] | null; createdAt: string;
}

interface Member {
  id: string; userId: string; role: OrgRole; createdAt: string;
  user: { id: string; name: string | null; email: string; image: string | null } | null;
}

interface Invitation {
  id: string; email: string; role: OrgRole; status: string;
  expiresAt: string; createdAt: string;
  inviter: { name: string | null; email: string } | null;
}

// packages/shared/src/contracts/onboarding.ts
interface OnboardingStatus {
  hasOrg: boolean; hasSlackConnection: boolean; hasGitHubConnection: boolean;
  repos: Array<{ id: string; github_repo_name: string; prebuild_status: "ready" | "pending" }>;
}

// packages/shared/src/auth.ts
interface TokenPayload extends JWTPayload {
  sub: string; email?: string; orgId?: string; role?: string; service?: boolean;
}
```

---

## 5. Conventions & Patterns

### Do
- Use `protectedProcedure` for routes needing any authenticated user — `apps/web/src/server/routers/middleware.ts`
- Use `orgProcedure` for routes needing an active organization context — same file
- Check membership in the service layer before returning data (return `null` → router converts to FORBIDDEN)
- Use the mapper layer to transform Drizzle rows to API types — `packages/services/src/orgs/mapper.ts`

### Don't
- Do not query auth tables directly outside `packages/services/` — use the service functions
- Do not create custom oRPC routes for org/member/invitation writes — use better-auth's organization plugin client SDK (see §2, Organization Plugin)
- Do not store secrets in the `organization.billingSettings` JSON field
- Do not bypass better-auth's built-in role enforcement — the organization plugin endpoints handle owner-only restrictions for member role changes, member removal, and invitation management

### Error Handling

```typescript
// Service layer returns null or error objects for authz failures
const members = await orgs.listMembers(orgId, userId);
if (members === null) {
  throw new ORPCError("FORBIDDEN", { message: "Not a member" });
}

// Admin service uses typed errors
class ImpersonationError extends Error {
  code: "USER_NOT_FOUND" | "ORG_NOT_FOUND" | "NOT_A_MEMBER";
}
```

### Reliability
- Session expiry: 7 days, updated every 24 hours — `apps/web/src/lib/auth.ts:session`
- Invitation expiry: 7 days — `apps/web/src/lib/auth.ts:invitationExpiresIn`
- Impersonation cookie max age: 24 hours — `apps/web/src/lib/super-admin.ts:setImpersonationCookie`
- DB connection pool: max 1 connection, 10s idle timeout, 5s connect timeout — `apps/web/src/lib/auth.ts:pool`
- Personal org creation: best-effort (no retry on slug collision)

### Testing Conventions
- Auth helpers and service functions are tested via Vitest
- Mock `getSession()` for route-level tests
- Use `DEV_USER_ID` env var for local dev bypass (non-production only)

---

## 6. Subsystem Deep Dives

### 6.1 Authentication Flow — `Implemented`

**What it does:** Resolves the current user identity from one of three sources: cookie session, API key, or dev bypass.

**Happy path (cookie):**
1. `getSession()` in `apps/web/src/lib/auth-helpers.ts` is called
2. Checks `DEV_USER_ID` env var — if set and non-production, returns mock session
3. Checks `Authorization: Bearer <key>` header — calls `auth.api.verifyApiKey()`, looks up user, resolves org from `X-Org-Id` header or falls back to first membership
4. Falls through to `auth.api.getSession()` which reads the better-auth session cookie
5. `requireAuth()` wraps `getSession()`, adding impersonation overlay for super-admins

**Edge cases:**
- API key with `X-Org-Id` header: validates membership before using that org, falls back to first org if invalid
- Super-admin with impersonation cookie: swaps effective user/org but preserves `impersonation.realUserId` for audit
- `DEV_USER_ID=disabled`: explicitly disables dev bypass even when the env var exists

**Files touched:** `apps/web/src/lib/auth-helpers.ts`, `apps/web/src/lib/auth.ts`, `apps/web/src/lib/super-admin.ts`

### 6.2 User Signup & Personal Org Creation — `Implemented`

**What it does:** Creates a personal organization and owner membership automatically when a new user registers.

**Happy path:**
1. User signs up via email/password or OAuth
2. better-auth creates the `user` record
3. `databaseHooks.user.create.after` fires in `apps/web/src/lib/auth.ts`
4. Hook creates org with `id=org_{userId}`, `name="{userName}'s Workspace"`, `slug="{slugified-name}-{userId.slice(0,8)}"`, `is_personal=true`
5. Hook creates member with `id=mem_{userId}`, `role=owner`
6. On next session creation, `databaseHooks.session.create.before` sets `activeOrganizationId` to the user's first org

**Edge cases:**
- Slug collision: `ON CONFLICT (slug) DO NOTHING` — silently skips if slug already exists
- Hook failure: logged as error, user creation still succeeds (org creation is best-effort)

**Files touched:** `apps/web/src/lib/auth.ts:databaseHooks`

### 6.3 Email Verification — `Implemented`

**What it does:** Optionally requires email verification before login, sending verification emails via Resend.

**Happy path:**
1. Controlled by `NEXT_PUBLIC_ENFORCE_EMAIL_VERIFICATION` env var
2. When enabled: `emailAndPassword.requireEmailVerification=true` blocks login until verified
3. On signup, `emailVerification.sendOnSignUp=true` triggers `sendVerificationEmail` callback
4. Callback sends email via Resend with a verification link
5. `autoSignInAfterVerification=true` logs user in after clicking the link

**Edge cases:**
- Email disabled (`EMAIL_ENABLED=false` and no enforcement): verification is skipped entirely
- Missing `RESEND_API_KEY` with email enabled: throws at startup

**Files touched:** `apps/web/src/lib/auth.ts:emailVerification`

### 6.4 Organization & Member Management — `Implemented`

**What it does:** Provides two complementary surfaces: custom oRPC routes for read operations (list orgs, members, invitations) and better-auth organization plugin endpoints for write operations (role changes, member removal).

**Read path — custom oRPC (list members):**
1. `orgsRouter.listMembers` calls `orgs.listMembers(orgId, userId)` — `apps/web/src/server/routers/orgs.ts`
2. Service checks user membership via `orgsDb.getUserRole()` — `packages/services/src/orgs/service.ts`
3. If not a member, returns `null` (router throws FORBIDDEN)
4. Queries `member` table with user join — `packages/services/src/orgs/db.ts:listMembers`
5. Maps to API type via `toMembers()` — `packages/services/src/orgs/mapper.ts`

**Write path — better-auth plugin endpoints (role update, member removal):**
These operations are handled by better-auth's built-in organization plugin API routes (`/api/auth/organization/update-member-role`, `/api/auth/organization/remove-member`). Authorization is enforced by the plugin: only owners can change roles or remove members, and the owner role itself cannot be changed or removed. Evidence of usage: `apps/web/src/components/settings/members/use-members-page.ts`.

The service layer has parallel implementations (`updateMemberRole`, `removeMember` in `packages/services/src/orgs/service.ts`) with equivalent authz logic, but these are not wired to any router and are currently unused (see §9).

**Files touched:** `apps/web/src/server/routers/orgs.ts`, `packages/services/src/orgs/service.ts`, `packages/services/src/orgs/db.ts`

### 6.5 Invitation System — `Implemented`

**What it does:** Org members invite users by email; invitees accept or reject via a dedicated page.

**Happy path:**
1. Invitation created via better-auth's `organization.inviteMember()` client SDK call — plugin creates `invitation` record with 7-day expiry (`apps/web/src/lib/auth.ts:invitationExpiresIn`)
2. `sendInvitationEmail` callback fires, sending email via Resend with link `{APP_URL}/invite/{invitationId}` — `apps/web/src/lib/auth.ts`
3. Acceptance via `organization.acceptInvitation()` — plugin creates `member` record with the invited role
4. Rejection via `organization.rejectInvitation()` — plugin updates invitation status

**Listing invitations (custom oRPC):**
1. `orgsRouter.listInvitations` calls `orgs.listInvitations(orgId, userId)` — membership check included
2. DB query filters to current org, excludes expired invitations — `packages/services/src/orgs/db.ts:listInvitations`

**Edge cases:**
- Expired invitation: acceptance blocked by better-auth plugin (checks `expiresAt`)
- Email disabled: invitation record created but email skipped (log warning) — user must receive link another way
- Acceptance page evidence: `apps/web/src/app/invite/[id]/page.tsx`

**Files touched:** `apps/web/src/lib/auth.ts:sendInvitationEmail`, `packages/services/src/orgs/db.ts`

### 6.6 Domain Suggestions — `Implemented`

**What it does:** Suggests organizations matching the user's email domain for easy team discovery.

**Happy path:**
1. `orgsRouter.getDomainSuggestions` calls `orgs.getDomainSuggestions(userId, email)` — `apps/web/src/server/routers/orgs.ts`
2. Extracts domain from email (`email.split("@")[1]`) — `packages/services/src/orgs/service.ts`
3. Queries orgs where `allowedDomains` array contains the domain — `packages/services/src/orgs/db.ts:findByAllowedDomain`
4. Filters out orgs the user already belongs to
5. Returns suggestions with org id, name, slug, logo

**Domain management (service-layer only):**
`updateDomains(orgId, userId, domains)` exists in `packages/services/src/orgs/service.ts` with owner-only checks, domain validation (`/^[a-z0-9.-]+\.[a-z]{2,}$/`), and PostgreSQL array storage. However, it is not exposed through any oRPC route or frontend UI — domains can only be set via direct DB access or future API surface.

**Files touched:** `packages/services/src/orgs/service.ts:getDomainSuggestions`, `packages/services/src/orgs/db.ts:findByAllowedDomain`

### 6.7 Onboarding Flow — `Implemented`

**What it does:** Tracks onboarding progress (org, integrations, repos) and orchestrates trial activation + repo setup.

**Status check:**
1. `onboardingRouter.getStatus` calls `onboarding.getOnboardingStatus(orgId, nangoGithubIntegrationId)` — `apps/web/src/server/routers/onboarding.ts`
2. Checks: `hasOrg` (org exists), `hasSlackConnection` (active Slack installation), `hasGitHubConnection` (GitHub integration) — `packages/services/src/onboarding/service.ts`
3. Returns repos with prebuild status (`ready` if snapshotId exists, else `pending`).

**Dashboard gating:**
- Dashboard layout redirects to `/onboarding` when billing is enabled and `billingState === "unconfigured"` — `apps/web/src/app/dashboard/layout.tsx`
- GitHub connection is **optional** in the onboarding flow. "Skip GitHub" advances to the payment/complete step, not to the dashboard.
- Billing/trial step is still required when billing is enabled. Users cannot reach the dashboard without completing billing setup.

**Trial activation:**
1. `onboardingRouter.startTrial({ plan })` — `apps/web/src/server/routers/onboarding.ts`
2. If billing not enabled: marks onboarding complete, stores plan, returns success
3. If billing enabled: creates Autumn customer, calls `autumnAttach()` for payment method collection
4. If checkout URL returned: sends to frontend for Stripe/payment redirect
5. If no checkout needed: calls `orgs.initializeBillingState(orgId, "trial", TRIAL_CREDITS)` — handoff to billing. See `billing-metering.md` for credit policy.

**Mark complete:**
1. `onboardingRouter.markComplete` — called after checkout redirect returns
2. Sets `onboardingComplete=true` on org
3. Initializes billing state if still `unconfigured`

**Finalize (repo selection):**
1. `onboardingRouter.finalize({ selectedGithubRepoIds, integrationId })` — `apps/web/src/server/routers/onboarding.ts`
2. Fetches GitHub repos via integration, filters to selected IDs
3. Upserts each repo into DB, triggers repo snapshot build for new repos — `packages/services/src/onboarding/service.ts:upsertRepoFromGitHub`
4. Creates or retrieves managed prebuild via gateway service-to-service call
5. Returns `{ prebuildId, repoIds, isNew }`

**Files touched:** `apps/web/src/server/routers/onboarding.ts`, `packages/services/src/onboarding/service.ts`, `packages/services/src/onboarding/db.ts`

### 6.8 API Keys — `Implemented`

**What it does:** Provides long-lived Bearer tokens for CLI authentication, managed by better-auth's apiKey plugin.

**Creation:** Handled in CLI device auth flow. After device authorization, `auth.api.createApiKey({ body: { name: "cli-token", userId, expiresIn: undefined }})` creates a non-expiring key. See `cli.md` §6 for the full device auth flow.

**Verification:**
1. `getApiKeyUser()` in `apps/web/src/lib/auth-helpers.ts` extracts Bearer token from Authorization header
2. Calls `auth.api.verifyApiKey({ body: { key } })` — better-auth handles hash comparison
3. Looks up user details via `users.findById()`
4. Resolves org context from `X-Org-Id` header (validated via membership check) or first org

**Configuration:** Rate limiting disabled for CLI usage — `apps/web/src/lib/auth.ts:apiKey({ rateLimit: { enabled: false } })`

**Files touched:** `apps/web/src/lib/auth.ts:apiKey()`, `apps/web/src/lib/auth-helpers.ts:getApiKeyUser`

### 6.9 Admin & Impersonation — `Implemented`

**What it does:** Lets super-admins list all users/orgs, impersonate users, and switch orgs during impersonation.

**Admin status check (`getStatus`):**
1. Uses bare `os` middleware (not `adminProcedure`), so any authenticated user can call it — `apps/web/src/server/routers/admin.ts`
2. Requires a valid session (throws UNAUTHORIZED if not authenticated)
3. Checks `isSuperAdmin(email)` against comma-separated `SUPER_ADMIN_EMAILS` env var — `apps/web/src/lib/super-admin.ts`
4. Returns `{ isSuperAdmin: false }` for non-admins; includes impersonation state for admins

**Impersonation start:**
1. `adminRouter.impersonate({ userId, orgId })` — `apps/web/src/server/routers/admin.ts`
2. `adminProcedure` middleware verifies caller is super-admin
3. `admin.impersonate(userId, orgId)` validates user exists, org exists, user is member — `packages/services/src/admin/service.ts`
4. Sets `x-impersonate` httpOnly cookie (JSON-encoded `{userId, orgId}`, 24h max age, strict sameSite) — `apps/web/src/lib/super-admin.ts:setImpersonationCookie`
5. All subsequent `requireAuth()` calls detect the cookie and swap effective user/org context — `apps/web/src/lib/auth-helpers.ts:requireAuth`

**Org switching during impersonation:**
1. `adminRouter.switchOrg({ orgId })` reads current impersonation cookie
2. Validates impersonated user is member of target org — `admin.validateOrgSwitch()`
3. Updates cookie with new orgId

**Stop impersonation:**
1. `adminRouter.stopImpersonate` clears the `x-impersonate` cookie

**Files touched:** `apps/web/src/server/routers/admin.ts`, `packages/services/src/admin/service.ts`, `apps/web/src/lib/super-admin.ts`, `apps/web/src/lib/auth-helpers.ts`

### 6.10 Org Creation & Switching — `Implemented`

**What it does:** Users create team organizations and switch their active org context. Both operations are handled by better-auth's organization plugin as built-in API routes (`/api/auth/organization/*`). These plugin endpoints are first-class backend behavior owned by this spec — they are server-side routes auto-registered by better-auth, not frontend-only logic.

**Org creation (plugin endpoint):**
1. Client calls better-auth's `organization.create({ name, slug })` endpoint
2. Plugin creates `organization` record and `member` record with `creatorRole: "owner"` — `apps/web/src/lib/auth.ts` (plugin config)
3. Client then calls `organization.setActive({ organizationId })` to switch to the new org
4. Evidence of usage: `apps/web/src/components/onboarding/step-create-org.tsx`, `apps/web/src/components/dashboard/org-switcher.tsx`

**Org switching (plugin endpoint):**
1. Client calls better-auth's `organization.setActive({ organizationId })` endpoint
2. Plugin updates `session.activeOrganizationId` in the database
3. Impersonating super-admins use `adminRouter.switchOrg` instead (see §6.9)

**Files touched:** `apps/web/src/lib/auth.ts` (plugin config)

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `billing-metering.md` | This → Billing | `autumnCreateCustomer()`, `autumnAttach()`, `TRIAL_CREDITS`, `initializeBillingState()` | Onboarding triggers trial; billing owns credit policy |
| `cli.md` | CLI → This | `auth.api.createApiKey()`, `auth.api.verifyApiKey()` | CLI device auth creates API keys; auth-helpers verifies them |
| `sessions-gateway.md` | Gateway → This | `verifyToken()`, `verifyInternalToken()` | Gateway auth middleware uses shared JWT/token helpers |
| `integrations.md` | This → Integrations | `onboarding.getIntegrationForFinalization()` | Onboarding finalize fetches GitHub integration for repo listing |
| `repos-prebuilds.md` | This → Repos | `getOrCreateManagedPrebuild()`, `createRepoWithConfiguration()` | Onboarding finalize creates repos with auto-configurations (which trigger snapshot builds) |

### Security & Auth
- **AuthN:** better-auth manages session tokens (httpOnly cookies), password hashing, and OAuth flows
- **AuthZ:** Three-tier for oRPC reads: `publicProcedure` (no auth), `protectedProcedure` (any user), `orgProcedure` (user + active org). Owner-only write operations (role changes, member removal) enforced by better-auth's organization plugin.
- **Impersonation audit:** `ImpersonationContext` with `realUserId`/`realUserEmail` is propagated through middleware context
- **Sensitive data:** Impersonation cookie is httpOnly, secure in production, strict sameSite, 24h max. API key values are hashed by better-auth. Passwords are hashed in the `account` table.
- **Super-admin list:** Configured via `SUPER_ADMIN_EMAILS` env var (comma-separated). Not stored in DB.

### Observability
- Auth module logger: `apps/web/src/lib/auth.ts` — child logger `{ module: "auth" }`
- Auth helpers logger: `apps/web/src/lib/auth-helpers.ts` — child logger `{ module: "auth-helpers" }`
- Onboarding router logger: `apps/web/src/server/routers/onboarding.ts` — child logger `{ handler: "onboarding" }`

---

## 8. Acceptance Gates

- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] Lint passes (`pnpm lint`)
- [ ] Auth-related tests pass
- [ ] This spec is updated (file tree, data models, deep dives)

---

## 9. Known Limitations & Tech Debt

- [ ] **Personal org slug collision** — `ON CONFLICT DO NOTHING` silently skips org creation if slug collides. User ends up with no org. Low probability due to userId suffix but not impossible. — Expected fix: add retry with randomized suffix.
- [ ] **Unwired service-layer functions** — `updateDomains`, `updateMemberRole`, `removeMember` exist in `packages/services/src/orgs/service.ts` with full authz logic but are not exposed via any oRPC route. Member management goes through better-auth's organization plugin client SDK instead, duplicating role/removal logic. — Impact: dead code, confusing ownership. Expected fix: either wire to routes or remove.
- [ ] **No org deletion** — Organizations cannot be deleted through the API. Only member removal and role changes are supported. — Expected fix: add soft-delete with cascade cleanup.
- [ ] **Single owner model** — Only one user can be owner; no ownership transfer mechanism exists. — Expected fix: add `transferOwnership` endpoint.
- [ ] **Invitation deduplication** — No check for duplicate pending invitations to the same email. — Expected fix: upsert or reject duplicates.
- [ ] **Session org context drift** — `activeOrganizationId` is set at session creation via hook and updated by better-auth's `organization.setActive()`. If a user is removed from an org mid-session, the session still references that org until refresh. — Impact: low, requests fail at membership check.
- [ ] **billingSettings stored as text** — `organization.billingSettings` is JSON serialized as `TEXT` instead of `JSONB` for better-auth compatibility. No query-time JSON operations available. — Impact: minor, always read/written as whole blob.


---
# FILE: docs/specs/automations-runs.md
---

# Automations & Runs — System Spec

## 1. Scope & Purpose

### In Scope
- Automation CRUD and configuration (name, instructions, model, prebuild, notifications)
- Automation connections (integration bindings)
- Run lifecycle state machine: queued → enriching → ready → running → succeeded/failed/needs_human/timed_out
- Run pipeline: enrich → execute → finalize
- Enrichment worker (deterministic context extraction)
- Execution (session creation for runs via gateway SDK)
- Finalization (stale-run reconciliation against session + sandbox liveness)
- Run events log (`automation_run_events`)
- Outbox dispatch (atomic claim, stuck-row recovery, exponential backoff)
- Side effects tracking (`automation_side_effects`)
- Artifact storage (S3 — completion + enrichment JSON)
- Target resolution (which repo/prebuild to use)
- Notification dispatch (Slack channel messages on terminal run states)
- Slack async client (bidirectional session via Slack threads)
- Slack inbound handlers (text, todo, verify, default-tool)
- Slack receiver worker (BullMQ-based message processing)
- Run claiming / manual assignment
- Schedule binding on automations
- Manual run triggering (Run Now from UI)

### Out of Scope
- Trigger ingestion and matching — see `triggers.md`. Handoff point is the `enqueue_enrich` outbox row.
- Tool schemas (`automation.complete`) — see `agent-contract.md` §6.2
- Session runtime mechanics — see `sessions-gateway.md`
- Sandbox boot — see `sandbox-providers.md`
- Slack OAuth and installation — see `integrations.md`
- Schedule CRUD internals — see `triggers.md` (schedules are shared)
- Billing/metering for automation runs — see `billing-metering.md`

### Mental Model

An **automation** is a reusable configuration that describes *what* the agent should do when a trigger fires. A **run** is a single execution of that automation, moving through a pipeline: enrich the trigger context, resolve a target repo/prebuild, create a session, send the prompt, then finalize when the agent calls `automation.complete` or the session terminates. Runs can be created by trigger events or manually via the 'Run Now' UI action.

The pipeline is driven by an **outbox** pattern: stages enqueue the next stage's work via the `outbox` table, and a poller dispatches items to BullMQ queues. This decouples stages and provides at-least-once delivery with retry. Only `createRunFromTriggerEvent` and `completeRun` write outbox rows in the same transaction as status updates; the enrichment flow writes status, outbox, and artifact entries as separate sequential calls (`apps/worker/src/automation/index.ts:114-134`).

**Core entities:**
- **Automation** — org-scoped configuration with agent instructions, model, default prebuild, notification settings. Owns triggers and connections.
- **Run** (`automation_runs`) — a single pipeline execution. Tracks status, timestamps, lease, session reference, completion, enrichment, and assignment.
- **Outbox** (`outbox`) — transactional outbox table for reliable dispatch between pipeline stages.
- **Run event** (`automation_run_events`) — append-only audit log of status transitions and milestones.
- **Side effect** (`automation_side_effects`) — idempotent record of external actions taken during a run. Table and service exist but have no callsites in the current run pipeline (see §9).

**Key invariants:**
- A run is always tied to exactly one trigger event (unique index on `trigger_event_id`).
- Runs are claimed via lease-based concurrency control (`lease_owner`, `lease_expires_at`, `lease_version`).
- The outbox guarantees at-least-once delivery: stuck rows are recovered after 5 min, retried up to 5 times with exponential backoff.
- The `completion_id` on a run is an idempotency key — duplicate completions with the same ID are safe.

---

## 2. Core Concepts

### Outbox Pattern
All inter-stage communication flows through the `outbox` table. Workers insert outbox rows (ideally in the same transaction as status updates — see §1 for which stages achieve this), a poller claims them atomically via `SELECT ... FOR UPDATE SKIP LOCKED`, and dispatches to BullMQ queues or inline handlers.
- Key detail agents get wrong: the outbox is not a queue — it's a database table polled every 2 seconds. BullMQ queues are downstream consumers.
- Reference: `packages/services/src/outbox/service.ts`, `apps/worker/src/automation/index.ts:dispatchOutbox`

### Lease-Based Run Claiming
Workers claim runs using an optimistic-locking pattern: `UPDATE ... WHERE status IN (...) AND (lease_expires_at IS NULL OR lease_expires_at < now())`. The lease has a 5-minute TTL and a monotonic version counter.
- Key detail agents get wrong: `claimRun` checks both status AND lease expiry — a run stuck in "enriching" with an expired lease can be re-claimed.
- Reference: `packages/services/src/runs/db.ts:claimRun`

### Enrichment Payload
A deterministic extraction from the trigger event's `parsedContext` — no external API calls, no LLM. Produces a versioned `EnrichmentPayload` (v1) with summary, source URL, related files, suggested repo ID, and provider-specific context.
- Key detail agents get wrong: enrichment is pure computation, not an LLM call. The `llmFilterPrompt` and `llmAnalysisPrompt` fields on automations are configuration for future use by the trigger service, not by the enrichment worker.
- Reference: `apps/worker/src/automation/enrich.ts:buildEnrichmentPayload`

### AsyncClient / Slack Client
The `SlackClient` extends `AsyncClient` from `@proliferate/gateway-clients/server`. It manages bidirectional sessions: inbound Slack messages create/reuse sessions via the gateway SDK, and outbound gateway events (text, tool results) are posted back to Slack threads.
- Key detail agents get wrong: the Slack client does NOT use webhooks for outbound messages — it connects to the gateway via the `SyncClient` SDK, receives events, and calls the Slack API directly.
- Reference: `apps/worker/src/slack/client.ts:SlackClient`

---

## 3. File Tree

```
apps/worker/src/automation/
├── index.ts                          # Orchestrator: workers, outbox poller, finalizer loop
├── enrich.ts                         # buildEnrichmentPayload() — pure extraction
├── finalizer.ts                      # finalizeOneRun() — reconcile stale runs
├── resolve-target.ts                 # resolveTarget() — pick repo/prebuild
├── artifacts.ts                      # S3 artifact writer (completion + enrichment)
├── notifications.ts                  # Slack notification dispatch + channel resolution
├── *.test.ts                         # Tests for each module

apps/worker/src/slack/
├── index.ts                          # Barrel exports
├── client.ts                         # SlackClient (extends AsyncClient)
├── api.ts                            # SlackApiClient — raw Slack API wrapper
├── lib.ts                            # Shared utilities (postToSlack, image download, etc.)
└── handlers/
    ├── index.ts                      # Handler interfaces (ToolHandler, EventHandler)
    ├── text.ts                       # textPartCompleteHandler — posts text to thread
    ├── todo.ts                       # todoWriteToolHandler — formats task lists
    ├── verify.ts                     # verifyToolHandler — uploads media to Slack
    └── default-tool.ts               # defaultToolHandler — fallback code block

apps/web/src/server/routers/
└── automations.ts                    # oRPC routes: automation CRUD, runs, triggers, schedules, manual runs, integration actions

packages/services/src/
├── automations/
│   ├── service.ts                    # Business logic (CRUD, triggers, connections, events)
│   ├── db.ts                         # Raw Drizzle queries
│   └── mapper.ts                     # DB row → API contract mapping
├── runs/
│   ├── service.ts                    # Run lifecycle (create, claim, transition, complete, assign)
│   └── db.ts                         # Run queries + listing
├── outbox/
│   └── service.ts                    # enqueue, claim, markDispatched, markFailed, recoverStuck
├── side-effects/
│   └── service.ts                    # recordOrReplaySideEffect — idempotent external actions
└── notifications/
    └── service.ts                    # enqueueRunNotification — outbox wrapper

packages/db/src/schema/schema.ts      # Tables: automations, automation_runs, automation_run_events,
                                      # automation_side_effects, automation_connections, outbox
```

---

## 4. Data Models & Schemas

### Database Tables

```
automations
├── id                  UUID PK
├── organization_id     TEXT FK(organization) NOT NULL
├── name                TEXT NOT NULL DEFAULT 'Untitled Automation'
├── description         TEXT
├── enabled             BOOLEAN DEFAULT true
├── agent_instructions  TEXT
├── agent_type          TEXT DEFAULT 'opencode'
├── model_id            TEXT DEFAULT 'claude-sonnet-4-20250514'
├── default_prebuild_id UUID FK(prebuilds) ON DELETE SET NULL
├── allow_agentic_repo_selection BOOLEAN DEFAULT false
├── llm_filter_prompt   TEXT
├── enabled_tools       JSONB DEFAULT {}
├── llm_analysis_prompt TEXT
├── notification_channel_id TEXT          -- Slack channel ID
├── notification_slack_installation_id UUID FK(slack_installations)
├── notification_destination_type TEXT DEFAULT 'none'  -- slack_dm_user | slack_channel | none
├── notification_slack_user_id TEXT       -- Slack user ID for DM notifications
├── config_selection_strategy TEXT DEFAULT 'fixed'     -- fixed | agent_decide
├── fallback_configuration_id UUID FK(configurations)  -- fallback for agent_decide
├── allowed_configuration_ids JSONB       -- allowlist for agent_decide mode
├── created_by          TEXT FK(user)
├── created_at          TIMESTAMPTZ
└── updated_at          TIMESTAMPTZ
Indexes: idx_automations_org, idx_automations_enabled, idx_automations_prebuild

session_notification_subscriptions
├── id                  UUID PK
├── session_id          UUID FK(sessions) ON DELETE CASCADE
├── user_id             TEXT FK(user) ON DELETE CASCADE
├── slack_installation_id TEXT FK(slack_installations)
├── destination_type    TEXT DEFAULT 'dm_user'
├── slack_user_id       TEXT
├── event_types         JSONB DEFAULT '["completed"]'
├── created_at          TIMESTAMPTZ
└── updated_at          TIMESTAMPTZ
Unique: (session_id, user_id)

automation_connections
├── id                  UUID PK
├── automation_id       UUID FK(automations) ON DELETE CASCADE
├── integration_id      UUID FK(integrations) ON DELETE CASCADE
└── created_at          TIMESTAMPTZ
Unique: (automation_id, integration_id)

automation_runs
├── id                  UUID PK
├── organization_id     TEXT FK(organization) NOT NULL
├── automation_id       UUID FK(automations) NOT NULL
├── trigger_event_id    UUID FK(trigger_events) UNIQUE NOT NULL
├── trigger_id          UUID FK(triggers)
├── status              TEXT NOT NULL DEFAULT 'queued'
├── status_reason       TEXT
├── failure_stage       TEXT
├── lease_owner         TEXT
├── lease_expires_at    TIMESTAMPTZ
├── lease_version       INT DEFAULT 0 NOT NULL
├── attempt             INT DEFAULT 0 NOT NULL
├── queued_at           TIMESTAMPTZ NOT NULL
├── enrichment_started_at    TIMESTAMPTZ
├── enrichment_completed_at  TIMESTAMPTZ
├── execution_started_at     TIMESTAMPTZ
├── prompt_sent_at      TIMESTAMPTZ
├── completed_at        TIMESTAMPTZ
├── last_activity_at    TIMESTAMPTZ
├── deadline_at         TIMESTAMPTZ
├── session_id          UUID FK(sessions)
├── completion_id       TEXT              -- idempotency key
├── completion_json     JSONB
├── completion_artifact_ref TEXT          -- S3 key
├── enrichment_json     JSONB
├── enrichment_artifact_ref TEXT          -- S3 key
├── error_code          TEXT
├── error_message       TEXT
├── assigned_to         TEXT FK(user)
├── assigned_at         TIMESTAMPTZ
└── created_at / updated_at  TIMESTAMPTZ
Indexes: status+lease, org+status, session, trigger_event(unique), assigned_to

automation_run_events
├── id                  UUID PK
├── run_id              UUID FK(automation_runs) NOT NULL
├── type                TEXT NOT NULL     -- status_transition, enrichment_saved, completion, target_resolved
├── from_status         TEXT
├── to_status           TEXT
├── data                JSONB
└── created_at          TIMESTAMPTZ
Index: (run_id, created_at DESC)

automation_side_effects
├── id                  UUID PK
├── run_id              UUID FK(automation_runs) NOT NULL
├── organization_id     TEXT FK(organization) NOT NULL
├── effect_id           TEXT NOT NULL     -- idempotency key
├── kind                TEXT NOT NULL
├── provider            TEXT
├── request_hash        TEXT
├── response_json       JSONB
└── created_at          TIMESTAMPTZ
Unique: (organization_id, effect_id)

outbox
├── id                  UUID PK
├── organization_id     TEXT FK(organization) NOT NULL
├── kind                TEXT NOT NULL     -- enqueue_enrich, enqueue_execute, write_artifacts, notify_run_terminal
├── payload             JSONB NOT NULL
├── status              TEXT NOT NULL DEFAULT 'pending'  -- pending, processing, dispatched, failed
├── attempts            INT DEFAULT 0 NOT NULL
├── available_at        TIMESTAMPTZ DEFAULT now()
├── claimed_at          TIMESTAMPTZ
├── last_error          TEXT
└── created_at          TIMESTAMPTZ
Index: (status, available_at)
```

### Run Status State Machine

```
queued → enriching → ready → running → succeeded
                                     → failed
                                     → needs_human
                                     → timed_out
```

Terminal statuses: `succeeded`, `failed`, `needs_human`, `timed_out`. Any non-terminal status can transition to `failed` on error. Source: `packages/services/src/runs/service.ts:transitionRunStatus`

> **Note on glossary alignment:** The canonical glossary (`boundary-brief.md` §3) describes the run lifecycle as `pending → enriching → executing → completed/failed`. The actual DB status values are `queued → enriching → ready → running → succeeded/failed/needs_human/timed_out`. This spec uses the DB values throughout.

### Core TypeScript Types

```typescript
// packages/services/src/runs/db.ts
interface AutomationRunWithRelations extends AutomationRunRow {
  automation: { id; name; defaultPrebuildId; agentInstructions; modelId; ... } | null;
  triggerEvent: { id; parsedContext; rawPayload; providerEventType; ... } | null;
  trigger: { id; provider; name } | null;
}

// apps/worker/src/automation/enrich.ts
interface EnrichmentPayload {
  version: 1;
  provider: string;
  summary: { title: string; description: string | null };
  source: { url: string | null; externalId: string | null; eventType: string | null };
  relatedFiles: string[];
  suggestedRepoId: string | null;
  providerContext: Record<string, unknown>;
  automationContext: { automationId; automationName; hasLlmFilter; hasLlmAnalysis };
}

// apps/worker/src/automation/resolve-target.ts
interface TargetResolution {
  type: "default" | "selected" | "fallback";
  prebuildId?: string;
  repoIds?: string[];
  reason: string;
  suggestedRepoId?: string;
}

// packages/services/src/outbox/service.ts
type OutboxRow = InferSelectModel<typeof outbox>;
// Status: "pending" | "processing" | "dispatched" | "failed"
```

### Key Indexes & Query Patterns

| Query | Index | Notes |
|-------|-------|-------|
| Claim run by status + expired lease | `idx_automation_runs_status_lease (status, lease_expires_at)` | Used by `claimRun()` |
| List runs by org + status | `idx_automation_runs_org_status (organization_id, status)` | Admin/listing |
| Find run by session | `idx_automation_runs_session (session_id)` | Gateway completion lookup |
| Unique run per trigger event | `idx_automation_runs_trigger_event (trigger_event_id)` UNIQUE | Enforces 1:1 |
| Claim pending outbox rows | `idx_outbox_status_available (status, available_at)` | `SELECT ... FOR UPDATE SKIP LOCKED` |
| Side effect idempotency | `automation_side_effects_org_effect_key (organization_id, effect_id)` UNIQUE | Dedup |

---

## 5. Conventions & Patterns

### Do
- Use `runs.claimRun()` before mutating a run — this prevents concurrent workers from processing the same run.
- Insert outbox rows inside the same transaction as status updates where possible — `createRunFromTriggerEvent` and `completeRun` do this. Enrichment currently uses sequential writes; failures between writes are recoverable via lease expiry and re-claim.
- Use `recordOrReplaySideEffect()` for any external mutation — provides idempotent replay on retry. (Currently unused in the run pipeline; infrastructure exists for future use.)

### Don't
- Don't call the Slack API without decrypting the bot token first — tokens are stored encrypted via `@proliferate/shared/crypto`.
- Don't skip the outbox for inter-stage dispatch — direct BullMQ enqueue loses the at-least-once guarantee provided by stuck-row recovery.
- Don't write artifacts inline during enrichment — use the `write_artifacts` outbox kind so failures don't block the pipeline.

### Error Handling

```typescript
// Pattern: claim → process → fail-on-error
// Source: apps/worker/src/automation/index.ts:handleEnrich
const run = await runs.claimRun(runId, ["queued", "enriching"], workerId, LEASE_TTL_MS);
if (!run) return; // Another worker claimed it

try {
  // ... process
} catch (err) {
  if (err instanceof EnrichmentError) {
    await runs.markRunFailed({ runId, reason: "enrichment_failed", stage: "enrichment", errorMessage: err.message });
    return;
  }
  throw err; // BullMQ will retry
}
```

### Reliability
- **Outbox polling**: every 2s (`OUTBOX_POLL_INTERVAL_MS`). Source: `apps/worker/src/automation/index.ts:63`
- **Stuck-row recovery**: rows in `processing` state for > 5 min (`CLAIM_LEASE_MS`) are reset to `pending`. Max 5 attempts (`MAX_ATTEMPTS`). Source: `packages/services/src/outbox/service.ts:recoverStuckOutbox`
- **Retry backoff**: `min(30s * 2^attempts, 5min)`. Source: `apps/worker/src/automation/index.ts:retryDelay`
- **Finalizer interval**: every 60s, checks runs in `running` state with no activity for 30 min (`INACTIVITY_MS`). Source: `apps/worker/src/automation/index.ts:FINALIZER_INTERVAL_MS`
- **Slack API timeout**: 10s per call. Source: `apps/worker/src/automation/notifications.ts:SLACK_TIMEOUT_MS`
- **Session idempotency**: session creation uses `idempotencyKey: run:${runId}:session`. Source: `apps/worker/src/automation/index.ts:234`

### Testing Conventions
- Finalizer uses dependency injection (`FinalizerDeps`) for pure unit testing without gateway/DB. Source: `apps/worker/src/automation/finalizer.ts`
- Enrichment is a pure function — test with mock `AutomationRunWithRelations`. Source: `apps/worker/src/automation/enrich.test.ts`
- Outbox dispatch, artifacts, notifications, and resolve-target all have dedicated test files.

---

## 6. Subsystem Deep Dives

### 6.1 Run Pipeline — `Implemented`

**What it does:** Orchestrates the full lifecycle of an automation run from trigger event to completion.

**Happy path:**
1. Trigger service creates a trigger event + run + outbox row (`enqueue_enrich`) in one transaction (`packages/services/src/runs/service.ts:createRunFromTriggerEvent`)
2. Outbox poller claims the row, dispatches to `AUTOMATION_ENRICH` BullMQ queue (`apps/worker/src/automation/index.ts:dispatchOutbox`)
3. Enrich worker claims the run, builds enrichment payload, saves result, enqueues `write_artifacts` + `enqueue_execute` outbox rows
4. Outbox poller dispatches artifacts write (S3) and execute queue entry
5. Execute worker claims the run, resolves target, creates session via gateway SDK, sends prompt
6. Agent works inside the session, calls `automation.complete` tool
7. `completeRun()` records completion + enqueues `write_artifacts` + `notify_run_terminal` outbox rows
8. Outbox poller writes artifacts to S3 and dispatches Slack notification

**Files touched:** `apps/worker/src/automation/index.ts`, `packages/services/src/runs/service.ts`, `packages/services/src/outbox/service.ts`

### 6.2 Enrichment — `Implemented`

**What it does:** Extracts structured context from trigger event payloads. Pure deterministic computation — no external calls.

**Happy path:**
1. `buildEnrichmentPayload()` receives run with relations (`apps/worker/src/automation/enrich.ts:40`)
2. Validates `parsedContext` exists and has `title`
3. Extracts source URL from provider-specific fields (Linear, Sentry, GitHub, PostHog)
4. Extracts `relatedFiles`, `suggestedRepoId`, provider context
5. Returns `EnrichmentPayload` (version 1) saved to `enrichment_json` column

**Edge cases:**
- Missing `parsedContext` or `title` → `EnrichmentError` → run marked failed
- Unknown provider → empty `providerContext`

**Files touched:** `apps/worker/src/automation/enrich.ts`

### 6.3 Target Resolution — `Implemented`

**What it does:** Determines which repo/prebuild to use for session creation based on enrichment output and automation configuration.

**Decision tree** (`apps/worker/src/automation/resolve-target.ts:resolveTarget`):
1. If `allowAgenticRepoSelection` is false → use `defaultPrebuildId` ("selection_disabled")
2. If no `suggestedRepoId` in enrichment → use `defaultPrebuildId` ("no_suggestion")
3. If suggested repo doesn't exist in org → fallback to `defaultPrebuildId` ("repo_not_found_or_wrong_org")
4. If existing managed prebuild contains the repo → reuse it ("enrichment_suggestion_reused")
5. Otherwise → pass `repoIds: [suggestedRepoId]` for managed prebuild creation ("enrichment_suggestion_new")

**Files touched:** `apps/worker/src/automation/resolve-target.ts`

### 6.4 Execution — `Implemented`

**What it does:** Creates a session for the run and sends the agent prompt.

**Happy path:**
1. Claim run in `ready` status (`apps/worker/src/automation/index.ts:handleExecute`)
2. Call `resolveTarget()` to determine prebuild/repos
3. Create session via `syncClient.createSession()` with `clientType: "automation"`, `sandboxMode: "immediate"`
4. Build prompt: agent instructions + trigger context path + completion requirements with `run_id` and `completion_id`
5. Post prompt via `syncClient.postMessage()` with idempotency key

**Edge cases:**
- No valid target → run marked failed with `missing_prebuild`
- Session already exists (`run.sessionId` set) → skip creation, only send prompt if not already sent
- Prompt already sent (`run.promptSentAt` set) → skip

**Files touched:** `apps/worker/src/automation/index.ts:handleExecute`

### 6.5 Finalization — `Implemented`

**What it does:** Periodically reconciles stale runs against session and sandbox liveness.

**Happy path** (`apps/worker/src/automation/finalizer.ts:finalizeOneRun`):
1. No session → fail immediately (`missing_session`)
2. Deadline exceeded → transition to `timed_out` + enqueue notification
3. Query session status via gateway SDK
4. Session terminated without completion → fail (`no_completion`)
5. Sandbox dead but session "running" → fail (`sandbox_dead`)
6. Session running + sandbox alive → leave it alone

**Candidates:** runs in `running` status where `deadline_at < now` OR `last_activity_at < now - 30min`. Limit: 50 per tick. Source: `packages/services/src/runs/db.ts:listStaleRunningRuns`

**Files touched:** `apps/worker/src/automation/finalizer.ts`, `apps/worker/src/automation/index.ts:finalizeRuns`

### 6.6 Outbox Dispatch — `Implemented`

**What it does:** Polls the outbox table and dispatches items to their handlers.

**Happy path** (`apps/worker/src/automation/index.ts:dispatchOutbox`):
1. Recover stuck rows (processing > 5 min lease)
2. Atomically claim up to 50 pending rows via `SELECT ... FOR UPDATE SKIP LOCKED`
3. For each row, dispatch by `kind`:
   - `enqueue_enrich` → BullMQ `AUTOMATION_ENRICH` queue
   - `enqueue_execute` → BullMQ `AUTOMATION_EXECUTE` queue
   - `write_artifacts` → inline S3 write
   - `notify_run_terminal` → inline Slack dispatch
4. Mark dispatched or failed with backoff

**Files touched:** `apps/worker/src/automation/index.ts:dispatchOutbox`, `packages/services/src/outbox/service.ts`

### 6.7 Notifications — `Implemented`

**What it does:** Posts Slack messages when runs reach terminal states (succeeded, failed, timed_out, needs_human). Supports three notification destination types.

**Destination types:**
- `slack_channel` — Post to a Slack channel. Resolves channel via `automation.notificationChannelId` with backward-compat fallback to `enabled_tools.slack_notify.channelId`.
- `slack_dm_user` — DM a specific Slack user. Uses `conversations.open` to open a DM channel, then `chat.postMessage`.
- `none` — Notifications disabled.

**Run notification dispatch** (`apps/worker/src/automation/notifications.ts:dispatchRunNotification`):
1. Load run with relations
2. Check `notificationDestinationType` — return early if `none`
3. For `slack_dm_user`: check idempotency via side effects → open DM → post message → record side effect
4. For `slack_channel` (default/legacy): resolve channel ID → post to channel → record side effect
5. All Slack API calls use 10s timeout and are idempotent via `automation_side_effects`

**Session notification dispatch** (`apps/worker/src/automation/notifications.ts:dispatchSessionNotification`):
1. List session notification subscriptions
2. Load session info
3. For each subscription with a `slackUserId`, send a DM via `conversations.open` + `chat.postMessage`
4. Outbox provides at-most-once delivery for session notifications

**Outbox kinds:** `notify_run_terminal` (existing), `notify_session_complete` (new)

**Files touched:** `apps/worker/src/automation/notifications.ts`, `packages/services/src/notifications/service.ts`

### 6.7.1 Configuration Selection Strategy — `Implemented`

**What it does:** Controls how automation runs select which configuration to use for session creation.

**Strategies:**
- `fixed` (default) — Always use `defaultConfigurationId`. No dynamic selection.
- `agent_decide` — Select from an explicit allowlist of configuration IDs. If enrichment suggests a repo, find an existing configuration containing that repo within the allowlist. Never creates new managed configurations. Falls back to `fallbackConfigurationId` (or `defaultConfigurationId` if no fallback set).

**Invariant:** `agent_decide` mode never creates new managed configurations. It can only select from existing configurations in the allowed set.

**Files touched:** `apps/worker/src/automation/resolve-target.ts`

### 6.8 Slack Async Client — `Implemented`

**What it does:** Bridges Slack threads to Proliferate sessions, enabling bidirectional interaction.

**Inbound (Slack → Session)** (`apps/worker/src/slack/client.ts:processInbound`):
1. Find existing session for Slack thread (`sessions.findSessionBySlackThread`)
2. If none, create session via `syncClient.createSession()` with `clientType: "slack"`
3. Post welcome message with web app + preview links
4. Download any attached images as base64
5. Cancel any in-progress operation, post message to gateway

**Outbound (Session → Slack)** (`apps/worker/src/slack/client.ts:handleEvent`):
1. Receive gateway events (text_part_complete, tool_end, message_complete, etc.)
2. Convert markdown to Slack mrkdwn format
3. For significant tools (verify, todowrite), dispatch to specialized handlers
4. Stop listening on `message_complete` or `error`

**Slack handlers:**
- `textPartCompleteHandler` — converts markdown → mrkdwn, posts to thread (`handlers/text.ts`)
- `verifyToolHandler` — uploads verification media to Slack, posts summary with dashboard link (`handlers/verify.ts`)
- `todoWriteToolHandler` — formats task list with checkboxes (`handlers/todo.ts`)
- `defaultToolHandler` — posts tool result in code block, max 2000 chars (`handlers/default-tool.ts`)

**Files touched:** `apps/worker/src/slack/client.ts`, `apps/worker/src/slack/handlers/`

### 6.9 Artifact Storage — `Implemented`

**What it does:** Writes run artifacts (completion + enrichment JSON) to S3.

**Key paths:**
- Completion: `runs/{runId}/completion.json`
- Enrichment: `runs/{runId}/enrichment.json`

**S3 config:** `S3_BUCKET`, `S3_REGION`, optional `S3_ENDPOINT_URL`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`. Source: `apps/worker/src/automation/artifacts.ts`

### 6.10 Org Pending Runs Query — `Implemented`

**What it does:** Provides an org-scoped query for runs in attention-requiring states (`failed`, `needs_human`, `timed_out`), surfaced in the inline attention inbox tray.

**Query:** `listOrgPendingRuns(orgId, { limit?, maxAgeDays? })` — returns runs matching attention statuses within the age window (default 7 days, max 50 rows), joined with automation name. Source: `packages/services/src/runs/db.ts:listOrgPendingRuns`

**oRPC route:** `automations.listOrgPendingRuns` — org-scoped procedure, optional `limit` (1–50) and `maxAgeDays` (1–30). Returns `{ runs: PendingRunSummary[] }` with snake_case fields. Source: `apps/web/src/server/routers/automations.ts`

**Frontend:** Consumed by `useOrgPendingRuns` hook (30s polling interval), merged into the attention inbox tray alongside pending action approvals. Source: `apps/web/src/hooks/use-automations.ts`, `apps/web/src/hooks/use-attention-inbox.ts`

**Files touched:** `packages/services/src/runs/db.ts`, `packages/services/src/runs/service.ts`, `apps/web/src/server/routers/automations.ts`, `apps/web/src/hooks/use-automations.ts`

### 6.11 Run Claiming, Assignment & Resolution — `Implemented`

**What it does:** Lets users claim runs for manual review and resolve attention-requiring runs.

**Implemented routes** (`apps/web/src/server/routers/automations.ts`):
- `assignRun` — claim a run for the current user. Throws `CONFLICT` if already claimed by another user.
- `unassignRun` — unclaim a run.
- `myClaimedRuns` — list runs assigned to the current user.
- `listRuns` — list runs for an automation with status/pagination filters.
- `resolveRun` — manually transition a `needs_human`, `failed`, or `timed_out` run to `succeeded` or `failed` with an optional resolution note.

**Scoping note:** The route validates that the automation exists in the org (`automationExists(id, orgId)`), but the actual DB update in `assignRunToUser` (`packages/services/src/runs/db.ts:278`) is scoped by `run_id + organization_id` only — it does not re-check the automation ID. This means the automation ID in the route acts as a parent-resource guard but is not enforced at the DB level.

### 6.12 Manual Run (Run Now) — `Implemented`

**What it does:** Allows users to manually trigger an automation run from the UI without waiting for a trigger event.

**Happy path:**
1. User clicks "Run Now" on the automation detail page.
2. Frontend calls `useTriggerManualRun(automationId)` hook which hits `automations.triggerManualRun` oRPC endpoint.
3. `triggerManualRun(automationId, orgId, userId)` verifies automation exists in the org.
4. Finds or creates a dedicated manual trigger: `provider: "webhook"`, `triggerType: "webhook"`, `enabled: false`, `config: { _manual: true }`. The trigger is disabled so it never receives real webhooks. Uses `config._manual` flag (not a separate provider value) to stay within the valid `TriggerProvider` enum.
5. Calls `createRunFromTriggerEvent()` with `providerEventType: "manual_trigger"` and a synthetic payload containing the triggering user ID.
6. Returns `{ runId, status }`. Frontend invalidates the runs list query and shows a success toast.

**Edge cases:**
- Automation not found → throws Error ("Automation not found")
- Manual trigger already exists → reuses it (no duplicate creation)
- The manual trigger has `enabled: false` — it will never match real webhook ingestion

**Frontend:** `useTriggerManualRun` hook (`apps/web/src/hooks/use-automations.ts`) wraps the mutation. The "Run Now" button is in the automation detail page header.

**Files touched:** `packages/services/src/automations/service.ts:triggerManualRun`, `packages/services/src/automations/db.ts:findManualTrigger`, `apps/web/src/server/routers/automations.ts:triggerManualRun`, `apps/web/src/hooks/use-automations.ts:useTriggerManualRun`

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `triggers.md` | Triggers → This | `runs.createRunFromTriggerEvent()` | Trigger service inserts run + outbox row. Handoff point. |
| `agent-contract.md` | This → Agent | `automation.complete` tool schema | Run injects `run_id` + `completion_id` in prompt. Agent calls tool to finalize. |
| `sessions-gateway.md` | This → Gateway | `syncClient.createSession()`, `postMessage()`, `getSessionStatus()` | Worker creates sessions and sends prompts via gateway SDK. |
| `sandbox-providers.md` | This → Provider (indirect) | Via gateway session creation | Target resolution determines prebuild; gateway handles sandbox boot. |
| `integrations.md` | This → Integrations | `automations.addAutomationConnection()` | Automation connections bind integrations. OAuth lifecycle owned by integrations spec. |
| `repos-prebuilds.md` | This → Prebuilds | `prebuilds.findManagedPrebuilds()` | Target resolution looks up managed prebuilds for repo reuse. |
| `billing-metering.md` | This → Billing (indirect) | Via session creation | Session creation triggers billing; this spec does not gate on balance. |

### Security & Auth
- All automation routes use `orgProcedure` middleware — validates org membership before any operation. Source: `apps/web/src/server/routers/automations.ts`
- Run assignment checks org ownership (`automationExists` + `orgId` filter on queries). Source: `packages/services/src/runs/db.ts:assignRunToUser`
- Slack bot tokens are encrypted at rest (`encrypted_bot_token`) and decrypted only at send time via `@proliferate/shared/crypto`. Source: `apps/worker/src/automation/notifications.ts:131`
- Worker authenticates to gateway via service-to-service token (`SERVICE_TO_SERVICE_AUTH_TOKEN`). Source: `apps/worker/src/automation/index.ts:47`

### Observability
- All worker modules use `@proliferate/logger` with structured context (`runId`, `sessionId`).
- Outbox recovery logs `recovered` count at `warn` level. Source: `apps/worker/src/automation/index.ts:303`
- Notification dispatch logs channel, status, and error per attempt.

---

## 8. Acceptance Gates

- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] Worker tests pass (`pnpm -C apps/worker test`)
- [ ] Outbox service tests pass (`pnpm -C packages/services test`)
- [ ] This spec is updated (file tree, data models, deep dives)

---

## 9. Known Limitations & Tech Debt

- [x] **Manual run status update** — Addressed. `resolveRun` oRPC route allows transitioning `needs_human`, `failed`, or `timed_out` runs to `succeeded` or `failed` with a resolution note. Source: `apps/web/src/server/routers/automations.ts:resolveRun`.
- [ ] **LLM filter/analysis fields unused** — `llm_filter_prompt` and `llm_analysis_prompt` columns exist on automations but are not executed during enrichment. Impact: configuration exists in UI but has no runtime effect. Expected fix: add LLM evaluation step to trigger processing pipeline (likely in `triggers.md` scope).
- [ ] **No run deadline enforcement at creation** — The `deadline_at` column exists but is never set during run creation. Only the finalizer checks it. Impact: runs rely solely on inactivity detection (30 min). Expected fix: set deadline from automation config at run creation.
- [x] **Single-channel notifications** — Addressed. Notification destination type selector supports `slack_channel`, `slack_dm_user`, and `none`. The `NotificationChannel` interface still exists for future email/in-app channels.
- [ ] **Notification channel resolution fallback** — The `resolveNotificationChannelId` function falls back to `enabled_tools.slack_notify.channelId` for backward compatibility. Impact: minor code complexity. Expected fix: migrate old automations and remove fallback.
- [ ] **Slack installation ambiguity** — `findSlackInstallationByTeamId` may return the wrong org's installation if two orgs share the same Slack workspace. Mitigated: logs a warning when ambiguity is detected. Impact: cross-org message routing in edge cases. Expected fix: require explicit installation binding per automation/session.
- [ ] **Artifact writes are not retried independently** — If S3 write fails, the entire outbox item is retried (up to 5x). Impact: a transient S3 failure delays downstream notifications. Expected fix: split artifact writes into separate outbox items per artifact type.
- [x] **Side effects table unused** — Addressed. `automation_side_effects` is now used by notification dispatch for idempotent delivery of Slack channel posts and DM notifications on run terminal transitions.
- [ ] **Enrichment writes are not transactional** — `handleEnrich` performs `saveEnrichmentResult`, `enqueueOutbox(write_artifacts)`, `transitionRunStatus(ready)`, and `enqueueOutbox(enqueue_execute)` as four separate writes (`apps/worker/src/automation/index.ts:114-134`). A crash between writes can leave a run in an inconsistent state, recoverable only via lease expiry and re-claim. Impact: low (lease recovery works), but violates the outbox pattern's transactional intent.


---
# FILE: docs/specs/billing-metering.md
---

# Billing & Metering — System Spec

## 1. Scope & Purpose

### In Scope
- Billing state machine and state transitions per organization
- Shadow balance (locally cached credit balance with atomic deduction)
- Compute metering (interval-based billing for running sessions)
- LLM spend sync (cursor-based ingestion from LiteLLM spend logs)
- Credit gating (unified gate for session start/resume/CLI/automation)
- Billing event outbox (retry failed Autumn posts)
- Billing reconciliation and audit trail
- Trial credit provisioning and auto-activation
- Org pause / snapshot enforcement on zero balance (resumable)
- Overage policy (pause vs allow, per-org)
- Checkout flow (plan activation, credit top-ups via Autumn)
- Snapshot quota management (count and retention limits)
- Atomic concurrent admission (advisory lock at session insert)
- Billing worker (BullMQ repeatable jobs)
- Runtime auth interaction with billing enforcement paths

### Out of Scope
- LLM virtual key generation and model routing — see `llm-proxy.md`
- Onboarding flow that triggers trial activation — see `auth-orgs.md`
- Session pause/terminate mechanics (provider-side) — see `sessions-gateway.md`
- Sandbox provider interface — see `sandbox-providers.md`

### Mental Model

Billing tracks how much each organization consumes and enforces credit limits. Two independent cost streams feed a single credit pool: **compute** (sandbox uptime, metered every 30s) and **LLM** (model inference, synced from LiteLLM spend logs). Both deduct from a **shadow balance** — a locally cached credit counter that is updated atomically with billing event insertion, then asynchronously reconciled with the external billing provider (Autumn).

The system is designed around three principles: (1) **no external API calls in the hot path** — gating decisions read the local shadow balance, not Autumn; (2) **fail-closed** — on errors, sessions are blocked rather than allowed; (3) **exactly-once billing** — idempotency keys derived from interval boundaries prevent double-charges.

**Core entities:**
- **Shadow balance** — per-org cached credit counter on the `organization` row. Deductions are always atomic with billing event insertion inside `FOR UPDATE` transactions. Initialization and reconciliation may write without `FOR UPDATE`. Source of truth for gating decisions.
- **Billing event** — an immutable ledger row recording a credit deduction. Acts as an outbox entry for Autumn sync.
- **Billing state** — org-level FSM (`unconfigured → trial → active → grace → exhausted → suspended`) that governs session lifecycle enforcement.
- **Billing reconciliation** — audit record for any balance adjustment (manual, sync, refund).

**Key invariants:**
- Shadow balance **deduction** is atomic with billing event insertion (single Postgres transaction with `FOR UPDATE` row lock). Initialization (`initializeShadowBalance`) writes without `FOR UPDATE`.
- A `[from, to)` compute interval is billed exactly once; idempotency key = `compute:{sessionId}:{fromMs}:{toMs}`.
- Billing events for `trial` or `unconfigured` orgs are inserted with `status: "skipped"` so the outbox ignores them. The insert is still required for idempotency: a crash between deduction and checkpoint advancement must not cause a double-deduct on retry.
- Grace period defaults to 5 minutes (max configurable: 1 hour); maximum overdraft is 500 credits.

---

## 2. Core Concepts

### Autumn
Open-source billing system on top of Stripe. Handles subscriptions, metered usage, and credit systems. Proliferate uses Autumn for plan management, payment collection, and as the authoritative balance (reconciled asynchronously with shadow balance).
- Key detail agents get wrong: Autumn is **not** called in the session/CLI gating hot path. It is called by the outbox worker, billing API routes (`getInfo`, `activatePlan`, `buyCredits`), and trial auto-activation — but never during session start/resume decisions.
- Reference: `packages/shared/src/billing/autumn-client.ts`

### Shadow Balance
A locally-persisted credit counter stored as `shadow_balance` on the `organization` table. Updated atomically with billing event insertions inside a `FOR UPDATE` transaction. Periodically reconciled with Autumn's actual balance.
- Key detail agents get wrong: The shadow balance can go negative (overdraft). Enforcement happens after deduction to keep the ledger accurate.
- Reference: `packages/services/src/billing/shadow-balance.ts`

### Billing State Machine
Six-state FSM on the organization governing what operations are allowed. Transitions are triggered by balance depletion, grace expiry, credit additions, and manual overrides.
- Key detail agents get wrong: `trial → exhausted` is direct (no grace period for trials). `active → grace → exhausted` uses a timed grace window.
- Reference: `packages/shared/src/billing/state.ts`

### Credit System
1 credit = $0.01 (1 cent). Compute: 1 credit/minute. LLM: `response_cost × 3× markup / $0.01`.
- Key detail agents get wrong: Both compute and LLM costs deduct from the same `credits` feature in Autumn.
- Reference: `packages/shared/src/billing/types.ts:calculateComputeCredits`, `calculateLLMCredits`

---

## 3. File Tree

```
packages/shared/src/billing/
├── index.ts                    # Module re-exports
├── types.ts                    # BillingState, PlanConfig, credit rates, metering config
├── state.ts                    # State machine transitions, enforcement actions
├── gating.ts                   # Unified billing gate (checkBillingGate)
├── autumn-client.ts            # Autumn HTTP client (attach, check, track, top-up)
├── autumn-types.ts             # Autumn API type definitions, feature/product IDs
└── autumn-client.test.ts       # Autumn client tests

packages/services/src/billing/
├── index.ts                    # Re-exports all billing service modules
├── gate.ts                     # Iron Door: checkBillingGateForOrg, assertBillingGateForOrg, getOrgPlanLimits
├── db.ts                       # Billing event queries, per-org LLM cursor ops, billable org enumeration, partition maintenance
├── litellm-api.ts              # LiteLLM Admin REST API client (GET /spend/logs/v2)
├── shadow-balance.ts           # Atomic deduct/add/bulk-deduct/reconcile/initialize shadow balance
├── metering.ts                 # Compute metering cycle, sandbox liveness, finalization
├── auto-topup.ts               # Overage auto-top-up: buy packs when balance goes negative (policy=allow)
├── outbox.ts                   # Outbox worker: retry failed Autumn posts
├── org-pause.ts                # Billing enforcement orchestration (pause/snapshot policy)
├── trial-activation.ts         # Auto-activate plan after trial exhaustion
└── snapshot-limits.ts          # Snapshot quota checking, retention cleanup, provider-side deletion

packages/services/src/sessions/
└── db.ts                       # createWithAdmissionGuard, createSetupSessionWithAdmissionGuard (atomic concurrent admission)

packages/db/src/schema/
└── billing.ts                  # billingEventKeys, billingEvents, llmSpendCursors (per-org), billingReconciliations tables

apps/web/src/server/routers/
└── billing.ts                  # oRPC routes: getInfo, updateSettings, activatePlan, buyCredits

apps/web/src/app/api/billing/   # DEPRECATED — thin adapters forwarding to oRPC (§10.3 Workstream A, Phase 1.1)

apps/web/src/lib/
└── billing.ts                  # Session gating helpers (checkCanStartSession, isBillingEnabled)

apps/worker/src/billing/
├── index.ts                    # Worker exports (start/stop/health)
└── worker.ts                   # BullMQ-based billing worker lifecycle

apps/worker/src/jobs/billing/
├── providers.ts                # Shared sandbox provider utilities (used by metering for liveness checks)
├── metering.job.ts             # BullMQ processor: compute metering (every 30s)
├── outbox.job.ts               # BullMQ processor: billing outbox (every 60s)
├── grace.job.ts                # BullMQ processor: grace expiration (every 60s)
├── reconcile.job.ts            # BullMQ processor: nightly reconciliation (00:00 UTC)
├── llm-sync-dispatcher.job.ts  # BullMQ processor: LLM sync fan-out (every 30s)
├── llm-sync-org.job.ts         # BullMQ processor: per-org LLM spend sync
├── fast-reconcile.job.ts       # BullMQ processor: on-demand fast shadow balance reconciliation
├── partition-maintenance.job.ts # BullMQ processor: billing events partition maintenance (02:00 UTC)
└── snapshot-cleanup.job.ts     # BullMQ processor: daily snapshot retention cleanup (01:00 UTC)
```

---

## 4. Data Models & Schemas

### Database Tables

```
billing_event_keys
├── idempotency_key   TEXT PK
└── created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
Indexes: (created_at) — for retention cleanup
```

```
billing_events
├── id                UUID PK
├── organization_id   TEXT FK → organization.id (CASCADE)
├── event_type        TEXT NOT NULL ('compute' | 'llm')
├── quantity          NUMERIC(12,6) NOT NULL
├── credits           NUMERIC(12,6) NOT NULL
├── idempotency_key   TEXT NOT NULL UNIQUE
├── session_ids       TEXT[] DEFAULT []
├── status            TEXT NOT NULL DEFAULT 'pending' ('pending'|'posted'|'failed'|'skipped')
├── retry_count       INT DEFAULT 0
├── next_retry_at     TIMESTAMPTZ DEFAULT now()
├── last_error        TEXT
├── autumn_response   JSONB
├── metadata          JSONB DEFAULT {}
└── created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
Indexes: (org_id, created_at), (status, next_retry_at), (org_id, event_type, created_at)
```

```
llm_spend_cursors (per-org, replaces global singleton)
├── organization_id      TEXT PK FK → organization.id (CASCADE)
├── last_start_time      TIMESTAMPTZ NOT NULL
├── last_request_id      TEXT
├── records_processed    INT DEFAULT 0
└── synced_at            TIMESTAMPTZ NOT NULL DEFAULT now()
```


```
billing_reconciliations
├── id                UUID PK
├── organization_id   TEXT FK → organization.id (CASCADE)
├── type              TEXT NOT NULL ('shadow_sync'|'manual_adjustment'|'refund'|'correction')
├── previous_balance  NUMERIC(12,6) NOT NULL
├── new_balance       NUMERIC(12,6) NOT NULL
├── delta             NUMERIC(12,6) NOT NULL
├── reason            TEXT NOT NULL
├── performed_by      TEXT FK → user.id (SET NULL)
├── metadata          JSONB DEFAULT {}
└── created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
Indexes: (org_id, created_at), (type)
```

### Billing Fields on `organization` Table

The following columns live on the `organization` table (owned by `auth-orgs.md`):
- `billing_state` — current FSM state
- `shadow_balance` — cached credit balance (NUMERIC)
- `shadow_balance_updated_at` — last update timestamp
- `grace_entered_at`, `grace_expires_at` — grace window timestamps
- `billing_plan` — selected plan (`dev` | `pro`)
- `billing_settings` — JSONB (overage policy, cap — user-facing settings only)
- `autumn_customer_id` — external Autumn customer reference
- `overage_used_cents` — INT, first-class counter for overage charges this cycle (replaces JSONB field)
- `overage_cycle_month` — TEXT `"YYYY-MM"`, lazy monthly reset key
- `overage_topup_count` — INT, top-ups this cycle (velocity limit)
- `overage_last_topup_at` — TIMESTAMPTZ, rate limiting
- `overage_decline_at` — TIMESTAMPTZ, circuit breaker (non-null = tripped)
- `last_reconciled_at` — TIMESTAMPTZ, staleness tracking for reconciliation

### Plan Configuration

| Plan | Monthly | Credits | Max Sessions | Max Snapshots | Retention |
|------|---------|---------|-------------|---------------|-----------|
| dev  | $20     | 1,000   | 10          | 5             | 30 days   |
| pro  | $500    | 7,500   | 100         | 200           | 90 days   |

Trial: 1,000 credits granted at signup. Top-up pack: 500 credits for $5.

---

## 5. Conventions & Patterns

### Do
- Always deduct from shadow balance via `deductShadowBalance()` or `bulkDeductShadowBalance()` — these are the **only** paths for credit deduction (`packages/services/src/billing/shadow-balance.ts`).
- Use deterministic idempotency keys: `compute:{sessionId}:{fromMs}:{toMs}` for regular intervals, `compute:{sessionId}:{fromMs}:final` for finalization, `llm:{requestId}` for LLM events.
- Billing cycles run as BullMQ repeatable jobs with concurrency 1 — no manual locking needed.

### Don't
- Do not call Autumn APIs in the session start/resume hot path — use `checkBillingGate()` with local shadow balance.
- Never insert billing events outside a `deductShadowBalance` transaction — this breaks the atomicity invariant.
- Avoid skipping billing event insertion for trial/unconfigured orgs — these events use `status: "skipped"` so the outbox ignores them, but the insert is required for idempotency (prevents double-deduction on crash/retry).

### Error Handling
Billing is **fail-closed**: if org lookup fails, billing state is unreadable, or shadow balance can't be computed, the operation is denied. See `apps/web/src/lib/billing.ts:checkCanStartSession`.

### Reliability
- **Metering concurrency**: BullMQ repeatable job with concurrency 1 ensures single-execution.
- **Outbox retries**: exponential backoff from 60s base, max 1h, up to 5 attempts. After 5 failures, event is permanently marked `failed`.
- **Idempotency**: `billingEvents.idempotency_key` UNIQUE constraint with `onConflictDoNothing` — prevents double-billing without aborting the transaction.
- **Sandbox liveness**: 3 consecutive alive-check failures before declaring dead (`METERING_CONFIG.graceFailures`).

---

## 6. Subsystem Deep Dives

### 6.1 Compute Metering — `Implemented`

**What it does:** Bills running sessions for elapsed compute time every 30 seconds.

**Happy path:**
1. `runMeteringCycle()` is invoked by the BullMQ `billing-metering` repeatable job (`packages/services/src/billing/metering.ts:runMeteringCycle`).
2. Queries all sessions with `status = 'running'`.
3. Checks sandbox liveness via provider `checkSandboxes()` with grace period (3 consecutive failures = dead).
4. For alive sandboxes: computes `billableSeconds = floor((now - meteredThroughAt) / 1000)`, skips if < 10s.
5. Calls `deductShadowBalance()` with deterministic idempotency key.
6. Advances `sessions.metered_through_at`.
7. If billing enforcement is required, invokes org-level enforcement flow — unless transitioning from trial (tries `tryActivatePlanAfterTrial()` first).

**Edge cases:**
- Dead sandbox → `billFinalInterval()` bills through `last_seen_alive_at + pollInterval`, not detection time. Marks session `paused` (preserves resumability).
- BullMQ concurrency 1 ensures only one metering cycle runs at a time.

**Files touched:** `packages/services/src/billing/metering.ts`, `shadow-balance.ts`, `org-pause.ts`, `trial-activation.ts`

### 6.2 Shadow Balance — `Implemented`

**What it does:** Maintains an atomic, locally-cached credit balance per organization.

**Happy path (`deductShadowBalance`):**
1. Opens a Postgres transaction with `FOR UPDATE` on the organization row.
2. Inserts billing event (idempotent via `onConflictDoNothing` on `idempotency_key`).
3. If duplicate → returns `{ success: false }` without modifying balance.
4. Computes `newBalance = previousBalance - credits`.
5. Evaluates state transitions: if `newBalance <= 0` and state is `active`/`trial`, transitions to `grace`/`exhausted`.
6. Checks overdraft cap (500 credits); if exceeded in grace, transitions to `exhausted`.
7. Updates `shadow_balance`, `billing_state`, and grace fields atomically.

**`bulkDeductShadowBalance(orgId, events)`:** Batch variant for high-throughput LLM spend sync. Opens exactly one transaction → `FOR UPDATE` org row → bulk `INSERT INTO billing_events ON CONFLICT DO NOTHING` → sums credits only for newly inserted rows → deducts that sum from shadow balance. Same state-transition logic as `deductShadowBalance`.

**`addShadowBalance`:** Adds credits (top-ups, refunds). If state is `grace`/`exhausted` and new balance > 0, transitions back to `active`. Inserts a `billing_reconciliations` record.

**`reconcileShadowBalance`:** Corrects drift between local and Autumn balance. Inserts reconciliation record for audit trail.

**Files touched:** `packages/services/src/billing/shadow-balance.ts`, `packages/db/src/schema/billing.ts`

### 6.3 Credit Gating — `Implemented`

**What it does:** Single entry point for session-lifecycle billing checks.

**Happy path:**
1. `checkCanStartSession()` fetches org billing info from DB (`apps/web/src/lib/billing.ts`).
2. Calls `checkBillingGate()` with org state, shadow balance, session counts, and operation type.
3. Gate checks (in order): grace expiry → billing state → credit sufficiency (min 11 credits) → concurrent session limit.
4. Returns `{ allowed: true }` or `{ allowed: false, errorCode, message, action }`.

**Operations gated:** `session_start`, `session_resume`, `cli_connect`, `automation_trigger`. Resume and CLI connect skip the concurrent limit check **and** the credit minimum threshold (state-level checks still apply).

**Enforcement points:**
- oRPC `createSessionHandler` (`apps/web/src/server/routers/sessions-create.ts`) — `session_start` / `automation_trigger`
- Gateway session creation (`apps/gateway/src/api/proliferate/http/sessions.ts`) — `session_start` / `automation_trigger`
- Gateway setup session (`startSetupSession` in same file) — `session_start`
- Managed prebuild setup session (`packages/services/src/managed-prebuild.ts`) — `session_start` (logs and skips on denial)
- Runtime resume/cold-start (`apps/gateway/src/hub/session-runtime.ts:doEnsureRuntimeReady`) — `session_resume` (already-running sessions skip this check via `ensureRuntimeReady` early return)
- Message path coverage: `postPrompt` → `handlePrompt` → `ensureRuntimeReady` → `doEnsureRuntimeReady`, so the runtime resume gate covers message-triggered cold-starts transitively.

**Atomic concurrent admission (TOCTOU-safe):**

The billing gate's concurrent limit check (Step 4 in `checkBillingGate`) serves as a fast rejection. The authoritative enforcement is at session insert time via `createWithAdmissionGuard` / `createSetupSessionWithAdmissionGuard` (`packages/services/src/sessions/db.ts`).

Approach: **transaction-scoped advisory lock** (`pg_advisory_xact_lock`).
1. Open a Postgres transaction.
2. Acquire `pg_advisory_xact_lock(hashtext(orgId || ':session_admit'))` — serializes per-org admission.
3. Count sessions with `status IN ('starting', 'pending', 'running')` within the transaction.
4. If count >= plan limit, return `{ created: false }` without inserting.
5. Otherwise, insert the session row and commit.

The lock is released automatically when the transaction commits/rolls back. It does not block other orgs, other session operations (update, delete), or non-admission queries.

**Tradeoffs considered:**
- **Advisory lock (chosen):** Minimal scope (per-org, transaction-lifetime), no schema changes, no deadlock risk with other billing operations. Serializes only concurrent creates for the same org.
- **Org row `FOR UPDATE` lock:** Would conflict with shadow balance deductions (which also lock the org row), causing unnecessary contention between metering and session creation.
- **Redis atomic counter:** Adds external dependency to the admission path and requires rollback semantics on insert failure. Not justified given Postgres already handles this well.

**Files touched:** `packages/shared/src/billing/gating.ts`, `packages/services/src/billing/gate.ts`, `packages/services/src/sessions/db.ts`, `apps/web/src/lib/billing.ts`

### 6.4 LLM Spend Sync — `Implemented`

**What it does:** Ingests LLM cost data into billing events via the LiteLLM Admin REST API and per-org cursors. Uses a BullMQ dispatcher → per-org fan-out pattern for parallelism.

**Happy path:**
1. Dispatcher job (`billing-llm-sync-dispatch`, every 30s) lists billable orgs via `billing.listBillableOrgIds()` — states `active`, `trial`, `grace` (`packages/services/src/billing/db.ts`).
2. Enqueues one `billing-llm-sync-org` job per org (deduplicated by org ID).
3. Per-org worker (concurrency 5):
   a. Reads per-org cursor (`billing.getLLMSpendCursor(orgId)`) or defaults to 5-min lookback.
   b. Fetches spend logs via `billing.fetchSpendLogs(orgId, startDate)` (`packages/services/src/billing/litellm-api.ts`).
   c. Converts logs with positive `spend` to `BulkDeductEvent[]` using `calculateLLMCredits()`.
   d. Calls `billing.bulkDeductShadowBalance(orgId, events)` — single transaction with idempotent insert (`packages/services/src/billing/shadow-balance.ts`).
   e. Advances per-org cursor to latest log's `startTime`.
4. Handles state transitions: when enforcement is required, calls `enforceCreditsExhausted(orgId)` to pause/snapshot running sessions.

**Edge cases:**
- First run for an org (no cursor) → starts from 5-min lookback.
- REST API failure for one org → logged and skipped; other orgs continue.
- Duplicate logs → idempotency key `llm:{request_id}` prevents double-billing.

**Files touched:** `apps/worker/src/jobs/billing/llm-sync-dispatcher.job.ts`, `apps/worker/src/jobs/billing/llm-sync-org.job.ts`, `packages/services/src/billing/litellm-api.ts`, `packages/services/src/billing/db.ts`, `packages/services/src/billing/shadow-balance.ts`

### 6.5 Outbox Processing — `Implemented`

**What it does:** Retries posting billing events to Autumn that failed or haven't been posted yet.

**Happy path:**
1. `processOutbox()` is invoked by the BullMQ `billing-outbox` repeatable job (`packages/services/src/billing/outbox.ts`).
2. Queries billing events with `status IN ('pending', 'failed')`, `retry_count < 5`, `next_retry_at < now()`.
3. For each event: calls `autumnDeductCredits()` to post to Autumn.
4. On success: marks `status = 'posted'`. If Autumn denies, transitions org to `exhausted` and calls `enforceCreditsExhausted(orgId)` to pause/snapshot running sessions.
5. On failure: increments retry count, sets exponential backoff. After 5 retries, marks `failed` permanently and emits `alert: true` log with `orgId`, `eventId`, `credits`, and `retryCount` for monitoring.

**Files touched:** `packages/services/src/billing/outbox.ts`, `packages/shared/src/billing/autumn-client.ts`

### 6.6 Billing State Machine — `Implemented`

**What it does:** Governs org billing lifecycle through six states with defined transitions.

**State transition map:**
```
unconfigured → active (plan_attached) | trial (trial_started)
trial        → active (plan_attached) | exhausted (balance_depleted)
active       → grace (balance_depleted) | suspended (manual)
grace        → exhausted (grace_expired/overdraft) | active (credits_added) | suspended (manual)
exhausted    → active (credits_added) | suspended (manual)
suspended    → active (manual_unsuspend)
```

**Enforcement actions (spec policy):** `grace` → blocks new sessions. `exhausted`/`suspended` → pause/snapshot running sessions so they are resumable.

**Cross-spec invariant:** billing must treat `status: "paused"` (for inactivity/credit enforcement) as meter-stopping, equivalent to legacy `stopped` semantics for metering closure.

**Files touched:** `packages/shared/src/billing/state.ts`

### 6.7 Org Billing Enforcement (Pause/Snapshot Policy) — `Implemented`

**What it does:** Applies org-level enforcement when credits are exhausted/suspended by pausing/snapshotting sessions (resumable), not hard-terminating user work.

**`enforceCreditsExhausted(orgId)`:** Iterates all running sessions for the org and calls `pauseSessionWithSnapshot()` for each. Returns `{ paused, failed }`.

**`pauseSessionWithSnapshot()`:** Lock-safe per-session enforcement:
1. Acquires migration lock (300s TTL) via `runWithMigrationLock`
2. Re-verifies session is still running (may have been paused by gateway idle snapshot)
3. Snapshots: memory (preferred) → pause → filesystem, depending on provider capabilities
4. Terminates sandbox (non-pause/non-memory providers only)
5. CAS DB update with `sandbox_id` fencing — `status: "paused"`, `pauseReason: "credit_limit"`
6. Revokes LLM virtual key (best-effort)

If the lock is already held (e.g., by an idle snapshot in progress), the session is skipped. Sessions that fail to pause are counted in `failed` and left running — the next enforcement cycle will retry.

**`canOrgStartSession`:** Checks concurrent session count against plan limit (superseded by atomic admission guard in `sessions/db.ts`).

**Callers:**
- `metering.ts` → `billComputeInterval()` when `shouldPauseSessions` (after trial auto-activation check)
- `outbox.ts` → `processEvent()` when Autumn denies credits
- `grace.job.ts` → on grace period expiration
- `llm-sync-org.job.ts` → when LLM spend depletes balance

**Files touched:** `packages/services/src/billing/org-pause.ts`

### 6.8 Trial Credit Provisioning — `Implemented`

**What it does:** 1,000 trial credits granted at signup. When trial credits deplete, auto-activates the selected plan if payment method exists.

**`tryActivatePlanAfterTrial`:**
1. Checks if org already has the plan product in Autumn.
2. If yes, resolves credits from Autumn and transitions to `active`.
3. If no, calls `autumnAttach()` — if payment method on file, plan activates; otherwise returns `requiresCheckout`.
4. Handles `product_already_attached` error gracefully.

**Files touched:** `packages/services/src/billing/trial-activation.ts`

### 6.9 Checkout Flow — `Implemented`

**What it does:** Initiates plan activation or credit purchase via Autumn/Stripe checkout.

**`activatePlan`:** Calls `autumnAttach()` with the selected plan product. Returns checkout URL if payment required, otherwise initializes billing state as `active`.

**`buyCredits`:** Purchases 1-10 top-up packs (500 credits / $5 each). If payment method on file, charges immediately and updates shadow balance. Otherwise returns checkout URL.

**Files touched:** `apps/web/src/server/routers/billing.ts`

### 6.10 Snapshot Quota Management — `Implemented`

**What it does:** Defines per-plan snapshot count and retention limits. Snapshots are free within quota (no credit charge).

**Quota enforcement (on snapshot creation):**
- `sessions-pause.ts` and `sessions-snapshot.ts` call `ensureSnapshotCapacity(orgId, plan, deleteSnapshotFromProvider)` before creating snapshots.
- If at limit, evicts oldest snapshot (expired first, then by `paused_at`). Eviction clears DB ref after best-effort provider cleanup via `deleteSnapshotFromProvider`.

**Retention cleanup (daily background):**
- `billing-snapshot-cleanup` BullMQ job runs daily at 01:00 UTC.
- Calls `cleanupAllExpiredSnapshots()` which sweeps all sessions with snapshots past the global `SNAPSHOT_RETENTION_DAYS` cap (default 14 days), bounded to 500 per cycle.

**Provider-side deletion:** `deleteSnapshotFromProvider` is currently a no-op — providers (Modal, E2B) auto-expire snapshot resources. The function serves as the designated hook point for when providers add delete APIs.

**Files touched:** `packages/services/src/billing/snapshot-limits.ts`, `apps/worker/src/jobs/billing/snapshot-cleanup.job.ts`

### 6.11 Distributed Locks — `Removed`

Distributed locks (`packages/shared/src/billing/distributed-lock.ts`) were removed. BullMQ repeatable jobs with concurrency 1 now ensure single-execution guarantees for metering, outbox, and other billing cycles.

### 6.12 Billing Worker — `Implemented` (BullMQ)

**What it does:** Runs billing tasks as BullMQ repeatable jobs with dedicated queues and workers.

| Queue | Schedule | Processor |
|-------|----------|-----------|
| `billing-metering` | Every 30s | `metering.job.ts` → `billing.runMeteringCycle()` |
| `billing-outbox` | Every 60s | `outbox.job.ts` → `billing.processOutbox()` |
| `billing-grace` | Every 60s | `grace.job.ts` → grace expiration checks |
| `billing-reconcile` | Daily 00:00 UTC | `reconcile.job.ts` → enumerates orgs via `billing.listBillableOrgsWithCustomerId()`, fetches Autumn balance per org, calls `billing.reconcileShadowBalance()`, alerts on drift > threshold |
| `billing-llm-sync-dispatch` | Every 30s | `llm-sync-dispatcher.job.ts` → fan-out per-org jobs |
| `billing-llm-sync-org` | On-demand | `llm-sync-org.job.ts` → per-org LLM spend sync |
| `billing-fast-reconcile` | On-demand (concurrency 3) | `fast-reconcile.job.ts` → single-org shadow balance reconciliation with Autumn, triggered by auto-top-up/payment/denial |
| `billing-snapshot-cleanup` | Daily 01:00 UTC | `snapshot-cleanup.job.ts` → `billing.cleanupAllExpiredSnapshots()` |
| `billing-partition-maintenance` | Daily 02:00 UTC | `partition-maintenance.job.ts` → create future partitions, clean old keys, log detachment candidates |

Guarded by `NEXT_PUBLIC_BILLING_ENABLED` env var.

**Files touched:** `apps/worker/src/billing/worker.ts`, `apps/worker/src/jobs/billing/*.ts`, `packages/queue/src/index.ts`

### 6.13 Overage Auto-Top-Up — `Implemented`

**What it does:** When an org has `overage_policy = "allow"` and its shadow balance goes negative, `attemptAutoTopUp()` purchases credit packs via `autumnAutoTopUp()` to keep sessions running. Called from all 4 enforcement paths: compute metering, LLM sync, grace expiration, and outbox denial.

**Key design decisions:**
- Runs **outside** the `deductShadowBalance` FOR UPDATE transaction (Autumn HTTP call can't be inside a DB lock)
- Uses `pg_advisory_xact_lock(hashtext(orgId || ':auto_topup'))` to prevent concurrent top-ups per org, distinct from shadow balance lock
- Uses existing `TOP_UP_PRODUCT` (500 credits/$5) with multiple packs for larger amounts
- Lazy monthly reset: `overage_cycle_month` stores `"YYYY-MM"`, counters reset on first access in a new month
- Circuit breaker: card decline sets `overage_decline_at`, forces immediate transition to exhausted state
- Velocity limit: max 20 top-ups per cycle (`OVERAGE_MAX_TOPUPS_PER_CYCLE`), min 60s between (`OVERAGE_MIN_TOPUP_INTERVAL_MS`)
- Cap enforcement: if `overage_cap_cents` is set, packs are clamped to remaining budget

**Files touched:** `packages/services/src/billing/auto-topup.ts`, integration points in `metering.ts`, `outbox.ts`, `llm-sync-org.job.ts`, `grace.job.ts`

### 6.14 Fast Reconciliation — `Implemented`

**What it does:** On-demand shadow balance reconciliation triggered by payment events (auto-top-up, credit purchases, plan activations, outbox denials). Targets < 5 min SLO for reflecting payment events in shadow balance, vs nightly-only before.

**Flow:** Enqueue `billing-fast-reconcile` job with `{ orgId, trigger }` → fetch Autumn balance → reconcile shadow balance → update `last_reconciled_at`. Uses BullMQ `jobId: orgId` for deduplication (at most one queued job per org).

**Trigger points:**
- After successful auto-top-up (from metering/LLM sync callers)
- After `buyCredits` oRPC procedure
- After `activatePlan` oRPC procedure
- After outbox denial

**Files touched:** `apps/worker/src/jobs/billing/fast-reconcile.job.ts`, `apps/worker/src/billing/worker.ts`, `apps/web/src/server/routers/billing.ts`

### 6.15 Billing Token — `Removed`

The billing token subsystem (`billing-token.ts`, `mintBillingToken`, `verifyBillingToken`, `validateBillingToken`) and its refresh endpoint have been removed. The `billing_token_version` column has been dropped from the `sessions` table (migration `0032_drop_billing_token_version.sql`). Runtime/sandbox auth is handled by existing gateway/session token flows.

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `auth-orgs.md` | Billing → Orgs | `orgs.getBillingInfoV2()`, `orgs.initializeBillingState()` | Reads/writes billing fields on `organization` table |
| `auth-orgs.md` | Orgs → Billing | `startTrial` in onboarding router | Onboarding triggers trial credit provisioning |
| `llm-proxy.md` | LLM → Billing | `GET /spend/logs/v2` REST API | LLM spend sync via `litellm-api.ts` (replaces cross-schema SQL) |
| `sessions-gateway.md` | Sessions → Billing | `checkCanStartSession()` | Session creation calls billing gate |
| `sessions-gateway.md` | Billing → Sessions | `sessions.status`, `metered_through_at` | Metering reads/updates session rows |
| `sandbox-providers.md` | Billing → Providers | `provider.checkSandboxes()`, `getSandboxProvider()` | Liveness checks for metering; `org-pause.ts` resolves providers directly via `getSandboxProvider()` for enforcement pause/snapshot |
| `automations-runs.md` | Automations → Billing | `billing.assertBillingGateForOrg()` | `automation_trigger` gate enforced in gateway session creation route |

### Security & Auth
- Billing routes use `orgProcedure` middleware (authenticated + org context). Settings and checkout require admin/owner role.
- Runtime/sandbox auth uses existing gateway/session token flows; there is no dedicated billing-token module in the current billing subsystem.
- No sensitive data in billing events (no prompt content, no tokens). LLM metadata includes model name and token counts only.

### Observability
- Structured logging via `@proliferate/logger` with modules: `metering`, `org-pause`, `outbox`, `llm-sync`, `trial-activation`, `snapshot-limits`.
- Key log fields: `sessionId`, `orgId`, `billableSeconds`, `credits`, `balance`, `enforcementReason`.
- `getOutboxStats()` provides pending/failed/permanently-failed event counts for monitoring (`packages/services/src/billing/outbox.ts:getOutboxStats`).
- **Alerting signals** (`alert: true` log field):
  - Permanently failed outbox events — logged with `orgId`, `eventId`, `credits`, `retryCount`.
  - Reconciliation drift exceeding `METERING_CONFIG.reconcileDriftAlertThreshold` — logged with `orgId`, `drift`, `previousBalance`, `newBalance`.

---

## 8. Acceptance Gates

- [x] Typecheck passes (`pnpm typecheck`) — 22/22
- [ ] Billing tests pass (Autumn client tests)
- [x] This spec is updated (file tree, data models, deep dives)
- [x] Idempotency keys follow the deterministic pattern
- [x] Shadow balance is only modified via `deductShadowBalance`, `bulkDeductShadowBalance`, `addShadowBalance`, or `reconcileShadowBalance`
- [x] No Autumn API calls in session start/resume hot path — gating uses local shadow balance; Autumn called only by outbox worker, reconciliation job, and billing API routes
- [x] All billable admission paths go through `assertBillingGateForOrg` or `checkBillingGateForOrg`
- [x] Concurrent session limits are atomically enforced via `pg_advisory_xact_lock` admission guard
- [x] Exhausted/suspended enforcement uses pause/snapshot (resumable), not hard-terminate

---

## 9. Known Limitations & Tech Debt

### Resolved in this PR

- [x] **All billable admission paths are gated** — Gateway session creation, oRPC session creation, setup sessions (gateway + managed-prebuild), and runtime resume/cold-start all enforce the billing gate. Resume uses `session_resume` (state-only checks, no credit minimum).
- [x] **Concurrent session limits are atomic** — `createWithAdmissionGuard` / `createSetupSessionWithAdmissionGuard` use `pg_advisory_xact_lock` to serialize per-org admission at insert time.
- [x] **Enforcement is pause/snapshot-first (resumable)** — `enforceCreditsExhausted` calls `pauseSessionWithSnapshot()` per session: migration lock → snapshot → CAS update to `status: "paused"` with `pauseReason: "credit_limit"`. Provider instances are resolved internally via `getSandboxProvider()`.
- [x] **Snapshot quota lifecycle is complete** — `ensureSnapshotCapacity` called with `deleteSnapshotFromProvider` in pause/snapshot handlers. `cleanupAllExpiredSnapshots` runs daily via `billing-snapshot-cleanup` BullMQ job at 01:00 UTC.
- [x] **Nightly reconciliation is active** — `listBillableOrgsWithCustomerId()` enumerates orgs with `billingState IN ('active','trial','grace') AND autumnCustomerId IS NOT NULL`. Per-org errors are isolated. Drift exceeding `METERING_CONFIG.reconcileDriftAlertThreshold` (500 credits) emits `alert: true`.
- [x] **Outbox permanent failures are alerted** — Permanently failed events log with `alert: true`, `orgId`, `eventId`, `credits`, and `retryCount`.

### Open

#### Behavioral / Financial Risk

- [ ] **Enforcement retry gap (P0)** — `enforceCreditsExhausted()` in `org-pause.ts` iterates sessions and calls `pauseSessionWithSnapshot()` per session. If pause fails (provider timeout, network error), the session is logged but **not retried** — it stays `running` and continues consuming unbilled resources. Next enforcement cycle (metering or outbox) may retry, but a persistent provider failure can leave sessions running indefinitely. — Expected fix: dedicated retry queue for failed enforcement pauses, or a sweeper job that re-checks `running` sessions against org billing state.
- [x] **Overage policy is incomplete (P0)** — **Resolved.** Mutable counters moved to first-class columns (`overage_used_cents`, `overage_cycle_month`, `overage_topup_count`, `overage_last_topup_at`, `overage_decline_at`). `attemptAutoTopUp()` implements full overage execution: deficit-aware pack sizing, lazy monthly reset, velocity/rate limits, cap enforcement, circuit breaker on card decline. Wired into all 4 enforcement paths. See §6.13.
- [ ] **LLM cursor not atomic with bulk deduct (P1)** — In `llm-sync-org.job.ts`, the per-org cursor is advanced **after** `bulkDeductShadowBalance()` returns, outside the deduction transaction. If the worker crashes between deduct and cursor update, the same spend logs are re-fetched and re-processed on the next cycle. Idempotency keys (`llm:{requestId}`) prevent double-billing, but the wasted work and log noise scale with LLM volume. — Expected fix: advance cursor inside the bulk deduct transaction.
- [ ] **Metering crash window (P2)** — `meteredThroughAt` is advanced in a separate DB update after `deductShadowBalance()`. If the worker crashes between the two, the next cycle re-bills the same interval — caught by idempotency key (no double charge), but the session appears "stuck" with stale `meteredThroughAt` until the next successful cycle. — Impact: no financial risk due to idempotency; operational noise only.

#### Dead Code / Drift

- [x] **Dead `billing_token_version` column (P1)** — Dropped in migration `0032_drop_billing_token_version.sql`. Column removed from schema and all code references.
- [x] **Legacy `/api/billing/*` routes are dead code (P1)** — Converted to thin adapters with `Deprecation` headers. oRPC is the authoritative billing API surface; adapters will be removed after deprecation window.
- [ ] **LLM model allowlist is dead code (P2)** — `ALLOWED_LLM_MODELS` and `isModelAllowedForBilling()` in `types.ts` have **zero callers** anywhere in the codebase. Code comment claims models are "REJECTED (fail closed)" but no enforcement exists. All models with LiteLLM spend data are billed. — Expected fix: see §10.3 Workstream F (remove dead constants, add anomaly monitoring).
- [x] **`shouldTerminateSessions` field name is legacy (P2)** — Renamed to `shouldPauseSessions` across `DeductResult`, `BulkDeductResult`, and all callers. `EnforcementAction.terminate_sessions` renamed to `pause_sessions`. `shouldTerminateSessionsInState()` renamed to `shouldPauseSessionsInState()`.
- [x] **`BillingEventStatus` type omits `skipped` (P2)** — Resolved by adding `"skipped"` to the `BillingEventStatus` union type. Trial/unconfigured orgs insert billing events with `status: "skipped"` for idempotency; the outbox ignores them.

#### Architectural / Scalability

- [x] **Shadow balance drift persists up to 24h (P1)** — **Resolved.** Event-driven fast reconciliation queue (`billing-fast-reconcile`) triggers on auto-top-up, credit purchases, plan activations, and outbox denials. Per-org `last_reconciled_at` tracks staleness. Nightly reconcile remains as backstop. See §6.14.
- [ ] **Billing events have no retention/archival (P1)** — `billing_events` grows unbounded. No TTL, partitioning, or archival job exists. At scale this will impact query performance on the outbox and org-scoped queries. — Expected fix: see §10.3 Workstream E (monthly partitioning, 90-day hot window).
- [ ] **Grace expiration is polling-based (P2)** — `billing-grace` job runs every 60s, meaning grace can overrun by up to ~60s. — Impact: minor, grace window is 5 minutes.
- [ ] **Grace query includes NULL `graceExpiresAt` (P2)** — `listGraceExpiredOrgs()` matches `graceExpiresAt IS NULL OR graceExpiresAt < now()`. An org in `grace` state with a NULL expiry timestamp is immediately expired. This is likely intentional (defensive fail-closed), but not documented. — Expected fix: add inline comment or assert `graceExpiresAt IS NOT NULL` on grace entry.
- [ ] **Single-region billing worker (P2)** — All BullMQ billing jobs run through a single Redis instance. No multi-region failover for the billing worker. — Impact: acceptable for current scale; revisit if going multi-region.

---

## 10. Billing Alignment Audit & Remediation Plan (2026-02-19)

This section verifies the external billing sweep against current code and defines the implementation plan to align billing behavior, interfaces, and documentation.

Companion long-form advisor brief (no-codebase-access context): `docs/billing-alignment-advisor-spec.md`.

### 10.1 Verification Matrix

| Claim | Verdict | Evidence | Notes |
|---|---|---|---|
| Dual billing API surface (oRPC + `/api/billing/*`) | **Resolved** | Legacy routes converted to thin adapters with deprecation headers; oRPC is authoritative | Phase 1.1 Workstream A |
| Grace expiry can overrun by ~60s | Confirmed | `apps/worker/src/jobs/billing/grace.job.ts` | Poll interval is 60s. |
| `shouldTerminateSessions` is misnamed | **Resolved** | Renamed to `shouldPauseSessions` | Phase 1.1 Workstream C |
| Snapshot provider delete is no-op | Confirmed | `packages/services/src/billing/snapshot-limits.ts:deleteSnapshotFromProvider` | DB refs are cleared while provider cleanup is best-effort no-op. |
| Billing events have no retention/archival policy | Confirmed | `packages/db/src/schema/billing.ts`, no archival job | Table growth is unbounded. |
| Overages settings exist but enforcement/reset not visible | **Resolved** | `packages/services/src/billing/auto-topup.ts`, org overage columns | Overage counters moved to first-class columns; `attemptAutoTopUp()` implements full execution with lazy monthly reset, circuit breaker, velocity limits. Phase 1.2 Workstream B. |
| Shadow balance drift can persist until nightly reconcile | **Resolved** | `apps/worker/src/jobs/billing/fast-reconcile.job.ts`, `apps/worker/src/billing/worker.ts` | Event-driven fast reconciliation queue triggers on payment events; nightly reconcile remains as backstop. Phase 1.2 Workstream D. |
| Billing token exists but is unwired | **Resolved** | Module removed; `billing_token_version` column dropped | Phase 1.1 Workstream C |
| LLM allowlist blocks new models until updated | Stale / incorrect | `ALLOWED_LLM_MODELS` exists but no callers | Current risk is policy ambiguity, not active model rejection. |
| Enforcement pause failure leaves sessions running | Confirmed | `packages/services/src/billing/org-pause.ts:enforceCreditsExhausted` | Failed `pauseSessionWithSnapshot()` calls are logged but not retried within the same cycle. |
| LLM cursor advanced outside deduct transaction | Confirmed | `apps/worker/src/jobs/billing/llm-sync-org.job.ts` | Crash between bulk deduct and cursor update causes re-processing (mitigated by idempotency keys). |
| Grace query matches NULL `graceExpiresAt` | Confirmed | `packages/services/src/orgs/db.ts:listGraceExpiredOrgs` | `IS NULL OR < now()` — likely intentional fail-closed but undocumented. |
| `NEXT_PUBLIC_BILLING_ENABLED` bypass | Not a risk | `packages/services/src/billing/gate.ts`, worker guard | Proper feature flag — disabled = all operations allowed, no enforcement. Consistent across gate and worker. |

Additional drift observed during verification:
- ~~`BillingEventStatus` in shared types omits `skipped`~~ — **Resolved**: `"skipped"` added to `BillingEventStatus` type. Trial/unconfigured events are inserted with `status: "skipped"` for idempotency.
- ~~Legacy `/api/billing/buy-credits` route comments still describe `$20 / 2000 credits`~~ — **Resolved**: legacy routes converted to thin adapters mirroring canonical oRPC logic with deprecation headers.
- `meteredThroughAt` advance is not atomic with `deductShadowBalance()` — crash between them causes idempotent re-billing on next cycle (no financial risk, operational noise).

### 10.2 Remediation Goals

1. Single authoritative billing API surface and contract.
2. Explicit, enforced overage policy semantics.
3. Lower drift window between shadow balance and Autumn.
4. Durable ledger lifecycle (retention + archival).
5. Remove stale billing-token assumptions and dead code/doc references.
6. Consistent naming/types that match pause-first enforcement behavior.

### 10.3 Revised Workstreams (Advisor-Incorporated)

#### Workstream A — Consolidate Billing API Surface (P0, Phase 1.1)

Scope:
- Make oRPC the single authoritative product API for billing.
- Convert `/api/billing/*` to thin adapters during deprecation, then remove them.
- Eliminate duplicated logic/constants across route surfaces.

Acceptance:
- No duplicated billing business logic in route handlers.
- Frontend uses oRPC-only billing paths.
- Adapter behavior remains contract-equivalent during deprecation.

#### Workstream C — Contract and Type Cleanup (P0, Phase 1.1)

Scope:
- Rename pause-enforcement fields to match actual behavior (pause/snapshot, not terminate).
- Remove stale billing-token references and deprecate dead token-version schema usage.
- Resolve `skipped` status drift by adding `"skipped"` to the `BillingEventStatus` type (aligns type with runtime behavior).
- Fix stale pricing/comment/documentation mismatches.

Acceptance:
- Runtime and shared types/contracts are aligned.
- No billing specs reference non-existent token modules.
- `BillingEventStatus` type includes `"skipped"`, matching runtime behavior for trial/unconfigured orgs.

#### Workstream B — Overage Policy End-to-End (P0, Phase 1.2)

Scope:
- Adopt auto-top-up overage model (`allow`) with prepaid continuity.
- Move overage counters from JSON settings into first-class columns.
- Implement lazy monthly rollover (`overage_cycle_month`) instead of global reset cron.
- Enforce cap and state transitions deterministically.

Mandatory guardrails:
- Card-decline circuit breaker (no infinite retry loop).
- Velocity limits (daily/cycle top-up caps).
- Deficit-aware top-up sizing after burst underflow.

Acceptance:
- Overage behavior is deterministic under success/failure modes.
- UI reflects operational overage counters.
- Cap and decline paths fail closed.

#### Workstream D — Fast Reconciliation and Unblock Path (P0/P1, Phase 1.2+)

Scope:
- Keep nightly full reconcile.
- Add event-driven fast-reconcile triggers for top-up/attach/denial/backlog signals.
- Track reconcile staleness explicitly and alert on stale drift.

Acceptance:
- Payment-to-usable-balance path reconciles within minutes.
- Drift alerts include magnitude and stale-age context.

#### Workstream E — Ledger Retention and Archival (P1, Phase 2)

Scope:
- Partition `billing_events` monthly in Postgres.
- Keep 90-day hot window.
- Archive by detaching old partitions (not app-level ETL workers).

Acceptance:
- Hot data growth is bounded.
- Historical usage remains recoverable for audit/support.

#### Workstream F — LLM Billing Policy Clarification (P1, Phase 2)

Scope:
- Remove unused billing-layer model allowlist/cost-floor checks from deduction path.
- Bill all authoritative spend logs from LiteLLM.
- Add anomaly monitoring (`$0 spend with >0 tokens`, unknown-model spikes).

Acceptance:
- No dead billing safety constants remain.
- Model-cost anomalies are observable and alertable.

### 10.4 Revised Execution Order

1. Phase 1.1: Workstreams A + C (stabilize and remove drift).
2. Phase 1.2: Workstreams B + D (new financial logic with fast reconcile).
3. Phase 2: Workstreams E + F (+ remaining D hardening).

### 10.5 Critical Failure Scenarios to Cover

1. Card decline retry loop: terminal decline must flip to fail-closed path immediately.
2. Runaway auto-top-up velocity: enforce hard caps to prevent fraud/charge storms.
3. LLM burst underflow: top-up logic must clear full deficit, not single-block blindly.
4. Snapshot quota contradiction: if snapshot fails in enforcement flow, define explicit fail-closed fallback.
5. Resume gate window: atomic resume checks must use balance-derived conditions, not state label only.

### 10.6 Advisor Rulings Adopted (D1-D7)

1. D1: Overage model = auto-top-up increments.
2. D2: Overage accounting = first-class columns, not JSON counter mutations.
3. D3: Legacy REST billing routes = thin adapters, then removal.
4. D4: Billing-token-version legacy concept = remove/deprecate.
5. D5: LLM allowlist in billing path = remove; monitor anomalies instead.
6. D6: Ledger hot retention target = 90 days.
7. D7: Reconcile SLO = <5 minutes for payment events, 24 hours for minor drift.

### 10.7 Required Spec Follow-ups During Implementation

When implementing any workstream above, update in the same PR:
- `docs/specs/billing-metering.md` (§3 file tree, §4 models, §6 deep dives, §7 cross-cutting, §9 limitations).
- `docs/specs/feature-registry.md` statuses/evidence for billing rows.
- Any touched cross-spec references (`sessions-gateway.md`, `llm-proxy.md`, `auth-orgs.md`).


---
# FILE: docs/specs/boundary-brief.md
---

# Spec Program — Boundary Brief

> **Purpose:** Every agent writing a spec MUST read this file first. It defines what each spec owns, canonical terminology, and cross-reference rules.
> **Rule:** If something is out of scope for your spec, link to the owning spec. Do not re-explain it.

---

## 1. Spec Registry

| # | Spec file | One-line scope | Phase |
|---|-----------|---------------|-------|
| 1 | `agent-contract.md` | System prompt modes, OpenCode tool schemas, capability injection into sandboxes. | 1 |
| 2 | `sandbox-providers.md` | Modal + E2B provider interface, sandbox boot, snapshot resolution, git freshness, sandbox-mcp. | 1 |
| 3 | `sessions-gateway.md` | Session lifecycle (create/pause/resume/snapshot/delete), gateway hub, WebSocket/HTTP streaming, migration, preview. | 2 |
| 4 | `automations-runs.md` | Automation definitions, run pipeline (enrich → execute → finalize), outbox dispatch, notifications, Slack async client, artifacts, side effects, claiming. | 2 |
| 5 | `triggers.md` | Trigger registry, webhook ingestion, polling, cron scheduling, trigger-service, provider adapters (GitHub/Linear/Sentry/PostHog). | 2 |
| 6 | `actions.md` | Action invocations, approval flow, grants, risk classification, provider adapters (Linear/Sentry), sweeper. | 2 |
| 7 | `llm-proxy.md` | LiteLLM proxy, virtual key generation, per-org/per-session spend tracking, model routing. | 2 |
| 8 | `cli.md` | Device auth flow, local config, file sync, OpenCode launch, CLI-specific API routes. | 2 |
| 9 | `repos-configurations.md` | Repo CRUD, configuration management, base + repo snapshot builds, service commands, env file generation. | 3 |
| 10 | `secrets-environment.md` | Secret CRUD, bundles, bulk import, env file deployment to sandbox, encryption. | 3 |
| 11 | `integrations.md` | OAuth connection lifecycle for GitHub/Sentry/Linear/Slack via Nango. Connection binding to repos/automations/sessions. | 3 |
| 12 | `auth-orgs.md` | better-auth, user/org/member model, invitations, onboarding/trial activation, API keys, admin/impersonation. | 3 |
| 13 | `billing-metering.md` | Usage metering, credit gating, trial credits, reconciliation, org pause, Autumn integration. Owns charging/gating policy. | 3 |

### Phase ordering

- **Phase 1** specs are heavily cross-referenced by everything else. Write these first.
- **Phase 2** specs can run in parallel after phase 1 is complete.
- **Phase 3** specs can run in parallel after phase 2 is complete.

---

## 2. Strict Boundary Rules

These boundaries resolve the most likely overlaps. Follow them exactly.

| Boundary | Rule |
|----------|------|
| **Integrations vs Actions/Automations/Sessions** | `integrations.md` owns external credential/connectivity lifecycle (OAuth integrations + MCP connector catalog). Runtime behavior that *uses* those records belongs to the consuming spec (Actions, Automations, Sessions). |
| **Actions vs Integrations (connectors)** | `actions.md` owns action execution, risk, approval, grants, and audit behavior. `integrations.md` owns persistence and scope of org-level connector configuration (target ownership). Current implementation still stores connectors on configurations as a legacy transitional path documented in `repos-configurations.md`. |
| **Agent Contract vs Sessions/Automations** | `agent-contract.md` owns prompt templates, tool schemas, and capability injection. Runtime behavior that *executes* tools belongs to `sessions-gateway.md` (interactive) or `automations-runs.md` (automated). |
| **Agent Contract vs Sandbox Providers** | `agent-contract.md` owns what tools exist and their schemas. `sandbox-providers.md` owns how tools are injected into the sandbox environment (plugin config, MCP server). |
| **LLM Proxy vs Billing** | `llm-proxy.md` owns key generation, routing, and spend *events*. `billing-metering.md` owns charging policy, credit gating, and balance enforcement. |
| **Triggers vs Automations** | `triggers.md` owns event ingestion, matching, and dispatch. Once a trigger fires, the resulting automation run belongs to `automations-runs.md`. The handoff point is the `AUTOMATION_ENRICH` queue enqueue. |
| **Sessions vs Sandbox Providers** | `sessions-gateway.md` owns the session lifecycle and gateway runtime. `sandbox-providers.md` owns the provider interface and sandbox boot mechanics. Sessions *calls* the provider interface; the provider spec defines the contract. |
| **Repos/Configurations vs Sessions** | `repos-configurations.md` owns repo records, configuration configs, and snapshot *builds*. `sandbox-providers.md` owns snapshot *resolution* (`resolveSnapshotId()` in `packages/shared/src/snapshot-resolution.ts`). `sessions-gateway.md` owns the configuration *resolver* (`apps/gateway/src/lib/configuration-resolver.ts`) which determines which configuration to use at session start. |
| **Secrets vs Sandbox Providers** | `secrets-environment.md` owns secret CRUD and bundle management. How secrets get deployed into a running sandbox is `sandbox-providers.md` (env injection at boot) + `agent-contract.md` (the `save_env_files` tool). |
| **Auth/Orgs vs Billing** | `auth-orgs.md` owns user/org model, membership, and onboarding flow. `billing-metering.md` owns trial credit provisioning, plan management, and checkout. Onboarding *triggers* trial activation but billing *owns* the credit grant. |
| **CLI vs Sessions** | `cli.md` owns the CLI-specific entry point (device auth, local config, file sync). Session creation from CLI uses the same session lifecycle defined in `sessions-gateway.md`. |

---

## 3. Canonical Glossary

Use these terms consistently. Do not introduce synonyms.

| Term | Meaning | Do NOT call it |
|------|---------|----------------|
| **sandbox** | The remote compute environment (Modal container or E2B sandbox) where the agent runs. | environment, container, instance, VM |
| **session** | A user-initiated or automation-initiated interaction backed by a sandbox. Has a lifecycle (creating → running → paused → completed). | workspace, project, run (when interactive) |
| **run** | A single execution of an automation. Has a lifecycle (queued → enriching → ready → running → succeeded/failed/needs_human/timed_out/canceled/skipped). | session (when automated), job |
| **hub** | The gateway-side object managing a session's runtime state, WebSocket connections, and event processing. | session manager, controller |
| **provider** | The sandbox compute backend (Modal or E2B). Implements the `SandboxProvider` interface. | runtime, backend, platform |
| **configuration** | A reusable configuration + snapshot combination for faster session starts. Previously called "prebuild" in some code. | prebuild (in specs — use "configuration" consistently) |
| **snapshot** | A saved filesystem state. Three layers: base snapshot, repo snapshot, configuration snapshot. | image, checkpoint, save point |
| **action** | A platform-mediated operation the agent performs on external services (e.g., create Linear issue, update Sentry). | tool (tools are the broader category; actions are the external-service subset) |
| **integration** | An OAuth-backed external connection record (GitHub/Linear/Sentry/Slack) used to resolve tokens server-side. | adapter, connector, provider |
| **connector** | A configuration entry (org-scoped) describing how to reach an MCP server and which secrets/auth mapping to use. | integration, adapter |
| **action source** | The origin of an action definition surfaced to the agent (adapter or connector-backed source). | integration, transport |
| **tool** | A capability available to the agent inside the sandbox. Includes both platform tools (verify, save_snapshot) and action tools. | action (unless it's specifically an external-service action) |
| **trigger** | An event source that can start an automation run. Types: webhook, polling, scheduled (cron). | event, hook, listener |
| **outbox** | The transactional outbox table used for reliable event dispatch. | queue, event log |
| **invocation** | A single request to execute an action, with its approval state. | action request, action call |
| **grant** | A reusable permission allowing an agent to perform an action without per-invocation approval. | permission, allowance |
| **bundle** | A named group of secrets. | secret group, env set |
| **virtual key** | A temporary LiteLLM API key scoped to a session/org for cost isolation. | proxy key, session key |

---

## 4. Cross-Reference Rules

1. **Link, don't re-explain.** If a concept is owned by another spec, write: `See [spec-name.md], section N` and move on. One sentence of context is fine; a paragraph is not.
2. **Use the dependency table.** Every spec has a "Cross-Cutting Concerns" section (template section 7) with a dependency table. Use it to document every cross-spec interface.
3. **Stable section numbers.** The template enforces a fixed section structure (1-9). Reference by number: "See `sessions-gateway.md` §6.2" will be stable across drafts.
4. **File ownership is exclusive.** Every source file belongs to exactly one spec. If two specs seem to need the same file, the file belongs to whichever spec owns the entity the file primarily operates on. The other spec references it.

---

## 5. Writing Rules

1. **Document `main` as it is today.** Do not describe aspirational architecture. Flag gaps in section 9 (Known Limitations).
2. **Cite file paths.** Every claim about behavior must include at least one file path. Prefer `path/to/file.ts:functionName` format.
3. **Target 300-600 lines per spec.** Enough for depth, short enough that agents will actually read it.
4. **Follow the template exactly.** Use `docs/specs/template.md`. Do not add, remove, or rename sections.
5. **Status classifications for features:**
   - `Implemented` — in `main`, tested or visibly working.
   - `Partial` — core path works, known gaps exist (list them).
   - `Planned` — design intent exists, code does not.
   - `Deprecated` — still in code but being removed.
6. **Do not document UI components.** Specs cover backend behavior, data models, and contracts. Frontend pages are evidence of a feature existing, not the spec itself.

---

## 6. Per-Agent Prompt Template

When spawning an agent to write a spec, use this structure:

```
You are writing a system spec for the Proliferate codebase.

READ THESE FILES FIRST (in order):
1. docs/specs/boundary-brief.md — boundary rules and glossary (MANDATORY)
2. docs/specs/template.md — spec template (follow exactly)
3. docs/specs/feature-registry.md — feature inventory for your scope

YOUR ASSIGNMENT:
- Spec file: docs/specs/[spec-name].md
- In scope: [list of features, files, tables, routes]
- Out of scope: [explicit list with owning spec names]

KEY FILES TO READ: [list 5-15 starting-point files]

RULES:
- Document what is in main today, not aspirational design
- Cite file paths as evidence for every behavioral claim
- Link to other specs for out-of-scope concepts (see boundary brief §4)
- Use only terms from the canonical glossary (see boundary brief §3)
- Target 300-600 lines
- Classify every feature as Implemented/Partial/Planned/Deprecated
```


---
# FILE: docs/specs/cli.md
---

# CLI — System Spec

## 1. Scope & Purpose

### In Scope
- CLI entry point, command parsing, and main flow orchestration
- Device auth flow (OAuth device code → API key → token persistence)
- Local config and state management (`~/.proliferate/` directory)
- SSH key generation, storage, and upload
- File sync (unidirectional local → sandbox via rsync over SSH)
- OpenCode binary discovery and launch
- CLI-specific API routes (auth, repos, sessions, SSH keys, GitHub, prebuilds)
- CLI-specific database tables (device codes, SSH keys, GitHub selections)
- Device ID generation and prebuild path hashing
- CLI package structure and Deno-based build

### Out of Scope
- Session lifecycle after creation (pause/resume/snapshot/delete) — see `sessions-gateway.md` §6
- Sandbox boot mechanics and provider interface — see `sandbox-providers.md` §6
- Repo/prebuild management beyond CLI-specific routes — see `repos-prebuilds.md`
- Auth system internals / better-auth — see `auth-orgs.md`
- Billing credit checks (called but not owned) — see `billing-metering.md`
- GitHub OAuth connection lifecycle via Nango — see `integrations.md`

### Mental Model

The CLI is the local entry point for developers who want to connect their local workspace to a Proliferate sandbox. It runs a single linear flow: **authenticate → configure → create session → sync files → launch OpenCode**. The entire flow completes in seconds and results in an interactive coding agent attached to a remote sandbox that mirrors the user's local directory.

The CLI is a compiled Deno binary that bundles an OpenCode binary for the current platform. It communicates with two backends: the **web API** (for device auth, SSH keys, repos) and the **gateway** (for session creation and OpenCode attachment). Authentication is token-based — the device flow produces a better-auth API key that is stored locally and reused across sessions.

**Core entities:**
- **Device code** — a short-lived code pair (user code + device code) used in the OAuth device authorization flow. The user code is human-readable (e.g., `ABCD-1234`); the device code is a 32-byte hex secret for polling.
- **SSH key** — an ed25519 key pair generated per machine, stored in `~/.proliferate/`. The public key is uploaded to the server and injected into sandboxes for rsync access.
- **Device ID** — a per-machine random identifier stored in `~/.proliferate/device-id`. Used to scope prebuild hashes so the same local path on different machines maps to different prebuilds.
- **Local path hash** — a 16-char hex SHA-256 of `{deviceId}::{absolutePath}`. Uniquely identifies a local project directory per device for session/repo/prebuild matching.

**Key invariants:**
- The CLI is unidirectional: files flow from local → sandbox only, never sandbox → local.
- One SSH key pair per machine. Re-running the CLI reuses the existing key.
- Token persistence uses file permissions (`0o600`) for security. The `~/.proliferate/` directory uses `0o700`.
- The CLI exits with the same exit code as the OpenCode process.

---

## 2. Core Concepts

### OAuth Device Code Flow
The CLI uses RFC 8628 device authorization. The CLI requests a device code from the API, displays a user code, opens a browser to the verification URL, and polls until the user authorizes. On success, the API creates a better-auth API key (non-expiring) and returns it.
- Key detail agents get wrong: the poll endpoint creates the API key, not the authorize endpoint. Authorization and key creation are separate steps — the `/device` page calls `authorizeDevice`, then the CLI's next poll call triggers `pollDevice` which creates the API key.
- Reference: `packages/cli/src/state/auth.ts:deviceFlow`, `apps/web/src/server/routers/cli.ts:cliAuthRouter`

### Gateway Client SDK
The CLI uses `@proliferate/gateway-clients` to communicate with the gateway for session creation and OpenCode attachment. Two client types: `createSyncClient` for session management and `createOpenCodeClient` for getting the OpenCode attach URL.
- Key detail agents get wrong: the main flow in `main.ts` uses the gateway SDK directly, not the web API routes. The `ApiClient` in `packages/cli/src/lib/api.ts` is an older HTTP client that talks to web API routes — both exist in the codebase.
- Reference: `packages/cli/src/main.ts`, `packages/gateway-clients/`

### Deno Compilation
The CLI is written in TypeScript with `.ts` extensions in imports and compiled to standalone binaries using `deno compile`. It does not use `tsc` for emit — `noEmit: true` is set. Cross-compilation targets four platforms: `darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`.
- Key detail agents get wrong: the `package.json` version is embedded in the binary via `--include=package.json`. Version reading uses `import.meta.dirname` which works in both dev (Deno) and compiled binary contexts.
- Reference: `packages/cli/package.json`, `packages/cli/src/lib/constants.ts`

---

## 3. File Tree

```
packages/cli/
├── package.json                         # v0.3.9, bin: proliferate, Deno compile scripts
├── tsconfig.json                        # ES2022, noEmit, bundler resolution
├── bin/                                 # Platform-specific OpenCode binaries (not in git)
│   ├── opencode-darwin-arm64
│   ├── opencode-darwin-x64
│   ├── opencode-linux-arm64
│   └── opencode-linux-x64
└── src/
    ├── index.ts                         # Entry point: --version, --help, reset, main()
    ├── main.ts                          # Main flow: auth → config → session → sync → opencode
    ├── state/
    │   ├── auth.ts                      # Device flow, token persistence, health check
    │   └── config.ts                    # ~/.proliferate/config.json management
    ├── lib/
    │   ├── constants.ts                 # CLI_VERSION, GATEWAY_URL, GITHUB_REPO
    │   ├── ssh.ts                       # SSH key generation, fingerprinting, path hashing
    │   ├── device.ts                    # Device ID generation and persistence
    │   ├── sync.ts                      # FileSyncer class (rsync-based)
    │   ├── api.ts                       # ApiClient (HTTP client for web API routes)
    │   └── opencode.ts                  # OpenCode binary path resolution (lib variant)
    └── agents/
        └── opencode.ts                  # OpenCode launch (spawn with attach URL)

packages/services/src/cli/
├── index.ts                             # Re-exports from service.ts
├── service.ts                           # Business logic (device codes, SSH, repos, sessions)
└── db.ts                                # Drizzle queries (50+ functions)

packages/shared/src/contracts/
└── cli.ts                               # Zod schemas + ts-rest contract

packages/db/src/schema/
└── cli.ts                               # Tables: userSshKeys, cliDeviceCodes, cliGithubSelections

apps/web/src/server/routers/
└── cli.ts                               # oRPC router (6 sub-routers)

apps/web/src/app/
├── api/cli/sessions/route.ts            # Standalone POST route (gateway SDK session creation)
└── device/page.tsx                      # Device code authorization page
```

---

## 4. Data Models & Schemas

### Database Tables

```
cli_device_codes
├── id              UUID PRIMARY KEY
├── user_code       TEXT NOT NULL UNIQUE    -- human-readable (ABCD-1234)
├── device_code     TEXT NOT NULL UNIQUE    -- 32-byte hex secret
├── user_id         TEXT FK → user(id)     -- set on authorization
├── org_id          TEXT FK → organization(id)  -- set on authorization
├── status          TEXT NOT NULL DEFAULT 'pending'  -- pending|authorized|expired
├── expires_at      TIMESTAMPTZ NOT NULL   -- 15 minutes from creation
├── created_at      TIMESTAMPTZ
└── authorized_at   TIMESTAMPTZ            -- set when user approves

Indexes: user_code, device_code, expires_at
```

```
user_ssh_keys
├── id              UUID PRIMARY KEY
├── user_id         TEXT NOT NULL FK → user(id) CASCADE
├── public_key      TEXT NOT NULL
├── fingerprint     TEXT NOT NULL UNIQUE    -- SHA256 base64 format
├── name            TEXT                    -- e.g., "hostname-cli"
└── created_at      TIMESTAMPTZ

Index: user_id
```

```
cli_github_selections
├── user_id         TEXT NOT NULL FK → user(id) CASCADE  ┐
├── organization_id TEXT NOT NULL FK → organization(id)  ┘ COMPOSITE PK
├── connection_id   TEXT NOT NULL
├── expires_at      TIMESTAMPTZ NOT NULL   -- 5 minutes from creation
└── created_at      TIMESTAMPTZ

Index: expires_at
```

Source: `packages/db/src/schema/cli.ts`

### Core TypeScript Types

```typescript
// packages/cli/src/state/auth.ts
interface StoredAuth {
  token: string;
  user: { id: string; email: string; name?: string };
  org: { id: string; name: string };
}

// packages/cli/src/state/config.ts
interface Config {
  apiUrl?: string;       // Override API base URL (defaults to https://app.proliferate.com)
  syncMode?: "gitignore" | "all";
  modelId?: string;      // Agent model override
}

// packages/cli/src/lib/ssh.ts
interface SSHKeyInfo {
  privateKeyPath: string;
  publicKeyPath: string;
  publicKey: string;
  fingerprint: string;   // SHA256:xxx format from ssh-keygen
}

// packages/cli/src/lib/sync.ts
interface SyncJob {
  local: string;         // Local path (supports ~)
  remote: string;        // Remote path on sandbox
  delete?: boolean;      // Remove files not in source
  excludes?: string[];
  respectGitignore?: boolean;
}
```

### Local Filesystem Layout

```
~/.proliferate/
├── token              # StoredAuth JSON (0o600)
├── config.json        # Config JSON (0o600)
├── device-id          # 8-char UUID prefix (0o600)
├── id_ed25519         # SSH private key
└── id_ed25519.pub     # SSH public key
```

---

## 5. Conventions & Patterns

### Do
- Use `@proliferate/gateway-clients` for gateway communication — it handles auth headers and connection management.
- Hash local paths with `hashPrebuildPath()` (device-scoped) for prebuild matching, not `hashLocalPath()` (device-agnostic).
- Return structured errors via `ORPCError` in API routes — the CLI checks `response.ok` and parses error messages.
- Use `ora` spinners for all long-running CLI operations — keeps UX consistent.

### Don't
- Add Windows support — the CLI exits immediately on `win32` with a WSL2 recommendation (`packages/cli/src/index.ts:12-17`).
- Use `console.log` for structured output — the CLI uses `chalk` for colored terminal output and `ora` for spinners.
- Add new CLI commands without updating the help text in `packages/cli/src/index.ts`.
- Import `@proliferate/db` directly in CLI service code — use `@proliferate/services/db/client` per project conventions.

### Error Handling

```typescript
// CLI-side pattern: spinners with fail/succeed
const spinner = ora("Creating session...").start();
try {
  const result = await client.createSession({ ... });
  spinner.succeed("Session ready");
} catch (err) {
  spinner.fail("Failed to create session");
  console.error(chalk.red(`Error: ${err instanceof Error ? err.message : err}`));
  process.exit(1);
}
```

Source: `packages/cli/src/main.ts:38-68`

### Reliability
- **Auth token validation**: Token is verified via gateway health check on every CLI invocation. Expired tokens trigger automatic re-auth via device flow. Source: `packages/cli/src/state/auth.ts:ensureAuth`
- **Device flow polling**: 5-second intervals, 180 attempts (15-minute timeout). Network errors during polling are silently retried. Source: `packages/cli/src/state/auth.ts:151-205`
- **Sync failures**: Non-fatal. The CLI warns but continues to OpenCode launch. Source: `packages/cli/src/main.ts:103-106`
- **Device code expiry**: 900 seconds (15 minutes). Codes in `pending` status past `expires_at` are treated as `expired` on next poll. Source: `packages/services/src/cli/service.ts:createDeviceCode`

---

## 6. Subsystem Deep Dives

### 6.1 CLI Entry Point and Main Flow

**What it does:** Parses arguments, gates Windows, and orchestrates the auth → config → session → sync → opencode pipeline. **Status: Implemented**

**Happy path:**
1. `packages/cli/src/index.ts` checks for `--version`, `--help`, `reset` commands
2. Default path calls `main()` from `packages/cli/src/main.ts`
3. `ensureAuth()` — returns cached token or runs device flow
4. `ensureConfig()` — reads `~/.proliferate/config.json` with env fallbacks
5. `createSyncClient()` — creates gateway client with CLI token
6. `client.createSession()` — creates session with `sandboxMode: "immediate"` (sandbox ready in response)
7. `FileSyncer.sync()` — rsync workspace + config to sandbox via SSH
8. `createOpenCodeClient().getUrl()` — gets OpenCode attach URL from gateway
9. `launchOpenCode(attachUrl)` — spawns OpenCode binary in attach mode
10. Process exits with OpenCode's exit code

**Edge cases:**
- Windows → immediate exit with WSL2 recommendation
- `proliferate reset` → deletes `~/.proliferate/` entirely and exits
- Sync failure → warns but continues (sandbox may still work without local files)
- Missing SSH host/port from session response → exits with error

**Files touched:** `packages/cli/src/index.ts`, `packages/cli/src/main.ts`

### 6.2 Device Auth Flow

**What it does:** Authenticates the CLI user via OAuth device code flow, producing a persistent API key. **Status: Implemented**

**Happy path:**
1. CLI POSTs to `{apiUrl}/api/cli/auth/device` (no auth required)
2. Server generates user code (4 alpha + 4 digits, e.g., `ABCD-1234`) and device code (32-byte hex) via `cli.createDeviceCode()` (`packages/services/src/cli/service.ts`)
3. Server stores code pair in `cli_device_codes` with 15-minute expiry, status `pending`
4. CLI displays user code, opens browser to `{baseUrl}/device?code={userCode}`
5. User visits `/device` page (`apps/web/src/app/device/page.tsx`), enters or auto-submits code
6. Page calls `cliAuthRouter.authorizeDevice` — sets `user_id`, `org_id`, `status=authorized` on the device code row
7. CLI polls `{apiUrl}/api/cli/auth/device/poll` with device code every 5 seconds
8. On `status=authorized`: `cliAuthRouter.pollDevice` creates a better-auth API key via `auth.api.createApiKey()`, checks GitHub connection status, deletes the device code row
9. CLI saves `{ token, user, org }` to `~/.proliferate/token` (mode `0o600`)
10. CLI generates SSH key pair if needed and uploads public key to `/api/cli/ssh-keys`

**Edge cases:**
- `DEV_USER_ID` env var set → device code is auto-approved on creation (dev shortcut). Source: `apps/web/src/server/routers/cli.ts:142-147`
- SSH key already registered → `409 CONFLICT` is caught and treated as success. Source: `packages/cli/src/state/auth.ts:240-256`
- Token health check fails on subsequent runs → clears token, re-runs device flow. Source: `packages/cli/src/state/auth.ts:82-88`

**Files touched:** `packages/cli/src/state/auth.ts`, `apps/web/src/server/routers/cli.ts:cliAuthRouter`, `packages/services/src/cli/service.ts`, `apps/web/src/app/device/page.tsx`

### 6.3 Local Config Management

**What it does:** Manages CLI configuration in `~/.proliferate/config.json` with environment variable and cloud-default fallbacks. **Status: Implemented**

**Config resolution (priority order):**
1. `config.json` values (user-set overrides)
2. Environment variables (e.g., `NEXT_PUBLIC_API_URL` for `apiUrl`)
3. Cloud default (`https://app.proliferate.com`) when no local override is set

**Files in `~/.proliferate/`:**

| File | Content | Created by |
|------|---------|-----------|
| `token` | `StoredAuth` JSON | Device flow |
| `config.json` | `Config` JSON | `saveConfig()` |
| `device-id` | 8-char UUID prefix | `getDeviceId()` |
| `id_ed25519` | SSH private key | `generateSSHKey()` |
| `id_ed25519.pub` | SSH public key | `generateSSHKey()` |

All files use `0o600` permissions. Directory uses `0o700`.

**Files touched:** `packages/cli/src/state/config.ts`, `packages/cli/src/lib/device.ts`

### 6.4 File Sync

**What it does:** Pushes local workspace files to the sandbox via rsync over SSH. **Status: Implemented**

**Happy path:**
1. `FileSyncer` initialized with sandbox SSH host and port
2. Main workspace synced from `cwd` to `/home/user/workspace` with `--delete` and `.gitignore` filtering
3. Additional config sync jobs from `CONFIG_SYNC_JOBS` (currently empty array)
4. Rsync uses `--info=progress2` for percentage-based progress reporting
5. After all jobs complete, `chown -R user:user /home/user` fixes ownership (rsync runs as root)

**Rsync flags:** `-az` (archive + compress), `--no-inc-recursive` (full file list for accurate progress), `-e ssh` with `StrictHostKeyChecking=no`, `IdentitiesOnly=yes`, `ConnectTimeout=10`.

**Edge cases:**
- Non-existent local paths are silently skipped (filtered before sync)
- Non-directory files get `mkdir -p` for parent directory on remote before transfer
- `.gitignore` filtering only applies if `.gitignore` exists in the source directory
- Sync errors are non-fatal — CLI warns and continues

**Files touched:** `packages/cli/src/lib/sync.ts`, `packages/cli/src/main.ts:79-106`

### 6.5 OpenCode Launch

**What it does:** Locates the bundled OpenCode binary and spawns it in attach mode. **Status: Implemented**

**Binary resolution order:**
1. `{__dirname}/../../bin/opencode-{platform}-{arch}` — development path
2. `{execPath}/../bin/opencode-{platform}-{arch}` — installed via npm/curl
3. `{execPath}/../opencode-{platform}-{arch}` — same directory as CLI binary

Platform: `darwin` or `linux`. Arch: `arm64` or `x64`.

The binary is spawned with `stdio: "inherit"` (shares terminal) and `env: runtimeEnv` (filtered environment). The CLI exits with OpenCode's exit code.

**Files touched:** `packages/cli/src/agents/opencode.ts`, `packages/cli/src/lib/opencode.ts`

### 6.6 CLI API Routes

**What it does:** Six oRPC sub-routers serve CLI-specific endpoints via `/api/rpc`. **Status: Implemented**

**Route summary (23 procedures across 6 sub-routers):**

| Sub-router | Procedure | Auth | Purpose |
|-----------|-----------|------|---------|
| `cliAuthRouter` | `createDeviceCode` | Public | Start device flow |
| | `authorizeDevice` | Protected | User approves device code |
| | `pollDevice` | Public | CLI polls for authorization |
| `cliSshKeysRouter` | `list` | Protected | List user's SSH keys |
| | `create` | Protected | Upload public key |
| | `delete` | Protected | Delete specific key |
| | `deleteAll` | Protected | Delete all user keys |
| `cliReposRouter` | `get` | Org | Get repo by path hash |
| | `create` | Org | Create/link local repo |
| | `deleteAll` | Org | Delete all local repos |
| `cliSessionsRouter` | `list` | Org | List CLI sessions |
| | `create` | Org | Create/resume terminal session |
| | `get` | Org | Get session details |
| | `delete` | Org | Terminate session |
| | `deleteAll` | Org | Terminate all sessions |
| | `checkSandboxes` | Protected | Check sandbox liveness |
| `cliGitHubRouter` | `status` | Org | Check GitHub connection |
| | `connect` | Org | Start Nango OAuth flow |
| | `connectStatus` | Org | Poll OAuth completion |
| | `select` | Org | Store connection selection |
| `cliPrebuildsRouter` | `get` | Protected | Lookup prebuild by path hash |
| | `create` | Protected | Snapshot + upsert prebuild |
| | `delete` | Protected | Delete prebuild |

**Session creation flow (`cliSessionsRouter.create`):**
1. Billing gate check (resume vs new session). See `billing-metering.md`.
2. If `resume=true`, look for running session with matching `localPathHash`
3. Fetch user's SSH public keys (required — error if none)
4. Optionally fetch GitHub token via integration connection
5. Create session in DB with `origin: "cli"`, `session_type: "terminal"`
6. Call `provider.createTerminalSandbox()` with SSH keys, env vars, clone instructions
7. Update session with sandbox ID and status `running`

**Standalone route (`POST /api/cli/sessions`):**
A separate Next.js route (`apps/web/src/app/api/cli/sessions/route.ts`) creates CLI sessions via the gateway SDK with `sandboxMode: "deferred"`. This is an alternative path where the gateway handles prebuild resolution.

**Files touched:** `apps/web/src/server/routers/cli.ts`, `apps/web/src/app/api/cli/sessions/route.ts`, `packages/services/src/cli/service.ts`

### 6.7 SSH Key Management

**What it does:** Generates, stores, and synchronizes SSH keys between CLI and server. **Status: Implemented**

**Client-side (CLI):**
- Key type: ed25519, no passphrase, comment `proliferate-cli`
- Generated via `ssh-keygen` subprocess (`packages/cli/src/lib/ssh.ts:generateSSHKey`)
- Stored at `~/.proliferate/id_ed25519` and `~/.proliferate/id_ed25519.pub`
- Fingerprint extracted via `ssh-keygen -lf` (SHA256 format)

**Server-side:**
- Public key stored in `user_ssh_keys` table with independently computed fingerprint
- Server fingerprint: `SHA256:<base64_no_padding(sha256(decoded_key_bytes))>` — base64 padding (`=`) is stripped (`packages/services/src/cli/service.ts:getSSHKeyFingerprint`)
- Unique constraint on fingerprint prevents duplicate key registration
- Keys are injected into sandbox at session creation via `provider.createTerminalSandbox()`

**Files touched:** `packages/cli/src/lib/ssh.ts`, `apps/web/src/server/routers/cli.ts:cliSshKeysRouter`, `packages/services/src/cli/service.ts`

### 6.8 GitHub Connection for CLI

**What it does:** Enables CLI sessions to access private GitHub repos via Nango OAuth. **Status: Implemented**

**Flow:**
1. CLI checks GitHub status via `cliGitHubRouter.status`
2. If not connected, starts OAuth via `cliGitHubRouter.connect` (creates Nango connect session)
3. User completes OAuth in browser
4. Web UI calls `cliGitHubRouter.select` to store the `connectionId` in `cli_github_selections` with 5-minute TTL
5. CLI polls `cliGitHubRouter.connectStatus` — checks `cli_github_selections` first, then falls back to querying Nango directly
6. On session creation, if `gitAuth=proliferate`, the GitHub token is fetched via the integration connection

**Files touched:** `apps/web/src/server/routers/cli.ts:cliGitHubRouter`, `packages/services/src/cli/service.ts`, `packages/db/src/schema/cli.ts:cliGithubSelections`

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `sessions-gateway.md` | CLI → Gateway | `createSyncClient`, `createOpenCodeClient` | Session creation and OpenCode attach via gateway SDK |
| `sandbox-providers.md` | Routes → Provider | `provider.createTerminalSandbox()` | CLI session route creates sandbox directly |
| `auth-orgs.md` | Routes → Auth | `auth.api.createApiKey()` | Device flow creates better-auth API key |
| `billing-metering.md` | Routes → Billing | `checkCanConnectCLI()`, `checkCanResumeSession()` | Billing gate before session creation |
| `integrations.md` | Routes → Nango | `nango.createConnectSession()` | GitHub OAuth for CLI |
| `repos-prebuilds.md` | Routes → Prebuilds | `provider.snapshot()` | CLI prebuild snapshots |

### Security & Auth
- Device codes expire after 15 minutes. Authorized codes are deleted after the API key is created.
- API keys created via device flow are non-expiring (`expiresIn: undefined`). Token revocation requires clearing `~/.proliferate/token` locally and revoking the key server-side.
- SSH private keys never leave the client machine. Only the public key is uploaded.
- Token file permissions are `0o600`; directory permissions are `0o700`.
- The `ApiClient` passes org ID via `X-Org-Id` header for organization context.

### Observability
- CLI API routes log via `@proliferate/logger` with `{ handler: "cli" }` context.
- CLI-side uses `console.error` with `chalk` for user-facing error messages (not structured logging — appropriate for a CLI tool).
- Session creation logs SSH key validation failures and sandbox creation errors.

---

## 8. Acceptance Gates

- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] CLI compiles for all four platforms (`deno compile` targets)
- [ ] Device flow completes successfully (manual test)
- [ ] File sync transfers workspace to sandbox (manual test)
- [ ] This spec is updated (file tree, data models, route table)

---

## 9. Known Limitations & Tech Debt

- [ ] **Two session creation paths** — `cliSessionsRouter.create` (oRPC, creates sandbox directly) and `POST /api/cli/sessions` (standalone route, uses gateway SDK with deferred sandbox). Both exist and serve slightly different flows. Impact: confusing code paths for the same conceptual operation. Expected fix: consolidate to one path.
- [ ] **`ApiClient` partially redundant** — `packages/cli/src/lib/api.ts` defines an HTTP client for web API routes, but `main.ts` uses `@proliferate/gateway-clients` instead. The `ApiClient` class is still importable but the main flow doesn't use it. Impact: dead code confusion. Expected fix: remove or clearly mark as alternative client.
- [ ] **Empty `CONFIG_SYNC_JOBS`** — The config sync jobs array in `packages/cli/src/lib/sync.ts:256-258` is declared but empty. No config files (git config, SSH config) are synced to the sandbox. Impact: users may need to manually configure tools in the sandbox. Expected fix: add common dotfiles as sync targets.
- [ ] **No token rotation** — API keys created via device flow have no expiration. The only refresh mechanism is a health check that triggers full re-auth on failure. Impact: long-lived credentials. Expected fix: add token rotation or expiry.
- [ ] **No multi-org support in CLI** — The device flow captures the user's active org at authorization time. Switching orgs requires `proliferate reset` and re-authenticating. Impact: multi-org users must reset state. Expected fix: org selection during auth or a dedicated command.
- [ ] **Duplicate OpenCode binary resolution** — Both `packages/cli/src/lib/opencode.ts` and `packages/cli/src/agents/opencode.ts` contain `getOpenCodeBinaryPath()` with identical logic. Impact: maintenance burden. Expected fix: consolidate into single module.


---
# FILE: docs/specs/feature-registry.md
---

# Feature Registry

> **Purpose:** Single source of truth for every product feature, its implementation status, and which spec owns it.
> **Status key:** `Implemented` | `Partial` | `Planned` | `Deprecated`
> **Updated:** 2026-02-19. Session UI overhaul + billing Phase 1.2 + Slack config UX + notification destinations + config selection strategy.
> **Evidence convention:** `Planned` entries may cite RFC/spec files until code exists; once implemented, update evidence to concrete code paths.

---

## 1. Agent Contract (`agent-contract.md`)

| Feature | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Setup system prompt | Implemented | `packages/shared/src/prompts.ts:getSetupSystemPrompt` | Configures agent for repo setup sessions |
| Coding system prompt | Implemented | `packages/shared/src/prompts.ts:getCodingSystemPrompt` | Configures agent for interactive coding |
| Automation system prompt | Implemented | `packages/shared/src/prompts.ts:getAutomationSystemPrompt` | Configures agent for automation runs |
| `verify` tool | Implemented | `packages/shared/src/opencode-tools/index.ts:VERIFY_TOOL` | Uploads screenshots/evidence to S3 |
| `save_snapshot` tool | Implemented | `packages/shared/src/opencode-tools/index.ts:SAVE_SNAPSHOT_TOOL` | Saves sandbox filesystem state |
| `save_service_commands` tool | Implemented | `packages/shared/src/opencode-tools/index.ts:SAVE_SERVICE_COMMANDS_TOOL` | Persists auto-start commands for future sessions |
| `save_env_files` tool | Implemented | `packages/shared/src/opencode-tools/index.ts:SAVE_ENV_FILES_TOOL` | Generates .env files from secrets |
| `automation.complete` tool | Implemented | `packages/shared/src/opencode-tools/index.ts:AUTOMATION_COMPLETE_TOOL` | Marks automation run outcome with artifacts |
| `request_env_variables` tool | Implemented | `packages/shared/src/opencode-tools/index.ts:REQUEST_ENV_VARIABLES_TOOL` | Requests secrets from user with suggestions |
| Tool capability injection | Implemented | `packages/shared/src/sandbox/config.ts` | Plugin injection into sandbox OpenCode config |

---

## 2. Sandbox Providers (`sandbox-providers.md`)

| Feature | Status | Evidence | Notes |
|---------|--------|----------|-------|
| `SandboxProvider` interface | Implemented | `packages/shared/src/sandbox-provider.ts` | Common contract for all providers |
| Modal provider | Implemented | `packages/shared/src/providers/modal-libmodal.ts` | Default provider. Uses libmodal SDK. |
| E2B provider | Implemented | `packages/shared/src/providers/e2b.ts` | Full interface. Docker support, pause, snapshots. |
| Modal image + deploy | Implemented | `packages/modal-sandbox/deploy.py` | Python. `modal deploy deploy.py` |
| Sandbox-MCP API server | Implemented | `packages/sandbox-mcp/src/api-server.ts` | HTTP API on port 4000 inside sandbox |
| Sandbox-MCP terminal WS | Implemented | `packages/sandbox-mcp/src/terminal.ts` | Terminal WebSocket inside sandbox |
| Sandbox-MCP service manager | Implemented | `packages/sandbox-mcp/src/service-manager.ts` | Start/stop/expose sandbox services |
| Sandbox-MCP auth | Implemented | `packages/sandbox-mcp/src/auth.ts` | Token-based sandbox auth |
| Sandbox-MCP CLI setup | Implemented | `packages/sandbox-mcp/src/proliferate-cli.ts` | Sets up `proliferate` CLI inside sandbox |
| Sandbox env var injection | Implemented | `packages/shared/src/sandbox/config.ts` | Env vars passed at sandbox boot |
| OpenCode plugin injection | Implemented | `packages/shared/src/sandbox/config.ts:PLUGIN_MJS` | SSE plugin template string |
| Snapshot version key | Implemented | `packages/shared/src/sandbox/version-key.ts` | Deterministic snapshot versioning |
| Snapshot resolution | Implemented | `packages/shared/src/snapshot-resolution.ts` | Resolves which snapshot layers to use |
| Git freshness / pull cadence | Implemented | `packages/shared/src/sandbox/git-freshness.ts` | Configurable pull on session resume |
| E2B git freshness parity | Implemented | `packages/shared/src/providers/e2b.ts` | Extended to E2B in PR #97 |

---

## 3. Sessions & Gateway (`sessions-gateway.md`)

| Feature | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Session CRUD (create/delete/rename) | Implemented | `apps/web/src/server/routers/sessions.ts` | oRPC routes |
| Session pause | Implemented | `apps/web/src/server/routers/sessions.ts:pause` | Pauses sandbox via provider |
| Session resume | Implemented | `apps/web/src/server/routers/sessions.ts:resume` | Resumes from snapshot |
| Session snapshot | Implemented | `apps/web/src/server/routers/sessions.ts:snapshot` | Saves current state |
| Gateway session creation | Implemented | `apps/gateway/src/lib/session-creator.ts` | HTTP route + provider orchestration |
| Gateway hub manager | Implemented | `apps/gateway/src/hub/hub-manager.ts` | Creates/retrieves session hubs |
| Session hub | Implemented | `apps/gateway/src/hub/session-hub.ts` | Per-session runtime management |
| Session runtime | Implemented | `apps/gateway/src/hub/session-runtime.ts` | Runtime state coordination |
| Event processor | Implemented | `apps/gateway/src/hub/event-processor.ts` | Processes sandbox SSE events |
| WebSocket streaming | Implemented | `apps/gateway/src/api/proliferate/ws/` | Bidirectional real-time |
| HTTP message route | Implemented | `apps/gateway/src/api/proliferate/http/sessions.ts` | `POST /:sessionId/message` |
| Session status route | Implemented | `apps/gateway/src/api/proliferate/http/sessions.ts` | `GET /:sessionId/status` |
| SSE bridge to OpenCode | Implemented | `apps/gateway/src/hub/sse-client.ts` | Connects gateway to sandbox OpenCode |
| Session migration controller | Implemented | `apps/gateway/src/hub/migration-controller.ts` | Auto-migration on sandbox expiry |
| Preview/sharing URLs | Implemented | `apps/web/src/app/preview/[id]/page.tsx` | Public preview via `previewTunnelUrl` |
| Port forwarding proxy | Implemented | `apps/gateway/src/api/proxy/opencode.ts` | Token-auth proxy to sandbox ports |
| Git operations | Implemented | `apps/gateway/src/hub/git-operations.ts` | Stateless git/gh via gateway |
| Session store | Implemented | `apps/gateway/src/lib/session-store.ts` | In-memory session state |
| Session connections (DB) | Implemented | `packages/db/src/schema/sessions.ts` | `session_connections` table |
| Session telemetry capture | Implemented | `apps/gateway/src/hub/session-telemetry.ts` | Passive metrics, PR URLs, latest task |
| Session telemetry DB flush | Implemented | `packages/services/src/sessions/db.ts:flushTelemetry` | SQL-level atomic increment |
| Session outcome derivation | Implemented | `apps/gateway/src/hub/capabilities/tools/automation-complete.ts` | Set at explicit terminal call sites |
| Async graceful shutdown (telemetry) | Implemented | `apps/gateway/src/index.ts`, `apps/gateway/src/hub/hub-manager.ts` | Bounded 5s flush on SIGTERM/SIGINT |
| Gateway auth middleware | Implemented | `apps/gateway/src/middleware/auth.ts` | Token verification |
| Gateway CORS | Implemented | `apps/gateway/src/middleware/cors.ts` | CORS policy |
| Gateway error handler | Implemented | `apps/gateway/src/middleware/error-handler.ts` | Centralized error handling |
| Gateway request logging | Implemented | `apps/gateway/src/` | pino-http via `@proliferate/logger` |
| Session telemetry in list rows | Implemented | `apps/web/src/components/sessions/session-card.tsx` | latestTask subtitle, outcome badge, PR indicator, compact metrics, dedicated configuration column |
| Session peek drawer (URL-routable) | Implemented | `apps/web/src/components/sessions/session-peek-drawer.tsx` | `?peek=sessionId` URL param on sessions page |
| Summary markdown sanitization | Implemented | `apps/web/src/components/ui/sanitized-markdown.tsx` | AST-based via rehype-sanitize |
| Session display helpers | Implemented | `apps/web/src/lib/session-display.ts` | formatActiveTime, formatCompactMetrics, getOutcomeDisplay, parsePrUrl |
| Inbox run triage telemetry | Implemented | `apps/web/src/components/inbox/inbox-item.tsx` | Summary, metrics, PR count on run triage cards |
| Shared run status display | Implemented | `apps/web/src/lib/run-status.ts` | Consolidated getRunStatusDisplay used by inbox, activity, my-work |
| Activity run titles | Implemented | `apps/web/src/app/(command-center)/dashboard/activity/page.tsx` | Shows session title or trigger name instead of generic label |
| My-work run enrichment | Implemented | `apps/web/src/app/(command-center)/dashboard/my-work/page.tsx` | Claimed runs show session title, consistent status display |

---

## 4. Automations & Runs (`automations-runs.md`)

| Feature | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Automation CRUD | Implemented | `apps/web/src/server/routers/automations.ts` | Create/update/delete/list |
| Automation triggers binding | Implemented | `apps/web/src/server/routers/automations.ts` | Add/remove triggers on automation |
| Automation connections | Implemented | `packages/db/src/schema/automations.ts` | `automation_connections` table |
| Run lifecycle (pending → enriching → executing → completed) | Implemented | `apps/worker/src/automation/index.ts` | Orchestrates pipeline |
| Run enrichment | Implemented | `apps/worker/src/automation/enrich.ts` | Extracts trigger context deterministically |
| Run execution | Implemented | `apps/worker/src/automation/index.ts` | Creates session for run |
| Run finalization | Implemented | `apps/worker/src/automation/finalizer.ts` | Post-execution cleanup |
| Run events log | Implemented | `packages/db/src/schema/automations.ts` | `automation_run_events` table |
| Outbox dispatch | Implemented | `apps/worker/src/automation/index.ts:dispatchOutbox` | Reliable event delivery |
| Outbox atomic claim | Implemented | `packages/services/src/outbox/service.ts` | Claim + stuck-row recovery |
| Side effects tracking | Implemented | `packages/db/src/schema/automations.ts` | `automation_side_effects` table |
| Artifact storage (S3) | Implemented | `apps/worker/src/automation/artifacts.ts` | Completion + enrichment artifacts |
| Target resolution | Implemented | `apps/worker/src/automation/resolve-target.ts` | Resolves which repo/configuration to use |
| Slack notifications | Implemented | `apps/worker/src/automation/notifications.ts` | Run status posted to Slack |
| Notification dispatch | Implemented | `apps/worker/src/automation/notifications.ts:dispatchRunNotification` | Delivery orchestration |
| Notification destination types | Implemented | `packages/db/src/schema/automations.ts:notificationDestinationType` | `slack_dm_user`, `slack_channel`, `none` |
| Slack DM notifications | Implemented | `apps/worker/src/automation/notifications.ts:postSlackDm` | DM to selected user via `conversations.open` |
| Session completion notifications | Implemented | `apps/worker/src/automation/notifications.ts:dispatchSessionNotification` | DM subscribers on session complete |
| Session notification subscriptions | Implemented | `packages/services/src/notifications/service.ts` | Upsert/delete/list subscriptions per session |
| Configuration selection strategy | Implemented | `apps/worker/src/automation/resolve-target.ts` | `fixed` (default) or `agent_decide` with allowlist + fallback |
| Slack async client | Implemented | `apps/worker/src/slack/client.ts` | Full bidirectional session via Slack |
| Slack inbound handlers | Implemented | `apps/worker/src/slack/handlers/` | Text, todo, verify, default-tool |
| Slack receiver worker | Implemented | `apps/worker/src/slack/` | BullMQ-based message processing |
| Run claiming / manual update | Implemented | `apps/web/src/server/routers/automations.ts` | Claim, unclaim, resolve runs via `assignRun`/`unassignRun`/`resolveRun` routes |
| Org pending runs query | Implemented | `packages/services/src/runs/db.ts:listOrgPendingRuns`, `apps/web/src/server/routers/automations.ts` | Failed/needs_human/timed_out runs for attention inbox |
| Schedules for automations | Implemented | `packages/db/src/schema/schedules.ts` | Cron schedules with timezone |

---

## 5. Triggers (`triggers.md`)

| Feature | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Trigger CRUD | Implemented | `apps/web/src/server/routers/triggers.ts` | Create/update/delete/list |
| Trigger events log | Implemented | `packages/db/src/schema/triggers.ts` | `trigger_events` + `trigger_event_actions` |
| Trigger service (dedicated app) | Implemented | `apps/trigger-service/src/` | Standalone Express service |
| Webhook ingestion (Nango) | Implemented | `apps/trigger-service/src/lib/webhook-dispatcher.ts` | `POST /webhooks/nango` |
| Webhook dispatch + matching | Implemented | `apps/trigger-service/src/lib/trigger-processor.ts` | Matches events to triggers |
| Polling scheduler | Implemented | `apps/trigger-service/src/polling/worker.ts` | Cursor-based stateful polling |
| Cron scheduling | Implemented | `apps/trigger-service/src/scheduled/worker.ts` | SCHEDULED worker creates runs from cron-only triggers |
| GitHub provider | Implemented | `packages/triggers/src/github.ts` | Webhook triggers |
| Linear provider | Implemented | `packages/triggers/src/linear.ts` | Webhook + polling |
| Sentry provider | Implemented | `packages/triggers/src/sentry.ts` | Webhook only — `poll()` explicitly throws |
| PostHog provider | Implemented | `packages/triggers/src/posthog.ts` | Webhook only, HMAC validation |
| Gmail provider | Partial | `packages/triggers/src/service/adapters/gmail.ts` | Full polling impl via Composio, but not in HTTP provider registry (`getProviderByType()` returns null) |
| Provider registry | Implemented | `packages/triggers/src/index.ts` | Maps provider types to implementations |
| PubSub session events | Implemented | `apps/worker/src/pubsub/` | Subscriber for session lifecycle events |

---

## 6. Actions (`actions.md`)

| Feature | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Action invocations | Implemented | `packages/services/src/actions/db.ts` | `action_invocations` table |
| Invocation lifecycle (pending → approved/denied → expired) | Implemented | `packages/services/src/actions/` | Full state machine |
| Risk classification (read/write/danger) | Implemented | `packages/services/src/actions/db.ts` | Three-level risk model |
| Action grants | Implemented | `packages/services/src/actions/grants.ts` | Scoped reusable permissions with call budgets |
| Grant CRUD + evaluation | Implemented | `packages/services/src/actions/grants.ts` | Create, list, evaluate, revoke |
| Gateway action routes | Implemented | `apps/gateway/src/api/proliferate/http/` | Invoke, approve, deny, list, grants |
| Provider guide/bootstrap | Implemented | `apps/gateway/src/api/proliferate/http/` | `GET /:sessionId/actions/guide/:integration` |
| Linear adapter | Implemented | `packages/services/src/actions/adapters/linear.ts` | Linear API operations |
| Sentry adapter | Implemented | `packages/services/src/actions/adapters/sentry.ts` | Sentry API operations |
| Slack adapter | Implemented | `packages/services/src/actions/adapters/slack.ts` | Slack `send_message` action via `chat.postMessage` |
| Invocation sweeper | Implemented | `apps/worker/src/sweepers/index.ts` | Expires stale invocations |
| Sandbox-MCP grants handler | Implemented | `packages/sandbox-mcp/src/actions-grants.ts` | Grant handling inside sandbox |
| Actions list (web) | Implemented | `apps/web/src/server/routers/actions.ts` | Org-level actions inbox (oRPC route) |
| Inline attention inbox tray | Implemented | `apps/web/src/components/coding-session/inbox-tray.tsx`, `apps/web/src/hooks/use-attention-inbox.ts` | Merges WS approvals, org-polled approvals, and pending runs into inline tray in thread |
| Connector-backed action sources (`remote_http` MCP via Actions) | Implemented | `packages/services/src/actions/connectors/`, `apps/gateway/src/api/proliferate/http/actions.ts` | Gateway-mediated remote MCP connectors through Actions pipeline (connector source: org-scoped `org_connectors` table) |
| MCP connector 404 session recovery (re-init + retry-once) | Implemented | `packages/services/src/actions/connectors/client.ts:callConnectorTool` | Stateless per call; SDK handles session ID internally; 404 triggers fresh re-init |

---

## 7. LLM Proxy (`llm-proxy.md`)

| Feature | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Virtual key generation | Implemented | `packages/shared/src/llm-proxy.ts` | Per-session/org temp keys via LiteLLM API |
| Key scoping (team/user) | Implemented | `packages/shared/src/llm-proxy.ts` | Team = org, user = session for cost isolation |
| Key duration config | Implemented | `packages/environment/src/schema.ts:LLM_PROXY_KEY_DURATION` | Configurable via env |
| Model routing | Implemented | External LiteLLM service | Not a local app — external dependency |
| Spend tracking (per-org) | Implemented | `packages/shared/src/llm-proxy.ts` | Via LiteLLM virtual key spend APIs |
| LLM spend cursors (DB) | Implemented | `packages/db/src/schema/billing.ts:llmSpendCursors` | Tracks spend sync state |

> **Note:** The LLM proxy is an external LiteLLM service, not a locally built app. This spec covers the integration contract (key generation, spend queries) and the conventions for how sessions use it.

---

## 8. CLI (`cli.md`)

| Feature | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Device auth flow | Implemented | `packages/cli/src/state/auth.ts` | OAuth device code flow, token saved to `~/.proliferate/token` |
| Local config management | Implemented | `packages/cli/src/state/config.ts` | Project-local `.proliferate/` config |
| File sync (local → sandbox) | Implemented | `packages/cli/src/lib/sync.ts` | Unidirectional rsync-based push |
| OpenCode launch | Implemented | `packages/cli/src/agents/opencode.ts` | Opens OpenCode UI |
| CLI API routes (auth) | Implemented | `apps/web/src/server/routers/cli.ts:cliAuthRouter` | Device code create/authorize/poll |
| CLI API routes (repos) | Implemented | `apps/web/src/server/routers/cli.ts:cliReposRouter` | Get/create repos from CLI |
| CLI API routes (sessions) | Implemented | `apps/web/src/server/routers/cli.ts:cliSessionsRouter` | Session creation for CLI |
| CLI API routes (SSH keys) | Implemented | `apps/web/src/server/routers/cli.ts:cliSshKeysRouter` | SSH key management |
| CLI API routes (GitHub) | Implemented | `apps/web/src/server/routers/cli.ts:cliGitHubRouter` | GitHub connection for CLI |
| CLI API routes (configurations) | Implemented | `apps/web/src/server/routers/cli.ts:cliConfigurationsRouter` | Configuration listing for CLI |
| GitHub repo selection | Implemented | `packages/db/src/schema/cli.ts:cliGithubSelections` | Selection history |
| SSH key storage | Implemented | `packages/db/src/schema/cli.ts:userSshKeys` | Per-user SSH keys |

---

## 9. Repos & Configurations (`repos-configurations.md`)

| Feature | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Repo CRUD | Implemented | `apps/web/src/server/routers/repos.ts` | List/get/create/delete |
| Repo search | Implemented | `apps/web/src/server/routers/repos.ts:search` | Search available repos |
| Repo connections | Implemented | `packages/db/src/schema/repos.ts:repoConnections` | Integration bindings |
| Configuration CRUD | Implemented | `apps/web/src/server/routers/configurations.ts` | List/create/update/delete |
| Configuration-repo associations | Implemented | `packages/db/src/schema/configurations.ts:configurationRepos` | Many-to-many |
| Effective service commands | Implemented | `apps/web/src/server/routers/configurations.ts:getEffectiveServiceCommands` | Resolved config |
| Base snapshot builds | Implemented | `apps/worker/src/base-snapshots/index.ts` | Worker queue, deduplication |
| Configuration snapshot builds | Implemented | `apps/worker/src/configuration-snapshots/index.ts` | Multi-repo, tightly coupled to configuration creation |
| Configuration resolver | Implemented | `apps/gateway/src/lib/configuration-resolver.ts` | Resolves config at session start |
| Service commands persistence | Implemented | `packages/db/src/schema/configurations.ts:serviceCommands` | JSONB on configurations |
| Env file persistence | Implemented | `packages/db/src/schema/configurations.ts:envFiles` | JSONB on configurations |
| Configuration connector configuration (deprecated) | Deprecated | `packages/db/src/schema/configurations.ts:connectors` | Legacy JSONB on configurations table; migrated to org-scoped `org_connectors` table via `0022_org_connectors.sql` |
| Org-scoped connector catalog | Implemented | `packages/db/src/schema/schema.ts:orgConnectors`, `packages/services/src/connectors/` | `org_connectors` table with full CRUD via Integrations routes |
| Org connector management UI | Implemented | `apps/web/src/app/settings/tools/page.tsx`, `apps/web/src/hooks/use-org-connectors.ts` | Settings → Tools page with presets, secret picker, validation |
| Org connector validation endpoint | Implemented | `apps/web/src/server/routers/integrations.ts:validateConnector` | `tools/list` preflight with diagnostics |
| Base snapshot status tracking | Implemented | `packages/db/src/schema/configurations.ts:sandboxBaseSnapshots` | Building/ready/failed |
| Configuration snapshot status tracking | Implemented | `packages/services/src/configurations/db.ts` | Building/default/ready/failed on configurations table |

---

## 10. Secrets & Environment (`secrets-environment.md`)

| Feature | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Secret CRUD | Implemented | `apps/web/src/server/routers/secrets.ts` | Create/delete/list |
| Secret check (exists?) | Implemented | `apps/web/src/server/routers/secrets.ts:check` | Check without revealing value |
| Secret bundles CRUD | Implemented | `apps/web/src/server/routers/secrets.ts` | List/create/update/delete bundles |
| Bundle metadata update | Implemented | `apps/web/src/server/routers/secrets.ts:updateBundleMeta` | Rename, change target path |
| Bulk import | Implemented | `apps/web/src/server/routers/secrets.ts:bulkImport` | `.env` paste flow |
| Secret encryption | Implemented | `packages/services/src/secrets/` | Encrypted at rest |
| Per-secret persistence toggle | Implemented | Recent PR `c4d0abb` | Toggle whether secret persists across sessions |
| Secret encryption (DB) | Implemented | `packages/services/src/secrets/service.ts` | AES-256 encrypted in PostgreSQL; S3 is NOT used for secrets (only verification uploads) |

---

## 11. Integrations (`integrations.md`)

| Feature | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Integration list/update | Implemented | `apps/web/src/server/routers/integrations.ts` | Generic integration routes |
| GitHub OAuth (GitHub App) | Implemented | `apps/web/src/server/routers/integrations.ts:githubStatus/githubSession` | Via Nango |
| Sentry OAuth | Implemented | `apps/web/src/server/routers/integrations.ts:sentryStatus/sentrySession` | Via Nango |
| Linear OAuth | Implemented | `apps/web/src/server/routers/integrations.ts:linearStatus/linearSession` | Via Nango |
| Slack OAuth | Implemented | `apps/web/src/app/api/integrations/slack/oauth/callback/route.ts` | Workspace install stored in `slack_installations` (not Nango-managed) |
| Slack installations | Implemented | `packages/db/src/schema/slack.ts:slackInstallations` | Workspace-level |
| Slack conversations cache | Implemented | `packages/db/src/schema/slack.ts:slackConversations` | Channel cache |
| Slack members API | Implemented | `apps/web/src/server/routers/integrations.ts:slackMembers` | Workspace member list for DM target picker |
| Slack channels API | Implemented | `apps/web/src/server/routers/integrations.ts:slackChannels` | Workspace channel list for notification config |
| Session notification subscriptions table | Implemented | `packages/db/src/schema/slack.ts:sessionNotificationSubscriptions` | Per-session DM notification opt-in |
| Nango callback handling | Implemented | `apps/web/src/server/routers/integrations.ts:callback` | OAuth callback |
| Integration disconnect | Implemented | `apps/web/src/server/routers/integrations.ts:disconnect` | Remove connection |
| Connection binding (repos) | Implemented | `packages/db/src/schema/repos.ts:repoConnections` | Repo-to-integration |
| Connection binding (automations) | Implemented | `packages/db/src/schema/automations.ts:automationConnections` | Automation-to-integration |
| Connection binding (sessions) | Implemented | `packages/db/src/schema/sessions.ts:sessionConnections` | Session-to-integration |
| Sentry metadata | Implemented | `apps/web/src/server/routers/integrations.ts:sentryMetadata` | Sentry project/org metadata |
| Linear metadata | Implemented | `apps/web/src/server/routers/integrations.ts:linearMetadata` | Linear team/project metadata |
| GitHub auth (gateway) | Implemented | `apps/gateway/src/lib/github-auth.ts` | Gateway-side GitHub token resolution |
| Org-scoped MCP connector catalog | Implemented | `packages/db/src/schema/schema.ts:orgConnectors`, `packages/services/src/connectors/` | Org-level connector CRUD with atomic secret provisioning |
| Org-scoped connector management UI | Implemented | `apps/web/src/app/settings/tools/page.tsx`, `apps/web/src/hooks/use-org-connectors.ts` | Settings → Tools page with preset quick-setup, advanced form, and connection validation |

---

## 12. Auth, Orgs & Onboarding (`auth-orgs.md`)

| Feature | Status | Evidence | Notes |
|---------|--------|----------|-------|
| User auth (better-auth) | Implemented | `packages/shared/src/auth.ts` | Email/password + OAuth |
| Email verification | Implemented | `packages/shared/src/verification.ts` | Verify email flow |
| Org CRUD | Implemented | `apps/web/src/server/routers/orgs.ts` | List/get orgs |
| Member management | Implemented | `apps/web/src/server/routers/orgs.ts:listMembers` | List org members |
| Invitations | Implemented | `apps/web/src/server/routers/orgs.ts:listInvitations` | Invite/accept flow |
| Domain suggestions | Implemented | `apps/web/src/server/routers/orgs.ts:getDomainSuggestions` | Email domain-based org suggestions |
| Onboarding flow | Implemented | `apps/web/src/server/routers/onboarding.ts` | Start trial, mark complete, finalize |
| Trial activation | Implemented | `apps/web/src/server/routers/onboarding.ts:startTrial` | Credit provisioning |
| API keys | Implemented | `packages/db/src/schema/auth.ts:apikey` | Programmatic access |
| Admin status check | Implemented | `apps/web/src/server/routers/admin.ts:getStatus` | Super-admin detection |
| Admin user listing | Implemented | `apps/web/src/server/routers/admin.ts:listUsers` | All users |
| Admin org listing | Implemented | `apps/web/src/server/routers/admin.ts:listOrganizations` | All orgs |
| Admin impersonation | Implemented | `apps/web/src/server/routers/admin.ts:impersonate` | Debug as another user |
| Org switching | Implemented | `apps/web/src/server/routers/admin.ts:switchOrg` | Switch active org context |
| Invitation acceptance page | Implemented | `apps/web/src/app/invite/[id]/page.tsx` | Accept org invite |

---

## 13. Billing & Metering (`billing-metering.md`)

| Feature | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Billing status | Implemented | `apps/web/src/server/routers/billing.ts:getStatus` | Current billing state |
| Current plan | Implemented | `apps/web/src/server/routers/billing.ts:getCurrentPlan` | Active plan info |
| Pricing plans | Implemented | `apps/web/src/server/routers/billing.ts:getPricingPlans` | Available plans |
| Billing settings update | Implemented | `apps/web/src/server/routers/billing.ts:updateBillingSettings` | Update billing prefs |
| Checkout flow | Implemented | `apps/web/src/server/routers/billing.ts:startCheckout` | Initiate payment |
| Credit usage | Implemented | `apps/web/src/server/routers/billing.ts:useCredits` | Deduct credits |
| Usage metering | Implemented | `packages/services/src/billing/metering.ts` | Real-time compute metering |
| Credit gating | Implemented | `packages/shared/src/billing/gating.ts`, `packages/services/src/billing/gate.ts`, `apps/gateway/src/api/proliferate/http/sessions.ts` | Enforced in oRPC session creation, gateway session creation, setup sessions, and runtime resume |
| Shadow balance | Implemented | `packages/services/src/billing/shadow-balance.ts` | Fast balance approximation |
| Org pause on zero balance | Implemented | `packages/services/src/billing/org-pause.ts` | Auto-pause all sessions |
| Trial credits | Implemented | `packages/services/src/billing/trial-activation.ts` | Auto-provision on signup |
| Billing reconciliation | Implemented | `packages/db/src/schema/billing.ts:billingReconciliations` | Manual adjustments with audit |
| Billing events | Implemented | `packages/db/src/schema/billing.ts:billingEvents` | Usage event log |
| LLM spend sync | Implemented | `packages/db/src/schema/billing.ts:llmSpendCursors` | Syncs spend from LiteLLM |
| Distributed locks (billing-cycle) | Deprecated | Removed — BullMQ concurrency 1 ensures single-execution | See billing-metering.md §6.11. Note: `org-pause.ts` still uses session migration locks (`runWithMigrationLock`) for per-session enforcement; those are session-layer infrastructure, not billing-cycle locks. |
| Billing worker | Implemented | `apps/worker/src/billing/worker.ts` | Interval-based reconciliation |
| Autumn integration | Implemented | `packages/shared/src/billing/` | External billing provider client |
| Overage policy (pause/allow) | Implemented | `packages/services/src/billing/org-pause.ts` | Configurable per-org |
| Overage auto-top-up | Implemented | `packages/services/src/billing/auto-topup.ts` | Auto-charge when balance negative + policy=allow. Circuit breaker, velocity limits, cap enforcement. |
| Fast reconciliation | Implemented | `apps/worker/src/jobs/billing/fast-reconcile.job.ts` | On-demand shadow balance sync with Autumn, triggered by payment events. |

---

## Cross-Cutting (not a spec — covered within relevant specs)

| Feature | Where documented | Evidence |
|---------|-----------------|----------|
| Intercom chat widget | `auth-orgs.md` (or omit — trivial) | `apps/web/src/server/routers/intercom.ts` |
| Sentry error tracking | Operational concern | `apps/web/sentry.*.config.ts` |
| BullMQ queue infrastructure | Each spec documents its own queues | `packages/queue/src/index.ts` |
| Drizzle ORM / migrations | Each spec documents its own tables | `packages/db/` |
| Logger infrastructure | `CLAUDE.md` covers conventions | `packages/logger/` |
| Environment schema | Referenced by specs as needed | `packages/environment/src/schema.ts` |
| Gateway client libraries | `sessions-gateway.md` | `packages/gateway-clients/` |


---
# FILE: docs/specs/idle-snapshotting.md
---

# Idle-Based Snapshotting

Snapshot sandboxes when idle instead of running them until expiry. Applies to all session types (web, automation, Slack).

## Problem

- Modal sandboxes have a configurable lifetime (`SANDBOX_TIMEOUT_SECONDS`, default 3600s / 60 min, max 24h)
- Currently we keep them alive the entire time and migrate at the 55-min mark (snapshot → new sandbox)
- Paying for idle compute after the agent finishes and the user disconnects
- Automation sessions burn ~50 min of idle compute after the agent completes
- Complex migration dance every 55 minutes

## Proposal

When no clients are connected and the agent is idle, snapshot the sandbox and terminate it. Resume on demand when a client reconnects or a new prompt arrives.

## Design Constraints

1. **Don't evict hub immediately on idle snapshot** — keep the hub through the snapshot/resume handoff window; evict later via a safe TTL policy.
   - Without this: `getOrCreate()` deduplicates by session ID via a pending-promise map. If we evict too early, a reconnecting client may create a new hub while the old hub still has in-flight work (e.g. a prompt blocked on the migration lock). Two hubs for the same session means split state and duplicate SSE connections.
   - v1 policy: no immediate eviction. Post-v1: allow delayed eviction for paused, untouched hubs (e.g. >2h) to bound memory growth.

2. **`shouldIdleSnapshot()` re-check includes grace period** — the full idle predicate (including grace period) is re-evaluated inside the migration lock, not just "are there still 0 clients."
   - Without this: an HTTP request arrives between the 30s interval check and the lock acquisition. `touchActivity()` updates `lastActivityAt`, but if the re-check inside the lock only verifies `clients.size === 0` and skips the grace period, it won't see that `lastActivityAt` was just refreshed. The snapshot proceeds despite active HTTP traffic.

3. **`touchActivity()` before `ensureRuntimeReady()` in lifecycle middleware** — the activity timestamp must be set before blocking on the migration lock.
   - Without this: `ensureRuntimeReady()` calls `waitForMigrationLockRelease()`, which blocks while `runIdleSnapshot()` holds the lock. If `touchActivity()` comes after, it runs only after the snapshot completes — too late to abort. Calling it before means the `shouldIdleSnapshot()` re-check inside the lock sees the fresh `lastActivityAt` and aborts the snapshot.

4. **Only `touchActivity()` mutates `lastActivityAt`** — no artificial `lastActivityAt = Date.now()` inside the idle check when the agent is busy.
   - Without this: if `checkIdleSnapshot()` sets `lastActivityAt = Date.now()` every time it sees the agent is working, it conflates "I polled and the agent was busy" with "a human or system actually interacted with this session." The grace period restarts every 30s poll, meaning a long-running agent task (e.g. 20-minute build) would never allow the grace period to elapse after the agent finishes — the artificial resets push it out indefinitely.

5. **Memory restore failure = restartable, not terminal** — on `mem:` restore failure, clear `snapshotId` in DB so the next reconnect creates a fresh sandbox. Surface the error to the user.
   - Without this: if a 7-day-old memory snapshot has expired and `restoreFromMemorySnapshot()` throws, the session is stuck in a loop — every reconnect attempt retries the same dead `mem:` snapshot ID and fails again. Clearing `snapshotId` breaks the loop. We don't silently fall back to a fresh sandbox because conversation history lives inside OpenCode in the sandbox — a fresh sandbox has empty history, and the user should know their conversation was lost.

6. **Lock TTL must cover worst-case snapshot time** — lock TTL is 300s (5 min); `sandboxSnapshotWait` timeout is 120s.
   - Without this: if the lock TTL is shorter than the snapshot operation (e.g. 60s lock for a 120s snapshot), a Redis blip could prevent Redlock auto-extension, causing the lock to expire mid-snapshot. Another operation (e.g. a resume from `ensureRuntimeReady()`) acquires the now-free lock and starts creating a new sandbox while the snapshot is still in progress on the old one. 300s provides generous headroom over the 120s snapshot + terminate + DB update.

7. **Stop idle interval after snapshot, restart on resume** — call `clearInterval` after successful snapshot; re-start from `startMigrationMonitor()` on resume.
   - Without this: the 30s `setInterval` keeps firing on a hub that has no sandbox. Over time, as sessions accumulate on a gateway instance, hundreds of idle hubs each run a timer that checks conditions, finds no sandbox, and returns — wasting CPU. Worse, if `lastKnownAgentIdleAt` is accidentally left set, the timer could attempt repeated snapshot calls on an already-paused hub.

8. **`removeProxy()` must be idempotent** — the cleanup closure uses a `removed` flag and `Set.delete()` to avoid drift in proxy presence tracking.
   - Without this: if terminal/VS Code WS cleanup fires twice (e.g. error then close), integer counters can drift positive/negative and become permanently wrong. A `Set<string>` by connection ID makes add/remove idempotent and keeps `proxyConnections.size` trustworthy.

9. **Agent-idle boundary via state transition** — detect `wasBusy → nowIdle` (check `getCurrentAssistantMessageId()` before and after `eventProcessor.process()`) rather than matching specific SSE event types like `session.idle`.
   - Without this: matching event types requires knowing every event that signals completion — `session.idle`, `session.status(idle)`, assistant message end, etc. If OpenCode adds a new completion event type or changes the event name, the idle detection breaks silently. The state-transition approach is robust: it works regardless of which event caused the transition, because it checks the result (is the agent idle now?) rather than the trigger.

10. **SSE-drop safety with `lastKnownAgentIdleAt`** — if the SSE connection drops after the agent was known-idle, allow snapshot instead of requiring `runtime.isReady()`.
    - Without this: if the user closes the tab, the agent finishes, and then the SSE connection drops (e.g. network timeout, Modal reclaim), `runtime.isReady()` returns false. The idle check requires SSE to be connected (`isReady()`), so it never fires. The sandbox burns compute for its entire lifetime (up to 24h) with no clients and no agent work — the exact waste this feature is meant to prevent. `lastKnownAgentIdleAt` records when we last saw the agent go idle, allowing the snapshot to proceed even after SSE drops. Cleared on: prompt (new work invalidates the idle state), resume (fresh sandbox, agent state unknown), and successful snapshot (no longer needed).

11. **Expiry idle path → "paused"** — change the existing `createNewSandbox: false` branch in expiry migration from `status: "stopped"` + `markSessionStopped()` to `status: "paused"` + `pauseReason: "inactivity"`.
    - Without this: the expiry idle path and the new idle snapshot path produce different states for the same semantic event (session went idle, sandbox torn down). Expiry would produce `stopped` + `endedAt` (non-resumable), while idle snapshot produces `paused` (resumable). This inconsistency means a session that happens to hit the 55-min expiry before idle snapshot fires gets permanently stopped, while one that idle-snapshots at 5 min is resumable. Since there are no existing consumers of the `createNewSandbox: false` path, unifying to "paused" is safe.

12. **Cancel pending reconnect before idle snapshot** — clear the pending `scheduleReconnect()` timer and guard resume side effects with lock-scoped state revalidation.
    - Without this: automation sessions have `shouldReconnectWithoutClients() === true`. When SSE drops, `handleSseDisconnect()` calls `scheduleReconnect()`, which sets a `setTimeout` to call `ensureRuntimeReady()`. If idle snapshot fires during that delay window, it snapshots and terminates the sandbox. But the pending timer callback can still fire, call `ensureRuntimeReady()`, and restore the sandbox with 0 clients — reintroducing idle burn.
    - Important nuance: a generation counter check at timeout entry is not sufficient by itself if the callback already entered `ensureRuntimeReady()` and is blocked on the migration lock. Keep revalidation after lock wait and before resume side effects.

13. **`shouldIdleSnapshot()` checks `sandbox_id`** — include `Boolean(runtime.getContext().session.sandbox_id)` in the idle predicate.
    - Without this: after a successful idle snapshot, `resetSandboxState()` clears `sandbox_id` in memory, but `lastKnownAgentIdleAt` might not be cleared yet (or could be set by a late SSE event). The idle check passes all other conditions (0 clients, agent idle, grace elapsed, `lastKnownAgentIdleAt` set) and calls `runIdleSnapshot()` again on a hub that's already paused. While the lock and re-read inside `runIdleSnapshot()` would catch this, the `sandbox_id` check prevents the unnecessary lock acquisition entirely.

14. **Re-read context after lock acquisition** — `runIdleSnapshot()` re-reads `sandbox_id` from `runtime.getContext()` after acquiring the migration lock, not just before.
    - Without this: `runIdleSnapshot()` reads `sandbox_id` before trying to acquire the lock. While waiting for the lock (another operation may hold it), the context can change — e.g. `ensureRuntimeReady()` creates a new sandbox and updates the context. If we act on the stale pre-lock `sandbox_id`, we might try to snapshot a sandbox that no longer exists or has already been replaced.

15. **`MigrationController.start()/stop()` just toggle a flag** — they don't create or destroy timers. The idle timer (`setInterval`) lives in `SessionHub`.
    - Without this: if `MigrationController.stop()` (called from `runIdleSnapshot()` step 8) also stopped the idle timer, and `MigrationController.start()` also started it, the lifecycle coupling gets confusing — `runIdleSnapshot()` would be stopping its own timer mid-execution via `stop()`. Keeping the idle timer in `SessionHub` and managing it via `startIdleMonitor()`/`stopIdleMonitor()` (called from `onIdleSnapshotComplete`) keeps the control flow clear: the hub owns the timer, the migration controller owns the snapshot logic.

## Trigger

The idle snapshot triggers when **all conditions** are true:

1. **No WS clients connected** — `clients.size === 0`
2. **No proxy connections** — `proxyConnections.size === 0` (terminal/VS Code WS proxies)
3. **Agent is idle** — `eventProcessor.getCurrentAssistantMessageId() === null`
4. **SSE is ready OR agent was known-idle** — `runtime.isReady() || lastKnownAgentIdleAt !== null`
5. **Sandbox exists** — `sandbox_id` is non-null (prevents repeated calls on already-paused hubs)
6. **Grace period elapsed** — time since `lastActivityAt` exceeds the per-session-type grace

### Control Plane Ownership Model

`SessionHub` is the real-time decider (best live signals), not the sole durable source of truth.

- **Hub (in-memory):** WS/proxy presence, agent state transitions, grace timing hints.
- **DB + provider state (durable):** session status/snapshot/sandbox identifiers and final lifecycle state.
- **Redis lock/lease (distributed safety):** prevents split-brain mutations and concurrent migration/resume races.

Design intent: loss of in-memory hints should degrade to temporary cost inefficiency (false negatives for idleness), not correctness failures.

### Activity detection

`getCurrentAssistantMessageId()` is robust for detecting agent work:

- Returns non-null for the entire duration of a message, including long-running tool calls (e.g. `sleep 120`)
- `hasRunningTools()` prevents premature completion — tool state stays `"running"` until OpenCode reports it done
- Only clears when `session.idle` or `session.status(idle)` fires from OpenCode
- Conservative on SSE disconnect — stale non-null state prevents snapshot, never causes a false idle

### Per session type

| Session type | WS clients when active | Grace period | Idle snapshot trigger |
|---|---|---|---|
| **Web** | > 0 | `IDLE_SNAPSHOT_DELAY_SECONDS` (default 300s / 5 min) | User closes tab → clients = 0 → agent finishes → grace period → snapshot |
| **Automation** | Always 0 (HTTP only) | 30s (hardcoded) | Agent finishes (calls `automation.complete`) → grace period → snapshot |
| **Slack** | Always 0 (async receiver) | 30s (hardcoded) | Agent finishes → grace period → snapshot |

## Snapshot mechanism

### Modal — memory snapshots (via gRPC)

Modal supports memory snapshots that preserve the **entire sandbox state**: filesystem + RAM + all running processes. The high-level JS SDK only exposes `snapshotFilesystem()`, but the gRPC methods are available via the public `client.cpClient`:

```ts
// Create sandbox with snapshotting enabled
// (need to pass enableSnapshot: true at the proto level in SandboxCreateParams)

// Snapshot (memory + filesystem + processes)
const { snapshotId } = await client.cpClient.sandboxSnapshot({ sandboxId });
await client.cpClient.sandboxSnapshotWait({ snapshotId, timeout: 120 });

// Restore (exact clone — processes still running)
const { sandboxId } = await client.cpClient.sandboxRestore({ snapshotId });
```

`mem:` prefix distinguishes memory snapshot IDs from legacy filesystem image IDs. Only the Modal provider interprets this prefix.

**Why memory snapshots over filesystem snapshots:**

| | Memory snapshot | Filesystem snapshot |
|---|---|---|
| What's preserved | Files + RAM + running processes | Files only |
| Resume latency | Near-instant (no boot sequence) | ~10-20s (must restart OpenCode, services, Caddy, sandbox-mcp) |
| Dev servers after resume | Still running | Must re-run service commands |
| Redis/Postgres data | Preserved (in-memory state intact) | Postgres survives (on disk), Redis data lost |
| Snapshot expiry | 7 days | Indefinite |
| Maturity | Pre-beta (`_experimental` in Python SDK) | Stable, GA |

The 7-day expiry aligns with `auto_delete_days` (default 7). The pre-beta limitations don't affect our use case:
- **Can't snapshot during `exec`** — we only snapshot when the agent is idle (no exec running)
- **TCP connections closed** — fine; we disconnect SSE before snapshot, and server processes (Postgres, Caddy) re-bind their ports on restore
- **No GPU support** — we don't use GPUs
- **Snapshotting terminates the sandbox** — we want to terminate it anyway

**Memory-only policy:** for Modal idle snapshotting, do not fall back to filesystem snapshots. If memory snapshotting fails at snapshot-time, abort idle snapshot and keep the session running; retry on the next idle check until circuit breaker thresholds are hit.

If memory snapshot restore fails (e.g. expired after 7 days), the error is surfaced to the user and `snapshotId` is cleared in DB. The next reconnect creates a fresh sandbox from configuration with empty history (restartable, not terminal).

### E2B — native pause

E2B already supports full-state pause/resume via `betaPause()` / `Sandbox.connect()`. The existing idle migration path in migration-controller.ts already uses this (`if (provider.supportsPause)`). No changes needed for E2B — idle snapshotting just triggers the existing pause path sooner.

## Snapshot flow (gateway-side)

```
runIdleSnapshot():
  0. Early exit if migrationState !== "normal" or sandbox_id is null
  1. Acquire migration lock (runWithMigrationLock, 300s TTL)
  2. Re-read sandbox_id from context (may have changed while waiting for lock)
  3. Re-check ALL idle conditions via shouldIdleSnapshot() (includes grace period)
  4. Cancel pending reconnect timer (prevents automation reconnect race)
  5. Disconnect SSE (runtime.disconnectSse())
     — MUST be before terminate to prevent reconnect cycle
     — sseClient.disconnect() aborts the AbortController
     — readLoop sees abort → silent return, no onDisconnect callback
  6. Snapshot:
     — E2B: provider.pause() (native)
     — Modal: cpClient.sandboxSnapshot() → mem: prefixed ID (memory-only; no filesystem fallback)
  7. Terminate (non-pause providers only): provider.terminate()
     — Before terminate, verify the lock is still valid / operation still owned
       (defensive against lock expiry during long snapshot operations)
     — If terminate fails, keep `sandboxId` in DB for sweeper retry
  8. Update DB (CAS/fencing):
     — snapshotId, status: "paused", pausedAt: now(), pauseReason: "inactivity"
     — sandboxId handling:
       - pause-capable providers: keep live sandboxId
       - non-pause providers: set sandboxId null only if terminate succeeded
       - if terminate failed, keep sandboxId for sweeper retry
     — NOT markSessionStopped() — session is alive, no endedAt
     — MUST include `WHERE sandbox_id = freshSandboxId`; if 0 rows updated, abort
  9. Cancel BullMQ expiry job (cancelSessionExpiry)
 10. Reset sandbox state (runtime.resetSandboxState())
 11. Signal hub: stop idle timer, clear lastKnownAgentIdleAt
 12. Release migration lock
```

**Key difference from current expiry idle migration:** status is `"paused"` (not `"stopped"`), no `endedAt`, SSE is disconnected before terminate, and reconnect timer is cancelled.

## Resume flow (existing, no changes needed)

Resume is triggered when a client connects or a prompt arrives via HTTP:

```
Web client opens session → addClient() → initializeClient()
  → ensureRuntimeReady()
    → waitForMigrationLockRelease() (instant — lock already released)
    → loadSessionContext() — sees status: "paused", snapshot_id, sandbox_id: null
    → provider.ensureSandbox({ snapshotId })
      → For memory snapshots (mem: prefix): cpClient.sandboxRestore({ snapshotId }) → new sandboxId
    → DB update: sandboxId, status: "running", pauseReason: null
    → scheduleSessionExpiry() (new expiry for new sandbox)
    → SSE connects
    → broadcastStatus("running")
  → lastKnownAgentIdleAt = null (agent state unknown on fresh sandbox)
  → startMigrationMonitor() (restarts idle timer)

Automation prompt via HTTP → handlePrompt()
  → ensureRuntimeReady() (same flow as above)
  → prompt sent to OpenCode
```

**Prompt during snapshot:** if a prompt arrives while the snapshot is in progress, `handlePrompt()` proceeds (migration state is `"normal"`), calls `ensureRuntimeReady()`, which blocks on `waitForMigrationLockRelease()`. Lock releases after snapshot completes. `ensureRuntimeReady()` then creates a new sandbox from the snapshot. No prompt is dropped, no queueing mechanism needed.

---

## Implementation

### 1. Modal Provider — Memory Snapshot + Restore

**File:** `packages/shared/src/providers/modal-libmodal.ts`

#### 1a. `enableSnapshot: true` at creation

In the `createSandbox()` method, add to the `client.sandboxes.create()` options:

```ts
enableSnapshot: true,
```

> Verify JS SDK passes this through. If not, drop to `cpClient.sandboxCreate()` — treat this as a likely integration bump.

#### 1b. `SandboxOperation` union

**File:** `packages/shared/src/sandbox/errors.ts`

Add `"memorySnapshot"` and `"restoreFromMemorySnapshot"` to the union.

#### 1c. `memorySnapshot()` method

```ts
async memorySnapshot(sessionId: string, sandboxId: string): Promise<SnapshotResult> {
  await this.ensureModalAuth("memorySnapshot");
  const { snapshotId } = await this.client.cpClient.sandboxSnapshot({ sandboxId });
  await this.client.cpClient.sandboxSnapshotWait({ snapshotId, timeout: 120 });
  return { snapshotId: `mem:${snapshotId}` };
}
```

#### 1d. `restoreFromMemorySnapshot()` method

```ts
private async restoreFromMemorySnapshot(
  sessionId: string,
  memorySnapshotId: string,
  log: Logger,
): Promise<CreateSandboxResult> {
  await this.ensureModalAuth("restoreFromMemorySnapshot");
  const { sandboxId: newSandboxId } = await this.client.cpClient.sandboxRestore({
    snapshotId: memorySnapshotId,
    sandboxNameOverride: sessionId, // keeps sandbox discoverable via fromName()
    sandboxNameOverrideType: 2, // STRING (Modal gRPC enum)
  });
  const sandbox = await this.client.sandboxes.fromId(newSandboxId);
  const tunnels = await sandbox.tunnels(30000);
  return {
    sandboxId: newSandboxId,
    tunnelUrl: tunnels[SANDBOX_PORTS.opencode]?.url || "",
    previewUrl: tunnels[SANDBOX_PORTS.preview]?.url || "",
    sshHost: tunnels[SANDBOX_PORTS.ssh]?.unencryptedHost,
    sshPort: tunnels[SANDBOX_PORTS.ssh]?.unencryptedPort,
    expiresAt: Date.now() + SANDBOX_TIMEOUT_MS,
  };
}
```

No `setupSandbox()`, `setupEssentialDependencies()`, or `waitForOpenCodeReady()` — processes are already running.

#### 1e. Modify `ensureSandbox()`

After `findSandbox()` returns null, before `createSandbox()`:

```ts
if (opts.snapshotId?.startsWith("mem:")) {
  const memId = opts.snapshotId.slice(4);
  log.info({ memorySnapshotId: memId }, "Restoring from memory snapshot");
  try {
    const result = await this.restoreFromMemorySnapshot(opts.sessionId, memId, log);
    return { ...result, recovered: false };
  } catch (err) {
    log.error({ err, memorySnapshotId: memId }, "Memory restore failed — session unrecoverable");
    throw new SandboxProviderError({
      provider: "modal",
      operation: "restoreFromMemorySnapshot",
      message: `Memory snapshot restore failed: ${err instanceof Error ? err.message : String(err)}`,
      cause: err instanceof Error ? err : undefined,
    });
  }
}
```

No silent fallback — conversation history lives in OpenCode inside the sandbox. A fresh sandbox would lose it. The caller (`doEnsureRuntimeReady`) catches this, clears `snapshotId` in DB, and re-throws so the user sees an error. A subsequent reconnect will create a fresh sandbox with empty history (restartable, not terminal — see section 5c).

#### 1f. Capability flag

```ts
readonly supportsMemorySnapshot = true;
```

### 2. SandboxProvider Interface

**File:** `packages/shared/src/sandbox-provider.ts`

```ts
readonly supportsMemorySnapshot?: boolean;
memorySnapshot?(sessionId: string, sandboxId: string): Promise<SnapshotResult>;
```

### 3. Idle Detection in SessionHub

**File:** `apps/gateway/src/hub/session-hub.ts`

#### 3a. New fields

```ts
private proxyConnections = new Set<string>();
private lastActivityAt: number = Date.now();
private lastKnownAgentIdleAt: number | null = null;
private idleCheckTimer: NodeJS.Timeout | null = null;
private idleSnapshotInFlight = false;
```

#### 3b. Public methods

```ts
addProxyConnection(): () => void {
  const connectionId = randomUUID();
  this.proxyConnections.add(connectionId);
  this.touchActivity();
  let removed = false;
  return () => {
    if (removed) return; // idempotent
    removed = true;
    this.proxyConnections.delete(connectionId);
    this.touchActivity();
  };
}

touchActivity(): void {
  this.lastActivityAt = Date.now();
}
```

`removeProxy()` uses a closure flag + `Set.delete()` idempotency to prevent drift from early error paths and duplicate close/error events.

#### 3c. Wire `touchActivity()` into existing event handlers

- `addClient()` — `touchActivity()`
- `removeClient()` — `touchActivity()`
- `handlePrompt()` — `touchActivity()` + `this.lastKnownAgentIdleAt = null` (new work starting, invalidates previous idle state)

#### 3d. Agent-idle detection via state transition

In the SSE event handler (where `handleOpenCodeEvent()` calls `eventProcessor.process()`), detect the transition rather than matching event types:

```ts
const wasBusy = this.eventProcessor.getCurrentAssistantMessageId() !== null;
this.eventProcessor.process(event);
const nowIdle = this.eventProcessor.getCurrentAssistantMessageId() === null;

if (wasBusy && nowIdle) {
  this.touchActivity(); // marks agent-done boundary, starts grace period
  this.lastKnownAgentIdleAt = Date.now();
}
```

This catches all completion paths consistently (e.g. `session.idle`, `session.status(idle)`, message end).

#### 3e. Idle check (30s interval)

```ts
private getIdleGraceMs(): number {
  // Automation/Slack: no human tab-refreshing, use short grace (30s)
  const sessionType = this.runtime.getContext().session.client_type;
  if (sessionType === "automation" || sessionType === "slack") {
    return 30_000;
  }
  // Web: protect against tab refresh / blips
  return this.env.idleSnapshotGraceSeconds * 1000;
}

private checkIdleSnapshot(): void {
  if (this.idleSnapshotInFlight) return;
  if (this.clients.size > 0 || this.proxyConnections.size > 0) return;
  if (this.eventProcessor.getCurrentAssistantMessageId() !== null) return;

  // Allow snapshot if either:
  // (a) SSE is connected and runtime is ready, OR
  // (b) SSE dropped but agent was known-idle before the drop
  const sseReady = this.runtime.isReady();
  if (!sseReady && this.lastKnownAgentIdleAt === null) return;

  const graceMs = this.getIdleGraceMs();
  if (Date.now() - this.lastActivityAt < graceMs) return;

  this.idleSnapshotInFlight = true;
  this.migrationController.runIdleSnapshot()
    .catch((err) => this.logError("Idle snapshot failed", err))
    .finally(() => { this.idleSnapshotInFlight = false; });
}
```

#### 3f. Start/stop idle monitor

```ts
private startIdleMonitor(): void {
  if (this.idleCheckTimer) return;
  this.idleCheckTimer = setInterval(() => this.checkIdleSnapshot(), 30_000);
}

private stopIdleMonitor(): void {
  if (this.idleCheckTimer) {
    clearInterval(this.idleCheckTimer);
    this.idleCheckTimer = null;
  }
}
```

- `startIdleMonitor()` called from `startMigrationMonitor()` (which is called from `ensureRuntimeReady()`)
- `stopIdleMonitor()` called from `stopMigrationMonitor()` and from `onIdleSnapshotComplete()`

`startMigrationMonitor()` becomes:
```ts
private startMigrationMonitor(): void {
  this.migrationController.start();
  this.startIdleMonitor();
}
```

`stopMigrationMonitor()` becomes:
```ts
stopMigrationMonitor(): void {
  this.migrationController.stop();
  this.stopIdleMonitor();
}
```

#### 3g. Pass `shouldIdleSnapshot` to MigrationController

```ts
shouldIdleSnapshot: () => {
  const graceMs = this.getIdleGraceMs();
  const sseReady = this.runtime.isReady();
  const hasSandbox = Boolean(this.runtime.getContext().session.sandbox_id);
  return hasSandbox
    && this.clients.size === 0
    && this.proxyConnections.size === 0
    && this.eventProcessor.getCurrentAssistantMessageId() === null
    && (sseReady || this.lastKnownAgentIdleAt !== null)
    && Date.now() - this.lastActivityAt >= graceMs;
},
```

`hasSandbox` prevents repeated calls on already-paused hubs. Grace-period check ensures HTTP requests arriving between interval and lock acquisition can abort via `touchActivity()`.

#### 3h. Reset `lastKnownAgentIdleAt` centrally on resume

In `ensureRuntimeReady()` (covers WS + HTTP + proxy callers):

```ts
async ensureRuntimeReady(): Promise<void> {
  this.lifecycleStartTime = Date.now();
  await this.runtime.ensureRuntimeReady();
  this.lastKnownAgentIdleAt = null; // fresh sandbox, agent state unknown
  this.startMigrationMonitor();
}
```

#### 3i. Store reconnect timer, cancellation guards, and reconnect intent

The existing `scheduleReconnect()` uses a bare `setTimeout`. Store the timer ID and an optional generation guard so idle snapshot can cancel pending callbacks. Keep lock-scoped state revalidation as the primary safety mechanism.

```ts
private reconnectTimerId: NodeJS.Timeout | null = null;
private reconnectGeneration = 0;

private scheduleReconnect(): void {
  // ... existing delay logic ...
  const generation = this.reconnectGeneration;
  this.reconnectTimerId = setTimeout(() => {
    this.reconnectTimerId = null;

    // Bail if cancelled after timer fired but before we start work
    if (generation !== this.reconnectGeneration) {
      this.log("Reconnect cancelled by idle snapshot (generation mismatch)");
      return;
    }

    // Check again - clients may have disconnected during delay
    if (this.clients.size === 0 && !this.shouldReconnectWithoutClients()) {
      this.log("No clients connected, aborting reconnection");
      this.reconnectAttempt = 0;
      return;
    }

    this.ensureRuntimeReady({ reason: "auto_reconnect" })
      .then(() => { this.reconnectAttempt = 0; })
      .catch((err) => {
        this.logError("Reconnection failed, retrying...", err);
        this.scheduleReconnect();
      });
  }, delay);
}

cancelReconnect(): void {
  this.reconnectGeneration++; // invalidates any in-flight callback
  if (this.reconnectTimerId) {
    clearTimeout(this.reconnectTimerId);
    this.reconnectTimerId = null;
  }
  this.reconnectAttempt = 0;
}
```

Important: generation checks at timeout entry are a best-effort optimization only. If a callback has already entered `ensureRuntimeReady()` and is blocked on migration lock, correctness must come from post-lock state revalidation before resume side effects.

In `SessionRuntime.doEnsureRuntimeReady()` after lock wait + context reload:

```ts
if (
  options?.reason === "auto_reconnect" &&
  this.context.session.status === "paused"
) {
  this.log("Auto-reconnect aborted: session already paused by idle snapshot");
  return;
}
```

### 4. Wire Proxy Routes to Activity Tracking

#### 4a. Lifecycle middleware — HTTP proxy activity

**File:** `apps/gateway/src/middleware/lifecycle.ts`

Call `touchActivity()` **before** `ensureRuntimeReady()`:

```ts
const hub = await hubManager.getOrCreate(proliferateSessionId);
hub.touchActivity(); // BEFORE ensureRuntimeReady — must not block on migration lock
await hub.ensureRuntimeReady();
```

If `touchActivity()` is after `ensureRuntimeReady()`, the HTTP request blocks on the migration lock and can't abort a pending snapshot. Calling it before means the `shouldIdleSnapshot()` re-check inside the lock sees the updated `lastActivityAt` and aborts.

#### 4b. Terminal WS proxy

**File:** `apps/gateway/src/api/proxy/terminal.ts`

```ts
const hub = await hubManager.getOrCreate(sessionId);
hub.touchActivity();
await hub.ensureRuntimeReady();
const removeProxy = hub.addProxyConnection();

ws.on("close", () => {
  removeProxy(); // idempotent, safe to call multiple times
  // ... existing close logic
});
```

#### 4c. VS Code WS proxy

**File:** `apps/gateway/src/api/proxy/vscode.ts`

Same pattern as terminal.

### 5. `runIdleSnapshot()` in MigrationController

**File:** `apps/gateway/src/hub/migration-controller.ts`

#### 5a. New options

```ts
export interface MigrationControllerOptions {
  // ... existing ...
  env: GatewayEnv;
  shouldIdleSnapshot: () => boolean;
  cancelReconnect: () => void;
  onIdleSnapshotComplete: () => void;
}
```

#### 5b. `runIdleSnapshot()` method

```ts
async runIdleSnapshot(): Promise<void> {
  if (this.migrationState !== "normal") return;

  // Read sandbox_id before lock — early exit if already paused
  const sandboxId = this.options.runtime.getContext().session.sandbox_id;
  if (!sandboxId) return;

  const ran = await runWithMigrationLock(this.options.sessionId, 300_000, async () => {
    // Re-read context after lock (may have changed while waiting)
    const freshSandboxId = this.options.runtime.getContext().session.sandbox_id;
    if (!freshSandboxId) {
      this.logger.info("Idle snapshot aborted: sandbox already gone");
      return;
    }

    // Re-check ALL conditions inside lock, including grace period + sandbox_id
    if (!this.options.shouldIdleSnapshot()) {
      this.logger.info("Idle snapshot aborted: conditions no longer met");
      return;
    }

    const providerType = this.options.runtime.getContext().session.sandbox_provider as SandboxProviderType;
    const provider = getSandboxProvider(providerType);

    // 1. Cancel any pending reconnect timer (prevents automation reconnect
    //    from restoring the sandbox after we snapshot it)
    this.options.cancelReconnect();

    // 2. Disconnect SSE BEFORE terminate (prevents reconnect cycle)
    this.options.runtime.disconnectSse();

    // 3. Snapshot
    let snapshotId: string;
    if (provider.supportsPause) {
      const result = await provider.pause(this.options.sessionId, freshSandboxId);
      snapshotId = result.snapshotId;
    } else if (provider.supportsMemorySnapshot && provider.memorySnapshot) {
      const result = await provider.memorySnapshot(this.options.sessionId, freshSandboxId);
      snapshotId = result.snapshotId; // has "mem:" prefix
    } else {
      const result = await provider.snapshot(this.options.sessionId, freshSandboxId);
      snapshotId = result.snapshotId;
    }

    // 4. Terminate (not needed for pause-capable providers)
    // If terminate fails, keep sandboxId in DB for sweeper retry.
    let terminated = provider.supportsPause;
    if (!provider.supportsPause) {
      try {
        await provider.terminate(this.options.sessionId, freshSandboxId);
        terminated = true;
      } catch (err) {
        this.logger.error({ err }, "Failed to terminate after idle snapshot");
        terminated = false;
      }
    }

    // 5. DB update (CAS/fencing): only update if sandbox_id still matches freshSandboxId.
    // If 0 rows are affected, another actor already advanced the session state.
    await sessions.updateWhereSandboxIdMatches(this.options.sessionId, freshSandboxId, {
      snapshotId,
      sandboxId: provider.supportsPause ? freshSandboxId : (terminated ? null : freshSandboxId),
      status: "paused",
      pausedAt: new Date().toISOString(),
      pauseReason: "inactivity",
    });

    // 6. Cancel BullMQ expiry job
    await cancelSessionExpiry(this.options.env, this.options.sessionId);

    // 7. Reset sandbox state (clears sandbox_id in memory)
    this.options.runtime.resetSandboxState();

    // 8. Signal hub to stop idle timer and clear state
    this.options.onIdleSnapshotComplete();

    this.logger.info({ sandboxId: freshSandboxId, snapshotId }, "Idle snapshot complete");
  });

  if (ran === null) {
    this.logger.info("Idle snapshot skipped: lock already held");
  }
}
```

In `session-hub.ts`, the `onIdleSnapshotComplete` callback:

```ts
// MigrationController options:
onIdleSnapshotComplete: () => {
  this.stopIdleMonitor();
  this.lastKnownAgentIdleAt = null;
},
cancelReconnect: () => this.cancelReconnect(),
```

**Lock TTL: 300s** (5 min). Generously covers worst case: `sandboxSnapshotWait` timeout (120s) + terminate + DB update + network delays.

**Memory snapshot failure at snapshot time**: abort idle snapshot and keep the session running. Do not fall back to filesystem snapshots in this design.

**Circuit breaker requirement:** track consecutive snapshot failures (`snapshotFailures`) per session. If 3 idle cycles fail in a row, stop retrying indefinitely and transition to a terminal safe state (`stopped` + alert) to avoid infinite idle-billing loops on unsnapshotable sandboxes.

#### 5c. Memory restore failure — DB cleanup (restartable)

**File:** `apps/gateway/src/hub/session-runtime.ts`

In `doEnsureRuntimeReady()`, wrap the `ensureSandbox()` call to catch `mem:` restore failures and clear `snapshotId` before re-throwing:

```ts
try {
  const result = await provider.ensureSandbox({ ... });
  // ... existing success path
} catch (err) {
  // If this was a memory snapshot restore failure, clear snapshotId
  // so the next reconnect creates a fresh sandbox (restartable, not terminal)
  if (
    err instanceof SandboxProviderError
    && err.operation === "restoreFromMemorySnapshot"
  ) {
    this.log("Memory snapshot expired or unrecoverable, clearing snapshotId for fresh restart");
    await sessions.update(this.sessionId, {
      snapshotId: null,
    });
  }
  throw err; // re-throw so existing error handling runs (onStatus("error"), etc.)
}
```

**Restartable, not terminal.** Clearing `snapshotId` ensures the next reconnect attempt creates a fresh sandbox from configuration instead of retrying the dead `mem:` ID. The user sees an error on the current attempt; reconnecting creates a fresh sandbox with empty OpenCode history.

**UX note:** The existing `onStatus("error", message)` path sends the error to the client. The client should display something like "Session expired — your previous conversation has been reset" rather than a generic error. This is a UI-only change in the web app's error handling for the `"error"` status — defer to post-v1 if needed, but at minimum the error message from the `SandboxProviderError` will be visible.

### 6. Unify Expiry Idle Path

**File:** `apps/gateway/src/hub/migration-controller.ts`

Since there are no existing users to preserve, change the existing `createNewSandbox: false` branch to produce "paused" state instead of "stopped":

```ts
await sessions.update(this.options.sessionId, {
  snapshotId,
  sandboxId: provider.supportsPause ? sandboxId : null,
  status: "paused",
  pausedAt: new Date().toISOString(),
  pauseReason: "inactivity",
});

// Remove the markSessionStopped() call
// Keep the terminate call for non-pause providers
```

Also move `disconnectSse()` BEFORE `terminate()` in the existing path (currently it's after):

```ts
// Current order (wrong for preventing reconnect):
this.options.runtime.resetSandboxState();
this.options.runtime.disconnectSse();

// Fixed order:
this.options.runtime.disconnectSse();  // BEFORE terminate
// ... terminate ...
this.options.runtime.resetSandboxState();
```

This makes idle shutdown behavior consistent everywhere: both idle snapshot and expiry produce resumable "paused" sessions.

### 7. Export `cancelSessionExpiry()`

**File:** `apps/gateway/src/expiry/expiry-queue.ts`

```ts
export async function cancelSessionExpiry(env: GatewayEnv, sessionId: string): Promise<void> {
  const q = getQueue(env);
  const jobId = `${JOB_PREFIX}${sessionId}`;
  const existing = await q.getJob(jobId);
  if (existing) {
    await existing.remove();
  }
}
```

### 8. Environment Config

#### 8a. Schema

**File:** `packages/environment/src/schema.ts`

```ts
IDLE_SNAPSHOT_DELAY_SECONDS: optionalSeconds(300), // 5 minutes default
```

#### 8b. Gateway env

**File:** `apps/gateway/src/lib/env.ts`

```ts
idleSnapshotGraceSeconds: number;
```

In `loadGatewayEnv()`:

```ts
idleSnapshotGraceSeconds: env.IDLE_SNAPSHOT_DELAY_SECONDS,
```

`IDLE_SNAPSHOT_DELAY_SECONDS` sets the **web session** grace period (default 300s / 5 min). Automation and Slack sessions use a hardcoded 30s grace — see `getIdleGraceMs()` in section 3e.

### 9. DB + Data Layer — Wire `pauseReason`

#### 9a. `UpdateSessionInput`

**File:** `packages/services/src/types/sessions.ts`

```ts
pauseReason?: string | null;
```

#### 9b. DB update functions

**File:** `packages/services/src/sessions/db.ts`

In `update()` and `updateWithOrgCheck()`:

```ts
if (input.pauseReason !== undefined) updates.pauseReason = input.pauseReason;
```

#### 9c. Frontend contract

**File:** `packages/shared/src/contracts/sessions.ts`

```ts
pauseReason: z.string().nullable(),
```

#### 9d. Session mapper

**File:** `packages/services/src/sessions/mapper.ts`

In `toSession()` and `toSessionPartial()`:

```ts
pauseReason: row.pauseReason ?? null,
```

#### 9e. Clear on resume

**File:** `apps/gateway/src/hub/session-runtime.ts`

In `doEnsureRuntimeReady()` DB update, add `pauseReason: null`.

### 10. UI — Paused Session Indicators

#### 10a. `SessionItem` (sidebar)

**File:** `apps/web/src/components/dashboard/session-item.tsx`

Add `StatusDot` for paused/running sessions alongside the title.

#### 10b. `SessionRow` (command search)

**File:** `apps/web/src/components/dashboard/session-row.tsx`

Extend to show paused status dot.

#### 10c. `SessionCard` — no changes needed

Already renders yellow "Paused" badge.

### 11. Orphan Sweeper Backstop (Required)

Idle snapshoting is hub-driven and in-memory. If a gateway process dies, its timers die too. A backstop sweeper is required to prevent orphaned running sandboxes from burning compute until provider hard timeout.

Mandatory v1 behavior:

- Run every 10-15 minutes.
- Query DB for sessions still marked `running`.
- Check active gateway lease/heartbeat ownership.
- For sessions without active ownership and past idle threshold, force idle pause/terminate flow.
- Reuse the same lock path (`runWithMigrationLock`) to avoid conflicting with live gateways.

This sweeper is a safety net, not the primary idle controller.

### 11b. UI Heartbeat Requirement (Mandatory)

Preview and SSH traffic can bypass gateway connection counters. To avoid false-idle snapshots while users are active outside the main WS channel:

- Web app emits `POST /api/sessions/:id/heartbeat` every ~60s while session UI or preview is visible.
- Heartbeat handler calls `hub.touchActivity()`.
- Heartbeat refreshes idle grace only; it does not force runtime resume.

### 12. Snapshot Mode Decision (Locked)

v1 is locked to **memory-only** snapshots for Modal idle snapshotting.

- No filesystem fallback in the idle snapshot path.
- On memory snapshot failure at snapshot-time, abort idle snapshot and keep the session running.
- On memory restore failure, clear `snapshotId`, surface a user-visible reset error, and allow next reconnect to create a fresh sandbox.

---

## What's New vs. What Exists

| Component | Status |
|---|---|
| Memory snapshot + restore from snapshot | **New** (gRPC calls to Modal, new provider method) |
| `enableSnapshot: true` at sandbox creation | **New** (wire into create params) |
| `mem:` prefix for memory snapshot IDs | **New** (Modal provider only) |
| `ensureRuntimeReady()` from paused state | **Exists** |
| Idle detection timer + grace period | **New** (30s interval in SessionHub) |
| Activity tracking (`lastActivityAt`, `lastKnownAgentIdleAt`) | **New** (in-memory, reset on prompt/client/proxy events) |
| Proxy connection tracking | **New** (terminal/VS Code WS proxies) |
| Reconnect cancellation + reconnect intent guard | **New** (prevents automation reconnect race) |
| Cancel expiry job on idle snapshot | **New** (export `cancelSessionExpiry()`) |
| Expiry idle path → "paused" | **Changed** (was "stopped" + `markSessionStopped()`) |
| E2B pause on idle | **Exists** (idle migration path already uses `provider.pause()`) |

## Files Modified (Summary)

| File | Change |
|---|---|
| `packages/shared/src/sandbox/errors.ts` | Add `"memorySnapshot"`, `"restoreFromMemorySnapshot"` to `SandboxOperation` |
| `packages/shared/src/providers/modal-libmodal.ts` | `enableSnapshot`, `memorySnapshot()`, `restoreFromMemorySnapshot()`, `ensureSandbox()` mem: path |
| `packages/shared/src/sandbox-provider.ts` | `supportsMemorySnapshot`, `memorySnapshot()` |
| `apps/gateway/src/hub/session-hub.ts` | `proxyConnections`, `lastActivityAt`, `lastKnownAgentIdleAt`, `touchActivity()`, `addProxyConnection()`, idle timer, `shouldIdleSnapshot` (with grace + sandbox_id + SSE-drop check), agent-idle transition detection, `cancelReconnect()`, `reconnectTimerId` |
| `apps/gateway/src/hub/migration-controller.ts` | `runIdleSnapshot()` (300s lock TTL, re-reads context after lock, cancels reconnect), unify expiry idle path to "paused", fix `disconnectSse()` ordering |
| `apps/gateway/src/hub/session-runtime.ts` | Clear `pauseReason` on resume; catch `mem:` restore failure → clear snapshotId (restartable) |
| `apps/gateway/src/expiry/expiry-queue.ts` | Export `cancelSessionExpiry()` |
| `apps/gateway/src/middleware/lifecycle.ts` | `hub.touchActivity()` **before** `ensureRuntimeReady()` |
| `apps/gateway/src/api/proxy/terminal.ts` | `hub.addProxyConnection()` + idempotent cleanup |
| `apps/gateway/src/api/proxy/vscode.ts` | `hub.addProxyConnection()` + idempotent cleanup |
| `packages/environment/src/schema.ts` | `IDLE_SNAPSHOT_DELAY_SECONDS` |
| `apps/gateway/src/lib/env.ts` | `idleSnapshotGraceSeconds` |
| `packages/services/src/types/sessions.ts` | `pauseReason` in `UpdateSessionInput` |
| `packages/services/src/sessions/db.ts` | Wire `pauseReason` in update functions |
| `packages/shared/src/contracts/sessions.ts` | `pauseReason` in `SessionSchema` |
| `packages/services/src/sessions/mapper.ts` | Map `pauseReason` |
| `apps/web/src/components/dashboard/session-item.tsx` | StatusDot for paused/running |
| `apps/web/src/components/dashboard/session-row.tsx` | StatusDot for paused |

**No changes needed:** `sse-client.ts`, `event-processor.ts`, `hub/types.ts`.

## Edge Cases

- **Agent mid-message when last client disconnects** — idle timer checks `getCurrentAssistantMessageId()`. If non-null, timer reschedules. Only snapshots once agent is fully idle.
- **Prompt arrives during snapshot** — blocks on migration lock, then restores from the snapshot just taken. No data loss.
- **Tab refresh / network blip** — grace period (5 min for web) prevents snapshotting. Client reconnects, `ensureRuntimeReady()` finds sandbox still alive.
- **Rapid idle→resume cycles** — `touchActivity()` on resume gives the full grace period before next idle snapshot.
- **Preview URLs** — dead while sandbox is down. Resume restores them.
- **Automation finalizer compatibility** — if the agent called `automation.complete`, the run is already in a terminal state before idle snapshot. Finalizer ignores it. If the agent didn't complete, finalizer eventually fails the run after 30 min — same existing behavior.
- **Memory snapshot failure at snapshot time** — idle snapshot aborts; session remains running and is retried on next idle check.
- **Memory restore failure** — error surfaced to user, `snapshotId` cleared in DB. Next reconnect creates fresh sandbox from configuration (empty history).
- **SSE reconnect for automation sessions** — `shouldReconnectWithoutClients()` returns true for automations, but reconnect timer is cancelled before snapshot. If a callback already entered `ensureRuntimeReady()`, post-lock `auto_reconnect` intent checks must abort resume when session is now paused.
- **SSE drop + known idle** — if agent finishes → SSE drops (network) → user doesn't reconnect, snapshot still fires because `lastKnownAgentIdleAt` is set. Prevents burning compute for hours/24h.

## Verification

1. **TypeScript**: `pnpm typecheck`
2. **Lint**: `pnpm lint`
3. **Idle trigger**: Create session → close tab → wait grace period → check DB: `status = "paused"`, `pause_reason = "inactivity"`, `snapshot_id` starts with `mem:`, `sandbox_id = null`, no `ended_at`
4. **Resume**: Reopen paused session → sandbox restores from memory snapshot, processes running, conversation preserved. DB: `status = "running"`, `pause_reason = null`
5. **Hub reuse + delayed eviction safety**: After idle snapshot, hub remains available for resume handoff. If delayed eviction TTL is enabled, reconnect after eviction recreates a new hub cleanly from DB state.
6. **Proxy keepalive**: Open terminal while idle timer is ticking → verify snapshot does NOT fire
7. **HTTP activity aborts snapshot**: VS Code HTTP request arrives during lock acquisition wait → `touchActivity()` fires before `ensureRuntimeReady()` → re-check inside lock returns false → snapshot aborts
8. **removeProxy idempotent**: Call cleanup function twice → `proxyConnections.size` stays consistent and returns to baseline
9. **Memory snapshot failure (in runIdleSnapshot)**: Force memory snapshot failure → idle snapshot aborts, session remains running, no filesystem fallback path is taken
10. **Memory restore failure (in ensureSandbox)**: Use expired `mem:` ID → throws → DB `snapshotId` cleared → user sees error → subsequent reconnect creates fresh sandbox from configuration (empty history)
11. **SSE drop + known idle**: Agent finishes → SSE drops (network) → user doesn't reconnect → after grace period, snapshot still fires (because `lastKnownAgentIdleAt` is set)
12. **Expiry idle path**: Close tab → session has no clients → expiry fires at 55 min (if idle snapshot hasn't already fired) → DB shows `paused` (not `stopped`), no `endedAt`. Note: with clients connected, expiry takes `createNewSandbox: true` path (keeps running)
13. **Prompt during snapshot**: Send prompt while idle snapshot in progress → blocks on migration lock, restores from snapshot
14. **UI**: Paused sessions show status dot in sidebar and command search
15. **Gateway crash recovery**: Kill gateway mid-snapshot and verify lock expiry + orphan sweeper eventually converges to a correct paused/stopped state without split-brain side effects.
16. **Reconnect race**: Simulate SSE drop + scheduled reconnect + concurrent idle snapshot. Verify reconnect does not immediately undo a completed idle snapshot.
17. **Lock-expiry guard**: Simulate snapshot operations near lock TTL and verify destructive operations are skipped/aborted when lock ownership is uncertain.
18. **CAS/fencing race**: Expire lock mid-snapshot, let another actor resume with a new sandbox ID, then ensure stale idle-path DB update affects 0 rows and does not overwrite running state.
19. **Snapshot circuit breaker**: Force deterministic memory snapshot failures and verify max 3 retries before terminal safe-state transition + alert.
20. **Heartbeat blind-spot mitigation**: Keep preview active with no WS clients; periodic heartbeat prevents idle snapshot while active.

## Known Limitations

1. **Preview/SSH visibility depends on heartbeat reliability.** Modal `previewUrl` and SSH tunnels are direct-to-Modal URLs, not routed through Gateway. Heartbeat mitigates this blind spot, but false-idle snapshots remain possible if heartbeat delivery fails or tab-visibility heuristics are wrong.

2. **`touchActivity()` in lifecycle middleware applies broadly.** `createEnsureSessionReady()` is mounted for index.ts routes (info/message/cancel), devtools proxy, and VS Code proxy — not just "proxy routes." Any authenticated HTTP call to these endpoints resets the idle timer. This is intentional: any HTTP activity to the session indicates someone cares about it.

3. **Hub accumulation.** Not evicting immediately avoids races, but hub objects can accumulate in `hub-manager.ts`. Stopping `setInterval` after snapshot prevents CPU leaks, but memory growth can still become material on long-lived gateway instances.
   - Required mitigation: delayed eviction policy for paused, untouched hubs plus process-level memory monitoring.

4. **Expiry-path "paused" semantics.** Changing the `createNewSandbox: false` branch from `status: "stopped"` + `markSessionStopped()` to `status: "paused"` makes these sessions resumable. Any consumers interpreting `endedAt` / `status === "stopped"` as "session is over forever" should be checked — but since there are no existing users, this is a greenfield decision.
   - Cross-spec dependency: billing/metering must treat `status: "paused"` + `pauseReason: "inactivity"` as meter-stopping equivalent to legacy `stopped`.

5. **Mem-restore failure invariant.** After `restoreFromMemorySnapshot` failure, `session-runtime.ts` clears `snapshot_id` but keeps `status: "paused"`. This creates a transient state ("paused session with no snapshot") until the next reconnect creates a fresh sandbox and sets `status: "running"`. The web client should display "Session reset — previous conversation has been cleared" rather than a generic error.

## Open Questions

1. **`enableSnapshot` JS SDK support**: Verify `sandboxes.create()` accepts this. If not, drop to `cpClient.sandboxCreate()`.
2. **`SandboxRestoreRequest_SandboxNameOverrideType` enum**: Verify which value sets sandbox name to `sandboxNameOverride`. Critical for `findSandbox()` discoverability.

## Trade-offs

**Pros:**
- Sessions survive idle periods without paying for compute
- Automation sessions stop burning ~50 min of idle compute per run
- Near-instant resume with memory snapshots (processes preserved)
- Simpler than the 55-min migration dance for idle sessions
- Works across all session types

**Cons:**
- Memory snapshots are pre-beta — stability risk
- 7-day snapshot expiry — sessions can't resume after 7 days of inactivity (acceptable, matches `auto_delete_days`)
- Using low-level gRPC API — could break on Modal SDK updates (typed proto definitions provide some stability)
- Grace period tuning — too short = unnecessary snapshot/restore cycles on brief disconnects; too long = paying for idle compute
- Restore failure on expired memory snapshots can reset conversation state (must be explicit in UX)


---
# FILE: docs/specs/inbox-workspace.md
---

# Inbox & Workspace — System Spec

## 1. Scope & Purpose

### In Scope
- Session list enhancements: origin badges, urgency indicators, origin filtering
- `automationId` and `automation` name surfaced on session API responses
- Investigation panel: context-aware right panel in workspace for run triage
- `getRun`, `listRunEvents`, `listOrgRuns` endpoints and corresponding hooks
- My Work page: personal dashboard of claimed runs, active sessions, pending approvals
- Activity page: org-wide paginated run history with status filtering
- Inbox modifications: unassigned-item filtering (runs where `assigned_to` is null)
- Sidebar navigation restructure: Home, Work section (My Work, Inbox, Activity), Configure section
- Command search additions: My Work and Activity quick navigation items
- `PreviewMode` union extension: `"investigation"` mode in Zustand preview panel store
- Shared utilities: `getRunStatusDisplay()`, `filterUnassignedItems()`, `countUnassignedItems()`

### Out of Scope
- Run lifecycle state machine, enrichment, execution, finalization — see `automations-runs.md`
- Run claiming and assignment DB operations (`assignRunToUser`, `unassignRun`) — see `automations-runs.md` section 6.11
- Run resolution (`resolveRun`) — see `automations-runs.md` section 6.11
- Session lifecycle (create/pause/resume/delete) — see `sessions-gateway.md`
- Trigger event ingestion and matching — see `triggers.md`
- Attention inbox core merge logic (`useAttentionInbox`) — see `automations-runs.md` section 6.10

### Mental Model

This spec covers the **triage and visibility layer** that sits on top of the run and session systems. When an automation run fails or needs human attention, users need to find it, understand what happened, and resolve it. This spec owns the navigation surfaces (sidebar, My Work, Activity, Inbox), the session list enrichments (origin badges, urgency indicators), and the investigation panel that provides run context directly within the workspace.

The flow is: a run reaches a terminal state -> it appears in the Inbox (if unassigned) or My Work (if claimed) -> the user clicks "View Session" which navigates to `/workspace/{sessionId}?runId={runId}` -> the investigation panel auto-opens in the right panel showing run status, error details, trigger context, timeline, and resolution controls.

**Core concepts:**
- **Origin badge** — visual indicator on session cards showing how the session was created (Automation, Slack, CLI, or none for manual/web).
- **Urgency indicator** — a destructive AlertTriangle icon shown on session cards when the session has a pending run in an attention-requiring status.
- **Investigation panel** — a right-panel tab in the workspace that displays run details, error context, timeline events, and a resolution form.
- **My Work** — a personal dashboard aggregating claimed runs, active manual sessions, and pending approvals for the current user.
- **Activity** — an org-wide feed of all automation runs across all automations, paginated with status filtering.

**Key invariants:**
- The inbox shows only unassigned items (runs where `assigned_to` is null, plus all pending approvals).
- The investigation panel auto-opens exactly once per workspace page load when `runId` is present in URL search params.
- The Activity page time-bounds queries to 90 days for performance.
- Session list origin filtering is client-side; the `excludeAutomation` filter is server-side.

---

## 2. Core Concepts

### Origin Classification
Sessions are classified by origin using a priority chain: if `automationId` is set, the origin is "automation"; else if `origin` or `clientType` is "slack", it is "slack"; else if "cli", it is "cli"; otherwise "manual". This classification drives both the `OriginBadge` component on session cards and the client-side origin filter dropdown on the sessions page.
- Key detail agents get wrong: origin classification is computed client-side from multiple fields (`automationId`, `origin`, `clientType`), not stored as a single derived field.
- Reference: `apps/web/src/app/(command-center)/dashboard/sessions/page.tsx:getSessionOrigin`

### Investigation Panel Lifecycle
The investigation panel is a `PreviewMode` variant (`{ type: "investigation" }`) in the Zustand preview panel store. When the workspace page receives a `runId` search param, it passes it as a prop to `CodingSession`, which auto-opens the investigation panel via a one-time `useEffect` guarded by a ref (`investigationOpened`). The panel fetches run data and events via `useRun(runId)` and `useRunEvents(runId)`.
- Key detail agents get wrong: the investigation panel does not create its own route or modal — it reuses the existing right-panel system. The `runId` flows as a prop, not through the store.
- Reference: `apps/web/src/components/coding-session/coding-session.tsx`, `apps/web/src/stores/preview-panel.ts`

### Unassigned Item Filtering
The inbox filters attention items to show only those without an owner. For runs, this means `assigned_to` is null. Approvals are always shown (they do not have a per-user assignment yet). The sidebar badge count is the length of the filtered items.
- Key detail agents get wrong: the filtering is **server-side** via the `unassignedOnly` parameter on `listOrgPendingRuns`, not client-side. The `useAttentionInbox` hook passes `unassignedOnly: true` to the DB query, which adds `WHERE assigned_to IS NULL`. Legacy helpers `filterUnassignedItems()` and `countUnassignedItems()` still exist but are no longer the primary filter path.
- Reference: `packages/services/src/runs/db.ts:listOrgPendingRuns`, `apps/web/src/hooks/use-attention-inbox.ts`

---

## 3. File Tree

```
packages/services/src/
├── runs/
│   ├── db.ts                                # findRunForDisplay(), listRunEvents(), listOrgRuns()
│   └── service.ts                           # Service wrappers for new DB functions
├── sessions/
│   ├── db.ts                                # excludeAutomation filter, automation relation join
│   ├── mapper.ts                            # automationId + automation name mapping
│   └── service.ts                           # excludeAutomation passthrough
└── types/
    └── sessions.ts                          # excludeAutomation field on ListSessionsFilters

packages/shared/src/contracts/
├── sessions.ts                              # automationId, automation object on SessionSchema
└── automations.ts                           # AutomationRunEventSchema, assigned_to on PendingRunSummarySchema

apps/web/src/server/routers/
├── automations.ts                           # getRun, listRunEvents, listOrgRuns endpoints
└── sessions.ts                              # excludeAutomation filter passthrough

apps/web/src/hooks/
├── use-automations.ts                       # useRun(), useRunEvents(), useResolveRun(), useOrgRuns()
├── use-my-work.ts                           # useMyWork() composite hook
├── use-org-activity.ts                      # useOrgActivity() wrapper
├── use-attention-inbox.ts                   # filterUnassignedItems(), countUnassignedItems()
└── use-sessions.ts                          # excludeAutomation param

apps/web/src/lib/
└── run-status.ts                            # getRunStatusDisplay() shared utility

apps/web/src/stores/
└── preview-panel.ts                         # "investigation" in PreviewMode union

apps/web/src/app/(command-center)/dashboard/
├── my-work/page.tsx                         # My Work page
├── activity/page.tsx                        # Activity page
├── inbox/page.tsx                           # Inbox with unassigned filtering
└── sessions/page.tsx                        # Origin badges, urgency indicators, origin filter

apps/web/src/app/(workspace)/workspace/
└── [id]/page.tsx                            # runId search param -> CodingSession prop

apps/web/src/components/
├── coding-session/
│   ├── investigation-panel.tsx              # Investigation panel component
│   ├── right-panel.tsx                      # investigation mode case
│   └── coding-session.tsx                   # runId prop, auto-open logic
├── dashboard/
│   ├── sidebar.tsx                          # New nav structure (Home, Work, Configure)
│   ├── command-search.tsx                   # My Work + Activity quick nav
│   └── page-empty-state.tsx                 # ActivityIllustration, MyWorkIllustration
├── sessions/
│   └── session-card.tsx                     # OriginBadge, urgency AlertTriangle, pendingRun prop
└── inbox/
    └── inbox-item.tsx                       # runId in "View Session" link
```

---

## 4. Data Flow

### Session List with Origin and Urgency

```
sessions.listByOrganization(orgId, { excludeAutomation? })
    │  joins: sessions → automation (columns: id, name)
    ▼
mapper.toSession(row)
    │  maps: row.automationId, row.automation → API response
    ▼
SessionSchema (contract)
    │  fields: automationId, automation: { id, name }
    ▼
useSessions() → session cards
    │
    ├── OriginBadge(session): automationId? → Automation / slack? → Slack / cli? → CLI
    │
    └── useOrgPendingRuns() → pendingRunsBySession map
        │  Map<sessionId, PendingRunSummary>
        ▼
        SessionListRow({ session, pendingRun }): AlertTriangle if pendingRun exists
```

### Investigation Panel Flow

```
Inbox "View Session" link or session card click
    │  href: /workspace/{sessionId}?runId={runId}
    ▼
workspace/[id]/page.tsx
    │  extracts: runId = searchParams.get("runId")
    ▼
CodingSession({ sessionId, runId })
    │  useEffect: auto-open investigation panel (once via ref guard + mode check)
    │  prepends "Investigate" tab to panel tabs when runId is present
    ▼
RightPanel({ runId }) → mode.type === "investigation"
    ▼
InvestigationPanel({ runId })
    ├── useRun(runId)         → run status, error, assignee, trigger context
    ├── useRunEvents(runId)   → timeline of status transitions (30s poll)
    ├── useAssignRun()        → "Claim" button (shown when unassigned + attention status)
    └── useResolveRun()       → mutation to mark run as succeeded/failed
```

### My Work Aggregation

```
useMyWork()
    ├── useMyClaimedRuns()    → automations.myClaimedRuns (runs assigned to current user)
    ├── useSessions({ excludeSetup, excludeCli, excludeAutomation, createdBy: userId })
    │   → server-side: WHERE created_by = userId
    │   → client-side: status in (running, starting, paused)
    └── useOrgActions({ status: "pending" })
        → pendingApprovals
    ▼
MyWorkPage: sections for Claimed Runs, Active Sessions, Pending Approvals
```

### Activity Feed

```
useOrgActivity({ status?, limit?, offset? })
    ▼
useOrgRuns(options) → automations.listOrgRuns
    ▼
runs.listOrgRuns(orgId, { status?, limit?, offset? })
    │  time-bound: 90-day cutoff
    │  joins: automationRuns → triggerEvent, trigger, session, assignee
    │  pagination: limit (max 100) + offset
    ▼
ActivityPage: status filter pills, paginated run list
```

### Inbox Unassigned Filtering

```
useAttentionInbox({ wsApprovals })
    │  calls: useOrgPendingRuns({ limit: 50, unassignedOnly: true })
    │  DB query: WHERE assigned_to IS NULL (server-side)
    │  returns: AttentionItem[] (unassigned runs + approvals, sorted by timestamp)
    ▼
InboxContent: items displayed directly (no client-side filter needed)
Sidebar: items.length → badge count
```

---

## 5. Key Invariants

### API Endpoints

| Endpoint | Scoping | Input | Output |
|----------|---------|-------|--------|
| `automations.getRun` | `orgProcedure` | `{ runId: UUID }` | `{ run: AutomationRunSchema }` |
| `automations.listRunEvents` | `orgProcedure` | `{ runId: UUID }` | `{ events: AutomationRunEventSchema[] }` |
| `automations.listOrgRuns` | `orgProcedure` | `{ status?, limit?, offset? }` | `{ runs: AutomationRunSchema[], total: number }` |

### Defense-in-Depth Patterns
- `listRunEvents` first verifies the run belongs to the org before fetching events. Returns `NOT_FOUND` (not empty array) if the run does not exist or belongs to another org. Source: `packages/services/src/runs/db.ts:listRunEvents`
- `findRunForDisplay` scopes query by both `runId` and `orgId`. Source: `packages/services/src/runs/db.ts:findRunForDisplay`
- `listOrgRuns` always applies a 90-day time cutoff to prevent unbounded queries. Source: `packages/services/src/runs/db.ts:listOrgRuns`

### Client-Side Filtering vs Server-Side
- **Server-side**: `excludeAutomation` filter on `sessions.listByOrganization` adds `WHERE automation_id IS NULL`. Source: `packages/services/src/sessions/db.ts`
- **Server-side**: `createdBy` filter on `sessions.listByOrganization` adds `WHERE created_by = ?`. Used by My Work to scope sessions to the current user. Source: `packages/services/src/sessions/db.ts`
- **Server-side**: `unassignedOnly` filter on `listOrgPendingRuns` adds `WHERE assigned_to IS NULL`. Used by inbox and sidebar badge. Source: `packages/services/src/runs/db.ts`
- **Client-side**: Origin filter dropdown (manual/automation/slack/cli) and urgency indicator cross-referencing are computed in the browser. Source: `apps/web/src/app/(command-center)/dashboard/sessions/page.tsx`

### Polling Intervals
- `useRun(runId)`: 30s refetch interval. Source: `apps/web/src/hooks/use-automations.ts:useRun`
- `useRunEvents(runId)`: 30s refetch interval. Source: `apps/web/src/hooks/use-automations.ts:useRunEvents`
- `useOrgRuns()`: 30s refetch interval. Source: `apps/web/src/hooks/use-automations.ts:useOrgRuns`
- `useOrgPendingRuns()`: 30s refetch interval (inherited from existing hook).

### Cache Invalidation
`useResolveRun()` invalidates five query keys on success: `getRun` (specific run), `listOrgPendingRuns`, `myClaimedRuns`, `listRuns` (automation-scoped), and `listOrgRuns`. Source: `apps/web/src/hooks/use-automations.ts:useResolveRun`

---

## 6. Known Limitations

- [ ] **Origin filter is client-side** — The origin filter dropdown on the sessions page computes origin from `automationId`, `origin`, and `clientType` fields in the browser. For large session lists, a server-side filter would be more efficient. The only server-side filter is `excludeAutomation` (used by My Work to hide automation-spawned sessions).
- [ ] **No server-side pagination on sessions** — The sessions list loads all sessions for the org and filters client-side. This works at current scale but will need server-side pagination as session counts grow.
- [ ] **Investigation panel requires runId in URL** — The investigation panel only opens when `runId` is present as a search param. There is no way to open it from within the workspace for a session that has an associated run without navigating through the inbox or session card link.
- [ ] **Pending run map uses last-wins** — The urgency indicator on session cards maps sessionId to the most recent pending run. If a session has multiple runs in attention states, only the last one in the array is shown. Source: `apps/web/src/app/(command-center)/dashboard/sessions/page.tsx`
- [ ] **Activity page has no date range picker** — The 90-day time bound is hardcoded in the DB query. Users cannot adjust the time window.
- [ ] **Sessions removed from sidebar** — The Sessions page is still accessible via direct URL (`/dashboard/sessions`) but is no longer in the sidebar navigation. It is accessible via command search.
- [ ] **My Work shows all org approvals** — Pending approvals in My Work are org-wide, not filtered to the current user, because per-user approval assignment does not exist yet. Source: `apps/web/src/hooks/use-my-work.ts`
- [ ] **Investigation panel claim does not optimistically update** — The "Claim" button in the investigation panel calls `assignRun` and waits for the mutation to complete. There is no optimistic update, so the button stays visible until the refetch completes.


---
# FILE: docs/specs/integrations.md
---

# Integrations — System Spec

## 1. Scope & Purpose

### In Scope
- External credential and connectivity lifecycle (OAuth integrations + GitHub App + Slack installs)
- Connection requirements declared by code-defined integration modules (`IntegrationProvider.connections` in `packages/providers/`)
- OAuth preset mapping (framework-level) from `preset` keys to the active OAuth broker implementation (Nango today)
- Token resolution for downstream consumers (`getToken()`), including planned support for optional user-scoped credentials
- Org-scoped MCP connector catalog lifecycle (CRUD, validation, enable/disable)
- Persistence of MCP connector tool mode overrides and tool drift metadata (`tool_risk_overrides` JSONB on `org_connectors`; storage + CRUD only — runtime enforcement is owned by Actions)
- Connection binding tables: `repo_connections`, `automation_connections`, `session_connections`
- Slack workspace-level installations and OAuth
- Slack conversations cache (schema only — runtime use belongs to `automations-runs.md`)
- Sentry and Linear metadata queries (projects, teams, labels, etc.)
- GitHub App installation flow (non-Nango path)
- GitHub via Nango (optional, behind `NEXT_PUBLIC_USE_NANGO_GITHUB` feature flag)
- Integration disconnect with orphaned-repo cleanup
- Gateway-side GitHub token resolution

### Out of Scope
- What repos/automations/sessions **do** with connections at runtime — see `repos-prebuilds.md`, `automations-runs.md`, `sessions-gateway.md`
- Action permissioning and execution (allow/deny/require_approval, approvals, auditing) — see `actions.md`
- Connector execution lifecycle (risk/approval/grants/audit) — see `actions.md`
- Trigger ingestion (webhooks, polling, event normalization) — see `triggers.md`
- GitHub App webhook dispatch to triggers — see `triggers.md`
- Slack async client and message handling — see `automations-runs.md`
- Automation run pipeline and notifications — see `automations-runs.md`

### Mental Model

Integrations is Proliferate's **external connectivity control plane**. It stores which external services an org can talk to, handles OAuth flows, and abstracts how to obtain live credentials for them at runtime.

Integrations does **not** execute actions and does **not** ingest triggers; it only provides records and token resolution primitives (`getToken()`) that those subsystems consume.

Code-defined integrations are self-contained modules in `packages/providers/` that declare their connection requirements (OAuth scopes, preset keys) without binding to a specific OAuth broker. Integrations uses these declarations to drive connect UX and to validate that a session/automation has the right connectivity configured, while `getToken()` remains the single boundary for resolving live access tokens.

**Core entities:**
- **Integration** — An org-scoped external connection reference. Provider is either `nango` (Sentry/Linear/GitHub-via-Nango) or `github-app` (GitHub App installation). Lifecycle: `active` → `expired`/`revoked`/`deleted`/`suspended`.
- **User connection** — A user-scoped credential for a provider, used when actions need user attribution (e.g., user-authored GitHub commits). Currently planned; the `user_connections` table was created and subsequently dropped — it will be re-introduced when a design partner requires user attribution.
- **Connector** — An org-scoped MCP endpoint configuration (`org_connectors` table) with auth mapping, per-tool mode overrides (`tool_risk_overrides` JSONB), and drift hash metadata. Used by Actions to discover and invoke connector-backed tools. Managed via Settings → Tools UI.
- **Connection binding** — A junction row linking an integration to a repo, automation, or session. Cascades on delete.
- **Slack Installation** — A workspace-level Slack bot installation, stored separately from `integrations` because Slack uses its own OAuth flow with encrypted bot tokens. Lifecycle: `active` → `revoked`.

**Key invariants:**
- **Stateless Modules:** Providers declare what they need (`type: "oauth2"`, `scopes`, `preset`) but never *how* it is fulfilled. There are no Nango or Arctic references in `packages/providers/src/`.
- **Single Enforced Boundary:** `getToken()` is the only runtime path that yields a bearer token. Triggers and Actions never read tokens from storage directly.
- **Catalog Persistence:** Integrations owns the storage and CRUD lifecycle of the `org_connectors` table, including persisting MCP tool drift hashes (runtime enforcement is owned by Actions).
- One integration record per `(connection_id, organization_id)` pair (unique constraint).
- Slack installations are unique per `(organization_id, team_id)`.
- Deleting a GitHub integration triggers orphaned-repo detection.
- Bot tokens for Slack are encrypted at rest; never logged.
- `NEXT_PUBLIC_INTEGRATIONS_ENABLED` gates all Nango-based OAuth flows.

---

## 2. Core Concepts

### 2.1 IntegrationProvider & Connection Requirements

Providers declare what credentials they require via the `IntegrationProvider` interface. They do not declare how those credentials are fulfilled by a specific OAuth broker.

```typescript
// packages/providers/src/types.ts
export type ConnectionType = "oauth2" | "api_key";

export interface ConnectionRequirement {
  type: ConnectionType;
  preset: string;    // Stable framework lookup key, e.g. "sentry", "linear"
  label?: string;    // Human-readable label (e.g., "Sentry OAuth")
}

export interface IntegrationProvider {
  id: string;           // e.g. "sentry"
  displayName: string;
  category: "source_control" | "issue_tracker" | "monitoring" | "communication" | "custom";

  // What credentials does this provider need from the platform?
  connections: {
    org?: ConnectionRequirement;
    user?: ConnectionRequirement;   // Enables optional user attribution
  };

  supportsWebhooks: boolean;
  supportsPolling: boolean;
  triggerEventTypes: TriggerEventType[];
}
```

- Key detail agents get wrong: provider modules are broker-agnostic declarations; Nango/broker mapping belongs to Integrations framework code, not to `packages/providers/`.
- Reference: `packages/providers/src/types.ts`, `packages/providers/src/providers/registry.ts`

### 2.2 OAuth Preset Mapping (Broker-Agnostic)

Because `ConnectionRequirement` declares a stable `preset` (e.g., `"sentry"`), the provider code never changes even if the OAuth broker is swapped. The backend Integrations layer maintains the mapping from preset keys to broker-specific configuration (Nango integration IDs today).

When a user clicks "Connect Sentry", the UI looks up the preset, triggers the underlying OAuth flow (Nango), and saves the resulting connection reference to the `integrations` table.

- Key detail agents get wrong: there is no standalone `presets.ts` file yet. The preset concept is expressed in the `IntegrationProvider.connections.org.preset` field, and the actual broker mapping is inline in the oRPC router's session creation endpoints (`sentrySession`, `linearSession`, `githubSession`).
- Reference: `apps/web/src/server/routers/integrations.ts`, `apps/web/src/lib/nango.ts`

### 2.3 Nango

Nango is an external OAuth broker that manages token refresh, storage, and the OAuth handshake for Sentry, Linear, and optionally GitHub. Proliferate creates a "connect session" via the Nango SDK, the user completes OAuth in Nango's UI, and a callback saves the `connection_id` + `providerConfigKey` locally.
- Key detail agents get wrong: Nango manages the OAuth tokens — Proliferate never stores raw OAuth tokens for Nango-managed integrations. Token retrieval is always via `nango.getConnection()`.
- Reference: `apps/web/src/lib/nango.ts`, `packages/services/src/integrations/tokens.ts`

### 2.4 GitHub App vs Nango GitHub

GitHub has two auth paths. The default is a GitHub App installation (provider `github-app`), where Proliferate registers as a GitHub App and gets an `installation_id`. The alternative (behind `NEXT_PUBLIC_USE_NANGO_GITHUB` feature flag) routes GitHub OAuth through Nango.
- Key detail agents get wrong: The two paths produce different `provider` values in the `integrations` table (`github-app` vs `nango`) and use different token resolution logic.
- Reference: `apps/web/src/app/api/integrations/github/callback/route.ts`, `apps/web/src/server/routers/integrations.ts:githubSession`

### 2.5 Token Resolution (`getToken`)

`getToken()` is the runtime enforcement boundary that resolves a live token. Given an `IntegrationForToken`, it returns a live access token. Used by the gateway (for git operations), worker (for enrichment), and trigger-service (for polling).

**Critical trap:** Integration modules receive tokens as arguments injected into their `execute()` or `poll()` functions; they do not query PostgreSQL or secret stores themselves.

```typescript
// packages/services/src/integrations/tokens.ts
export async function getToken(integration: IntegrationForToken): Promise<string> {
  // GitHub App -> installation token (cached 50 min)
  if (integration.provider === "github-app" && integration.githubInstallationId) {
    return getInstallationToken(integration.githubInstallationId);
  }

  // Nango -> OAuth token via Nango API (refreshed by Nango internally)
  if (integration.provider === "nango" && integration.connectionId) {
    const connection = await nango.getConnection(
      integration.integrationId, integration.connectionId
    );
    return connection.credentials.access_token;
  }

  throw new Error(`Unsupported provider ${integration.provider}`);
}
```

Planned extension: `getToken()` will accept an optional `userId` parameter. When provided, it will check a `user_connections` table first (for user attribution, e.g., user-authored Git commits) before falling back to the org-scoped integration. This is not yet implemented — see §9 tech debt.

- Key detail agents get wrong: GitHub App tokens are cached for 50 minutes (they expire after 1 hour). Nango tokens are fetched live and refreshed by Nango internally.
- Reference: `packages/services/src/integrations/tokens.ts`, `apps/gateway/src/lib/github-auth.ts`

### 2.6 Visibility

Integrations have a `visibility` field: `org` (visible to all org members), `private` (visible only to the creator), or `null` (legacy, treated as `org`). Visibility is enforced at the DB query level in `listByOrganization(orgId, userId)` using a SQL WHERE clause.
- Key detail agents get wrong: Visibility is filtered in the Drizzle query, not in application code. The old `filterByVisibility` mapper function has been deleted.
- Reference: `packages/services/src/integrations/db.ts:listByOrganization`

### 2.7 Connector Catalog

Org-scoped MCP connector definitions are stored in the `org_connectors` table and managed through Integrations CRUD routes. Each connector defines a remote MCP server endpoint, auth method (org secret reference or custom header), optional risk policy, and per-tool mode overrides with drift hashes (`tool_risk_overrides` JSONB). The gateway loads enabled connectors by org at session runtime and merges their tools into `/actions/available`.
- Key detail agents get wrong: connectors complement OAuth integrations; they do not replace them. OAuth integrations resolve tokens via Nango/GitHub App, while connectors resolve org secrets for MCP auth.
- Key detail agents get wrong: connector execution (risk/approval/grants/audit) is still owned by Actions (`actions.md`). Integrations owns the catalog lifecycle and tool mode persistence only.
- Reference: `packages/services/src/connectors/`, `apps/web/src/server/routers/integrations.ts`, `apps/web/src/app/(command-center)/dashboard/integrations/page.tsx`

---

## 3. File Tree

```
packages/providers/src/                    # Code-defined integration modules (broker-agnostic)
├── types.ts                               # IntegrationProvider, ConnectionRequirement interfaces
├── action-source.ts                       # ActionSource interface + ProviderActionSource
├── index.ts                               # Package exports
└── providers/
    ├── registry.ts                        # ProviderActionModule registry (Linear, Sentry, Slack)
    ├── linear/                            # Linear provider actions
    ├── sentry/                            # Sentry provider actions
    └── slack/                             # Slack provider actions

packages/db/src/schema/
├── integrations.ts                        # integrations + repo_connections tables
├── slack.ts                               # slack_installations + slack_conversations + session_notification_subscriptions tables
└── schema.ts                              # automation_connections, session_connections, org_connectors tables

packages/services/src/integrations/
├── index.ts                               # Module exports
├── service.ts                             # Business logic (list, create, delete, status)
├── db.ts                                  # Raw Drizzle queries
├── mapper.ts                              # DB row → API response transforms
├── tokens.ts                              # getToken() — generic token resolution (Nango + GitHub App)
└── github-app.ts                          # GitHub App JWT + installation token utilities

packages/services/src/connectors/
├── index.ts                               # Module exports
├── db.ts                                  # Drizzle queries for org_connectors table
└── service.ts                             # Connector CRUD + validation + preset-based creation

packages/shared/src/contracts/
└── integrations.ts                        # Zod schemas + ts-rest contract definition

apps/web/src/lib/
├── nango.ts                               # Nango SDK singleton + integration ID helpers
├── slack.ts                               # Slack API helpers (OAuth, postMessage, revoke)
└── github-app.ts                          # GitHub App JWT + installation verification

apps/web/src/server/routers/
└── integrations.ts                        # oRPC router (all integration + connector endpoints)

apps/web/src/app/(command-center)/dashboard/integrations/
└── page.tsx                               # Unified integrations page (OAuth + MCP, admin + user views)

apps/web/src/components/integrations/
├── connector-icon.tsx                     # Connector icon + findPresetKey utility
├── connector-form.tsx                     # Full connector config form (URL, transport, auth)
├── integration-detail-dialog.tsx          # Detail dialog (connect tab + about tab)
├── integration-picker-dialog.tsx          # Catalog picker with search + categories
├── provider-icon.tsx                      # OAuth provider icon + display name helpers
└── quick-setup-form.tsx                   # API-key-only setup form for MCP presets

apps/web/src/hooks/
└── use-org-connectors.ts                  # React hooks for org-level connector CRUD

apps/web/src/app/api/integrations/
├── github/callback/route.ts               # GitHub App installation callback
├── slack/oauth/route.ts                   # Slack OAuth initiation (redirect)
└── slack/oauth/callback/route.ts          # Slack OAuth callback (token exchange)

apps/web/src/app/api/webhooks/
└── github-app/route.ts                    # GitHub App webhook handler (lifecycle events)

apps/gateway/src/lib/
└── github-auth.ts                         # Gateway-side GitHub token resolution
```

Connector catalog: `packages/services/src/connectors/` owns DB access and business logic. `org_connectors` table stores connector definitions with `tool_risk_overrides` JSONB for per-tool mode overrides and drift hashes.

---

## 4. Data Models & Schemas

### Database Tables

```sql
integrations
├── id                  UUID PK
├── organization_id     TEXT NOT NULL FK(organization) CASCADE
├── provider            TEXT NOT NULL          -- 'nango' | 'github-app'
├── integration_id      TEXT NOT NULL          -- 'github' | 'sentry' | 'linear' | 'github-app'
├── connection_id       TEXT NOT NULL          -- Nango connection ID or 'github-app-{installationId}'
├── display_name        TEXT
├── scopes              TEXT[]
├── status              TEXT DEFAULT 'active'  -- 'active' | 'expired' | 'revoked' | 'deleted' | 'suspended'
├── visibility          TEXT DEFAULT 'org'     -- 'org' | 'private'
├── github_installation_id TEXT               -- GitHub App only
├── created_by          TEXT FK(user)
├── created_at          TIMESTAMPTZ
└── updated_at          TIMESTAMPTZ
    UNIQUE(connection_id, organization_id)
    INDEX(organization_id)
    INDEX(github_installation_id)
```

```sql
repo_connections
├── id                  UUID PK
├── repo_id             UUID NOT NULL FK(repos) CASCADE
├── integration_id      UUID NOT NULL FK(integrations) CASCADE
└── created_at          TIMESTAMPTZ
    UNIQUE(repo_id, integration_id)

automation_connections
├── id                  UUID PK
├── automation_id       UUID NOT NULL FK(automations) CASCADE
├── integration_id      UUID NOT NULL FK(integrations) CASCADE
└── created_at          TIMESTAMPTZ
    UNIQUE(automation_id, integration_id)

session_connections
├── id                  UUID PK
├── session_id          UUID NOT NULL FK(sessions) CASCADE
├── integration_id      UUID NOT NULL FK(integrations) CASCADE
└── created_at          TIMESTAMPTZ
    UNIQUE(session_id, integration_id)
```

```sql
org_connectors
├── id                  UUID PK DEFAULT gen_random_uuid()
├── organization_id     TEXT NOT NULL FK(organization) CASCADE
├── name                TEXT NOT NULL
├── transport           TEXT NOT NULL DEFAULT 'remote_http'
├── url                 TEXT NOT NULL
├── auth                JSONB NOT NULL           -- { type: 'none' | 'secret' | 'bearer' | 'custom_header', secretKey?, headerName?, headerValue? }
├── risk_policy         JSONB                    -- { defaultRisk: 'read' | 'write' | 'danger' }
├── tool_risk_overrides JSONB                    -- { "<toolName>": { mode: 'allow' | 'require_approval' | 'deny', hash: string }, ... }
├── enabled             BOOLEAN NOT NULL DEFAULT true
├── created_by          TEXT FK(user)
├── created_at          TIMESTAMPTZ DEFAULT now()
└── updated_at          TIMESTAMPTZ DEFAULT now()
    INDEX(organization_id)
```

```sql
slack_installations
├── id                  UUID PK
├── organization_id     TEXT NOT NULL FK(organization) CASCADE
├── team_id             TEXT NOT NULL
├── team_name           TEXT
├── encrypted_bot_token TEXT NOT NULL
├── bot_user_id         TEXT NOT NULL
├── scopes              TEXT[]
├── installed_by        TEXT FK(user)
├── status              TEXT DEFAULT 'active'  -- 'active' | 'revoked'
├── connect_channel_id  TEXT
├── invite_url          TEXT
├── support_channel_id  TEXT                   -- Slack Connect support channel
├── support_channel_name TEXT                  -- Support channel display name
├── support_invite_id   TEXT                   -- Slack Connect invite ID
├── support_invite_url  TEXT                   -- Slack Connect invite URL
├── created_at          TIMESTAMPTZ
└── updated_at          TIMESTAMPTZ
    UNIQUE(organization_id, team_id)
    INDEX(organization_id)
    INDEX(team_id)

slack_conversations
├── id                  UUID PK
├── slack_installation_id UUID NOT NULL FK(slack_installations) CASCADE
├── channel_id          TEXT NOT NULL
├── thread_ts           TEXT NOT NULL
├── session_id          UUID FK(sessions) SET NULL
├── repo_id             UUID FK(repos)
├── started_by_slack_user_id TEXT
├── status              TEXT DEFAULT 'active'
├── pending_prompt      TEXT
├── created_at          TIMESTAMPTZ
└── last_message_at     TIMESTAMPTZ
    UNIQUE(slack_installation_id, channel_id, thread_ts)

session_notification_subscriptions
├── id                  UUID PK
├── session_id          UUID NOT NULL FK(sessions) CASCADE
├── user_id             TEXT NOT NULL FK(user) CASCADE
├── slack_installation_id UUID NOT NULL FK(slack_installations) CASCADE
├── destination_type    TEXT NOT NULL DEFAULT 'dm_user'
├── slack_user_id       TEXT
├── event_types         JSONB DEFAULT '["completed"]'
├── notified_at         TIMESTAMPTZ
├── created_at          TIMESTAMPTZ DEFAULT now()
└── updated_at          TIMESTAMPTZ DEFAULT now()
    UNIQUE(session_id, user_id)
    CHECK(destination_type != 'dm_user' OR slack_user_id IS NOT NULL)
```

### Key Indexes & Query Patterns
- `idx_integrations_org` on `organization_id` — all list/status queries filter by org
- `idx_integrations_github_installation` on `github_installation_id` — webhook handler resolves integration by installation ID
- `idx_slack_installations_team` on `team_id` — Slack events handler resolves installation by team
- `idx_slack_conversations_thread` on `(channel_id, thread_ts)` — message routing looks up existing conversation by thread
- `idx_org_connectors_org` on `organization_id` — connector queries filter by org
- Connector tool mode overrides are stored as JSONB on `org_connectors` and read by Actions at session runtime

### Core TypeScript Types

```typescript
// packages/shared/src/contracts/integrations.ts
interface Integration {
  id: string;
  organization_id: string;
  provider: string;
  integration_id: string | null;
  connection_id: string | null;
  display_name: string | null;
  status: string | null;
  visibility: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface IntegrationWithCreator extends Integration {
  creator: { id: string; name: string | null; email: string | null } | null;
}

// packages/services/src/integrations/tokens.ts
interface IntegrationForToken {
  id: string;
  provider: string;        // 'nango' | 'github-app'
  integrationId: string;   // 'linear' | 'sentry' | 'github'
  connectionId: string;
  githubInstallationId?: string | null;
}

// packages/providers/src/types.ts
interface ConnectionRequirement {
  type: "oauth2" | "api_key";
  preset: string;
  label?: string;
}

interface IntegrationProvider {
  id: string;
  displayName: string;
  category: "source_control" | "issue_tracker" | "monitoring" | "communication" | "custom";
  connections: {
    org?: ConnectionRequirement;
    user?: ConnectionRequirement;
  };
  supportsWebhooks: boolean;
  supportsPolling: boolean;
  triggerEventTypes: TriggerEventType[];
}
```

---

## 5. Conventions & Patterns

### Do
- Use `packages/services/src/integrations/` for all DB reads/writes — never query directly from routers
- Use `tokens.ts:getToken()` to resolve live OAuth tokens — it abstracts over both provider types
- Encrypt Slack bot tokens at rest via `@/lib/crypto` before storing
- Treat provider-declared connection requirements as declarative input only; never call Nango from provider modules
- Keep `getToken()` as the only bearer token boundary used by Actions/Triggers
- Store connector tool overrides and hashes on the connector record (`tool_risk_overrides`); keep enforcement in Actions

### Don't
- Store raw OAuth tokens for Nango-managed integrations — Nango owns token storage and refresh
- Log Slack bot tokens, OAuth tokens, or any credential material
- Call `nango.getConnection()` outside the integrations module — use the token resolution layer
- Couple provider modules to OAuth broker identifiers (Nango integration keys, broker provider IDs)
- Implement per-tool permissioning in Integrations (it is persisted here, enforced in Actions)

### Error Handling

```typescript
// Nango SDK errors are axios-shaped; extract response details
function handleNangoError(err: unknown, operation: string): never {
  const axiosResponse = (err as { response?: { status?: number; data?: unknown } }).response;
  if (axiosResponse) {
    throw new ORPCError("BAD_REQUEST", { message: `${operation}: ${message}` });
  }
  throw err;
}
```

### Reliability
- Token resolution should be idempotent and safe to retry; external brokers may have transient failures
- GitHub App installation tokens: cached 50 min (expire at 60 min)
  - `packages/services/src/integrations/github-app.ts`, `apps/gateway/src/lib/github-auth.ts`
- Slack API calls: exponential backoff with retry on 429 / `ratelimited`, max 3-5 retries
  - `apps/web/src/lib/slack.ts:fetchWithRetry`
- Slack OAuth state: 5-minute expiry with nonce for CSRF protection
  - `apps/web/src/app/api/integrations/slack/oauth/callback/route.ts`

### Testing Conventions
- No dedicated integration tests exist for this subsystem today
- Mock Nango SDK (`@nangohq/node`) and external API calls (Sentry REST, Linear GraphQL, GitHub API) in any future tests
- Slack token encryption/decryption should use test encryption keys, never production secrets

---

## 6. Subsystem Deep Dives

### 6.1 Connect an OAuth Integration — `Implemented`

**What it does:** Starts an OAuth flow for a provider, then persists the resulting connection reference as an org integration record.

**Happy path:**
1. UI selects a provider (by `IntegrationProvider.id`) and reads its `connections.org` requirement for scopes + preset
2. Integrations auth layer maps the provider `preset` to broker-specific config (Nango integration ID) and starts the OAuth handshake via `sentrySession` / `linearSession` / `githubSession`
3. User completes OAuth in Nango's UI; frontend calls `integrationsRouter.callback` with `connectionId` and `providerConfigKey`
4. Service saves integration with `provider='nango'`, `visibility='org'`; if `connection_id` already exists, re-authorization updates status to `active`
5. Session/automation binds the integration via `session_connections` / `automation_connections`

**Edge cases:**
- Provider declares `type: "oauth2"` but no scopes → warn during provider registry validation, fail safe at connect-time
- Broker implementation swap (Nango → Arctic) → preset key remains stable; only framework mapping changes

**Files touched:** `apps/web/src/server/routers/integrations.ts:sentrySession,linearSession,callback`, `packages/services/src/integrations/service.ts:saveIntegrationFromCallback`, `apps/web/src/lib/nango.ts`

### 6.2 Integration List and Update — `Implemented`

**What it does:** Lists all integrations for an org (filtered by visibility) and allows renaming. Also includes `slackStatus` (returns team info + support channel), `slackInstallations` (lists active Slack workspaces for notification selector), `slackMembers` (lists workspace members for DM target picker), `slackChannels` (lists workspace channels for channel notification picker), `sentryStatus`, `linearStatus`, and `githubStatus` endpoints.

**Happy path (list):**
1. `integrationsRouter.list` calls `integrations.listIntegrations(orgId, userId)` (`apps/web/src/server/routers/integrations.ts`)
2. Service fetches integration rows for the org, filtered by visibility at the SQL level — `org` and `null` are visible to all; `private` only to the creator (`db.ts:listByOrganization(orgId, userId)`)
3. Creator info is batch-fetched and attached (`mapper.ts:attachCreators`)
4. Grouped by provider (`mapper.ts:groupByProvider`) and returned with per-provider `connected` booleans

**Happy path (update):**
1. `integrationsRouter.update` verifies the integration belongs to the org
2. Calls `db.ts:updateDisplayName` — trims whitespace, sets `null` for empty strings

**Files touched:** `apps/web/src/server/routers/integrations.ts`, `packages/services/src/integrations/service.ts`, `packages/services/src/integrations/db.ts`, `packages/services/src/integrations/mapper.ts`

### 6.3 GitHub App Installation (OAuth) — `Implemented`

**What it does:** Installs a GitHub App on the user's account/org, saves the installation, and auto-adds repos.

**Happy path:**
1. User clicks "Install GitHub App" which redirects to `https://github.com/apps/{slug}/installations/new`
2. GitHub redirects to `GET /api/integrations/github/callback` with `installation_id` and `state` (`apps/web/src/app/api/integrations/github/callback/route.ts`)
3. Route verifies auth, parses `state` (contains `returnUrl`, optional `targetOrgId` for CLI flows)
4. Calls `verifyInstallation()` to confirm the installation exists on GitHub (`apps/web/src/lib/github-app.ts`)
5. Calls `integrations.saveGitHubAppInstallation()` which upserts into `integrations` table with `provider='github-app'`, `connection_id='github-app-{installationId}'` (`packages/services/src/integrations/service.ts`, `db.ts:upsertGitHubAppInstallation`)
6. Auto-adds all repos from the installation via `listInstallationRepos()` + `repos.createRepo()`
7. Redirects to `returnUrl` with `?success=github`

**Edge cases:**
- Re-installation: upsert conflict on `(connection_id, organization_id)` updates `display_name` and sets `status='active'`
- Uninstall action: redirects to dashboard with `?github=uninstalled` (no DB change here — handled by webhook)
- Missing auth: redirects to sign-in with the callback URL as return parameter

**Files touched:** `apps/web/src/app/api/integrations/github/callback/route.ts`, `apps/web/src/lib/github-app.ts`, `packages/services/src/integrations/service.ts`, `packages/services/src/integrations/db.ts`

### 6.4 GitHub via Nango (Optional) — `Implemented`

**What it does:** Alternative GitHub OAuth flow through Nango, gated behind `NEXT_PUBLIC_USE_NANGO_GITHUB`.

**Happy path:**
1. `integrationsRouter.githubSession` checks the feature flag, creates a Nango connect session with `allowed_integrations: [githubIntegrationId]`
2. Frontend completes OAuth in Nango's UI
3. Nango calls back; frontend calls `integrationsRouter.callback` with `connectionId` and `providerConfigKey`
4. Service saves integration with `provider='nango'`

**Files touched:** `apps/web/src/server/routers/integrations.ts:githubSession`, `apps/web/src/lib/nango.ts`

### 6.5 Slack OAuth — `Implemented`

**What it does:** Workspace-level Slack bot installation with encrypted token storage. Not Nango-managed.

**Happy path:**
1. `GET /api/integrations/slack/oauth` verifies auth, generates base64url-encoded state with `{orgId, userId, nonce, timestamp, returnUrl}`, redirects to Slack OAuth URL (`apps/web/src/app/api/integrations/slack/oauth/route.ts`)
2. User authorizes in Slack
3. `GET /api/integrations/slack/oauth/callback` validates state (5-min expiry), calls `exchangeCodeForToken()` (`apps/web/src/lib/slack.ts`)
4. Bot token is encrypted via `encrypt()` from `@/lib/crypto`
5. Calls `integrations.saveSlackInstallation()` — checks for existing `(org, team_id)` pair, updates or creates (`packages/services/src/integrations/service.ts:saveSlackInstallation`)
6. Redirects with `?success=slack&tab=connections`

**Edge cases:**
- Re-authorization of same workspace: updates existing row (token, scopes, status → `active`)
- OAuth denied by user: redirects with `?error=slack_oauth_denied`
- State expired (>5 min): redirects with `?error=slack_oauth_expired`

**Files touched:** `apps/web/src/app/api/integrations/slack/oauth/route.ts`, `apps/web/src/app/api/integrations/slack/oauth/callback/route.ts`, `apps/web/src/lib/slack.ts`, `packages/services/src/integrations/service.ts`, `packages/services/src/integrations/db.ts`

### 6.6 Integration Disconnect — `Implemented`

**What it does:** Removes an integration, cleans up upstream broker connection, and detects orphaned repos.

**Permission model:** Admins and owners can disconnect any integration. Members can only disconnect integrations they created (`integration.created_by === userId`). Non-creator members receive a 403 FORBIDDEN.

**Happy path:**
1. `integrationsRouter.disconnect` fetches the integration, checks org membership (via `orgProcedure`)
2. Verifies the caller is admin/owner OR the integration creator
3. For Nango-managed connections (`provider !== 'github-app'`): calls `nango.deleteConnection()` to revoke upstream
4. Calls `service.ts:deleteIntegration()` which deletes the row from `integrations`
5. For GitHub-related integrations: runs `handleOrphanedRepos()` — iterates non-orphaned repos, checks if any have zero `repo_connections`, marks them as `isOrphaned=true`

**Files touched:** `apps/web/src/server/routers/integrations.ts:disconnect`, `packages/services/src/integrations/service.ts:deleteIntegration`

### 6.7 Slack Disconnect — `Implemented`

**What it does:** Revokes a Slack bot token and marks the installation as revoked.

**Happy path:**
1. `integrationsRouter.slackDisconnect` finds the active installation for the org
2. Decrypts the bot token, calls `revokeToken()` against Slack API (`apps/web/src/lib/slack.ts:revokeToken`)
3. Marks installation `status='revoked'` via `db.ts:revokeSlackInstallation`

**Edge cases:**
- Slack API revocation fails: logged and swallowed — local revocation proceeds regardless

**Files touched:** `apps/web/src/server/routers/integrations.ts:slackDisconnect`, `packages/services/src/integrations/service.ts`, `packages/services/src/integrations/db.ts`

### 6.8 Sentry Metadata Queries — `Implemented`

**What it does:** Fetches Sentry projects, environments, and severity levels for trigger/action configuration.

**Happy path:**
1. `integrationsRouter.sentryMetadata` receives `connectionId` (integration UUID) and optional `projectSlug`
2. Verifies integration is active, fetches credentials from Nango via `nango.getConnection()`
3. Calls `fetchSentryMetadata()` which queries Sentry REST API:
   - `GET /api/0/organizations/` → first org slug
   - `GET /api/0/organizations/{slug}/projects/`
   - `GET /api/0/projects/{org}/{project}/environments/` (for the target project)
4. Returns `{ projects, environments, levels }` where `levels` is the static list `['debug','info','warning','error','fatal']`

**Files touched:** `apps/web/src/server/routers/integrations.ts:sentryMetadata,fetchSentryMetadata`

### 6.9 Linear Metadata Queries — `Implemented`

**What it does:** Fetches Linear teams, workflow states, labels, users, and projects via GraphQL.

**Happy path:**
1. `integrationsRouter.linearMetadata` receives `connectionId` and optional `teamId`
2. Verifies integration, fetches token from Nango
3. Calls `fetchLinearMetadata()` which sends a single GraphQL query to `https://api.linear.app/graphql`
4. Returns `{ teams, states, labels, users, projects }`

**Edge cases:**
- `teamId` filter: when provided, `workflowStates` and `issueLabels` are filtered by team

**Files touched:** `apps/web/src/server/routers/integrations.ts:linearMetadata,fetchLinearMetadata`

### 6.10 Token Resolution — `Implemented`

**What it does:** Generic layer to get live OAuth tokens for any integration type. Tokens are currently org-scoped only; user-scoped token resolution via `user_connections` is planned but not yet implemented.

**Happy path:**
1. Caller provides an `IntegrationForToken` (from `db.ts:getIntegrationsForTokens` lookup)
2. `tokens.ts:getToken(integration)` checks provider type:
   - `github-app` + `githubInstallationId`: generates JWT, calls GitHub API for installation token (cached 50 min)
   - `nango` + `connectionId`: calls `nango.getConnection()` to get `access_token`
3. `resolveTokens()` processes multiple integrations in parallel via `Promise.allSettled`, collecting successes and errors separately
4. `getEnvVarName()` generates environment variable names like `LINEAR_ACCESS_TOKEN_abc12345` for sandbox injection

**Files touched:** `packages/services/src/integrations/tokens.ts`, `packages/services/src/integrations/github-app.ts`

### 6.11 GitHub Auth (Gateway-Side) — `Implemented`

**What it does:** Resolves GitHub tokens inside the gateway for git operations (clone, pull, push).

**Happy path:**
1. `getGitHubTokenForIntegration()` receives a `GitHubIntegration` object
2. If `github_installation_id` is set: generates JWT + fetches installation token (same logic as services layer, duplicated in gateway for independence)
3. If `connection_id` is set (Nango path): calls `nango.getConnection()` via gateway's own Nango client
4. `getNangoConnectionToken()` is a generic helper for any Nango connection (used for non-GitHub tokens in the gateway)

**Files touched:** `apps/gateway/src/lib/github-auth.ts`

### 6.12 Slack Connect (Support Channel) — `Implemented`

**What it does:** Creates a Slack Connect channel and invites a customer for support.

**Happy path:**
1. `integrationsRouter.slackConnect` gets user email, calls `sendSlackConnectInvite()`
2. Creates a public channel via `conversations.create` (handles `name_taken` by finding existing)
3. Adds default team members from `PROLIFERATE_SLACK_CONNECT_EMAILS` env var
4. Sends Slack Connect invite to customer via `conversations.inviteShared` (with retry on rate limits)
5. Stores `supportChannelId` and `supportInviteUrl` on the Slack installation

**Files touched:** `apps/web/src/server/routers/integrations.ts:slackConnect`, `apps/web/src/lib/slack.ts:sendSlackConnectInvite`, `packages/services/src/integrations/db.ts:updateSlackSupportChannel`

### 6.13 GitHub App Webhook (Lifecycle Events) — `Implemented`

**What it does:** Handles installation lifecycle events from GitHub (deleted, suspended, unsuspended). Trigger dispatch for non-lifecycle events is documented in `triggers.md`.

**Happy path:**
1. `POST /api/webhooks/github-app` verifies HMAC signature against `GITHUB_APP_WEBHOOK_SECRET`
2. For `installation` events:
   - `deleted` → sets integration status to `deleted`
   - `suspend` → sets status to `suspended`
   - `unsuspend` → sets status to `active`
3. For other events: resolves integration by `installation_id`, finds active triggers, dispatches. See `triggers.md` §6 for dispatch details.

**Files touched:** `apps/web/src/app/api/webhooks/github-app/route.ts`, `packages/services/src/integrations/db.ts:updateStatusByGitHubInstallationId`

### 6.14 Org-Scoped Connector Catalog — `Implemented`

**What it does:** Defines a single org-level source of truth for MCP connector configuration used by Actions discovery/invocation. Includes per-tool mode overrides and drift detection metadata.

**Behavior:**
1. Admin/owner configures connectors via the unified Integrations page (`/dashboard/integrations`). Connectors appear in the same list as OAuth integrations.
2. Config is stored in `org_connectors` table using the shared `ConnectorConfig` schema (`packages/shared/src/connectors.ts`).
3. Per-tool mode overrides and definition hashes are persisted in `tool_risk_overrides` JSONB. The system connects to the MCP server, calls `tools/list`, computes definition hashes, and the admin confirms per-tool modes (`allow | require_approval | deny`).
4. Gateway Actions loads enabled connectors by org/session context, not by prebuild.
5. Connector-backed actions continue using the same `connector:<uuid>` integration prefix and existing approval/audit pipeline in `actions.md`.
6. MCP presets always use `QuickSetupForm` (API key only) — URL, transport, and auth are auto-filled from preset defaults.
7. Custom MCP Server: a catalog entry (`type: "custom-mcp"`) opens the full `ConnectorForm` with URL, transport, auth, and risk policy. This is the only path to full connector configuration.
8. Admin dropdown menu on connector rows: Edit (inline form), Toggle enabled/disabled, Delete (with confirmation dialog).
9. Non-admin users see connectors in the same unified list with source-level enable/disable toggles.

**Key files:**
- DB: `packages/db/src/schema/schema.ts:orgConnectors`, `packages/services/src/connectors/db.ts`
- Service: `packages/services/src/connectors/service.ts`
- Router: `apps/web/src/server/routers/integrations.ts` (connectors section)
- UI: `apps/web/src/app/(command-center)/dashboard/integrations/page.tsx`, `apps/web/src/hooks/use-org-connectors.ts`
- Components: `connector-icon.tsx` (icon + `findPresetKey`), `quick-setup-form.tsx`, `connector-form.tsx`, `integration-detail-dialog.tsx`
- Presets: `packages/shared/src/connectors.ts:CONNECTOR_PRESETS`

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `repos-prebuilds.md` | Repos → This | `repo_connections` table, `getRepoConnectionsWithIntegrations()` | Repos bind to integrations for GitHub access |
| `automations-runs.md` | Automations → This | `automation_connections` table, `resolveTokens()` | Runs resolve tokens for enrichment context |
| `sessions-gateway.md` | Sessions → This | `session_connections` table, `getGitHubTokenForIntegration()` | Sessions use tokens for git operations |
| `triggers.md` | Triggers → This | `integrations.triggers` relation, `findActiveByGitHubInstallationId()` | Trigger-service resolves integration for webhook dispatch |
| `triggers.md` | Triggers → This | `findByConnectionIdAndProvider()`, `updateStatus()` | Nango webhook handler updates connection status on token lifecycle events |
| `actions.md` | Actions → This | `getToken()` | Action adapters resolve tokens for API calls |
| `actions.md` | Actions ↔ This | `connectors.listEnabledConnectors()`, `tool_risk_overrides` | Org-scoped connector catalog + per-tool mode overrides for action discovery/enforcement |
| Providers package | Integrations → Providers | `IntegrationProvider.connections` | Connection requirement declarations (broker-agnostic) |
| `auth-orgs.md` | This → Auth | `orgProcedure` middleware | All integration routes require org membership |
| `secrets-environment.md` | This → Secrets | `getEnvVarName()`, `resolveSecretValue()` | Token env var naming for sandbox injection; connector auth secret resolution |

### Security & Auth
- All oRPC routes use `orgProcedure` (org membership required)
- OAuth session creation (`callback`, `githubSession`, `sentrySession`, `linearSession`) and Slack endpoints (`slackConnect`, `slackDisconnect`) require `requireIntegrationAdmin` (admin/owner role)
- Disconnect uses a creator-or-admin check: admins disconnect anything, members only their own integrations
- Connector CRUD endpoints require `requireIntegrationAdmin`
- Never return tokens in API responses; only return connection metadata
- Slack OAuth state includes nonce + 5-min timestamp for CSRF protection
- GitHub App callback validates `installation_id` via GitHub API before saving
- GitHub App webhook validates HMAC-SHA256 signature
- Slack bot tokens encrypted at rest; decrypted only for API calls
- Nango `NANGO_SECRET_KEY` is server-side only (never exposed to client)

### Observability
- Structured logging via `@proliferate/logger` with child loggers per handler
- Key log fields: `orgId`, `installationId`, `teamId`, `connectionId`
- Nango API errors log full response body for debugging

---

## 8. Acceptance Gates

- [ ] Typecheck passes
- [ ] Relevant tests pass
- [ ] This spec is updated (file tree, data models, deep dives)
- [ ] No OAuth tokens or secrets in log output
- [ ] Nango connection IDs are never exposed to unauthenticated callers
- [ ] Providers declare abstract connection requirements; they never import Nango or broker SDKs
- [ ] `getToken()` is the single boundary for bearer token resolution
- [ ] MCP Connector onboarding persists tool definition hashes to `tool_risk_overrides`

---

## 9. Known Limitations & Tech Debt

- [ ] **`user_connections` not yet implemented** — The `user_connections` table was created (migration `0025`) and subsequently dropped (migration `0031`). `getToken()` currently accepts only an `IntegrationForToken` with no user-scoping. When a design partner requires user attribution (e.g., user-authored Git commits), the table and `getToken(integration, opts?: { userId })` signature will be re-introduced. — Medium impact; blocks user-attributed actions.
- [ ] **No standalone OAuth preset mapping file** — Provider connection requirements declare `preset` keys, but there is no dedicated `presets.ts` mapping file in `packages/services/src/integrations/`. The broker-specific mapping is inline in the oRPC router session endpoints. Should be extracted for cleaner broker-swap support. — Low impact.
- [ ] **OAuth broker implementation details vary** — Presets must remain stable across broker swaps (Nango → Arctic). The abstraction layer is designed for this but not yet exercised with a second broker. — Low impact until broker migration.
- [ ] **Duplicated GitHub App JWT logic** — `apps/web/src/lib/github-app.ts`, `apps/gateway/src/lib/github-auth.ts`, and `packages/services/src/integrations/github-app.ts` each contain independent JWT generation and PKCS key conversion. Should be consolidated into the services package. — Medium impact on maintenance.
- [ ] **Slack schema drift** — The `support_*` columns (`support_channel_id`, `support_channel_name`, `support_invite_id`, `support_invite_url`) exist in the production DB (reflected in `packages/db/src/schema/schema.ts:1350-1353`) but are missing from the hand-written schema in `packages/db/src/schema/slack.ts`. The service code (`db.ts:updateSlackSupportChannel`) wraps access in try/catch commenting "columns may not exist yet". The hand-written schema should be updated to include these columns. — Low impact but creates confusion.
- [ ] **No token refresh error handling** — If Nango returns an expired/invalid token, the error propagates directly to the caller. No automatic retry or re-auth flow exists. — Medium impact for long-running sessions.
- [x] **Visibility filtering in memory** — Resolved. `listByOrganization` now filters by visibility at the SQL level. The old `filterByVisibility` mapper function has been deleted.
- [ ] **Orphaned repo detection is O(n)** — `handleOrphanedRepos` iterates all non-orphaned repos and runs a count query per repo. Should be a single query. — Low impact at current scale.
- [x] **Slack installation disambiguation is now fail-safe** — `findSlackInstallationByTeamId` returns `null` when multiple orgs share the same Slack `team_id`, refusing to guess. Events for shared workspaces return 404 until a proper disambiguation mechanism is added. Org-scoped lookups (used by notifications and session creation) are unaffected.


---
# FILE: docs/specs/llm-proxy.md
---

# LLM Proxy — System Spec

## 1. Scope & Purpose

### In Scope
- Virtual key generation: per-session, per-org temporary keys via LiteLLM admin API
- Key scoping model: team = org, user = session for cost isolation
- Key duration and lifecycle
- LiteLLM API integration contract (endpoints called, auth model)
- Spend tracking via LiteLLM's Admin REST API (`GET /spend/logs/v2`)
- LLM spend cursors (per-org DB sync state for billing reconciliation)
- Environment configuration (`LLM_PROXY_URL`, `LLM_PROXY_MASTER_KEY`, `LLM_PROXY_KEY_DURATION`, etc.)
- How providers (Modal, E2B) pass the virtual key to sandboxes

### Feature Status

| Feature | Status | Evidence |
|---------|--------|----------|
| Virtual key generation | Implemented | `packages/shared/src/llm-proxy.ts:generateVirtualKey` |
| Key scoping (team/user) | Implemented | `packages/shared/src/llm-proxy.ts:generateVirtualKey` — `team_id=orgId`, `user_id=sessionId` |
| Key duration config | Implemented | `packages/environment/src/schema.ts:LLM_PROXY_KEY_DURATION` |
| Team (org) provisioning | Implemented | `packages/shared/src/llm-proxy.ts:ensureTeamExists` |
| Sandbox key injection (Modal) | Implemented | `packages/shared/src/providers/modal-libmodal.ts:createSandbox` |
| Sandbox key injection (E2B) | Implemented | `packages/shared/src/providers/e2b.ts:createSandbox` |
| Spend sync (per-org REST API) | Implemented | `apps/worker/src/billing/worker.ts:syncLLMSpend`, `packages/services/src/billing/litellm-api.ts:fetchSpendLogs` |
| LLM spend cursors (per-org) | Implemented | `packages/db/src/schema/billing.ts:llmSpendCursors` (keyed by `organization_id`) |
| Model routing config | Implemented | `apps/llm-proxy/litellm/config.yaml` |
| Key revocation on session end | Implemented | `packages/shared/src/llm-proxy.ts:revokeVirtualKey`, called from `sessions-pause.ts`, `org-pause.ts` |
| Dynamic max budget from shadow balance | Implemented | `packages/services/src/sessions/sandbox-env.ts:buildSandboxEnvVars` |
| Key alias (sessionId) | Implemented | `packages/shared/src/llm-proxy.ts:generateVirtualKey` — `key_alias=sessionId` |

### Out of Scope
- LiteLLM service internals (model routing config, caching, rate limiting) — external dependency, not our code
- Billing policy, credit gating, charging — see `billing-metering.md`
- Sandbox boot mechanics — see `sandbox-providers.md`
- Session lifecycle (create/pause/resume/delete) — see `sessions-gateway.md`
- Secret decryption and injection — see `secrets-environment.md`

### Mental Model

The LLM proxy is an **external LiteLLM service** that Proliferate routes sandbox LLM requests through. This spec documents our **integration contract** with it — the API calls we make, the keys we generate, and the spend data we read back — not the service itself.

The integration solves two problems: (1) **security** — sandboxes never see real API keys; they get short-lived virtual keys scoped to a single session, and (2) **cost isolation** — every LLM request is attributed to an org (team) and session (user) in LiteLLM's spend tracking, enabling per-org billing.

The flow is: session creation → generate virtual key → pass key + proxy base URL to sandbox → sandbox makes LLM calls through proxy → LiteLLM logs spend → billing worker syncs spend logs into billing events.

**Core entities:**
- **Virtual key** — a temporary LiteLLM API key (e.g., `sk-xxx`) scoped to one session and one org. Generated via LiteLLM's `/key/generate` admin endpoint.
- **Team** — LiteLLM's grouping for cost tracking. Maps 1:1 to a Proliferate org. Created via `/team/new` if it doesn't exist.
- **LLM spend cursor** — a per-org DB table tracking the sync position when reading spend logs from LiteLLM's REST API.

**Key invariants:**
- Virtual keys are always scoped: `team_id = orgId`, `user_id = sessionId`.
- When `LLM_PROXY_URL` is not set, sandboxes fall back to a direct `ANTHROPIC_API_KEY` (no proxy, no spend tracking).
- When `LLM_PROXY_REQUIRED=true` and `LLM_PROXY_URL` is unset, session creation fails hard.
- The spend sync is eventually consistent — logs appear in LiteLLM's table and are polled every 30 seconds by the billing worker.

---

## 2. Core Concepts

### LiteLLM Virtual Keys
LiteLLM's virtual key system (free tier) generates temporary API keys that the proxy validates on each request. Each key carries `team_id` and `user_id` metadata, which LiteLLM uses to attribute spend.
- Key detail agents get wrong: we use virtual keys (free tier), NOT JWT auth (enterprise tier). The master key is only used for admin API calls, never passed to sandboxes.
- Reference: [LiteLLM virtual keys docs](https://docs.litellm.ai/docs/proxy/virtual_keys)

### Admin URL vs Public URL
Two separate URLs exist for the proxy: the **admin URL** for key generation and team management (requires master key, may be internal-only), and the **public URL** for sandbox LLM requests (accepts virtual keys, must be reachable from sandboxes).
- Key detail agents get wrong: `LLM_PROXY_ADMIN_URL` is optional — if unset, `LLM_PROXY_URL` is used for both admin calls and public access. `LLM_PROXY_PUBLIC_URL` controls what base URL sandboxes see.
- Reference: `packages/shared/src/llm-proxy.ts:generateVirtualKey`, `packages/shared/src/llm-proxy.ts:getLLMProxyBaseURL`

### Model Routing Configuration
The LiteLLM config (`apps/llm-proxy/litellm/config.yaml`) maps OpenCode model IDs (e.g., `anthropic/claude-sonnet-4-5`) to actual Anthropic API model IDs (often with date suffixes, e.g., `anthropic/claude-sonnet-4-5-20250929`, though some like `anthropic/claude-opus-4-6` map without a suffix). The proxy also accepts short aliases (e.g., `claude-sonnet-4-5`).
- Key detail agents get wrong: model routing is configured in `config.yaml`, not in our TypeScript code. Adding a new model requires editing the YAML config and redeploying the proxy container.
- Reference: `apps/llm-proxy/litellm/config.yaml`

### Spend Sync Architecture
Our billing worker reads spend data from LiteLLM's Admin REST API (`GET /spend/logs/v2`) per org and converts logs into billing events via bulk ledger deduction. Cursors are tracked per-org in the `llm_spend_cursors` table.
- Key detail agents get wrong: we use the REST API, not cross-schema SQL. The old `LITELLM_DB_SCHEMA` env var is no longer used.
- Reference: `packages/services/src/billing/litellm-api.ts:fetchSpendLogs`

---

## 3. File Tree

```
apps/llm-proxy/
├── Dockerfile                          # LiteLLM container image (ghcr.io/berriai/litellm)
├── README.md                           # Deployment docs, architecture diagram
└── litellm/
    └── config.yaml                     # Model routing, master key, DB URL, retry settings

packages/shared/src/
├── llm-proxy.ts                        # Virtual key generation, team management, URL helpers

packages/services/src/
├── sessions/
│   └── sandbox-env.ts                  # Calls generateSessionAPIKey during session creation
└── billing/
    ├── db.ts                           # LLM spend cursor CRUD (per-org)
    └── litellm-api.ts                  # LiteLLM Admin REST API client (GET /spend/logs/v2)

packages/environment/src/
└── schema.ts                           # LLM_PROXY_* env var definitions

packages/db/src/schema/
└── billing.ts                          # llmSpendCursors table definition

apps/worker/src/billing/
└── worker.ts                           # syncLLMSpend() — polling loop that reads spend logs

packages/shared/src/providers/
├── modal-libmodal.ts                   # Passes LLM_PROXY_API_KEY + ANTHROPIC_BASE_URL to sandbox
└── e2b.ts                             # Same key/URL injection pattern as Modal
```

---

## 4. Data Models & Schemas

### Database Tables

```sql
llm_spend_cursors (per-org)
├── organization_id TEXT PRIMARY KEY FK → organization.id (CASCADE)
├── last_start_time TIMESTAMPTZ NOT NULL               -- cursor position for REST API pagination
├── last_request_id TEXT                               -- tie-breaker for deterministic ordering
├── records_processed INTEGER DEFAULT 0                -- total records synced (monotonic)
└── synced_at       TIMESTAMPTZ DEFAULT NOW()          -- last sync timestamp
```

### Core TypeScript Types

```typescript
// packages/shared/src/llm-proxy.ts
interface VirtualKeyOptions {
  duration?: string;       // e.g., "15m", "1h", "24h"
  maxBudget?: number;      // max spend in USD
  metadata?: Record<string, unknown>;
}

interface VirtualKeyResponse {
  key: string;             // "sk-xxx" — the virtual key
  expires: string;         // ISO timestamp
  team_id: string;         // orgId
  user_id: string;         // sessionId
}

// packages/services/src/billing/litellm-api.ts
interface LiteLLMSpendLog {
  request_id: string;
  team_id: string | null;  // our orgId
  end_user: string | null; // our sessionId
  spend: number;           // cost in USD
  model: string;
  model_group: string | null;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  startTime?: string;
}

// packages/services/src/billing/db.ts
interface LLMSpendCursor {
  organizationId: string;
  lastStartTime: Date;
  lastRequestId: string | null;
  recordsProcessed: number;
  syncedAt: Date;
}
```

### Key Indexes & Query Patterns
- `llm_spend_cursors` — primary key lookup by `organization_id`. One row per active org.
- Spend logs are now fetched via LiteLLM's REST API (`GET /spend/logs/v2?team_id=...&start_date=...`), not raw SQL.

---

## 5. Conventions & Patterns

### Do
- Always call `ensureTeamExists(orgId)` before generating a virtual key — `generateSessionAPIKey` does this automatically (`packages/shared/src/llm-proxy.ts:generateSessionAPIKey`)
- Use `buildSandboxEnvVars()` from `packages/services/src/sessions/sandbox-env.ts` to generate all sandbox env vars, including the virtual key — it handles the proxy/direct key decision centrally
- Strip trailing slashes and `/v1` before appending paths to admin URLs — `generateVirtualKey` does this (`adminUrl` normalization at line 69)

### Don't
- Don't pass `LLM_PROXY_MASTER_KEY` to sandboxes — only virtual keys go to sandboxes
- Don't query LiteLLM's database directly — use the REST API client (`packages/services/src/billing/litellm-api.ts:fetchSpendLogs`)
- Don't assume `LLM_PROXY_URL` is always set — graceful fallback to direct API key is required unless `LLM_PROXY_REQUIRED=true`

### Error Handling

```typescript
// Key generation failure is fatal when proxy is configured
if (!proxyUrl) {
  if (requireProxy) {
    throw new Error("LLM proxy is required but LLM_PROXY_URL is not set");
  }
  envVars.ANTHROPIC_API_KEY = directApiKey ?? "";
} else {
  try {
    const apiKey = await generateSessionAPIKey(sessionId, orgId);
    envVars.LLM_PROXY_API_KEY = apiKey;
  } catch (err) {
    throw new Error(`LLM proxy enabled but failed to generate session key: ${message}`);
  }
}
```
_Source: `packages/services/src/sessions/sandbox-env.ts:buildSandboxEnvVars`_

### Reliability
- Team creation is idempotent — `ensureTeamExists` checks via `GET /team/info` first, handles "already exists" errors from `POST /team/new` (`packages/shared/src/llm-proxy.ts:ensureTeamExists`)
- Spend sync uses per-org cursors with `start_date` filtering via the REST API to avoid reprocessing (`packages/services/src/billing/db.ts:getLLMSpendCursor`)
- Idempotency keys (`llm:{request_id}`) on billing events prevent double-billing even if the same logs are fetched twice (`packages/services/src/billing/shadow-balance.ts:bulkDeductShadowBalance`)

### Testing Conventions
- No dedicated tests exist for the LLM proxy integration. Key generation and spend sync are verified via manual testing and production observability.
- To test locally, run LiteLLM via Docker Compose (`docker compose up -d llm-proxy`) and set `LLM_PROXY_URL=http://localhost:4000`.

---

## 6. Subsystem Deep Dives

### 6.1 Virtual Key Generation

**What it does:** Generates a short-lived LiteLLM virtual key for a sandbox session, scoped to an org for spend tracking.

**Happy path:**
1. `buildSandboxEnvVars()` is called during session creation (`packages/services/src/sessions/sandbox-env.ts`)
2. It checks if `LLM_PROXY_URL` is set. If yes, calls `generateSessionAPIKey(sessionId, orgId)` (`packages/shared/src/llm-proxy.ts:generateSessionAPIKey`)
3. `generateSessionAPIKey` first calls `ensureTeamExists(orgId)` — `GET /team/info?team_id={orgId}` to check, then `POST /team/new` if needed (`packages/shared/src/llm-proxy.ts:ensureTeamExists`)
4. When billing is enabled, fetches org's `shadow_balance` via `getBillingInfoV2`, computes `maxBudget = Math.max(0, shadow_balance * 0.01)` (`packages/services/src/sessions/sandbox-env.ts:buildSandboxEnvVars`)
5. Calls `generateVirtualKey(sessionId, orgId, { maxBudget })` — `POST /key/generate` with `team_id=orgId`, `user_id=sessionId`, `key_alias=sessionId`, `max_budget`, `duration` from env (`packages/shared/src/llm-proxy.ts:generateVirtualKey`)
6. Returns the `key` string. The caller stores it as `envVars.LLM_PROXY_API_KEY`

**Edge cases:**
- `LLM_PROXY_URL` unset + `LLM_PROXY_REQUIRED=false` → falls back to direct `ANTHROPIC_API_KEY`
- `LLM_PROXY_URL` unset + `LLM_PROXY_REQUIRED=true` → throws, blocking session creation
- Team creation race condition → `ensureTeamExists` tolerates "already exists" / "duplicate" errors
- Key generation failure → throws, blocking session creation (no silent fallback when proxy is configured)

**Files touched:** `packages/shared/src/llm-proxy.ts`, `packages/services/src/sessions/sandbox-env.ts`

**Status:** Implemented

### 6.2 Sandbox Key Injection

**What it does:** Passes the virtual key and proxy base URL to the sandbox so OpenCode routes LLM requests through the proxy.

**Happy path:**
1. Provider reads `opts.envVars.LLM_PROXY_API_KEY` (set by `buildSandboxEnvVars`) and calls `getLLMProxyBaseURL()` (`packages/shared/src/llm-proxy.ts:getLLMProxyBaseURL`)
2. `getLLMProxyBaseURL()` returns `LLM_PROXY_PUBLIC_URL || LLM_PROXY_URL` normalized with `/v1` suffix
3. Provider sets two env vars on the sandbox: `ANTHROPIC_API_KEY = virtualKey`, `ANTHROPIC_BASE_URL = proxyBaseUrl`
4. OpenCode inside the sandbox uses these standard env vars to route all Anthropic API calls through the proxy
5. The same env vars are set again as process-level env when launching the OpenCode server (after `setupEssentialDependencies` writes config files)

**Edge cases:**
- No proxy configured → `ANTHROPIC_API_KEY` is set to the direct key, `ANTHROPIC_BASE_URL` is not set
- E2B snapshot resume → proxy vars (`ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`) are **excluded** from the shell profile re-injection and only passed as process-level env vars to the OpenCode server process via `envs: opencodeEnv`. Other env vars are re-exported to the shell. (`packages/shared/src/providers/e2b.ts:createSandbox`, lines ~182-189 and ~646-659)

**Files touched:** `packages/shared/src/providers/modal-libmodal.ts:createSandbox`, `packages/shared/src/providers/e2b.ts:createSandbox`, `packages/shared/src/llm-proxy.ts:getLLMProxyBaseURL`

**Status:** Implemented

### 6.3 LLM Spend Sync

**What it does:** Periodically reads LLM spend logs from LiteLLM's REST API and converts them into billing events for Proliferate's billing system via bulk ledger deduction.

**Happy path:**
1. Billing worker calls `syncLLMSpend()` every 30 seconds, guarded by `NEXT_PUBLIC_BILLING_ENABLED` and `LLM_PROXY_ADMIN_URL` (`apps/worker/src/billing/worker.ts`)
2. Lists all billable orgs (billing state in `active`, `trial`, or `grace`) via `billing.listBillableOrgIds()` (`packages/services/src/billing/db.ts`)
3. For each org:
   a. Reads per-org cursor — `billing.getLLMSpendCursor(orgId)` (`packages/services/src/billing/db.ts`)
   b. Fetches spend logs via REST API — `billing.fetchSpendLogs(orgId, startDate)` (`packages/services/src/billing/litellm-api.ts`)
   c. Filters logs with positive `spend`, converts to `BulkDeductEvent[]` using `calculateLLMCredits(spend)` with idempotency key `llm:{request_id}`
   d. Calls `billing.bulkDeductShadowBalance(orgId, events)` — single transaction: locks org row, bulk inserts billing events, deducts total from shadow balance (`packages/services/src/billing/shadow-balance.ts`)
   e. Updates cursor to latest log's `startTime` — `billing.updateLLMSpendCursor()` (`packages/services/src/billing/db.ts`)
4. Handles state transitions: if `shouldPauseSessions`, calls `billing.enforceCreditsExhausted(orgId)`

**Edge cases:**
- First run for an org (no cursor) → starts from 5-minute lookback window (`now - 5min`)
- No logs returned → cursor is not advanced (no-op for that org)
- Duplicate logs → `bulkDeductShadowBalance` uses `ON CONFLICT (idempotency_key) DO NOTHING`, duplicates are silently skipped
- REST API failure for one org → logged and skipped; other orgs continue; retried next cycle
- `LLM_PROXY_ADMIN_URL` not set → entire sync is skipped (no proxy configured)

**Files touched:** `apps/worker/src/billing/worker.ts:syncLLMSpend`, `packages/services/src/billing/db.ts`, `packages/services/src/billing/litellm-api.ts`, `packages/services/src/billing/shadow-balance.ts`

**Status:** Implemented

### 6.4 Synchronous Key Revocation

**What it does:** Revokes a session's virtual key when the session is terminated, paused, or exhausted.

**Happy path:**
1. A session ends (user pause, billing termination, or credit exhaustion)
2. The caller invokes `revokeVirtualKey(sessionId)` as fire-and-forget after `provider.terminate()` (`packages/shared/src/llm-proxy.ts:revokeVirtualKey`)
3. `revokeVirtualKey` calls `POST /key/delete` with `{ key_aliases: [sessionId] }` — the alias was set during key generation via `key_alias: sessionId`
4. 404 responses are treated as success (key already deleted or expired)

**Edge cases:**
- Proxy not configured (`LLM_PROXY_URL` unset) → returns immediately, no-op
- Master key missing → returns immediately, no-op
- Network failure → error is caught and logged at debug level by callers; does not block session termination

**Call sites:**
- `apps/web/src/server/routers/sessions-pause.ts:pauseSessionHandler` — after snapshot + terminate
- `packages/services/src/billing/org-pause.ts:enforceCreditsExhausted` — per-session during exhaustion enforcement
- `packages/services/src/billing/org-pause.ts:terminateAllOrgSessions` — per-session during bulk termination

**Files touched:** `packages/shared/src/llm-proxy.ts:revokeVirtualKey`, `apps/web/src/server/routers/sessions-pause.ts`, `packages/services/src/billing/org-pause.ts`

**Status:** Implemented

### 6.5 Environment Configuration

**What it does:** Six env vars control the LLM proxy integration.

| Env Var | Required | Default | Purpose |
|---------|----------|---------|---------|
| `LLM_PROXY_URL` | No | — | Base URL of the LiteLLM proxy. When set, enables proxy mode. |
| `LLM_PROXY_ADMIN_URL` | No | `LLM_PROXY_URL` | Separate admin URL for key/team management and REST API spend queries. Falls back to `LLM_PROXY_URL`. |
| `LLM_PROXY_PUBLIC_URL` | No | `LLM_PROXY_URL` | Public-facing URL that sandboxes use. Falls back to `LLM_PROXY_URL`. |
| `LLM_PROXY_MASTER_KEY` | When proxy is enabled | — | Master key for LiteLLM admin API (key generation, team management, spend queries). |
| `LLM_PROXY_KEY_DURATION` | No | `"24h"` | Default virtual key validity duration. Supports LiteLLM duration strings. |
| `LLM_PROXY_REQUIRED` | No | `false` | When `true`, session creation fails if proxy is not configured. |

The spend sync uses `LLM_PROXY_ADMIN_URL` and `LLM_PROXY_MASTER_KEY` (same vars as key generation) to call `GET /spend/logs/v2`. No additional env vars are required.

**Files touched:** `packages/environment/src/schema.ts` (LLM_PROXY_* vars), `packages/shared/src/llm-proxy.ts`, `packages/services/src/billing/litellm-api.ts`

**Status:** Implemented

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| Sandbox Providers | Providers → This | `getLLMProxyBaseURL()`, reads `envVars.LLM_PROXY_API_KEY` | Both Modal and E2B inject the virtual key and base URL at sandbox boot. See `sandbox-providers.md` §6. |
| Sessions | Sessions → This | `buildSandboxEnvVars()` → `generateSessionAPIKey()` | Session creation triggers key generation. See `sessions-gateway.md` §6. |
| Billing & Metering | Billing → This | `syncLLMSpend()` calls `fetchSpendLogs()` REST API, writes `billing_events` via `bulkDeductShadowBalance()` | Billing worker polls spend data per org. Charging policy owned by `billing-metering.md`. |
| Environment | This → Environment | `env.LLM_PROXY_*` | Typed `LLM_PROXY_*` vars read from env schema (`packages/environment/src/schema.ts`). |

### Security & Auth
- The master key (`LLM_PROXY_MASTER_KEY`) is never exposed to sandboxes — it stays server-side for admin API calls only.
- Virtual keys are the only credential sandboxes receive. They are short-lived (default 24h) and scoped to a single session.
- The master key authenticates all admin API calls via `Authorization: Bearer {masterKey}` header.
- Sandbox env vars filter out `LLM_PROXY_API_KEY`, `ANTHROPIC_API_KEY`, and `ANTHROPIC_BASE_URL` from the pass-through env loop to prevent double-setting or leaking the real key when proxy is active (`packages/shared/src/providers/modal-libmodal.ts:createSandbox`, `packages/shared/src/providers/e2b.ts:createSandbox`).

### Observability
- Key generation latency is logged at debug level: `"Generated LLM proxy session key"` with `durationMs` (`packages/services/src/sessions/sandbox-env.ts`)
- Spend sync logs totals: `"Synced LLM spend logs"` with `totalProcessed` and `batchCount` (`apps/worker/src/billing/worker.ts`)
- Key generation failures log at error level before throwing (`packages/services/src/sessions/sandbox-env.ts`)

---

## 8. Acceptance Gates

- [ ] Typecheck passes
- [ ] Relevant tests pass
- [ ] This spec is updated (file tree, data models, deep dives)
- [ ] LLM proxy env vars documented in environment schema if added/changed
- [ ] Virtual key duration and scoping unchanged unless explicitly approved

---

## 9. Known Limitations & Tech Debt

- [x] ~~**No key revocation on session end**~~ — Resolved. `revokeVirtualKey(sessionId)` is called fire-and-forget on session pause, exhaustion, and bulk termination.
- [x] ~~**Shared database coupling**~~ — resolved. Spend sync now uses LiteLLM's REST API (`GET /spend/logs/v2`) via `litellm-api.ts` instead of cross-schema SQL.
- [x] ~~**Single global cursor**~~ — resolved. Cursors are now per-org (`llm_spend_cursors` table keyed by `organization_id`).
- [x] ~~**No budget enforcement on virtual keys**~~ — Resolved. `buildSandboxEnvVars` fetches `shadow_balance` when billing is enabled and passes `maxBudget = Math.max(0, shadow_balance * 0.01)` to `generateVirtualKey`.


---
# FILE: docs/specs/repos-prebuilds.md
---

# Repos & Prebuilds — System Spec

## 1. Scope & Purpose

### In Scope
- Repo CRUD, search (public GitHub), and available repos (via integration)
- Repo connections (binding repos to GitHub integrations)
- Prebuild CRUD (manual, managed, and CLI types)
- Prebuild-repo associations (many-to-many via `prebuild_repos`)
- Effective service commands resolution (prebuild overrides > repo defaults)
- Legacy prebuild-level connector persistence for gateway-mediated MCP action sources (transitional; migrating to org scope)
- Base snapshot build worker (queue, deduplication, status tracking)
- Configuration snapshot build worker (GitHub token hierarchy, multi-repo cloning)
- Prebuild resolver (resolves prebuild at session start)
- Service commands persistence (JSONB on both repos and prebuilds)
- Env file persistence (JSONB on prebuilds)
- Base snapshot status tracking (building/ready/failed)
- Configuration snapshot status tracking (building/default/ready/failed on configurations table)
- Setup session finalization (snapshot capture + prebuild creation/update)

### Out of Scope
- Snapshot resolution logic (which layer to use at boot) — see `sandbox-providers.md` §6.5
- Session creation that uses prebuilds — see `sessions-gateway.md` §6.1
- Secret values, bundles, and encryption — see `secrets-environment.md`
- Integration OAuth lifecycle — see `integrations.md`
- Org-scoped connector catalog lifecycle and management UI — see `integrations.md`
- Sandbox boot sequence that consumes service commands/env files — see `sandbox-providers.md` §6.4

### Mental Model

**Repos** are org-scoped references to GitHub repositories (or local directories for CLI). They carry metadata (URL, default branch, detected stack) and optional repo-level service commands. Each repo can be linked to one or more GitHub integrations via **repo connections**, which provide the authentication tokens needed for private repo access.

**Prebuilds** group one or more repos (via `prebuild_repos` junction), carry a snapshot ID (saved filesystem state), and store per-prebuild service commands and env file specs. There are three prebuild types: `manual` (user-created), `managed` (auto-created for Slack/universal clients), and CLI (device-scoped via `localPathHash`).

Connector configuration currently exists on prebuilds as a legacy transitional model, consumed by the gateway Actions path (not direct sandbox-native invocation). Planned direction is org-scoped connector catalog ownership in `integrations.md`.

**Snapshots** are pre-built filesystem states at three layers: base (OpenCode + services, no repo), configuration (base + all configuration repos cloned), and finalized (full working state after user setup). This spec owns the *build* side — the workers that create base and configuration snapshots. The *resolution* side (picking which layer to use) belongs to `sandbox-providers.md`.

**Core entities:**
- **Repo** — an org-scoped GitHub repository reference. Lifecycle: create → configure → delete. Every new repo gets an auto-created single-repo configuration via `createRepoWithConfiguration()`.
- **Prebuild** — a reusable snapshot + metadata record linking one or more repos. Lifecycle: building → default → ready/failed.
- **Base snapshot** — a pre-baked sandbox state with OpenCode + services installed, no repo (Layer 1). Built by the base snapshot worker, tracked in `sandbox_base_snapshots`.
- **Configuration snapshot** — a base snapshot + all configuration repos cloned (Layer 2). Built by the configuration snapshot worker, tracked on the `configurations` table (`snapshot_id`, `status`, `error`). Status lifecycle: `"building"` → `"default"` (auto-built) or `"failed"`. User finalization: `"default"` → `"ready"`.

**Key invariants:**
- On the happy path, a prebuild has at least one repo via `prebuild_repos`. Exceptions: CLI prebuild creation treats the repo link as non-fatal (`prebuild-resolver.ts:272`) — a prebuild can briefly exist without `prebuild_repos` if the upsert fails. Setup finalization derives `workspacePath` from `githubRepoName` (e.g., `"org/app"` → `"app"`), not `"."` (`configurations-finalize.ts:166`). The standard service path (`createPrebuild`) uses `"."` for single-repo and repo name for multi-repo.
- Base snapshot deduplication is keyed on `(versionKey, provider, modalAppName)`. Only one build runs per combination.
- Configuration snapshot builds are Modal-only. E2B sessions skip this layer.
- Configuration creation is tightly coupled to snapshot building — `createConfiguration()` always enqueues a snapshot build job via `requestConfigurationSnapshotBuild()`. Any future code creating a configuration with `status: "building"` must also trigger snapshot building.
- Service commands resolution follows a clear precedence: prebuild-level overrides win; if empty, per-repo defaults are merged with workspace context.

---

## 2. Core Concepts

### Prebuild Types
Three types determine how a prebuild is created and scoped: `manual` (user-created via UI, explicit repo selection), `managed` (auto-created for Slack/universal clients, includes all org repos or specific subset), `cli` (device-scoped, identified by `userId` + `localPathHash`). The `type` column stores these as `"manual"`, `"managed"`, or `"cli"`. CLI prebuilds are created with `status: "pending"` (`packages/services/src/cli/db.ts:558`), while manual/managed start as `"building"`.
- Key detail agents get wrong: Managed prebuilds use `type = "managed"` in the DB, not a flag. The resolver checks this type to find existing managed prebuilds before creating new ones.
- Reference: `packages/db/src/schema/prebuilds.ts`, `apps/gateway/src/lib/prebuild-resolver.ts`

### Workspace Path
Determines where each repo is cloned inside the sandbox. Single-repo prebuilds always use `"."` (repo is the workspace root). Multi-repo prebuilds derive the path from the last segment of `githubRepoName` (e.g., `"org/my-app"` → `"my-app"`).
- Key detail agents get wrong: Workspace path is set at prebuild creation time, not dynamically. Changing it requires recreating the `prebuild_repos` entry.
- Reference: `packages/services/src/prebuilds/service.ts:createPrebuild`

### Snapshot Version Key
A SHA-256 hash of `PLUGIN_MJS` + `DEFAULT_CADDYFILE` + `getOpencodeConfig(defaultModelId)` + `SANDBOX_IMAGE_VERSION` (fallback `"v1.0.0"`). When this changes, the base snapshot is stale and must be rebuilt. Computed by `computeBaseSnapshotVersionKey()`.
- Key detail agents get wrong: The version key includes both source constants and an explicit runtime cache-buster. Changing `PLUGIN_MJS`, the Caddyfile template, OpenCode config, or `SANDBOX_IMAGE_VERSION` triggers a rebuild.
- Reference: `packages/shared/src/sandbox/version-key.ts`

### Prebuild Connector Config (Deprecated — Migrated to Org Scope)
Connector-backed tool access has been migrated from prebuild-scoped JSONB (`prebuilds.connectors`) to org-scoped relational storage (`org_connectors` table). The gateway now loads connectors by organization, not by prebuild. Legacy JSONB columns remain in the schema for data preservation but are no longer read at runtime.
- Key detail agents get wrong: connector CRUD and management UI are now in `integrations.md` scope. The prebuild router no longer has connector routes.
- Key detail agents get wrong: the backfill migration (`0022_org_connectors.sql`) copied prebuild connectors to `org_connectors`, deduplicating by `(organization_id, url, name)`.
- Reference: `docs/specs/integrations.md`, `packages/services/src/connectors/`

### GitHub Token Hierarchy
Configuration snapshot builds resolve GitHub tokens per-repo with a two-level hierarchy: (1) repo-linked integration connections (prefer GitHub App installation, fall back to Nango OAuth), (2) org-wide GitHub integration. Private repos without a token cause the build to fail.
- Key detail agents get wrong: The token resolution in the snapshot worker is independent from the session-time token resolution in the gateway. They follow the same hierarchy but are separate code paths.
- Reference: `apps/worker/src/github-token.ts:resolveGitHubToken`

---

## 3. File Tree

```
apps/web/src/server/routers/
├── repos.ts                         # Repo oRPC routes (list/get/create/delete/search/available/finalize)
├── configurations-finalize.ts       # Setup session finalization (snapshot + configuration update/create)
└── prebuilds.ts                     # Prebuild oRPC routes (list/create/update/delete/service-commands)

apps/web/src/components/coding-session/
└── settings-panel.tsx               # Settings panel (Info, Snapshots, Auto-start tabs)

apps/worker/src/
├── base-snapshots/
│   └── index.ts                     # Base snapshot build worker + startup enqueue
├── configuration-snapshots/
│   └── index.ts                     # Configuration snapshot build worker (multi-repo)
└── github-token.ts                  # Shared GitHub token resolution utility

apps/gateway/src/lib/
└── prebuild-resolver.ts             # Prebuild resolution for session creation (direct/managed/CLI)

packages/services/src/
├── repos/
│   ├── db.ts                        # Repo DB operations (CRUD, snapshot status, service commands)
│   ├── mapper.ts                    # DB row → API type conversion
│   └── service.ts                   # Repo business logic (create with auto-configuration, service commands)
├── prebuilds/
│   ├── db.ts                        # Prebuild DB operations (CRUD, junction, managed, service commands)
│   ├── mapper.ts                    # DB row → API type conversion
│   └── service.ts                   # Prebuild business logic (create with workspace paths, effective commands)
└── base-snapshots/
    ├── db.ts                        # Base snapshot DB operations (find/insert/mark status)
    └── service.ts                   # Base snapshot business logic (isBuildNeeded, startBuild)

packages/db/src/schema/
├── repos.ts                         # repos table (Drizzle relations, re-exports from schema.ts)
├── prebuilds.ts                     # prebuilds + prebuild_repos tables (Drizzle relations)
└── schema.ts                        # Full schema definitions (repos, prebuilds, sandbox_base_snapshots)

packages/queue/src/
└── index.ts                         # BullMQ queue/worker factories for base + configuration snapshot builds
```

---

## 4. Data Models & Schemas

### Database Tables

```sql
repos
├── id                         UUID PRIMARY KEY
├── organization_id            TEXT NOT NULL (FK → organization, CASCADE)
├── github_url                 TEXT NOT NULL
├── github_repo_id             TEXT NOT NULL
├── github_repo_name           TEXT NOT NULL
├── default_branch             TEXT DEFAULT 'main'
├── setup_commands             TEXT[]
├── detected_stack             JSONB
├── is_orphaned                BOOLEAN DEFAULT false
├── is_private                 BOOLEAN DEFAULT false
├── added_by                   TEXT (FK → user)
├── source                     TEXT DEFAULT 'github'  -- 'github' | 'local'
├── local_path_hash            TEXT                   -- non-null when source='local' (CHECK)
├── repo_snapshot_id           TEXT                   -- inline Layer 2 snapshot
├── repo_snapshot_status       TEXT                   -- 'building' | 'ready' | 'failed'
├── repo_snapshot_error        TEXT
├── repo_snapshot_commit_sha   TEXT
├── repo_snapshot_built_at     TIMESTAMPTZ
├── repo_snapshot_provider     TEXT
├── service_commands           JSONB                  -- repo-level service commands
├── service_commands_updated_at TIMESTAMPTZ
├── service_commands_updated_by TEXT
├── created_at                 TIMESTAMPTZ
└── updated_at                 TIMESTAMPTZ
    UNIQUE(organization_id, github_repo_id)
    CHECK: source='local' → local_path_hash IS NOT NULL

prebuilds
├── id                         UUID PRIMARY KEY
├── snapshot_id                TEXT                   -- NULL = being set up
├── sandbox_provider           TEXT DEFAULT 'modal'
├── status                     TEXT DEFAULT 'building'  -- 'pending' | 'building' | 'ready' | 'failed'
├── error                      TEXT
├── type                       TEXT DEFAULT 'manual'    -- 'manual' | 'managed' | 'cli'
├── name                       TEXT NOT NULL
├── notes                      TEXT
├── created_by                 TEXT (FK → user)
├── user_id                    TEXT (FK → user, CASCADE) -- CLI prebuilds
├── local_path_hash            TEXT                     -- CLI prebuilds
├── service_commands           JSONB
├── service_commands_updated_at TIMESTAMPTZ
├── service_commands_updated_by TEXT
├── env_files                  JSONB
├── env_files_updated_at       TIMESTAMPTZ
├── env_files_updated_by       TEXT
├── connectors                 JSONB                  -- legacy connector configs (gateway-mediated MCP)
├── connectors_updated_at      TIMESTAMPTZ
├── connectors_updated_by      TEXT
└── created_at                 TIMESTAMPTZ
    UNIQUE(user_id, local_path_hash)  -- CLI constraint

prebuild_repos
├── prebuild_id                UUID NOT NULL (FK → prebuilds, CASCADE)
├── repo_id                    UUID NOT NULL (FK → repos, CASCADE)
├── workspace_path             TEXT NOT NULL  -- '.' for single repo, repo name for multi
└── created_at                 TIMESTAMPTZ
    PK(prebuild_id, repo_id)

repo_connections
├── id                         UUID PRIMARY KEY
├── repo_id                    UUID NOT NULL (FK → repos, CASCADE)
├── integration_id             UUID NOT NULL (FK → integrations, CASCADE)
└── created_at                 TIMESTAMPTZ
    UNIQUE(repo_id, integration_id)

sandbox_base_snapshots
├── id                         UUID PRIMARY KEY
├── version_key                TEXT NOT NULL
├── snapshot_id                TEXT
├── status                     TEXT DEFAULT 'building'  -- CHECK: building/ready/failed
├── error                      TEXT
├── provider                   TEXT DEFAULT 'modal'
├── modal_app_name             TEXT NOT NULL
├── built_at                   TIMESTAMPTZ
├── created_at                 TIMESTAMPTZ
└── updated_at                 TIMESTAMPTZ
    UNIQUE(version_key, provider, modal_app_name)
```

### Core TypeScript Types

```typescript
// packages/services/src/prebuilds/service.ts
interface CreatePrebuildInput {
  organizationId: string;
  userId: string;
  repoIds: string[];
  name?: string;
}

interface EffectiveServiceCommandsResult {
  source: "prebuild" | "repo" | "none";
  commands: PrebuildServiceCommand[];
  workspaces: string[];
}

// packages/shared/src/connectors.ts
interface ConnectorConfig {
  id: string;                 // UUID (prebuild-local identity)
  name: string;               // display label
  transport: "remote_http";   // V1 scope
  url: string;                // MCP endpoint
  auth: { type: "bearer" | "custom_header"; secretKey: string; headerName?: string };
  riskPolicy?: { defaultRisk?: "read" | "write" | "danger"; overrides?: Record<string, "read" | "write" | "danger"> };
  enabled: boolean;
}

// apps/gateway/src/lib/prebuild-resolver.ts
interface ResolvedPrebuild {
  id: string;
  snapshotId: string | null;
  repoIds: string[];
  isNew: boolean;
}

// packages/queue/src/index.ts
interface BaseSnapshotBuildJob {
  versionKey: string;
  provider: string;
  modalAppName: string;
}

interface ConfigurationSnapshotBuildJob {
  configurationId: string;
  force?: boolean;
}
```

### Key Indexes
- `idx_repos_org` on `organization_id` — org-scoped listing
- `idx_repos_local_path_hash` on `local_path_hash` (filtered: not null) — CLI repo lookup
- `idx_repos_repo_snapshot_status` on `repo_snapshot_status` — snapshot build queries
- `idx_prebuilds_type_managed` on `type` — managed prebuild lookups
- `idx_prebuild_repos_prebuild` / `idx_prebuild_repos_repo` on junction table FKs
- `idx_sandbox_base_snapshots_status` on `status` — build status queries
- `idx_sandbox_base_snapshots_version_provider_app` (unique) — deduplication

---

## 5. Conventions & Patterns

### Do
- Use the services layer (`packages/services/src/repos/`, `packages/services/src/prebuilds/`) for all DB access. Routes should call service functions, not query DB directly.
- Use `prebuildBelongsToOrg()` for authorization — it checks via `prebuild_repos → repos → organization_id`.
- Use `getEffectiveServiceCommands()` to resolve the final command set, not raw `serviceCommands` fields.
- Use BullMQ job ID for deduplication. Base snapshot builds key on `base-snapshot:{provider}:{appName}:{versionKey}`.

### Don't
- Don't import `@proliferate/db` directly in routes — go through services.
- Don't assume repo snapshots work on E2B — they are Modal-only.
- Don't read `serviceCommands` directly from the prebuild record to get the final commands — always resolve via `getEffectiveServiceCommands()`.

### Error Handling
Services throw errors (not error objects). Routes catch and map to `ORPCError` with appropriate codes:
```typescript
// apps/web/src/server/routers/prebuilds.ts
if (message === "One or more repos not found") {
  throw new ORPCError("NOT_FOUND", { message });
}
```

### Reliability
- **Base snapshot builds**: 3 attempts, exponential backoff (10s initial). Concurrency: 1. `insertBuilding()` uses `ON CONFLICT DO NOTHING` for concurrent workers.
- **Configuration snapshot builds**: 3 attempts, exponential backoff (5s initial). Concurrency: 2. Timestamp-based job IDs prevent failed jobs from blocking future rebuilds. Skips if configuration already has status `"default"` or `"ready"` with a `snapshotId` (unless `force`).
- **Idempotency**: `updateSnapshotIdIfNull()` only sets snapshot ID if currently null.

### Testing Conventions
- No dedicated tests exist for repos, prebuilds, or snapshot build services/workers today. Coverage comes indirectly from route-level and integration tests.
- `prebuildBelongsToOrg()` and `getEffectiveServiceCommands()` are pure query logic — good candidates for unit tests with DB fixtures.
- Snapshot build workers would require Modal credentials for integration testing.

---

## 6. Subsystem Deep Dives

### 6.1 Repo CRUD — `Implemented`

**What it does:** Manages org-scoped GitHub repository references.

**Happy path (create)** (`packages/services/src/repos/service.ts:createRepoWithConfiguration`):
1. Call `createRepo()`: check if repo exists by `(organizationId, githubRepoId)`.
2. If exists: link integration (if provided), un-orphan if needed, return existing.
3. If new: generate UUID, insert record, link integration.
4. Auto-create a single-repo configuration via `configurations.createConfiguration()`, which is tightly coupled to snapshot building — it always enqueues a `CONFIGURATION_SNAPSHOT_BUILDS` job.

**Other operations:**
- `listRepos(orgId)` returns repos with prebuild status computed by `mapper.ts:toRepo` (joins prebuild data).
- `deleteRepo(id, orgId)` hard-deletes; cascades remove `prebuild_repos`, `repo_connections`, and `secrets`.
- `search(q)` hits GitHub public API. Exact `owner/repo` format does direct lookup; otherwise uses search API (`per_page=10`, sorted by stars, public repos only).
- `available(integrationId?)` lists repos accessible via a GitHub App or Nango OAuth connection.

**Files touched:** `packages/services/src/repos/service.ts`, `apps/web/src/server/routers/repos.ts`

### 6.2 Repo Connections — `Implemented`

**What it does:** Links repos to GitHub integrations for private repo access.

**Mechanism:** `repo_connections` is a junction table binding `repo_id` to `integration_id`. Created during `createRepo()` if `integrationId` is provided. Uses upsert (`ON CONFLICT DO NOTHING`) to handle duplicate connections gracefully (`packages/services/src/repos/db.ts:createConnection`).

**Usage:** Repo snapshot builds and session creation resolve GitHub tokens by querying `repo_connections` → `integrations` to find active GitHub App installations or Nango OAuth connections.

**Files touched:** `packages/db/src/schema/integrations.ts:repoConnections`, `packages/services/src/repos/db.ts:createConnection`

### 6.3 Prebuild CRUD — `Implemented`

**What it does:** Manages prebuild records with repo associations.

**Create** (`packages/services/src/prebuilds/service.ts:createPrebuild`):
1. Validate all `repoIds` exist and belong to the same organization.
2. Generate UUID, insert prebuild with `status: "building"`.
3. Compute workspace paths: `"."` for single repo, repo name (last segment of `githubRepoName`) for multi-repo.
4. Insert `prebuild_repos` entries. Rollback (delete prebuild) on failure.

**Update:** Name and notes only (`packages/services/src/prebuilds/service.ts:updatePrebuild`).

**Delete:** Hard-delete; cascades remove `prebuild_repos` (`packages/services/src/prebuilds/db.ts:deleteById`).

**List:** Filters by org via `prebuild_repos → repos → organizationId`, optionally by status. Returns prebuilds with associated repos and setup sessions (`packages/services/src/prebuilds/service.ts:listPrebuilds`).

**Authorization:** `prebuildBelongsToOrg(prebuildId, orgId)` traverses `prebuild_repos → repos` to verify org membership.

**Files touched:** `packages/services/src/prebuilds/service.ts`, `apps/web/src/server/routers/prebuilds.ts`

### 6.4 Service Commands Resolution — `Implemented`

**What it does:** Resolves the effective set of auto-start commands for a prebuild by merging prebuild-level overrides with repo-level defaults.

**Resolution logic** (`packages/services/src/prebuilds/service.ts:getEffectiveServiceCommands`):
1. If prebuild has non-empty `serviceCommands` → return them (source: `"prebuild"`).
2. Otherwise, for each repo in the prebuild, get repo-level `serviceCommands` and annotate with `workspacePath` → return merged set (source: `"repo"`).
3. If no commands anywhere → return empty (source: `"none"`).

**Return shape:** `{ source: "prebuild" | "repo" | "none", commands: PrebuildServiceCommand[], workspaces: string[] }`.

**Persistence:** Service commands are stored as JSONB on both `repos.service_commands` and `prebuilds.service_commands`. Updates track `updatedBy` (user ID) and `updatedAt` timestamps.

**Files touched:** `packages/services/src/prebuilds/service.ts`, `apps/web/src/server/routers/prebuilds.ts`, `apps/web/src/server/routers/repos.ts`

### 6.5 Base Snapshot Build Worker — `Implemented`

**What it does:** Builds reusable base sandbox snapshots (Layer 1) so new sessions start without relying on `MODAL_BASE_SNAPSHOT_ID` env var.

**Happy path** (`apps/worker/src/base-snapshots/index.ts`):
1. On worker startup, `enqueueIfNeeded()` computes the current version key and checks `baseSnapshots.isBuildNeeded()`.
2. If needed, enqueues a `BASE_SNAPSHOT_BUILDS` job with `jobId` = `base-snapshot:{provider}:{appName}:{versionKey[:16]}` for deduplication.
3. Worker picks up job, calls `baseSnapshots.startBuild()` — inserts a `"building"` record (idempotent via `ON CONFLICT DO NOTHING`).
4. If `alreadyReady` → skip. Otherwise, calls `ModalLibmodalProvider.createBaseSnapshot()`.
5. On success: `baseSnapshots.completeBuild(id, snapshotId)`. On failure: `baseSnapshots.failBuild(id, error)` + rethrow for BullMQ retry.

**Deduplication:** Unique DB constraint on `(versionKey, provider, modalAppName)` prevents duplicate records. BullMQ `jobId` prevents duplicate jobs.

**Files touched:** `apps/worker/src/base-snapshots/index.ts`, `packages/services/src/base-snapshots/service.ts`

### 6.6 Configuration Snapshot Build Worker — `Implemented`

**What it does:** Builds configuration snapshots (Layer 2) — base snapshot + all configuration repos cloned — for near-zero latency session starts.

**Happy path** (`apps/worker/src/configuration-snapshots/index.ts`):
1. Load configuration info via `configurations.getConfigurationSnapshotBuildInfo(configurationId)`.
2. Skip if already `"default"` or `"ready"` with `snapshotId` (unless `force`).
3. Mark `"building"` via `configurations.markConfigurationSnapshotBuilding(configurationId)`.
4. For each repo in the configuration: resolve GitHub token (see §2: GitHub Token Hierarchy). Fail if private repo lacks token.
5. Call `ModalLibmodalProvider.createConfigurationSnapshot({ configurationId, repos, branch })`.
6. On success: `configurations.markConfigurationSnapshotDefault(configurationId, snapshotId)`.
7. On failure: `configurations.markConfigurationSnapshotFailed(configurationId, error)` + rethrow for retry.

**Trigger:** Automatically enqueued when a configuration is created via `requestConfigurationSnapshotBuild()` (fire-and-forget, tightly coupled to `createConfiguration()`). Also triggered by managed configuration creation. Uses timestamp-based job IDs to avoid stale deduplication.

**Modal-only:** `requestConfigurationSnapshotBuild()` checks `env.MODAL_APP_NAME` — returns early if not configured.

**Files touched:** `apps/worker/src/configuration-snapshots/index.ts`, `apps/worker/src/github-token.ts`, `packages/services/src/configurations/service.ts:requestConfigurationSnapshotBuild`

### 6.7 Prebuild Resolver — `Implemented`

**What it does:** Resolves a prebuild record for session creation. Owned by the gateway; documented here because it creates prebuild and repo records via this spec's services.

The resolver supports three modes (direct ID, managed, CLI) and returns a `ResolvedPrebuild { id, snapshotId, repoIds, isNew }`. For the full resolution flow and how it fits into session creation, see `sessions-gateway.md` §6.1.

**This spec's role:** The resolver calls `prebuilds.findById()`, `prebuilds.createManagedPrebuild()`, `prebuilds.createPrebuildRepos()`, and `cli.createCliPrebuildPending()` from the services layer to create/query prebuild records. The managed path derives workspace paths using the same single-repo `"."` / multi-repo repo-name convention as `createPrebuild()`.

**Files touched:** `apps/gateway/src/lib/prebuild-resolver.ts`

### 6.8 Setup Session Finalization — `Implemented`

**What it does:** Captures a sandbox snapshot from a setup session and updates/creates a configuration snapshot record.

**Happy path** (`apps/web/src/server/routers/configurations-finalize.ts:finalizeSetupHandler`):
1. Verify session exists and belongs to the repo (via `session.repoId` or `configuration_repos`).
2. Verify session type is `"setup"` and has a sandbox.
3. Take filesystem snapshot via provider (`provider.snapshot(sessionId, sandboxId)`).
4. Store any provided secrets (encryption details — see `secrets-environment.md`).
5. If existing configuration (`updateSnapshotId` or `session.configurationId`): update with new `snapshotId` + `status: "ready"`.
6. If no existing configuration: create a new configuration, create `configuration_repos` link for the repo, and update session `configurationId`.
7. Optionally terminate sandbox and stop session (lifecycle details — see `sessions-gateway.md`).

**Files touched:** `apps/web/src/server/routers/configurations-finalize.ts`

### 6.9 Env File Persistence — `Implemented`

**What it does:** Stores env file generation specs as JSONB on the prebuild record.

**Mechanism:** `prebuilds.env_files` stores a JSON spec describing which env files to generate and their template variables. Updated via `updatePrebuildEnvFiles()` with `updatedBy` + `updatedAt` tracking. At sandbox boot, the provider passes env files to `proliferate env apply` inside the sandbox (see `sandbox-providers.md` §6.4).

**Files touched:** `packages/services/src/prebuilds/db.ts:updatePrebuildEnvFiles`, `packages/db/src/schema/prebuilds.ts`

### 6.10 Prebuild Connector Persistence — `Deprecated` (Migrated to Org Scope)

**What it did:** Previously stored prebuild-scoped connector definitions in `prebuilds.connectors` JSONB. This has been migrated to org-scoped storage in the `org_connectors` table (owned by `integrations.md`).

**Migration:** Backfill migration `0022_org_connectors.sql` copied connector configs from `prebuilds.connectors` to `org_connectors`, deduplicating by `(organization_id, url, name)`. Legacy JSONB columns remain in the schema but are no longer read at runtime.

**Runtime consumption:** Gateway now loads enabled connectors by `session.organizationId` via `connectors.listEnabledConnectors()` (see `actions.md` §6.11).

**Files touched:** `packages/db/drizzle/0022_org_connectors.sql` (migration), `packages/services/src/connectors/` (new org-scoped module)

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `sessions-gateway.md` | Gateway → This | `resolvePrebuild()` → `prebuilds.*`, `cli.*` | Session creation calls resolver which creates/queries prebuild records via this spec's services. Resolver logic owned by `sessions-gateway.md` §6.1. |
| `sessions-gateway.md` | Gateway → This | `prebuilds.getPrebuildReposWithDetails()` | Session store loads repo details for sandbox provisioning |
| `actions.md` | Actions ↔ Integrations | `org_connectors` table via `connectors.listEnabledConnectors()` | Connector-backed action sources migrated to org-scoped catalog in `integrations.md`. Legacy `prebuilds.connectors` JSONB retained for data preservation only. |
| `sandbox-providers.md` | Worker → Provider | `ModalLibmodalProvider.createBaseSnapshot()`, `.createConfigurationSnapshot()` | Snapshot workers call Modal provider directly |
| `sandbox-providers.md` | Provider ← This | `resolveSnapshotId()` consumes configuration snapshot | Snapshot resolution reads `configurationSnapshotId` from configuration record |
| `integrations.md` | This → Integrations | `integrations.getRepoConnectionsWithIntegrations()` | Token resolution for repo snapshot builds |
| `secrets-environment.md` | Finalize → Secrets | `secrets.upsertSecretByRepoAndKey()` | Setup finalization stores encrypted secrets |
| `agent-contract.md` | Agent → This | `save_service_commands` tool | Agent persists service commands via gateway → services |

### Security & Auth
- All oRPC routes require org membership via `orgProcedure` middleware.
- Prebuild authorization uses `prebuildBelongsToOrg()` — traverses `prebuild_repos → repos → organizationId`.
- GitHub search API calls use `User-Agent: Proliferate-App` header but no auth token (public repos only).
- Setup finalization delegates secret storage to `secrets-environment.md` (encryption handled there).

### Observability
- Structured logging via `@proliferate/logger` in workers (`module: "base-snapshots"`, `module: "configuration-snapshots"`).
- Prebuilds router uses `logger.child({ handler: "prebuilds" })`.
- Key log events: build start, build complete (with `snapshotId`), build failure (with error), deduplication skips.

---

## 8. Acceptance Gates

- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] Worker tests pass (`pnpm -C apps/worker test`)
- [ ] This spec is updated (file tree, data models, deep dives)

---

## 9. Known Limitations & Tech Debt

- [ ] **Configuration snapshots are Modal-only** — E2B sessions cannot use Layer 2 snapshots. `requestConfigurationSnapshotBuild()` returns early if `MODAL_APP_NAME` is unset. Impact: E2B sessions always do a live clone. Expected fix: implement E2B template-based configuration snapshots.
- [ ] **Legacy repo snapshot columns remain on repos table** — `repo_snapshot_id`, `repo_snapshot_status`, `repo_snapshot_commit_sha`, `repo_snapshot_built_at`, `repo_snapshot_provider`, `repo_snapshot_error` columns exist on the `repos` table but are no longer written to. Impact: dead columns consuming space. Expected fix: schema migration to drop these columns.
- [ ] **Managed prebuild lookup scans all managed prebuilds** — `findManagedPrebuilds()` loads all `type = "managed"` prebuilds, then filters by org in-memory. Impact: grows linearly with managed prebuild count. Expected fix: add org-scoped query with DB-level filter.
- [ ] **Setup finalization lives in the router** — `configurations-finalize.ts` contains complex orchestration (snapshot + secrets + configuration mutation) that should be in the services layer. Impact: harder to reuse from non-web contexts.
- [ ] **GitHub search uses unauthenticated API** — `repos.search` calls GitHub API without auth, subject to lower rate limits (60 req/hour per IP). Impact: may fail under heavy usage. Expected fix: use org's GitHub integration token for authenticated search.
- [ ] **No webhook-driven configuration snapshot rebuilds** — Configuration snapshots are only built on configuration creation. Subsequent pushes to `defaultBranch` don't trigger rebuilds. Impact: configuration snapshots become stale over time; git freshness pull compensates at session start. Expected fix: trigger rebuilds from GitHub push webhooks.
- [x] **Connector scope is prebuild-scoped (legacy path)** — resolved. Connectors migrated to org-scoped `org_connectors` table. UI moved to Settings → Tools. See `integrations.md` §6.14.


---
# FILE: docs/specs/sandbox-providers.md
---

# Sandbox Providers — System Spec

## 1. Scope & Purpose

### In Scope
- `SandboxProvider` interface and provider contract
- Modal provider implementation (libmodal JS SDK)
- E2B provider implementation
- Modal image + deploy script (Python)
- Sandbox-MCP: API server, terminal WebSocket, service manager, auth, CLI setup
- Sandbox environment variable injection at boot
- OpenCode plugin injection (`PLUGIN_MJS` template string)
- Snapshot version key computation
- Snapshot resolution (which snapshot to use)
- Git freshness / pull cadence
- Port exposure (`proliferate services expose`)

### Out of Scope
- Session lifecycle that calls the provider — see `sessions-gateway.md`
- Tool schemas and prompt templates — see `agent-contract.md`
- Snapshot build jobs (base snapshot workers) — see `repos-prebuilds.md`
- Secret values and bundle management — see `secrets-environment.md`
- LLM key generation — see `llm-proxy.md`

### Mental Model

A **sandbox** is a remote compute environment (Modal container or E2B sandbox) where the coding agent runs. This spec owns _how_ sandboxes are created, configured, and managed — the provider layer. The session lifecycle that _decides when_ to create or destroy sandboxes belongs to `sessions-gateway.md`.

The provider abstraction lets callers swap between Modal and E2B without code changes. Both providers perform the same boot sequence: resolve an image/template, create or recover a sandbox, clone repos (or restore from snapshot), inject config files + tools + plugin, start OpenCode, start infrastructure services, and start sandbox-mcp. Configurations define per-repo settings (service commands, env files, etc.) that are applied at sandbox boot.

Inside every sandbox, **sandbox-mcp** runs as a sidecar providing an HTTP API (port 4000) and terminal WebSocket for the gateway to interact with the sandbox beyond OpenCode's SSE stream.

**Core entities:**
- **SandboxProvider** — The interface both Modal and E2B implement. Defined in `packages/shared/src/sandbox-provider.ts`.
- **sandbox-mcp** — The in-sandbox HTTP/WS server and CLI. Lives in `packages/sandbox-mcp/`.
- **Snapshots** — Two tiers: base snapshot (pre-baked image) and configuration/session snapshot (full state including cloned repo). The `resolveSnapshotId()` function picks the best available layer, with configuration snapshots taking priority. If no snapshot is available, the sandbox boots from the base image with a live clone.

**Key invariants:**
- Providers must be stateless across calls. All state lives in the sandbox filesystem or metadata file (`/home/user/.proliferate/metadata.json`).
- `ensureSandbox()` is idempotent: recover an existing sandbox if alive, else create a new one.
- `terminate()` is idempotent: "not found" errors are treated as success.
- Secrets are never logged. Error messages pass through `redactSecrets()` before storage.

---

## 2. Core Concepts

### Provider Factory
Callers obtain a provider via `getSandboxProvider(type?)` (`packages/shared/src/providers/index.ts`). If no `type` is passed, it reads `DEFAULT_SANDBOX_PROVIDER` from the environment schema (`packages/environment/src/schema.ts`). The provider type is persisted in the session DB record (`sessions.sandbox_provider`) so that resume always uses the same provider that created the sandbox. A thin alias `getSandboxProviderForSnapshot()` exists but is currently unused — gateway code calls `getSandboxProvider(providerType)` directly.
- Key detail agents get wrong: Session-facing code (gateway, API routes) should go through the factory — not instantiate providers directly. However, snapshot build workers (`apps/worker/src/base-snapshots/`, `apps/worker/src/configuration-snapshots/`) and the CLI snapshot script (`apps/gateway/src/bin/create-modal-base-snapshot.ts`) instantiate `ModalLibmodalProvider` directly because they need provider-specific methods like `createBaseSnapshot()` / `createConfigurationSnapshot()` that aren't on the `SandboxProvider` interface.
- Reference: `packages/shared/src/providers/index.ts`

### SandboxProvider Interface
The common contract for all providers. Defines required methods (`ensureSandbox`, `createSandbox`, `snapshot`, `pause`, `terminate`, `writeEnvFile`, `health`) and optional methods (`checkSandboxes`, `resolveTunnels`, `readFiles`, `testServiceCommands`, `execCommand`).

Memory snapshot support is provider-capability based:
- Providers may advertise `supportsMemorySnapshot`.
- Providers may implement dedicated memory snapshot methods (`memorySnapshot`, `restoreFromMemorySnapshot`) in addition to existing snapshot/pause paths.
- Session orchestration must treat these as provider-specific capabilities and branch explicitly rather than assuming universal support.

Reference capability shape:

```ts
interface SandboxProvider {
	supportsMemorySnapshot?: boolean;
	memorySnapshot?(sessionId: string, sandboxId: string): Promise<{ snapshotId: string }>;
	restoreFromMemorySnapshot?(
		sessionId: string,
		snapshotId: string,
		opts?: { envVars?: Record<string, string> },
	): Promise<CreateSandboxResult>;
}
```

- Key detail agents get wrong: `ensureSandbox` is the preferred entry point, not `createSandbox`. The former handles recovery; the latter always creates fresh.
- Reference: `packages/shared/src/sandbox-provider.ts`

### Agent & Model Configuration
The `AgentConfig` type (`packages/shared/src/agents.ts`) carries agent type and model ID through the stack. The default is `opencode` agent with `claude-opus-4.6` model. Model IDs are canonical (e.g., `"claude-opus-4.6"`) and transformed to provider-specific formats: `toOpencodeModelId()` produces `"anthropic/claude-opus-4-6"` for OpenCode's config file.
- Key detail agents get wrong: OpenCode model IDs have NO date suffix — OpenCode handles the mapping internally. Don't use Anthropic API format (`claude-opus-4-6-20250514`) in OpenCode config.
- Reference: `packages/shared/src/agents.ts:toOpencodeModelId`

### Snapshot Resolution
Snapshot resolution uses a two-tier priority chain via `resolveSnapshotId()` (`packages/shared/src/snapshot-resolution.ts`). The input uses configuration-level naming (`configurationSnapshotId`, `configurationRepos`):

1. **Configuration/session snapshot** (`configurationSnapshotId`) — always wins if present.
2. **Repo snapshot** — only for Modal provider, single-repo, `workspacePath = "."`, status `"ready"`.
3. **No snapshot** — start from base image with live clone.

There is no separate three-tier chain. Snapshots are either base snapshots (pre-baked image) or configuration/session snapshots (full working state).

- Key detail agents get wrong: Repo snapshots are only used for Modal provider, single-repo, `workspacePath = "."`. E2B sessions skip this layer.
- Reference: `packages/shared/src/snapshot-resolution.ts`

### Git Freshness
When restoring from a snapshot, repos may be stale. The `shouldPullOnRestore()` function gates `git pull --ff-only` on: (1) feature flag `SANDBOX_GIT_PULL_ON_RESTORE`, (2) having a snapshot, (3) cadence timer `SANDBOX_GIT_PULL_CADENCE_SECONDS`.
- Key detail agents get wrong: Cadence is only advanced when _all_ repo pulls succeed. A single failure leaves the timer unchanged so the next restore retries.
- Reference: `packages/shared/src/sandbox/git-freshness.ts`

### Thawed-TCP + Restore Freshness Guardrail
Memory snapshot restore resumes process memory and open-process state, which can make the runtime appear instantly ready while still reflecting stale repo state from the freeze point.

Requirement:
- Immediately after restore is confirmed, run stateless freshness reconciliation (`git pull --ff-only` when cadence/flag policy allows) before unblocking prompts.
- This reconciliation must happen in the provider restore flow, not deferred to agent behavior.

Key detail agents get wrong: restore shortcuts boot-time setup, so freshness checks cannot rely on "normal boot" hooks alone. Memory snapshot restore now blocks on OpenCode readiness (`waitForOpenCodeReady`) before returning tunnel URLs, preventing post-restore `/session` races.

### OpenCode Plugin (PLUGIN_MJS)
A minimal ESM plugin injected into every sandbox at `~/.config/opencode/plugin/proliferate.mjs`. It exports a `ProliferatePlugin` async function with empty hooks. All event streaming flows via SSE (gateway pulls from OpenCode) — the plugin does NOT push events.
- Key detail agents get wrong: The `console.log` calls inside `PLUGIN_MJS` run _inside the sandbox_, not in the provider. They are template string literals, not actual server-side calls. Do not migrate them to structured logging.
- Reference: `packages/shared/src/sandbox/config.ts:PLUGIN_MJS`

---

## 3. File Tree

```
packages/shared/src/
├── sandbox-provider.ts              # SandboxProvider interface + all types
├── snapshot-resolution.ts           # resolveSnapshotId() — snapshot layer picker
├── agents.ts                        # AgentConfig, ModelId, toOpencodeModelId()
├── sandbox/
│   ├── index.ts                     # Barrel export
│   ├── config.ts                    # PLUGIN_MJS, DEFAULT_CADDYFILE, SANDBOX_PATHS/PORTS, env instructions, service command parsing
│   ├── opencode.ts                  # getOpencodeConfig(), waitForOpenCodeReady(), SessionMetadata
│   ├── git-freshness.ts             # shouldPullOnRestore()
│   ├── version-key.ts              # computeBaseSnapshotVersionKey()
│   ├── errors.ts                    # SandboxProviderError, redactSecrets()
│   └── fetch.ts                     # fetchWithTimeout(), providerFetch(), DEFAULT_TIMEOUTS
├── providers/
│   ├── index.ts                     # getSandboxProvider() factory, getSandboxProviderForSnapshot()
│   ├── modal-libmodal.ts            # ModalLibmodalProvider (default)
│   └── e2b.ts                       # E2BProvider

packages/sandbox-mcp/src/
├── index.ts                         # Entry point — starts API server + terminal WS
├── api-server.ts                    # Express HTTP API on port 4000
├── terminal.ts                      # PTY-over-WebSocket at /api/terminal
├── service-manager.ts               # Start/stop/expose services, state persistence
├── auth.ts                          # Bearer token validation
├── types.ts                         # ServiceInfo, State types
├── proliferate-cli.ts               # `proliferate` CLI (services, env, actions)
├── actions-grants.ts                # Grant request/list command handlers
├── actions-grants.test.ts           # Tests for grant handlers
└── proliferate-cli-env.test.ts      # Tests for env apply/scrub

packages/modal-sandbox/
├── deploy.py                        # Modal app definition + get_image_id endpoint
└── Dockerfile                       # Base sandbox image
```

---

## 4. Data Models & Schemas

### Core TypeScript Types

```typescript
// packages/shared/src/sandbox-provider.ts
type SandboxProviderType = "modal" | "e2b";

/**
 * A single service command to auto-run after sandbox init.
 */
interface ServiceCommand {
  name: string;
  command: string;
  cwd?: string;
}

/**
 * A configuration-level service command that supports multi-repo workspaces.
 * Unlike ServiceCommand (per-repo), this includes an optional workspacePath
 * to target a specific repo directory in multi-repo configurations.
 */
interface ConfigurationServiceCommand {
  name: string;
  command: string;
  workspacePath?: string;
  cwd?: string;
}

interface CreateSandboxOpts {
  sessionId: string;
  repos: RepoSpec[];           // Always an array, even for single repo
  branch: string;
  envVars: Record<string, string>;
  systemPrompt: string;
  snapshotId?: string;         // Restore from this snapshot
  baseSnapshotId?: string;     // Use as base layer (skip get_image_id)
  agentConfig?: AgentConfig;
  currentSandboxId?: string;   // For ensureSandbox recovery (E2B)
  sshPublicKey?: string;
  triggerContext?: Record<string, unknown>;
  snapshotHasDeps?: boolean;   // True if snapshot includes installed deps. Gates service command auto-start.
  serviceCommands?: ConfigurationServiceCommand[];  // Resolved service commands (configuration-level or fallback from repos)
  envFiles?: unknown;          // Env file generation spec
  sessionType?: "coding" | "setup" | "cli" | null;  // Controls tool injection
}

interface CreateSandboxResult {
  sandboxId: string;
  tunnelUrl: string;           // OpenCode API URL
  previewUrl: string;          // Caddy preview proxy URL
  sshHost?: string;
  sshPort?: number;
  expiresAt?: number;          // Epoch ms
}

// packages/shared/src/sandbox/opencode.ts
interface SessionMetadata {
  sessionId: string;
  repoDir: string;
  createdAt: number;
  lastGitFetchAt?: number;     // Used by cadence gate
}

// packages/sandbox-mcp/src/types.ts
interface ServiceInfo {
  name: string;
  command: string;
  cwd: string;
  pid: number;
  status: "running" | "stopped" | "error";
  startedAt: number;
  logFile: string;
}
```

### Sandbox Filesystem Layout

```
/home/user/
├── .config/opencode/
│   ├── opencode.json                # Global OpenCode config
│   └── plugin/proliferate.mjs       # Proliferate SSE plugin
├── .proliferate/
│   ├── metadata.json                # SessionMetadata (repoDir, cadence)
│   ├── actions-guide.md             # Actions bootstrap hint
│   └── caddy/user.caddy             # User port expose snippet
├── .env.proliferate                 # Environment profile (E2B resume)
├── .opencode-tools/                 # Pre-installed tool node_modules
├── Caddyfile                        # Main Caddy config
└── workspace/                       # Cloned repos live here
    ├── .opencode/
    │   ├── instructions.md          # System prompt + env instructions
    │   └── tool/                    # OpenCode custom tools (verify, save_snapshot, etc.)
    ├── opencode.json                # Local OpenCode config (copy of global)
    └── .proliferate/
        └── trigger-context.json     # Automation trigger context (if applicable)
```

### Standard Ports

| Port | Service | Encrypted | Reference |
|------|---------|-----------|-----------|
| 4096 | OpenCode API | Yes (HTTPS) | `SANDBOX_PORTS.opencode` |
| 20000 | Caddy preview proxy | Yes (HTTPS) | `SANDBOX_PORTS.preview` |
| 22 | SSH (CLI sessions) | No (raw TCP) | `SANDBOX_PORTS.ssh` |
| 3901 | openvscode-server | Proxied via Caddy | `SANDBOX_PORTS.vscode` |
| 4000 | sandbox-mcp API | Internal only | `api-server.ts` |

### Environment Variables (`packages/environment/src/schema.ts`)

| Variable | Type | Default | Required | Notes |
|----------|------|---------|----------|-------|
| `DEFAULT_SANDBOX_PROVIDER` | `"modal" \| "e2b"` | — | Yes | Selects active provider |
| `SANDBOX_TIMEOUT_SECONDS` | int | `3600` | No | Max sandbox lifetime |
| `SANDBOX_GIT_PULL_ON_RESTORE` | boolean | `false` | No | Enable git pull on snapshot restore |
| `SANDBOX_GIT_PULL_CADENCE_SECONDS` | int (>=0) | `0` | No | Min seconds between pulls; 0 = always |
| `SANDBOX_IMAGE_VERSION` | string | — | No | Optional base snapshot cache-buster input for version-key |
| `MODAL_APP_NAME` | string | — | If modal | Modal app name |
| `MODAL_APP_SUFFIX` | string | — | No | Per-developer suffix (e.g., `"pablo"`) |
| `MODAL_BASE_SNAPSHOT_ID` | string | — | No | Pre-baked base snapshot image ID |
| `MODAL_TOKEN_ID` | string | — | If modal | `ak-...` format |
| `MODAL_TOKEN_SECRET` | string | — | If modal | `as-...` format |
| `MODAL_ENDPOINT_URL` | string | — | No | Test/custom endpoint only |
| `E2B_API_KEY` | string | — | If e2b | E2B API key |
| `E2B_DOMAIN` | string | — | If e2b | Self-hosted E2B domain |
| `E2B_TEMPLATE` | string | — | If e2b | E2B template ID |
| `E2B_TEMPLATE_ALIAS` | string | — | If e2b | E2B template alias |

Note: `SANDBOX_MCP_AUTH_TOKEN` is NOT in the environment schema — it's injected by the provider into the sandbox at boot via `CreateSandboxOpts.envVars` and read from `process.env` inside the sandbox.

### Base Sandbox Image (`packages/modal-sandbox/Dockerfile`)

The Dockerfile builds an Ubuntu 22.04 image with:

| Category | Contents |
|----------|----------|
| **Languages** | Node.js 20 (pnpm, yarn), Python 3.11 (uv, pip) |
| **AI Agents** | OpenCode |
| **Sandbox Tooling** | `proliferate-sandbox-mcp` (npm global) |
| **Docker** | Docker CE 27.5.0, Compose plugin, Buildx, runc 1.3.0 |
| **Web** | Caddy (preview proxy), openvscode-server 1.106.3 |
| **Git** | Git, GitHub CLI (`gh`), custom credential helpers (`git-credential-proliferate`, `git-askpass`) |
| **System** | SSH server (key-only auth), rsync, tmux, jq, procps |
| **Scripts** | `start-services.sh` (sshd), `start-dockerd.sh` (Docker daemon with iptables NAT), `proliferate-info` |
| **User** | Non-root `user` with passwordless sudo |
| **Pre-installed** | `@aws-sdk/client-s3` + `@opencode-ai/plugin` at `/home/user/.opencode-tools/` |

---

## 5. Conventions & Patterns

### Do
- Use `ensureSandbox()` for session initialization — it handles recovery automatically.
- Pass environment variables via `CreateSandboxOpts.envVars` — providers handle injection.
- Use `shellEscape()` for any user-provided values in shell commands (`packages/shared/src/sandbox/config.ts:shellEscape`).
- Wrap errors with `SandboxProviderError.fromError()` to ensure secret redaction.
- Use `capOutput()` to truncate command output to 16KB before logging.

### Don't
- Don't call `createSandbox()` directly unless you explicitly want a fresh sandbox.
- Don't log raw `envVars` or API keys — they contain secrets.
- Don't assume sandbox filesystem state persists after `terminate()`.
- Don't migrate `console.log` in `PLUGIN_MJS` — it's a template string that runs inside sandboxes.

### Error Handling

```typescript
// packages/shared/src/sandbox/errors.ts
// Modal wraps errors consistently:
throw SandboxProviderError.fromError(error, "modal", "createSandbox");
// Redacts API keys, tokens, JWTs from messages automatically
```

**Caveat:** E2B's `createSandbox` throws raw `Error` for validation failures (missing repos, missing template) at `e2b.ts:226-242`. Only `terminate` and `pause` wrap with `SandboxProviderError`. Modal is more consistent in wrapping.

### Reliability
- **Timeouts**: Sandbox lifetime defaults to 3600s (`SANDBOX_TIMEOUT_SECONDS`). OpenCode readiness poll: 30s with exponential backoff (200ms base, 1.5x, max 2s). Both providers use their respective SDK calls (libmodal / E2B SDK) — not the `fetchWithTimeout()`/`providerFetch()` utilities in `packages/shared/src/sandbox/fetch.ts`. Those utilities and `DEFAULT_TIMEOUTS` are exported but currently unused by provider implementations.
- **Retries**: `proliferate` CLI retries API calls up to 10 times with 1s delay for `ECONNREFUSED`/`fetch failed` (`proliferate-cli.ts:fetchWithRetry`).
- **Idempotency**: `terminate()` treats "not found" as success. `ensureSandbox()` recovers existing sandboxes.

### Testing Conventions
- Grant command handlers are extracted into `actions-grants.ts` with injectable dependencies for pure unit testing.
- Env apply/scrub logic tested in `proliferate-cli-env.test.ts`.
- Snapshot resolution is a pure function — unit test `resolveSnapshotId()` directly.

---

## 6. Subsystem Deep Dives

### 6.1 Provider Factory — `Implemented`

**What it does:** Selects and instantiates the correct provider based on configuration.

**Happy path** (`packages/shared/src/providers/index.ts:getSandboxProvider`):
1. Accept optional `type` parameter (e.g., from session DB record).
2. Fall back to `env.DEFAULT_SANDBOX_PROVIDER` if no type given.
3. Look up factory in `providers` map (`{ modal: () => new ModalLibmodalProvider(), e2b: () => new E2BProvider() }`).
4. Return fresh provider instance (providers are stateless — new instance per call).

**Usage in gateway:**
- Session creation: `getSandboxProvider()` — uses default from env (`apps/gateway/src/api/proliferate/http/sessions.ts`).
- Session resume/runtime: `getSandboxProvider(session.sandbox_provider)` — uses type from DB record (`apps/gateway/src/hub/session-runtime.ts`).
- Snapshot operations: `getSandboxProvider(providerType)` — uses type from session/snapshot record (`apps/gateway/src/hub/session-hub.ts`).

**Files touched:** `packages/shared/src/providers/index.ts`

### 6.2 Provider: Modal (ModalLibmodalProvider) — `Implemented`

**What it does:** Creates sandboxes using the Modal JS SDK (`libmodal`). Default provider.

**Happy path (createSandbox):**
1. Authenticate with Modal API via `ensureModalAuth()` — validates token format before calling API (`modal-libmodal.ts:160`).
2. Resolve sandbox image: restore snapshot > base snapshot (`MODAL_BASE_SNAPSHOT_ID`) > base image (via `get_image_id` endpoint) (`modal-libmodal.ts:541-565`).
3. Build env vars: inject `SESSION_ID`, LLM proxy config (`ANTHROPIC_API_KEY`/`ANTHROPIC_BASE_URL`), and user-provided vars (`modal-libmodal.ts:586-612`).
4. Create sandbox with `client.sandboxes.create()` — Docker enabled, 2 CPU, 4GB RAM, encrypted ports for OpenCode+preview, unencrypted for SSH (`modal-libmodal.ts:621-631`).
5. Get tunnel URLs via `sandbox.tunnels(30000)` (`modal-libmodal.ts:642-656`).
6. **Essential setup (blocking)**: Clone repos, write plugin/tools/config/instructions, start OpenCode server (`modal-libmodal.ts:662-678`).
7. **Additional setup (async)**: Git identity, git freshness pull, start services (sshd), start Caddy, start sandbox-mcp, boot service commands (`modal-libmodal.ts:691`).
8. Wait for OpenCode readiness (poll `/session` endpoint, 30s timeout) (`modal-libmodal.ts:701`).

**Edge cases:**
- Branch clone fails -> falls back to default branch (`modal-libmodal.ts:909-919`).
- Memory snapshot restore now blocks on OpenCode readiness (`waitForOpenCodeReady`) before returning tunnel URLs, preventing post-restore `/session` races.
- Modal does not support `pause()` — throws `SandboxProviderError` (`modal-libmodal.ts:1496`).
- `findSandbox()` uses `sessionId` as Modal sandbox name for 1:1 lookup (`modal-libmodal.ts:810`).

**Files touched:** `packages/shared/src/providers/modal-libmodal.ts`, `packages/shared/src/sandbox/config.ts`, `packages/shared/src/sandbox/opencode.ts`

### 6.3 Provider: E2B (E2BProvider) — `Implemented`

**What it does:** Creates sandboxes using the E2B TypeScript SDK. Supports pause/resume natively.

**Happy path (createSandbox):**
1. Build env vars (same pattern as Modal) (`e2b.ts:119-148`).
2. If snapshot: `Sandbox.connect(snapshotId)` auto-resumes paused sandbox. Re-injects env vars via JSON file + `jq` export (`e2b.ts:165-209`).
3. If fresh: `Sandbox.create(E2B_TEMPLATE, opts)` with configured timeout (`e2b.ts:222-238`).
4. Setup workspace, essential deps, additional deps (same sequence as Modal).
5. Get tunnel URLs via `sandbox.getHost(port)` (`e2b.ts:288-292`).
6. Wait for OpenCode readiness (`e2b.ts:304-325`).

**Key differences from Modal:**
- `supportsPause = true`, `supportsAutoPause = true` — E2B can pause/resume sandboxes (`e2b.ts:93-94`).
- `pause()` calls `Sandbox.betaPause()`. The `sandboxId` itself becomes the snapshot ID (`e2b.ts:960-975`).
- `snapshot()` maps 1:1 to `pause()` (`e2b.ts:955-958`).
- `findSandbox()` uses `currentSandboxId` from DB (E2B auto-generates IDs) (`e2b.ts:406-417`).
- `checkSandboxes()` uses `Sandbox.list()` — side-effect free, doesn't resume paused sandboxes (`e2b.ts:1199-1238`).
- Snapshot resume failures fall back to fresh sandbox creation (`e2b.ts:210-219`).

**Files touched:** `packages/shared/src/providers/e2b.ts`

### 6.4 Sandbox Boot Sequence — `Implemented`

**What it does:** Both providers follow the same two-phase boot sequence after sandbox creation.

**Phase 1 — Essential (blocking):**
1. Clone repos (or read metadata from snapshot) — `setupSandbox()`. For scratch sessions (`repos: []`), cloning is skipped and the workspace defaults to `/workspace/`.
2. Write config files in parallel: plugin, tool pairs (.ts + .txt), OpenCode config (global + local), instructions.md, actions-guide.md, pre-installed tool deps.
   - **Setup-only tools** (`save_service_commands`, `save_env_files`) are only written when `opts.sessionType === "setup"` — coding/CLI sessions never see them.
   - **Gateway-mediated tools** are implemented as synchronous callbacks. Providers must inject the gateway base URL + sandbox auth token into the sandbox environment and ensure tool stubs can call `POST /internal/tools/:toolName` (either via native OpenCode "remote tool" support or a local wrapper script).
3. **Modal only:** Write SSH keys if CLI session (`modal-libmodal.ts:1062`), write trigger context if automation-triggered (`modal-libmodal.ts:1071`). E2B does not handle SSH or trigger context.
4. Start OpenCode server (`opencode serve --port 4096`).

**Phase 2 — Additional (fire-and-forget):**
1. Configure git identity (`git config --global user.name/email`).
2. Git freshness pull (if enabled and cadence elapsed).
3. Start infrastructure services (`/usr/local/bin/start-services.sh`).
4. Create Caddy import directory, write Caddyfile, start Caddy.
5. Start sandbox-mcp API server (`sandbox-mcp api`, port 4000).
6. Apply env files via `proliferate env apply` (blocking within phase 2).
7. Start service commands via `proliferate services start` (fire-and-forget).

**Files touched:** Both provider files, `packages/shared/src/sandbox/config.ts`

### 6.5 Snapshot Resolution — `Implemented`

**What it does:** Pure function that picks the best snapshot for a session.

**Priority chain** (`packages/shared/src/snapshot-resolution.ts:resolveSnapshotId`):
1. **Configuration/session snapshot** (`configurationSnapshotId`) — always wins if present.
2. **Repo snapshot** — only for Modal provider, single-repo, `workspacePath = "."`, status `"ready"`.
3. **No snapshot** — start from base image with live clone.

**Edge cases:**
- Multi-repo configurations never use repo snapshots (returns `null`).
- Unknown/null provider skips repo snapshot layer.
- Repo snapshot must have matching provider (`"modal"` or null).

### 6.6 Snapshot Version Key — `Implemented`

**What it does:** Computes a SHA-256 hash of everything baked into a base snapshot (`packages/shared/src/sandbox/version-key.ts:computeBaseSnapshotVersionKey`).

**Inputs hashed:** `PLUGIN_MJS` + `DEFAULT_CADDYFILE` + `getOpencodeConfig(defaultModelId)` + `SANDBOX_IMAGE_VERSION` (fallback `"v1.0.0"` when unset).

When this key changes, the base snapshot is stale and must be rebuilt. Used by base snapshot build workers (see `repos-prebuilds.md`).

### 6.7 Git Freshness — `Implemented`

**What it does:** Decides whether to `git pull --ff-only` when restoring from snapshot.

**Decision function** (`packages/shared/src/sandbox/git-freshness.ts:shouldPullOnRestore`):
- Returns `false` if: disabled, no snapshot, no repos, or cadence window hasn't elapsed.
- Returns `true` if: cadence is 0 (always), no `lastGitFetchAt` (legacy), or enough time has passed.

**Env vars:** `SANDBOX_GIT_PULL_ON_RESTORE` (boolean), `SANDBOX_GIT_PULL_CADENCE_SECONDS` (number, 0 = always).

Both providers re-write git credentials before pulling (snapshot tokens may be stale) and only advance the cadence timer when all pulls succeed.

**Restore ordering requirement:** For memory-restore paths, freshness reconciliation runs before control returns to the hub for prompt handling. If freshness pull is skipped by policy (flag/cadence), the restore proceeds but retains the previous freshness timestamp semantics.

### 6.8 Sandbox-MCP API Server — `Implemented`

**What it does:** Express HTTP server on port 4000 inside the sandbox. Routed externally via Caddy at `/_proliferate/mcp/*`.

**Endpoints** (`packages/sandbox-mcp/src/api-server.ts`):

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/health` | No | Health check |
| GET | `/api/auth/check` | Yes | Caddy forward_auth for VS Code |
| GET | `/api/services` | Yes | List services + exposed port |
| POST | `/api/services` | Yes | Start a service |
| DELETE | `/api/services/:name` | Yes | Stop a service |
| POST | `/api/expose` | Yes | Expose port via Caddy |
| GET | `/api/logs/:name` | Yes | Stream service logs (SSE) |
| GET | `/api/git/repos` | Yes | Discover git repos in workspace |
| GET | `/api/git/status` | Yes | Git status (porcelain v2) |
| GET | `/api/git/diff` | Yes | Git diff (capped at 64KB) |

**Security:** All endpoints except `/api/health` require `Authorization: Bearer <token>` validated against `SANDBOX_MCP_AUTH_TOKEN` (falls back to `SERVICE_TO_SERVICE_AUTH_TOKEN`) (`packages/sandbox-mcp/src/auth.ts`). Repo ID is base64-encoded path, validated against workspace directory to prevent traversal.

### 6.9 Terminal WebSocket — `Implemented`

**What it does:** Interactive bash PTY over WebSocket at `/api/terminal`.

**Protocol** (`packages/sandbox-mcp/src/terminal.ts`):
- Auth: `Authorization: Bearer <token>` header on WS upgrade (no query-param auth).
- Client sends text frames (keystrokes) or JSON `{ type: "resize", cols, rows }`.
- Server sends PTY output as text frames.
- Spawns `bash` with `xterm-256color` terminal, cwd = `WORKSPACE_DIR`.

### 6.10 Service Manager — `Implemented`

**What it does:** Manages long-running processes inside the sandbox with state persistence.

**Key behaviors** (`packages/sandbox-mcp/src/service-manager.ts`):
- State persisted to `/tmp/proliferate/state.json`. Logs to `/tmp/proliferate/logs/<name>.log`.
- `startService()`: kills existing service with same name (handles both in-memory and orphaned PIDs via process group kill), spawns new process detached.
- `stopService()`: SIGTERM to process group (negative PID).
- `exposePort()`: writes Caddy snippet to `/home/user/.proliferate/caddy/user.caddy`, reloads Caddy via `pkill -USR1 caddy`. The snippet's `handle` block takes priority over the default multi-port fallback in the main Caddyfile.
- Process exit updates state (`stopped` on code 0, `error` otherwise).

### 6.11 Proliferate CLI — `Implemented`

**What it does:** CLI tool available inside sandboxes as `proliferate`. Provides subcommands for services, env, and actions.

**Command groups** (`packages/sandbox-mcp/src/proliferate-cli.ts`):

| Group | Command | Description |
|-------|---------|-------------|
| `services` | `list/start/stop/restart/expose/logs` | Manage sandbox services via sandbox-mcp API |
| `env` | `apply --spec <json>` | Generate env files from spec + process.env + `/tmp/.proliferate_env.json` overrides |
| `env` | `scrub --spec <json>` | Delete secret env files |
| `actions` | `list` | List available integrations (calls gateway) |
| `actions` | `guide --integration <i>` | Show provider usage guide (calls gateway) |
| `actions` | `run --integration <i> --action <a>` | Execute action, poll for approval if write (calls gateway) |
| `actions` | `grant request/grants list` | Request/list grants (calls gateway) |

**Env apply** adds generated files to `.git/info/exclude` automatically. Resolves values from process.env with `/tmp/.proliferate_env.json` overrides. Two-pass: validates all required keys exist before writing any files.

### 6.12 Modal Image + Deploy — `Implemented`

**What it does:** Python script that registers the Modal app and exposes a `get_image_id` endpoint.

**How it works** (`packages/modal-sandbox/deploy.py`):
- Builds image from `Dockerfile` using `modal.Image.from_dockerfile()`.
- Exposes `GET get_image_id` — returns `{"image_id": BASE_IMAGE.object_id}`. Called once by the TS provider at startup to resolve the base image.
- Exposes `GET health` — returns `{"status": "ok"}`.
- Supports per-developer deployments via `MODAL_APP_SUFFIX` env var (e.g., `proliferate-sandbox-pablo`).

**Deploy:** `cd packages/modal-sandbox && modal deploy deploy.py`

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| Sessions/Gateway | Gateway -> Provider | `SandboxProvider.ensureSandbox()` | Gateway calls provider to create/recover sandboxes. See `sessions-gateway.md`. |
| Agent Contract | Provider -> Sandbox | Tool files written to `.opencode/tool/` | Provider injects tool implementations at boot. Tool schemas defined in `agent-contract.md`. |
| Repos/Configurations | Provider <- Worker | `createBaseSnapshot()`, `createConfigurationSnapshot()` | Snapshot workers call Modal provider directly. See `repos-prebuilds.md`. |
| Secrets/Environment | Provider <- Gateway | `CreateSandboxOpts.envVars` | Gateway assembles env vars from secrets. See `secrets-environment.md`. |
| LLM Proxy | Provider -> Sandbox | `ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY` env vars | Virtual key injected as env var. See `llm-proxy.md`. |
| Actions | CLI -> Gateway | `proliferate actions run` | CLI calls gateway action endpoints. See `actions.md`. |

### Security & Auth
- **sandbox-mcp auth**: Bearer token via `SANDBOX_MCP_AUTH_TOKEN` env var (falls back to `SERVICE_TO_SERVICE_AUTH_TOKEN`). Secure-by-default — returns `false` if no token configured (`packages/sandbox-mcp/src/auth.ts`).
- **Secret redaction**: `SandboxProviderError` auto-redacts API keys, tokens, JWTs from error messages via regex patterns (`packages/shared/src/sandbox/errors.ts:redactSecrets`).
- **Git credentials**: Written to `/tmp/.git-credentials.json`. Credentials DO persist in snapshots but become stale — both providers re-write with fresh tokens inside the `if (doPull)` block on restore (`modal-libmodal.ts:1178`, `e2b.ts:842`).
- **Path traversal prevention**: sandbox-mcp validates all repo paths stay within workspace directory, dereferencing symlinks (`api-server.ts:validateInsideWorkspace`).

### Observability
- Both providers use structured logging via `@proliferate/logger` with `{ module: "modal" | "e2b" }` child loggers.
- Latency events logged at every step: `provider.create_sandbox.start`, `provider.create_sandbox.auth_ok`, `provider.create_sandbox.sandbox_created`, `provider.create_sandbox.tunnels`, `provider.create_sandbox.opencode_ready`, `provider.create_sandbox.complete`.
- sandbox-mcp uses `createLogger({ service: "sandbox-mcp" })`.

---

## 8. Acceptance Gates

- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] `packages/sandbox-mcp` tests pass (`pnpm -C packages/sandbox-mcp test`)
- [ ] This spec is updated (file tree, data models, deep dives)
- [ ] No secrets or API keys in error messages (check `redactSecrets` coverage)

---

## 9. Known Limitations & Tech Debt

- [ ] **Modal does not support pause** — `pause()` throws (`modal-libmodal.ts:1496`). Sessions on Modal must snapshot + terminate, then create fresh from snapshot on resume. No impact on correctness but slower than E2B's native pause/resume.
- [ ] **E2B snapshot resume fallback** — If `Sandbox.connect()` fails on a paused sandbox, E2B falls back to fresh creation silently. This loses the snapshot state without user notification.
- [ ] **Stale git credentials in snapshots** — Credentials persist in snapshots at `/tmp/.git-credentials.json` but may be expired. Both providers only re-write credentials when git pull is actually performed (inside the `if (doPull)` block). If cadence gate says no pull, stale credentials remain until the next pull window.
- [ ] **Service manager state in /tmp** — Process state is stored in `/tmp/proliferate/state.json`. This survives within a session but is lost on Modal sandbox recreation. E2B pause/resume preserves it.
- [ ] **No health monitoring for sandbox-mcp** — If sandbox-mcp crashes after boot, there's no automatic restart. The process runs fire-and-forget.
- [ ] **Caddy fallback ports hardcoded** — The default Caddyfile tries ports 3000, 5173, 8000, 4321 in order. No mechanism to configure this per-configuration without using `exposePort()`.
- [ ] **Setup-only tools not scrubbed before snapshot** — Snapshots of setup sessions include `save_service_commands` and `save_env_files` tools. These are cleaned up reactively on restore (via `rm -f` in `setupEssentialDependencies`) instead of being removed before snapshotting. Scrubbing before snapshot would eliminate the cleanup path and keep snapshots in a clean state.


---
# FILE: docs/specs/secrets-environment.md
---

# Secrets & Environment — System Spec

## 1. Scope & Purpose

### In Scope
- Secret CRUD (create, delete, list, check existence)
- Secret bundles CRUD (list, create, update metadata, delete)
- Bundle target path configuration for automatic env file generation
- Bulk import (`.env` paste flow)
- Secret encryption at rest (AES-256-GCM)
- Per-secret persistence toggle on environment submission
- Data flow: secrets from DB → gateway → sandbox environment variables
- Bundle-based env file spec generation at session boot

### Out of Scope
- `save_env_files` tool schema — see `agent-contract.md` §6
- `request_env_variables` tool schema — see `agent-contract.md` §6
- Sandbox env var injection mechanics (provider `createSandbox`, `writeEnvFile`) — see `sandbox-providers.md`
- Prebuild env file persistence (JSONB `envFiles` on prebuilds table) — see `repos-prebuilds.md`
- S3 for verification file storage (the gateway S3 module handles verification uploads, not secret storage) — see `sessions-gateway.md`

### Mental Model

Secrets are org-scoped encrypted key-value pairs that get injected into sandbox environments at session start. Users manage secrets through the web dashboard; the agent can request missing secrets at runtime via the `request_env_variables` tool (schema owned by `agent-contract.md`).

Secrets can optionally be grouped into **bundles** — named collections with an optional `target_path` that controls where an `.env` file is written inside the sandbox. At session creation, the gateway queries bundles with target paths and passes the resulting env file spec to the sandbox provider, which writes the files before the agent starts.

The encryption model is simple: AES-256-GCM with a single deployment-wide key (`USER_SECRETS_ENCRYPTION_KEY`). Values are encrypted on write and decrypted only when injected into a sandbox — they are never returned through the API.

**Core entities:**
- **Secret** — an encrypted key-value pair scoped to an org (optionally to a repo). Belongs to at most one bundle.
- **Bundle** — a named group of secrets with optional target path for env file generation.

**Key invariants:**
- Secret values are **never** returned by list/check endpoints. Only metadata (key name, type, timestamps) is exposed.
- A secret key is unique per `(organization_id, repo_id, key, prebuild_id)` combination (enforced by DB unique constraint `secrets_org_repo_prebuild_key_unique`). Because PostgreSQL treats NULLs as distinct in unique constraints, the same key name can exist independently at org-wide, repo, and prebuild scopes.
- A bundle name is unique per organization (enforced by DB unique constraint).
- Deleting a bundle sets `bundle_id` to null on associated secrets (ON DELETE SET NULL) — secrets survive bundle deletion.
- Encryption requires `USER_SECRETS_ENCRYPTION_KEY` (64 hex chars / 32 bytes). Writes that encrypt secret values (create, bulk import) fail if this is not configured. Bundle CRUD and secret deletion do not require the encryption key.

---

## 2. Core Concepts

### AES-256-GCM Encryption
Secrets are encrypted using AES-256-GCM with a random 16-byte IV per secret. The ciphertext is stored as `iv:authTag:encryptedText` (all hex-encoded). The encryption key is a 32-byte key read from `USER_SECRETS_ENCRYPTION_KEY` environment variable.
- Key detail agents get wrong: the encryption key is **not** per-org or per-secret — it is a single deployment-wide key. Key rotation requires re-encrypting all secrets.
- Reference: `packages/services/src/db/crypto.ts`

### Secret Scoping
Secrets have two scope dimensions: `organization_id` (required) and `repo_id` (optional). Org-wide secrets (`repo_id = null`) apply to all sessions in the org. Repo-scoped secrets apply only to sessions that include that repo. At session boot, both scopes are fetched and merged.
- Key detail agents get wrong: the runtime uniqueness constraint is on `(organization_id, repo_id, key, prebuild_id)`, not just `(organization_id, key)`. The same key can exist at org-wide scope, repo scope, and prebuild scope simultaneously. Note: the hand-written schema in `packages/db/src/schema/secrets.ts` defines a 3-column constraint but the canonical runtime schema (generated via `drizzle-kit pull`) in `packages/db/src/schema/schema.ts` includes `prebuild_id` as a fourth column.
- Reference: `packages/db/src/schema/schema.ts:492`, constraint `secrets_org_repo_prebuild_key_unique`

### Bundle Target Paths
A bundle can have a `target_path` (e.g., `.env.local`, `apps/web/.env`). At session creation, the system queries all bundles with target paths, collects their secret keys, and generates an `EnvFileSpec` array that the sandbox provider uses to write `.env` files on boot.
- Key detail agents get wrong: target paths must be relative, cannot contain `..`, and cannot start with `/` or a drive letter. Validation uses `isValidTargetPath()`.
- Reference: `packages/shared/src/env-parser.ts:isValidTargetPath`

---

## 3. File Tree

```
packages/services/src/secrets/
├── index.ts                  # Module exports (re-exports service + DB functions)
├── service.ts                # Business logic (CRUD, encryption orchestration, bulk import)
├── db.ts                     # Drizzle queries (secrets + bundles tables)
├── mapper.ts                 # DB row → API response type transforms
└── service.test.ts           # Vitest unit tests (mocked DB + crypto)

packages/services/src/db/
└── crypto.ts                 # AES-256-GCM encrypt/decrypt + key retrieval

packages/services/src/types/
└── secrets.ts                # DB row shapes and input types

packages/services/src/sessions/
└── sandbox-env.ts            # Builds env var map for sandbox (decrypts secrets)

packages/shared/src/contracts/
└── secrets.ts                # Zod schemas + ts-rest contract definitions

packages/shared/src/
└── env-parser.ts             # .env text parser + target path validation

packages/db/src/schema/
├── schema.ts                 # Canonical table definitions (generated via drizzle-kit pull)
├── relations.ts              # Drizzle relations (secrets, secretBundles)
└── secrets.ts                # Hand-written table defs (stale — not exported by index.ts)

apps/web/src/server/routers/
├── secrets.ts                # oRPC router (secret + bundle CRUD, bulk import)
└── sessions-submit-env.ts    # Environment submission handler (persist toggle)

apps/gateway/src/lib/
└── session-creator.ts        # Session creation (env var + env file spec assembly)
```

---

## 4. Data Models & Schemas

### Database Tables

```
secrets
├── id                UUID PRIMARY KEY DEFAULT random
├── organization_id   TEXT NOT NULL → organization(id) ON DELETE CASCADE
├── repo_id           UUID → repos(id) ON DELETE CASCADE          -- null = org-wide
├── prebuild_id       UUID → prebuilds(id) ON DELETE CASCADE      -- null = not prebuild-scoped
├── bundle_id         UUID → secret_bundles(id) ON DELETE SET NULL -- null = unbundled
├── key               TEXT NOT NULL
├── encrypted_value   TEXT NOT NULL                                -- iv:authTag:ciphertext
├── secret_type       TEXT DEFAULT 'env'                           -- 'env', 'docker_registry', 'file'
├── description       TEXT
├── created_by        TEXT → user(id)
├── created_at        TIMESTAMPTZ DEFAULT now()
└── updated_at        TIMESTAMPTZ DEFAULT now()

Indexes:
  idx_secrets_org      (organization_id)
  idx_secrets_repo     (repo_id)
  idx_secrets_bundle   (bundle_id)
  UNIQUE secrets_org_repo_prebuild_key_unique (organization_id, repo_id, key, prebuild_id)
```

Note: the canonical schema is `packages/db/src/schema/schema.ts` (generated via `drizzle-kit pull`), which is exported by `packages/db/src/schema/index.ts`. The hand-written `packages/db/src/schema/secrets.ts` defines relations but uses a stale 3-column unique constraint.


```
secret_bundles
├── id                UUID PRIMARY KEY DEFAULT random
├── organization_id   TEXT NOT NULL → organization(id) ON DELETE CASCADE
├── name              TEXT NOT NULL
├── description       TEXT
├── target_path       TEXT                                         -- relative path for .env file
├── created_by        TEXT → user(id)
├── created_at        TIMESTAMPTZ DEFAULT now()
└── updated_at        TIMESTAMPTZ DEFAULT now()

Indexes:
  idx_secret_bundles_org         (organization_id)
  UNIQUE (organization_id, name)
```

### Core TypeScript Types

```typescript
// packages/shared/src/contracts/secrets.ts
interface Secret {
  id: string;
  key: string;
  description: string | null;
  secret_type: string | null;
  repo_id: string | null;
  bundle_id: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface SecretBundle {
  id: string;
  name: string;
  description: string | null;
  target_path: string | null;
  secret_count: number;       // computed via LEFT JOIN COUNT
  created_at: string | null;
  updated_at: string | null;
}
```

### Key Indexes & Query Patterns
- **List secrets by org** — `idx_secrets_org` on `organization_id`, ordered by `created_at` DESC.
- **Check existence** — `findExistingKeys` queries by `(organization_id, key IN [...])` with optional repo scope.
- **Session injection** — `getSecretsForSession` fetches by `organization_id` + `repo_id IN [...]` OR `repo_id IS NULL`, returning `(key, encrypted_value)`.
- **Bundle target path query** — `getBundlesWithTargetPath` joins `secret_bundles` with `secrets` where `target_path IS NOT NULL`.

---

## 5. Conventions & Patterns

### Do
- Always encrypt via `packages/services/src/db/crypto.ts:encrypt` before DB insert — never store plaintext.
- Validate bundle ownership (`bundleBelongsToOrg`) before any cross-entity operation (create secret with bundle, update secret bundle, bulk import with bundle).
- Use the `SecretListRow` shape (no `encrypted_value`) for all read paths.
- Validate target paths with `isValidTargetPath()` before saving to bundles.

### Don't
- Never return `encrypted_value` through any API endpoint. The list/check queries explicitly select only metadata columns.
- Never import `@proliferate/db` directly in the router — use `@proliferate/services` functions.
- Never log secret values or encrypted values. Log only `secretKey` (the key name) for debugging.

### Error Handling

```typescript
// packages/services/src/secrets/service.ts
// PostgreSQL unique violation → domain error
if (err.code === "23505") {
  throw new DuplicateSecretError(input.key);
}

// Router translates domain errors to HTTP:
// DuplicateSecretError    → 409 CONFLICT
// EncryptionError         → 500 INTERNAL_SERVER_ERROR
// BundleOrgMismatchError  → 400 BAD_REQUEST
// BundleNotFoundError     → 404 NOT_FOUND
// InvalidTargetPathError  → 400 BAD_REQUEST
// DuplicateBundleError    → 409 CONFLICT
```

### Reliability
- No timeouts or retries — all queries are simple single-table reads/writes.
- Encryption key availability is checked on first encrypt call, not at startup. If missing or invalid, `getEncryptionKey()` throws synchronously with no fallback (`packages/services/src/db/crypto.ts:53-61`).
- Bulk import is not transactional — partial inserts are possible if the process crashes mid-batch. Duplicates are idempotent via `ON CONFLICT DO NOTHING` (`packages/services/src/secrets/db.ts:bulkCreateSecrets`).
- Session injection: decryption failures for individual secrets are logged but do not abort session creation — remaining secrets are still injected (`packages/services/src/sessions/sandbox-env.ts:91-96`).
- Idempotency: secret creation is not idempotent — duplicate keys return 409. Upsert is available only via `upsertByRepoAndKey` (internal path).

### Testing Conventions
- Service tests mock `./db` and `../db/crypto` modules via `vi.mock`.
- Encryption is mocked to return `"encrypted-value"` with a fixed 64-char hex key.
- Tests cover: CRUD happy paths, duplicate key handling, cross-org bundle rejection, bulk import with skips, bundle target path env file generation.
- Reference: `packages/services/src/secrets/service.test.ts`

---

## 6. Subsystem Deep Dives

### 6.1 Secret CRUD

**What it does:** Create, list, delete, and check existence of org-scoped secrets. **Status: Implemented.**

**Happy path (create):**
1. Router (`apps/web/src/server/routers/secrets.ts:create`) validates input via `CreateSecretInputSchema`.
2. Service (`packages/services/src/secrets/service.ts:createSecret`) calls `getEncryptionKey()` then `encrypt(value, key)`.
3. If `bundleId` is provided, validates bundle ownership via `secretsDb.bundleBelongsToOrg`.
4. Inserts via `secretsDb.create` with encrypted value. Returns metadata (no value).

**Happy path (list):**
1. Router calls `secrets.listSecrets(orgId)`.
2. DB query selects all columns **except** `encrypted_value`, ordered by `created_at` DESC.

**Happy path (check):**
1. Router receives array of key names + optional `repo_id` / `prebuild_id`.
2. `secretsDb.findExistingKeys` queries matching keys with scope filtering.
3. Returns `{ key, exists }` for each requested key.

**Edge cases:**
- Duplicate key on create → `DuplicateSecretError` → 409 CONFLICT.
- Missing encryption key → `EncryptionError` → 500.
- Bundle from different org → `BundleOrgMismatchError` → 400.

**Files touched:** `apps/web/src/server/routers/secrets.ts`, `packages/services/src/secrets/service.ts`, `packages/services/src/secrets/db.ts`, `packages/services/src/db/crypto.ts`

### 6.2 Bundle CRUD

**What it does:** Create, list, update metadata, and delete named secret groups with optional target paths. **Status: Implemented.**

**Happy path (create):**
1. Router validates input via `CreateBundleInputSchema` (name 1-100 chars, optional targetPath/description).
2. Service validates `targetPath` via `isValidTargetPath()` if provided.
3. Inserts via `secretsDb.createBundle`. Returns bundle with `secret_count: 0`.

**Happy path (list):**
1. `secretsDb.listBundlesByOrganization` performs `LEFT JOIN` on secrets + `GROUP BY` to compute `secret_count`.
2. Returns bundles ordered by `created_at` DESC.

**Happy path (update metadata):**
1. `updateBundleMeta` validates targetPath, calls `secretsDb.updateBundle`.
2. Fetches updated `secret_count` in a separate query.

**Happy path (delete):**
1. `secretsDb.deleteBundle` deletes the bundle row. Associated secrets have `bundle_id` set to null automatically (ON DELETE SET NULL).

**Edge cases:**
- Duplicate bundle name → `DuplicateBundleError` → 409.
- Invalid target path (absolute, `..` traversal, empty) → `InvalidTargetPathError` → 400.
- Bundle not found on update → `BundleNotFoundError` → 404.

**Files touched:** `apps/web/src/server/routers/secrets.ts`, `packages/services/src/secrets/service.ts`, `packages/services/src/secrets/db.ts`, `packages/shared/src/env-parser.ts`

### 6.3 Bulk Import

**What it does:** Parses pasted `.env`-format text, encrypts each value, and bulk-inserts secrets (skipping duplicates). **Status: Implemented.**

**Happy path:**
1. Router validates input via `BulkImportInputSchema` (non-empty `envText`, optional `bundleId`).
2. Service calls `parseEnvFile(envText)` to extract `{ key, value }[]`.
3. If `bundleId` is provided, validates bundle ownership.
4. Encrypts all values with the deployment encryption key.
5. `secretsDb.bulkCreateSecrets` uses `INSERT ... ON CONFLICT DO NOTHING` to skip existing keys.
6. Returns `{ created: N, skipped: ["KEY_A", ...] }`.

**Parser behavior (`parseEnvFile`):**
- Handles `KEY=VALUE`, `KEY="quoted"`, `KEY='quoted'`, `export KEY=VALUE`.
- Strips inline `# comments` from unquoted values (preserves `#` inside quotes).
- Skips blank lines and lines starting with `#`.
- Lines without `=` are silently skipped.

**Files touched:** `apps/web/src/server/routers/secrets.ts`, `packages/services/src/secrets/service.ts`, `packages/shared/src/env-parser.ts`

### 6.4 Secret-to-Sandbox Data Flow

**What it does:** Decrypts org+repo secrets and injects them as environment variables into the sandbox at session creation. **Status: Implemented.**

**Happy path:**
1. Gateway's `createSandbox` (`apps/gateway/src/lib/session-creator.ts`) calls `loadEnvironmentVariables`.
2. `loadEnvironmentVariables` delegates to `sessions.buildSandboxEnvVars` (`packages/services/src/sessions/sandbox-env.ts`).
3. `buildSandboxEnvVars` calls `secrets.getSecretsForSession(orgId, repoIds)` which fetches `(key, encryptedValue)` rows for org-wide + repo-scoped secrets.
4. Each secret is decrypted via `decrypt(encryptedValue, encryptionKey)` and added to the `envVars` map.
5. The merged env vars map is passed to `provider.createSandbox({ envVars })`.

**Bundle target path flow (env file specs):**
1. During `createSandbox`, the session creator calls `secrets.buildEnvFilesFromBundles(organizationId)`.
2. This queries `secretsDb.getBundlesWithTargetPath` — returns bundles with non-null `target_path` and their secret key lists.
3. Each bundle produces an `EnvFileSpec`: `{ workspacePath: ".", path: targetPath, format: "env", mode: "secret", keys: [...] }`.
4. These specs are merged with any prebuild-level env file specs and passed to `provider.createSandbox({ envFiles })`.
5. The sandbox provider (e.g., Modal) executes `proliferate env apply --spec <JSON>` inside the sandbox to write the files.

**Files touched:** `apps/gateway/src/lib/session-creator.ts`, `packages/services/src/sessions/sandbox-env.ts`, `packages/services/src/secrets/db.ts`, `packages/services/src/db/crypto.ts`

### 6.5 Per-Secret Persistence Toggle

**What it does:** When the agent requests environment variables via the `request_env_variables` tool, users submit values through the web dashboard. Each secret can individually opt into org-level persistence. **Status: Implemented.**

**Happy path:**
1. The session router (`apps/web/src/server/routers/sessions.ts:submitEnv`) receives `{ secrets: [{ key, value, persist }], envVars, saveToPrebuild }` and delegates to `submitEnvHandler`.
2. Handler (`apps/web/src/server/routers/sessions-submit-env.ts:submitEnvHandler`) processes each secret:
   - If `persist` is true (or `saveToPrebuild` fallback), calls `secrets.createSecret` to encrypt and store.
   - If duplicate, records `alreadyExisted: true` in results.
   - Regardless of persistence, adds to `envVarsMap`.
3. All values are written to the sandbox via `provider.writeEnvFile(sandboxId, envVarsMap)`.
4. Returns `{ submitted: true, results: [{ key, persisted, alreadyExisted }] }`.

**Edge cases:**
- Session not found or no sandbox → 404 / 400.
- Encryption failure on persist → logs error, sets `persisted: false`.
- Duplicate secret → skips persist, sets `alreadyExisted: true`.

**Files touched:** `apps/web/src/server/routers/sessions-submit-env.ts`, `packages/services/src/secrets/service.ts`

### 6.6 Secret Upsert (Repo-Scoped)

**What it does:** Upserts a secret by `(organization_id, repo_id, key)`. Used internally during repo setup flows. **Status: Implemented.**

**Happy path:**
1. Caller provides `{ repoId, organizationId, key, encryptedValue }`.
2. `secretsDb.upsertByRepoAndKey` uses `INSERT ... ON CONFLICT (organizationId, repoId, key) DO UPDATE SET encrypted_value, updated_at`.

**Caveat:** The conflict target is 3 columns but the runtime unique constraint is 4 columns (includes `prebuild_id`). This works when `prebuild_id` is null but could fail if prebuild-scoped secrets exist for the same key. See Known Limitations §9.

**Files touched:** `packages/services/src/secrets/db.ts`

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| Sessions / Gateway | This → Sessions | `buildSandboxEnvVars()` | Secrets decrypted and injected as env vars at session boot |
| Sessions / Gateway | This → Sessions | `buildEnvFilesFromBundles()` | Bundle target paths generate env file specs for sandbox boot |
| Sandbox Providers | This → Providers | `provider.createSandbox({ envVars, envFiles })` | Secrets passed as env vars + env file specs to provider |
| Sandbox Providers | This → Providers | `provider.writeEnvFile(sandboxId, envVarsMap)` | Runtime env submission writes to sandbox |
| Agent Contract | Other → This | `request_env_variables` tool | Agent requests secrets; user submits via `submitEnvHandler` |
| Agent Contract | Other → This | `save_env_files` tool | Agent saves env file spec to prebuild (not secrets themselves) |
| Repos / Prebuilds | Other → This | `prebuildEnvFiles` | Prebuild-level env file specs merged with bundle specs |
| Config: `packages/environment` | This → Config | `USER_SECRETS_ENCRYPTION_KEY` env var | Required for all encrypt/decrypt; defined in `packages/environment/src/schema.ts` |

### Security & Auth
- All secret endpoints use `orgProcedure` middleware — requires authenticated user with org membership.
- Secret values are encrypted with AES-256-GCM before storage. Decryption occurs only in `buildSandboxEnvVars` (gateway-side).
- The API never returns `encrypted_value` — list queries explicitly exclude it.
- Bundle ownership is validated on every cross-entity operation to prevent IDOR.
- Target paths are validated to prevent directory traversal attacks.

### Observability
- Service-level logging uses the injectable logger pattern (`getServicesLogger()`).
- `sandbox-env.ts` logs: secret fetch duration, count, individual decrypt failures (with `secretKey`, not value).
- `sessions-submit-env.ts` logs: persist/duplicate counts, write duration.

---

## 8. Acceptance Gates

- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] `packages/services/src/secrets/service.test.ts` passes
- [ ] `apps/web/src/test/unit/sessions-submit-env.test.ts` passes
- [ ] `packages/shared/src/env-parser.test.ts` passes
- [ ] This spec is updated (file tree, data models, deep dives)

---

## 9. Known Limitations & Tech Debt

- [ ] **Single encryption key** — all secrets across all orgs share one `USER_SECRETS_ENCRYPTION_KEY`. No key rotation mechanism exists. Impact: a compromised key exposes all org secrets. Expected fix: per-org keys with a key versioning scheme.
- [ ] **No secret update** — there is no endpoint to update a secret's value. Users must delete and re-create. Impact: minor friction for key rotation workflows.
- [ ] **`secret_type` unused** — the `secret_type` column (`env`, `docker_registry`, `file`) defaults to `env` and has no behavioral differentiation in the codebase. Impact: dead schema complexity.
- [ ] **`prebuild_id` column unused in queries** — the runtime schema (`packages/db/src/schema/schema.ts`) includes `prebuild_id` and the 4-column unique constraint includes it, but no service-layer query filters or inserts by `prebuild_id`. `CheckSecretsFilter` accepts `prebuildId` but `findExistingKeys` ignores it. The `upsertByRepoAndKey` conflict target uses only 3 columns (`organizationId, repoId, key`), which may conflict with the 4-column unique constraint if `prebuild_id` varies. Impact: potential upsert failures when prebuild-scoped secrets exist; dead schema complexity. Expected fix: align conflict targets with the 4-column constraint or add `prebuild_id` to query filters.
- [ ] **No audit trail** — secret creation/deletion is not logged to an audit table. Only `created_by` is tracked. Impact: no forensic trail for secret management operations.
- [ ] **S3 not used for secrets** (`Planned` / not implemented) — the feature registry and agent prompt list "S3 integration for secrets" as in scope, but `apps/gateway/src/lib/s3.ts` handles verification file uploads only. Secrets are stored exclusively in PostgreSQL with AES-256-GCM encryption. Impact: feature registry entry is misleading. Expected fix: either implement S3-backed secret storage or remove the entry from the feature registry.


---
# FILE: docs/specs/sessions-gateway.md
---

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
- **Initial prompt reliability**: `maybeSendInitialPrompt()` uses an in-memory `initialPromptSending` guard to prevent concurrent sends (eager start + runtime init), marks `initial_prompt_sent_at` before dispatch to avoid duplicates, and rolls that DB marker back on send failure so a later runtime init can retry. The in-memory guard is always reset in a `finally` block.
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


---
# FILE: docs/specs/triggers.md
---

# Triggers — System Spec

## 1. Scope & Purpose

### In Scope
- Trigger CRUD (create, update, delete, list, get)
- Trigger events log and trigger event actions (audit trail)
- Trigger service (`apps/trigger-service/` — dedicated Express app)
- Async webhook inbox pattern (fast-ack + BullMQ worker for reliable ingestion)
- Direct webhook routes: GitHub App installation lifecycle, Nango auth/sync (`apps/web/src/app/api/webhooks/`)
- Webhook dispatch and matching (event → trigger → automation run)
- Integration-scoped polling via poll groups (`trigger_poll_groups` table — one job per group, not per trigger)
- Cron scheduling via SCHEDULED queue (Partial — queue defined, worker not running)
- Provider registry (`packages/triggers/src/service/registry.ts`)
- Provider adapters: GitHub (webhook), Linear (webhook + polling), Sentry (webhook), PostHog (webhook, HMAC), Gmail (polling via Composio)
- `NormalizedTriggerEvent` interface and `ProviderTriggers` contract (`packages/providers/src/types.ts`)
- Schedule CRUD (get, update, delete)
- PubSub session events subscriber
- Handoff to automations (enqueue via outbox `enqueue_enrich`)

### Out of Scope
- Automation run pipeline after handoff — see `automations-runs.md`
- Integration OAuth setup and connection lifecycle — see `integrations.md`
- Session lifecycle — see `sessions-gateway.md`
- Sandbox boot and provider interface — see `sandbox-providers.md`

### Mental Model

Triggers are the inbound event layer of Proliferate. External services (GitHub, Linear, Sentry, PostHog, Gmail) emit events that Proliferate ingests, normalizes, filters, deduplicates, and converts into automation runs. There are three ingestion mechanisms: **webhooks** (provider pushes events — via Nango forwarding to trigger-service, or via direct Next.js API routes for installation lifecycle), **polling** (Proliferate pulls from provider APIs on a schedule), and **scheduled** (pure cron triggers with no external event source — queue defined but worker not yet running).

Webhook ingestion uses the **async webhook inbox** pattern: Express routes do exactly three things — verify signatures, insert into `webhook_inbox`, and return `200 OK`. A BullMQ worker asynchronously drains the inbox, parsing payloads, matching triggers, and creating runs. This decoupling prevents upstream providers from timing out during bulk event storms.

Polling uses **integration-scoped poll groups**: one BullMQ repeatable job per `(organization_id, provider, integration_id)` group, not per trigger. The worker calls the provider API once, then fans out events in-memory to all active triggers in the group. This turns an O(N) network fan-out into a single API call + O(N) in-memory matching.

Every trigger belongs to exactly one automation. When an event passes filtering and deduplication, the trigger processor creates a `trigger_event` record and an `automation_run` record inside a single transaction, using the transactional outbox pattern to guarantee the run will be picked up by the worker.

**Core entities:**
- **Trigger** — a configured event source bound to an automation and an integration. Types: `webhook` or `polling`.
- **Trigger event** — an individual event occurrence, with lifecycle: `queued` → `processing` → `completed`/`failed`/`skipped`.
- **Trigger event action** — audit log of tool executions within a trigger event.
- **Webhook inbox** — raw webhook payloads stored for async processing. Lifecycle: `pending` → `processing` → `completed`/`failed`.
- **Trigger poll group** — groups polling triggers by `(org, provider, integration)` for efficient batch polling.
- **Schedule** — a cron expression attached to an automation for time-based runs.
- **Provider adapter** — a `WebhookTrigger` or `PollingTrigger` subclass that knows how to parse, filter, and contextualize events from a specific external service. Being consolidated into the `ProviderTriggers` contract.
- **NormalizedTriggerEvent** — provider-agnostic representation of an inbound event, defined in `packages/providers/src/types.ts`.

**Core invariants:**
1. **Async Webhook Inbox:** Express webhook routes must do exactly three things: verify signatures, extract routing identity, and `INSERT INTO webhook_inbox`. They must return `200 OK` instantly to prevent upstream rate-limit timeouts.
2. **Integration-Scoped Polling:** Polling is scheduled per poll group (org + provider + integration), NOT per trigger. The worker fetches events once from the provider, then fans out in-memory to evaluate filters across all active triggers.
3. **Pure Matching:** The `matches()` / `filter()` function declared by providers must be strictly pure (no DB calls, no network calls, no side effects).
4. **Stateless Providers:** Providers never read PostgreSQL, write Redis, or schedule jobs. The framework owns all persistence and deduplication.
5. Each trigger belongs to exactly one automation (FK `automation_id`).
6. Deduplication is enforced via a unique index on `(trigger_id, dedup_key)` in `trigger_events`.
7. Polling cursors are stored in `trigger_poll_groups.cursor` (PostgreSQL). Legacy per-trigger Redis cursor storage is being phased out.
8. Webhook signature verification happens at the ingestion layer (Nango HMAC in the fast-ack route, provider-specific signatures in provider adapters).

---

## 2. Core Concepts

### Async Webhook Inbox
External webhooks are received by Express routes in the trigger service. Instead of processing synchronously (which risks timeouts during bulk event storms), the routes verify the signature, store the raw payload in the `webhook_inbox` table, and return `200 OK` immediately. A BullMQ worker (`apps/trigger-service/src/webhook-inbox/worker.ts`) drains the inbox every 5 seconds, parsing payloads, resolving integrations, running trigger matching, and creating automation runs.
- Key detail agents get wrong: the webhook route does NOT parse events, run matching, or create runs. All of that happens asynchronously in the inbox worker.
- Reference: `apps/trigger-service/src/api/webhooks.ts`, `apps/trigger-service/src/webhook-inbox/worker.ts`

### Nango Forwarding
External webhooks from GitHub, Linear, and Sentry are received by Nango, which forwards them to the trigger service as a unified envelope with type `"forward"`. The envelope includes `connectionId`, `providerConfigKey`, and `payload`. The fast-ack route verifies the Nango HMAC signature, extracts the provider and connectionId, and stores the raw payload in the webhook inbox.
- Key detail agents get wrong: the trigger service receives Nango's envelope, not raw provider payloads. The `parseNangoForwardWebhook` function extracts the inner payload.
- Reference: `packages/triggers/src/service/adapters/nango.ts`, `apps/trigger-service/src/lib/webhook-dispatcher.ts`

### Provider Registry (Service Layer)
The trigger service uses a class-based registry (`TriggerRegistry`) with separate maps for webhook and polling triggers. Providers register via `registerDefaultTriggers()` at startup. This registry is used by the webhook inbox worker and polling worker to resolve trigger definitions. The `ProviderTriggers` contract in `packages/providers/src/types.ts` defines the target interface that all integration modules will implement.
- Key detail agents get wrong: two abstraction layers currently coexist — the service-layer `WebhookTrigger`/`PollingTrigger` classes (used by trigger-service) and the `ProviderTriggers` interface (target architecture). Migration to the consolidated `ProviderTriggers` interface is in progress.
- Reference: `packages/triggers/src/service/registry.ts`, `packages/providers/src/types.ts`

### The `ProviderTriggers` Contract
The `ProviderTriggers` interface in `packages/providers/src/types.ts` defines the target trigger contract for integration modules. Key types:
- **`NormalizedTriggerEvent`** — provider-agnostic event representation with `provider`, `eventType`, `providerEventType`, `occurredAt`, `dedupKey`, `title`, `context`, and optional `url`, `externalId`, `raw`.
- **`WebhookRequest`** — normalized HTTP request with mandatory `rawBody: Buffer` for HMAC verification.
- **`WebhookParseInput`** — input to the provider's `parse()` method (json, headers, providerEventType, receivedAt).
- **`WebhookVerificationResult`** — verification result with routing `identity` (org/integration/trigger) and optional `immediateResponse` for challenge protocols.
- **`TriggerType<TConfig>`** — typed trigger definition with pure `matches()` function and Zod `configSchema`.
- Key detail agents get wrong: `matches()` must be pure — no DB calls, no network, no side effects. The framework owns all persistence.
- Reference: `packages/providers/src/types.ts`

### Integration-Scoped Polling (Poll Groups)
Instead of scheduling one BullMQ job per polling trigger (which causes N API calls for N triggers against the same provider), polling is grouped by `(organization_id, provider, integration_id)` in the `trigger_poll_groups` table. One repeatable BullMQ job runs per group. The worker acquires a Redis lock, calls the provider's `poll()` method once, then fans out events in-memory to all active triggers in the group.
- Key detail agents get wrong: the cursor lives on the poll group row, not on individual triggers. All triggers in a group share a single cursor and a single API call.
- Reference: `apps/trigger-service/src/polling/worker.ts`, `packages/services/src/poll-groups/db.ts`

### Transactional Outbox Handoff
When a trigger event passes all checks, `createRunFromTriggerEvent` inserts both the `trigger_event` and `automation_run` rows in a single transaction, plus an outbox entry with kind `enqueue_enrich`. The outbox dispatcher (owned by `automations-runs.md`) picks this up.
- Key detail agents get wrong: the handoff is NOT a direct BullMQ enqueue. It goes through the outbox for reliability.
- Reference: `packages/services/src/runs/service.ts:createRunFromTriggerEvent`

---

## 3. File Tree

```
apps/trigger-service/src/
├── index.ts                          # Entry point: registers triggers, starts server + workers
├── server.ts                         # Express app setup (health, providers, webhooks routes)
├── api/
│   ├── webhooks.ts                   # Fast-Ack ingestion (POST /webhooks/nango, /webhooks/direct/:providerId)
│   └── providers.ts                  # GET /providers — provider metadata for UI
├── lib/
│   ├── logger.ts                     # Service logger
│   ├── webhook-dispatcher.ts         # Dispatches Nango webhooks, extracts routing info
│   └── trigger-processor.ts          # Processes events: filter, dedup, create run
├── webhook-inbox/
│   └── worker.ts                     # BullMQ worker: drains webhook_inbox rows (parse, match, handoff)
├── gc/
│   └── inbox-gc.ts                   # BullMQ worker: garbage collects old inbox rows (hourly, 7-day retention)
└── polling/
    └── worker.ts                     # BullMQ worker: poll per group, fan-out in memory

packages/providers/src/
├── index.ts                          # Package exports
├── types.ts                          # IntegrationProvider, NormalizedTriggerEvent, ProviderTriggers, WebhookRequest, etc.
├── action-source.ts                  # Action source types
├── helpers/
│   ├── schema.ts                     # Schema helpers
│   └── truncation.ts                 # Truncation helpers
└── providers/
    ├── registry.ts                   # ProviderActionRegistry (action modules — Linear, Sentry, Slack)
    ├── linear/
    │   └── actions.ts                # Linear action implementations
    ├── sentry/
    │   └── actions.ts                # Sentry action implementations
    └── slack/
        └── actions.ts                # Slack action implementations

packages/triggers/src/
├── index.ts                          # Package exports + provider map
├── types.ts                          # TriggerProvider interface, provider configs, item types
├── github.ts                         # GitHub provider (webhook-only)
├── linear.ts                         # Linear provider (webhook + polling)
├── sentry.ts                         # Sentry provider (webhook-only)
├── posthog.ts                        # PostHog provider (webhook, HMAC)
└── service/
    ├── index.ts                      # Service-layer exports
    ├── base.ts                       # WebhookTrigger/PollingTrigger base classes, TriggerEvent type
    ├── registry.ts                   # TriggerRegistry class (webhook + polling maps)
    ├── register.ts                   # registerDefaultTriggers() — startup registration
    └── adapters/
        ├── nango.ts                  # Nango envelope parsing + HMAC verification
        ├── github-nango.ts           # GitHubNangoTrigger (WebhookTrigger subclass)
        ├── linear-nango.ts           # LinearNangoTrigger (WebhookTrigger subclass)
        ├── sentry-nango.ts           # SentryNangoTrigger (WebhookTrigger subclass)
        └── gmail.ts                  # GmailPollingTrigger (PollingTrigger subclass, Composio)

packages/services/src/triggers/
├── index.ts                          # Module exports
├── service.ts                        # Business logic (CRUD, event management, poll group scheduling)
├── db.ts                             # Drizzle queries
├── mapper.ts                         # DB row → API type mapping
└── processor.ts                      # Shared trigger event processor (filter/dedup/handoff)

packages/services/src/webhook-inbox/
├── index.ts                          # Module exports
└── db.ts                             # Webhook inbox Drizzle queries (insert, claim, mark, gc)

packages/services/src/poll-groups/
├── index.ts                          # Module exports
└── db.ts                             # Poll groups Drizzle queries (find/create, list, cursor, orphan cleanup)

packages/services/src/schedules/
├── index.ts                          # Module exports
├── service.ts                        # Schedule CRUD logic
├── db.ts                             # Drizzle queries
└── mapper.ts                         # DB row → API type mapping

packages/db/src/schema/
├── schema.ts                         # triggers, trigger_events, trigger_event_actions, webhook_inbox, trigger_poll_groups tables
└── (schedules defined in schema.ts)  # schedules table

packages/services/src/types/
├── triggers.ts                       # Re-exported trigger DB types
└── schedules.ts                      # Schedule input/output types

apps/web/src/server/routers/
├── triggers.ts                       # Trigger CRUD + provider metadata oRPC routes
└── schedules.ts                      # Schedule CRUD oRPC routes

apps/web/src/app/api/webhooks/
├── nango/route.ts                    # Nango webhook handler (auth + sync lifecycle only; forwards return 200 stub)
└── github-app/route.ts              # GitHub App installation lifecycle only (deleted, suspend, unsuspend)

apps/worker/src/pubsub/
├── index.ts                          # Exports SessionSubscriber
└── session-events.ts                 # Redis PubSub subscriber for session events
```

---

## 4. Data Models & Schemas

### Database Tables

```sql
webhook_inbox
├── id                    UUID PRIMARY KEY
├── organization_id       TEXT                             -- nullable, resolved from routing identity
├── provider              TEXT NOT NULL                    -- e.g. 'github', 'linear', 'sentry'
├── external_id           TEXT                             -- optional provider-specific ID
├── headers               JSONB                            -- raw HTTP headers for deferred parsing
├── payload               JSONB NOT NULL                   -- raw webhook body
├── signature             TEXT                             -- raw signature header for deferred verification
├── status                TEXT NOT NULL DEFAULT 'pending'   -- pending | processing | completed | failed
├── error                 TEXT                             -- error message on failure
├── processed_at          TIMESTAMPTZ                      -- when the inbox worker processed this row
├── received_at           TIMESTAMPTZ DEFAULT now()        -- when the webhook was received
└── created_at            TIMESTAMPTZ DEFAULT now()
    INDEXES: (status, received_at), provider, organization_id

trigger_poll_groups
├── id                    UUID PRIMARY KEY
├── organization_id       TEXT NOT NULL → organization.id (CASCADE)
├── provider              TEXT NOT NULL
├── integration_id        UUID → integrations.id (SET NULL)
├── cron_expression       TEXT NOT NULL
├── enabled               BOOLEAN DEFAULT true
├── last_polled_at        TIMESTAMPTZ
├── cursor                JSONB                            -- opaque cursor for provider pagination
├── created_at            TIMESTAMPTZ DEFAULT now()
└── updated_at            TIMESTAMPTZ DEFAULT now()
    INDEXES: organization_id, enabled
    UNIQUE(organization_id, provider, integration_id) NULLS NOT DISTINCT

triggers
├── id                    UUID PRIMARY KEY
├── organization_id       TEXT NOT NULL → organization.id (CASCADE)
├── automation_id         UUID NOT NULL → automations.id (CASCADE)
├── name                  TEXT (deprecated — use automation.name)
├── description           TEXT (deprecated)
├── trigger_type          TEXT NOT NULL DEFAULT 'webhook'  -- 'webhook' | 'polling'
├── provider              TEXT NOT NULL                    -- 'sentry' | 'linear' | 'github' | 'custom' | 'webhook' | 'posthog' | 'gmail' | 'scheduled'
├── enabled               BOOLEAN DEFAULT true
├── execution_mode        TEXT DEFAULT 'auto' (deprecated)
├── allow_agentic_repo_selection  BOOLEAN DEFAULT false (deprecated)
├── agent_instructions    TEXT (deprecated)
├── webhook_secret        TEXT                             -- random 32-byte hex
├── webhook_url_path      TEXT UNIQUE                      -- /webhooks/t_{uuid12}
├── polling_cron          TEXT                             -- cron expression
├── polling_endpoint      TEXT
├── polling_state         JSONB DEFAULT {}                 -- legacy cursor backup (being replaced by poll groups)
├── last_polled_at        TIMESTAMPTZ
├── config                JSONB DEFAULT {}                 -- provider-specific filters; { _manual: true } marks manual-run triggers
├── integration_id        UUID → integrations.id (SET NULL)
├── created_by            TEXT → user.id
├── created_at            TIMESTAMPTZ
└── updated_at            TIMESTAMPTZ
    INDEXES: org, automation, webhook_path, (enabled, trigger_type)

trigger_events
├── id                    UUID PRIMARY KEY
├── trigger_id            UUID NOT NULL → triggers.id (CASCADE)
├── organization_id       TEXT NOT NULL → organization.id (CASCADE)
├── external_event_id     TEXT
├── provider_event_type   TEXT                             -- e.g. 'issues:opened', 'Issue:create'
├── status                TEXT DEFAULT 'queued'            -- queued | processing | completed | failed | skipped
├── session_id            UUID
├── raw_payload           JSONB NOT NULL
├── parsed_context        JSONB
├── error_message         TEXT
├── processed_at          TIMESTAMPTZ
├── skip_reason           TEXT                             -- manual | filter_mismatch | automation_disabled | run_create_failed
├── dedup_key             TEXT
├── enriched_data         JSONB
├── llm_filter_result     JSONB
├── llm_analysis_result   JSONB
└── created_at            TIMESTAMPTZ
    INDEXES: trigger, status, (org, status), UNIQUE(trigger_id, dedup_key), (status, created_at)

trigger_event_actions
├── id                    UUID PRIMARY KEY
├── trigger_event_id      UUID NOT NULL → trigger_events.id (CASCADE)
├── tool_name             TEXT NOT NULL
├── status                TEXT DEFAULT 'pending'
├── input_data            JSONB
├── output_data           JSONB
├── error_message         TEXT
├── started_at            TIMESTAMPTZ
├── completed_at          TIMESTAMPTZ
├── duration_ms           INTEGER
└── created_at            TIMESTAMPTZ
    INDEXES: event, status

schedules
├── id                    UUID PRIMARY KEY
├── automation_id         UUID NOT NULL → automations.id (CASCADE)
├── organization_id       TEXT NOT NULL → organization.id (CASCADE)
├── name                  TEXT
├── cron_expression       TEXT NOT NULL
├── timezone              TEXT DEFAULT 'UTC'
├── enabled               BOOLEAN DEFAULT true
├── last_run_at           TIMESTAMPTZ
├── next_run_at           TIMESTAMPTZ
├── created_by            TEXT → user.id
├── created_at            TIMESTAMPTZ
└── updated_at            TIMESTAMPTZ
    INDEXES: automation, next_run, org
```

### Core TypeScript Types

```typescript
// packages/providers/src/types.ts — vNext provider trigger contract

interface NormalizedTriggerEvent {
  provider: string;          // e.g. "sentry"
  eventType: string;         // Internal normalized type (e.g. "error_created")
  providerEventType: string; // Native type from header (e.g. "issue.created")
  occurredAt: string;        // ISO 8601 timestamp
  dedupKey: string;          // Globally unique key for deduplication
  title: string;
  url?: string;
  externalId?: string;       // External event identifier from the provider
  context: Record<string, unknown>; // Parsed, structured data
  raw?: unknown;             // Optional: original payload
}

interface WebhookRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string | undefined>;
  params: Record<string, string | undefined>;
  rawBody: Buffer; // Mandatory for accurate HMAC verification
  body: unknown;
}

interface WebhookParseInput {
  json: unknown;
  headers: Record<string, string | string[] | undefined>;
  providerEventType?: string;
  receivedAt: string;
}

interface WebhookVerificationResult {
  ok: boolean;
  identity?: { kind: "org" | "integration" | "trigger"; id: string };
  immediateResponse?: { status: number; body?: unknown }; // For Slack/Jira challenges
}

interface TriggerType<TConfig = unknown> {
  id: string;
  description: string;
  configSchema: z.ZodType<TConfig>;
  // Pure, synchronous, no side effects
  matches(event: NormalizedTriggerEvent, config: TConfig): boolean;
}

interface ProviderTriggers {
  types: TriggerType[];

  webhook?: {
    verify(req: WebhookRequest, secret: string | null): Promise<WebhookVerificationResult>;
    parse(input: WebhookParseInput): Promise<NormalizedTriggerEvent[]>;
  };

  polling?: {
    defaultIntervalSeconds: number;
    poll(ctx: {
      cursor: unknown;
      token?: string;
      orgId: string;
    }): Promise<{ events: NormalizedTriggerEvent[]; nextCursor: unknown; backoffSeconds?: number }>;
  };

  // Called ONCE per event batch to fetch missing data (e.g. fetching Jira issue fields via API)
  hydrate?: (event: NormalizedTriggerEvent, ctx: { token: string }) => Promise<NormalizedTriggerEvent>;
}

// packages/triggers/src/service/base.ts — current service-layer base classes (being consolidated)
abstract class WebhookTrigger<T extends TriggerId, TConfig> {
  abstract webhook(req: Request): Promise<TriggerEvent[]>;
  abstract filter(event: TriggerEvent, config: TConfig): boolean;
  abstract idempotencyKey(event: TriggerEvent): string;
  abstract context(event: TriggerEvent): Record<string, unknown>;
}

abstract class PollingTrigger<T extends TriggerId, TConfig> {
  abstract poll(connection: OAuthConnection, config: TConfig, cursor: string | null): Promise<PollResult>;
  abstract filter(event: TriggerEvent, config: TConfig): boolean;
  abstract idempotencyKey(event: TriggerEvent): string;
  abstract context(event: TriggerEvent): Record<string, unknown>;
}
```

### Key Indexes & Query Patterns
- Webhook inbox drain: `claimBatch()` uses `SELECT FOR UPDATE SKIP LOCKED` on `(status, received_at)` for concurrent worker safety.
- Webhook lookup: `findActiveWebhookTriggers(integrationId)` uses `(integration_id, enabled, trigger_type)`.
- Dedup check: `eventExistsByDedupKey(triggerId, dedupKey)` uses unique index `(trigger_id, dedup_key)`.
- Poll group lookup: `findTriggersForGroup(orgId, provider, integrationId)` matches triggers by org + provider + integration.
- Orphan cleanup: `deleteOrphanedGroups()` removes poll groups with no matching active triggers.
- Event listing: `listEvents(orgId, options)` uses `(organization_id, status)` with pagination.

---

## 5. Conventions & Patterns

### Do
- Use the transactional outbox (`createRunFromTriggerEvent`) for all trigger-to-run handoffs — guarantees atomicity.
- Register new providers in `registerDefaultTriggers()` (`packages/triggers/src/service/register.ts`).
- Store webhook payloads in the inbox for async processing — never process webhooks synchronously in the Express handler.
- Use poll groups for polling triggers — never schedule per-trigger polling jobs.
- Keep `matches()` / `filter()` functions pure — no DB calls, no network, no side effects.
- When adding a new provider, implement `ProviderTriggers` in `packages/providers/src/types.ts` (target contract) and optionally bridge via `WebhookTrigger`/`PollingTrigger` classes during migration.

### Don't
- Skip deduplication — always implement `computeDedupKey` / `idempotencyKey`.
- Directly enqueue BullMQ jobs from trigger processing — use the outbox.
- Add raw SQL to `packages/services/src/triggers/db.ts` — use Drizzle query builder (exception: `claimBatch` in webhook-inbox uses raw SQL for `FOR UPDATE SKIP LOCKED`).
- Log raw webhook payloads (may contain sensitive data). Log trigger IDs, event counts, and provider names instead.
- Process webhooks synchronously in Express routes — always use the inbox pattern.
- Schedule per-trigger polling jobs — use poll groups.

### Error Handling
```typescript
// Skipped events are always recorded for auditability
async function safeCreateSkippedEvent(input) {
  try {
    await triggers.createSkippedEvent(input);
  } catch (err) {
    logger.error({ err }, "Failed to create skipped event");
  }
}
```

### Reliability
- **Webhook inbox concurrency**: `claimBatch()` uses `SELECT FOR UPDATE SKIP LOCKED` for safe concurrent processing. Worker drains every 5 seconds with configurable batch size (default 10).
- **Webhook signature verification**: Nango HMAC-SHA256 via `verifyNangoSignature()` using `timingSafeEqual`. Provider-specific signatures (Linear-Signature, X-Hub-Signature-256, Sentry-Hook-Signature, X-PostHog-Signature) verified by provider adapters.
- **Inbox garbage collection**: BullMQ worker runs hourly, deleting completed/failed rows older than 7 days to prevent PostgreSQL bloat.
- **Polling concurrency**: Redis lock per poll group (`poll:<groupId>`) with 120-second TTL prevents concurrent polls for the same group.
- **Polling job options**: Repeatable BullMQ jobs per poll group, scheduled at startup via `scheduleEnabledPollGroups()`.
- **Idempotency**: Unique index `(trigger_id, dedup_key)` prevents duplicate event processing.

---

## 6. Subsystem Deep Dives

### 6.1 Async Webhook Ingestion

**What it does:** Receives webhooks via fast-ack Express routes, stores in `webhook_inbox`, and processes asynchronously via BullMQ worker. **Status: Implemented.**

**Phase 1 — Fast-Ack Express Route (`apps/trigger-service/src/api/webhooks.ts`):**
1. `POST /webhooks/nango` receives a Nango-forwarded webhook.
2. `dispatchIntegrationWebhook("nango", req)` verifies the Nango HMAC signature and extracts provider + connectionId from the forward envelope.
3. The route calls `webhookInbox.insertInboxRow()` to store the raw payload with provider and headers.
4. Returns `200 OK` immediately. No parsing, no matching, no run creation.

**Phase 1b — Direct Provider Route:**
1. `POST /webhooks/direct/:providerId` receives webhooks from providers that bypass Nango.
2. Stores the raw payload in the inbox with the provider ID.
3. Returns `200 OK` immediately.

**Phase 2 — BullMQ Inbox Worker (`apps/trigger-service/src/webhook-inbox/worker.ts`):**
1. A repeatable BullMQ job fires every 5 seconds.
2. `claimBatch()` uses `SELECT FOR UPDATE SKIP LOCKED` to safely claim pending rows.
3. For each row, the worker:
   - Extracts `connectionId` from the Nango payload.
   - Resolves the integration via `integrations.findByConnectionIdAndProvider()`.
   - Finds active webhook triggers for that integration.
   - Resolves trigger definitions from the registry via `registry.webhooksByProvider()`.
   - Parses events using the trigger definition's `webhook()` method.
   - Calls `processTriggerEvents()` to filter, dedup, and create runs.
4. On success, marks the row `completed`. On failure, marks it `failed` with error message.

**Edge cases:**
- No connectionId in payload (direct webhook) → throws error (direct processing not yet fully implemented).
- Integration not found for connectionId → row marked completed, no events processed.
- No active triggers for integration → row marked completed.
- Invalid Nango signature → `401` response (rejected at fast-ack layer, never reaches inbox).
- Inbox worker failure → row stays in `processing` state until manually resolved or re-claimed.

**Files touched:** `apps/trigger-service/src/api/webhooks.ts`, `apps/trigger-service/src/webhook-inbox/worker.ts`, `apps/trigger-service/src/lib/webhook-dispatcher.ts`, `apps/trigger-service/src/lib/trigger-processor.ts`, `packages/services/src/webhook-inbox/db.ts`

### 6.2 Inbox Garbage Collection

**What it does:** Periodically deletes old completed/failed webhook inbox rows to prevent PostgreSQL table bloat. **Status: Implemented.**

**Happy path:**
1. A repeatable BullMQ job fires every hour.
2. `webhookInbox.gcOldRows(retentionDays)` deletes rows where `status IN ('completed', 'failed') AND processed_at < NOW() - INTERVAL '7 days'`.
3. Logs the number of deleted rows.

**Files touched:** `apps/trigger-service/src/gc/inbox-gc.ts`, `packages/services/src/webhook-inbox/db.ts`

### 6.3 Integration-Scoped Polling (Poll Groups)

**What it does:** Polls external APIs efficiently using one job per integration group, then fans out events in-memory. **Status: Implemented.**

**Happy path:**
1. When a polling trigger is created/updated, the service calls `pollGroups.findOrCreateGroup()` to ensure a poll group exists for `(org, provider, integration)`, then schedules a BullMQ repeatable job for the group.
2. At startup, `scheduleEnabledPollGroups()` schedules jobs for all enabled groups.
3. The poll group worker (`apps/trigger-service/src/polling/worker.ts`) processes each job:
   - Loads the poll group row.
   - Acquires a Redis lock (`poll:<groupId>`) with 120-second TTL to prevent concurrent polls.
   - Finds all active polling triggers in the group via `pollGroups.findTriggersForGroup()`.
   - Resolves the integration's connectionId.
   - Calls the polling trigger's `poll(connection, config, cursor)` once for the group.
   - Updates the group cursor via `pollGroups.updateGroupCursor()`.
   - **In-memory fan-out:** iterates events across all triggers in the group, calling `processTriggerEvents()` for each.
4. On trigger disable/delete, orphaned poll groups (with no matching active triggers) are cleaned up via `pollGroups.deleteOrphanedGroups()`.

**Edge cases:**
- Redis lock already held → skips this poll cycle (prevents concurrent polls).
- No active triggers in group → skips (group may be orphaned).
- Missing connectionId → logs warning, returns.
- Cursor missing → first poll (cursor = null).

**Files touched:** `apps/trigger-service/src/polling/worker.ts`, `packages/services/src/poll-groups/db.ts`, `packages/services/src/triggers/service.ts`

### 6.4 Trigger CRUD

**What it does:** oRPC routes for managing triggers. **Status: Implemented.**

**Happy path:**
1. `create` validates prebuild and integration existence, generates `webhookUrlPath` (UUID-based) and `webhookSecret` (32-byte hex) for webhook triggers, creates an automation parent record, then creates the trigger. For polling triggers, finds or creates a poll group and schedules a BullMQ repeatable job.
2. `update` modifies trigger fields. For polling triggers, reschedules or removes the repeatable job based on `enabled` state and `pollingCron`.
3. `delete` removes the trigger (cascades to events). For polling triggers, cleans up orphaned poll groups.
4. `list` returns triggers with integration data and pending event counts.
5. `get` returns a single trigger with recent events and event status counts.
6. `listEvents` returns paginated events with trigger and session relations.
7. `skipEvent` marks a queued event as `skipped` with reason `manual`.

**Files touched:** `apps/web/src/server/routers/triggers.ts`, `packages/services/src/triggers/service.ts`, `packages/services/src/triggers/db.ts`

### 6.5 Provider Adapters

**What it does:** Provider-specific parsing, filtering, and context extraction. **Status: varies by provider.**

#### GitHub (Implemented — webhook only)
- Events: issues, pull_request, push, check_suite, check_run, workflow_run.
- Filters: event types, actions, branches, labels, repos, conclusions.
- Verification: `X-Hub-Signature-256` (HMAC-SHA256). In Nango flow, Nango signature is checked instead.
- Dedup key: `github:{itemId}:{action}`.
- Files: `packages/triggers/src/github.ts`, `packages/triggers/src/service/adapters/github-nango.ts`

#### Linear (Implemented — webhook + polling)
- Webhook: Issue events only (create/update, not remove).
- Polling: GraphQL `issues` query with team filter, cursor-based pagination.
- Filters: team, state, priority, labels, assignees, projects, action.
- Verification: `Linear-Signature` (HMAC-SHA256).
- Dedup key: `linear:{issueId}:{action}`.
- Files: `packages/triggers/src/linear.ts`, `packages/triggers/src/service/adapters/linear-nango.ts`

#### Sentry (Implemented — webhook only)
- Requires `data.issue` in payload; parses issue + optional event data.
- Filters: project slug, environments (from tags), minimum severity level (ordered: debug < info < warning < error < fatal).
- Verification: `Sentry-Hook-Signature` (HMAC-SHA256).
- Context includes stack trace extraction (last 10 frames) and related files.
- Dedup key: `sentry:{eventId}` (falls back to issue ID).
- Files: `packages/triggers/src/sentry.ts`, `packages/triggers/src/service/adapters/sentry-nango.ts`

#### PostHog (Implemented — webhook only, HMAC validation)
- Normalizes flexible payload format (event can be string or object).
- Filters: event names, property key-value matching.
- Verification: `X-PostHog-Signature` (HMAC-SHA256) or `X-PostHog-Token` / `Authorization` bearer token fallback.
- Dedup key: `posthog:{uuid}` or composite `posthog:{event}:{distinctId}:{timestamp}`.
- Files: `packages/triggers/src/posthog.ts`

#### Gmail (Partial — polling via Composio)
- Uses Composio connected accounts to obtain Gmail OAuth tokens.
- Polls Gmail History API (`history.list` with `messageAdded` type), fetches metadata for new messages.
- Filters: label IDs.
- Only registered when `COMPOSIO_API_KEY` env var is set.
- Token refresh: retries once on 401.
- Files: `packages/triggers/src/service/adapters/gmail.ts`

#### Manual Run Trigger (Implemented — via automation service)
- Not a traditional provider — created on-demand by `triggerManualRun()` when users click "Run Now" in the automation detail page.
- Uses `provider: "webhook"`, `triggerType: "webhook"`, `enabled: false` with `config: { _manual: true }` flag to distinguish from real webhook triggers.
- The trigger is disabled (`enabled: false`) so it never participates in webhook ingestion or matching.
- `findManualTrigger()` queries by JSONB `config->>'_manual' = 'true'` rather than by provider value.
- The UI filters manual triggers from display using the `config._manual` flag.
- Files: `packages/services/src/automations/service.ts:triggerManualRun`, `packages/services/src/automations/db.ts:findManualTrigger`

### 6.6 Schedule CRUD

**What it does:** Manages cron schedules attached to automations. **Status: Implemented.**

**Happy path:**
1. `getSchedule(id, orgId)` returns a single schedule.
2. `updateSchedule(id, orgId, input)` validates cron expression (5-6 fields) and updates.
3. `deleteSchedule(id, orgId)` removes the schedule.
4. `createSchedule` (called from automations context) validates cron and inserts.

**Files touched:** `apps/web/src/server/routers/schedules.ts`, `packages/services/src/schedules/service.ts`, `packages/services/src/schedules/db.ts`

### 6.7 PubSub Session Events Subscriber

**What it does:** Listens on Redis PubSub for session events and wakes async clients (e.g., Slack). **Status: Implemented.**

**Happy path:**
1. `SessionSubscriber` subscribes to `SESSION_EVENTS_CHANNEL` on Redis.
2. On `user_message` events, looks up the session's `clientType`.
3. Finds the registered `WakeableClient` for that type and calls `wake(sessionId, metadata, source, options)`.

**Edge cases:**
- Session has no async client → no-op.
- No registered client for type → logs warning.

**Files touched:** `apps/worker/src/pubsub/session-events.ts`

### 6.8 Provider Registry & Metadata API

**What it does:** Exposes registered trigger providers and their config schemas. **Status: Implemented.**

**Happy path:**
1. `GET /providers` iterates all registered triggers and returns ID, provider name, type (webhook/polling), metadata, and JSON Schema from Zod config schema.
2. `GET /providers/:id` returns a single provider definition.

**Files touched:** `apps/trigger-service/src/api/providers.ts`, `packages/triggers/src/service/registry.ts`

### 6.9 Web App Webhook Routes (Lifecycle Only)

**What it does:** Next.js API routes that handle non-trigger webhook events (auth lifecycle, installation management). Trigger event processing has been moved to the trigger service. **Status: Implemented.**

#### Nango route (`/api/webhooks/nango`)
- Verifies `X-Nango-Hmac-Sha256` signature.
- Handles `auth` webhooks (updates integration status on creation, override, refresh failure).
- Handles `sync` webhooks (logged only).
- `forward` webhooks return `200` with a migration stub — actual processing happens in the trigger service.
- File: `apps/web/src/app/api/webhooks/nango/route.ts`

#### GitHub App route (`/api/webhooks/github-app`)
- Receives webhooks directly from GitHub App installations (not via Nango).
- Verifies `X-Hub-Signature-256` using `GITHUB_APP_WEBHOOK_SECRET`.
- Handles installation lifecycle events only (deleted, suspend, unsuspend) by updating integration status.
- All other GitHub events return `200` with a migration message — processing happens in the trigger service via Nango forwarding.
- File: `apps/web/src/app/api/webhooks/github-app/route.ts`

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| Automations | Triggers → Automations | `runs.createRunFromTriggerEvent()` | Handoff point. Creates trigger event + automation run + outbox entry in one transaction. |
| Providers package | Trigger service → Providers | `ProviderTriggers` contract, `ProviderRegistry` | Target interface for integration modules. Defines `NormalizedTriggerEvent`, `verify()`, `parse()`, `matches()`, `poll()`. |
| Integrations | Triggers → Integrations | `integrations.findByConnectionIdAndProvider()`, `integrations.findActiveByGitHubInstallationId()` | Resolves Nango connectionId or GitHub installation ID to integration record. |
| Integrations | Triggers ← Integrations | `trigger.integrationId` FK | Trigger references its OAuth connection. |
| Queue (BullMQ) | Triggers → Queue | `createWebhookInboxQueue()`, `createPollGroupQueue()`, `schedulePollGroupJob()` | Inbox drain (every 5s), inbox GC (hourly), poll group repeatable jobs. |
| Redis | Triggers → Redis | `REDIS_KEYS.pollGroupLock(groupId)` | Lock for poll group concurrency control. |
| Outbox | Triggers → Outbox | `outbox.insert({ kind: "enqueue_enrich" })` | Reliable handoff to automation run pipeline. See `automations-runs.md`. |
| Sessions | Events → Sessions | `trigger_events.session_id` FK | Links event to resulting session (set after run execution). |
| Secrets | Triggers → Secrets | webhook secrets | Webhook verification secrets stored on trigger rows or resolved from provider config. |

### Security & Auth
- **Trigger CRUD**: Protected by `orgProcedure` middleware (requires authenticated user + org membership).
- **Trigger-service webhooks**: Public endpoints. Signature verified at ingestion layer:
  - Nango route: `verifyNangoSignature()` using Nango HMAC-SHA256 (`timingSafeEqual`).
  - Direct route: deferred to inbox worker via `ProviderTriggers.webhook.verify()` (when fully implemented).
- **Web app webhook routes**: Public endpoints for lifecycle events only. Signature verification:
  - Nango route: `X-Nango-Hmac-Sha256` header.
  - GitHub App route: `X-Hub-Signature-256` header against `GITHUB_APP_WEBHOOK_SECRET` env var.
- **Webhook secrets**: 32-byte random hex stored in DB. Generated on trigger creation.
- Provider verification must not leak secrets in error messages or logs.

### Observability
- Trigger service logger: `@proliferate/logger` with `{ service: "trigger-service" }`.
- Child loggers per module: `{ module: "webhooks" }`, `{ module: "webhook-inbox-worker" }`, `{ module: "poll-groups" }`, `{ module: "inbox-gc" }`, `{ module: "trigger-processor" }`.
- Structured fields: `triggerId`, `connectionId`, `sessionId`, `groupId`, `inboxId`, `provider`.
- Metrics to track: webhook request counts by provider, inbox queue depth, inbox drain latency, parse failures, dedup hits, poll duration, poll backoffs, run creation failures.
- **Inbox garbage collection**: Hourly cron deletes `completed`/`failed` rows older than 7 days to prevent PostgreSQL bloat.

---

## 8. Acceptance Gates

- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] Relevant tests pass (`pnpm test`)
- [ ] All webhook ingestion routes through trigger-service fast-ack pattern
- [ ] `NormalizedTriggerEvent` types compile with no strict errors
- [ ] Orphaned poll groups are correctly removed (when the last trigger in a group is deleted, the BullMQ job is unscheduled)
- [ ] This spec is updated (file tree, data models, deep dives)

---

## 9. Known Limitations & Tech Debt

- [ ] **SCHEDULED queue worker not instantiated** — `createScheduledWorker()` exists in `packages/queue/src/index.ts` and jobs can be enqueued, but no worker is started in any running service. The scheduled trigger worker was archived (`apps/worker/src/_archived/`). Cron-based triggers that rely on this queue do not execute. — High impact.
- [ ] **Dual abstraction layers** — Both `TriggerProvider` interface (`packages/triggers/src/types.ts`) and `WebhookTrigger`/`PollingTrigger` classes (`packages/triggers/src/service/base.ts`) coexist alongside the target `ProviderTriggers` contract (`packages/providers/src/types.ts`). The inbox worker still uses the class-based registry. Should consolidate all providers to the `ProviderTriggers` interface. — Medium complexity.
- [ ] **Direct webhook processing not yet implemented** — The `POST /webhooks/direct/:providerId` route stores payloads in the inbox, but the inbox worker only handles Nango-forwarded webhooks (requires `connectionId`). Direct provider webhooks need identity resolution via `ProviderTriggers.webhook.verify()`. — Medium impact.
- [ ] **Deprecated trigger fields** — `name`, `description`, `executionMode`, `allowAgenticRepoSelection`, `agentInstructions` on the triggers table are deprecated in favor of the parent automation's fields, but still populated on create. — Low impact, remove when safe.
- [ ] **Gmail provider requires Composio** — Gmail polling uses Composio as an OAuth token broker, adding an external dependency. Only registered when `COMPOSIO_API_KEY` is set. Full implementation exists but external dependency makes it Partial.
- [ ] **PostHog not registered in trigger service** — The `PostHogProvider` exists in `packages/triggers/src/posthog.ts` and registers in the functional provider registry, but there is no `PostHogNangoTrigger` adapter in `service/adapters/`. PostHog webhooks were previously handled via a separate web app API route (now removed). Needs a trigger-service adapter or migration to `ProviderTriggers`. — Medium impact.
- [ ] **No retry logic for failed trigger event processing** — If `createRunFromTriggerEvent` fails, the event is marked as skipped with reason `run_create_failed`. There is no automatic retry mechanism. — Events can be manually retried via re-processing.
- [ ] **HMAC helper duplication** — The `hmacSha256` function is duplicated across `github.ts`, `linear.ts`, `sentry.ts`, `posthog.ts`, and the web app Nango route. Should be extracted to a shared utility (the `ProviderTriggers` architecture uses `packages/providers/src/helpers/` for this). — Low impact.
- [ ] **Manual triggers use webhook provider** — Manual run triggers are stored with `provider: "webhook"` and a `config._manual` JSONB flag rather than a dedicated provider value. This avoids enum violations but means manual triggers are distinguished only by their config, not by a first-class provider type. Impact: low — `findManualTrigger` queries by config flag reliably. Expected fix: add "manual" to the `TriggerProviderSchema` enum when a migration is appropriate.
- [ ] **Providers with expiring webhook registrations** — Providers like Jira that require webhook registration refresh need a refresh job and `external_webhook_id` persistence (deferred to Jira implementation).
- [ ] **Secret resolution chicken-and-egg** — For per-integration secrets (e.g., PostHog), the framework must extract a "candidate identity" from URL params or headers, look up the secret from the DB, and *then* call `verify()`. Not yet implemented for the direct webhook path.
- [ ] **Legacy per-trigger polling state** — The `polling_state` JSONB column on the `triggers` table and Redis `poll:{triggerId}` keys are legacy from per-trigger polling. Poll groups now own cursor state. Legacy columns should be removed once all polling triggers are migrated to groups.
