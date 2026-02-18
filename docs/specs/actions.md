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
