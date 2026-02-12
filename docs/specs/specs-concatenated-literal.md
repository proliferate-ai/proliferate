# FILE: docs/specs/actions.md

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
- Invocation sweeper (expiry job)
- Sandbox-MCP grants handler
- Actions list (org-level inbox)

### Out of Scope
- Tool schema definitions (how `proliferate` CLI tools get injected into sandboxes) — see `agent-contract.md` §6.3
- Session runtime (hub, WebSocket streaming, event processing) — see `sessions-gateway.md` §6
- Integration OAuth flows for Linear/Sentry (connection lifecycle) — see `integrations.md`
- Automation runs that invoke actions — see `automations-runs.md` §6

### Mental Model

Actions are platform-mediated operations that the agent performs on external services (Linear, Sentry). Unlike tools that run inside the sandbox, actions are executed server-side by the gateway using OAuth tokens resolved from Nango connections (`packages/services/src/integrations/tokens.ts:getToken`). Every action goes through a risk-based approval pipeline before execution (`packages/services/src/actions/service.ts:invokeAction`).

The agent invokes actions via the `proliferate` CLI inside the sandbox. The CLI sends HTTP requests to the gateway (`apps/gateway/src/api/proliferate/http/actions.ts`), which evaluates risk, checks for matching grants, and either auto-executes or queues the invocation for human approval. Users approve or deny pending invocations through the web dashboard or WebSocket events.

**Core entities:**
- **Invocation** — a single request to execute an action, with its approval state. Lifecycle: pending → approved → executing → completed (or denied/expired/failed).
- **Grant** — a reusable permission allowing the agent to perform a specific action without per-invocation approval. Scoped to session or org, with optional call budgets.
- **Adapter** — an integration-specific module that declares available actions and implements execution against the external API.

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
Adapters are statically registered in a `Map`. Currently two adapters exist: `linear` and `sentry`. Each adapter declares its actions, their risk levels, parameter schemas, an `execute()` function, and an optional markdown `guide`.
- Key detail agents get wrong: adapters are not dynamically discovered. Adding a new integration requires code changes to the registry.
- Reference: `packages/services/src/actions/adapters/index.ts`

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
└── adapters/
    ├── index.ts                      # Adapter registry (Map-based)
    ├── types.ts                      # ActionAdapter / ActionDefinition interfaces
    ├── linear.ts                     # Linear GraphQL adapter (5 actions)
    └── sentry.ts                     # Sentry REST adapter (5 actions)

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
├── integration       TEXT NOT NULL                     -- adapter name ("linear", "sentry")
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
- **External API timeout**: 30s on both Linear and Sentry adapters.

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
2. **Via sandbox CLI**: Agent calls `POST /:sessionId/actions/grants` — creates a grant with `createdBy` = the session ID (not a user ID). Source: `actions.ts` grants POST handler → `actions.createGrant({ createdBy: sessionId })`. This violates the `action_grants.created_by` FK to `user(id)` — see §9.

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

### 6.6 Invocation Sweeper — `Implemented`

**What it does:** Periodically marks stale pending invocations as expired.

**Mechanism:** `setInterval` every 60 seconds calling `actions.expireStaleInvocations()`, which runs `UPDATE action_invocations SET status='expired', completed_at=now() WHERE status='pending' AND expires_at <= now()`. Uses the `idx_action_invocations_status_expires` index.

**Lifecycle:** Started by `startActionExpirySweeper(logger)` in the worker process. Stopped by `stopActionExpirySweeper()` on shutdown.

**Files touched:** `apps/worker/src/sweepers/index.ts`, `packages/services/src/actions/db.ts:expirePendingInvocations`

### 6.7 Sandbox-MCP Grants Handler — `Implemented`

**What it does:** Provides CLI command handlers for grant management inside the sandbox.

**Commands:**
- `actions grant request` — creates a grant via `POST /grants`. Flags: `--integration` (required), `--action` (required), `--scope` (session|org, default session), `--max-calls` (optional positive integer).
- `actions grants list` — lists active grants via `GET /grants`.

**Design:** Uses injectable `GatewayRequestFn` for testability — the CLI's `fatal()` calls `process.exit`, so command logic is extracted into pure async functions.

**Files touched:** `packages/sandbox-mcp/src/actions-grants.ts`

### 6.8 Actions List (Org Inbox) — `Implemented`

**What it does:** oRPC route for querying action invocations at the org level.

**Route:** `actions.list` — org-scoped procedure accepting optional `status` filter and `limit`/`offset` pagination (default 50/0, max 100). Returns invocations with session title joined, plus total count for pagination. Dates serialized to ISO strings.

**Files touched:** `apps/web/src/server/routers/actions.ts`, `packages/services/src/actions/db.ts:listByOrg`

### 6.9 Integration Guide Flow — `Implemented`

**What it does:** Serves integration-specific markdown guides to the agent.

**Flow:**
1. Agent calls `proliferate actions guide --integration linear`
2. CLI sends `GET /:sessionId/actions/guide/linear` to gateway (`actions.ts` guide handler)
3. Gateway calls `getGuide("linear")` (`adapters/index.ts:getGuide`) — looks up adapter in registry, returns `adapter.guide`
4. Returns markdown guide with CLI examples for each action

Each adapter embeds its own guide as a static string (e.g., `linearAdapter.guide`, `sentryAdapter.guide`). Source: `packages/services/src/actions/adapters/linear.ts:233-286`, `sentry.ts:148-206`

**Files touched:** `packages/services/src/actions/adapters/index.ts:getGuide`, adapter files

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `integrations.md` | Actions → Integrations | `integrations.getToken()` (`packages/services/src/integrations/tokens.ts:getToken`) | Token resolution for adapter execution |
| `integrations.md` | Actions → Integrations | `sessions.listSessionConnections()` (`packages/services/src/sessions/db.ts`) | Discovers which integrations are available for a session |
| `sessions-gateway.md` | Actions → Gateway | WebSocket broadcast events | `action_approval_request` (pending write), `action_completed` (execution success/failure, includes `status` field), `action_approval_result` (denial only) |
| `agent-contract.md` | Contract → Actions | `ACTIONS_BOOTSTRAP` in sandbox config | Bootstrap guide written to `.proliferate/actions-guide.md` |
| `agent-contract.md` | Contract → Actions | `proliferate` CLI in system prompts | Prompts document CLI usage for actions |
| `auth-orgs.md` | Actions → Auth | `orgs.getUserRole(userId, orgId)` | Admin/owner role check for approve/deny |

### Security & Auth
- **Sandbox tokens** can invoke actions and create grants but cannot approve/deny.
- **User tokens** with admin/owner role can approve/deny invocations.
- **Member role** users cannot approve/deny (403).
- **Token resolution** happens server-side via Nango — the sandbox never sees integration OAuth tokens.
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
- [ ] **Static adapter registry** — adding a new integration requires code changes. No dynamic adapter loading or plugin system. Impact: new integrations require a deploy. Expected fix: not planned — adapter count is low.
- [ ] **Grant rollback is best-effort** — if invocation approval fails after grant creation, the grant revocation is attempted but failures are silently caught. Impact: orphaned grants may exist in rare edge cases. Expected fix: wrap in a transaction or add cleanup sweep.
- [ ] **No pagination on grants list** — `listActiveGrants` and `listGrantsByOrg` return all matching rows with no limit/offset. Impact: could return large result sets for orgs with many grants. Expected fix: add pagination parameters.
- [ ] **`created_by` FK mismatch on sandbox-created grants** — `action_grants.created_by` has a FK to `user(id)` in the Drizzle schema (`schema.ts:1225-1229`), but the sandbox grant creation route (`actions.ts:593`) sets `createdBy` to `sessionId` (a UUID from the `sessions` table, not the `user` table). If this FK constraint exists in the actual database, sandbox grant creation would fail. If the migration was not applied or the constraint is deferred, the value simply doesn't point to a valid user row, breaking joins and audit queries. Impact: either a runtime error on sandbox grant creation or data integrity issue depending on migration state. Expected fix: store the session's `userId` instead, or change the FK target to `sessions(id)`.


---

# FILE: docs/specs/agent-contract.md

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
| `save_service_commands` | Emphasized | Available | Available |
| `save_env_files` | Emphasized | Available | Available |
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

- [ ] **No per-mode tool filtering** — All six tools are injected regardless of session mode. Setup-only tools (`save_service_commands`, `save_env_files`) are available in coding mode, and `automation.complete` is available in non-automation sessions. The system prompt is the only control. Impact: agents occasionally call tools outside their intended mode. Expected fix: conditional tool injection based on session type.
- [ ] **Two tool definition styles** — `verify` uses raw `export default { name, description, parameters }` while other tools use the `tool()` plugin API from `@opencode-ai/plugin`. Impact: inconsistent authoring; no functional difference. Expected fix: migrate `verify` to `tool()` API.
- [ ] **Dual registration for automation.complete** — Registered under both `automation.complete` and `automation_complete` to handle agent variation. Impact: minor registry bloat. Expected fix: standardize on one name once agent behavior is stable.
- [ ] **No tool versioning** — Tool schemas are string templates with no version tracking. If a schema changes, running sessions continue with the old version until sandbox restart. Impact: potential schema mismatch during deploys. Expected fix: version stamp in tool file path or metadata.
- [ ] **Custom system prompt bypass** — `session.system_prompt` in the DB overrides mode selection entirely. No validation that the custom prompt includes required tool instructions. Impact: automation sessions with custom prompts may not call `automation.complete`. Expected fix: append mode-critical instructions even when custom prompt is set.


---

# FILE: docs/specs/agent-prompts.md

# Spec Agent Prompts

> Copy-paste these prompts when spawning agents. Phase 1 first, then phase 2 after phase 1 specs exist, then phase 3.

---

## Phase 1 (write first — everything else references these)

### 1. Agent Contract

```
You are writing a system spec for the Proliferate codebase.

READ THESE FILES FIRST (in order):
1. docs/specs/boundary-brief.md — boundary rules and glossary (MANDATORY)
2. docs/specs/template.md — spec template (follow exactly)
3. docs/specs/feature-registry.md — section 1 (Agent Contract features)

YOUR ASSIGNMENT:
- Spec file: docs/specs/agent-contract.md
- In scope:
  - System prompt modes: setup, coding, automation (how they differ, what each injects)
  - OpenCode tool schemas: verify, save_snapshot, save_service_commands, save_env_files, automation.complete, request_env_variables
  - Capability injection: how tools get registered in the sandbox OpenCode config
  - Tool input/output contracts and validation
  - Which tools are available in which session modes
- Out of scope:
  - How tools are executed at runtime (sessions-gateway.md)
  - How tools are injected into the sandbox environment (sandbox-providers.md)
  - Action tools / external-service operations (actions.md)
  - Automation run lifecycle that calls these tools (automations-runs.md)

KEY FILES TO READ:
- packages/shared/src/prompts.ts (all prompt builders)
- packages/shared/src/opencode-tools/index.ts (all tool definitions)
- packages/shared/src/sandbox/config.ts (plugin injection, tool registration)
- packages/shared/src/agents.ts (agent/LLM types)
- apps/gateway/src/hub/capabilities/tools/ (tool implementations — read to understand contracts, but runtime behavior is sessions-gateway.md's scope)

RULES:
- Document what is in main today, not aspirational design
- Cite file paths as evidence for every behavioral claim
- Link to other specs for out-of-scope concepts (see boundary brief §4)
- Use only terms from the canonical glossary (see boundary brief §3)
- Target 300-600 lines
- Classify every feature as Implemented/Partial/Planned/Deprecated
```

### 2. Sandbox Providers

```
You are writing a system spec for the Proliferate codebase.

READ THESE FILES FIRST (in order):
1. docs/specs/boundary-brief.md — boundary rules and glossary (MANDATORY)
2. docs/specs/template.md — spec template (follow exactly)
3. docs/specs/feature-registry.md — section 2 (Sandbox Providers features)

YOUR ASSIGNMENT:
- Spec file: docs/specs/sandbox-providers.md
- In scope:
  - SandboxProvider interface and provider contract
  - Modal provider implementation (libmodal SDK)
  - E2B provider implementation
  - Modal image and deploy script (Python)
  - Sandbox-MCP: API server, terminal WebSocket, service manager, auth, CLI setup
  - Sandbox environment variable injection at boot
  - OpenCode plugin injection (the PLUGIN_MJS template string)
  - Snapshot version key computation
  - Snapshot resolution (which layers to use)
  - Git freshness / pull cadence
  - Port exposure (proliferate services expose)
- Out of scope:
  - Session lifecycle that calls the provider (sessions-gateway.md)
  - Tool schemas and prompt templates (agent-contract.md)
  - Snapshot build jobs — base and repo snapshot workers (repos-prebuilds.md)
  - Secret values and bundle management (secrets-environment.md)
  - LLM key generation (llm-proxy.md)

KEY FILES TO READ:
- packages/shared/src/sandbox-provider.ts (interface)
- packages/shared/src/providers/modal-libmodal.ts (Modal provider)
- packages/shared/src/providers/e2b.ts (E2B provider)
- packages/shared/src/sandbox/config.ts (env vars, plugin, boot config)
- packages/shared/src/sandbox/git-freshness.ts
- packages/shared/src/sandbox/opencode.ts
- packages/shared/src/sandbox/version-key.ts
- packages/shared/src/snapshot-resolution.ts
- packages/sandbox-mcp/src/index.ts (entry point)
- packages/sandbox-mcp/src/api-server.ts (HTTP API)
- packages/sandbox-mcp/src/terminal.ts (terminal WebSocket)
- packages/sandbox-mcp/src/service-manager.ts (service start/stop/expose)
- packages/sandbox-mcp/src/auth.ts
- packages/sandbox-mcp/src/proliferate-cli.ts
- packages/modal-sandbox/deploy.py (Modal image)

RULES:
- Document what is in main today, not aspirational design
- Cite file paths as evidence for every behavioral claim
- Link to other specs for out-of-scope concepts (see boundary brief §4)
- Use only terms from the canonical glossary (see boundary brief §3)
- Target 300-600 lines
- Classify every feature as Implemented/Partial/Planned/Deprecated
```

---

## Phase 2 (run after phase 1 specs exist)

### 3. Sessions & Gateway

```
You are writing a system spec for the Proliferate codebase.

READ THESE FILES FIRST (in order):
1. docs/specs/boundary-brief.md — boundary rules and glossary (MANDATORY)
2. docs/specs/template.md — spec template (follow exactly)
3. docs/specs/feature-registry.md — section 3 (Sessions & Gateway features)
4. docs/specs/agent-contract.md — cross-reference for tool contracts
5. docs/specs/sandbox-providers.md — cross-reference for provider interface

YOUR ASSIGNMENT:
- Spec file: docs/specs/sessions-gateway.md
- In scope:
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
  - Session store (in-memory state)
  - Session connections (DB)
  - Gateway middleware (auth, CORS, error handling, request logging)
  - Gateway client libraries (packages/gateway-clients)
- Out of scope:
  - Sandbox boot mechanics and provider interface (sandbox-providers.md)
  - Tool schemas and prompt modes (agent-contract.md)
  - Automation-initiated sessions (automations-runs.md owns the run lifecycle)
  - Repo/prebuild config resolution (repos-prebuilds.md)
  - LLM key generation (llm-proxy.md)
  - Billing gating for session creation (billing-metering.md)

KEY FILES TO READ:
- apps/web/src/server/routers/sessions.ts
- apps/gateway/src/lib/session-creator.ts
- apps/gateway/src/lib/session-store.ts
- apps/gateway/src/hub/hub-manager.ts
- apps/gateway/src/hub/session-hub.ts
- apps/gateway/src/hub/session-runtime.ts
- apps/gateway/src/hub/event-processor.ts
- apps/gateway/src/hub/sse-client.ts
- apps/gateway/src/hub/migration-controller.ts
- apps/gateway/src/hub/index.ts
- apps/gateway/src/api/proliferate/http/sessions.ts
- apps/gateway/src/api/proliferate/ws/
- apps/gateway/src/api/proxy/opencode.ts
- apps/gateway/src/hub/git-operations.ts
- apps/gateway/src/middleware/auth.ts
- packages/gateway-clients/
- packages/db/src/schema/sessions.ts

RULES:
- Document what is in main today, not aspirational design
- Cite file paths as evidence for every behavioral claim
- Link to other specs for out-of-scope concepts (see boundary brief §4)
- Use only terms from the canonical glossary (see boundary brief §3)
- Target 300-600 lines
- Classify every feature as Implemented/Partial/Planned/Deprecated
```

### 4. Automations & Runs

```
You are writing a system spec for the Proliferate codebase.

READ THESE FILES FIRST (in order):
1. docs/specs/boundary-brief.md — boundary rules and glossary (MANDATORY)
2. docs/specs/template.md — spec template (follow exactly)
3. docs/specs/feature-registry.md — section 4 (Automations & Runs features)
4. docs/specs/agent-contract.md — cross-reference for automation.complete tool
5. docs/specs/sandbox-providers.md — cross-reference for sandbox boot

YOUR ASSIGNMENT:
- Spec file: docs/specs/automations-runs.md
- In scope:
  - Automation CRUD and configuration
  - Automation connections (integration bindings)
  - Run lifecycle state machine: pending → enriching → executing → completed/failed
  - Run pipeline: enrich → execute → finalize
  - Enrichment worker (context extraction)
  - Execution (session creation for runs)
  - Finalization (post-execution cleanup)
  - Run events log
  - Outbox dispatch (atomic claim, stuck-row recovery)
  - Side effects tracking
  - Artifact storage (S3 — completion + enrichment artifacts)
  - Target resolution (which repo/prebuild to use)
  - Notification dispatch (Slack)
  - Slack async client (bidirectional session via Slack)
  - Slack inbound handlers (text, todo, verify, default-tool)
  - Slack receiver worker
  - Run claiming / manual update
  - Schedule binding on automations
- Out of scope:
  - Trigger ingestion and matching (triggers.md — handoff point is AUTOMATION_ENRICH queue)
  - Tool schemas (agent-contract.md)
  - Session runtime mechanics (sessions-gateway.md)
  - Sandbox boot (sandbox-providers.md)
  - Slack OAuth and installation (integrations.md)
  - Schedule CRUD (triggers.md or standalone — schedules are shared)
  - Billing/metering for automation runs (billing-metering.md)

KEY FILES TO READ:
- apps/web/src/server/routers/automations.ts
- apps/worker/src/automation/index.ts (orchestrator)
- apps/worker/src/automation/enrich.ts
- apps/worker/src/automation/finalizer.ts
- apps/worker/src/automation/resolve-target.ts
- apps/worker/src/automation/artifacts.ts
- apps/worker/src/automation/outbox-dispatch.ts
- apps/worker/src/automation/notifications.ts
- apps/worker/src/automation/notifications-dispatch.ts
- apps/worker/src/slack/client.ts
- apps/worker/src/slack/handlers/
- apps/worker/src/slack/index.ts
- packages/services/src/automations/
- packages/services/src/runs/
- packages/services/src/outbox/service.ts
- packages/services/src/side-effects/
- packages/services/src/notifications/
- packages/db/src/schema/automations.ts

RULES:
- Document what is in main today, not aspirational design
- Cite file paths as evidence for every behavioral claim
- Link to other specs for out-of-scope concepts (see boundary brief §4)
- Use only terms from the canonical glossary (see boundary brief §3)
- Target 300-600 lines
- Classify every feature as Implemented/Partial/Planned/Deprecated
```

### 5. Triggers

```
You are writing a system spec for the Proliferate codebase.

READ THESE FILES FIRST (in order):
1. docs/specs/boundary-brief.md — boundary rules and glossary (MANDATORY)
2. docs/specs/template.md — spec template (follow exactly)
3. docs/specs/feature-registry.md — section 5 (Triggers features)

YOUR ASSIGNMENT:
- Spec file: docs/specs/triggers.md
- In scope:
  - Trigger CRUD (web routes)
  - Trigger events log and trigger event actions
  - Trigger service (apps/trigger-service — dedicated Express app)
  - Webhook ingestion via Nango
  - Webhook dispatch and matching (event → trigger)
  - Polling scheduler (cursor-based, Redis state)
  - Cron scheduling (SCHEDULED queue)
  - Provider registry
  - GitHub provider (webhook)
  - Linear provider (webhook + polling)
  - Sentry provider (webhook + polling)
  - PostHog provider (webhook, HMAC validation)
  - Gmail provider (stub/planned)
  - PubSub session events subscriber
  - Schedule CRUD (get/update/delete)
  - Handoff to automations (enqueue AUTOMATION_ENRICH)
- Out of scope:
  - Automation run pipeline after handoff (automations-runs.md)
  - Integration OAuth setup (integrations.md)
  - Session lifecycle (sessions-gateway.md)

KEY FILES TO READ:
- apps/web/src/server/routers/triggers.ts
- apps/web/src/server/routers/schedules.ts
- apps/trigger-service/src/ (all files — dedicated service)
- apps/trigger-service/src/lib/webhook-dispatcher.ts
- apps/trigger-service/src/lib/trigger-processor.ts
- apps/trigger-service/src/polling/worker.ts
- packages/triggers/src/index.ts (registry)
- packages/triggers/src/github.ts
- packages/triggers/src/linear.ts
- packages/triggers/src/sentry.ts
- packages/triggers/src/posthog.ts
- packages/triggers/src/types.ts
- packages/triggers/src/adapters/gmail.ts
- packages/services/src/triggers/
- packages/services/src/schedules/
- packages/db/src/schema/triggers.ts
- packages/db/src/schema/schedules.ts
- apps/worker/src/pubsub/

RULES:
- Document what is in main today, not aspirational design
- Cite file paths as evidence for every behavioral claim
- Link to other specs for out-of-scope concepts (see boundary brief §4)
- Use only terms from the canonical glossary (see boundary brief §3)
- Target 300-600 lines
- Classify every feature as Implemented/Partial/Planned/Deprecated
```

### 6. Actions

```
You are writing a system spec for the Proliferate codebase.

READ THESE FILES FIRST (in order):
1. docs/specs/boundary-brief.md — boundary rules and glossary (MANDATORY)
2. docs/specs/template.md — spec template (follow exactly)
3. docs/specs/feature-registry.md — section 6 (Actions features)
4. docs/specs/agent-contract.md — cross-reference for tool injection

YOUR ASSIGNMENT:
- Spec file: docs/specs/actions.md
- In scope:
  - Action invocation lifecycle: pending → approved/denied → expired
  - Risk classification: read / write / danger
  - Grant system: create, evaluate, revoke, call budgets
  - Gateway action routes (invoke, approve, deny, list, grants)
  - Provider guide/bootstrap flow
  - Linear adapter
  - Sentry adapter
  - Invocation sweeper (expiry job)
  - Sandbox-MCP grants handler
  - Actions list (org-level inbox)
- Out of scope:
  - Tool schema definitions (agent-contract.md)
  - Session runtime (sessions-gateway.md)
  - Integration OAuth for Linear/Sentry (integrations.md)
  - Automation runs that invoke actions (automations-runs.md)

KEY FILES TO READ:
- apps/web/src/server/routers/actions.ts
- packages/services/src/actions/ (all files)
- packages/services/src/actions/grants.ts
- packages/services/src/actions/db.ts
- packages/services/src/actions/adapters/linear.ts
- packages/services/src/actions/adapters/sentry.ts
- apps/gateway/src/api/proliferate/http/ (action routes)
- apps/gateway/src/hub/capabilities/tools/ (action tool implementations)
- apps/worker/src/sweepers/index.ts
- packages/sandbox-mcp/src/actions-grants.ts
- packages/db/src/schema/ (look for action_invocations, action_grants tables)

RULES:
- Document what is in main today, not aspirational design
- Cite file paths as evidence for every behavioral claim
- Link to other specs for out-of-scope concepts (see boundary brief §4)
- Use only terms from the canonical glossary (see boundary brief §3)
- Target 300-600 lines
- Classify every feature as Implemented/Partial/Planned/Deprecated
```

### 7. LLM Proxy

```
You are writing a system spec for the Proliferate codebase.

READ THESE FILES FIRST (in order):
1. docs/specs/boundary-brief.md — boundary rules and glossary (MANDATORY)
2. docs/specs/template.md — spec template (follow exactly)
3. docs/specs/feature-registry.md — section 7 (LLM Proxy features)

YOUR ASSIGNMENT:
- Spec file: docs/specs/llm-proxy.md
- In scope:
  - Virtual key generation (per-session, per-org)
  - Key scoping model (team = org, user = session)
  - Key duration and lifecycle
  - LiteLLM API integration contract
  - Spend tracking and spend query APIs
  - LLM spend cursors (DB sync state)
  - Environment config (LLM_PROXY_URL, LLM_PROXY_MASTER_KEY, LLM_PROXY_KEY_DURATION)
  - How providers (Modal, E2B) pass the virtual key to sandboxes
- Out of scope:
  - LiteLLM service internals (external dependency, not our code)
  - Billing policy / credit gating / charging (billing-metering.md)
  - Sandbox boot mechanics (sandbox-providers.md)
  - Session lifecycle (sessions-gateway.md)

NOTE: The LLM proxy is an external LiteLLM service. This spec documents our integration contract with it, not the service itself. `apps/llm-proxy/` contains the Dockerfile and LiteLLM config.yaml for deploying the proxy.

KEY FILES TO READ:
- packages/shared/src/llm-proxy.ts (main integration)
- packages/environment/src/schema.ts (env var definitions — search for LLM_PROXY)
- packages/db/src/schema/billing.ts (llmSpendCursors table)
- packages/shared/src/providers/modal-libmodal.ts (how Modal passes LLM key)
- packages/shared/src/providers/e2b.ts (how E2B passes LLM key)
- packages/shared/src/sandbox/config.ts (env injection)

RULES:
- Document what is in main today, not aspirational design
- Cite file paths as evidence for every behavioral claim
- Link to other specs for out-of-scope concepts (see boundary brief §4)
- Use only terms from the canonical glossary (see boundary brief §3)
- This spec will likely be shorter than others (200-350 lines) given the scope is an integration contract
- Classify every feature as Implemented/Partial/Planned/Deprecated
```

### 8. CLI

```
You are writing a system spec for the Proliferate codebase.

READ THESE FILES FIRST (in order):
1. docs/specs/boundary-brief.md — boundary rules and glossary (MANDATORY)
2. docs/specs/template.md — spec template (follow exactly)
3. docs/specs/feature-registry.md — section 8 (CLI features)

YOUR ASSIGNMENT:
- Spec file: docs/specs/cli.md
- In scope:
  - CLI entry point and main flow
  - Device auth flow (OAuth device code → token persistence)
  - Local config management (.proliferate/ directory)
  - File sync (unidirectional: local → sandbox via rsync)
  - OpenCode launch
  - CLI-specific API routes (auth, repos, sessions, SSH keys, GitHub, prebuilds)
  - GitHub repo selection history
  - SSH key storage and management
  - CLI package structure and build
- Out of scope:
  - Session lifecycle after creation (sessions-gateway.md)
  - Sandbox boot (sandbox-providers.md)
  - Repo/prebuild management beyond CLI-specific routes (repos-prebuilds.md)
  - Auth system internals / better-auth (auth-orgs.md)

KEY FILES TO READ:
- packages/cli/src/main.ts (entry point)
- packages/cli/src/state/auth.ts (device flow)
- packages/cli/src/state/config.ts (local config)
- packages/cli/src/lib/sync.ts (file sync)
- packages/cli/src/agents/opencode.ts (OpenCode launch)
- apps/web/src/server/routers/cli.ts (all CLI API routes)
- packages/db/src/schema/cli.ts (SSH keys, device codes, GitHub selections)
- packages/services/src/cli/

RULES:
- Document what is in main today, not aspirational design
- Cite file paths as evidence for every behavioral claim
- Link to other specs for out-of-scope concepts (see boundary brief §4)
- Use only terms from the canonical glossary (see boundary brief §3)
- Target 300-600 lines
- Classify every feature as Implemented/Partial/Planned/Deprecated
```

---

## Phase 3 (run after phase 2 specs exist)

### 9. Repos, Configurations & Prebuilds

```
You are writing a system spec for the Proliferate codebase.

READ THESE FILES FIRST (in order):
1. docs/specs/boundary-brief.md — boundary rules and glossary (MANDATORY)
2. docs/specs/template.md — spec template (follow exactly)
3. docs/specs/feature-registry.md — section 9 (Repos/Prebuilds features)
4. docs/specs/sandbox-providers.md — cross-reference for snapshot resolution
5. docs/specs/sessions-gateway.md — cross-reference for prebuild resolver

YOUR ASSIGNMENT:
- Spec file: docs/specs/repos-prebuilds.md
- In scope:
  - Repo CRUD and search
  - Repo connections (integration bindings)
  - Prebuild CRUD and configuration
  - Prebuild-repo associations (many-to-many)
  - Effective service commands resolution
  - Base snapshot build worker (queue, deduplication, status tracking)
  - Repo snapshot build worker (GitHub token hierarchy, commit tracking)
  - Prebuild resolver (resolves config at session start)
  - Service commands persistence (JSONB)
  - Env file persistence (JSONB)
  - Base snapshot status tracking (building/ready/failed)
  - Repo snapshot status tracking (building/ready/failed + commit SHA)
- Out of scope:
  - Snapshot resolution logic (sandbox-providers.md)
  - Session creation that uses prebuilds (sessions-gateway.md)
  - Secret values and bundles (secrets-environment.md)
  - Integration OAuth (integrations.md)

KEY FILES TO READ:
- apps/web/src/server/routers/repos.ts
- apps/web/src/server/routers/prebuilds.ts
- apps/worker/src/base-snapshots/index.ts
- apps/worker/src/repo-snapshots/index.ts
- apps/gateway/src/lib/prebuild-resolver.ts
- packages/services/src/repos/
- packages/services/src/prebuilds/
- packages/services/src/base-snapshots/
- packages/db/src/schema/repos.ts
- packages/db/src/schema/prebuilds.ts

RULES:
- Document what is in main today, not aspirational design
- Cite file paths as evidence for every behavioral claim
- Link to other specs for out-of-scope concepts (see boundary brief §4)
- Use only terms from the canonical glossary (see boundary brief §3)
- Target 300-600 lines
- Classify every feature as Implemented/Partial/Planned/Deprecated
```

### 10. Secrets & Environment

```
You are writing a system spec for the Proliferate codebase.

READ THESE FILES FIRST (in order):
1. docs/specs/boundary-brief.md — boundary rules and glossary (MANDATORY)
2. docs/specs/template.md — spec template (follow exactly)
3. docs/specs/feature-registry.md — section 10 (Secrets features)

YOUR ASSIGNMENT:
- Spec file: docs/specs/secrets-environment.md
- In scope:
  - Secret CRUD (create, delete, list, check)
  - Secret bundles CRUD (list, create, update meta, delete)
  - Bundle target path configuration
  - Bulk import (.env paste flow)
  - Secret encryption at rest
  - Per-secret persistence toggle
  - S3 integration for secret storage
  - How secrets flow from DB → gateway → sandbox (the data path, not the tool schema)
- Out of scope:
  - The save_env_files tool schema (agent-contract.md)
  - The request_env_variables tool schema (agent-contract.md)
  - Sandbox env var injection mechanics (sandbox-providers.md)
  - Prebuild env file persistence (repos-prebuilds.md)

KEY FILES TO READ:
- apps/web/src/server/routers/secrets.ts
- packages/services/src/secrets/
- packages/db/src/schema/secrets.ts (look for secrets, secret_bundles tables)
- apps/gateway/src/lib/s3.ts
- apps/gateway/src/hub/capabilities/tools/save-env-files.ts (read for data flow understanding, but tool schema is agent-contract.md's scope)

RULES:
- Document what is in main today, not aspirational design
- Cite file paths as evidence for every behavioral claim
- Link to other specs for out-of-scope concepts (see boundary brief §4)
- Use only terms from the canonical glossary (see boundary brief §3)
- Target 300-600 lines
- Classify every feature as Implemented/Partial/Planned/Deprecated
```

### 11. Integrations

```
You are writing a system spec for the Proliferate codebase.

READ THESE FILES FIRST (in order):
1. docs/specs/boundary-brief.md — boundary rules and glossary (MANDATORY)
2. docs/specs/template.md — spec template (follow exactly)
3. docs/specs/feature-registry.md — section 11 (Integrations features)

YOUR ASSIGNMENT:
- Spec file: docs/specs/integrations.md
- In scope:
  - Integration list and update
  - GitHub OAuth (GitHub App via Nango)
  - Sentry OAuth (via Nango)
  - Linear OAuth (via Nango)
  - Slack OAuth (via Nango)
  - Nango callback handling
  - Integration disconnect
  - Slack installations (workspace-level)
  - Slack conversations cache
  - Connection binding to repos, automations, sessions
  - Sentry metadata queries
  - Linear metadata queries
  - GitHub auth (gateway-side token resolution)
- Out of scope:
  - What repos/automations/sessions DO with connections (those specs own runtime behavior)
  - Slack async client and message handling (automations-runs.md)
  - Action adapters for Linear/Sentry (actions.md)
  - Trigger providers for GitHub/Linear/Sentry (triggers.md)

KEY FILES TO READ:
- apps/web/src/server/routers/integrations.ts
- packages/services/src/integrations/
- packages/db/src/schema/integrations.ts (if exists, or look in main schema)
- packages/db/src/schema/slack.ts
- apps/gateway/src/lib/github-auth.ts
- apps/web/src/lib/nango.ts
- apps/web/src/lib/slack.ts
- packages/shared/src/contracts/integrations.ts

RULES:
- Document what is in main today, not aspirational design
- Cite file paths as evidence for every behavioral claim
- Link to other specs for out-of-scope concepts (see boundary brief §4)
- Use only terms from the canonical glossary (see boundary brief §3)
- Target 300-600 lines
- Classify every feature as Implemented/Partial/Planned/Deprecated
```

### 12. Auth, Orgs & Onboarding

```
You are writing a system spec for the Proliferate codebase.

READ THESE FILES FIRST (in order):
1. docs/specs/boundary-brief.md — boundary rules and glossary (MANDATORY)
2. docs/specs/template.md — spec template (follow exactly)
3. docs/specs/feature-registry.md — section 12 (Auth/Orgs features)

YOUR ASSIGNMENT:
- Spec file: docs/specs/auth-orgs.md
- In scope:
  - User auth via better-auth (email/password + OAuth)
  - Email verification flow
  - Org CRUD and org model
  - Member management
  - Invitation system (create, accept, expiry)
  - Domain suggestions (email-based org matching)
  - Onboarding flow (start trial, mark complete, finalize)
  - Trial activation (credit provisioning trigger — the trigger, not the billing logic)
  - API keys
  - Admin status check
  - Admin user/org listing
  - Admin impersonation (cookie management, super-admin checks)
  - Org switching
- Out of scope:
  - Trial credit amounts and billing policy (billing-metering.md)
  - Gateway auth middleware implementation (sessions-gateway.md)
  - CLI device auth flow (cli.md)
  - Integration OAuth (integrations.md)

KEY FILES TO READ:
- packages/shared/src/auth.ts
- packages/shared/src/verification.ts
- apps/web/src/server/routers/orgs.ts
- apps/web/src/server/routers/onboarding.ts
- apps/web/src/server/routers/admin.ts
- packages/services/src/orgs/
- packages/services/src/onboarding/
- packages/services/src/admin/
- packages/db/src/schema/auth.ts
- apps/web/src/app/invite/[id]/page.tsx (invitation acceptance — read for flow, don't document UI)

RULES:
- Document what is in main today, not aspirational design
- Cite file paths as evidence for every behavioral claim
- Link to other specs for out-of-scope concepts (see boundary brief §4)
- Use only terms from the canonical glossary (see boundary brief §3)
- Target 300-600 lines
- Classify every feature as Implemented/Partial/Planned/Deprecated
```

### 13. Billing & Metering

```
You are writing a system spec for the Proliferate codebase.

READ THESE FILES FIRST (in order):
1. docs/specs/boundary-brief.md — boundary rules and glossary (MANDATORY)
2. docs/specs/template.md — spec template (follow exactly)
3. docs/specs/feature-registry.md — section 13 (Billing features)

YOUR ASSIGNMENT:
- Spec file: docs/specs/billing-metering.md
- In scope:
  - Billing status, current plan, pricing plans
  - Billing settings update
  - Checkout flow (initiate payment)
  - Credit usage / deduction
  - Usage metering (real-time compute credit calculation)
  - Credit gating (gate features on balance)
  - Shadow balance (fast balance approximation)
  - Org pause on zero balance (auto-pause all sessions)
  - Trial credit provisioning
  - Billing reconciliation (manual adjustments with audit trail)
  - Billing events log
  - LLM spend sync (from LiteLLM via spend cursors)
  - Distributed locks for billing operations
  - Billing worker (interval-based reconciliation)
  - Autumn integration (external billing provider)
  - Overage policy (pause vs allow, per-org)
- Out of scope:
  - LLM virtual key generation (llm-proxy.md)
  - Onboarding flow that triggers trial activation (auth-orgs.md)
  - Session pause/terminate mechanics (sessions-gateway.md)

KEY FILES TO READ:
- apps/web/src/server/routers/billing.ts
- packages/services/src/billing/ (all files)
- packages/services/src/billing/metering.ts
- packages/services/src/billing/shadow-balance.ts
- packages/services/src/billing/org-pause.ts
- packages/services/src/billing/trial-activation.ts
- packages/shared/src/billing/ (Autumn client, gating, distributed locks)
- packages/db/src/schema/billing.ts
- apps/worker/src/billing/worker.ts
- apps/worker/src/billing/index.ts

RULES:
- Document what is in main today, not aspirational design
- Cite file paths as evidence for every behavioral claim
- Link to other specs for out-of-scope concepts (see boundary brief §4)
- Use only terms from the canonical glossary (see boundary brief §3)
- Target 300-600 lines
- Classify every feature as Implemented/Partial/Planned/Deprecated
```

---

## Phase 4 — Consistency Check

```
You are performing a consistency review of 13 system specs for the Proliferate codebase.

READ THESE FILES FIRST:
1. docs/specs/boundary-brief.md — the boundary rules and glossary
2. All 13 spec files in docs/specs/

CHECK FOR:
1. Overlapping ownership — two specs claiming the same file or DB table. Every file should belong to exactly one spec.
2. Contradictory statements — spec A says X, spec B says not-X.
3. Broken cross-references — "see sessions-gateway.md §6.2" pointing to a section that doesn't exist.
4. Glossary violations — terms used inconsistently (e.g., "environment" instead of "sandbox").
5. Missing cross-references — spec describes something owned by another spec without linking to it.
6. Depth imbalance — specs that are suspiciously short or long relative to their scope.
7. Status disagreements — feature-registry.md says Implemented but a spec says Partial (or vice versa).

OUTPUT:
- A checklist of issues found, grouped by spec file
- For each issue: what's wrong, which specs are involved, suggested fix
- Write the results to docs/specs/consistency-review.md
```


---

# FILE: docs/specs/architecture-insights.md

# Proliferate Architecture And Logic Insights

Consolidated from all files in `docs/specs/` on 2026-02-12.

## What This Document Is

This is a single-system map of how Proliferate works end to end.
It summarizes subsystem ownership, runtime flows, core invariants, and important current gaps.

## Sources Covered

Runtime subsystem specs:
- `docs/specs/agent-contract.md`
- `docs/specs/sandbox-providers.md`
- `docs/specs/sessions-gateway.md`
- `docs/specs/automations-runs.md`
- `docs/specs/triggers.md`
- `docs/specs/actions.md`
- `docs/specs/llm-proxy.md`
- `docs/specs/cli.md`
- `docs/specs/repos-prebuilds.md`
- `docs/specs/secrets-environment.md`
- `docs/specs/integrations.md`
- `docs/specs/auth-orgs.md`
- `docs/specs/billing-metering.md`

Meta/governance specs:
- `docs/specs/boundary-brief.md`
- `docs/specs/feature-registry.md`
- `docs/specs/consistency-review.md`
- `docs/specs/implementation-context.md`
- `docs/specs/agent-prompts.md`
- `docs/specs/template.md`

## 1. System-Level Mental Model

Proliferate has two major planes:
- Control plane: Next.js/oRPC/API routes, DB metadata, OAuth/auth, billing policy, repo/prebuild management.
- Runtime plane: Client `<->` Gateway `<->` Sandbox streaming and execution.

Core architectural rule:
- Real-time message streaming does not go through Next.js API routes.
- Streaming path is always Client `<->` Gateway `<->` Sandbox (OpenCode via SSE + WebSocket).

High-level stack by responsibility:
- Identity and org tenancy: `auth-orgs.md`
- External connection credentials: `integrations.md`
- Repo and prebuild state: `repos-prebuilds.md`
- Secret encryption and env shaping: `secrets-environment.md`
- Session runtime orchestration: `sessions-gateway.md`
- Sandbox boot/provider runtime: `sandbox-providers.md`
- Agent behavior contract/tools: `agent-contract.md`
- Trigger ingestion: `triggers.md`
- Automation execution pipeline: `automations-runs.md`
- Action approval and grants: `actions.md`
- Cost/metering/enforcement: `billing-metering.md`
- CLI local-to-remote workflow: `cli.md`
- LLM proxy keying and spend attribution: `llm-proxy.md`

## 2. Ownership Boundaries (Canonical)

From `docs/specs/boundary-brief.md`:
- `agent-contract.md` owns prompts and tool schemas.
- `sandbox-providers.md` owns provider interface and sandbox boot mechanics.
- `sessions-gateway.md` owns session lifecycle and gateway hub/event pipeline.
- `automations-runs.md` owns automation definitions and run execution lifecycle.
- `triggers.md` owns inbound event ingestion and trigger dispatch.
- `actions.md` owns approval policy, invocation state, and grants.
- `llm-proxy.md` owns LiteLLM keying/routing contract (not billing policy).
- `cli.md` owns CLI auth/config/sync/open flow.
- `repos-prebuilds.md` owns repo and prebuild records plus snapshot build workers.
- `secrets-environment.md` owns secret CRUD, bundles, encryption model.
- `integrations.md` owns OAuth lifecycle and connection bindings.
- `auth-orgs.md` owns user/org/member/session identity model.
- `billing-metering.md` owns charging, gating policy, state transitions, enforcement.

Cross-boundary reality:
- Several files are intentionally cross-referenced across specs.
- `docs/specs/consistency-review.md` documents current overlaps/ambiguities to clean up.

## 3. Core End-To-End Flows

### 3.1 Interactive Session (Web)

1. User creates session via web control plane route.
2. Session record is created with prebuild/snapshot context.
3. Gateway hub is created lazily on first WebSocket connect.
4. Hub runtime provisions or recovers sandbox via provider interface.
5. Gateway holds SSE stream from OpenCode and emits WS events to client.
6. Tool calls may be intercepted by gateway handlers and patched back into OpenCode.
7. Session migrates/snapshots/stops through gateway lifecycle logic.

Specs involved:
- `sessions-gateway.md`
- `sandbox-providers.md`
- `agent-contract.md`
- `repos-prebuilds.md`
- `secrets-environment.md`
- `integrations.md`
- `billing-metering.md`

### 3.2 Setup Session -> Prebuild Finalization

1. Setup session prepares environment and agent can save service/env configuration.
2. Finalization snapshots filesystem state.
3. Prebuild record is created/updated and linked to repo(s).
4. Future sessions can start from prebuild snapshot, faster and more deterministic.

Specs involved:
- `repos-prebuilds.md`
- `sessions-gateway.md`
- `sandbox-providers.md`
- `secrets-environment.md`

### 3.3 Trigger -> Automation Run Pipeline

1. Trigger event arrives (webhook, polling, or schedule).
2. Event is filtered/deduped and converted to `trigger_event`.
3. Run is created transactionally and outbox row enqueues enrich stage.
4. Worker enriches context, resolves target repo/prebuild, creates session via gateway.
5. Worker sends prompt; automation completes via `automation.complete` tool.
6. Finalization writes artifacts and notifications.

Specs involved:
- `triggers.md`
- `automations-runs.md`
- `sessions-gateway.md`
- `agent-contract.md`

### 3.4 Action Invocation And Approval

1. Agent invokes action through `proliferate actions ...`.
2. Gateway evaluates risk level (`read`/`write`/`danger`).
3. Grant match can auto-approve writes; otherwise pending approval flow.
4. Approved invocation executes adapter against external service.
5. Results are redacted/truncated before persistence.

Specs involved:
- `actions.md`
- `integrations.md`
- `sessions-gateway.md`

### 3.5 Billing And Metering

1. Compute metering runs on intervals for active sessions.
2. LLM spend is cursor-synced from LiteLLM spend logs.
3. Both streams create billing events and atomically adjust shadow balance.
4. Billing state machine enforces grace/exhausted behavior.
5. Outbox worker posts pending events to Autumn asynchronously.

Specs involved:
- `billing-metering.md`
- `llm-proxy.md`
- `sessions-gateway.md`

### 3.6 CLI Local Workflow

1. CLI device auth gets API key via device code flow.
2. CLI ensures SSH keypair and registers public key.
3. CLI resolves/creates repo and session context.
4. Files sync local -> sandbox via rsync over SSH.
5. CLI launches OpenCode attached to gateway session.

Specs involved:
- `cli.md`
- `auth-orgs.md`
- `sessions-gateway.md`
- `repos-prebuilds.md`

## 4. Data Model And State Machine Highlights

Session lifecycle (runtime):
- `pending -> starting -> running -> paused -> stopped/failed`

Automation run lifecycle (DB reality):
- `queued -> enriching -> ready -> running -> succeeded/failed/needs_human/timed_out`

Trigger event lifecycle:
- `queued -> processing -> completed/failed/skipped`

Action invocation lifecycle:
- `pending -> approved -> executing -> completed`
- Alternate terminals: `denied/expired/failed`

Billing state lifecycle:
- `unconfigured -> trial/active -> grace -> exhausted -> suspended`
- With explicit transitions for credits added, grace expiry, manual overrides.

Key structural tables by concern:
- Sessions and runtime metadata: `sessions`, `session_connections`
- Repo/prebuild graph: `repos`, `prebuilds`, `prebuild_repos`, base/repo snapshot tracking
- Triggers/runs: `triggers`, `trigger_events`, `automation_runs`, `automation_run_events`, `outbox`
- Actions: `action_invocations`, `action_grants`
- Integrations: `integrations`, `repo_connections`, `automation_connections`, `session_connections`, `slack_installations`
- Billing: `billing_events`, `llm_spend_cursors`, `billing_reconciliations`, billing fields on `organization`
- Secrets: `secrets`, `secret_bundles`
- Auth/org: better-auth tables for `user`, `session`, `organization`, `member`, `invitation`, `apikey`

## 5. Invariants That Keep The System Correct

Reliability and correctness patterns repeated across subsystems:
- Idempotency keys for expensive side effects (sessions, billing events, completions).
- Lease-based claiming for concurrent worker safety.
- Outbox for durable handoffs between pipeline stages.
- `FOR UPDATE` row locks where atomic balance changes or claims are required.
- Unique constraints for dedupe semantics (trigger dedup keys, one run per trigger event).
- Provider abstraction for runtime backend portability (Modal/E2B).

Security patterns:
- OAuth tokens resolved at execution time; not exposed broadly.
- Secrets encrypted at rest (AES-256-GCM) and never returned via list APIs.
- Service-to-service auth and scoped token checks in gateway and workers.
- Tool interception for privileged operations (snapshot, verify, run completion).

## 6. Architecture Insights By Subsystem

`agent-contract.md`:
- Clean split between tool declaration and tool execution.
- Tool files are filesystem-discovered by OpenCode, not registry-declared in config.
- Most platform tools are gateway-intercepted; one (`request_env_variables`) intentionally runs in sandbox.

`sandbox-providers.md`:
- Providers are contract-first and mostly interchangeable at call sites.
- Boot sequence is dense and deterministic: dependencies, plugin, tools, OpenCode, sidecar services.
- Snapshot layering is an optimization hierarchy, not a single artifact.

`sessions-gateway.md`:
- Hub model centralizes runtime ownership per session.
- Runtime is resilient but currently memory-local to gateway process.
- Migration path is explicit and lock-protected, avoiding overlapping migrations.

`automations-runs.md`:
- Clear stage-based run orchestration with outbox-backed transitions.
- Enrichment is deterministic today (no LLM dependency in enrichment stage).
- Finalizer acts as safety net for stale or incomplete runs.

`triggers.md`:
- Ingestion supports push, pull, and schedule models.
- Handoff to automations is transactional and durable.
- Provider abstraction exists in two layers today (functional + class-based), adding complexity.

`actions.md`:
- Approval flow is strongly modeled with risk classes and grants.
- Grants include wildcard matching and CAS consumption for concurrency safety.
- Adapter registry is static by design for controlled expansion.

`llm-proxy.md`:
- Per-session virtual keys enforce cost attribution boundaries.
- Team/user mapping aligns LLM spend to org/session dimensions.
- Spend sync is intentionally eventual and cursor-driven.

`cli.md`:
- Treat CLI as a local transport/orchestration client over gateway + web APIs.
- Device auth + API key persistence avoids local OAuth complexity.
- File sync model is intentionally one-way to prevent hidden merge semantics.

`repos-prebuilds.md`:
- Prebuild is the effective reusable runtime artifact and configuration boundary.
- Snapshot build workers optimize startup but do not replace runtime snapshot resolution logic.
- Service/env file persistence keeps startup configuration declarative.

`secrets-environment.md`:
- Secrets model favors strict non-disclosure and straightforward deployment-time injection.
- Bundle target paths bridge secret storage and deterministic file generation.
- Repo/org scope merging is explicit at session boot.

`integrations.md`:
- Acts as credential substrate for the rest of the platform.
- Runtime consumers should not own OAuth lifecycle details.
- Token resolution abstracts provider differences (GitHub App, Nango, Slack install tokens).

`auth-orgs.md`:
- Org context is the tenancy axis for almost every other subsystem.
- better-auth plugin endpoints own most writes for org/member lifecycle.
- Impersonation is overlay-based, not session-duplicating.

`billing-metering.md`:
- Fast local gating relies on shadow balance, not synchronous external billing calls.
- Event ledger and atomic balance mutation are foundational invariants.
- Billing FSM drives operational enforcement (grace, exhausted, suspension).

## 7. Current Partial Areas And Architectural Debt

Cross-spec high-signal partial/debt items:
- Billing gate bypass exists on some session creation paths (notably automation/gateway path).
- Snapshot quota functions exist but are not wired into active runtime paths.
- Automation manual run resolution API is incomplete (`needs_human` closure gap).
- Trigger ingestion and provider abstraction are duplicated across two paths/layers.
- Gateway hub cleanup is not fully wired; memory growth risk over long uptime.
- LLM proxy key revocation on session end is not implemented.
- Several ownership/cross-reference inconsistencies are tracked in `consistency-review.md`.

## 8. Meta-Spec Program Insights

`boundary-brief.md`:
- Defines the canonical spec registry, glossary, and cross-reference rules.
- Most useful for avoiding ownership drift during new changes.

`feature-registry.md`:
- Gives fast status/evidence lookup for each feature.
- Useful as implementation inventory, but should be read with `consistency-review.md` for drift awareness.

`consistency-review.md`:
- Captures known disagreements across status, ownership, and terminology.
- Should be treated as backlog for spec hygiene, not just editorial notes.

`implementation-context.md`:
- Provides prior-program context and explicitly calls out remaining implementation tracks.
- Helpful for understanding why certain partial patterns exist today.

`agent-prompts.md` and `template.md`:
- Process assets for generating/updating specs consistently.
- Not runtime architecture themselves, but key to keeping architecture docs coherent.

## 9. Practical Reading Order For Engineers

If you need to understand production runtime first:
1. `docs/specs/sessions-gateway.md`
2. `docs/specs/sandbox-providers.md`
3. `docs/specs/agent-contract.md`
4. `docs/specs/repos-prebuilds.md`
5. `docs/specs/secrets-environment.md`
6. `docs/specs/integrations.md`
7. `docs/specs/billing-metering.md`

If you need to understand automation/event systems:
1. `docs/specs/triggers.md`
2. `docs/specs/automations-runs.md`
3. `docs/specs/actions.md`
4. `docs/specs/llm-proxy.md`

If you need tenancy/access model:
1. `docs/specs/auth-orgs.md`
2. `docs/specs/integrations.md`
3. `docs/specs/billing-metering.md`

If you need local developer entry path:
1. `docs/specs/cli.md`
2. `docs/specs/sessions-gateway.md`
3. `docs/specs/repos-prebuilds.md`

## 10. One-Sentence Architecture Summary

Proliferate is a multi-tenant agent platform where identity, credentials, repos, prebuilds, and billing live in a control plane, while all real-time agent execution flows through a gateway-managed session hub into provider-backed sandboxes with durable outbox-based automation and billing side pipelines.


---

# FILE: docs/specs/auth-orgs.md

# Auth, Orgs & Onboarding — System Spec

## 1. Scope & Purpose

### In Scope
- User authentication via better-auth (email/password + GitHub/Google OAuth)
- Email verification flow (conditional, Resend-based)
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
3. Returns repos with prebuild status (`ready` if snapshotId exists, else `pending`). See `repos-prebuilds.md` for prebuild/snapshot model.

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
| `repos-prebuilds.md` | This → Repos | `getOrCreateManagedPrebuild()`, `requestRepoSnapshotBuild()` | Onboarding finalize creates repos and triggers snapshot builds |

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

### Out of Scope
- Trigger ingestion and matching — see `triggers.md`. Handoff point is the `enqueue_enrich` outbox row.
- Tool schemas (`automation.complete`) — see `agent-contract.md` §6.2
- Session runtime mechanics — see `sessions-gateway.md`
- Sandbox boot — see `sandbox-providers.md`
- Slack OAuth and installation — see `integrations.md`
- Schedule CRUD internals — see `triggers.md` (schedules are shared)
- Billing/metering for automation runs — see `billing-metering.md`

### Mental Model

An **automation** is a reusable configuration that describes *what* the agent should do when a trigger fires. A **run** is a single execution of that automation, moving through a pipeline: enrich the trigger context, resolve a target repo/prebuild, create a session, send the prompt, then finalize when the agent calls `automation.complete` or the session terminates.

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
└── automations.ts                    # oRPC routes: automation CRUD, runs, triggers, schedules

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
├── created_by          TEXT FK(user)
├── created_at          TIMESTAMPTZ
└── updated_at          TIMESTAMPTZ
Indexes: idx_automations_org, idx_automations_enabled, idx_automations_prebuild

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

**What it does:** Posts Slack messages when runs reach terminal states (succeeded, failed, timed_out, needs_human).

**Happy path** (`apps/worker/src/automation/notifications.ts:dispatchRunNotification`):
1. Load run with relations
2. Resolve Slack channel ID: prefer `automation.notificationChannelId`, fall back to `enabled_tools.slack_notify.channelId`
3. Look up Slack installation, decrypt bot token
4. Build Block Kit message with status, summary, and "View Run" button
5. POST to `chat.postMessage` with 10s timeout

**Files touched:** `apps/worker/src/automation/notifications.ts`, `packages/services/src/notifications/service.ts`

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

### 6.10 Run Claiming & Assignment — `Partial`

**What it does:** Lets users claim runs for manual review.

**Implemented routes** (`apps/web/src/server/routers/automations.ts`):
- `assignRun` — claim a run for the current user. Throws `CONFLICT` if already claimed by another user.
- `unassignRun` — unclaim a run.
- `myClaimedRuns` — list runs assigned to the current user.
- `listRuns` — list runs for an automation with status/pagination filters.

**Scoping note:** The route validates that the automation exists in the org (`automationExists(id, orgId)`), but the actual DB update in `assignRunToUser` (`packages/services/src/runs/db.ts:278`) is scoped by `run_id + organization_id` only — it does not re-check the automation ID. This means the automation ID in the route acts as a parent-resource guard but is not enforced at the DB level.

**Gap:** No manual status update route (e.g., marking a `needs_human` run as resolved). Feature registry notes this as incomplete.

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

- [ ] **No manual run status update** — Users can claim runs but cannot manually resolve `needs_human` runs via the API. Impact: requires direct DB access to close stuck runs. Expected fix: add `updateRunStatus` oRPC route with allowed transitions.
- [ ] **LLM filter/analysis fields unused** — `llm_filter_prompt` and `llm_analysis_prompt` columns exist on automations but are not executed during enrichment. Impact: configuration exists in UI but has no runtime effect. Expected fix: add LLM evaluation step to trigger processing pipeline (likely in `triggers.md` scope).
- [ ] **No run deadline enforcement at creation** — The `deadline_at` column exists but is never set during run creation. Only the finalizer checks it. Impact: runs rely solely on inactivity detection (30 min). Expected fix: set deadline from automation config at run creation.
- [ ] **Single-channel notifications** — Only Slack is implemented. The `NotificationChannel` interface exists for future email/in-app channels but no other implementations exist. Impact: orgs without Slack get no run notifications.
- [ ] **Notification channel resolution fallback** — The `resolveNotificationChannelId` function falls back to `enabled_tools.slack_notify.channelId` for backward compatibility. Impact: minor code complexity. Expected fix: migrate old automations and remove fallback.
- [ ] **Artifact writes are not retried independently** — If S3 write fails, the entire outbox item is retried (up to 5x). Impact: a transient S3 failure delays downstream notifications. Expected fix: split artifact writes into separate outbox items per artifact type.
- [ ] **Side effects table unused** — `automation_side_effects` table, service (`packages/services/src/side-effects/service.ts`), and `recordOrReplaySideEffect()` exist but have zero callsites in the run pipeline. Impact: dead infrastructure. Expected fix: wire into action invocations during automation runs, or remove if no longer planned.
- [ ] **Enrichment writes are not transactional** — `handleEnrich` performs `saveEnrichmentResult`, `enqueueOutbox(write_artifacts)`, `transitionRunStatus(ready)`, and `enqueueOutbox(enqueue_execute)` as four separate writes (`apps/worker/src/automation/index.ts:114-134`). A crash between writes can leave a run in an inconsistent state, recoverable only via lease expiry and re-claim. Impact: low (lease recovery works), but violates the outbox pattern's transactional intent.


---

# FILE: docs/specs/billing-metering.md

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
- Org pause / session termination on zero balance
- Overage policy (pause vs allow, per-org)
- Checkout flow (plan activation, credit top-ups via Autumn)
- Snapshot quota management (count and retention limits)
- Distributed locks for concurrent billing operations
- Billing worker (interval-based cycles)
- Billing token system (JWT auth for sandbox billing requests)

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
- Billing events in `trial` or `unconfigured` state are inserted with `status = 'skipped'` (no Autumn post).
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
├── distributed-lock.ts         # Redis SET NX locking (acquire/renew/release)
├── billing-token.ts            # JWT tokens for sandbox billing auth
└── autumn-client.test.ts       # Autumn client tests

packages/services/src/billing/
├── index.ts                    # Re-exports all billing service modules
├── db.ts                       # Billing event queries, LLM cursor ops, LiteLLM spend reads
├── shadow-balance.ts           # Atomic deduct/add/reconcile/initialize shadow balance
├── metering.ts                 # Compute metering cycle, sandbox liveness, finalization
├── outbox.ts                   # Outbox worker: retry failed Autumn posts
├── org-pause.ts                # Bulk pause/terminate sessions, overage handling
├── trial-activation.ts         # Auto-activate plan after trial exhaustion
└── snapshot-limits.ts          # Snapshot quota checking and cleanup

packages/db/src/schema/
└── billing.ts                  # billingEvents, llmSpendCursors, billingReconciliations tables

apps/web/src/server/routers/
└── billing.ts                  # oRPC routes: getInfo, updateSettings, activatePlan, buyCredits

apps/web/src/lib/
└── billing.ts                  # Session gating helpers (checkCanStartSession, isBillingEnabled)

apps/worker/src/billing/
├── index.ts                    # Worker exports (start/stop/health)
└── worker.ts                   # Interval-based billing worker (metering, LLM sync, outbox, grace)
```

---

## 4. Data Models & Schemas

### Database Tables

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
llm_spend_cursors
├── id                   TEXT PK DEFAULT 'global'
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
- `billing_settings` — JSONB (overage policy, cap, monthly usage)
- `autumn_customer_id` — external Autumn customer reference

### Plan Configuration

| Plan | Monthly | Credits | Max Sessions | Max Snapshots | Retention |
|------|---------|---------|-------------|---------------|-----------|
| dev  | $20     | 1,000   | 10          | 5             | 30 days   |
| pro  | $500    | 7,500   | 100         | 200           | 90 days   |

Trial: 1,000 credits granted at signup. Top-up pack: 500 credits for $5.

---

## 5. Conventions & Patterns

### Do
- Always deduct from shadow balance via `deductShadowBalance()` — it is the **only** path for credit deduction (`packages/services/src/billing/shadow-balance.ts:deductShadowBalance`).
- Use deterministic idempotency keys: `compute:{sessionId}:{fromMs}:{toMs}` for regular intervals, `compute:{sessionId}:{fromMs}:final` for finalization, `llm:{requestId}` for LLM events.
- Acquire a distributed lock before running metering or outbox cycles (`packages/shared/src/billing/distributed-lock.ts`).
- Check lock validity between sessions during metering to fail fast if lock is lost.

### Don't
- Do not call Autumn APIs in the session start/resume hot path — use `checkBillingGate()` with local shadow balance.
- Do not insert billing events outside a `deductShadowBalance` transaction — this breaks the atomicity invariant.
- Do not skip billing events for trial orgs — insert them with `status = 'skipped'` so the ledger is complete.

### Error Handling
Billing is **fail-closed**: if org lookup fails, billing state is unreadable, or shadow balance can't be computed, the operation is denied. See `apps/web/src/lib/billing.ts:checkCanStartSession`.

### Reliability
- **Metering lock**: 30s TTL, renewed every 10s. If renewal fails, the cycle aborts.
- **Outbox retries**: exponential backoff from 60s base, max 1h, up to 5 attempts. After 5 failures, event is permanently marked `failed`.
- **Idempotency**: `billingEvents.idempotency_key` UNIQUE constraint with `onConflictDoNothing` — prevents double-billing without aborting the transaction.
- **Sandbox liveness**: 3 consecutive alive-check failures before declaring dead (`METERING_CONFIG.graceFailures`).

---

## 6. Subsystem Deep Dives

### 6.1 Compute Metering — `Implemented`

**What it does:** Bills running sessions for elapsed compute time every 30 seconds.

**Happy path:**
1. `runMeteringCycle()` acquires the `billing:metering:lock` via Redis (`packages/services/src/billing/metering.ts:runMeteringCycle`).
2. Queries all sessions with `status = 'running'`.
3. Checks sandbox liveness via provider `checkSandboxes()` with grace period (3 consecutive failures = dead).
4. For alive sandboxes: computes `billableSeconds = floor((now - meteredThroughAt) / 1000)`, skips if < 10s.
5. Calls `deductShadowBalance()` with deterministic idempotency key.
6. Advances `sessions.metered_through_at`.
7. If `shouldTerminateSessions`, calls `handleCreditsExhaustedV2()` — unless transitioning from trial (tries `tryActivatePlanAfterTrial()` first).

**Edge cases:**
- Dead sandbox → `billFinalInterval()` bills through `last_seen_alive_at + pollInterval`, not detection time. Marks session `stopped`.
- Lock renewal failure → cycle aborts immediately to prevent conflicting with another worker.

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

**`addShadowBalance`:** Adds credits (top-ups, refunds). If state is `grace`/`exhausted` and new balance > 0, transitions back to `active`. Inserts a `billing_reconciliations` record.

**`reconcileShadowBalance`:** Corrects drift between local and Autumn balance. Inserts reconciliation record for audit trail.

**Files touched:** `packages/services/src/billing/shadow-balance.ts`, `packages/db/src/schema/billing.ts`

### 6.3 Credit Gating — `Partial`

**What it does:** Single entry point for session-lifecycle billing checks.

**Happy path:**
1. `checkCanStartSession()` fetches org billing info from DB (`apps/web/src/lib/billing.ts`).
2. Calls `checkBillingGate()` with org state, shadow balance, session counts, and operation type.
3. Gate checks (in order): grace expiry → billing state → credit sufficiency (min 11 credits) → concurrent session limit.
4. Returns `{ allowed: true }` or `{ allowed: false, errorCode, message, action }`.

**Operations gated:** `session_start`, `session_resume`, `cli_connect`, `automation_trigger`. Resume and CLI connect skip the concurrent limit check.

**Gap:** Gating is only enforced in the oRPC `createSessionHandler` (`apps/web/src/server/routers/sessions-create.ts:48`). Automation runs create sessions via the gateway HTTP route (`apps/gateway/src/api/proliferate/http/sessions.ts`), which has no billing check. Automations can therefore create sessions even when the org is out of credits or over concurrent limits.

**Files touched:** `packages/shared/src/billing/gating.ts`, `apps/web/src/lib/billing.ts`

### 6.4 LLM Spend Sync — `Implemented`

**What it does:** Ingests LLM cost data from LiteLLM's `LiteLLM_SpendLogs` table into billing events using cursor-based pagination.

**Happy path:**
1. Worker calls `syncLLMSpend()` every 30s (`apps/worker/src/billing/worker.ts`).
2. Fetches current cursor from `llm_spend_cursors` (singleton row `id = 'global'`).
3. Reads spend logs after cursor position, ordered by `(startTime, request_id)`.
4. For each log: calculates `credits = spend × 3 / 0.01`, calls `deductShadowBalance()` with key `llm:{request_id}`.
5. Handles state transitions (same as metering — trial auto-activation, exhausted enforcement).
6. Advances cursor after each batch.
7. Performs a lookback sweep for late-arriving logs (5-minute window, idempotency handles duplicates).

**Bootstrap modes:** `recent` (default, 5-minute lookback) or `full` (backfills from earliest log). Configurable via `LLM_SYNC_BOOTSTRAP_MODE` env var.

**Files touched:** `apps/worker/src/billing/worker.ts`, `packages/services/src/billing/db.ts`

### 6.5 Outbox Processing — `Implemented`

**What it does:** Retries posting billing events to Autumn that failed or haven't been posted yet.

**Happy path:**
1. `processOutbox()` acquires `billing:outbox:lock` via Redis (`packages/services/src/billing/outbox.ts`).
2. Queries billing events with `status IN ('pending', 'failed')`, `retry_count < 5`, `next_retry_at < now()`.
3. For each event: calls `autumnDeductCredits()` to post to Autumn.
4. On success: marks `status = 'posted'`. If Autumn denies, transitions org to `exhausted` and terminates sessions.
5. On failure: increments retry count, sets exponential backoff, marks `failed` after 5 retries.

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

**Enforcement actions:** `grace` → blocks new sessions. `exhausted`/`suspended` → terminates all running sessions.

**Files touched:** `packages/shared/src/billing/state.ts`

### 6.7 Org Pause & Session Termination — `Implemented`

**What it does:** Bulk-pauses or terminates all running sessions for an org when credits are exhausted.

**V1 (`handleCreditsExhausted`):** Checks overage policy. If `pause` → pauses all sessions. If `allow` → attempts auto top-up via Autumn; on failure, pauses.

**V2 (`handleCreditsExhaustedV2`):** Terminates sessions sequentially (stops sandbox via provider, marks session `stopped`). Used when grace period expires or overdraft cap is exceeded.

**`canOrgStartSession`:** Checks concurrent session count against plan limit.

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

### 6.10 Snapshot Quota Management — `Partial`

**What it does:** Defines per-plan snapshot count and retention limits. Snapshots are free within quota (no credit charge).

**`canCreateSnapshot`:** Checks count of sessions with `snapshot_id IS NOT NULL` against plan limit.

**`ensureSnapshotCapacity`:** If at limit, deletes oldest snapshot (by `paused_at`).

**`cleanupExpiredSnapshots`:** Deletes snapshots older than retention period.

**Gap:** All three functions are exported but have **no callers** in the codebase. Neither session pause nor any worker invokes quota checks. Snapshot limits are currently unenforced.

**Files touched:** `packages/services/src/billing/snapshot-limits.ts`

### 6.11 Distributed Locks — `Implemented`

**What it does:** Ensures only one worker runs metering or outbox processing at a time.

**Implementation:** Redis `SET NX` with token-based ownership. Lua scripts for atomic renew (`check-then-pexpire`) and release (`check-then-del`). `withLock()` helper handles acquisition, renewal interval, and release in a try/finally.

**Lock keys:** `billing:metering:lock`, `billing:outbox:lock`. TTL: 30s. Renewal: every 10s.

**Files touched:** `packages/shared/src/billing/distributed-lock.ts`

### 6.12 Billing Worker — `Implemented`

**What it does:** Runs four periodic tasks as `setInterval` loops inside the worker process.

| Task | Interval | Function |
|------|----------|----------|
| Compute metering | 30s | `billing.runMeteringCycle()` |
| LLM spend sync | 30s | `syncLLMSpend()` (inline in worker) |
| Outbox processing | 60s | `billing.processOutbox()` |
| Grace expiration | 60s | `checkGraceExpirations()` |

Initial runs: metering at +5s, LLM sync at +3s after start. Guarded by `NEXT_PUBLIC_BILLING_ENABLED` env var.

**Files touched:** `apps/worker/src/billing/worker.ts`

### 6.13 Billing Token — `Partial`

**What it does:** Short-lived JWTs (1h) for sandbox-to-platform billing authentication.

**Claims:** `org_id`, `session_id`, `token_version`. Token version on the session record enables instant revocation. Full validation checks: signature → session existence → running status → org match → version match.

**Gap:** `mintBillingToken` and `verifyBillingToken` are only used in the token refresh endpoint (`apps/web/src/app/api/sessions/[id]/refresh-token/route.ts`). `validateBillingToken` (full DB validation) has **no callers**. No gateway middleware or session creation path mints or validates billing tokens. The token infrastructure exists but is not wired into request authorization.

**Files touched:** `packages/shared/src/billing/billing-token.ts`

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `auth-orgs.md` | Billing → Orgs | `orgs.getBillingInfoV2()`, `orgs.initializeBillingState()` | Reads/writes billing fields on `organization` table |
| `auth-orgs.md` | Orgs → Billing | `startTrial` in onboarding router | Onboarding triggers trial credit provisioning |
| `llm-proxy.md` | LLM → Billing | `LiteLLM_SpendLogs` table | LLM spend sync reads from LiteLLM's external table |
| `sessions-gateway.md` | Sessions → Billing | `checkCanStartSession()` | Session creation calls billing gate |
| `sessions-gateway.md` | Billing → Sessions | `sessions.status`, `metered_through_at` | Metering reads/updates session rows |
| `sandbox-providers.md` | Billing → Providers | `provider.checkSandboxes()`, `provider.terminate()` | Liveness checks and session termination |
| `automations-runs.md` | Automations → Billing | (not yet wired) | `automation_trigger` gate type exists but automations bypass billing via gateway HTTP route |

### Security & Auth
- Billing routes use `orgProcedure` middleware (authenticated + org context). Settings and checkout require admin/owner role.
- Billing tokens use HS256 JWT with `BILLING_JWT_SECRET`. Token version enables instant revocation.
- No sensitive data in billing events (no prompt content, no tokens). LLM metadata includes model name and token counts only.

### Observability
- Structured logging via `@proliferate/logger` with modules: `metering`, `org-pause`, `outbox`, `llm-sync`, `trial-activation`, `snapshot-limits`.
- Key log fields: `sessionId`, `orgId`, `billableSeconds`, `credits`, `balance`, `enforcementReason`.
- `getOutboxStats()` provides pending/failed/permanently-failed event counts for monitoring (`packages/services/src/billing/outbox.ts:getOutboxStats`).

---

## 8. Acceptance Gates

- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] Billing tests pass (Autumn client tests)
- [ ] This spec is updated (file tree, data models, deep dives)
- [ ] Idempotency keys follow the deterministic pattern
- [ ] Shadow balance is only modified via `deductShadowBalance` or `addShadowBalance`
- [ ] No Autumn API calls in session start/resume hot path

---

## 9. Known Limitations & Tech Debt

- [ ] **Automation runs bypass billing gate** — the `automation_trigger` gate type exists in `checkBillingGate` but automations create sessions via the gateway HTTP route (`apps/gateway/src/api/proliferate/http/sessions.ts`), which has no billing check. Only the oRPC `createSessionHandler` enforces gating. — Expected fix: add billing gate to the gateway session creation path or have the worker call gating before dispatching.
- [ ] **Snapshot quota functions have no callers** — `canCreateSnapshot`, `ensureSnapshotCapacity`, and `cleanupExpiredSnapshots` are exported but never invoked. Snapshot count and retention limits are unenforced. — Expected fix: wire into session pause/snapshot paths and add cleanup to billing worker.
- [ ] **Billing token not wired into request authorization** — `validateBillingToken` has no callers. No gateway middleware or session creation path mints or validates billing tokens. — Expected fix: integrate into gateway or sandbox request auth.
- [ ] **Overage auto-charge (V1) not integrated with V2 state machine** — `handleCreditsExhausted` (V1) uses `autumnAutoTopUp` and pause, while V2 uses `handleCreditsExhaustedV2` with termination. Both exist but V2 is the active path for shadow-balance enforcement. — Expected fix: remove V1 once V2 is fully validated.
- [ ] **No automated reconciliation with Autumn** — `reconcileShadowBalance()` exists but is not called on a schedule. Shadow balance can drift from Autumn's actual balance indefinitely. — Expected fix: add periodic reconciliation in billing worker.
- [ ] **Grace expiration check is polling-based** — `checkGraceExpirations()` runs every 60s, meaning grace can overrun by up to 60s. — Impact: minor, grace window is 5 minutes.
- [ ] **Permanently failed outbox events have no alerting** — events that exhaust all 5 retries are marked `failed` but no alert is raised. — Expected fix: add monitoring/alerting on permanently failed events.
- [ ] **LLM model allowlist is manually maintained** — `ALLOWED_LLM_MODELS` set in `types.ts` must be updated when adding models to the proxy. — Impact: new models will be rejected until added.


---

# FILE: docs/specs/boundary-brief.md

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
| 9 | `repos-prebuilds.md` | Repo CRUD, prebuild/configuration management, base + repo snapshot builds, service commands, env file generation. | 3 |
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
| **Integrations vs Actions/Automations/Sessions** | `integrations.md` owns OAuth flows + connection lifecycle only. Runtime behavior that *uses* a connection belongs to the consuming spec (Actions, Automations, Sessions). |
| **Agent Contract vs Sessions/Automations** | `agent-contract.md` owns prompt templates, tool schemas, and capability injection. Runtime behavior that *executes* tools belongs to `sessions-gateway.md` (interactive) or `automations-runs.md` (automated). |
| **Agent Contract vs Sandbox Providers** | `agent-contract.md` owns what tools exist and their schemas. `sandbox-providers.md` owns how tools are injected into the sandbox environment (plugin config, MCP server). |
| **LLM Proxy vs Billing** | `llm-proxy.md` owns key generation, routing, and spend *events*. `billing-metering.md` owns charging policy, credit gating, and balance enforcement. |
| **Triggers vs Automations** | `triggers.md` owns event ingestion, matching, and dispatch. Once a trigger fires, the resulting automation run belongs to `automations-runs.md`. The handoff point is the `AUTOMATION_ENRICH` queue enqueue. |
| **Sessions vs Sandbox Providers** | `sessions-gateway.md` owns the session lifecycle and gateway runtime. `sandbox-providers.md` owns the provider interface and sandbox boot mechanics. Sessions *calls* the provider interface; the provider spec defines the contract. |
| **Repos/Prebuilds vs Sessions** | `repos-prebuilds.md` owns repo records, prebuild configs, and snapshot *builds*. `sandbox-providers.md` owns snapshot *resolution* (`resolveSnapshotId()` in `packages/shared/src/snapshot-resolution.ts`). `sessions-gateway.md` owns the prebuild *resolver* (`apps/gateway/src/lib/prebuild-resolver.ts`) which determines which prebuild to use at session start. |
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
| **prebuild** | A reusable configuration + snapshot combination for faster session starts. Previously called "configuration" in some code. | configuration (in specs — use "prebuild" consistently) |
| **snapshot** | A saved filesystem state. Three layers: base snapshot, repo snapshot, prebuild snapshot. | image, checkpoint, save point |
| **action** | A platform-mediated operation the agent performs on external services (e.g., create Linear issue, update Sentry). | tool (tools are the broader category; actions are the external-service subset) |
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
  apiUrl?: string;       // Override for NEXT_PUBLIC_API_URL
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

**What it does:** Manages CLI configuration in `~/.proliferate/config.json` with environment variable fallbacks. **Status: Implemented**

**Config resolution (priority order):**
1. `config.json` values (user-set overrides)
2. Environment variables (e.g., `NEXT_PUBLIC_API_URL` for `apiUrl`)

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

# FILE: docs/specs/consistency-review.md

# Spec Consistency Review

> **Reviewed:** 2026-02-11
> **Scope:** All 13 specs + boundary-brief + feature-registry
> **Reviewer:** Automated consistency check

---

## Summary

- **37 issues found** across 7 categories
- **5 status disagreements** between feature-registry and specs
- **11 file/table ownership overlaps** requiring resolution
- **3 contradictions** between specs or with boundary-brief
- **1 broken cross-reference** (boundary-brief vs actual spec ownership)
- **6 glossary violations**
- **8 missing cross-references**
- **3 feature-registry evidence path issues**

---

## 1. Status Disagreements (feature-registry vs specs)

### 1.1 `triggers.md` — Gmail provider
- **Feature registry:** Planned (`packages/triggers/src/adapters/gmail.ts` — "Stub exists, not in registry")
- **Spec:** Section 6.4 says "Gmail (Partial — polling via Composio)" and describes a full implementation
- **Fix:** Update feature-registry to `Partial` with note "Full implementation exists, requires `COMPOSIO_API_KEY` env var"

### 1.2 `triggers.md` — Cron scheduling
- **Feature registry:** Implemented (`apps/trigger-service/src/` — "SCHEDULED queue + cron expressions")
- **Spec:** Section 1 says "Partial — queue defined, worker not running"; Section 9 says "SCHEDULED queue worker not instantiated...High impact"
- **Fix:** Update feature-registry to `Partial` with note "Queue defined, worker not instantiated"

### 1.3 `triggers.md` — Sentry provider type
- **Feature registry:** "Webhook + polling"
- **Spec:** Section 6.4 says "Sentry (Implemented — webhook only)"
- **Fix:** Update feature-registry notes to "Webhook only" (no polling adapter for Sentry)

### 1.4 `secrets-environment.md` — S3 integration for secrets
- **Feature registry:** Implemented (`apps/gateway/src/lib/s3.ts`)
- **Spec:** Section 9 explicitly flags this: "`apps/gateway/src/lib/s3.ts` handles verification file uploads only. Secrets are stored exclusively in PostgreSQL."
- **Fix:** Remove "S3 integration for secrets" from feature-registry or change status to `Planned`. The S3 module is owned by sessions-gateway for verification uploads.

### 1.5 `billing-metering.md` — Credit gating
- **Feature registry:** Implemented
- **Spec:** Section 6.3 explicitly marked `Partial` with documented gap: "Automation runs create sessions via the gateway HTTP route which has no billing check"
- **Fix:** Update feature-registry to `Partial` with note "oRPC path enforced; gateway HTTP path (automations) bypasses billing gate"

---

## 2. File/Table Ownership Overlaps

### 2.1 `packages/shared/src/agents.ts`
- **Claimed by:** `agent-contract.md` (file tree §3), `sandbox-providers.md` (file tree §3, §2 "Agent & Model Configuration" section)
- **Fix:** Assign to `agent-contract.md` (it defines the agent/model types). `sandbox-providers.md` should reference it but not list it in its file tree or document it in §2.

### 2.2 `packages/shared/src/sandbox/config.ts`
- **Claimed by:** `agent-contract.md` (file tree §3), `sandbox-providers.md` (file tree §3)
- **Fix:** Assign to `sandbox-providers.md` (it owns sandbox boot config, plugin template, paths, ports). `agent-contract.md` references `ENV_INSTRUCTIONS` and `ACTIONS_BOOTSTRAP` from this file but should link to sandbox-providers, not list it in its own file tree.

### 2.3 `packages/shared/src/sandbox/opencode.ts`
- **Claimed by:** `agent-contract.md` (file tree §3), `sandbox-providers.md` (file tree §3)
- **Fix:** Assign to `sandbox-providers.md` (owns readiness check and config generation). `agent-contract.md` §6.4 documents the generated config — it should reference this file without claiming ownership.

### 2.4 `apps/gateway/src/lib/session-store.ts`
- **Claimed by:** `agent-contract.md` (file tree §3), `sessions-gateway.md` (file tree §3)
- **Fix:** Assign to `sessions-gateway.md` (primary purpose is session context loading). `agent-contract.md` references `buildSystemPrompt()` in this file — it should cite the function without claiming the file.

### 2.5 `apps/gateway/src/lib/opencode.ts`
- **Claimed by:** `agent-contract.md` (file tree §3), `sessions-gateway.md` (file tree §3)
- **Fix:** Assign to `sessions-gateway.md` (gateway infrastructure). `agent-contract.md` describes `updateToolResult()` behavior — cite with link, don't claim.

### 2.6 `apps/gateway/src/hub/capabilities/tools/*`
- **Claimed by:** `agent-contract.md` (file tree §3), `sessions-gateway.md` (file tree §3)
- **Fix:** Per boundary-brief: "agent-contract.md owns what tools exist and their schemas." Assign to `agent-contract.md` for tool handler definitions. `sessions-gateway.md` should list the directory in its file tree with a note "(tool schemas — see `agent-contract.md`)" and only document the interception/routing infrastructure, not the handlers themselves.

### 2.7 `packages/services/src/sessions/sandbox-env.ts`
- **Claimed by:** `llm-proxy.md` (file tree §3), `secrets-environment.md` (file tree §3)
- **Fix:** Assign to `sessions-gateway.md` (it assembles all sandbox env vars as part of session creation). Both `llm-proxy.md` and `secrets-environment.md` should reference it for their respective contributions (key generation and secret decryption).

### 2.8 `packages/db/src/schema/billing.ts` and `packages/services/src/billing/db.ts`
- **Claimed by:** `llm-proxy.md` (file tree §3), `billing-metering.md` (file tree §3)
- **Fix:** Assign to `billing-metering.md` (owns all billing tables and queries). `llm-proxy.md` should reference `llmSpendCursors` table and the spend query functions without claiming the files.

### 2.9 `apps/worker/src/billing/worker.ts`
- **Claimed by:** `llm-proxy.md` (file tree §3), `billing-metering.md` (file tree §3)
- **Fix:** Assign to `billing-metering.md`. `llm-proxy.md` documents `syncLLMSpend()` which lives here — it should reference the function, not claim the file.

### 2.10 `repo_connections` table
- **Claimed by:** `repos-prebuilds.md` (data models §4), `integrations.md` (data models §4)
- **Fix:** Assign to `integrations.md` (owns connection binding tables per boundary-brief). `repos-prebuilds.md` references it for token resolution but should not list the full DDL.

### 2.11 `apps/gateway/src/lib/github-auth.ts`
- **Claimed by:** `sessions-gateway.md` (file tree §3), `integrations.md` (file tree §3, §6.11 deep dive)
- **Fix:** Assign to `integrations.md` (owns token resolution). `sessions-gateway.md` should reference it.

---

## 3. Contradictions

### 3.1 Snapshot resolution ownership
- **Boundary-brief §2:** "repos-prebuilds.md owns repo records, prebuild configs, and snapshot *builds*. sessions-gateway.md owns snapshot *resolution* at session start (which snapshot to use)."
- **repos-prebuilds.md §1:** "Out of Scope: Snapshot resolution logic — see `sandbox-providers.md` §6.5"
- **sandbox-providers.md §6.5:** Documents `resolveSnapshotId()` — the function that picks which snapshot to use
- **sessions-gateway.md:** Does NOT claim snapshot resolution
- **Fix:** Update boundary-brief to say "sandbox-providers.md owns snapshot resolution" (since the function lives in `packages/shared/src/snapshot-resolution.ts` which is in the providers file tree). Or move it to repos-prebuilds since it's closely related to snapshot builds.

### 3.2 Run lifecycle state names
- **Boundary-brief §3 glossary:** "pending → enriching → executing → completed/failed"
- **automations-runs.md §4:** "queued → enriching → ready → running → succeeded/failed/needs_human/timed_out"
- **Spec §4 note:** Acknowledges this discrepancy
- **Fix:** Update boundary-brief glossary to match the actual DB values: "queued → enriching → ready → running → succeeded/failed/needs_human/timed_out"

### 3.3 Prebuild resolver ownership ambiguity
- **repos-prebuilds.md §6.7:** "Owned by the gateway; documented here because it creates prebuild and repo records via this spec's services."
- **sessions-gateway.md §6.1:** References `resolvePrebuild()` as part of session creation
- **Fix:** The resolver file `apps/gateway/src/lib/prebuild-resolver.ts` should be assigned to one spec. Since it lives in the gateway and is part of session creation flow, assign to `sessions-gateway.md`. `repos-prebuilds.md` should reference it for context but not document its internals.

---

## 4. Glossary Violations

### 4.1 `sandbox-providers.md` — "container"
- **§1 Mental Model:** "A sandbox is a remote compute environment (Modal container or E2B sandbox)"
- **Violation:** Glossary says do not call a sandbox a "container"
- **Fix:** Reword to "A sandbox is a remote compute environment backed by Modal or E2B"

### 4.2 `feature-registry.md` — "Configurations" in title
- **Section 9 header:** "Repos, Configurations & Prebuilds"
- **Violation:** Glossary says use "prebuild" not "configuration (in specs)"
- **Fix:** Change header to "Repos & Prebuilds"

### 4.3 `repos-prebuilds.md` — occasional "configuration" usage
- **§1 Mental Model:** "Effective configuration unit" appears in `implementation-context.md` language
- **§2 Core Concepts:** "Prebuild Types" is correct, but "configuration management" appears in boundary-brief scope description
- **Fix:** Audit and replace "configuration" with "prebuild" throughout when referring to the entity

### 4.4 `boundary-brief.md` — "configuration" in scope description
- **§1 Spec Registry, row 9:** "Repo CRUD, prebuild/configuration management"
- **Violation:** Glossary says use "prebuild" not "configuration"
- **Fix:** Change to "Repo CRUD, prebuild management"

### 4.5 `automations-runs.md` — "job" used for BullMQ
- **§2 "Outbox Pattern":** "dispatches to BullMQ queues" — technically uses "queue" which the glossary reserves for outbox
- **Minor:** BullMQ is an external system, so "queue" in that context is arguably fine. But the outbox glossary entry says "not: queue" — this creates ambiguity.
- **Fix:** No action needed for BullMQ references — the glossary "queue" prohibition applies to calling the outbox a queue, not to BullMQ itself. Consider adding a clarification to the glossary.

### 4.6 `triggers.md` — "event" vs "trigger"
- **§1 Mental Model:** "External services emit events" — uses "event" liberally
- **Minor:** The glossary says trigger not "event, hook, listener" — but "event" is used correctly here to mean the occurrence, not the trigger definition
- **Fix:** No action needed — "trigger event" is the correct compound term for individual occurrences. The glossary prohibition is about calling the trigger configuration an "event."

---

## 5. Missing Cross-References

### 5.1 `actions.md` §7 — missing sessions-gateway reference
- **Issue:** Actions calls `sessions.listSessionConnections()` from `packages/services/src/sessions/db.ts` but the cross-cutting table doesn't reference `sessions-gateway.md`
- **Fix:** Add a row: `sessions-gateway.md | Actions → Sessions | sessions.listSessionConnections() | Discovers connected integrations for a session`

### 5.2 `sandbox-providers.md` §6.8 — git endpoints not cross-referenced
- **Issue:** sandbox-mcp API includes `/api/git/repos`, `/api/git/status`, `/api/git/diff` endpoints. These relate to `sessions-gateway.md` §6.6 (gateway-side git operations) but have no cross-reference.
- **Fix:** Add a cross-reference note in sandbox-providers §6.8 or §7 linking to sessions-gateway for gateway-side git operations.

### 5.3 `llm-proxy.md` — weak cross-reference to billing for `llmSpendCursors`
- **Issue:** Both specs document the `llm_spend_cursors` table, but llm-proxy.md doesn't clearly say this table is owned by billing-metering.md
- **Fix:** Add a note in llm-proxy.md §4: "This table is also documented in `billing-metering.md` which owns the billing schema."

### 5.4 `triggers.md` §6.8 — `apps/web/src/app/api/webhooks/github-app/route.ts`
- **Issue:** This file handles both GitHub lifecycle events (integrations.md §6.13) and trigger dispatch (triggers.md §6.8). Both specs document it without clearly delineating ownership.
- **Fix:** Add explicit notes: integrations.md owns lifecycle handling (installation deleted/suspended/unsuspended), triggers.md owns event dispatch to triggers. The file should be listed in one spec's file tree with a cross-reference from the other.

### 5.5 `repos-prebuilds.md` — setup finalization secret storage
- **Issue:** §6.8 mentions `secrets.upsertSecretByRepoAndKey()` but the cross-cutting table row just says "Finalize → Secrets" without the specific function.
- **Fix:** The cross-reference exists (§7 table has it), but the description could be more specific: "Setup finalization stores encrypted secrets via `secrets.upsertSecretByRepoAndKey()`"

### 5.6 `auth-orgs.md` — billing fields on organization table
- **Issue:** Lists billing columns (`billing_state`, `shadow_balance`, etc.) in the `organization` table DDL without noting they're documented in more detail by `billing-metering.md`
- **Fix:** Add a note after the DDL: "Billing-related columns are documented in detail in `billing-metering.md` §4"

### 5.7 `billing-metering.md` — missing cross-reference to llm-proxy for spend sync
- **Issue:** §6.4 documents LLM spend sync but the cross-cutting table only has a generic reference to llm-proxy. Should specifically reference `llm-proxy.md` §6.3 for the spend sync architecture.
- **Fix:** Update the `llm-proxy.md` row in §7 to reference "See `llm-proxy.md` §6.3 for spend sync architecture"

### 5.8 `cli.md` — `session_type: "terminal"` not cross-referenced to sessions-gateway
- **Issue:** CLI creates sessions with `session_type: "terminal"` but sessions-gateway.md notes this as an inconsistency (gateway creator defines `"cli"` not `"terminal"`). The specs don't cross-reference each other on this known issue.
- **Fix:** Add a note in cli.md §6.6 referencing the `session_type` inconsistency documented in sessions-gateway.md §4.

---

## 6. Feature-Registry Evidence Path Issues

### 6.1 `automations-runs.md` — outbox-dispatch.ts may be stale
- **Feature registry:** `Outbox dispatch | Implemented | apps/worker/src/automation/outbox-dispatch.ts`
- **Spec file tree:** Only lists `apps/worker/src/automation/index.ts` — `dispatchOutbox` function is documented as living in `index.ts`
- **Fix:** Verify whether `outbox-dispatch.ts` still exists. If merged into `index.ts`, update feature-registry evidence path.

### 6.2 `automations-runs.md` — notifications-dispatch.ts not in file tree
- **Feature registry:** `Notification dispatch | Implemented | apps/worker/src/automation/notifications-dispatch.ts`
- **Spec file tree:** Lists `notifications.ts` but not `notifications-dispatch.ts`
- **Fix:** Verify file existence and update either the spec file tree or the feature-registry evidence.

### 6.3 `triggers.md` — Gmail adapter path
- **Feature registry:** `Gmail provider | Planned | packages/triggers/src/adapters/gmail.ts`
- **Spec file tree:** Lists `packages/triggers/src/service/adapters/gmail.ts`
- **Fix:** Update feature-registry path to match spec: `packages/triggers/src/service/adapters/gmail.ts`

---

## 7. Depth Imbalance

All 13 specs fall within the 300-600 line target:
- Shortest: `llm-proxy.md` (~343 lines) — expected, scope is an integration contract
- Longest: `auth-orgs.md` (~571 lines) — within range, scope is broad

**No actionable depth imbalance issues found.**

---

## 8. Additional Observations

### 8.1 `outbox` table documented only in automations-runs
- The `outbox` table is used by both automations-runs and triggers (triggers insert `enqueue_enrich` rows). The table definition lives only in automations-runs.md §4. This is acceptable since automations-runs owns the outbox dispatch, but triggers.md should have a cross-reference noting it inserts into a table documented in automations-runs.md.

### 8.2 `packages/queue/src/index.ts` claimed by multiple specs
- triggers.md (polling/scheduling queues), repos-prebuilds.md (snapshot build queues), automations-runs.md (automation queues) all reference this file. As shared infrastructure, it's listed in the feature-registry cross-cutting section. No spec should exclusively claim it.

### 8.3 `session_connections`, `automation_connections` tables
- integrations.md lists these in its data models (connection binding tables)
- sessions-gateway.md lists `session_connections` in its data models
- automations-runs.md lists `automation_connections` in its data models
- **Fix:** Per boundary-brief, integrations.md owns "Connection binding to repos/automations/sessions." Assign all three junction tables exclusively to integrations.md. Other specs should reference them.

### 8.4 Boundary-brief scope description for `sandbox-providers.md`
- **Boundary-brief says:** "Modal + E2B provider interface, sandbox boot, snapshot resolution, git freshness, sandbox-mcp"
- **Spec says:** Snapshot resolution is in scope (§6.5)
- **But boundary-brief §2 says:** "sessions-gateway.md owns snapshot *resolution*"
- These two statements in boundary-brief contradict each other (see §3.1 above)

---

## Priority Summary

| Priority | Count | Categories |
|----------|-------|------------|
| High | 5 | Status disagreements (feature-registry drift from specs) |
| High | 3 | Contradictions (boundary-brief vs specs) |
| Medium | 11 | File/table ownership overlaps |
| Medium | 3 | Feature-registry stale evidence paths |
| Low | 8 | Missing cross-references |
| Low | 6 | Glossary violations (mostly minor) |
| None | 0 | Depth imbalance |

**Recommended next step:** Fix the 5 status disagreements in feature-registry first (quick, high-impact), then resolve the 3 contradictions in boundary-brief, then clean up file ownership overlaps across specs.


---

# FILE: docs/specs/feature-registry.md

# Feature Registry

> **Purpose:** Single source of truth for every product feature, its implementation status, and which spec owns it.
> **Status key:** `Implemented` | `Partial` | `Planned` | `Deprecated`
> **Updated:** 2026-02-11 from `main` branch. Corrected after consistency review.

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
| Gateway auth middleware | Implemented | `apps/gateway/src/middleware/auth.ts` | Token verification |
| Gateway CORS | Implemented | `apps/gateway/src/middleware/cors.ts` | CORS policy |
| Gateway error handler | Implemented | `apps/gateway/src/middleware/error-handler.ts` | Centralized error handling |
| Gateway request logging | Implemented | `apps/gateway/src/` | pino-http via `@proliferate/logger` |

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
| Outbox dispatch | Implemented | `apps/worker/src/automation/outbox-dispatch.ts` | Reliable event delivery |
| Outbox atomic claim | Implemented | `packages/services/src/outbox/service.ts` | Claim + stuck-row recovery |
| Side effects tracking | Implemented | `packages/db/src/schema/automations.ts` | `automation_side_effects` table |
| Artifact storage (S3) | Implemented | `apps/worker/src/automation/artifacts.ts` | Completion + enrichment artifacts |
| Target resolution | Implemented | `apps/worker/src/automation/resolve-target.ts` | Resolves which repo/prebuild to use |
| Slack notifications | Implemented | `apps/worker/src/automation/notifications.ts` | Run status posted to Slack |
| Notification dispatch | Implemented | `apps/worker/src/automation/notifications-dispatch.ts` | Delivery orchestration |
| Slack async client | Implemented | `apps/worker/src/slack/client.ts` | Full bidirectional session via Slack |
| Slack inbound handlers | Implemented | `apps/worker/src/slack/handlers/` | Text, todo, verify, default-tool |
| Slack receiver worker | Implemented | `apps/worker/src/slack/` | BullMQ-based message processing |
| Run claiming / manual update | Partial | `apps/web/src/server/routers/automations.ts` | Run events queryable; manual update route incomplete |
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
| Cron scheduling | Partial | `apps/trigger-service/src/` | Queue type defined, DB schema exists, but no BullMQ worker instantiated to process SCHEDULED jobs |
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
| Invocation sweeper | Implemented | `apps/worker/src/sweepers/index.ts` | Expires stale invocations |
| Sandbox-MCP grants handler | Implemented | `packages/sandbox-mcp/src/actions-grants.ts` | Grant handling inside sandbox |
| Actions list (web) | Implemented | `apps/web/src/server/routers/actions.ts` | Org-level actions inbox |

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
| CLI API routes (prebuilds) | Implemented | `apps/web/src/server/routers/cli.ts:cliPrebuildsRouter` | Prebuild listing for CLI |
| GitHub repo selection | Implemented | `packages/db/src/schema/cli.ts:cliGithubSelections` | Selection history |
| SSH key storage | Implemented | `packages/db/src/schema/cli.ts:userSshKeys` | Per-user SSH keys |

---

## 9. Repos, Configurations & Prebuilds (`repos-prebuilds.md`)

| Feature | Status | Evidence | Notes |
|---------|--------|----------|-------|
| Repo CRUD | Implemented | `apps/web/src/server/routers/repos.ts` | List/get/create/delete |
| Repo search | Implemented | `apps/web/src/server/routers/repos.ts:search` | Search available repos |
| Repo connections | Implemented | `packages/db/src/schema/repos.ts:repoConnections` | Integration bindings |
| Prebuild CRUD | Implemented | `apps/web/src/server/routers/prebuilds.ts` | List/create/update/delete |
| Prebuild-repo associations | Implemented | `packages/db/src/schema/prebuilds.ts:prebuildRepos` | Many-to-many |
| Effective service commands | Implemented | `apps/web/src/server/routers/prebuilds.ts:getEffectiveServiceCommands` | Resolved config |
| Base snapshot builds | Implemented | `apps/worker/src/base-snapshots/index.ts` | Worker queue, deduplication |
| Repo snapshot builds | Implemented | `apps/worker/src/repo-snapshots/index.ts` | GitHub token hierarchy, commit tracking |
| Prebuild resolver | Implemented | `apps/gateway/src/lib/prebuild-resolver.ts` | Resolves config at session start |
| Service commands persistence | Implemented | `packages/db/src/schema/prebuilds.ts:serviceCommands` | JSONB on prebuilds |
| Env file persistence | Implemented | `packages/db/src/schema/prebuilds.ts:envFiles` | JSONB on prebuilds |
| Base snapshot status tracking | Implemented | `packages/db/src/schema/prebuilds.ts:sandboxBaseSnapshots` | Building/ready/failed |
| Repo snapshot status tracking | Implemented | `packages/db/src/schema/prebuilds.ts:repoSnapshots` | Building/ready/failed + commit SHA |

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
| Slack OAuth | Implemented | `apps/web/src/server/routers/integrations.ts:slackConnect/slackDisconnect` | Via Nango |
| Slack installations | Implemented | `packages/db/src/schema/slack.ts:slackInstallations` | Workspace-level |
| Slack conversations cache | Implemented | `packages/db/src/schema/slack.ts:slackConversations` | Channel cache |
| Nango callback handling | Implemented | `apps/web/src/server/routers/integrations.ts:callback` | OAuth callback |
| Integration disconnect | Implemented | `apps/web/src/server/routers/integrations.ts:disconnect` | Remove connection |
| Connection binding (repos) | Implemented | `packages/db/src/schema/repos.ts:repoConnections` | Repo-to-integration |
| Connection binding (automations) | Implemented | `packages/db/src/schema/automations.ts:automationConnections` | Automation-to-integration |
| Connection binding (sessions) | Implemented | `packages/db/src/schema/sessions.ts:sessionConnections` | Session-to-integration |
| Sentry metadata | Implemented | `apps/web/src/server/routers/integrations.ts:sentryMetadata` | Sentry project/org metadata |
| Linear metadata | Implemented | `apps/web/src/server/routers/integrations.ts:linearMetadata` | Linear team/project metadata |
| GitHub auth (gateway) | Implemented | `apps/gateway/src/lib/github-auth.ts` | Gateway-side GitHub token resolution |

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
| Credit gating | Partial | `packages/shared/src/billing/` | Gating logic exists but neither gateway HTTP nor oRPC session creation routes enforce it |
| Shadow balance | Implemented | `packages/services/src/billing/shadow-balance.ts` | Fast balance approximation |
| Org pause on zero balance | Implemented | `packages/services/src/billing/org-pause.ts` | Auto-pause all sessions |
| Trial credits | Implemented | `packages/services/src/billing/trial-activation.ts` | Auto-provision on signup |
| Billing reconciliation | Implemented | `packages/db/src/schema/billing.ts:billingReconciliations` | Manual adjustments with audit |
| Billing events | Implemented | `packages/db/src/schema/billing.ts:billingEvents` | Usage event log |
| LLM spend sync | Implemented | `packages/db/src/schema/billing.ts:llmSpendCursors` | Syncs spend from LiteLLM |
| Distributed locks (billing) | Implemented | `packages/shared/src/billing/` | Prevents concurrent billing ops |
| Billing worker | Implemented | `apps/worker/src/billing/worker.ts` | Interval-based reconciliation |
| Autumn integration | Implemented | `packages/shared/src/billing/` | External billing provider client |
| Overage policy (pause/allow) | Implemented | `packages/services/src/billing/org-pause.ts` | Configurable per-org |

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

# FILE: docs/specs/implementation-context.md

# Shared Implementation Context (Agent Briefing)

> **Purpose:** This file gives coding agents the shared product and architecture context for the current implementation program.  
> **How to use:** Read this file before starting any PR prompt in this program, then follow the PR-specific instructions.

## 1. Current Baseline

- Repository: `/Users/pablo/proliferate`
- Branch/state assumption: `main` (recently updated)
- Recent verified anchor commit in planning discussions: `cc1ce37`
- Existing system is **close to target** but has explicit remaining gaps listed below.

## 2. Product and Architecture Model

### 2.1 Core entities and runtime model

- **Repo**: Single repository record.
- **Prebuild/Configuration**: Effective configuration unit that can include one or multiple repos (via `prebuild_repos`).
- **Session**: Running instance of a configuration/prebuild.
- **Setup session**: Specialized session to prepare environment and produce reusable snapshot state.
- **Snapshots**:
	- Base snapshot layer
	- Repo snapshot layer (where applicable)
	- Prebuild/user snapshot layer

### 2.2 Runtime transport model

- Real-time coding stream path: Client `<->` Gateway `<->` Sandbox.
- API routes are lifecycle/control plane, not the real-time token streaming path.
- Devtools/sandbox utilities are proxied through Gateway to sandbox-side API/routes.

### 2.3 Actions model

- Agent invokes actions through `proliferate actions ...` commands.
- Gateway routes actions, enforces policy, and tracks invocations.
- Risk classes:
	- `read` auto-approved
	- `write` approval/policy gated
	- `danger` denied by default
- Intercepted tools remain for product-native capabilities.

### 2.4 Automation model

- Canonical path: trigger ingest -> outbox enqueue -> enrich -> execute -> completion/finalization -> artifact write.
- Finalizer/reconciler exists and is expected to self-heal stuck or stale runs.

## 3. What Is Already Done (Do Not Re-implement)

- Outbox atomic claim + stuck-row recovery hardening is already landed.
- Slack notification timeout + core error handling is already landed.
- Slack channel/installation wiring has recent fixes landed.
- Actions timeline/session panel and org-level actions inbox exist.
- `proliferate services *` exists and sandbox-mcp stdio mode retirement path is already in place.
- Terminal/VSCode/changes/services side panels and devtools proxy stack are already present.
- Session/snapshot layering and setup/finalize core flows are already present.

## 4. Remaining Program Gaps

1. Actions grants and richer policy controls:
	- reusable scoped grants
	- approval mode support (approve once vs approve with grant)
	- CLI grant commands
2. Actions guide/bootstrap:
	- provider guide assets
	- CLI guide command
	- session bootstrap discoverability
3. Provider expansion beyond Sentry/Linear.
4. Automation enrich worker:
	- replace placeholder with real enrichment output and selection support
5. Secrets UX parity:
	- named bundles/groups
	- `.env.local` bulk paste flow
	- explicit file path targeting and clean apply/scrub behavior
6. Git freshness parity:
	- extend restore freshness behavior to E2B
	- configurable cadence to avoid over-pulling

## 5. Constraints and Coding Rules

- Work in existing patterns and architecture; avoid introducing competing abstractions.
- Keep behavior backward compatible unless PR explicitly changes contract.
- Keep route/service/DB layering consistent with repo conventions:
	- DB access in services package DB modules
	- route handlers remain thin where possible
- Maintain deterministic error handling and timeout behavior for external calls.
- Preserve authz boundaries (especially for approvals/admin-only actions).
- Avoid silent behavior changes in policy, billing-affecting flows, and lifecycle states.

## 6. Validation Expectations for Every PR

Each PR in this program should:

1. Add or update focused tests for new behavior.
2. Run relevant test suites for touched apps/packages.
3. Run typecheck for touched scopes.
4. Summarize:
	- what changed
	- what is backward compatible vs changed
	- residual risks/follow-ups

## 7. Program PR IDs (Reference Map)

- Track A (Actions): `A1`, `A2`, `A3`, `A4`, `A5x`
- Track B (Automation): `B1`, `B2`, `B3`
- Track C (Secrets/Runtime): `C1`, `C2`, `C3`, `C4`
- Final hardening: `Z1`

## 8. Start-of-PR Checklist for Agents

Before coding:

1. Read this file completely.
2. Read only the files directly relevant to the assigned PR.
3. Identify existing tests nearest to changed behavior.
4. Implement minimally and incrementally.
5. Validate and report exactly what was run.


---

# FILE: docs/specs/integrations.md

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

### Out of Scope
- What repos/automations/sessions **do** with connections at runtime — see `repos-prebuilds.md`, `automations-runs.md`, `sessions-gateway.md`
- Slack async client and message handling — see `automations-runs.md`
- Action adapters for Linear/Sentry — see `actions.md`
- Trigger providers for GitHub/Linear/Sentry — see `triggers.md`
- GitHub App webhook dispatch to triggers — see `triggers.md`

### Mental Model

Integrations is the OAuth credential store. Every external service Proliferate connects to — GitHub, Sentry, Linear, Slack — follows the same pattern: the user initiates an OAuth flow, credentials are stored (either in Nango or directly in the DB for Slack), and a record in the `integrations` or `slack_installations` table links the credential to an organization. Downstream consumers (sessions, automations, triggers, actions) bind to these records via junction tables and resolve live OAuth tokens at runtime through the token resolution layer.

**Core entities:**
- **Integration** — A stored OAuth connection scoped to an organization. Provider is either `nango` (Sentry/Linear/GitHub-via-Nango) or `github-app` (GitHub App installation). Lifecycle: `active` → `expired`/`revoked`/`deleted`/`suspended`.
- **Slack Installation** — A workspace-level Slack bot installation, stored separately from `integrations` because Slack uses its own OAuth flow with encrypted bot tokens. Lifecycle: `active` → `revoked`.
- **Connection binding** — A junction row linking an integration to a repo, automation, or session. Cascades on delete.

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

apps/web/src/server/routers/
└── integrations.ts              # oRPC router (all integration endpoints)

apps/web/src/app/api/integrations/
├── github/callback/route.ts     # GitHub App installation callback
├── slack/oauth/route.ts         # Slack OAuth initiation (redirect)
└── slack/oauth/callback/route.ts # Slack OAuth callback (token exchange)

apps/web/src/app/api/webhooks/
└── github-app/route.ts          # GitHub App webhook handler (lifecycle events)

apps/gateway/src/lib/
└── github-auth.ts               # Gateway-side GitHub token resolution
```

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


---

# FILE: docs/specs/llm-proxy.md

# LLM Proxy — System Spec

## 1. Scope & Purpose

### In Scope
- Virtual key generation: per-session, per-org temporary keys via LiteLLM admin API
- Key scoping model: team = org, user = session for cost isolation
- Key duration and lifecycle
- LiteLLM API integration contract (endpoints called, auth model)
- Spend tracking via LiteLLM's `LiteLLM_SpendLogs` table
- LLM spend cursors (DB sync state for billing reconciliation)
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
| Spend sync (cursor-based) | Implemented | `apps/worker/src/billing/worker.ts:syncLLMSpend` |
| LLM spend cursors (DB) | Implemented | `packages/db/src/schema/billing.ts:llmSpendCursors` |
| Model routing config | Implemented | `apps/llm-proxy/litellm/config.yaml` |
| Key revocation on session end | Planned | No code — see §9 |

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
- **LLM spend cursor** — a single-row DB table tracking the sync position when reading spend logs from LiteLLM's `LiteLLM_SpendLogs` table.

**Key invariants:**
- Virtual keys are always scoped: `team_id = orgId`, `user_id = sessionId`.
- When `LLM_PROXY_URL` is not set, sandboxes fall back to a direct `ANTHROPIC_API_KEY` (no proxy, no spend tracking).
- When `LLM_PROXY_REQUIRED=true` and `LLM_PROXY_URL` is unset, session creation fails hard.
- The spend sync is eventually consistent — logs appear in LiteLLM's table and are polled every 30 seconds by the billing worker.

---

## 2. Core Concepts

### LiteLLM Virtual Keys
LiteLLM's virtual key system (free tier) generates temporary API keys that the proxy validates on each request. Each key carries `team_id` and `user_id` metadata, which LiteLLM uses to attribute spend in its `LiteLLM_SpendLogs` table.
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
LiteLLM writes spend data to its own `LiteLLM_SpendLogs` table in a shared PostgreSQL database. Our billing worker reads from this table using cursor-based pagination and converts spend logs into billing events. The two systems share a database but use different schemas.
- Key detail agents get wrong: we read from LiteLLM's schema (`litellm.LiteLLM_SpendLogs` by default) via raw SQL, not via Drizzle ORM. The schema name is configurable via `LITELLM_DB_SCHEMA`.
- Reference: `packages/services/src/billing/db.ts:LITELLM_SPEND_LOGS_REF`

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
    └── db.ts                           # LLM spend cursor CRUD, raw SQL reads from LiteLLM_SpendLogs

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
llm_spend_cursors
├── id              TEXT PRIMARY KEY DEFAULT 'global'  -- singleton row
├── last_start_time TIMESTAMPTZ NOT NULL               -- cursor position in LiteLLM_SpendLogs
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

// packages/services/src/billing/db.ts
interface LLMSpendLog {
  request_id: string;
  team_id: string | null;  // our orgId
  user: string | null;     // our sessionId
  spend: number;           // cost in USD
  model: string;
  model_group: string | null;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  startTime?: Date | string;
}

interface LLMSpendCursor {
  lastStartTime: Date;
  lastRequestId: string | null;
  recordsProcessed: number;
  syncedAt: Date;
}
```

### Key Indexes & Query Patterns
- `llm_spend_cursors` has no additional indexes — single-row table queried by `WHERE id = 'global'`.
- `LiteLLM_SpendLogs` (external, LiteLLM-managed) is queried with `ORDER BY "startTime" ASC, request_id ASC` for deterministic cursor pagination. Index coverage depends on LiteLLM's schema — not under our control.

---

## 5. Conventions & Patterns

### Do
- Always call `ensureTeamExists(orgId)` before generating a virtual key — `generateSessionAPIKey` does this automatically (`packages/shared/src/llm-proxy.ts:generateSessionAPIKey`)
- Use `buildSandboxEnvVars()` from `packages/services/src/sessions/sandbox-env.ts` to generate all sandbox env vars, including the virtual key — it handles the proxy/direct key decision centrally
- Strip trailing slashes and `/v1` before appending paths to admin URLs — `generateVirtualKey` does this (`adminUrl` normalization at line 69)

### Don't
- Don't pass `LLM_PROXY_MASTER_KEY` to sandboxes — only virtual keys go to sandboxes
- Don't read `LiteLLM_SpendLogs` via Drizzle ORM — the table is managed by LiteLLM, use raw SQL via `packages/services/src/billing/db.ts`
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
- Spend sync uses cursor-based pagination with deterministic ordering (`startTime ASC, request_id ASC`) to avoid duplicates (`packages/services/src/billing/db.ts:getLLMSpendLogsByCursor`)
- Lookback sweep catches late-arriving logs; idempotency keys prevent double-billing (`apps/worker/src/billing/worker.ts:syncLLMSpend`)

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
4. Then calls `generateVirtualKey(sessionId, orgId)` — `POST /key/generate` with `team_id=orgId`, `user_id=sessionId`, `duration` from env (`packages/shared/src/llm-proxy.ts:generateVirtualKey`)
5. Returns the `key` string. The caller stores it as `envVars.LLM_PROXY_API_KEY`

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

**What it does:** Periodically reads LLM spend logs from LiteLLM's database and converts them into billing events for Proliferate's billing system.

**Happy path:**
1. Billing worker calls `syncLLMSpend()` every 30 seconds, guarded by `NEXT_PUBLIC_BILLING_ENABLED` (`apps/worker/src/billing/worker.ts`)
2. Reads current cursor from `llm_spend_cursors` table — `getLLMSpendCursor()` (`packages/services/src/billing/db.ts`)
3. Queries `litellm.LiteLLM_SpendLogs` via raw SQL, ordered by `startTime ASC, request_id ASC`, batched at `llmSyncBatchSize` (`packages/services/src/billing/db.ts:getLLMSpendLogsByCursor`)
4. For each log with a valid `team_id` and positive `spend`, calls `billing.deductShadowBalance()` with `eventType: "llm"` and `idempotencyKey: "llm:{request_id}"` — this atomically deducts credits and creates a billing event (see `billing-metering.md` for shadow balance details)
5. Updates cursor position after each batch (`packages/services/src/billing/db.ts:updateLLMSpendCursor`)
6. After cursor-based sweep, runs a lookback sweep for late-arriving logs (`getLLMSpendLogsLookback`)

**Edge cases:**
- First run (no cursor) with `LLM_SYNC_BOOTSTRAP_MODE=full` → seeds cursor from earliest log in `LiteLLM_SpendLogs`
- First run with `LLM_SYNC_BOOTSTRAP_MODE=recent` (default) → starts from 5-minute lookback window
- Duplicate logs → `deductShadowBalance` uses unique `idempotencyKey` (`llm:{request_id}`), duplicates are silently skipped
- Max batches exceeded → logs warning but does not fail; remaining logs are picked up next cycle

**Files touched:** `apps/worker/src/billing/worker.ts:syncLLMSpend`, `packages/services/src/billing/db.ts`

**Status:** Implemented

### 6.4 Environment Configuration

**What it does:** Six env vars control the LLM proxy integration.

| Env Var | Required | Default | Purpose |
|---------|----------|---------|---------|
| `LLM_PROXY_URL` | No | — | Base URL of the LiteLLM proxy. When set, enables proxy mode. |
| `LLM_PROXY_ADMIN_URL` | No | `LLM_PROXY_URL` | Separate admin URL for key/team management. Falls back to `LLM_PROXY_URL`. |
| `LLM_PROXY_PUBLIC_URL` | No | `LLM_PROXY_URL` | Public-facing URL that sandboxes use. Falls back to `LLM_PROXY_URL`. |
| `LLM_PROXY_MASTER_KEY` | When proxy is enabled | — | Master key for LiteLLM admin API (key generation, team management). |
| `LLM_PROXY_KEY_DURATION` | No | `"24h"` | Default virtual key validity duration. Supports LiteLLM duration strings. |
| `LLM_PROXY_REQUIRED` | No | `false` | When `true`, session creation fails if proxy is not configured. |

Additional env vars used by the spend sync (read via raw `process.env`, not in the typed schema):
- `LITELLM_DB_SCHEMA` — PostgreSQL schema containing `LiteLLM_SpendLogs` (default: `"litellm"`) (`packages/services/src/billing/db.ts`)
- `LLM_SYNC_BOOTSTRAP_MODE` — `"recent"` (default) or `"full"` for first-run backfill behavior (`apps/worker/src/billing/worker.ts`)
- `LLM_SYNC_MAX_BATCHES` — max batches per sync cycle (default: 100, or 20 on bootstrap) (`apps/worker/src/billing/worker.ts`)

**Files touched:** `packages/environment/src/schema.ts` (LLM_PROXY_* vars), `packages/shared/src/llm-proxy.ts`, `packages/services/src/billing/db.ts`, `apps/worker/src/billing/worker.ts`

**Status:** Implemented

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| Sandbox Providers | Providers → This | `getLLMProxyBaseURL()`, reads `envVars.LLM_PROXY_API_KEY` | Both Modal and E2B inject the virtual key and base URL at sandbox boot. See `sandbox-providers.md` §6. |
| Sessions | Sessions → This | `buildSandboxEnvVars()` → `generateSessionAPIKey()` | Session creation triggers key generation. See `sessions-gateway.md` §6. |
| Billing & Metering | Billing → This | `syncLLMSpend()` reads `LiteLLM_SpendLogs`, writes `billing_events` | Billing worker polls spend data. Charging policy owned by `billing-metering.md`. |
| Environment | This → Environment | `env.LLM_PROXY_*` | Typed `LLM_PROXY_*` vars read from env schema (`packages/environment/src/schema.ts`). Sync tuning vars (`LITELLM_DB_SCHEMA`, `LLM_SYNC_*`) are raw `process.env` reads — see §6.4. |

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

- [ ] **No key revocation on session end** — virtual keys remain valid until their duration expires, even after a session is terminated. Impact: minimal (keys are short-lived and sandboxes are destroyed), but a revocation call on session delete would be cleaner. Expected fix: call `POST /key/delete` on session terminate.
- [ ] **Shared database coupling** — the spend sync reads directly from LiteLLM's PostgreSQL schema, coupling our billing worker to LiteLLM's internal table format. Impact: LiteLLM schema changes could break the sync. Expected fix: use LiteLLM's HTTP spend API instead of raw SQL if one becomes available.
- [ ] **Single global cursor** — the `llm_spend_cursors` table uses a singleton row (`id = 'global'`). This means only one billing worker instance can sync spend logs at a time. Impact: acceptable at current scale. Expected fix: per-org cursors or distributed lock if needed.
- [ ] **No budget enforcement on virtual keys** — `maxBudget` is passed through to LiteLLM but not actively used in session creation. Budget enforcement is handled by Proliferate's billing system, not the proxy. Impact: none currently, as billing gating is separate.


---

# FILE: docs/specs/repos-prebuilds.md

# Repos & Prebuilds — System Spec

## 1. Scope & Purpose

### In Scope
- Repo CRUD, search (public GitHub), and available repos (via integration)
- Repo connections (binding repos to GitHub integrations)
- Prebuild CRUD (manual, managed, and CLI types)
- Prebuild-repo associations (many-to-many via `prebuild_repos`)
- Effective service commands resolution (prebuild overrides > repo defaults)
- Base snapshot build worker (queue, deduplication, status tracking)
- Repo snapshot build worker (GitHub token hierarchy, commit tracking)
- Prebuild resolver (resolves prebuild at session start)
- Service commands persistence (JSONB on both repos and prebuilds)
- Env file persistence (JSONB on prebuilds)
- Base snapshot status tracking (building/ready/failed)
- Repo snapshot status tracking (building/ready/failed + commit SHA, inline on repos table)
- Setup session finalization (snapshot capture + prebuild creation/update)

### Out of Scope
- Snapshot resolution logic (which layer to use at boot) — see `sandbox-providers.md` §6.5
- Session creation that uses prebuilds — see `sessions-gateway.md` §6.1
- Secret values, bundles, and encryption — see `secrets-environment.md`
- Integration OAuth lifecycle — see `integrations.md`
- Sandbox boot sequence that consumes service commands/env files — see `sandbox-providers.md` §6.4

### Mental Model

**Repos** are org-scoped references to GitHub repositories (or local directories for CLI). They carry metadata (URL, default branch, detected stack) and optional repo-level service commands. Each repo can be linked to one or more GitHub integrations via **repo connections**, which provide the authentication tokens needed for private repo access.

**Prebuilds** group one or more repos (via `prebuild_repos` junction), carry a snapshot ID (saved filesystem state), and store per-prebuild service commands and env file specs. There are three prebuild types: `manual` (user-created), `managed` (auto-created for Slack/universal clients), and CLI (device-scoped via `localPathHash`).

**Snapshots** are pre-built filesystem states at three layers: base (OpenCode + services, no repo), repo (base + cloned repo), and prebuild/session (full working state). This spec owns the *build* side — the workers that create base and repo snapshots. The *resolution* side (picking which layer to use) belongs to `sandbox-providers.md`.

**Core entities:**
- **Repo** — an org-scoped GitHub repository reference. Lifecycle: create → configure → delete.
- **Prebuild** — a reusable snapshot + metadata record linking one or more repos. Lifecycle: building → ready/failed.
- **Base snapshot** — a pre-baked sandbox state with OpenCode + services installed, no repo (Layer 1). Built by the base snapshot worker, tracked in `sandbox_base_snapshots`.
- **Repo snapshot** — a base snapshot + cloned repo (Layer 2). Built by the repo snapshot worker, tracked inline on the `repos` table.

**Key invariants:**
- On the happy path, a prebuild has at least one repo via `prebuild_repos`. Exceptions: CLI prebuild creation treats the repo link as non-fatal (`prebuild-resolver.ts:272`) — a prebuild can briefly exist without `prebuild_repos` if the upsert fails. Setup finalization derives `workspacePath` from `githubRepoName` (e.g., `"org/app"` → `"app"`), not `"."` (`repos-finalize.ts:163`). The standard service path (`createPrebuild`) uses `"."` for single-repo and repo name for multi-repo.
- Base snapshot deduplication is keyed on `(versionKey, provider, modalAppName)`. Only one build runs per combination.
- Repo snapshot builds are Modal-only. E2B sessions skip this layer (see `sandbox-providers.md` §6.5).
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
A SHA-256 hash of `PLUGIN_MJS` + `DEFAULT_CADDYFILE` + `getOpencodeConfig(defaultModelId)`. When this changes, the base snapshot is stale and must be rebuilt. Computed by `computeBaseSnapshotVersionKey()`.
- Key detail agents get wrong: The version key is computed from source code constants, not runtime config. Changing `PLUGIN_MJS` or the Caddyfile template triggers a rebuild.
- Reference: `packages/shared/src/sandbox/version-key.ts`

### GitHub Token Hierarchy
Repo snapshot builds resolve GitHub tokens with a two-level hierarchy: (1) repo-linked integration connections (prefer GitHub App installation, fall back to Nango OAuth), (2) org-wide GitHub integration. Private repos without a token skip the build.
- Key detail agents get wrong: The token resolution in the repo snapshot worker is independent from the session-time token resolution in the gateway. They follow the same hierarchy but are separate code paths.
- Reference: `apps/worker/src/repo-snapshots/index.ts:resolveGitHubToken`

---

## 3. File Tree

```
apps/web/src/server/routers/
├── repos.ts                         # Repo oRPC routes (list/get/create/delete/search/available/finalize)
├── repos-finalize.ts                # Setup session finalization (snapshot + prebuild create/update)
└── prebuilds.ts                     # Prebuild oRPC routes (list/create/update/delete/service-commands)

apps/worker/src/
├── base-snapshots/
│   └── index.ts                     # Base snapshot build worker + startup enqueue
└── repo-snapshots/
    └── index.ts                     # Repo snapshot build worker + GitHub token resolution

apps/gateway/src/lib/
└── prebuild-resolver.ts             # Prebuild resolution for session creation (direct/managed/CLI)

packages/services/src/
├── repos/
│   ├── db.ts                        # Repo DB operations (CRUD, snapshot status, service commands)
│   ├── mapper.ts                    # DB row → API type conversion
│   └── service.ts                   # Repo business logic (create with snapshot build, service commands)
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
└── index.ts                         # BullMQ queue/worker factories for base + repo snapshot builds
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

interface RepoSnapshotBuildJob {
  repoId: string;
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
- **Repo snapshot builds**: 3 attempts, exponential backoff (5s initial). Concurrency: 2. Timestamp-based job IDs prevent failed jobs from blocking future rebuilds.
- **Idempotency**: `markRepoSnapshotBuilding()` won't overwrite a `"ready"` status. `updateSnapshotIdIfNull()` only sets snapshot ID if currently null.

### Testing Conventions
- No dedicated tests exist for repos, prebuilds, or snapshot build services/workers today. Coverage comes indirectly from route-level and integration tests.
- `prebuildBelongsToOrg()` and `getEffectiveServiceCommands()` are pure query logic — good candidates for unit tests with DB fixtures.
- Snapshot build workers would require Modal credentials for integration testing.

---

## 6. Subsystem Deep Dives

### 6.1 Repo CRUD — `Implemented`

**What it does:** Manages org-scoped GitHub repository references.

**Happy path (create)** (`packages/services/src/repos/service.ts:createRepo`):
1. Check if repo exists by `(organizationId, githubRepoId)`.
2. If exists: link integration (if provided), un-orphan if needed, return existing.
3. If new: generate UUID, insert record, fire-and-forget `requestRepoSnapshotBuild()`, link integration.

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

### 6.6 Repo Snapshot Build Worker — `Implemented`

**What it does:** Builds repo snapshots (Layer 2) — base snapshot + cloned repo — for near-zero latency session starts.

**Happy path** (`apps/worker/src/repo-snapshots/index.ts`):
1. Load repo info via `repos.getRepoSnapshotBuildInfo(repoId)`.
2. Skip if: not GitHub source, no URL, or already ready (unless `force`).
3. Mark `"building"` via `repos.markRepoSnapshotBuilding(repoId)`.
4. Resolve GitHub token (see §2: GitHub Token Hierarchy).
5. Call `ModalLibmodalProvider.createRepoSnapshot({ repoId, repoUrl, token, branch })`.
6. On success: `repos.markRepoSnapshotReady({ repoId, snapshotId, commitSha })`.
7. On failure: `repos.markRepoSnapshotFailed({ repoId, error })` + rethrow for retry.

**Trigger:** Automatically enqueued on repo creation via `requestRepoSnapshotBuild()` (fire-and-forget). Uses timestamp-based job IDs to avoid stale deduplication.

**Modal-only:** Checks `env.MODAL_APP_NAME` — returns early if not configured.

**Files touched:** `apps/worker/src/repo-snapshots/index.ts`, `packages/services/src/repos/service.ts:requestRepoSnapshotBuild`

### 6.7 Prebuild Resolver — `Implemented`

**What it does:** Resolves a prebuild record for session creation. Owned by the gateway; documented here because it creates prebuild and repo records via this spec's services.

The resolver supports three modes (direct ID, managed, CLI) and returns a `ResolvedPrebuild { id, snapshotId, repoIds, isNew }`. For the full resolution flow and how it fits into session creation, see `sessions-gateway.md` §6.1.

**This spec's role:** The resolver calls `prebuilds.findById()`, `prebuilds.createManagedPrebuild()`, `prebuilds.createPrebuildRepos()`, and `cli.createCliPrebuildPending()` from the services layer to create/query prebuild records. The managed path derives workspace paths using the same single-repo `"."` / multi-repo repo-name convention as `createPrebuild()`.

**Files touched:** `apps/gateway/src/lib/prebuild-resolver.ts`

### 6.8 Setup Session Finalization — `Implemented`

**What it does:** Captures a sandbox snapshot from a setup session and creates/updates a prebuild record.

**Happy path** (`apps/web/src/server/routers/repos-finalize.ts:finalizeSetupHandler`):
1. Verify session exists and belongs to the repo (via `repoId` or `prebuild_repos`).
2. Verify session type is `"setup"` and has a sandbox.
3. Take filesystem snapshot via provider (`provider.snapshot(sessionId, sandboxId)`).
4. Store any provided secrets (encryption details — see `secrets-environment.md`).
5. If existing prebuild: update with new `snapshotId` + `status: "ready"`.
6. If no prebuild: create new prebuild record, link repo via `prebuild_repos` (workspace path derived from `githubRepoName`), update session's `prebuildId`.
7. Optionally terminate sandbox and stop session (lifecycle details — see `sessions-gateway.md`).

**Files touched:** `apps/web/src/server/routers/repos-finalize.ts`

### 6.9 Env File Persistence — `Implemented`

**What it does:** Stores env file generation specs as JSONB on the prebuild record.

**Mechanism:** `prebuilds.env_files` stores a JSON spec describing which env files to generate and their template variables. Updated via `updatePrebuildEnvFiles()` with `updatedBy` + `updatedAt` tracking. At sandbox boot, the provider passes env files to `proliferate env apply` inside the sandbox (see `sandbox-providers.md` §6.4).

**Files touched:** `packages/services/src/prebuilds/db.ts:updatePrebuildEnvFiles`, `packages/db/src/schema/prebuilds.ts`

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `sessions-gateway.md` | Gateway → This | `resolvePrebuild()` → `prebuilds.*`, `cli.*` | Session creation calls resolver which creates/queries prebuild records via this spec's services. Resolver logic owned by `sessions-gateway.md` §6.1. |
| `sessions-gateway.md` | Gateway → This | `prebuilds.getPrebuildReposWithDetails()` | Session store loads repo details for sandbox provisioning |
| `sandbox-providers.md` | Worker → Provider | `ModalLibmodalProvider.createBaseSnapshot()`, `.createRepoSnapshot()` | Snapshot workers call Modal provider directly |
| `sandbox-providers.md` | Provider ← This | `resolveSnapshotId()` consumes repo snapshot status | Snapshot resolution reads `repoSnapshotId` from repo record |
| `integrations.md` | This → Integrations | `integrations.getRepoConnectionsWithIntegrations()` | Token resolution for repo snapshot builds |
| `secrets-environment.md` | Finalize → Secrets | `secrets.upsertSecretByRepoAndKey()` | Setup finalization stores encrypted secrets |
| `agent-contract.md` | Agent → This | `save_service_commands` tool | Agent persists service commands via gateway → services |

### Security & Auth
- All oRPC routes require org membership via `orgProcedure` middleware.
- Prebuild authorization uses `prebuildBelongsToOrg()` — traverses `prebuild_repos → repos → organizationId`.
- GitHub search API calls use `User-Agent: Proliferate-App` header but no auth token (public repos only).
- Setup finalization delegates secret storage to `secrets-environment.md` (encryption handled there).

### Observability
- Structured logging via `@proliferate/logger` in workers (`module: "base-snapshots"`, `module: "repo-snapshots"`).
- Prebuilds router uses `logger.child({ handler: "prebuilds" })`.
- Key log events: build start, build complete (with `snapshotId`), build failure (with error), deduplication skips.

---

## 8. Acceptance Gates

- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] Worker tests pass (`pnpm -C apps/worker test`)
- [ ] This spec is updated (file tree, data models, deep dives)

---

## 9. Known Limitations & Tech Debt

- [ ] **Repo snapshots are Modal-only** — E2B sessions cannot use Layer 2 snapshots. `requestRepoSnapshotBuild()` returns early if `MODAL_APP_NAME` is unset. Impact: E2B sessions always do a live clone. Expected fix: implement E2B template-based repo snapshots.
- [ ] **Repo snapshot status is inline on repos table** — Unlike base snapshots (separate table), repo snapshot tracking lives as columns on the `repos` table (`repo_snapshot_id`, `repo_snapshot_status`, etc.). Impact: only one snapshot per repo per provider. Expected fix: separate `repo_snapshots` table if multi-provider or multi-branch snapshots are needed.
- [ ] **Managed prebuild lookup scans all managed prebuilds** — `findManagedPrebuilds()` loads all `type = "managed"` prebuilds, then filters by org in-memory. Impact: grows linearly with managed prebuild count. Expected fix: add org-scoped query with DB-level filter.
- [ ] **Setup finalization lives in the router** — `repos-finalize.ts` contains complex orchestration (snapshot + secrets + prebuild creation) that should be in the services layer. Impact: harder to reuse from non-web contexts. Marked with a TODO in code.
- [ ] **GitHub search uses unauthenticated API** — `repos.search` calls GitHub API without auth, subject to lower rate limits (60 req/hour per IP). Impact: may fail under heavy usage. Expected fix: use org's GitHub integration token for authenticated search.
- [ ] **No webhook-driven repo snapshot rebuilds** — Repo snapshots are only built on repo creation. Subsequent pushes to `defaultBranch` don't trigger rebuilds. Impact: repo snapshots become stale over time; git freshness pull compensates at session start. Expected fix: trigger rebuilds from GitHub push webhooks.


---

# FILE: docs/specs/sandbox-providers.md

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
The common contract for all providers. Defines required methods (`ensureSandbox`, `createSandbox`, `snapshot`, `pause`, `terminate`, `writeEnvFile`, `health`) and optional methods (`checkSandboxes`, `resolveTunnels`, `readFiles`, `createTerminalSandbox`, `testServiceCommands`, `execCommand`).
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
1. Clone repos (or read metadata from snapshot) — `setupSandbox()`.
2. Write config files in parallel: plugin, 6 tool pairs (.ts + .txt), OpenCode config (global + local), instructions.md, actions-guide.md, pre-installed tool deps.
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


---

# FILE: docs/specs/secrets-environment.md

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

**oRPC path** (`apps/web/src/server/routers/sessions.ts`):
- `create` → calls `createSessionHandler()` (`sessions-create.ts`) which writes a DB record only. This is a **separate, lighter pipeline** than the gateway HTTP route — no idempotency, no session connections, no sandbox provisioning.
- `pause` → loads session, calls `provider.snapshot()` + `provider.terminate()`, finalizes billing, updates DB status to `"paused"` (`sessions-pause.ts`).
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


---

# FILE: docs/specs/template.md

# [Subsystem Name] — System Spec

## 1. Scope & Purpose

### In Scope
- [What this subsystem owns]
- [Boundaries it enforces]

### Out of Scope
- [Adjacent systems this does NOT own — helps agents know when to stop]

### Mental Model

_1-4 paragraphs: why this exists, how to reason about it, the core abstraction._

**Core entities:**
- **[Entity A]** — _what it represents, who owns its lifecycle_
- **[Entity B]** — _how it relates to Entity A_

**Key invariants:**
- _Rules that must always hold_
- _Consistency/ordering guarantees_
- _Performance budgets if relevant_

---

## 2. Core Concepts

_Technical concepts, technologies, and architectural patterns required to work in this subsystem. Agents should understand these before modifying any code here._

### [Concept Name]
_2-3 sentence explanation of what it is and why it matters to this subsystem._
- Key detail agents get wrong: _[common misconception or subtle gotcha]_
- Reference: _[link to external docs, internal doc, or canonical resource]_

### [Concept Name]
_..._
- Key detail agents get wrong: _[...]_
- Reference: _[...]_

---

## 3. File Tree

_Annotated map of every file in this subsystem. Update when adding/removing files._

```
src/[subsystem]/
├── index.ts                  # [What this file does]
├── [main-service].ts         # [What this file does]
├── types.ts                  # [What this file does]
├── errors.ts                 # [What this file does]
└── __tests__/
    └── [test files]
```

---

## 4. Data Models & Schemas

_Database tables, TypeScript types, and their relationships._

### Database Tables

```sql
[table_name]
├── id              UUID PRIMARY KEY
├── [field]         [TYPE] [CONSTRAINTS]  -- [notes]
├── created_at      TIMESTAMPTZ
└── updated_at      TIMESTAMPTZ
```

### Core TypeScript Types

```typescript
// [filename] — [what these represent]
interface [MainEntity] {
  id: string;
  // ...
}

type [EntityType] = 'option_a' | 'option_b';
```

### Key Indexes & Query Patterns
- _[Query shape]_ uses _[index]_ — target: _[latency budget]_

---

## 5. Conventions & Patterns

_Prescriptive rules for writing code in this subsystem. Agents MUST follow these._

### Do
- _[Pattern]_ — _why_
- _[Pattern]_ — _why_

### Don't
- _[Anti-pattern]_ — _what to do instead_
- _[Anti-pattern]_ — _what to do instead_

### Error Handling

```typescript
// Show the concrete pattern used in this subsystem
```

### Reliability
- Timeouts: _[values]_
- Retries/backoff: _[policy]_
- Idempotency: _[where/how, if applicable]_

### Testing Conventions
- _How to set up fixtures_
- _What to mock_
- _What must be covered_

---

## 6. Subsystem Deep Dives

_Detailed walkthrough of each major capability._

### 6.1 [Capability Name]

**What it does:** _1-2 sentences._

**Happy path:**
1. _Which file/function is called, what it does, what it calls next_
2. _..._

**Edge cases:**
- _[Scenario]_ → _[How it's handled]_

**Files touched:** _[list]_

### 6.2 [Capability Name]

_... repeat ..._

---

## 7. Cross-Cutting Concerns

_How this subsystem interacts with other subsystems and shared infrastructure._

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| [Other subsystem] | This → Other | `function()` | _When/why_ |
| [Other subsystem] | Other → This | `function()` | _When/why_ |

### Security & Auth
- _AuthN model for this subsystem_
- _AuthZ checks / permission model_
- _Sensitive data handling (redaction, encryption)_

### Observability
- _Required log fields_
- _Key metrics / alerts_

---

## 8. Acceptance Gates

_Checklist before any PR touching this subsystem is merged._

- [ ] Typecheck passes
- [ ] Relevant tests pass
- [ ] This spec is updated (file tree, data models, deep dives)

---

## 9. Known Limitations & Tech Debt

_Be aware of these but do NOT fix unless explicitly asked._

- [ ] _[Limitation]_ — _impact_ — _expected fix direction_
- [ ] _[Limitation]_ — _impact_ — _expected fix direction_

---

# FILE: docs/specs/triggers.md

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
├── triggers.ts                       # Trigger CRUD oRPC routes
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


---

