# Consolidated Specs: Canonical vs vNext

Generated: 2026-02-15
HEAD: 27cd38275f78c39ffef968232bef5098bfce3b7f

Included pairs:
- actions
- agent-contract
- sandbox-providers
- sessions-gateway
- integrations
- triggers

This file is for review: it concatenates canonical specs from docs/specs/ and vNext specs from docs/specs/vnext/.

## Old version of actions (canonical)

Source: `docs/specs/actions.md`

````markdown
# Actions — System Spec

## 1. Scope & Purpose

### In Scope
- Action invocation lifecycle: pending → approved/denied → expired
- Risk classification: read / write / danger
- Grant system: create, evaluate, revoke, call budgets
- Gateway action routes (invoke, approve, deny, list, grants, guide)
- Integration guide/bootstrap flow
- Linear adapter
- Sentry adapter
- Slack adapter
- Invocation sweeper (expiry job)
- Sandbox-MCP grants handler
- Actions list (org-level inbox)

### Out of Scope
- Tool schema definitions (how `proliferate` CLI tools get injected into sandboxes) — see `agent-contract.md` §6.3
- Session runtime (hub, WebSocket streaming, event processing) — see `sessions-gateway.md` §6
- Integration OAuth flows for Linear/Sentry (connection lifecycle) — see `integrations.md`
- Automation runs that invoke actions — see `automations-runs.md` §6

### Mental Model

Actions are platform-mediated operations that the agent performs on external services. Implemented action sources are (a) hand-written Linear/Sentry/Slack adapters and (b) connector-backed MCP `remote_http` sources discovered from prebuild connector config. Planned direction: connector discovery moves to an org-scoped catalog owned by `integrations.md`, so all sessions in an org see the same connector-backed sources by default. Unlike tools that run inside the sandbox, actions are executed server-side by the gateway using either OAuth tokens (`integrations.getToken`) or org-scoped secrets (`secrets.resolveSecretValue`) depending on source type. Every action goes through a risk-based approval pipeline before execution (`packages/services/src/actions/service.ts:invokeAction`).

The agent invokes actions via the `proliferate` CLI inside the sandbox. The CLI sends HTTP requests to the gateway (`apps/gateway/src/api/proliferate/http/actions.ts`), which evaluates risk, checks for matching grants, and either auto-executes or queues the invocation for human approval. Users approve or deny pending invocations through the web dashboard or WebSocket events.

**Core entities:**
- **Invocation** — a single request to execute an action, with its approval state. Lifecycle: pending → approved → executing → completed (or denied/expired/failed).
- **Grant** — a reusable permission allowing the agent to perform a specific action without per-invocation approval. Scoped to session or org, with optional call budgets.
- **Adapter** — an integration-specific module that declares available actions and implements execution against the external API.
- **Action source** — the origin of an action definition. Implemented sources are static adapters and connector-backed MCP sources (both execute through the same lifecycle).

**Key invariants:**
- Read actions are always auto-approved. Danger actions are always denied. Only write actions enter the approval pipeline. Source: `packages/services/src/actions/service.ts:125-141`
- Grants are evaluated atomically via CAS (compare-and-swap) to prevent concurrent overuse of call budgets. Source: `packages/services/src/actions/grants-db.ts:consumeGrantCall`
- A session can have at most 10 pending invocations simultaneously (`MAX_PENDING_PER_SESSION`). Source: `packages/services/src/actions/service.ts:46`
- Pending invocations expire after 5 minutes if not approved or denied (`PENDING_EXPIRY_MS`). Source: `packages/services/src/actions/service.ts:45`
- Results stored in the DB are redacted (sensitive keys removed) and truncated (max 10KB). Source: `packages/services/src/actions/service.ts:62-84`

---

## 2. Core Concepts

### Risk Classification
Every action definition declares a `riskLevel`: `read`, `write`, or `danger`. This controls the approval flow — reads auto-execute, writes require approval (or a matching grant), and danger actions are unconditionally denied.
- Key detail agents get wrong: there is no "danger" action currently defined in any adapter. The level exists in the type system and service logic but has no adapter-level use yet.
- Reference: `packages/services/src/actions/service.ts:invokeAction`

### Grant Evaluation (CAS Pattern)
When a write action is invoked, the service checks for a matching grant before requiring approval. Matching uses exact integration/action or wildcard (`*`). The `consumeGrantCall` function uses a CAS-style SQL UPDATE with WHERE conditions to atomically decrement the budget, preventing concurrent requests from double-spending.
- Key detail agents get wrong: grants can use wildcards for both `integration` and `action` fields. A grant with `integration="*"` and `action="*"` auto-approves any write action.
- Reference: `packages/services/src/actions/grants-db.ts:consumeGrantCall`

### Adapter Registry
Adapters are statically registered in a `Map`. Currently three adapters exist: `linear`, `sentry`, and `slack`. Each adapter declares its actions, their risk levels, parameter schemas, an `execute()` function, and an optional markdown `guide`.
- Key detail agents get wrong: adapters are not dynamically discovered. Adding a new OAuth-style adapter requires code changes to the registry, but adding a connector-backed source does not.
- Reference: `packages/services/src/actions/adapters/index.ts`

### Action Source Boundary
Two action source types coexist:
1. **Static adapters** — hand-written Linear, Sentry, Slack adapters registered in `packages/services/src/actions/adapters/index.ts`. Require OAuth integration connections per session.
2. **Connector-backed actions** — MCP `remote_http` connectors discovered at runtime. Current implementation resolves connector config from prebuilds. Planned direction resolves the same connector shape from an org-scoped catalog. Connector actions use the `connector:<uuid>` integration prefix to distinguish them from static adapters in the `integration` column.

Both source types share the same risk/approval/grant/audit lifecycle. The merge point is `GET /available` in `apps/gateway/src/api/proliferate/http/actions.ts`, which returns adapter-based and connector-based integrations in a single list.

- Key detail agents get wrong: connector actions pass `integrationId: null` in invocations since they don't use OAuth connections. The `integration` field contains `connector:<uuid>` which uniquely identifies the connector.
- Key detail agents get wrong: MCP tool annotations (`readOnlyHint`, `destructiveHint`) are mapped to risk levels with a safe "write" fallback. Per-tool and per-connector policy overrides take precedence. See `packages/services/src/actions/connectors/risk.ts`.
- Reference: `packages/services/src/actions/connectors/`, `apps/gateway/src/api/proliferate/http/actions.ts`

### Actions Bootstrap
During sandbox setup, a markdown file (`actions-guide.md`) is written to `.proliferate/` inside the sandbox. This file documents the `proliferate actions` CLI commands (list, guide, run). The agent reads this file to discover available integrations.
- Key detail agents get wrong: the bootstrap guide is static — it does not list which integrations are connected. The agent must run `proliferate actions list` at runtime to discover connected integrations.
- Reference: `packages/shared/src/sandbox/config.ts:ACTIONS_BOOTSTRAP`

---

## 3. File Tree

```
packages/services/src/actions/
├── index.ts                          # Module exports
├── service.ts                        # Business logic (invoke, approve, deny, expire)
├── service.test.ts                   # Service unit tests
├── db.ts                             # Drizzle queries for action_invocations
├── grants.ts                         # Grant service (create, evaluate, revoke)
├── grants.test.ts                    # Grant service unit tests
├── grants-db.ts                      # Drizzle queries for action_grants
├── grants-db.test.ts                 # Grant DB unit tests
├── guide.test.ts                     # Guide retrieval tests
├── adapters/
│   ├── index.ts                      # Adapter registry (Map-based)
│   ├── types.ts                      # ActionAdapter / ActionDefinition interfaces
│   ├── linear.ts                     # Linear GraphQL adapter (5 actions)
│   ├── sentry.ts                     # Sentry REST adapter (5 actions)
│   └── slack.ts                      # Slack REST adapter (1 action)
└── connectors/
    ├── index.ts                      # Re-exports (listConnectorTools, callConnectorTool, etc.)
    ├── client.ts                     # MCP client (list tools, call tool, schema conversion)
    ├── client.test.ts                # schemaToParams unit tests
    ├── risk.ts                       # MCP annotations → risk level mapping
    ├── risk.test.ts                  # deriveRiskLevel unit tests
    └── types.ts                      # ConnectorToolList, ConnectorCallResult

apps/gateway/src/api/proliferate/http/
├── actions.ts                        # Gateway HTTP routes for actions
└── actions.test.ts                   # Route handler tests

apps/worker/src/sweepers/
└── index.ts                          # Action expiry sweeper (setInterval)

packages/sandbox-mcp/src/
└── actions-grants.ts                 # CLI grant command handlers (sandbox-side)

packages/db/src/schema/
├── schema.ts                         # actionInvocations + actionGrants table definitions
└── relations.ts                      # Drizzle relations for both tables

apps/web/src/server/routers/
└── actions.ts                        # oRPC router for org-level actions inbox
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
├── integration       TEXT NOT NULL                     -- adapter name ("linear", "sentry", "slack")
├── action            TEXT NOT NULL                     -- action name ("create_issue", etc.)
├── risk_level        TEXT NOT NULL                     -- "read" | "write" | "danger"
├── params            JSONB                             -- action parameters (redacted before store)
├── status            TEXT NOT NULL DEFAULT 'pending'   -- lifecycle state
├── result            JSONB                             -- execution result (redacted, truncated)
├── error             TEXT                              -- error message on failure
├── duration_ms       INTEGER                           -- execution time
├── approved_by       TEXT                              -- user ID who approved/denied
├── approved_at       TIMESTAMPTZ
├── completed_at      TIMESTAMPTZ
├── expires_at        TIMESTAMPTZ                       -- 5min TTL for pending invocations
└── created_at        TIMESTAMPTZ DEFAULT now()

action_grants
├── id                UUID PRIMARY KEY DEFAULT gen_random_uuid()
├── organization_id   TEXT NOT NULL FK → organization(id) ON DELETE CASCADE
├── created_by        TEXT NOT NULL FK → user(id) ON DELETE CASCADE  -- see §9 caveat
├── session_id        UUID FK → sessions(id) ON DELETE CASCADE  -- NULL = org-wide
├── integration       TEXT NOT NULL                     -- adapter name or "*" wildcard
├── action            TEXT NOT NULL                     -- action name or "*" wildcard
├── max_calls         INTEGER                           -- NULL = unlimited
├── used_calls        INTEGER NOT NULL DEFAULT 0
├── expires_at        TIMESTAMPTZ                       -- NULL = no expiry
├── revoked_at        TIMESTAMPTZ                       -- set on revocation
└── created_at        TIMESTAMPTZ DEFAULT now()
```

### Core TypeScript Types

```typescript
// packages/services/src/actions/adapters/types.ts
interface ActionParam {
  name: string;
  type: "string" | "number" | "boolean" | "object";
  required: boolean;
  description: string;
}

interface ActionDefinition {
  name: string;
  description: string;
  riskLevel: "read" | "write" | "danger";
  params: ActionParam[];
}

interface ActionAdapter {
  integration: string;
  actions: ActionDefinition[];
  guide?: string;
  execute(action: string, params: Record<string, unknown>, token: string): Promise<unknown>;
}

// packages/services/src/actions/service.ts
type ActionStatus = "pending" | "approved" | "executing" | "completed"
                  | "denied" | "failed" | "expired";
```

### Key Indexes & Query Patterns
- `idx_action_invocations_session` (session_id) — `listBySession`, `listPendingBySession`
- `idx_action_invocations_org_created` (organization_id, created_at) — `listByOrg`, `countByOrg`
- `idx_action_invocations_status_expires` (status, expires_at) — `expirePendingInvocations` sweeper
- `idx_action_grants_org` (organization_id) — `listActiveGrants`, `listGrantsByOrg`
- `idx_action_grants_lookup` (organization_id, integration, action) — `findMatchingGrants`

---

## 5. Conventions & Patterns

### Do
- Add new adapters in `packages/services/src/actions/adapters/` and register them in `adapters/index.ts` — one adapter per integration.
- Use the `ActionAdapter` interface for all adapters — ensures consistent action definition and execution contracts.
- Set `AbortSignal.timeout(30_000)` on all external API calls — both adapters enforce a 30s timeout.
- Redact results via `redactData()` before storing — sensitive keys (token, secret, password, authorization, api_key, apikey) are stripped.

### Don't
- Return `{ ok: false }` error objects from service functions — throw typed errors (`ActionNotFoundError`, `ActionExpiredError`, `ActionConflictError`, `PendingLimitError`).
- Store raw external API responses — always pass through `redactData()` and `truncateResult()` (10KB max).
- Approve/deny from sandbox tokens — only user tokens with admin/owner role can approve or deny invocations.

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
- **Invocation expiry**: 5-minute TTL on pending invocations (`PENDING_EXPIRY_MS`). Source: `packages/services/src/actions/service.ts:PENDING_EXPIRY_MS`
- **Pending cap**: Max 10 pending invocations per session (`MAX_PENDING_PER_SESSION`). Source: `packages/services/src/actions/service.ts:MAX_PENDING_PER_SESSION`
- **Rate limiting**: 60 invocations per minute per session (in-memory counter in gateway). Source: `apps/gateway/src/api/proliferate/http/actions.ts:checkInvokeRateLimit`
- **Grant CAS**: Atomic `UPDATE ... WHERE usedCalls < maxCalls` prevents budget overuse. Source: `packages/services/src/actions/grants-db.ts:consumeGrantCall`
- **Grant rollback**: If invocation approval fails after grant creation, the grant is revoked (best-effort). Source: `packages/services/src/actions/service.ts:approveActionWithGrant`
- **External API timeout**: 30s on Linear, Sentry, and Slack adapters.

### Testing Conventions
- Mock `./db` and `./grants` modules for service tests — never hit the database.
- Mock `../logger` to suppress log output.
- Use `makeInvocationRow()` / `makeGrant()` helpers for test data.
- Grant concurrency tests verify CAS semantics using sequential `mockResolvedValueOnce` chains.

---

## 6. Subsystem Deep Dives

### 6.1 Action Invocation Lifecycle — `Implemented`

**What it does:** Routes an action through risk classification, grant evaluation, approval, execution, and result storage.

**Invoke response contracts:**

| Outcome | HTTP | Response shape |
|---------|------|----------------|
| Auto-approved (read or grant-matched write) | 200 | `{ invocation, result }` |
| Pending approval (write, no grant) | 202 | `{ invocation, message: "Action requires approval" }` |
| Denied (danger) | 403 | `{ invocation, error }` |
| Pending cap exceeded | 429 | `{ error }` |

**Happy path (write action, no grant):**
1. Agent calls `proliferate actions run --integration linear --action create_issue --params '{...}'`
2. Sandbox-MCP CLI sends `POST /:sessionId/actions/invoke` to gateway (`actions.ts` invoke handler)
3. Gateway validates adapter via `getAdapter(integration)` (`adapters/index.ts:getAdapter`), finds session connections via `sessions.listSessionConnections(sessionId)`, resolves org via `sessions.findByIdInternal(sessionId)`
4. Calls `invokeAction()` (`service.ts:invokeAction`) — risk = write, no matching grant → creates pending invocation with 5-min expiry
5. Gateway broadcasts `action_approval_request` to WebSocket clients via `hub.broadcastMessage()`
6. Returns HTTP 202 `{ invocation, message: "Action requires approval" }` — sandbox CLI blocks polling `GET /:sessionId/actions/invocations/:id`
7. User approves via `POST /:sessionId/actions/invocations/:id/approve` — admin/owner role required (`actions.ts:requireAdminRole`)
8. Gateway calls `approveAction()` (`service.ts:approveAction`), then `markExecuting()` (`service.ts:markExecuting`), resolves integration token via `integrations.getToken()`, calls `adapter.execute()`
9. On success: `markCompleted()` (`service.ts:markCompleted`) with redacted/truncated result, broadcasts `action_completed` via `hub.broadcastMessage()`. Returns HTTP 200 `{ invocation, result, grant? }`
10. On failure: `markFailed()` (`service.ts:markFailed`) with error message, broadcasts failure, returns HTTP 502

**Edge cases:**
- **Read action** → auto-approved by `invokeAction()` (`service.ts:invokeAction`), executed immediately, returns HTTP 200 `{ invocation, result }`
- **Danger action** → denied by `invokeAction()` (`service.ts:invokeAction`), returns HTTP 403 `{ invocation, error }`
- **Grant match** → auto-approved after CAS consumption via `evaluateGrant()` (`grants.ts:evaluateGrant`), executed immediately
- **Pending cap exceeded** → throws `PendingLimitError`, gateway returns HTTP 429
- **Expired before approval** → `approveAction()` marks expired via `db.ts:updateInvocationStatus`, throws `ActionExpiredError` (410)
- **Already approved/denied** → throws `ActionConflictError` (409)

**Files touched:** `packages/services/src/actions/service.ts`, `apps/gateway/src/api/proliferate/http/actions.ts`

### 6.2 Grant System — `Implemented`

**What it does:** Provides reusable permissions that auto-approve write actions without per-invocation human approval.

**Grant creation paths:**
1. **Via approval**: User approves an invocation with `mode: "grant"` — creates a grant with `createdBy` = the approving user's ID. Source: `service.ts:approveActionWithGrant`
2. **Via sandbox CLI**: Agent calls `POST /:sessionId/actions/grants` — gateway resolves the session and uses `session.createdBy` (user ID) as `createdBy`. If `session.createdBy` is missing, request is rejected with HTTP 400.

**Grant evaluation flow:**
1. `invokeAction()` (`service.ts:invokeAction`) calls `evaluateGrant()` (`grants.ts:evaluateGrant`) for write actions
2. `evaluateGrant()` calls `findMatchingGrants()` (`grants-db.ts:findMatchingGrants`) — DB query matching exact or wildcard (`*`) on integration and action, filtered by org, non-revoked, non-expired, non-exhausted, scoped to session or org-wide
3. For each candidate: `consumeGrantCall()` (`grants-db.ts:consumeGrantCall`) atomically increments `usedCalls` via CAS
4. First successful CAS returns `{ granted: true, grantId }` — invocation auto-approved
5. All CAS failures → `{ granted: false }` — falls through to pending approval

**Grant scoping:**
- `sessionId = NULL` → org-wide grant (matches any session)
- `sessionId = <uuid>` → session-scoped (matches only that session + org-wide grants)
- `maxCalls = NULL` → unlimited uses
- `maxCalls = N` → exactly N uses before exhaustion

**Files touched:** `packages/services/src/actions/grants.ts`, `packages/services/src/actions/grants-db.ts`

### 6.3 Gateway Action Routes — `Implemented`

**What it does:** HTTP API for action invocation, approval, denial, listing, and grants.

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
| POST | `/grants` | Sandbox only | Create a grant |
| GET | `/grants` | Sandbox or User | List active grants |

**Approve modes:**
- `mode: "once"` (default) — approves this invocation only
- `mode: "grant"` — approves this invocation and creates a grant for future similar actions. Accepts `grant: { scope: "session"|"org", maxCalls: number|null }`.

**Files touched:** `apps/gateway/src/api/proliferate/http/actions.ts`

### 6.4 Linear Adapter — `Implemented`

**What it does:** Provides 5 actions against the Linear GraphQL API.

| Action | Risk | Required Params |
|--------|------|-----------------|
| `list_issues` | read | — (optional: teamId, projectId, first, after) |
| `get_issue` | read | issueId |
| `create_issue` | write | teamId, title (optional: description, assigneeId, stateId, priority, labelIds, projectId) |
| `update_issue` | write | issueId (optional: title, description, assigneeId, stateId, priority) |
| `add_comment` | write | issueId, body |

**Implementation:** GraphQL queries/mutations via `fetch` to `https://api.linear.app/graphql`. Token passed as `Authorization` header. 30s timeout. Pagination via cursor (`first`/`after`), capped at 50 results.

**Files touched:** `packages/services/src/actions/adapters/linear.ts`

### 6.5 Sentry Adapter — `Implemented`

**What it does:** Provides 5 actions against the Sentry REST API.

| Action | Risk | Required Params |
|--------|------|-----------------|
| `list_issues` | read | organization_slug, project_slug (optional: query) |
| `get_issue` | read | issue_id |
| `list_issue_events` | read | issue_id |
| `get_event` | read | issue_id, event_id |
| `update_issue` | write | issue_id (optional: status, assignedTo) |

**Implementation:** REST via `fetch` to `https://sentry.io/api/0`. Token as `Bearer` in `Authorization` header. 30s timeout. URL segments properly encoded via `encodeURIComponent`.

**Files touched:** `packages/services/src/actions/adapters/sentry.ts`

### 6.6 Slack Adapter — `Implemented`

**What it does:** Provides a basic Slack write action (`send_message`) against the Slack Web API.

| Action | Risk | Required Params |
|--------|------|-----------------|
| `send_message` | write | `channel`, `text` (optional: `thread_ts`) |

**Implementation:** REST via `fetch` to `https://slack.com/api/chat.postMessage`. Token as `Bearer` in `Authorization` header. 30s timeout. Returns Slack API response JSON when `ok=true`, throws on Slack API errors.

**Files touched:** `packages/services/src/actions/adapters/slack.ts`

### 6.7 Invocation Sweeper — `Implemented`

**What it does:** Periodically marks stale pending invocations as expired.

**Mechanism:** `setInterval` every 60 seconds calling `actions.expireStaleInvocations()`, which runs `UPDATE action_invocations SET status='expired', completed_at=now() WHERE status='pending' AND expires_at <= now()`. Uses the `idx_action_invocations_status_expires` index.

**Lifecycle:** Started by `startActionExpirySweeper(logger)` in the worker process. Stopped by `stopActionExpirySweeper()` on shutdown.

**Files touched:** `apps/worker/src/sweepers/index.ts`, `packages/services/src/actions/db.ts:expirePendingInvocations`

### 6.8 Sandbox-MCP Grants Handler — `Implemented`

**What it does:** Provides CLI command handlers for grant management inside the sandbox.

**Commands:**
- `actions grant request` — creates a grant via `POST /grants`. Flags: `--integration` (required), `--action` (required), `--scope` (session|org, default session), `--max-calls` (optional positive integer).
- `actions grants list` — lists active grants via `GET /grants`.

**Design:** Uses injectable `GatewayRequestFn` for testability — the CLI's `fatal()` calls `process.exit`, so command logic is extracted into pure async functions.

**Files touched:** `packages/sandbox-mcp/src/actions-grants.ts`

### 6.9 Actions List (Org Inbox) — `Implemented`

**What it does:** oRPC route for querying action invocations at the org level, consumed by the inline attention inbox tray.

**Route:** `actions.list` — org-scoped procedure accepting optional `status` filter and `limit`/`offset` pagination (default 50/0, max 100). Returns invocations with session title joined, plus total count for pagination. Dates serialized to ISO strings.

**Frontend surface:** Pending approvals are surfaced via an inline **inbox tray** rendered inside the coding session thread (`apps/web/src/components/coding-session/inbox-tray.tsx`). The tray merges three data sources: current-session WebSocket approval requests, org-level polled pending approvals (via `useOrgActions`), and org-level pending automation runs (via `useOrgPendingRuns`). The merge logic deduplicates WebSocket vs polled approvals by `invocationId` and sorts all items newest-first. A standalone actions page (`apps/web/src/app/dashboard/actions/page.tsx`) also exists with full pagination, status filtering, and grant configuration — sidebar navigation to it was removed but the route remains accessible directly.

**Files touched:** `apps/web/src/server/routers/actions.ts`, `packages/services/src/actions/db.ts:listByOrg`, `apps/web/src/components/coding-session/inbox-tray.tsx`, `apps/web/src/hooks/use-attention-inbox.ts`

### 6.10 Integration Guide Flow — `Implemented`

**What it does:** Serves integration-specific markdown guides to the agent.

**Flow:**
1. Agent calls `proliferate actions guide --integration linear`
2. CLI sends `GET /:sessionId/actions/guide/linear` to gateway (`actions.ts` guide handler)
3. Gateway calls `getGuide("linear")` (`adapters/index.ts:getGuide`) — looks up adapter in registry, returns `adapter.guide`
4. Returns markdown guide with CLI examples for each action

Each adapter embeds its own guide as a static string (e.g., `linearAdapter.guide`, `sentryAdapter.guide`, `slackAdapter.guide`).

**Files touched:** `packages/services/src/actions/adapters/index.ts:getGuide`, adapter files

### 6.11 MCP Connector System — `Implemented` (Prebuild-Scoped) / `Planned` (Org-Scoped Catalog)

**What it does:** Enables remote MCP servers to surface tools through the Actions pipeline, giving agents access to MCP-compatible services while preserving the existing risk/approval/grant/audit flow.

**Architecture:**
```
Current:
Prebuild (connectors JSONB) → Gateway resolves at session runtime
  → MCP Client connects to remote server (StreamableHTTPClientTransport)
  → tools/list → ActionDefinition[] (cached 5 min per session)
  → Merged into GET /available alongside adapter actions
  → POST /invoke → risk/grant evaluation → tools/call on MCP server

Planned:
Org connector catalog (integrations-owned) → Gateway resolves by org/session runtime
  → Same MCP client + risk/grant/audit path
  → Same GET /available merge and invoke behavior
```

**Key components:**
- **Connector config** (`packages/shared/src/connectors.ts`): `ConnectorConfig` type + Zod schemas. Currently stored as JSONB on `prebuilds`. Planned migration is org-scoped connector catalog persistence in the Integrations domain.
- **MCP client** (`packages/services/src/actions/connectors/client.ts`): Stateless — creates a fresh `Client` per `listConnectorTools()` or `callConnectorTool()` call. Uses `@modelcontextprotocol/sdk` (MIT). 15s timeout for tool listing, 30s for calls.
- **Risk derivation** (`packages/services/src/actions/connectors/risk.ts`): Priority: per-tool policy override → MCP annotations (`destructiveHint`→danger, `readOnlyHint`→read; destructive checked first for fail-safe) → connector default risk → "write" fallback.
- **Secret resolution**: Connector `auth.secretKey` references an org-level secret by key name. Resolved at call time via `secrets.resolveSecretValue()`. Keys never enter the sandbox.
- **Gateway integration** (`apps/gateway/src/api/proliferate/http/actions.ts`): In-memory tool cache (`Map<sessionId, CachedConnectorTools[]>`, 5-min TTL). Connector branches in `GET /available`, `GET /guide/:integration`, `POST /invoke`, `POST /approve`. Current connector loading path is session → prebuild. Planned path is session/org → org connector catalog.
- **Integration prefix**: Connector actions use `connector:<uuid>` in the `integration` column. Grants match this as a string (wildcards work). `integrationId` is `null` for connector invocations.

**Connector guide auto-generation:** `GET /guide/connector:<id>` generates a markdown guide from cached tool definitions (name, description, risk level, parameters) instead of using a static adapter guide string.

**Graceful degradation:** If an MCP server is unreachable during `tools/list`, its tools simply don't appear in the available list. Other connectors and static adapters continue working.

**CRUD surface:** Org-level connector CRUD lives in `apps/web/src/server/routers/integrations.ts` (`listConnectors`, `createConnector`, `updateConnector`, `deleteConnector`, `validateConnector`). Management UI is at Settings → Tools (`apps/web/src/app/settings/tools/page.tsx`).

**Files touched:** `packages/services/src/actions/connectors/`, `packages/services/src/connectors/`, `packages/shared/src/connectors.ts`, `packages/services/src/secrets/service.ts`, `apps/gateway/src/api/proliferate/http/actions.ts`, `apps/web/src/server/routers/integrations.ts`

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `integrations.md` | Actions → Integrations | `integrations.getToken()` (`packages/services/src/integrations/tokens.ts:getToken`) | Token resolution for adapter execution |
| `integrations.md` | Actions → Integrations | `sessions.listSessionConnections()` (`packages/services/src/sessions/db.ts`) | Discovers which integrations are available for a session |
| `integrations.md` | Actions ← Integrations | `connectors.listEnabledConnectors(orgId)`, `connectors.getConnector(id, orgId)` | Org-scoped connector catalog; gateway loads enabled connectors by org at session runtime via `loadSessionConnectors()` |
| `secrets-environment.md` | Actions → Secrets | `secrets.resolveSecretValue(orgId, key)` | Resolves + decrypts org secrets for connector auth at call time |
| `sessions-gateway.md` | Actions → Gateway | WebSocket broadcast events | `action_approval_request` (pending write), `action_completed` (execution success/failure, includes `status` field), `action_approval_result` (denial only) |
| `agent-contract.md` | Contract → Actions | `ACTIONS_BOOTSTRAP` in sandbox config | Bootstrap guide written to `.proliferate/actions-guide.md` |
| `agent-contract.md` | Contract → Actions | `proliferate` CLI in system prompts | Prompts document CLI usage for actions |
| `auth-orgs.md` | Actions → Auth | `orgs.getUserRole(userId, orgId)` | Admin/owner role check for approve/deny |

### Security & Auth
- **Sandbox tokens** can invoke actions and create grants but cannot approve/deny.
- **User tokens** with admin/owner role can approve/deny invocations.
- **Member role** users cannot approve/deny (403).
- **Token resolution** happens server-side via the integrations token resolver (`integrations.getToken`) — the sandbox never sees integration OAuth tokens.
- **Result redaction**: sensitive keys (`token`, `secret`, `password`, `authorization`, `api_key`, `apikey`) are stripped before DB storage. Source: `packages/services/src/actions/service.ts:redactData`
- **Result truncation**: results exceeding 10KB are replaced with `{ _truncated: true, _originalSize }`. Source: `packages/services/src/actions/service.ts:truncateResult`

### Observability
- Service functions log via `getServicesLogger().child({ module: "actions" })` or `{ module: "actions.grants" }`.
- Key log events: invocation created (with risk level), grant created/consumed/revoked, expiry sweep counts.
- Gateway rate limit counter cleanup runs every 60s (in-memory, not persisted).

---

## 8. Acceptance Gates

- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] `packages/services/src/actions/*.test.ts` pass
- [ ] `apps/gateway/src/api/proliferate/http/actions.test.ts` passes
- [ ] New adapters implement the `ActionAdapter` interface and are registered in `adapters/index.ts`
- [ ] This spec is updated (file tree, data models, adapter tables)

---

## 9. Known Limitations & Tech Debt

- [ ] **No "danger" actions defined** — the risk level exists in types and service logic but no adapter declares any danger-level action. Impact: the deny-by-default path is untested in production. Expected fix: define danger actions when destructive operations are added (e.g., delete resources).
- [ ] **In-memory rate limiting** — the per-session invocation rate limit (60/min) uses an in-memory Map in the gateway. Multiple gateway instances do not share counters. Impact: effective limit is multiplied by instance count. Expected fix: move to Redis-based rate limiting.
- [ ] **No grant expiry sweeper** — grants with `expiresAt` are filtered out at query time but never cleaned up. Expired grant rows accumulate. Impact: minor DB bloat. Expected fix: add periodic cleanup job similar to invocation sweeper.
- [x] **Static adapter registry** — addressed by MCP connector system (§6.11). Remote MCP connectors are configured without adapter code changes. Scope is org-wide catalog (`org_connectors` table).
- [ ] **Grant rollback is best-effort** — if invocation approval fails after grant creation, the grant revocation is attempted but failures are silently caught. Impact: orphaned grants may exist in rare edge cases. Expected fix: wrap in a transaction or add cleanup sweep.
- [ ] **No pagination on grants list** — `listActiveGrants` and `listGrantsByOrg` return all matching rows with no limit/offset. Impact: could return large result sets for orgs with many grants. Expected fix: add pagination parameters.
- [x] **Connector 404 session recovery** — addressed. `callConnectorTool` retries once on 404 session invalidation by re-initializing a fresh connection. The SDK handles `Mcp-Session-Id` internally within each connection lifecycle. Source: `packages/services/src/actions/connectors/client.ts`.
- [x] **Dedicated connector management UI** — addressed at org scope. Settings → Tools page provides add/edit/remove/validate flow with presets, org secret picker, and inline validation diagnostics. Source: `apps/web/src/app/settings/tools/page.tsx`, `apps/web/src/hooks/use-org-connectors.ts`.
- [x] **Connector scope is org-scoped** — addressed. Connectors are stored in the `org_connectors` table, managed via Integrations CRUD routes, and loaded by org in the gateway. Backfill migration (`0022_org_connectors.sql`) copied legacy prebuild-scoped connectors to org scope.

````

## New version of actions (vNext)

Source: `docs/specs/vnext/actions.md`

````markdown
# Actions — System Spec

> **vNext (target architecture)** — This spec describes the intended Actions runtime after gateway hardening + unified integrations and may not match `main` yet.
>
> Current implemented spec: `../actions.md`  
> Design change sets: `../../../session_changes.md`, `../../../integrations_architecture.md`

Terminology note: this spec uses `IntegrationProvider` / "integration module" for external service integrations (Linear/Sentry/etc). This is distinct from sandbox compute providers (Modal/E2B) in `./sandbox-providers.md`.

## 1. Scope & Purpose

### In Scope
- Action listing and invocation lifecycle (deny, execute immediately, or require approval).
- Source-agnostic permissioning via a three-mode system: `allow` / `deny` / `require_approval`.
- Mode resolution cascade (automation override → org default → inferred default).
- Provider-backed actions surfaced via `IntegrationProvider.actions` (code-defined integrations).
- Connector-backed MCP actions surfaced via `ActionSource` wrappers (dynamic, runtime-discovered tools).
- Database connector actions as `ActionSource` (planned).
- Action definition schemas via Zod, with JSON Schema export for UI and agent guides.
- Connector tool drift detection via action definition hashing (admin re-review required when a tool changes).
- Action guide generation at session start (write `.proliferate/actions-guide.md` into the sandbox).
- Gateway rate limiting for abuse protection (Redis-based, multi-instance safe).

### Out of Scope
- OAuth connection lifecycle and token storage — see `./integrations.md`.
- Trigger ingestion and polling — see `./triggers.md`.
- Automation run pipeline after an action is executed — see `automations-runs.md`.
- Session runtime (hub, WebSocket streaming, sandbox lifecycle) — see `./sessions-gateway.md`, `./sandbox-providers.md`.
- Sandbox tool injection schemas — see `./agent-contract.md`.

### Mental Model

Actions are platform-mediated operations the agent asks the gateway to perform on external services. The agent sees one flat action catalog for a session (`GET /:sessionId/actions/available`) that merges:
- Code-defined integration actions (Linear, Sentry, Slack, GitHub, etc).
- Org-scoped MCP connector tools (runtime-discovered, admin-configured).
- Database connector tools (planned).

Every action invocation resolves to exactly one **mode**:
- `allow`: execute synchronously.
- `deny`: reject synchronously.
- `require_approval`: create a pending invocation and block until a human approves/denies (interactive sessions) or the automation is paused for human approval (unattended runs).

Providers annotate actions with static `risk: "read" | "write"` hints. These hints are only used for inferred defaults when no explicit override exists. Enforcement is entirely via modes.

**Core entities:**
- **Action source** — an origin that can list and execute actions (`ActionSource`), e.g. a provider-backed source (`linear`) or a connector-backed source (`connector:<uuid>`).
- **Action definition** — schema + description + risk hint for a single action, produced by an action source.
- **Invocation** — a persisted record of a single action request and its eventual outcome, including resolved mode and approver metadata.
- **Mode override** — a persisted policy value (`allow|deny|require_approval`) keyed by `(sourceId, actionId)` at org or automation scope.

**Key invariants:**
- Mode resolution is source-agnostic and deterministic: automation override → org default → inferred default.
- Providers are stateless; tokens are injected and all persistence happens in framework code. See `../../../integrations_architecture.md` §2.
- Results stored in the DB are redacted and JSON-truncated (max 10KB) without producing invalid JSON.
- Rate limiting is enforced per session via Redis (`ratelimit:actions:<sessionId>`), so it works across multiple gateway instances.
- MCP tools that change since last admin review are flagged as drifted. `allow` downgrades to `require_approval`; `deny` stays `deny` until an admin explicitly changes it.

---

## 2. Core Concepts

### ActionSource (The Agent-Facing Seam)
All action catalogs and execution paths flow through a single interface:
- `listActions(ctx)` returns `definitions[]` (+ optional `guide`).
- `execute(actionId, params, ctx)` executes the action.
- Key detail agents get wrong: `ActionSource` is the abstraction boundary that keeps the permissioning pipeline provider-agnostic.
- Reference: `../../../integrations_architecture.md` §5

### IntegrationProvider (Code-Defined Integration Modules)
Code-defined integrations are implemented as stateless modules (`IntegrationProvider`) that declare connection requirements, actions, and triggers in one place.
- Key detail agents get wrong: an integration module never reads PostgreSQL/Redis or schedules jobs; it only consumes injected arguments (tokens, cursors, secrets).
- Reference: `../../../integrations_architecture.md` §4, §6, §7

### Three-Mode Permissioning

Every invocation resolves to one mode:
- `allow` executes immediately (synchronous response).
- `deny` returns an error immediately (synchronous response).
- `require_approval` creates a pending invocation and waits for a human decision.

Mode resolution is a simple cascade:
1. Automation override (`automations.action_modes["<sourceId>:<actionId>"]`)
2. Org default (`organizations.action_modes["<sourceId>:<actionId>"]`)
3. Inferred default (from action definition hints)

Inferred defaults:
- Provider-backed actions: `risk: "read"` → `allow`, `risk: "write"` → `require_approval`
- Connector tools: `readOnlyHint: true` → `allow`, otherwise `require_approval`

- Key detail agents get wrong: `risk` is a hint for defaults only. Enforcement is entirely via mode overrides and the resolved mode recorded on each invocation.
- Reference: `../../../integrations_architecture.md` §12

### Connector Tool Drift Detection (Hashing)
Dynamic MCP tools can change at runtime. vNext stores a stable hash for each tool definition alongside its configured mode. On listing, the gateway compares the stored hash with the current hash and marks the tool as drifted if it changed.

Drift handling rules:
- Previous `allow` → set effective mode to `require_approval` until re-confirmed.
- Previous `require_approval` → keep `require_approval`.
- Previous `deny` → keep `deny` (still drifted; must be explicitly re-enabled by an admin).

Hashing rules (avoid false-positive drift):
- Use a deterministic JSON stringifier (stable key ordering).
- Hash a normalized JSON Schema that strips `description`, `default`, and `enum` fields (these commonly contain dynamic data).
- Key detail agents get wrong: drift detection must never "upgrade" a denied tool into an approvable tool.
- Reference: `../../../integrations_architecture.md` §5, §12

### Zod Schemas (Params and Results)
Action definitions use Zod for parameter validation and JSON Schema export (UI + agent guide).
- Key detail agents get wrong: schema conversion must be stable for hashing; use one shared `zodToJsonSchema()` implementation.
- Reference: `../../../integrations_architecture.md` §4, §5

---

## 3. File Tree

vNext introduces `packages/providers/` as the single home for code-defined integration modules and the `ActionSource` seam.

```
packages/providers/src/
├── index.ts                          # Exports registry, types, ActionSource adapters
├── types.ts                          # IntegrationProvider, ActionDefinition, trigger types
├── action-source.ts                  # ActionSource + ProviderActionSource adapter
├── registry.ts                       # ProviderRegistry (static Map + boot validation)
├── helpers/
│   ├── schema.ts                     # zodToJsonSchema(), computeDefinitionHash()
│   └── errors.ts                     # ProviderError { code, message, retryable }
└── providers/
    ├── linear/                       # actions + triggers (reference implementation)
    ├── sentry/
    ├── slack/
    ├── github/
    └── posthog/

packages/services/src/actions/
├── service.ts                        # Invoke/approve/deny, mode resolution, audit persistence
├── db.ts                             # Drizzle queries for action_invocations
└── modes.ts                          # Mode resolution helpers (org + automation + inferred)

apps/gateway/src/api/proliferate/http/
└── actions.ts                        # Routes: available, invoke, invocations, approve/deny

packages/services/src/connectors/      # (Integrations-owned) CRUD for org_connectors

packages/db/src/schema/
├── schema.ts                          # action_invocations columns (vNext) + organizations/automations action_modes
└── connectors.ts                      # org_connectors.tool_risk_overrides
```

---

## 4. Data Models & Schemas

### Database Tables

```sql
-- action_grants is removed in vNext

action_invocations
├── id                UUID PK
├── session_id         UUID NOT NULL
├── organization_id   TEXT NOT NULL
├── integration_id    UUID                         -- nullable for connectors/db sources
├── integration       TEXT NOT NULL                 -- sourceId (e.g. "linear", "connector:<uuid>")
├── action            TEXT NOT NULL                 -- actionId (e.g. "create_issue", "search_docs")
├── risk_level        TEXT NOT NULL                 -- "read" | "write" (hint copied at invocation time)
├── mode              TEXT NOT NULL                 -- "allow" | "deny" | "require_approval" (resolved)
├── mode_source       TEXT NOT NULL                 -- "automation_override" | "org_default" | "inferred_default"
├── params            JSONB
├── status            TEXT NOT NULL                 -- pending | executed | denied | expired | failed
├── result            JSONB
├── error             TEXT
├── denied_reason     TEXT                          -- policy | human | expired
├── approved_by       TEXT
├── approved_at       TIMESTAMPTZ
├── completed_at      TIMESTAMPTZ
├── expires_at        TIMESTAMPTZ                   -- 5m interactive, 24h unattended
└── created_at        TIMESTAMPTZ
```

```sql
-- Mode overrides (ownership: Actions)
organizations
├── id                TEXT PK
└── action_modes      JSONB                         -- { "<sourceId>:<actionId>": "allow|deny|require_approval", ... }

automations
├── id                UUID PK
└── action_modes      JSONB                         -- same shape; highest priority
```

```sql
-- Connector tool modes (persistence owned by Integrations)
org_connectors
└── tool_risk_overrides JSONB                       -- { "<toolName>": { mode, hash }, ... }
```

### Core TypeScript Types

```ts
// packages/providers/src/action-source.ts (dependency)
type ActionMode = "allow" | "deny" | "require_approval";

interface ModeResolution {
	mode: ActionMode;
	source: "automation_override" | "org_default" | "inferred_default";
}
```

### Key Indexes & Query Patterns
- List pending by session uses `(session_id, status)` and `(status, expires_at)` to expire stale invocations.
- Org policy lookup is a point read on `organizations.action_modes` (JSONB), keyed by `"<sourceId>:<actionId>"`.

---

## 5. Conventions & Patterns

### Do
- Keep mode resolution centralized and deterministic (`modes.ts`), and record `mode` + `mode_source` on every invocation.
- Validate params against Zod schema before mode resolution and execution.
- Redact + JSON-truncate results before storing (10KB max). Truncation must preserve valid JSON and include a `_truncated: true` marker when applied.
- Cache connector `tools/list` results (5 minutes) and include tool hash comparisons during listing.
- Fail safe on drift: if a tool hash changes, downgrade `allow` to `require_approval` but never relax `deny`.

### Don't
- Don't implement per-source permissioning branches in the invocation pipeline (mode resolution is uniform).
- Don't rely on provider `risk` as enforcement (it is only an inferred default).
- Don't store or return raw tokens from action routes.

### Reliability
- External API timeouts: default 30s per action execution.
- Rate limiting: Redis `INCR` + `EXPIRE` on `ratelimit:actions:<sessionId>`; recommendation: fail open if Redis is unavailable (abuse protection only).
- Pending expiry: interactive sessions 5 minutes, unattended runs up to 24 hours (implementation lives in `automations-runs.md` domain).
- Result truncation: never string-slice JSON. Truncate structurally (prune arrays/objects) until under the limit and return/store a valid JSON value with `_truncated: true`.

---

## 6. Subsystem Deep Dives

### 6.1 List Available Actions

**What it does:** Returns a merged catalog of actions available to a session, across all action source types.

**Happy path:**
1. Load session context: `session_connections` (provider-backed sources) and `org_connectors` (connector sources).
2. Build `ActionSource[]` for provider-backed sources (`ProviderRegistry` → `ProviderActionSource`) and connector-backed sources (`McpConnectorActionSource`, tools cached 5 minutes).
3. For each source, call `listActions(ctx)` and compute modes per `(sourceId, actionId)` via mode resolution cascade.
4. Return one flat list and use it to generate the sandbox guide (`.proliferate/actions-guide.md`).

**Edge cases:**
- Connector is unreachable at list-time → return connector source with an error marker; do not block other sources.
- Tool hash changed since last review → mark drifted; `allow` becomes `require_approval`, `deny` stays `deny`, and surface "needs re-review" in admin UI.

### 6.2 Invoke An Action

**What it does:** Validates an invocation, resolves mode, and either executes, denies, or creates a pending approval.

**Happy path:**
1. Resolve `ActionSource` by `sourceId` and locate `ActionDefinition` by `actionId`.
2. Validate params via Zod.
3. Resolve mode (automation override → org default → inferred default).
4. If `mode = deny`, persist invocation with `status = denied` and return an error.
5. If `mode = allow`, execute `source.execute()`, redact/JSON-truncate, persist invocation as executed, return result.
6. If `mode = require_approval`, persist invocation with `status = pending`, broadcast approval request, return `{ status: "pending", invocationId }`.

### 6.3 Approve/Deny Pending Invocations

**What it does:** Resolves a pending invocation into an executed or denied state.

Interactive sessions use WebSocket-connected human clients to approve/deny. Unattended automation runs pause and require external notification and resume (owned by `automations-runs.md`).
- Reference: `../../../integrations_architecture.md` §12

### 6.4 Connector Onboarding And Drift Handling

**What it does:** Stores per-tool modes and detects tool changes that require re-review.

**Happy path:**
1. Admin creates an `org_connectors` entry (url + auth).
2. System calls `tools/list`, maps tools to `ActionDefinition`s, normalizes each tool schema for hashing (strip `description`/`default`/`enum`), and computes `hash = computeDefinitionHash(def)`.
3. Admin sets a mode per tool; store `{ mode, hash }` in `org_connectors.tool_risk_overrides`.
4. On future listings, if `hash` differs, mark drifted and apply the drift handling rules (downgrade `allow` to `require_approval`; keep `deny` as `deny`) until re-confirmed.

### 6.5 Actions Guide Generation

**What it does:** Writes a session-scoped action guide file into the sandbox.

Guide content is generated from `ActionSource.listActions()` + resolved modes and includes:
- Action name `sourceId.actionId`
- Description
- Mode (`allow|require_approval|deny`)
- Parameter schema (Zod → JSON Schema → markdown)
- Examples (if provided)

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| Integrations | Actions → Integrations | `getToken()` | Provider-backed action execution. |
| Providers package | Actions → Providers | `ProviderRegistry`, `ActionSource` | Listing + execution via provider-backed sources. |
| Sessions | Sessions → Actions | `GET/POST actions routes` | Interactive approval UX depends on session connectivity. |
| Automations | Actions → Automations | "needs_human" pause/resume | Unattended approvals are run-owned. |
| Secrets | Actions → Secrets | `resolveSecretValue()` | Connector auth secrets for MCP action sources. |

### Security & Auth
- Only org admins/owners can change org-level action modes and connector tool modes.
- Approval/deny endpoints must require user auth; sandbox tokens must not approve actions.
- Always redact secrets from stored params/results.

### Observability
- Log fields: `sessionId`, `organizationId`, `sourceId`, `actionId`, `mode`, `mode_source`, `status`, `duration_ms`.
- Metrics: invoke counts by mode, pending queue depth, approval latency, connector list latency, tool drift events.

---

## 8. Acceptance Gates

- [ ] Specs updated in `docs/specs/vnext/` when changing action listing, mode resolution, or invocation semantics.
- [ ] Typecheck passes
- [ ] Relevant unit tests cover mode resolution and drift hashing (if implementing code)

---

## 9. Known Limitations & Tech Debt

- [ ] Database connectors are planned; initial vNext only unifies provider-backed + MCP connector-backed actions.
- [ ] Unattended approval pause/resume is cross-cutting and requires coordinated changes in `automations-runs.md` and `sessions-gateway.md`.
- [ ] Drift hashing relies on stable JSON Schema conversion; changes to `zodToJsonSchema()` can cause false-positive drift and should be treated as a breaking change.

````

---

## Old version of agent-contract (canonical)

Source: `docs/specs/agent-contract.md`

````markdown
# Agent Contract — System Spec

## 1. Scope & Purpose

### In Scope
- System prompt modes: setup, coding, automation — what each injects and how they differ
- OpenCode tool schemas: `verify`, `save_snapshot`, `save_service_commands`, `save_env_files`, `automation.complete`, `request_env_variables`
- Capability injection: how tools and instructions are registered in the sandbox OpenCode config
- Tool input/output contracts and validation rules
- Agent/model configuration and selection

### Out of Scope
- How intercepted tools are executed at runtime by the gateway hub — see `sessions-gateway.md` §6
- How tool files are written into the sandbox filesystem (provider boot) — see `sandbox-providers.md` §6
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
- **Tool definition** — a TypeScript module + companion `.txt` description file placed in `{repoDir}/.opencode/tool/`. Defines the tool's schema and a stub `execute()` that the gateway may intercept.
- **OpenCode config** — JSON written to `{repoDir}/opencode.json` and `/home/user/.config/opencode/opencode.json`. Sets model, provider, plugin, permissions, and MCP servers.
- **Agent config** — model ID and optional tools array stored per-session in the database.

**Key invariants:**
- All six tools are always injected regardless of session mode. The system prompt alone controls which tools the agent is encouraged to use.
- Five of six tools are intercepted by the gateway (executed server-side). Only `request_env_variables` runs in the sandbox.
- Tool definitions are string templates exported from `packages/shared/src/opencode-tools/index.ts`. They are the single source of truth for tool schemas.
- The system prompt can be overridden per-session via `session.system_prompt` in the database.

---

## 2. Core Concepts

### System Prompt Modes — `Implemented`
Three prompt builders produce mode-specific system messages. The gateway selects one based on `session_type` and `client_type`.
- Key detail agents get wrong: automation mode extends coding mode (it appends to it), not replaces it.
- Reference: `packages/shared/src/prompts.ts`

### Intercepted Tools Pattern — `Implemented`
Most platform tools are stubs in the sandbox. When OpenCode calls them, the gateway's event processor detects the tool name in the SSE stream, short-circuits sandbox execution, runs the handler server-side, and patches the tool result back into OpenCode.
- Key detail agents get wrong: `request_env_variables` is NOT intercepted — it runs in the sandbox and returns immediately. The gateway listens for it via SSE events to trigger the UI form.
- Reference: `apps/gateway/src/hub/capabilities/tools/index.ts`

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
└── sandbox/
    ├── config.ts                       # Plugin template, env instructions, paths, ports
    └── opencode.ts                     # OpenCode config generator, readiness check

apps/gateway/src/
├── lib/
│   ├── session-store.ts                # buildSystemPrompt() — mode selection logic
│   └── opencode.ts                     # updateToolResult() — patches results back to OpenCode
└── hub/capabilities/tools/
    ├── index.ts                        # Intercepted tools registry
    ├── verify.ts                       # verify handler (S3 upload)
    ├── save-snapshot.ts                # save_snapshot handler (provider snapshot)
    ├── automation-complete.ts          # automation.complete handler (run finalization)
    ├── save-service-commands.ts        # save_service_commands handler (prebuild update)
    └── save-env-files.ts              # save_env_files handler (prebuild update)
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

---

## 5. Conventions & Patterns

### Do
- Define new tool schemas in `packages/shared/src/opencode-tools/index.ts` as string template exports — this keeps all tool definitions in one place.
- Export both a `.ts` tool definition and a `.txt` description file for each tool — OpenCode uses both.
- Use Zod validation in gateway handlers for tools with complex schemas (e.g., `save_service_commands`, `save_env_files`). Simpler tools (`verify`, `save_snapshot`) use inline type coercion.
- Return `InterceptedToolResult` from all handlers — the `success` field drives error reporting.

### Don't
- Register tools in `opencode.json` — OpenCode discovers them by scanning `.opencode/tool/`.
- Add new `console.*` calls in gateway tool handlers — use `@proliferate/logger`.
- Modify system prompts without considering all three modes — automation extends coding, so changes to coding affect automation too.
- Add tool-specific logic to providers — providers write files, the gateway handles execution.

### Error Handling

```typescript
// Standard pattern for intercepted tool handlers
// Source: apps/gateway/src/hub/capabilities/tools/save-env-files.ts
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
- **Tool result patching**: `updateToolResult()` retries up to 5 times with 1s delay — the OpenCode message may still be streaming when the first PATCH attempt occurs. Source: `apps/gateway/src/lib/opencode.ts`
- **Idempotency**: `automation.complete` accepts a `completion_id` as an idempotency key.
- **Timeouts**: OpenCode readiness check uses exponential backoff (200ms base, 1.5x, max 2s per attempt, 30s total). Source: `packages/shared/src/sandbox/opencode.ts:waitForOpenCodeReady`

### Testing Conventions
- Tool handler tests live alongside handlers in gateway tests.
- Test intercepted tool handlers by mocking `SessionHub` methods (e.g., `hub.uploadVerificationFiles`, `hub.saveSnapshot`).
- Verify Zod validation rejects malformed args for `save_service_commands` and `save_env_files`.
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
   - `session_type === "setup"` → `getSetupSystemPrompt(repoName)`
   - `client_type === "automation"` → `getAutomationSystemPrompt(repoName)`
   - Otherwise → `getCodingSystemPrompt(repoName)`

**Mode differences:**

| Aspect | Setup | Coding | Automation |
|--------|-------|--------|------------|
| Base prompt | Unique | Unique | Extends Coding |
| Goal | Get repo running, save snapshot | Implement changes, verify | Complete task, report outcome |
| `verify` | Required before snapshot | Encouraged | Available |
| `save_snapshot` | Required at end | Available | Available |
| `request_env_variables` | Emphasized | Available | Available |
| `save_service_commands` | Emphasized | Not available | Not available |
| `save_env_files` | Emphasized | Not available | Not available |
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

#### `verify` tool — `Implemented`

**Schema:**
```typescript
{
  folder?: string  // Default: ".proliferate/.verification/"
}
```

**Behavior:** Gateway intercepts, uploads files from the folder to S3, returns S3 key prefix. Agent collects evidence (screenshots, test logs) before calling.

**Style note:** Uses raw `export default { name, description, parameters, execute }` format (not the `tool()` API).

#### `save_snapshot` tool — `Implemented`

**Schema:**
```typescript
{
  message?: string  // Brief summary of what's configured
}
```

**Behavior:** Gateway intercepts, triggers provider snapshot. For setup sessions: updates prebuild snapshot. For coding sessions: updates session snapshot. Returns `{ snapshotId, target }`.

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

**Behavior:** Gateway intercepts, validates with Zod, persists to prebuild `service_commands` JSONB. Requires `session.prebuild_id`. Returns `{ prebuildId, commandCount }`.

**Scope:** Setup sessions only. The tool file is only injected into sandboxes when `sessionType === "setup"`. The gateway handler also rejects calls from non-setup sessions at runtime as a defense-in-depth measure.

#### `save_env_files` tool — `Implemented`

**Schema:**
```typescript
{
  files: Array<{
    path: string          // Relative, no leading /, no .., max 500 chars
    workspacePath?: string // Default "."
    format: "dotenv"      // Only supported format
    mode: "secret"        // Only supported mode
    keys: Array<{
      key: string         // 1-200 chars
      required: boolean
    }>  // min 1, max 50 keys
  }>  // min 1, max 10 files
}
```

**Behavior:** Gateway intercepts, validates with Zod (including path traversal checks), persists to prebuild `env_files` JSONB. Returns `{ prebuildId, fileCount }`.

**Scope:** Setup sessions only. Same injection/runtime scoping as `save_service_commands`.

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

**Behavior:** Gateway intercepts, updates run record with outcome + completion JSON, updates trigger event status. Registered under both `automation.complete` and `automation_complete` names. Source: `apps/gateway/src/hub/capabilities/tools/index.ts:41`

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

**Behavior:** NOT intercepted. Runs in sandbox, returns immediately with a summary string. The gateway detects this tool call via SSE events and triggers a form in the user's UI. User-submitted values are written to `/tmp/.proliferate_env.json`. The agent then extracts values with `jq` into config files.

**Files touched:** `packages/shared/src/opencode-tools/index.ts`

### 6.3 Capability Injection Pipeline — `Implemented`

**What it does:** Writes tool files, config, plugin, and instructions into the sandbox so OpenCode can discover them.

**Happy path:**
1. Provider (Modal or E2B) calls `setupEssentialDependencies()` during sandbox boot (`packages/shared/src/providers/modal-libmodal.ts:988`, `packages/shared/src/providers/e2b.ts:568`)
2. Plugin written to `/home/user/.config/opencode/plugin/proliferate.mjs` — minimal SSE-mode plugin (`PLUGIN_MJS` from `packages/shared/src/sandbox/config.ts:16-31`)
3. Six tool `.ts` files + six `.txt` description files written to `{repoDir}/.opencode/tool/`
4. Pre-installed `package.json` + `node_modules/` copied from `/home/user/.opencode-tools/` to `{repoDir}/.opencode/tool/`
5. OpenCode config written to both `{repoDir}/opencode.json` and `/home/user/.config/opencode/opencode.json`
6. Environment instructions appended to `{repoDir}/.opencode/instructions.md` (from `ENV_INSTRUCTIONS` in `config.ts:84-131`)
7. Actions bootstrap guide written to `{repoDir}/.proliferate/actions-guide.md` (from `ACTIONS_BOOTSTRAP` in `config.ts:137-165`)
8. OpenCode server started: `cd {repoDir} && opencode serve --port 4096 --hostname 0.0.0.0`
9. Gateway waits for readiness via `waitForOpenCodeReady()` with exponential backoff

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
│       ├── save_service_commands.ts / save_service_commands.txt
│       ├── save_env_files.ts / save_env_files.txt
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

### 6.5 Intercepted Tools Contract — `Implemented`

**What it does:** Defines which tools the gateway intercepts and the contract between tool stubs (sandbox-side) and handlers (gateway-side).

**Intercepted vs sandbox-executed tools:**

| Tool | Intercepted? | Reason |
|------|-------------|--------|
| `verify` | Yes | Needs S3 credentials |
| `save_snapshot` | Yes | Needs provider API access |
| `automation.complete` | Yes | Needs database access |
| `save_service_commands` | Yes | Needs database access |
| `save_env_files` | Yes | Needs database access |
| `request_env_variables` | No | Returns immediately; gateway detects via SSE |

**Handler contract:** Every intercepted tool handler implements `InterceptedToolHandler` — a `name` string and an `execute(hub, args)` method returning `InterceptedToolResult { success, result, data? }`. Handlers are registered in `apps/gateway/src/hub/capabilities/tools/index.ts`.

**Registration:** `automation.complete` is registered under two names (`automation.complete` and `automation_complete`) to handle both dot-notation and underscore-notation from agents. Source: `apps/gateway/src/hub/capabilities/tools/index.ts:40-41`

**Result delivery:** After a handler executes, the gateway patches the result back into OpenCode via `updateToolResult()` (`apps/gateway/src/lib/opencode.ts`). This uses a PATCH to the OpenCode session API. Retries up to 5 times with 1s delay since the message may still be streaming.

For the full runtime execution flow (SSE detection, EventProcessor routing, SessionHub orchestration), see `sessions-gateway.md` §6.

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `sessions-gateway.md` | This → Gateway | `InterceptedToolHandler.execute(hub)` | Gateway hub executes tool handlers; tool schemas defined here |
| `sandbox-providers.md` | This → Providers | Tool file templates + `getOpencodeConfig()` | Providers consume definitions, write files into sandbox |
| `automations-runs.md` | Runs → This | `automation.complete` tool schema | Automation runs inject `run_id`/`completion_id` via system prompt; agent calls tool to finalize |
| `repos-prebuilds.md` | This → Prebuilds | `save_service_commands`, `save_env_files` | Tools persist config to prebuild records |
| `secrets-environment.md` | Secrets → This | `request_env_variables` + `/tmp/.proliferate_env.json` | Secrets written to env file; tool requests new ones |
| `llm-proxy.md` | Proxy → This | `anthropicBaseUrl` / `anthropicApiKey` in OpenCode config | LLM proxy URL embedded in agent config |
| `actions.md` | This → Actions | `proliferate actions` CLI in system prompts | Prompts document CLI usage; actions spec owns the runtime |

### Security & Auth
- Intercepted tools run on the gateway with full DB/S3/provider access — sandbox never has these credentials.
- `request_env_variables` instructs agents to never `cat` or `echo` the env file directly — only extract specific keys with `jq`.
- `save_env_files` validates paths cannot contain `..` (directory traversal prevention).
- OpenCode permissions deny `question` tool to prevent native browser dialogs.
- System prompts instruct agents never to ask for API keys for connected integrations (tokens resolved server-side).

### Observability
- Gateway tool handlers log via `@proliferate/logger` with `sessionId` context.
- `updateToolResult()` logs retry attempts with host/status/timing.
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

- [ ] **Partial per-mode tool filtering** — Setup-only tools (`save_service_commands`, `save_env_files`) are now injected only for setup sessions, but `automation.complete` is still available in non-automation sessions. Impact: reduced mode mismatch, but some out-of-mode tool calls remain possible. Expected fix: conditional automation tool injection by client/session mode.
- [ ] **Two tool definition styles** — `verify` uses raw `export default { name, description, parameters }` while other tools use the `tool()` plugin API from `@opencode-ai/plugin`. Impact: inconsistent authoring; no functional difference. Expected fix: migrate `verify` to `tool()` API.
- [ ] **Dual registration for automation.complete** — Registered under both `automation.complete` and `automation_complete` to handle agent variation. Impact: minor registry bloat. Expected fix: standardize on one name once agent behavior is stable.
- [ ] **No tool versioning** — Tool schemas are string templates with no version tracking. If a schema changes, running sessions continue with the old version until sandbox restart. Impact: potential schema mismatch during deploys. Expected fix: version stamp in tool file path or metadata.
- [ ] **Custom system prompt bypass** — `session.system_prompt` in the DB overrides mode selection entirely. No validation that the custom prompt includes required tool instructions. Impact: automation sessions with custom prompts may not call `automation.complete`. Expected fix: append mode-critical instructions even when custom prompt is set.

````

## New version of agent-contract (vNext)

Source: `docs/specs/vnext/agent-contract.md`

````markdown
# Agent Contract — System Spec

> **vNext (target architecture)** — This spec describes the intended agent tool contract after gateway hardening and may not match `main` yet.
>
> Current implemented spec: `../agent-contract.md`  
> Design change set: `../../../session_changes.md`

## 1. Scope & Purpose

### In Scope
- System prompt modes: setup, coding, automation — what each injects and how they differ
- OpenCode tool schemas: `verify`, `save_snapshot`, `save_service_commands`, `automation.complete`, `request_env_variables`
- Capability injection: how tools and instructions are registered in the sandbox OpenCode config
- Tool input/output contracts and validation rules
- Agent/model configuration and selection

### Out of Scope
- How gateway-mediated tools are executed at runtime by the gateway hub — see `./sessions-gateway.md`
- How tool files are written into the sandbox filesystem (provider boot) — see `./sandbox-providers.md`
- Action tools / external-service operations (`proliferate actions`) — see `./actions.md`
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
- All five tools are always injected regardless of session mode. The system prompt alone controls which tools the agent is encouraged to use.
- Four of five tools are gateway-mediated (executed server-side) and invoked via synchronous sandbox → gateway callbacks. Only `request_env_variables` runs in the sandbox.
- Tool definitions are string templates exported from `packages/shared/src/opencode-tools/index.ts`. They are the single source of truth for tool schemas.
- The system prompt can be overridden per-session via `session.system_prompt` in the database.

---

## 2. Core Concepts

### System Prompt Modes — `Implemented`
Three prompt builders produce mode-specific system messages. The gateway selects one based on `session_type` and `client_type`.
- Key detail agents get wrong: automation mode extends coding mode (it appends to it), not replaces it.
- Reference: `packages/shared/src/prompts.ts`

### Gateway-Mediated Tools (Synchronous Callbacks) — `Planned`
Most platform tools are executed **server-side** by the gateway, but vNext removes SSE interception and result patching. Instead, tool execution is mediated by a synchronous sandbox → gateway HTTP call:

1. OpenCode invokes a tool.
2. For gateway-mediated tools (`verify`, `save_snapshot`, `save_service_commands`, `automation.complete`), the tool `execute()` issues a blocking `POST /internal/tools/:toolName` to the gateway (or calls a local wrapper script that does the POST).
3. The gateway authenticates the request using the sandbox HMAC token and validates this instance holds the session ownership lease.
4. The gateway enforces idempotency by `tool_call_id` using `session_tool_invocations`.
5. The gateway executes the tool handler and returns the result in the HTTP response body.

Sandbox-side retry requirement:
- Tool `execute()` implementations (or the wrapper script they call) must treat network failures as retriable and retry the exact same request with the same `tool_call_id`.
- This is required for snapshot boundaries: `save_snapshot` may freeze the sandbox and drop the active TCP socket mid-request, which will surface as `ECONNRESET`/`fetch failed` in the sandbox. A retry after resume must return the cached result from `session_tool_invocations`.

- Key detail agents get wrong: `request_env_variables` is NOT gateway-mediated — it runs in the sandbox. The gateway may still react to it via SSE to show the UI prompt.
- Reference: `apps/gateway/src/api/internal/tools.ts`, `apps/gateway/src/hub/capabilities/tools/`, `packages/db/src/schema/sessions.ts`

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
└── sandbox/
    ├── config.ts                       # Plugin template, env instructions, paths, ports
    └── opencode.ts                     # OpenCode config generator, readiness check

apps/gateway/src/
├── api/internal/
│   └── tools.ts                         # POST /internal/tools/:toolName (sandbox callbacks)
├── lib/
│   ├── session-store.ts                # buildSystemPrompt() — mode selection logic
│   └── opencode.ts                     # OpenCode HTTP helpers (create session, send prompt, etc.)
└── hub/capabilities/tools/
    ├── index.ts                        # Tool handler registry
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
interface GatewayToolResult {
  success: boolean;
  result: string;
  data?: Record<string, unknown>;
}

interface GatewayToolHandler {
  name: string;
  execute(hub: SessionHub, args: Record<string, unknown>): Promise<GatewayToolResult>;
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

---

## 5. Conventions & Patterns

### Do
- Define new tool schemas in `packages/shared/src/opencode-tools/index.ts` as string template exports — this keeps all tool definitions in one place.
- Export both a `.ts` tool definition and a `.txt` description file for each tool — OpenCode uses both.
- Use Zod validation in gateway handlers for tools with complex schemas (e.g., `save_service_commands`). Simpler tools (`verify`, `save_snapshot`) use inline type coercion.
- Return `GatewayToolResult` from all handlers — the `success` field drives error reporting.

### Don't
- Register tools in `opencode.json` — OpenCode discovers them by scanning `.opencode/tool/`.
- Add new `console.*` calls in gateway tool handlers — use `@proliferate/logger`.
- Modify system prompts without considering all three modes — automation extends coding, so changes to coding affect automation too.
- Add tool-specific logic to providers — providers write files, the gateway handles execution.

### Error Handling

```typescript
// Standard pattern for gateway tool handlers
// Source: apps/gateway/src/hub/capabilities/tools/save-service-commands.ts
async execute(hub, args): Promise<GatewayToolResult> {
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
- **Gateway-mediated tool execution**: Tools are executed via blocking sandbox → gateway HTTP callbacks (`POST /internal/tools/:toolName`) and return results synchronously (no SSE interception, no PATCH-based result delivery).
- **Idempotency**: Tool calls are idempotent by `tool_call_id` via `session_tool_invocations`. `automation.complete` additionally accepts a `completion_id` idempotency key at the domain level.
- **Retry semantics**: Sandbox tool wrappers must retry on network-level failures (`ECONNRESET`, `ETIMEDOUT`, DNS errors, 502/503) with the same `tool_call_id`. The gateway must return the cached result for duplicate `tool_call_id`s.
- **Timeouts**: OpenCode readiness check uses exponential backoff (200ms base, 1.5x, max 2s per attempt, 30s total). Source: `packages/shared/src/sandbox/opencode.ts:waitForOpenCodeReady`

### Testing Conventions
- Tool handler tests live alongside handlers in gateway tests.
- Test gateway tool handlers by mocking `SessionHub` methods (e.g., `hub.uploadVerificationFiles`, `hub.saveSnapshot`) and by exercising the internal tools route (idempotency by `tool_call_id`).
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
   - `session_type === "setup"` → `getSetupSystemPrompt(repoName)`
   - `client_type === "automation"` → `getAutomationSystemPrompt(repoName)`
   - Otherwise → `getCodingSystemPrompt(repoName)`

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
3. Five tool `.ts` files + five `.txt` description files written to `{repoDir}/.opencode/tool/`
4. Pre-installed `package.json` + `node_modules/` copied from `/home/user/.opencode-tools/` to `{repoDir}/.opencode/tool/`
5. OpenCode config written to both `{repoDir}/opencode.json` and `/home/user/.config/opencode/opencode.json`
6. Environment instructions appended to `{repoDir}/.opencode/instructions.md` (from `ENV_INSTRUCTIONS` in `config.ts:84-131`)
7. Actions bootstrap guide written to `{repoDir}/.proliferate/actions-guide.md` (from `ACTIONS_BOOTSTRAP` in `config.ts:137-165`)
8. OpenCode server started: `cd {repoDir} && opencode serve --port 4096 --hostname 0.0.0.0`
9. Gateway waits for readiness via `waitForOpenCodeReady()` with exponential backoff

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
│       ├── save_service_commands.ts / save_service_commands.txt
│       ├── package.json                 # Pre-installed deps
│       └── node_modules/                # Pre-installed deps
└── .proliferate/
    └── actions-guide.md                 # CLI actions documentation
```

**Edge cases:**
- Config is written to both global and local paths for OpenCode discovery reliability.
- File write mechanics differ by provider (Modal uses shell commands, E2B uses `files.write` SDK). For provider-specific boot details, see `./sandbox-providers.md`.

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

### 6.5 Gateway-Mediated Tools Contract — `Planned`

**What it does:** Defines the contract between sandbox-side tool stubs and gateway-side handlers using synchronous HTTP callbacks.

**Gateway-mediated vs sandbox-local tools:**

| Tool | Gateway-mediated? | Reason |
|------|-------------------|--------|
| `verify` | Yes | Needs S3 credentials |
| `save_snapshot` | Yes | Needs provider API access |
| `automation.complete` | Yes | Needs database access |
| `save_service_commands` | Yes | Needs database access |
| `request_env_variables` | No | Runs locally; gateway uses SSE events to drive UI |

**Callback request:**
- Method: `POST /internal/tools/:toolName`
- Auth: sandbox HMAC token (`Authorization: Bearer <token>`)
- Body:
  - `session_id: string`
  - `tool_call_id: string` (unique per tool call)
  - `params: object`

**Callback response:**
- `200`: `{ result: unknown }`
- `5xx`: `{ error: string, message?: string }`

**Idempotency:** The gateway persists each call in `session_tool_invocations` keyed by `tool_call_id`. Duplicate calls return the cached result/error without re-executing.

**Quotas:** The gateway enforces per-session quotas per tool name to limit abuse from compromised sandboxes (e.g. `save_snapshot` 10/hour, `verify` 20/hour, `automation.complete` 1/session).

For runtime ownership leases, migration queuing semantics, and tool-call wakeups for evicted hubs, see `./sessions-gateway.md`.

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `./sessions-gateway.md` | This → Gateway | `POST /internal/tools/:toolName` | Gateway executes tool handlers via synchronous callbacks; tool schemas defined here |
| `./sandbox-providers.md` | This → Providers | Tool file templates + `getOpencodeConfig()` | Providers consume definitions, write files into sandbox |
| `automations-runs.md` | Runs → This | `automation.complete` tool schema | Automation runs inject `run_id`/`completion_id` via system prompt; agent calls tool to finalize |
| `configurations-snapshots.md` | This → Configurations | `save_service_commands` | Tool persists config to configuration records |
| `secrets-environment.md` | Secrets → This | `request_env_variables` + `/tmp/.proliferate_env.json` | Secrets written to env file; tool requests new ones |
| `llm-proxy.md` | Proxy → This | `anthropicBaseUrl` / `anthropicApiKey` in OpenCode config | LLM proxy URL embedded in agent config |
| `./actions.md` | This → Actions | `proliferate actions` CLI in system prompts | Prompts document CLI usage; actions spec owns the runtime |

### Security & Auth
- Gateway-mediated tools run on the gateway with full DB/S3/provider access — sandboxes never have these credentials.
- Tool callbacks authenticate with the sandbox HMAC token and should reject requests on non-owner instances (ownership leases).
- Per-tool quotas limit abuse if a sandbox is compromised.
- `request_env_variables` instructs agents to never `cat` or `echo` the env file directly — only extract specific keys with `jq`.
- OpenCode permissions deny `question` tool to prevent native browser dialogs.
- System prompts instruct agents never to ask for API keys for connected integrations (tokens resolved server-side).

### Observability
- Gateway tool handlers log via `@proliferate/logger` with `sessionId` context.
- Tool callback executions should log `toolName`, `toolCallId`, duration, and final status (`completed`/`failed`) and persist via `session_tool_invocations`.
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

- [ ] **Partial per-mode tool filtering** — The setup-only tool (`save_service_commands`) is now injected only for setup sessions, but `automation.complete` is still available in non-automation sessions. Impact: reduced mode mismatch, but some out-of-mode tool calls remain possible. Expected fix: conditional automation tool injection by client/session mode.
- [ ] **Two tool definition styles** — `verify` uses raw `export default { name, description, parameters }` while other tools use the `tool()` plugin API from `@opencode-ai/plugin`. Impact: inconsistent authoring; no functional difference. Expected fix: migrate `verify` to `tool()` API.
- [ ] **Dual registration for automation.complete** — Registered under both `automation.complete` and `automation_complete` to handle agent variation. Impact: minor registry bloat. Expected fix: standardize on one name once agent behavior is stable.
- [ ] **No tool versioning** — Tool schemas are string templates with no version tracking. If a schema changes, running sessions continue with the old version until sandbox restart. Impact: potential schema mismatch during deploys. Expected fix: version stamp in tool file path or metadata.
- [ ] **Custom system prompt bypass** — `session.system_prompt` in the DB overrides mode selection entirely. No validation that the custom prompt includes required tool instructions. Impact: automation sessions with custom prompts may not call `automation.complete`. Expected fix: append mode-critical instructions even when custom prompt is set.

````

---

## Old version of sandbox-providers (canonical)

Source: `docs/specs/sandbox-providers.md`

````markdown
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
- Snapshot resolution (which layers to use)
- Git freshness / pull cadence
- Port exposure (`proliferate services expose`)

### Out of Scope
- Session lifecycle that calls the provider — see `sessions-gateway.md`
- Tool schemas and prompt templates — see `agent-contract.md`
- Snapshot build jobs (base and repo snapshot workers) — see `repos-prebuilds.md`
- Secret values and bundle management — see `secrets-environment.md`
- LLM key generation — see `llm-proxy.md`

### Mental Model

A **sandbox** is a remote compute environment (Modal container or E2B sandbox) where the coding agent runs. This spec owns _how_ sandboxes are created, configured, and managed — the provider layer. The session lifecycle that _decides when_ to create or destroy sandboxes belongs to `sessions-gateway.md`.

The provider abstraction lets callers swap between Modal and E2B without code changes. Both providers perform the same boot sequence: resolve an image/template, create or recover a sandbox, clone repos (or restore from snapshot), inject config files + tools + plugin, start OpenCode, start infrastructure services, and start sandbox-mcp.

Inside every sandbox, **sandbox-mcp** runs as a sidecar providing an HTTP API (port 4000) and terminal WebSocket for the gateway to interact with the sandbox beyond OpenCode's SSE stream.

**Core entities:**
- **SandboxProvider** — The interface both Modal and E2B implement. Defined in `packages/shared/src/sandbox-provider.ts`.
- **sandbox-mcp** — The in-sandbox HTTP/WS server and CLI. Lives in `packages/sandbox-mcp/`.
- **Snapshot layers** — Three tiers: base snapshot (pre-baked image), repo snapshot (image + cloned repo), session/prebuild snapshot (full state). Resolved by `packages/shared/src/snapshot-resolution.ts`.

**Key invariants:**
- Providers must be stateless across calls. All state lives in the sandbox filesystem or metadata file (`/home/user/.proliferate/metadata.json`).
- `ensureSandbox()` is idempotent: recover an existing sandbox if alive, else create a new one.
- `terminate()` is idempotent: "not found" errors are treated as success.
- Secrets are never logged. Error messages pass through `redactSecrets()` before storage.

---

## 2. Core Concepts

### Provider Factory
Callers obtain a provider via `getSandboxProvider(type?)` (`packages/shared/src/providers/index.ts`). If no `type` is passed, it reads `DEFAULT_SANDBOX_PROVIDER` from the environment schema (`packages/environment/src/schema.ts`). The provider type is persisted in the session DB record (`sessions.sandbox_provider`) so that resume always uses the same provider that created the sandbox. A thin alias `getSandboxProviderForSnapshot()` exists but is currently unused — gateway code calls `getSandboxProvider(providerType)` directly.
- Key detail agents get wrong: Session-facing code (gateway, API routes) should go through the factory — not instantiate providers directly. However, snapshot build workers (`apps/worker/src/base-snapshots/`, `apps/worker/src/repo-snapshots/`) and the CLI snapshot script (`apps/gateway/src/bin/create-modal-base-snapshot.ts`) instantiate `ModalLibmodalProvider` directly because they need provider-specific methods like `createBaseSnapshot()` / `createRepoSnapshot()` that aren't on the `SandboxProvider` interface.
- Reference: `packages/shared/src/providers/index.ts`

### SandboxProvider Interface
The common contract for all providers. Defines required methods (`ensureSandbox`, `createSandbox`, `snapshot`, `pause`, `terminate`, `writeEnvFile`, `health`) and optional methods (`deleteSnapshot`, `checkSandboxes`, `resolveTunnels`, `readFiles`, `createTerminalSandbox`, `testServiceCommands`, `execCommand`).
- Key detail agents get wrong: `ensureSandbox` is the preferred entry point, not `createSandbox`. The former handles recovery; the latter always creates fresh.
- Reference: `packages/shared/src/sandbox-provider.ts`

### Agent & Model Configuration
The `AgentConfig` type (`packages/shared/src/agents.ts`) carries agent type and model ID through the stack. The default is `opencode` agent with `claude-opus-4.6` model. Model IDs are canonical (e.g., `"claude-opus-4.6"`) and transformed to provider-specific formats: `toOpencodeModelId()` produces `"anthropic/claude-opus-4-6"` for OpenCode's config file.
- Key detail agents get wrong: OpenCode model IDs have NO date suffix — OpenCode handles the mapping internally. Don't use Anthropic API format (`claude-opus-4-6-20250514`) in OpenCode config.
- Reference: `packages/shared/src/agents.ts:toOpencodeModelId`

### Snapshot Layering
Sandboxes can start from three levels of pre-built state: (1) base snapshot — OpenCode + services pre-installed, no repo; (2) repo snapshot — base + cloned repo; (3) session/prebuild snapshot — full working state. The `resolveSnapshotId()` function picks the best available layer.
- Key detail agents get wrong: Repo snapshots are only used for Modal provider, single-repo, `workspacePath = "."`. E2B sessions skip this layer.
- Reference: `packages/shared/src/snapshot-resolution.ts`

### Git Freshness
When restoring from a snapshot, repos may be stale. The `shouldPullOnRestore()` function gates `git pull --ff-only` on: (1) feature flag `SANDBOX_GIT_PULL_ON_RESTORE`, (2) having a snapshot, (3) cadence timer `SANDBOX_GIT_PULL_CADENCE_SECONDS`.
- Key detail agents get wrong: Cadence is only advanced when _all_ repo pulls succeed. A single failure leaves the timer unchanged so the next restore retries.
- Reference: `packages/shared/src/sandbox/git-freshness.ts`

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

interface CreateSandboxOpts {
  sessionId: string;
  userName?: string;           // Git identity
  userEmail?: string;
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
  snapshotHasDeps?: boolean;   // Gates service command auto-start
  serviceCommands?: PrebuildServiceCommand[];
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
| **AI Agents** | OpenCode, Claude Code (`@anthropic-ai/claude-code`), Codex (`@openai/codex`) |
| **Sandbox Tooling** | `proliferate-sandbox-mcp` (npm global), Playwright MCP server |
| **Services** | PostgreSQL 14 (trust auth), Redis, Mailcatcher |
| **Docker** | Docker CE 27.5.0, Compose plugin, Buildx, runc 1.3.0 |
| **Web** | Caddy (preview proxy), openvscode-server 1.106.3 |
| **Git** | Git, GitHub CLI (`gh`), custom credential helpers (`git-credential-proliferate`, `git-askpass`) |
| **Browser** | Playwright Chromium (headless) |
| **System** | SSH server (key-only auth), rsync, tmux, jq, procps |
| **Scripts** | `start-services.sh` (Postgres+Redis+SSH+Mailcatcher), `start-dockerd.sh` (Docker daemon with iptables NAT), `proliferate-info` |
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
7. **Additional setup (async)**: Git identity, git freshness pull, start services (Postgres/Redis/Mailcatcher), start Caddy, start sandbox-mcp, boot service commands (`modal-libmodal.ts:691`).
8. Wait for OpenCode readiness (poll `/session` endpoint, 30s timeout) (`modal-libmodal.ts:701`).

**Edge cases:**
- Branch clone fails → falls back to default branch (`modal-libmodal.ts:909-919`).
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
2. Write config files in parallel: plugin, tool pairs (.ts + .txt), OpenCode config (global + local), instructions.md, actions-guide.md, pre-installed tool deps. **Setup-only tools** (`save_service_commands`, `save_env_files`) are only written when `opts.sessionType === "setup"` — coding/CLI sessions never see them.
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
1. **Prebuild/session snapshot** (`prebuildSnapshotId`) — always wins if present.
2. **Repo snapshot** — only for Modal provider, single-repo, `workspacePath = "."`, status `"ready"`.
3. **No snapshot** — start from base image with live clone.

**Edge cases:**
- Multi-repo prebuilds never use repo snapshots (returns `null`).
- Unknown/null provider skips repo snapshot layer.
- Repo snapshot must have matching provider (`"modal"` or null).

### 6.6 Snapshot Version Key — `Implemented`

**What it does:** Computes a SHA-256 hash of everything baked into a base snapshot (`packages/shared/src/sandbox/version-key.ts:computeBaseSnapshotVersionKey`).

**Inputs hashed:** `PLUGIN_MJS` + `DEFAULT_CADDYFILE` + `getOpencodeConfig(defaultModelId)`.

When this key changes, the base snapshot is stale and must be rebuilt. Used by snapshot build workers (see `repos-prebuilds.md`).

### 6.7 Git Freshness — `Implemented`

**What it does:** Decides whether to `git pull --ff-only` when restoring from snapshot.

**Decision function** (`packages/shared/src/sandbox/git-freshness.ts:shouldPullOnRestore`):
- Returns `false` if: disabled, no snapshot, no repos, or cadence window hasn't elapsed.
- Returns `true` if: cadence is 0 (always), no `lastGitFetchAt` (legacy), or enough time has passed.

**Env vars:** `SANDBOX_GIT_PULL_ON_RESTORE` (boolean), `SANDBOX_GIT_PULL_CADENCE_SECONDS` (number, 0 = always).

Both providers re-write git credentials before pulling (snapshot tokens may be stale) and only advance the cadence timer when all pulls succeed.

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
| Sessions/Gateway | Gateway → Provider | `SandboxProvider.ensureSandbox()` | Gateway calls provider to create/recover sandboxes. See `sessions-gateway.md`. |
| Agent Contract | Provider → Sandbox | Tool files written to `.opencode/tool/` | Provider injects tool implementations at boot. Tool schemas defined in `agent-contract.md`. |
| Repos/Prebuilds | Provider ← Worker | `createBaseSnapshot()`, `createRepoSnapshot()` | Snapshot workers call Modal provider directly. See `repos-prebuilds.md`. |
| Secrets/Environment | Provider ← Gateway | `CreateSandboxOpts.envVars` | Gateway assembles env vars from secrets. See `secrets-environment.md`. |
| LLM Proxy | Provider → Sandbox | `ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY` env vars | Virtual key injected as env var. See `llm-proxy.md`. |
| Actions | CLI → Gateway | `proliferate actions run` | CLI calls gateway action endpoints. See `actions.md`. |

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
- [ ] **Caddy fallback ports hardcoded** — The default Caddyfile tries ports 3000, 5173, 8000, 4321 in order. No mechanism to configure this per-prebuild without using `exposePort()`.

````

## New version of sandbox-providers (vNext)

Source: `docs/specs/vnext/sandbox-providers.md`

````markdown
# Sandbox Providers — System Spec

> **vNext (target architecture)** — This spec describes the intended sandbox boot contract after gateway hardening and may not match `main` yet.
>
> Current implemented spec: `../sandbox-providers.md`  
> Design change set: `../../../session_changes.md`

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
- Session lifecycle that calls the provider — see `./sessions-gateway.md`
- Tool schemas and prompt templates — see `./agent-contract.md`
- Snapshot build jobs (base snapshot workers) — see `repos-prebuilds.md`
- Secret values and bundle management — see `secrets-environment.md`
- LLM key generation — see `llm-proxy.md`

### Mental Model

A **sandbox** is a remote compute environment (Modal container or E2B sandbox) where the coding agent runs. This spec owns _how_ sandboxes are created, configured, and managed — the provider layer. The session lifecycle that _decides when_ to create or destroy sandboxes belongs to `./sessions-gateway.md`.

The provider abstraction lets callers swap between Modal and E2B without code changes. Both providers perform the same boot sequence: resolve an image/template, create or recover a sandbox, clone repos (or restore from snapshot), inject config files + tools + plugin, start OpenCode, start infrastructure services, and start sandbox-mcp. Configurations define per-repo settings (service commands, env files, etc.) that are applied at sandbox boot.

Inside every sandbox, **sandbox-mcp** runs as a sidecar providing an HTTP API (port 4000) and terminal WebSocket for the gateway to interact with the sandbox beyond OpenCode's SSE stream.

**Core entities:**
- **SandboxProvider** — The interface both Modal and E2B implement. Defined in `packages/shared/src/sandbox-provider.ts`.
- **sandbox-mcp** — The in-sandbox HTTP/WS server and CLI. Lives in `packages/sandbox-mcp/`.
- **Snapshots** — Two tiers: base snapshot (pre-baked image) and configuration/session snapshot (full state including cloned repo). If `active_snapshot_id` is set on the configuration, that snapshot is used; if null, the sandbox boots from the base image.

**Key invariants:**
- Providers must be stateless across calls. All state lives in the sandbox filesystem or metadata file (`/home/user/.proliferate/metadata.json`).
- `ensureSandbox()` is idempotent: recover an existing sandbox if alive, else create a new one.
- `terminate()` is idempotent: "not found" errors are treated as success.
- Secrets are never logged. Error messages pass through `redactSecrets()` before storage.

---

## 2. Core Concepts

### Provider Factory
Callers obtain a provider via `getSandboxProvider(type?)` (`packages/shared/src/providers/index.ts`). If no `type` is passed, it reads `DEFAULT_SANDBOX_PROVIDER` from the environment schema (`packages/environment/src/schema.ts`). The provider type is persisted in the session DB record (`sessions.sandbox_provider`) so that resume always uses the same provider that created the sandbox. A thin alias `getSandboxProviderForSnapshot()` exists but is currently unused — gateway code calls `getSandboxProvider(providerType)` directly.
- Key detail agents get wrong: Session-facing code (gateway, API routes) should go through the factory — not instantiate providers directly. However, snapshot build workers (`apps/worker/src/base-snapshots/`) and the CLI snapshot script (`apps/gateway/src/bin/create-modal-base-snapshot.ts`) instantiate `ModalLibmodalProvider` directly because they need provider-specific methods like `createBaseSnapshot()` that aren't on the `SandboxProvider` interface.
- Reference: `packages/shared/src/providers/index.ts`

### SandboxProvider Interface
The common contract for all providers. Defines required methods (`ensureSandbox`, `createSandbox`, `snapshot`, `pause`, `terminate`, `writeEnvFile`, `health`) and optional methods (`checkSandboxes`, `resolveTunnels`, `readFiles`, `createTerminalSandbox`, `testServiceCommands`, `execCommand`).
- Key detail agents get wrong: `ensureSandbox` is the preferred entry point, not `createSandbox`. The former handles recovery; the latter always creates fresh.
- Reference: `packages/shared/src/sandbox-provider.ts`

### Agent & Model Configuration
The `AgentConfig` type (`packages/shared/src/agents.ts`) carries agent type and model ID through the stack. The default is `opencode` agent with `claude-opus-4.6` model. Model IDs are canonical (e.g., `"claude-opus-4.6"`) and transformed to provider-specific formats: `toOpencodeModelId()` produces `"anthropic/claude-opus-4-6"` for OpenCode's config file.
- Key detail agents get wrong: OpenCode model IDs have NO date suffix — OpenCode handles the mapping internally. Don't use Anthropic API format (`claude-opus-4-6-20250514`) in OpenCode config.
- Reference: `packages/shared/src/agents.ts:toOpencodeModelId`

### Snapshot Resolution
Snapshot resolution is simple: if the configuration has `active_snapshot_id` set, the sandbox boots from that snapshot; if `active_snapshot_id` is null, the sandbox boots from the base image with a live clone. There is no multi-layer fallback chain.
- Key detail agents get wrong: There is no separate repo snapshot layer. Snapshots are either base snapshots (pre-baked image) or configuration/session snapshots (full working state).
- Reference: snapshot resolution logic lives inline in the gateway session creation code.

### Git Freshness
When restoring from a snapshot, repos may be stale. The `shouldPullOnRestore()` function gates `git pull --ff-only` on: (1) feature flag `SANDBOX_GIT_PULL_ON_RESTORE`, (2) having a snapshot, (3) cadence timer `SANDBOX_GIT_PULL_CADENCE_SECONDS`.
- Key detail agents get wrong: Cadence is only advanced when _all_ repo pulls succeed. A single failure leaves the timer unchanged so the next restore retries.
- Reference: `packages/shared/src/sandbox/git-freshness.ts`

### OpenCode Plugin (PLUGIN_MJS)
A minimal ESM plugin injected into every sandbox at `~/.config/opencode/plugin/proliferate.mjs`. It exports a `ProliferatePlugin` async function with empty hooks. All event streaming flows via SSE (gateway pulls from OpenCode) — the plugin does NOT push events.
- Key detail agents get wrong: The `console.log` calls inside `PLUGIN_MJS` run _inside the sandbox_, not in the provider. They are template string literals, not actual server-side calls. Do not migrate them to structured logging.
- Reference: `packages/shared/src/sandbox/config.ts:PLUGIN_MJS`

---

## 3. File Tree

```
packages/shared/src/
├── sandbox-provider.ts              # SandboxProvider interface + all types
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

interface CreateSandboxOpts {
  sessionId: string;
  userName?: string;           // Git identity
  userEmail?: string;
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
  serviceCommands?: ServiceCommand[];
  hasActiveSnapshot?: boolean; // Auto-start services if active snapshot exists
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
| **AI Agents** | OpenCode, Claude Code (`@anthropic-ai/claude-code`), Codex (`@openai/codex`) |
| **Sandbox Tooling** | `proliferate-sandbox-mcp` (npm global), Playwright MCP server |
| **Services** | PostgreSQL 14 (trust auth), Redis, Mailcatcher |
| **Docker** | Docker CE 27.5.0, Compose plugin, Buildx, runc 1.3.0 |
| **Web** | Caddy (preview proxy), openvscode-server 1.106.3 |
| **Git** | Git, GitHub CLI (`gh`), custom credential helpers (`git-credential-proliferate`, `git-askpass`) |
| **Browser** | Playwright Chromium (headless) |
| **System** | SSH server (key-only auth), rsync, tmux, jq, procps |
| **Scripts** | `start-services.sh` (Postgres+Redis+SSH+Mailcatcher), `start-dockerd.sh` (Docker daemon with iptables NAT), `proliferate-info` |
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
- Snapshot resolution is trivial (check `active_snapshot_id`) — no dedicated unit test needed.

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
2. Resolve sandbox image: restore from snapshot > base snapshot (`MODAL_BASE_SNAPSHOT_ID`) > base image (via `get_image_id` endpoint) (`modal-libmodal.ts:541-565`).
3. Build env vars: inject `SESSION_ID`, LLM proxy config (`ANTHROPIC_API_KEY`/`ANTHROPIC_BASE_URL`), and user-provided vars (`modal-libmodal.ts:586-612`).
4. Create sandbox with `client.sandboxes.create()` — Docker enabled, 2 CPU, 4GB RAM, encrypted ports for OpenCode+preview, unencrypted for SSH (`modal-libmodal.ts:621-631`).
5. Get tunnel URLs via `sandbox.tunnels(30000)` (`modal-libmodal.ts:642-656`).
6. **Essential setup (blocking)**: Clone repos, write plugin/tools/config/instructions, start OpenCode server (`modal-libmodal.ts:662-678`).
7. **Additional setup (async)**: Git identity, git freshness pull, start services (Postgres/Redis/Mailcatcher), start Caddy, start sandbox-mcp, boot service commands (`modal-libmodal.ts:691`).
8. Wait for OpenCode readiness (poll `/session` endpoint, 30s timeout) (`modal-libmodal.ts:701`).

**Edge cases:**
- Branch clone fails → falls back to default branch (`modal-libmodal.ts:909-919`).
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
   - **Setup-only tools** (`save_service_commands`) are only written when `opts.sessionType === "setup"` — coding/CLI sessions never see them.
   - **Gateway-mediated tools** are implemented as synchronous callbacks. Providers must inject the gateway base URL + sandbox auth token into the sandbox environment and ensure tool stubs can call `POST /internal/tools/:toolName` (either via native OpenCode "remote tool" support or a local wrapper script).
3. **Modal only:** Write SSH keys if CLI session (`modal-libmodal.ts:1062`), write trigger context if automation-triggered (`modal-libmodal.ts:1071`). E2B does not handle SSH or trigger context.
4. Start OpenCode server (`opencode serve --port 4096`).

**Phase 2 — Additional (fire-and-forget):**
1. Configure git identity (`git config --global user.name/email`).
2. Git freshness pull (if enabled and cadence elapsed).
3. Start infrastructure services (`/usr/local/bin/start-services.sh`).
4. Create Caddy import directory, write Caddyfile, start Caddy.
5. Start sandbox-mcp API server (`sandbox-mcp api`, port 4000).
6. Start service commands via `proliferate services start` (fire-and-forget).

**Files touched:** Both provider files, `packages/shared/src/sandbox/config.ts`

### 6.5 Snapshot Resolution — `Implemented`

**What it does:** Determines which snapshot (if any) to use when creating a sandbox.

**Logic** (inline in gateway session creation code):
1. If the configuration has `active_snapshot_id` set → use that snapshot.
2. If `active_snapshot_id` is null → boot from base image with live clone.

There is no multi-layer fallback chain. The `resolveSnapshotId()` function and `snapshot-resolution.ts` file have been removed.

### 6.6 Snapshot Version Key — `Implemented`

**What it does:** Computes a SHA-256 hash of everything baked into a base snapshot (`packages/shared/src/sandbox/version-key.ts:computeBaseSnapshotVersionKey`).

**Inputs hashed:** `PLUGIN_MJS` + `DEFAULT_CADDYFILE` + `getOpencodeConfig(defaultModelId)`.

When this key changes, the base snapshot is stale and must be rebuilt. Used by base snapshot build workers (see `repos-prebuilds.md`).

### 6.7 Git Freshness — `Implemented`

**What it does:** Decides whether to `git pull --ff-only` when restoring from snapshot.

**Decision function** (`packages/shared/src/sandbox/git-freshness.ts:shouldPullOnRestore`):
- Returns `false` if: disabled, no snapshot, no repos, or cadence window hasn't elapsed.
- Returns `true` if: cadence is 0 (always), no `lastGitFetchAt` (legacy), or enough time has passed.

**Env vars:** `SANDBOX_GIT_PULL_ON_RESTORE` (boolean), `SANDBOX_GIT_PULL_CADENCE_SECONDS` (number, 0 = always).

Both providers re-write git credentials before pulling (snapshot tokens may be stale) and only advance the cadence timer when all pulls succeed.

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
| Sessions/Gateway | Gateway → Provider | `SandboxProvider.ensureSandbox()` | Gateway calls provider to create/recover sandboxes. See `./sessions-gateway.md`. |
| Agent Contract | Provider → Sandbox | Tool files written to `.opencode/tool/` | Provider injects tool implementations at boot. Tool schemas defined in `./agent-contract.md`. |
| Repos/Configurations | Provider ← Worker | `createBaseSnapshot()` | Base snapshot workers call Modal provider directly. See `repos-prebuilds.md`. |
| Secrets/Environment | Provider ← Gateway | `CreateSandboxOpts.envVars` | Gateway assembles env vars from secrets. See `secrets-environment.md`. |
| LLM Proxy | Provider → Sandbox | `ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY` env vars | Virtual key injected as env var. See `llm-proxy.md`. |
| Actions | CLI → Gateway | `proliferate actions run` | CLI calls gateway action endpoints. See `actions.md`. |

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
- [ ] **Setup-only tools not scrubbed before snapshot** — Snapshots of setup sessions include `save_service_commands` tool. These are cleaned up reactively on restore (via `rm -f` in `setupEssentialDependencies`) instead of being removed before snapshotting. Scrubbing before snapshot would eliminate the cleanup path and keep snapshots in a clean state.

````

---

## Old version of sessions-gateway (canonical)

Source: `docs/specs/sessions-gateway.md`

````markdown
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
- `pause` → loads session, enforces snapshot quota (`billing.ensureSnapshotCapacity()`), then calls `provider.pause()` if supported, else `provider.snapshot()` + `provider.terminate()`. Finalizes billing, updates DB status to `"paused"` (`sessions-pause.ts`).
- `resume` → no dedicated handler. Resume is implicit: connecting a WebSocket client to a paused session triggers `ensureRuntimeReady()`, which creates a new sandbox from the stored snapshot.
- `delete` → calls `sessions.deleteSession()`.
- `rename` → calls `sessions.renameSession()`.
- `snapshot` → calls `snapshotSessionHandler()` (`sessions-snapshot.ts`).
- `submitEnv` → writes secrets to DB, writes env file to sandbox via provider.

**Files touched:** `apps/gateway/src/api/proliferate/http/sessions.ts`, `apps/gateway/src/lib/session-creator.ts`, `apps/web/src/server/routers/sessions.ts`

### 6.2 Session Runtime Lifecycle — `Implemented`

**What it does:** Lazily provisions sandbox, OpenCode session, and SSE bridge on first client connect.

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

````

## New version of sessions-gateway (vNext)

Source: `docs/specs/vnext/sessions-gateway.md`

````markdown
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

````

---

## Old version of integrations (canonical)

Source: `docs/specs/integrations.md`

````markdown
# Integrations — System Spec

## 1. Scope & Purpose

### In Scope
- OAuth connection lifecycle for GitHub, Sentry, Linear, and Slack
- Nango as the unified OAuth broker for Sentry, Linear, and (optionally) GitHub
- GitHub App installation flow (non-Nango path)
- Connection binding tables: `repo_connections`, `automation_connections`, `session_connections`
- Slack workspace-level installations and OAuth
- Slack conversations cache (schema only — runtime use belongs to `automations-runs.md`)
- Token resolution for downstream consumers (gateway, worker, trigger-service)
- Sentry and Linear metadata queries (projects, teams, labels, etc.)
- Integration disconnect with orphaned-repo cleanup
- Gateway-side GitHub token resolution
- Org-scoped MCP connector catalog lifecycle (CRUD, validation, settings UI)

### Out of Scope
- What repos/automations/sessions **do** with connections at runtime — see `repos-prebuilds.md`, `automations-runs.md`, `sessions-gateway.md`
- Slack async client and message handling — see `automations-runs.md`
- Action adapters for Linear/Sentry — see `actions.md`
- Connector execution lifecycle (risk/approval/grants/audit) — see `actions.md`
- Trigger providers for GitHub/Linear/Sentry — see `triggers.md`
- GitHub App webhook dispatch to triggers — see `triggers.md`

### Mental Model

Integrations is the external credential/connectivity control plane. Implemented today: OAuth-backed integrations (GitHub, Sentry, Linear, Slack) where users complete OAuth flows and downstream systems resolve live tokens at runtime. Planned direction: add an org-scoped MCP connector catalog in this domain so connector-backed Actions are configured once per org and reused across all sessions/automations by default.

**Core entities:**
- **Integration** — A stored OAuth connection scoped to an organization. Provider is either `nango` (Sentry/Linear/GitHub-via-Nango) or `github-app` (GitHub App installation). Lifecycle: `active` → `expired`/`revoked`/`deleted`/`suspended`.
- **Slack Installation** — A workspace-level Slack bot installation, stored separately from `integrations` because Slack uses its own OAuth flow with encrypted bot tokens. Lifecycle: `active` → `revoked`.
- **Connection binding** — A junction row linking an integration to a repo, automation, or session. Cascades on delete.
- **Connector** — An org-scoped MCP endpoint configuration (`org_connectors` table) with auth mapping, used by Actions to discover and invoke connector-backed tools. Managed via Settings → Tools UI.

**Key invariants:**
- One integration record per `(connection_id, organization_id)` pair (unique constraint).
- Slack installations are unique per `(organization_id, team_id)`.
- Deleting a GitHub integration triggers orphaned-repo detection.
- Bot tokens for Slack are encrypted at rest; never logged.
- `NEXT_PUBLIC_INTEGRATIONS_ENABLED` gates all Nango-based OAuth flows.

---

## 2. Core Concepts

### Nango
Nango is an external OAuth broker that manages token refresh, storage, and the OAuth handshake for Sentry, Linear, and optionally GitHub. Proliferate creates a "connect session" via the Nango SDK, the user completes OAuth in Nango's UI, and a callback saves the `connection_id` + `providerConfigKey` locally.
- Key detail agents get wrong: Nango manages the OAuth tokens — Proliferate never stores raw OAuth tokens for Nango-managed integrations. Token retrieval is always via `nango.getConnection()`.
- Reference: `apps/web/src/lib/nango.ts`, `packages/services/src/integrations/tokens.ts`

### GitHub App vs Nango GitHub
GitHub has two auth paths. The default is a GitHub App installation (provider `github-app`), where Proliferate registers as a GitHub App and gets an `installation_id`. The alternative (behind `NEXT_PUBLIC_USE_NANGO_GITHUB` feature flag) routes GitHub OAuth through Nango.
- Key detail agents get wrong: The two paths produce different `provider` values in the `integrations` table (`github-app` vs `nango`) and use different token resolution logic.
- Reference: `apps/web/src/app/api/integrations/github/callback/route.ts`, `apps/web/src/server/routers/integrations.ts:githubSession`

### Token Resolution
A generic layer that abstracts over GitHub App installation tokens and Nango OAuth tokens. Given an `IntegrationForToken`, it returns a live access token. Used by the gateway (for git operations), worker (for enrichment), and trigger-service (for polling).
- Key detail agents get wrong: GitHub App tokens are cached for 50 minutes (they expire after 1 hour). Nango tokens are fetched live and refreshed by Nango internally.
- Reference: `packages/services/src/integrations/tokens.ts`, `apps/gateway/src/lib/github-auth.ts`

### Visibility
Integrations have a `visibility` field: `org` (visible to all org members) or `private` (visible only to the creator). The `filterByVisibility` mapper enforces this at the service layer.
- Key detail agents get wrong: Visibility filtering is applied in `listIntegrations`, not at the DB query level.
- Reference: `packages/services/src/integrations/mapper.ts:filterByVisibility`

### Connector Catalog
Org-scoped MCP connector definitions are stored in the `org_connectors` table and managed through Integrations CRUD routes. Each connector defines a remote MCP server endpoint, auth method (org secret reference or custom header), and optional risk policy. The gateway loads enabled connectors by org at session runtime and merges their tools into `/actions/available`.
- Key detail agents get wrong: connectors complement OAuth integrations; they do not replace them. OAuth integrations resolve tokens via Nango/GitHub App, while connectors resolve org secrets for MCP auth.
- Key detail agents get wrong: connector execution (risk/approval/grants/audit) is still owned by Actions (`actions.md`). Integrations owns the catalog lifecycle only.
- Reference: `packages/services/src/connectors/`, `apps/web/src/server/routers/integrations.ts`, `apps/web/src/app/settings/tools/page.tsx`

---

## 3. File Tree

```
packages/db/src/schema/
├── integrations.ts              # integrations + repo_connections tables
├── slack.ts                     # slack_installations + slack_conversations tables
└── schema.ts                    # automation_connections + session_connections tables

packages/services/src/integrations/
├── index.ts                     # Module exports
├── service.ts                   # Business logic (list, create, delete, status)
├── db.ts                        # Raw Drizzle queries
├── mapper.ts                    # DB row → API response transforms
├── tokens.ts                    # Generic token resolution (Nango + GitHub App)
└── github-app.ts                # GitHub App JWT + installation token utilities

packages/shared/src/contracts/
└── integrations.ts              # Zod schemas + ts-rest contract definition

apps/web/src/lib/
├── nango.ts                     # Nango SDK singleton + integration ID helpers
├── slack.ts                     # Slack API helpers (OAuth, postMessage, revoke)
└── github-app.ts                # GitHub App JWT + installation verification

packages/services/src/connectors/
├── index.ts                     # Module exports
├── db.ts                        # Drizzle queries for org_connectors table
└── service.ts                   # Business logic (list, create, update, delete, toConnectorConfig)

apps/web/src/server/routers/
└── integrations.ts              # oRPC router (all integration + connector endpoints)

apps/web/src/app/settings/
└── tools/page.tsx               # Org-level connector management UI (route: /settings/tools)

apps/web/src/hooks/
└── use-org-connectors.ts        # React hooks for org-level connector CRUD

apps/web/src/app/api/integrations/
├── github/callback/route.ts     # GitHub App installation callback
├── slack/oauth/route.ts         # Slack OAuth initiation (redirect)
└── slack/oauth/callback/route.ts # Slack OAuth callback (token exchange)

apps/web/src/app/api/webhooks/
└── github-app/route.ts          # GitHub App webhook handler (lifecycle events)

apps/gateway/src/lib/
└── github-auth.ts               # Gateway-side GitHub token resolution
```

Connector catalog: `packages/services/src/connectors/` owns DB access and business logic. `org_connectors` table stores connector definitions with backfill migration from legacy `prebuilds.connectors` JSONB.

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
├── auth                JSONB NOT NULL           -- { type: 'none' | 'secret' | 'custom_header', secretKey?, headerName?, headerValue? }
├── risk_policy         JSONB                    -- { defaultRisk: 'read' | 'write' | 'danger' }
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
```

### Key Indexes & Query Patterns
- `idx_integrations_org` on `organization_id` — all list/status queries filter by org
- `idx_integrations_github_installation` on `github_installation_id` — webhook handler resolves integration by installation ID
- `idx_slack_installations_team` on `team_id` — Slack events handler resolves installation by team
- `idx_slack_conversations_thread` on `(channel_id, thread_ts)` — message routing looks up existing conversation by thread

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
```

---

## 5. Conventions & Patterns

### Do
- Use `packages/services/src/integrations/` for all DB reads/writes — never query directly from routers
- Use `tokens.ts:getToken()` to resolve live OAuth tokens — it abstracts over both provider types
- Encrypt Slack bot tokens at rest via `@/lib/crypto` before storing

### Don't
- Store raw OAuth tokens for Nango-managed integrations — Nango owns token storage and refresh
- Log Slack bot tokens, OAuth tokens, or any credential material
- Call `nango.getConnection()` outside the integrations module — use the token resolution layer

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

### 6.1 Integration List and Update — `Implemented`

**What it does:** Lists all integrations for an org (filtered by visibility) and allows renaming. Also includes `slackStatus` (returns team info + support channel), `slackInstallations` (lists active Slack workspaces for notification selector), `sentryStatus`, `linearStatus`, and `githubStatus` endpoints.

**Happy path (list):**
1. `integrationsRouter.list` calls `integrations.listIntegrations(orgId, userId)` (`apps/web/src/server/routers/integrations.ts`)
2. Service fetches all integration rows for the org (`db.ts:listByOrganization`)
3. Creator info is batch-fetched and attached (`mapper.ts:attachCreators`)
4. Results are filtered by visibility (`mapper.ts:filterByVisibility`)
5. Grouped by provider (`mapper.ts:groupByProvider`) and returned with per-provider `connected` booleans

**Happy path (update):**
1. `integrationsRouter.update` verifies the integration belongs to the org
2. Calls `db.ts:updateDisplayName` — trims whitespace, sets `null` for empty strings

**Files touched:** `apps/web/src/server/routers/integrations.ts`, `packages/services/src/integrations/service.ts`, `packages/services/src/integrations/db.ts`, `packages/services/src/integrations/mapper.ts`

### 6.2 GitHub App Installation (OAuth) — `Implemented`

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

### 6.3 GitHub via Nango (Optional) — `Implemented`

**What it does:** Alternative GitHub OAuth flow through Nango, gated behind `NEXT_PUBLIC_USE_NANGO_GITHUB`.

**Happy path:**
1. `integrationsRouter.githubSession` checks the feature flag, creates a Nango connect session with `allowed_integrations: [githubIntegrationId]`
2. Frontend completes OAuth in Nango's UI
3. Nango calls back; frontend calls `integrationsRouter.callback` with `connectionId` and `providerConfigKey`
4. Service saves integration with `provider='nango'`

**Files touched:** `apps/web/src/server/routers/integrations.ts:githubSession`, `apps/web/src/lib/nango.ts`

### 6.4 Sentry / Linear OAuth (via Nango) — `Implemented`

**What it does:** OAuth connection for Sentry and Linear via Nango connect sessions.

**Happy path (identical for both providers):**
1. `sentrySession` / `linearSession` creates a Nango connect session scoped to the provider
2. Returns `sessionToken` for the frontend Nango UI
3. On completion, frontend calls `integrationsRouter.callback` which calls `service.ts:saveIntegrationFromCallback`
4. If `connection_id` already exists: re-authorization → updates status to `active`
5. If new: inserts with `provider='nango'`, `visibility='org'`

**Files touched:** `apps/web/src/server/routers/integrations.ts:sentrySession,linearSession,callback`, `packages/services/src/integrations/service.ts:saveIntegrationFromCallback`

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

**What it does:** Removes an integration, cleans up Nango connection, and detects orphaned repos.

**Happy path:**
1. `integrationsRouter.disconnect` fetches the integration, checks org ownership
2. For Nango-managed connections (`provider !== 'github-app'`): calls `nango.deleteConnection()` to revoke upstream
3. Calls `service.ts:deleteIntegration()` which deletes the row from `integrations`
4. For GitHub-related integrations: runs `handleOrphanedRepos()` — iterates non-orphaned repos, checks if any have zero `repo_connections`, marks them as `isOrphaned=true`

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

**What it does:** Generic layer to get live OAuth tokens for any integration type.

**Happy path:**
1. Caller provides an `IntegrationForToken` (from `db.ts:getIntegrationsForTokens` lookup)
2. `tokens.ts:getToken()` checks provider type:
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

**What it does:** Defines a single org-level source of truth for MCP connector configuration used by Actions discovery/invocation.

**Behavior:**
1. Admin/owner configures connectors once per org via Settings → Tools.
2. Config is stored in `org_connectors` table using the shared `ConnectorConfig` schema (`packages/shared/src/connectors.ts`).
3. Gateway Actions loads enabled connectors by org/session context, not by prebuild.
4. Connector-backed actions continue using the same `connector:<uuid>` integration prefix and existing approval/audit pipeline in `actions.md`.
5. Quick-setup flow: preset grid with inline API key entry, atomic secret + connector creation in a single transaction.
6. Advanced flow: full form with secret picker, custom auth, risk policy, and connection validation.

**Key files:**
- DB: `packages/db/src/schema/schema.ts:orgConnectors`, `packages/services/src/connectors/db.ts`
- Service: `packages/services/src/connectors/service.ts`
- Router: `apps/web/src/server/routers/integrations.ts` (connectors section)
- UI: `apps/web/src/app/settings/tools/page.tsx`, `apps/web/src/hooks/use-org-connectors.ts`
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
| `actions.md` | Actions ↔ This | `connectors.listEnabledConnectors()` | Org-scoped connector catalog read path for action discovery |
| `auth-orgs.md` | This → Auth | `orgProcedure` middleware | All integration routes require org membership |
| `secrets-environment.md` | This → Secrets | `getEnvVarName()` | Token env var naming for sandbox injection |

### Security & Auth
- All oRPC routes use `orgProcedure` (org membership required)
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

---

## 9. Known Limitations & Tech Debt

- [ ] **Duplicated GitHub App JWT logic** — `apps/web/src/lib/github-app.ts`, `apps/gateway/src/lib/github-auth.ts`, and `packages/services/src/integrations/github-app.ts` each contain independent JWT generation and PKCS key conversion. Should be consolidated into the services package. — Medium impact on maintenance.
- [ ] **Slack schema drift** — The `support_*` columns (`support_channel_id`, `support_channel_name`, `support_invite_id`, `support_invite_url`) exist in the production DB (reflected in `packages/db/src/schema/schema.ts:1350-1353`) but are missing from the hand-written schema in `packages/db/src/schema/slack.ts`. The service code (`db.ts:updateSlackSupportChannel`) wraps access in try/catch commenting "columns may not exist yet". The hand-written schema should be updated to include these columns. — Low impact but creates confusion.
- [ ] **No token refresh error handling** — If Nango returns an expired/invalid token, the error propagates directly to the caller. No automatic retry or re-auth flow exists. — Medium impact for long-running sessions.
- [ ] **Visibility filtering in memory** — `filterByVisibility` loads all org integrations then filters in JS. Fine at current scale but won't scale if an org has hundreds of integrations. — Low impact.
- [ ] **Orphaned repo detection is O(n)** — `handleOrphanedRepos` iterates all non-orphaned repos and runs a count query per repo. Should be a single query. — Low impact at current scale.

````

## New version of integrations (vNext)

Source: `docs/specs/vnext/integrations.md`

````markdown
# Integrations — System Spec

> **vNext (target architecture)** — This spec describes the intended Integrations control plane after the unified integrations redesign and may not match `main` yet.
>
> Current implemented spec: `../integrations.md`  
> Design change set: `../../../integrations_architecture.md`

Terminology note: this spec uses `IntegrationProvider` / "integration module" for external service integrations (Linear/Sentry/etc). This is distinct from sandbox compute providers (Modal/E2B) in `./sandbox-providers.md`.

## 1. Scope & Purpose

### In Scope
- External credential and connectivity lifecycle (OAuth integrations + GitHub App + Slack installs).
- Connection requirements declared by code-defined integration modules (`IntegrationProvider.connections`).
- OAuth preset mapping (framework-level) from `preset` keys to the active OAuth broker implementation (Nango today, Arctic later).
- Token resolution for downstream consumers (`getToken()`), including optional user-scoped credentials.
- Org-scoped MCP connector catalog lifecycle (CRUD, validation, enable/disable).
- Persistence of MCP connector tool mode overrides and tool drift metadata (storage + CRUD only; runtime enforcement is owned by Actions).

### Out of Scope
- Action permissioning and execution (allow/deny/require_approval, approvals, auditing) — see `./actions.md`.
- Trigger ingestion (webhooks, polling, event normalization) — see `./triggers.md`.
- Automation run pipeline and notifications — see `automations-runs.md`.
- Session runtime and sandbox lifecycle — see `./sessions-gateway.md`, `./sandbox-providers.md`.

### Mental Model

Integrations is Proliferate's external connectivity control plane. It stores which external services an org can talk to and how to obtain credentials for them at runtime. Integrations does not execute actions and does not ingest triggers; it only provides records and token resolution primitives that those subsystems consume.

In vNext, code-defined integrations are self-contained modules in `packages/providers/` that declare their connection requirements (OAuth scopes, whether they need org or user tokens, etc.) without binding to a specific OAuth broker. Integrations uses these declarations to drive connect UX and to validate that a session/automation has the right connectivity configured, while `getToken()` remains the single boundary for resolving live access tokens.

**Core entities:**
- **Integration** — an org-scoped external connection reference (Nango connection ID, GitHub App installation ID, Slack bot token reference).
- **User connection** — a user-scoped credential for a provider used when actions need user attribution (optional, provider-specific).
- **Connector** — an org-scoped MCP endpoint configuration (`org_connectors`), including per-tool mode overrides and drift hash metadata.
- **Connection binding** — a junction row linking an integration to a repo, automation, or session.

**Key invariants:**
- Providers declare what they need (`type: "oauth2"`, `scopes`, `preset`) but never how it is fulfilled (no Nango/Arctic references in provider code).
- `getToken()` is the only runtime path that yields a bearer token; other subsystems do not read tokens from storage.
- Connector definitions are org-scoped; sessions consume enabled connectors at runtime (see `./actions.md` for execution semantics).

---

## 2. Core Concepts

### Connection Requirements (Provider-Declared)
Code-defined integration modules declare connection needs via `IntegrationProvider.connections` (required org-scoped credential, optional user-scoped credential, scopes, and a stable `preset` key).
- Key detail agents get wrong: these declarations are not a Nango API. They are broker-agnostic requirements that Integrations maps to whatever auth layer is active.
- Reference: `../../../integrations_architecture.md` §4, §11

### OAuth Presets (Framework Mapping)
`ConnectionRequirement.preset` is a stable string key (`"linear"`, `"sentry"`, `"jira"`, `"github"`) that Integrations maps to broker-specific OAuth configuration (authorization URL, token URL, issuer quirks).
- Key detail agents get wrong: provider code must never depend on preset implementation details. Only the Integrations auth layer uses the mapping.
- Reference: `../../../integrations_architecture.md` §11

### Token Resolution (`getToken`)
`getToken()` resolves a live access token for a given integration reference. In vNext it also supports optional user-scoped credentials by accepting `opts.userId`.
- Key detail agents get wrong: `getToken()` is the enforcement boundary for "provider code is stateless". Integration modules receive tokens as arguments; they do not query PostgreSQL or secrets stores.
- Reference: `packages/services/src/integrations/tokens.ts`, `../../../integrations_architecture.md` §11

### User-Scoped Connections (Optional)
Some providers benefit from user-attributed actions (for example, GitHub authorship). vNext introduces a `user_connections` table so `getToken()` can prefer user credentials when an action requests it, with an org-level fallback.
- Key detail agents get wrong: user-scoped connections are optional and should be gated by real product need; org-scoped bot/app tokens remain the default.
- Reference: `../../../integrations_architecture.md` §11

### Connector Catalog Tool Overrides (Persistence)
When an admin onboards a connector, the system lists tools and stores per-tool mode overrides on the connector record (`org_connectors.tool_risk_overrides`). Each entry includes the chosen mode and a definition hash for drift detection.
- Key detail agents get wrong: Integrations owns persistence and CRUD; Actions owns enforcement and runtime mode resolution.
- Reference: `../../../integrations_architecture.md` §5, §12

---

## 3. File Tree

Target file ownership remains split between "credentials/control plane" (this spec) and "provider modules" (consumed by Actions/Triggers). The vNext additions below are the expected landing spots.

```
packages/services/src/integrations/
├── index.ts                          # Module exports
├── service.ts                        # Business logic (list, create, delete, status)
├── db.ts                             # Drizzle queries
├── mapper.ts                         # DB row → API response transforms
├── tokens.ts                         # getToken() (org + user scope)
├── presets.ts                        # OAuth preset mapping (broker-specific)
└── github-app.ts                     # GitHub App JWT + installation token utilities

packages/services/src/connectors/
├── index.ts                          # Module exports
├── db.ts                             # Drizzle queries for org_connectors
└── service.ts                        # Connector CRUD + validation

packages/providers/src/               # (Dependency) Code-defined integration modules
├── types.ts                          # IntegrationProvider interface (connections/actions/triggers)
└── registry.ts                       # ProviderRegistry (static Map)

packages/db/src/schema/
├── integrations.ts                   # integrations + binding tables
├── slack.ts                          # slack_installations tables
├── connectors.ts                     # org_connectors (includes tool_risk_overrides)
└── user-connections.ts               # user_connections (new)
```

---

## 4. Data Models & Schemas

### Database Tables

```sql
-- New in vNext
user_connections
├── id               UUID PK
├── user_id          TEXT NOT NULL FK(users)
├── provider         TEXT NOT NULL        -- e.g. "github"
├── connection_id    TEXT NOT NULL        -- OAuth connection reference
├── status           TEXT NOT NULL        -- "active" | "inactive"
├── created_at       TIMESTAMPTZ
└── updated_at       TIMESTAMPTZ
    UNIQUE(user_id, provider)
```

```sql
-- Existing table extended in vNext
org_connectors
├── id                  UUID PK
├── organization_id     TEXT NOT NULL
├── name                TEXT NOT NULL
├── url                 TEXT NOT NULL
├── auth                JSONB NOT NULL
├── enabled             BOOLEAN NOT NULL
├── tool_risk_overrides JSONB            -- { "<toolName>": { mode, hash }, ... } (new)
├── created_at          TIMESTAMPTZ
└── updated_at          TIMESTAMPTZ
```

### Core TypeScript Types

```ts
// packages/providers/src/types.ts (dependency)
type ConnectionType =
	| "oauth2"
	| "app_installation"
	| "bot_token"
	| "api_key"
	| "none";

interface ConnectionRequirement {
	type: ConnectionType;
	scope: "org" | "user";
	scopes?: string[];
	optional?: boolean;
	preset?: string;
}
```

### Key Indexes & Query Patterns
- Resolve a user token uses `UNIQUE(user_id, provider)` on `user_connections`.
- Connector mode overrides are stored as JSONB on `org_connectors` and read by Actions at session runtime.

---

## 5. Conventions & Patterns

### Do
- Treat provider-declared connection requirements as declarative input only; never call Nango/Arctic from provider modules.
- Keep `getToken()` as the only bearer token boundary used by Actions/Triggers.
- Encrypt bot tokens and secrets at rest; never log token material.
- Store connector tool overrides and hashes on the connector record; keep enforcement in Actions.

### Don't
- Do not store raw OAuth tokens for broker-managed connections in PostgreSQL (Nango/Arctic owns refresh+storage).
- Do not couple provider modules to OAuth broker identifiers (Nango integration keys, Arctic provider IDs).
- Do not implement per-tool permissioning in Integrations (it is persisted here, enforced in Actions).

### Reliability
- Token resolution should be idempotent and safe to retry; external brokers may have transient failures.

---

## 6. Subsystem Deep Dives

### 6.1 Connect An OAuth Integration

**What it does:** Starts an OAuth flow for a provider, then persists the resulting connection reference as an org integration record.

**Happy path:**
1. UI selects a provider (by `IntegrationProvider.meta.id`) and reads its `connections.org` requirement for scopes + preset.
2. Integrations auth layer maps `preset` to broker config and starts the OAuth handshake.
3. Callback persists an `integrations` row referencing the broker connection ID and marks it `active`.
4. Session/automation binds the integration via `session_connections` / `automation_connections`.

**Edge cases:**
- Provider declares `type: "oauth2"` but no scopes → warn during provider registry validation (boot-time), fail safe at connect-time.

### 6.2 Resolve A Token For Runtime Use

**What it does:** Returns a live access token to Actions/Triggers.

**Happy path:**
1. Actions/Triggers call `getToken(integration, { userId? })`.
2. If `userId` is present and a user connection exists for this provider, return the user token.
3. Otherwise return the org-scoped token (OAuth broker token or GitHub App installation token).

### 6.3 Onboard An MCP Connector (Persist Tool Modes)

**What it does:** Stores per-tool mode overrides and drift hashes as part of connector configuration.

**Happy path:**
1. Admin creates `org_connectors` (url + auth mapping).
2. System lists tools and computes definition hashes.
3. Admin confirms per-tool mode; Integrations persists `{ mode, hash }` to `tool_risk_overrides`.
4. Actions consumes these values at runtime (see `./actions.md`).

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| Actions | Actions → Integrations | `getToken()` | Runtime token resolution for provider-backed actions. |
| Triggers | Triggers → Integrations | `getToken()` | Token resolution for polling and optional `hydrate()`. |
| Secrets | Integrations → Secrets | `resolveSecretValue()` | Connector auth secrets. |
| Providers package | Integrations → Providers | `IntegrationProvider.connections` | Connection requirement declarations. |

### Security & Auth
- All connector CRUD is org-scoped and requires admin/owner privileges.
- Never return tokens in API responses; only return connection metadata.

---

## 8. Acceptance Gates

- [ ] Specs updated in `docs/specs/vnext/` when changing any integration/connectivity behavior.
- [ ] Typecheck passes
- [ ] Relevant integration/connectors tests updated or added (if implementing code)

---

## 9. Known Limitations & Tech Debt

- [ ] `user_connections` is planned and may be deferred until a design partner requires user attribution. See `../../../integrations_architecture.md` §11.
- [ ] OAuth broker implementation details vary (Nango vs Arctic). Presets must remain stable across broker swaps.

````

---

## Old version of triggers (canonical)

Source: `docs/specs/triggers.md`

````markdown
# Triggers — System Spec

## 1. Scope & Purpose

### In Scope
- Trigger CRUD (create, update, delete, list, get)
- Trigger events log and trigger event actions (audit trail)
- Trigger service (`apps/trigger-service/` — dedicated Express app)
- Webhook ingestion via Nango forwarding (trigger-service + web app API routes)
- Direct webhook routes: GitHub App, custom, PostHog, automation-scoped (`apps/web/src/app/api/webhooks/`)
- Webhook dispatch and matching (event → trigger → automation run)
- Polling scheduler (cursor-based, Redis state, BullMQ repeatable jobs)
- Cron scheduling via SCHEDULED queue (Partial — queue defined, worker not running)
- Provider registry (`packages/triggers/src/service/registry.ts`)
- Provider adapters: GitHub (webhook), Linear (webhook + polling), Sentry (webhook), PostHog (webhook, HMAC), Gmail (polling via Composio)
- Schedule CRUD (get, update, delete)
- PubSub session events subscriber
- Handoff to automations (enqueue via outbox `enqueue_enrich`)

### Out of Scope
- Automation run pipeline after handoff — see `automations-runs.md`
- Integration OAuth setup and connection lifecycle — see `integrations.md`
- Session lifecycle — see `sessions-gateway.md`
- Sandbox boot and provider interface — see `sandbox-providers.md`

### Mental Model

Triggers are the inbound event layer of Proliferate. External services (GitHub, Linear, Sentry, PostHog, Gmail) emit events that Proliferate ingests, filters, deduplicates, and converts into automation runs. There are three ingestion mechanisms: **webhooks** (provider pushes events — via Nango forwarding to trigger-service, or via direct Next.js API routes), **polling** (Proliferate pulls from provider APIs on a cron schedule), and **scheduled** (pure cron triggers with no external event source — queue defined but worker not yet running).

Every trigger belongs to exactly one automation. When an event passes filtering and deduplication, the trigger processor creates a `trigger_event` record and an `automation_run` record inside a single transaction, using the transactional outbox pattern to guarantee the run will be picked up by the worker.

**Core entities:**
- **Trigger** — a configured event source bound to an automation and an integration. Types: `webhook` or `polling`.
- **Trigger event** — an individual event occurrence, with lifecycle: `queued` → `processing` → `completed`/`failed`/`skipped`.
- **Trigger event action** — audit log of tool executions within a trigger event.
- **Schedule** — a cron expression attached to an automation for time-based runs.
- **Provider adapter** — a `WebhookTrigger` or `PollingTrigger` subclass that knows how to parse, filter, and contextualize events from a specific external service.

**Key invariants:**
- Each trigger belongs to exactly one automation (FK `automation_id`).
- Deduplication is enforced via a unique index on `(trigger_id, dedup_key)` in `trigger_events`.
- Polling state is stored in Redis (hot path) and backed up to PostgreSQL (`polling_state` column).
- Webhook signature verification happens at the Nango adapter level for trigger-service, and at the route level for direct webhook routes.
- Webhook ingestion exists in two places: trigger-service (`POST /webhooks/nango`) and web app API routes (`apps/web/src/app/api/webhooks/`). Both use the same `createRunFromTriggerEvent` handoff.

---

## 2. Core Concepts

### Nango Forwarding
External webhooks from GitHub, Linear, and Sentry are received by Nango, which forwards them to the trigger service as a unified envelope with type `"forward"`. The envelope includes `connectionId`, `providerConfigKey`, and `payload`.
- Key detail agents get wrong: the trigger service receives Nango's envelope, not raw provider payloads. The `parseNangoForwardWebhook` function extracts the inner payload.
- Reference: `packages/triggers/src/service/adapters/nango.ts`

### Provider Registry (Service Layer)
The trigger service uses a class-based registry (`TriggerRegistry`) with separate maps for webhook and polling triggers. Providers register via `registerDefaultTriggers()` at startup. This is distinct from the older functional `TriggerProvider` interface in `packages/triggers/src/types.ts` (which is still used for context parsing and filtering).
- Key detail agents get wrong: there are two abstraction layers — the service-layer `WebhookTrigger`/`PollingTrigger` classes (used by trigger-service) and the `TriggerProvider` interface (used for parsing/filtering logic). The Nango adapter classes delegate to the `TriggerProvider` implementations.
- Reference: `packages/triggers/src/service/registry.ts`, `packages/triggers/src/service/base.ts`

### Cursor-Based Polling
Polling triggers store a cursor in Redis (`poll:{triggerId}`) and persist it to PostgreSQL. Each poll cycle reads the cursor, calls the provider's `poll()` method, stores the new cursor, and processes any returned events through the standard trigger processor pipeline.
- Key detail agents get wrong: the cursor is a provider-specific opaque string (e.g., Linear GraphQL pagination cursor, Gmail history ID). It is NOT a timestamp.
- Reference: `apps/trigger-service/src/polling/worker.ts`

### Transactional Outbox Handoff
When a trigger event passes all checks, `createRunFromTriggerEvent` inserts both the `trigger_event` and `automation_run` rows in a single transaction, plus an outbox entry with kind `enqueue_enrich`. The outbox dispatcher (owned by `automations-runs.md`) picks this up.
- Key detail agents get wrong: the handoff is NOT a direct BullMQ enqueue. It goes through the outbox for reliability.
- Reference: `packages/services/src/runs/service.ts:createRunFromTriggerEvent`

---

## 3. File Tree

```
apps/trigger-service/src/
├── index.ts                          # Entry point: registers triggers, starts server + polling worker
├── server.ts                         # Express app setup (health, providers, webhooks routes)
├── api/
│   ├── webhooks.ts                   # POST /webhooks/nango — webhook ingestion route
│   └── providers.ts                  # GET /providers — provider metadata for UI
├── lib/
│   ├── logger.ts                     # Service logger
│   ├── webhook-dispatcher.ts         # Dispatches Nango webhooks to matching triggers
│   └── trigger-processor.ts          # Processes events: filter, dedup, create run
└── polling/
    └── worker.ts                     # BullMQ polling worker (cursor-based)

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
├── service.ts                        # Business logic (CRUD, event management, polling jobs)
├── db.ts                             # Drizzle queries
├── mapper.ts                         # DB row → API type mapping
└── processor.ts                      # Shared trigger event processor (filter/dedup/handoff)

packages/services/src/schedules/
├── index.ts                          # Module exports
├── service.ts                        # Schedule CRUD logic
├── db.ts                             # Drizzle queries
└── mapper.ts                         # DB row → API type mapping

packages/db/src/schema/
├── triggers.ts                       # triggers, trigger_events, trigger_event_actions tables
└── schedules.ts                      # schedules table

packages/services/src/types/
├── triggers.ts                       # Re-exported trigger DB types
└── schedules.ts                      # Schedule input/output types

apps/web/src/server/routers/
├── triggers.ts                       # Trigger CRUD + provider metadata oRPC routes
└── schedules.ts                      # Schedule CRUD oRPC routes

apps/web/src/app/api/webhooks/
├── nango/route.ts                    # Nango webhook handler (auth, sync, forward)
├── github-app/route.ts               # GitHub App direct webhooks (installation lifecycle + events)
├── custom/[triggerId]/route.ts       # Custom webhook by trigger ID (any payload, optional HMAC)
├── posthog/[automationId]/route.ts   # PostHog webhook by automation ID
└── automation/[automationId]/route.ts # Generic automation webhook by automation ID

apps/worker/src/pubsub/
├── index.ts                          # Exports SessionSubscriber
└── session-events.ts                 # Redis PubSub subscriber for session events
```

---

## 4. Data Models & Schemas

### Database Tables

```sql
triggers
├── id                    UUID PRIMARY KEY
├── organization_id       TEXT NOT NULL → organization.id (CASCADE)
├── automation_id         UUID NOT NULL → automations.id (CASCADE)
├── name                  TEXT (deprecated — use automation.name)
├── description           TEXT (deprecated)
├── trigger_type          TEXT NOT NULL DEFAULT 'webhook'  -- 'webhook' | 'polling'
├── provider              TEXT NOT NULL                    -- 'sentry' | 'linear' | 'github' | 'posthog' | 'custom'
├── enabled               BOOLEAN DEFAULT true
├── execution_mode        TEXT DEFAULT 'auto' (deprecated)
├── allow_agentic_repo_selection  BOOLEAN DEFAULT false (deprecated)
├── agent_instructions    TEXT (deprecated)
├── webhook_secret        TEXT                             -- random 32-byte hex
├── webhook_url_path      TEXT UNIQUE                      -- /webhooks/t_{uuid12}
├── polling_cron          TEXT                             -- cron expression
├── polling_endpoint      TEXT
├── polling_state         JSONB DEFAULT {}                 -- cursor backup
├── last_polled_at        TIMESTAMPTZ
├── config                JSONB DEFAULT {}                 -- provider-specific filters
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
// packages/triggers/src/service/base.ts — trigger definition base classes
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

// packages/triggers/src/types.ts — provider interface (used for parsing/filtering)
interface TriggerProvider<TConfig, TState, TItem> {
  poll(connection, config, lastState): Promise<PollResult<TItem, TState>>;
  findNewItems(items, lastState): TItem[];
  filter(item, config): boolean;
  parseContext(item): ParsedEventContext;
  verifyWebhook(request, secret, body): Promise<boolean>;
  parseWebhook(payload): TItem[];
  computeDedupKey(item): string | null;
  extractExternalId(item): string;
  getEventType(item): string;
}
```

### Key Indexes & Query Patterns
- Webhook lookup: `findActiveWebhookTriggers(integrationId)` uses `(integration_id, enabled, trigger_type)`.
- Dedup check: `eventExistsByDedupKey(triggerId, dedupKey)` uses unique index `(trigger_id, dedup_key)`.
- Event listing: `listEvents(orgId, options)` uses `(organization_id, status)` with pagination.

---

## 5. Conventions & Patterns

### Do
- Use the transactional outbox (`createRunFromTriggerEvent`) for all trigger-to-run handoffs — guarantees atomicity.
- Register new providers in `registerDefaultTriggers()` (`packages/triggers/src/service/register.ts`).
- Implement both `WebhookTrigger` (service layer) AND `TriggerProvider` (parsing layer) when adding a provider.
- Store polling cursors in Redis for hot-path access, persist to PostgreSQL as backup.

### Don't
- Skip deduplication — always implement `computeDedupKey` / `idempotencyKey`.
- Directly enqueue BullMQ jobs from trigger processing — use the outbox.
- Add raw SQL to `packages/services/src/triggers/db.ts` — use Drizzle query builder.
- Log raw webhook payloads (may contain sensitive data). Log trigger IDs, event counts, and provider names instead.

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
- **Webhook signature verification**: Nango HMAC-SHA256 via `verifyNangoSignature()` using `timingSafeEqual`. Provider-specific signatures (Linear-Signature, X-Hub-Signature-256, Sentry-Hook-Signature, X-PostHog-Signature) verified by provider adapters.
- **Polling concurrency**: BullMQ worker with `concurrency: 3` (`packages/queue/src/index.ts`).
- **Polling job options**: 2 attempts, fixed 5s backoff, 1 hour age limit, 24 hour retention on fail.
- **Idempotency**: Unique index `(trigger_id, dedup_key)` prevents duplicate event processing. Custom webhook routes also use SHA-256 payload hashing with a 5-minute dedup window.

---

## 6. Subsystem Deep Dives

### 6.1 Webhook Ingestion (Nango)

**What it does:** Receives forwarded webhooks from Nango, matches them to triggers, and creates automation runs. **Status: Implemented.**

**Happy path:**
1. Nango sends `POST /webhooks/nango` to trigger service (`apps/trigger-service/src/api/webhooks.ts`).
2. `dispatchIntegrationWebhook("nango", req)` extracts the Nango forward envelope (`webhook-dispatcher.ts`).
3. Dispatcher calls `registry.webhooksByProvider(providerKey)` to find matching `WebhookTrigger` definitions.
4. Each trigger definition's `webhook(req)` method verifies the Nango HMAC signature, parses the inner payload via the provider's `parseWebhook()`, and returns `TriggerEvent[]`.
5. The webhook route looks up the integration by `connectionId` via `integrations.findByConnectionIdAndProvider()`.
6. Active webhook triggers for that integration are fetched via `triggerService.findActiveWebhookTriggers()`.
7. `processTriggerEvents()` (`trigger-processor.ts`) iterates events × triggers: checks automation enabled, applies provider filter, checks dedup key, then calls `runs.createRunFromTriggerEvent()`.
8. The run creation inserts `trigger_event` (status `queued`), `automation_run` (status `queued`), and an outbox entry (`enqueue_enrich`) in a single transaction.

**Edge cases:**
- Integration not found for `connectionId` → returns `{ processed: 0, skipped: 0 }`.
- Automation disabled → event recorded as skipped with reason `automation_disabled`.
- Filter mismatch → event recorded as skipped with reason `filter_mismatch`.
- Duplicate dedup key → silently skipped (no event record).
- Invalid Nango signature → `401` response.

**Files touched:** `apps/trigger-service/src/api/webhooks.ts`, `apps/trigger-service/src/lib/webhook-dispatcher.ts`, `apps/trigger-service/src/lib/trigger-processor.ts`, `packages/triggers/src/service/adapters/nango.ts`, `packages/services/src/runs/service.ts`

### 6.2 Polling Worker

**What it does:** Periodically polls external APIs for new events using BullMQ repeatable jobs. **Status: Implemented.**

**Happy path:**
1. When a polling trigger is created/updated with a `pollingCron`, `schedulePollingJob()` adds a BullMQ repeatable job to the POLLING queue.
2. The polling worker (`apps/trigger-service/src/polling/worker.ts`) processes each job:
   - Loads trigger row with integration data.
   - Skips if disabled or not a polling trigger.
   - Reads cursor from Redis (`poll:{triggerId}`).
   - Calls the polling trigger's `poll(connection, config, cursor)`.
   - Stores new cursor in Redis and PostgreSQL.
   - Passes events to `processTriggerEvents()`.
3. On trigger disable/delete, `removePollingJob()` removes the repeatable job.

**Edge cases:**
- Missing integration `connectionId` → logs warning, returns.
- Redis cursor missing → first poll (cursor = null).
- Cursor parse failure → falls back to raw string.

**Files touched:** `apps/trigger-service/src/polling/worker.ts`, `packages/services/src/triggers/service.ts`, `packages/queue/src/index.ts`

### 6.3 Trigger CRUD

**What it does:** oRPC routes for managing triggers. **Status: Implemented.**

**Happy path:**
1. `create` validates prebuild and integration existence, generates `webhookUrlPath` (UUID-based) and `webhookSecret` (32-byte hex) for webhook triggers, creates an automation parent record, then creates the trigger. For polling triggers, schedules a BullMQ repeatable job.
2. `update` modifies trigger fields. For polling triggers, reschedules or removes the repeatable job based on `enabled` state and `pollingCron`.
3. `delete` removes the trigger (cascades to events). For polling triggers, removes the repeatable job.
4. `list` returns triggers with integration data and pending event counts.
5. `get` returns a single trigger with recent events and event status counts.
6. `listEvents` returns paginated events with trigger and session relations.
7. `skipEvent` marks a queued event as `skipped` with reason `manual`.

**Files touched:** `apps/web/src/server/routers/triggers.ts`, `packages/services/src/triggers/service.ts`, `packages/services/src/triggers/db.ts`

### 6.4 Provider Adapters

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

### 6.5 Schedule CRUD

**What it does:** Manages cron schedules attached to automations. **Status: Implemented.**

**Happy path:**
1. `getSchedule(id, orgId)` returns a single schedule.
2. `updateSchedule(id, orgId, input)` validates cron expression (5-6 fields) and updates.
3. `deleteSchedule(id, orgId)` removes the schedule.
4. `createSchedule` (called from automations context) validates cron and inserts.

**Files touched:** `apps/web/src/server/routers/schedules.ts`, `packages/services/src/schedules/service.ts`, `packages/services/src/schedules/db.ts`

### 6.6 PubSub Session Events Subscriber

**What it does:** Listens on Redis PubSub for session events and wakes async clients (e.g., Slack). **Status: Implemented.**

**Happy path:**
1. `SessionSubscriber` subscribes to `SESSION_EVENTS_CHANNEL` on Redis.
2. On `user_message` events, looks up the session's `clientType`.
3. Finds the registered `WakeableClient` for that type and calls `wake(sessionId, metadata, source, options)`.

**Edge cases:**
- Session has no async client → no-op.
- No registered client for type → logs warning.

**Files touched:** `apps/worker/src/pubsub/session-events.ts`

### 6.7 Provider Registry & Metadata API

**What it does:** Exposes registered trigger providers and their config schemas. **Status: Implemented.**

**Happy path:**
1. `GET /providers` iterates all registered triggers and returns ID, provider name, type (webhook/polling), metadata, and JSON Schema from Zod config schema.
2. `GET /providers/:id` returns a single provider definition.

**Files touched:** `apps/trigger-service/src/api/providers.ts`, `packages/triggers/src/service/registry.ts`

### 6.8 Direct Webhook Routes (Web App)

**What it does:** Next.js API routes that handle webhook ingestion directly, bypassing the trigger service. **Status: Implemented.**

These routes exist alongside the trigger-service webhook handler. They handle providers/scenarios where Nango forwarding is not used.

#### Nango route (`/api/webhooks/nango`)
- Verifies `X-Nango-Hmac-Sha256` signature.
- Handles three webhook types: `auth` (updates integration status), `sync` (logged only), `forward` (parses payload via `TriggerProvider`, calls `triggers.processTriggerEvents()`).
- File: `apps/web/src/app/api/webhooks/nango/route.ts`

#### GitHub App route (`/api/webhooks/github-app`)
- Receives webhooks directly from GitHub App installations (not via Nango).
- Verifies `X-Hub-Signature-256` using `GITHUB_APP_WEBHOOK_SECRET`.
- Handles installation lifecycle events (deleted, suspend, unsuspend) by updating integration status.
- For other events: maps `installation.id` → integration → active triggers, then filters/dedupes/creates runs.
- File: `apps/web/src/app/api/webhooks/github-app/route.ts`

#### Custom webhook route (`/api/webhooks/custom/[triggerId]`)
- Accepts any POST payload to a trigger-specific URL.
- Optional HMAC-SHA256 verification (checks `X-Webhook-Signature`, `X-Signature`, `X-Hub-Signature-256`, `X-Signature-256` headers).
- Dedup key: SHA-256 hash of raw body, checked within 5-minute window via `findDuplicateEventByDedupKey()`.
- Also supports GET for health checks.
- File: `apps/web/src/app/api/webhooks/custom/[triggerId]/route.ts`

#### PostHog route (`/api/webhooks/posthog/[automationId]`)
- Uses automation ID in URL (known before trigger creation).
- Finds PostHog trigger by automation via `automations.findTriggerForAutomationByProvider()`.
- Optional `PostHogProvider.verifyWebhook()` (controlled by `config.requireSignatureVerification`).
- Full filter/dedup/run-creation pipeline using `PostHogProvider` methods.
- File: `apps/web/src/app/api/webhooks/posthog/[automationId]/route.ts`

#### Automation webhook route (`/api/webhooks/automation/[automationId]`)
- Generic automation-scoped webhook (similar to custom, but keyed by automation ID).
- Finds webhook trigger via `automations.findWebhookTrigger()`.
- Dedup key: SHA-256 hash of raw body, checked via `automations.isDuplicateTriggerEvent()`.
- File: `apps/web/src/app/api/webhooks/automation/[automationId]/route.ts`

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| Automations | Triggers → Automations | `runs.createRunFromTriggerEvent()` | Handoff point. Creates trigger event + automation run + outbox entry in one transaction. |
| Automations | Triggers → Automations | `automations.findWebhookTrigger()`, `automations.findTriggerForAutomationByProvider()` | Used by automation-scoped and PostHog webhook routes. |
| Integrations | Triggers → Integrations | `integrations.findByConnectionIdAndProvider()`, `integrations.findActiveByGitHubInstallationId()` | Resolves Nango connectionId or GitHub installation ID to integration record. |
| Integrations | Triggers ← Integrations | `trigger.integrationId` FK | Trigger references its OAuth connection. |
| Queue (BullMQ) | Triggers → Queue | `schedulePollingJob()`, `removePollingJob()`, `createPollingWorker()` | POLLING queue for repeatable poll jobs. |
| Redis | Triggers → Redis | `REDIS_KEYS.pollState(triggerId)` | Cursor storage for polling. |
| Outbox | Triggers → Outbox | `outbox.insert({ kind: "enqueue_enrich" })` | Reliable handoff to automation run pipeline. See `automations-runs.md`. |
| Sessions | Events → Sessions | `trigger_events.session_id` FK | Links event to resulting session (set after run execution). |

### Security & Auth
- **Trigger CRUD**: Protected by `orgProcedure` middleware (requires authenticated user + org membership).
- **Trigger-service webhooks**: Public endpoint (`POST /webhooks/nango`). Signature verified via Nango HMAC-SHA256 (`verifyNangoSignature` using `timingSafeEqual`).
- **Web app webhook routes**: All public endpoints. Each route verifies signatures independently:
  - Nango route: `X-Nango-Hmac-Sha256` header.
  - GitHub App route: `X-Hub-Signature-256` header against `GITHUB_APP_WEBHOOK_SECRET` env var.
  - Custom/automation routes: optional HMAC verification using stored `webhookSecret` (checks `X-Webhook-Signature`, `X-Signature`, `X-Hub-Signature-256`, `X-Signature-256` headers).
  - PostHog route: optional `PostHogProvider.verifyWebhook()` (controlled by `config.requireSignatureVerification`).
- **Webhook secrets**: 32-byte random hex stored in DB. Generated on trigger creation.

### Observability
- Trigger service logger: `@proliferate/logger` with `{ service: "trigger-service" }`.
- Child loggers per module: `{ module: "webhooks" }`, `{ module: "polling" }`, `{ module: "trigger-processor" }`.
- Structured fields: `triggerId`, `connectionId`, `sessionId`.

---

## 8. Acceptance Gates

- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] Relevant tests pass (`pnpm test`)
- [ ] This spec is updated (file tree, data models, deep dives)

---

## 9. Known Limitations & Tech Debt

- [ ] **SCHEDULED queue worker not instantiated** — `createScheduledWorker()` exists in `packages/queue/src/index.ts` and jobs can be enqueued, but no worker is started in any running service. The scheduled trigger worker was archived (`apps/worker/src/_archived/`). Cron-based triggers that rely on this queue do not execute. — High impact.
- [ ] **Dual webhook ingestion paths** — Webhook ingestion exists in both trigger-service (`POST /webhooks/nango`) and web app API routes (`apps/web/src/app/api/webhooks/`). The Nango route is duplicated across both. GitHub App webhooks go only through the web app, not trigger-service. PostHog webhooks go only through the web app. Should consolidate to a single ingestion layer. — Medium complexity.
- [ ] **Dual abstraction layers** — Both `TriggerProvider` interface (`types.ts`) and `WebhookTrigger`/`PollingTrigger` classes (`service/base.ts`) exist. Nango adapter classes bridge between them by delegating to `TriggerProvider` methods. Should consolidate. — Medium complexity.
- [ ] **Deprecated trigger fields** — `name`, `description`, `executionMode`, `allowAgenticRepoSelection`, `agentInstructions` on the triggers table are deprecated in favor of the parent automation's fields, but still populated on create. — Low impact, remove when safe.
- [ ] **Gmail provider requires Composio** — Gmail polling uses Composio as an OAuth token broker, adding an external dependency. Only registered when `COMPOSIO_API_KEY` is set. Full implementation exists but external dependency makes it Partial.
- [ ] **PostHog not registered in trigger service** — The `PostHogProvider` exists in `packages/triggers/src/posthog.ts` and registers in the functional provider registry, but there is no `PostHogNangoTrigger` adapter in `service/adapters/`. PostHog webhooks are handled via a separate web app API route (`apps/web/src/app/api/webhooks/posthog/`), not through the trigger service. — Should be unified.
- [ ] **pollLock defined but unused** — `REDIS_KEYS.pollLock` is defined in `packages/queue/src/index.ts` but only used in archived code (`apps/worker/src/_archived/redis.ts`). The active polling worker does not acquire locks. — Concurrent polls for the same trigger are possible.
- [ ] **removePollingJob passes empty pattern** — `removePollingJob` calls `queue.removeRepeatable` with an empty `pattern` string, relying on BullMQ behavior that may change. — Low risk but fragile.
- [ ] **No retry logic for failed trigger event processing** — If `createRunFromTriggerEvent` fails, the event is marked as skipped with reason `run_create_failed`. There is no automatic retry mechanism. — Events can be manually retried via re-processing.
- [ ] **HMAC helper duplication** — The `hmacSha256` function is duplicated across `github.ts`, `linear.ts`, `sentry.ts`, `posthog.ts`, and multiple web app webhook routes. Should be extracted to a shared utility. — Low impact.

````

## New version of triggers (vNext)

Source: `docs/specs/vnext/triggers.md`

````markdown
# Triggers — System Spec

> **vNext (target architecture)** — This spec describes the intended trigger ingestion and dispatch design after webhook consolidation + unified integration modules, and may not match `main` yet.
>
> Current implemented spec: `../triggers.md`  
> Design change set: `../../../integrations_architecture.md`

Terminology note: this spec uses `IntegrationProvider` / "integration module" for external service integrations (Linear/Sentry/etc). This is distinct from sandbox compute providers (Modal/E2B) in `./sandbox-providers.md`.

## 1. Scope & Purpose

### In Scope
- Trigger CRUD (create, update, delete, list, get).
- Trigger service (`apps/trigger-service/`) ingestion: Nango-forwarded webhooks (`POST /webhooks/nango`).
- Trigger service (`apps/trigger-service/`) ingestion: direct webhooks (`POST /webhooks/direct/:providerId/...`).
- Provider-declared trigger types, config schemas, and pure filtering (`IntegrationProvider.triggers.types[].matches()`).
- Provider-declared webhook verification + parsing (`IntegrationProvider.triggers.webhook.verify/parse`).
- Provider-declared polling (`IntegrationProvider.triggers.polling.poll()`), cursor storage, and scheduling via BullMQ repeatable jobs.
- Event normalization, deduplication, and handoff to automations via transactional outbox.
- Webhook identity routing (provider extracts identity; framework resolves identity → org → triggers).

### Out of Scope
- Automation run pipeline after the outbox enqueue — see `automations-runs.md`.
- Action execution and permissioning — see `./actions.md`.
- OAuth connection lifecycle and token storage — see `./integrations.md`.
- Session lifecycle and sandbox runtime — see `./sessions-gateway.md`, `./sandbox-providers.md`.

### Mental Model

Triggers are the inbound event layer of Proliferate. External services emit events that Proliferate ingests, normalizes, filters, deduplicates, and converts into automation runs. In vNext, trigger provider logic is consolidated into code-defined integration modules (`IntegrationProvider`), and webhook ingestion is consolidated into the trigger service (eliminating the dual-ingestion path via Next.js API routes).

Integration modules are stateless and framework-owned state is explicit:
- Providers never read PostgreSQL, write Redis, or schedule jobs.
- Providers declare trigger types and implement pure parsing/filtering functions.
- The trigger service owns persistence, deduplication, cursor storage, rate limiting, job scheduling, retries, and observability.

**Core entities:**
- **Trigger** — a configured event source bound to an automation. Types: webhook or polling.
- **Normalized event** — provider-normalized event payload used for matching, dedup, and storage.
- **Trigger type** — a provider-declared event type with config schema and `matches()` function.

**Key invariants:**
- Webhook ingestion happens only in `apps/trigger-service` in vNext.
- Webhook HTTP handlers must acknowledge quickly (after verification + persistence). All hydration/network work happens asynchronously.
- `matches()` is pure and fast: no API calls, no side effects.
- Complex filtering uses optional `hydrate()` which runs once per event (not per trigger) and is cached per-ingest batch.
- Deduplication is enforced by a unique constraint on `(trigger_id, dedup_key)`.

---

## 2. Core Concepts

### IntegrationProvider Triggers Contract
Providers declare trigger behavior via `IntegrationProvider.triggers`:
- `types[]` describes trigger types, config schema, and `matches()`.
- `webhook` optionally implements verification and parsing.
- `polling` optionally implements cursor-based polling.
- `hydrate` optionally enriches normalized events once per event.
- Key detail agents get wrong: providers are not allowed to touch lifecycle state (no DB, no Redis, no scheduling). They only operate on inputs and return outputs.
- Reference: `../../../integrations_architecture.md` §4

### Webhook Verification + Parsing (Ingestion-Neutral)
Webhook parsing uses an ingestion-neutral `WebhookParseInput` so providers don't branch on "Nango vs direct". The framework constructs `WebhookRequest` from the raw Express request and passes secrets in explicitly.
- Key detail agents get wrong: verification must use the raw request body (`Buffer`) and should be implemented as a pure function (`verify(req, secret)`).
- Reference: `../../../integrations_architecture.md` §4, §9

### Webhook Identity Routing
Providers extract an identity used for routing (`triggerId`, external integration instance ID like GitHub installation ID, or an org ID). The framework resolves identity → organization → active triggers.
- Key detail agents get wrong: identity extraction can happen during verification (before parsing) and must not require database access in provider code.
- Reference: `../../../integrations_architecture.md` §4, §9

### Webhook Inbox (Async Processing Boundary)
Webhook providers expect fast responses (often a few seconds) and may retry or disable endpoints if handlers are slow. In vNext, webhook ingestion is split into two phases:
1. **Ingestion (HTTP request)**: verify signature, capture minimal metadata, persist to `webhook_inbox`, return 2xx immediately.
2. **Processing (async worker)**: parse, optional `hydrate()` (with backoff on 429), match, dedup, and create runs.

- Key detail agents get wrong: calling `hydrate()` inside the Express request handler can cause a rate limit storm (concurrent webhooks) and lead to upstream webhook timeouts/retries.

### Generic Trigger Pipeline
Both webhook and polling processing feed a single generic pipeline (run in workers, not in the webhook HTTP handler):
- Parse provider payload into `NormalizedTriggerEvent[]`
- Optional `hydrate()` (once per event, cached per processing batch)
- Per-trigger `matches(event, config)` evaluation
- Dedup insert guard `(trigger_id, dedup_key)`
- Transactional insert of `trigger_event`, `automation_run`, and outbox enqueue
- Reference: `../../../integrations_architecture.md` §9, §10

### Polling (Integration-Scoped, Cursor-Based)
Polling is cursor-based and framework-owned, but is scheduled per polling group (typically per `(organizationId, providerId, integrationId)`), not per trigger. This avoids rate limit fan-out when many triggers share the same provider token.
- A single poll fetches a superset of recent events for the connection.
- The framework then fans out those events in-memory to evaluate `matches()` across all active triggers in the group.
- Key detail agents get wrong: the cursor is opaque provider data (not always a timestamp).
- Reference: `../../../integrations_architecture.md` §10

---

## 3. File Tree

vNext consolidates webhook ingestion into the trigger service and moves provider-specific logic into `packages/providers/`.

```
apps/trigger-service/src/
├── index.ts                          # Entry point: starts server + polling worker
├── server.ts                         # Express app setup (health, webhook routes)
├── api/
│   └── webhooks.ts                   # Verify + enqueue (POST /webhooks/nango, POST /webhooks/direct/:providerId)
├── lib/
│   ├── logger.ts
│   ├── identity-resolver.ts          # Resolve WebhookIdentity → organization + triggers
│   └── trigger-processor.ts          # Generic pipeline (hydrate, matches, dedup, run creation)
├── webhook-inbox/
│   └── worker.ts                     # BullMQ worker: process webhook_inbox rows
└── polling/
    └── worker.ts                     # BullMQ worker: poll per polling group, then fan out to triggers

packages/providers/src/
├── registry.ts                       # ProviderRegistry (static Map)
├── types.ts                          # IntegrationProvider + trigger types
└── providers/
    ├── linear/                       # webhook + polling
    ├── sentry/                       # webhook-only
    ├── github/                       # direct webhooks
    └── posthog/                      # direct, per-trigger webhooks

packages/services/src/triggers/
├── service.ts                        # Trigger CRUD + scheduling orchestration
├── db.ts
└── mapper.ts

packages/db/src/schema/
└── triggers.ts                       # triggers + trigger_events tables

apps/web/src/app/api/webhooks/        # Deprecated in vNext (deleted at cutover)
```

---

## 4. Data Models & Schemas

### Database Tables

The vNext pipeline stores normalized event fields explicitly and retains raw payload as optional debug/audit context.

```sql
triggers
├── id                    UUID PK
├── organization_id       TEXT NOT NULL
├── automation_id         UUID NOT NULL
├── trigger_type          TEXT NOT NULL          -- "webhook" | "polling"
├── provider              TEXT NOT NULL          -- provider id ("linear", "sentry", "github", "posthog", "custom")
├── event_type            TEXT                  -- provider trigger type id (optional)
├── enabled               BOOLEAN NOT NULL
├── config                JSONB NOT NULL         -- validated via provider TriggerType.schema
├── integration_id        UUID                   -- token source for polling/hydrate (nullable)
├── webhook_secret        TEXT                   -- if provider uses per-trigger secrets
├── webhook_url_path      TEXT UNIQUE            -- if provider uses per-trigger URLs
├── polling_state         JSONB                  -- deprecated: cursor stored on trigger_poll_groups.cursor
├── last_polled_at        TIMESTAMPTZ            -- deprecated: use trigger_poll_groups.last_polled_at
├── external_webhook_id   TEXT                   -- optional: providers with expiring registrations (e.g., Jira)
├── created_at            TIMESTAMPTZ
└── updated_at            TIMESTAMPTZ
    INDEX(organization_id)
    INDEX(automation_id)
```

```sql
-- New in vNext: decouple webhook ingestion from processing
webhook_inbox
├── id                    UUID PK
├── received_at           TIMESTAMPTZ NOT NULL
├── provider              TEXT NOT NULL
├── provider_event_type   TEXT
├── headers               JSONB
├── payload               JSONB NOT NULL          -- verified provider payload (or verified Nango inner payload)
├── status                TEXT NOT NULL           -- queued | processing | completed | failed
├── attempt               INT NOT NULL DEFAULT 0
├── next_attempt_at       TIMESTAMPTZ
├── last_error            TEXT
└── processed_at          TIMESTAMPTZ
    INDEX(status, next_attempt_at)
```

```sql
-- New in vNext: polling state is stored per polling group (typically per integration), not per trigger
trigger_poll_groups
├── id                    UUID PK
├── organization_id       TEXT NOT NULL
├── provider              TEXT NOT NULL
├── integration_id        UUID                   -- nullable for providers that don't require tokens
├── cursor                JSONB                  -- opaque provider cursor
├── interval_seconds      INT NOT NULL
├── last_polled_at        TIMESTAMPTZ
├── created_at            TIMESTAMPTZ
└── updated_at            TIMESTAMPTZ
    UNIQUE(organization_id, provider, integration_id)
```

```sql
trigger_events
├── id                    UUID PK
├── trigger_id             UUID NOT NULL
├── organization_id       TEXT NOT NULL
├── provider              TEXT NOT NULL
├── event_type            TEXT NOT NULL          -- normalized internal type
├── provider_event_type   TEXT                   -- native event type (header/envelope)
├── occurred_at           TIMESTAMPTZ NOT NULL
├── dedup_key             TEXT NOT NULL
├── title                 TEXT NOT NULL
├── url                   TEXT
├── context               JSONB NOT NULL         -- structured normalized data
├── raw_payload           JSONB                  -- optional original payload
├── status                TEXT NOT NULL
├── error_message         TEXT
├── created_at            TIMESTAMPTZ
└── processed_at          TIMESTAMPTZ
    UNIQUE(trigger_id, dedup_key)
```

### Core TypeScript Types

```ts
// packages/providers/src/types.ts (dependency)
interface NormalizedTriggerEvent {
	provider: string;
	eventType: string;
	providerEventType: string;
	occurredAt: string;
	dedupKey: string;
	title: string;
	url?: string;
	context: Record<string, unknown>;
	raw?: unknown;
}
```

---

## 5. Conventions & Patterns

### Do
- Keep `matches()` pure: no network, no DB, no side effects.
- Use `hydrate()` only when webhook/poll payloads are insufficient for `matches()` and cache it per ingest batch.
- Verify signatures using raw body bytes and constant-time comparisons.
- Consolidate all webhooks into trigger-service routes; delete Next.js webhook routes at cutover.
- Enqueue webhooks to `webhook_inbox` and return 2xx quickly; do not block request handlers on provider API calls.

### Don't
- Don't parse Nango envelopes inside provider code. Framework extracts raw provider payload and passes ingestion-neutral inputs.
- Don't implement provider logic in trigger-service classes; it belongs in `packages/providers/src/providers/<id>/`.
- Don't run concurrent polls for the same polling group; use a Redis lock to skip duplicate cycles.
- Don't call `hydrate()` inside webhook HTTP handlers.

### Reliability
- Polling uses a Redis lock `poll:<providerId>:<integrationId>` with TTL equal to the poll interval. If locked, skip the cycle (best-effort).
- Provider polling can return `backoffSeconds` to inform scheduler backoff on rate limiting.

---

## 6. Subsystem Deep Dives

### 6.1 Nango-Forwarded Webhook Ingestion

**What it does:** Verifies Nango-forwarded webhooks, enqueues them, and processes them asynchronously into trigger events.

**Happy path:**
1. `POST /webhooks/nango` verifies Nango envelope signature.
2. Framework extracts `{ providerId, providerEventType, rawProviderPayload }`.
3. Insert a `webhook_inbox` row (providerId, providerEventType, payload, receivedAt, headers).
4. Return 2xx immediately.
5. Async worker claims the inbox row, calls `provider.triggers.webhook.parse(...)`, resolves identity, optionally calls `hydrate()` with backoff on 429, then runs `matches()`/dedup and creates runs via transactional outbox.

### 6.2 Direct Webhook Ingestion

**What it does:** Verifies direct provider webhooks, enqueues them, and processes them asynchronously into trigger events.

**Happy path:**
1. `POST /webhooks/direct/:providerId/...` looks up provider in `ProviderRegistry`.
2. Framework resolves verification secret (env/config/DB based on untrusted candidate identity).
3. Call `provider.triggers.webhook.verify(req, secret)`.
4. If `immediateResponse` is returned, respond (challenge-response).
5. Insert a `webhook_inbox` row (providerId, providerEventType, verified payload, receivedAt, headers).
6. Return 2xx immediately.
7. Async worker claims the inbox row, calls `provider.triggers.webhook.parse(...)`, resolves identity, and runs the generic pipeline.

### 6.3 Generic Pipeline (Hydrate, Match, Dedup, Run)

**What it does:** Matches events against triggers and creates automation runs.

**Happy path:**
1. Parse provider payload into normalized events via `provider.triggers.webhook.parse(...)` (webhooks) or `provider.triggers.polling.poll(...)` (polling).
2. If provider defines `hydrate`, call it once per event and cache the result.
3. Load active triggers for `(orgId, providerId)`.
4. For each trigger, validate config and run `matches(event, config)`.
5. If matched, attempt insert guarded by `UNIQUE(trigger_id, dedup_key)`.
6. Insert `trigger_event`, `automation_run`, and outbox record in one transaction.

### 6.4 Polling Cycle

**What it does:** Pulls events from provider APIs on an interval per polling group (typically per integration), then evaluates matches across all triggers in the group.

**Happy path:**
1. BullMQ job loads polling group (orgId, providerId, integrationId) + cursor.
2. Acquire Redis lock `poll:<providerId>:<integrationId>`; if locked, skip.
3. Resolve token (if required) via `getToken()` (Integrations-owned).
4. Call provider polling once for the group to fetch a superset of recent events.
5. Persist `nextCursor` on the polling group record.
6. Load active triggers in the group and evaluate `matches()` for each event/trigger pair in-memory.
7. Dedup and create runs via the generic pipeline.

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| Providers package | Trigger service → Providers | `ProviderRegistry` | Lookup integration modules for parsing/polling/matching. |
| Integrations | Trigger service → Integrations | `getToken()` | Polling and optional `hydrate()` token resolution. |
| Automations | Triggers → Automations | `createRunFromTriggerEvent()` | Transactional outbox handoff. |
| Secrets | Triggers → Secrets | `resolveSecretValue()` | Webhook verification secrets (provider-specific). |

### Security & Auth
- Webhook endpoints are unauthenticated by design; signature verification is mandatory where the provider supports it.
- Provider verification must not leak secrets in error messages or logs.

### Observability
- Log fields: `providerId`, `organizationId` (after resolution), `triggerId`, `providerEventType`, `eventType`, `dedupKey`.
- Metrics: webhook request counts by provider, parse failures, dedup hits, poll duration, poll backoffs, run creation failures.

---

## 8. Acceptance Gates

- [ ] Specs updated in `docs/specs/vnext/` when changing trigger ingestion or provider trigger contracts.
- [ ] Typecheck passes
- [ ] Trigger ingestion paths have integration tests for signature verification + parsing (if implementing code)

---

## 9. Known Limitations & Tech Debt

- [ ] Providers with expiring webhook registrations (e.g., Jira) require a refresh job and `external_webhook_id` persistence. See `../../../integrations_architecture.md` §8.
- [ ] Secret resolution can be chicken-and-egg for per-integration secrets; use a two-step "candidate identity -> secret -> verify" pattern. See `../../../integrations_architecture.md` §9.

````

---

