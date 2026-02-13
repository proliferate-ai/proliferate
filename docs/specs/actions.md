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

Actions are platform-mediated operations that the agent performs on external services. Implemented action sources are (a) hand-written Linear/Sentry/Slack adapters and (b) connector-backed MCP `remote_http` sources discovered from prebuild connector config. Unlike tools that run inside the sandbox, actions are executed server-side by the gateway using either OAuth tokens (`integrations.getToken`) or org-scoped secrets (`secrets.resolveSecretValue`) depending on source type. Every action goes through a risk-based approval pipeline before execution (`packages/services/src/actions/service.ts:invokeAction`).

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
2. **Connector-backed actions** — prebuild-configured MCP `remote_http` connectors discovered at runtime. The gateway connects to remote MCP servers, lists tools via `tools/list`, and normalizes them into `ActionDefinition[]`. Connector actions use the `connector:<uuid>` integration prefix to distinguish them from static adapters in the `integration` column.

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

**What it does:** oRPC route for querying action invocations at the org level.

**Route:** `actions.list` — org-scoped procedure accepting optional `status` filter and `limit`/`offset` pagination (default 50/0, max 100). Returns invocations with session title joined, plus total count for pagination. Dates serialized to ISO strings.

**Files touched:** `apps/web/src/server/routers/actions.ts`, `packages/services/src/actions/db.ts:listByOrg`

### 6.10 Integration Guide Flow — `Implemented`

**What it does:** Serves integration-specific markdown guides to the agent.

**Flow:**
1. Agent calls `proliferate actions guide --integration linear`
2. CLI sends `GET /:sessionId/actions/guide/linear` to gateway (`actions.ts` guide handler)
3. Gateway calls `getGuide("linear")` (`adapters/index.ts:getGuide`) — looks up adapter in registry, returns `adapter.guide`
4. Returns markdown guide with CLI examples for each action

Each adapter embeds its own guide as a static string (e.g., `linearAdapter.guide`, `sentryAdapter.guide`, `slackAdapter.guide`).

**Files touched:** `packages/services/src/actions/adapters/index.ts:getGuide`, adapter files

### 6.11 MCP Connector System — `Implemented`

**What it does:** Enables prebuild-configured remote MCP servers to surface tools through the Actions pipeline, giving agents access to any MCP-compatible service while preserving the existing risk/approval/grant/audit flow.

**Architecture:**
```
Prebuild (connectors JSONB) → Gateway resolves at session runtime
  → MCP Client connects to remote server (StreamableHTTPClientTransport)
  → tools/list → ActionDefinition[] (cached 5 min per session)
  → Merged into GET /available alongside adapter actions
  → POST /invoke → risk/grant evaluation → tools/call on MCP server
```

**Key components:**
- **Connector config** (`packages/shared/src/connectors.ts`): `ConnectorConfig` type + Zod schemas. Stored as JSONB on prebuilds table. Max 20 connectors per prebuild.
- **MCP client** (`packages/services/src/actions/connectors/client.ts`): Stateless — creates a fresh `Client` per `listConnectorTools()` or `callConnectorTool()` call. Uses `@modelcontextprotocol/sdk` (MIT). 15s timeout for tool listing, 30s for calls.
- **Risk derivation** (`packages/services/src/actions/connectors/risk.ts`): Priority: per-tool policy override → MCP annotations (`destructiveHint`→danger, `readOnlyHint`→read; destructive checked first for fail-safe) → connector default risk → "write" fallback.
- **Secret resolution**: Connector `auth.secretKey` references an org-level secret by key name. Resolved at call time via `secrets.resolveSecretValue()`. Keys never enter the sandbox.
- **Gateway integration** (`apps/gateway/src/api/proliferate/http/actions.ts`): In-memory tool cache (`Map<sessionId, CachedConnectorTools[]>`, 5-min TTL). Connector branches in `GET /available`, `GET /guide/:integration`, `POST /invoke`, `POST /approve`.
- **Integration prefix**: Connector actions use `connector:<uuid>` in the `integration` column. Grants match this as a string (wildcards work). `integrationId` is `null` for connector invocations.

**Connector guide auto-generation:** `GET /guide/connector:<id>` generates a markdown guide from cached tool definitions (name, description, risk level, parameters) instead of using a static adapter guide string.

**Graceful degradation:** If an MCP server is unreachable during `tools/list`, its tools simply don't appear in the available list. Other connectors and static adapters continue working.

**oRPC CRUD:** `apps/web/src/server/routers/prebuilds.ts` provides `getConnectors` and `updateConnectors` routes for managing prebuild connector configs.

**Files touched:** `packages/services/src/actions/connectors/`, `packages/shared/src/connectors.ts`, `packages/services/src/secrets/service.ts`, `packages/services/src/prebuilds/db.ts`, `apps/gateway/src/api/proliferate/http/actions.ts`, `apps/web/src/server/routers/prebuilds.ts`

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `integrations.md` | Actions → Integrations | `integrations.getToken()` (`packages/services/src/integrations/tokens.ts:getToken`) | Token resolution for adapter execution |
| `integrations.md` | Actions → Integrations | `sessions.listSessionConnections()` (`packages/services/src/sessions/db.ts`) | Discovers which integrations are available for a session |
| `repos-prebuilds.md` | Actions ↔ Prebuilds | `prebuilds.connectors` JSONB, `getPrebuildConnectors()`, `parsePrebuildConnectors()` | Connector configs stored on prebuilds, resolved by gateway at session runtime via `loadSessionConnectors()` |
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
- [x] **Static adapter registry** — addressed by MCP connector system (§6.11). Remote MCP connectors are configured per-prebuild and discovered at runtime. Static adapters remain for Linear/Sentry/Slack but new integrations can be added via connector config without code changes.
- [ ] **Grant rollback is best-effort** — if invocation approval fails after grant creation, the grant revocation is attempted but failures are silently caught. Impact: orphaned grants may exist in rare edge cases. Expected fix: wrap in a transaction or add cleanup sweep.
- [ ] **No pagination on grants list** — `listActiveGrants` and `listGrantsByOrg` return all matching rows with no limit/offset. Impact: could return large result sets for orgs with many grants. Expected fix: add pagination parameters.
- [x] **Connector session stickiness** — addressed. `callConnectorTool` now passes `Mcp-Session-Id` when the server issues one during `initialize`, and retries once on 404 session invalidation. Source: `packages/services/src/actions/connectors/client.ts`.
- [x] **Dedicated connector management UI** — addressed. Settings panel "Tools" tab provides add/edit/remove/validate flow with presets, secret picker, and inline validation diagnostics. Source: `apps/web/src/components/coding-session/connectors-panel.tsx`, `apps/web/src/hooks/use-connectors.ts`.
