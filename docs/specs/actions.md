# Actions — System Spec

## 1. Scope & Purpose

### In Scope
- Action invocation lifecycle: pending → approved/denied → expired
- Risk classification: read / write / danger
- Grant system: create, evaluate, revoke, call budgets
- Gateway action routes (invoke, approve, deny, list, grants, guide)
- Provider guide/bootstrap flow
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

Actions are platform-mediated operations that the agent performs on external services (Linear, Sentry). Unlike tools that run inside the sandbox, actions are executed server-side by the gateway using OAuth tokens resolved from Nango connections. Every action goes through a risk-based approval pipeline before execution.

The agent invokes actions via the `proliferate` CLI inside the sandbox. The CLI sends HTTP requests to the gateway, which evaluates risk, checks for matching grants, and either auto-executes or queues the invocation for human approval. Users approve or deny pending invocations through the web dashboard or WebSocket events.

**Core entities:**
- **Invocation** — a single request to execute an action, with its approval state. Lifecycle: pending → approved → executing → completed (or denied/expired/failed).
- **Grant** — a reusable permission allowing the agent to perform a specific action without per-invocation approval. Scoped to session or org, with optional call budgets.
- **Adapter** — an integration-specific module that declares available actions and implements execution against the external API.

**Key invariants:**
- Read actions are always auto-approved. Danger actions are always denied. Only write actions enter the approval pipeline.
- Grants are evaluated atomically via CAS (compare-and-swap) to prevent concurrent overuse of call budgets.
- A session can have at most 10 pending invocations simultaneously.
- Pending invocations expire after 5 minutes if not approved or denied.
- Results stored in the DB are redacted (sensitive keys removed) and truncated (max 10KB).

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
├── created_by        TEXT NOT NULL FK → user(id) ON DELETE CASCADE
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
- **Invocation expiry**: 5-minute TTL on pending invocations (`PENDING_EXPIRY_MS`). Source: `packages/services/src/actions/service.ts:45`
- **Pending cap**: Max 10 pending invocations per session (`MAX_PENDING_PER_SESSION`). Source: `service.ts:46`
- **Rate limiting**: 60 invocations per minute per session (in-memory counter in gateway). Source: `apps/gateway/src/api/proliferate/http/actions.ts`
- **Grant CAS**: Atomic `UPDATE ... WHERE usedCalls < maxCalls` prevents budget overuse. Source: `grants-db.ts:consumeGrantCall`
- **Grant rollback**: If invocation approval fails after grant creation, the grant is revoked (best-effort). Source: `service.ts:approveActionWithGrant`
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

**Happy path (write action, no grant):**
1. Agent calls `proliferate actions run --integration linear --action create_issue --params '{...}'`
2. Sandbox-MCP CLI sends `POST /:sessionId/actions/invoke` to gateway (`actions.ts`)
3. Gateway validates adapter exists, finds session connections, resolves org
4. Calls `actions.invokeAction()` (`service.ts:122`) — risk = write, no matching grant → creates pending invocation with 5-min expiry
5. Gateway broadcasts `action_approval_request` to WebSocket clients
6. Returns `202 { invocation, needsApproval: true }` — sandbox CLI blocks polling `GET /invocations/:id`
7. User approves via `POST /invocations/:id/approve` (admin/owner role required)
8. Gateway calls `actions.approveAction()`, then `markExecuting()`, resolves integration token via `integrations.getToken()`, calls `adapter.execute()`
9. On success: `markCompleted()` with redacted/truncated result, broadcasts `action_completed`
10. On failure: `markFailed()` with error message, broadcasts failure, returns 502

**Edge cases:**
- **Read action** → auto-approved at step 4, executed immediately, returns 200
- **Danger action** → denied at step 4, returns 403
- **Grant match** → auto-approved at step 4 after CAS consumption, executed immediately
- **Pending cap exceeded** → throws `PendingLimitError` (429) at step 4
- **Expired before approval** → `approveAction()` marks expired, throws `ActionExpiredError` (410)
- **Already approved/denied** → throws `ActionConflictError` (409)

**Files touched:** `packages/services/src/actions/service.ts`, `apps/gateway/src/api/proliferate/http/actions.ts`

### 6.2 Grant System — `Implemented`

**What it does:** Provides reusable permissions that auto-approve write actions without per-invocation human approval.

**Grant creation paths:**
1. **Via approval**: User approves an invocation with `mode: "grant"` — creates a grant scoped to the invocation's integration/action. Source: `service.ts:approveActionWithGrant`
2. **Via sandbox CLI**: Agent calls `POST /:sessionId/actions/grants` — creates a grant directly. Source: `actions.ts` grants POST route

**Grant evaluation flow:**
1. `invokeAction()` calls `evaluateGrant(orgId, integration, action, sessionId)` for write actions
2. `evaluateGrant()` calls `findMatchingGrants()` — DB query matching exact or wildcard (`*`) on integration and action, filtered by org, non-revoked, non-expired, non-exhausted, scoped to session or org-wide
3. For each candidate: `consumeGrantCall()` atomically increments `usedCalls` via CAS
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

### 6.9 Provider Guide Flow — `Implemented`

**What it does:** Serves integration-specific markdown guides to the agent.

**Flow:**
1. Agent calls `proliferate actions guide --integration linear`
2. CLI sends `GET /:sessionId/actions/guide/linear` to gateway
3. Gateway calls `actions.getGuide("linear")` — looks up adapter, returns `adapter.guide`
4. Returns markdown guide with CLI examples for each action

Each adapter embeds its own guide as a static string (e.g., `linearAdapter.guide`, `sentryAdapter.guide`).

**Files touched:** `packages/services/src/actions/adapters/index.ts:getGuide`, adapter files

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `integrations.md` | Actions → Integrations | `integrations.getToken(integrationId)` | Token resolution for adapter execution |
| `integrations.md` | Actions → Integrations | `sessions.listSessionConnections()` | Discovers which integrations are available |
| `sessions-gateway.md` | Actions → Gateway | WebSocket broadcast events | `action_approval_request`, `action_completed`, `action_approval_result` |
| `agent-contract.md` | Contract → Actions | `ACTIONS_BOOTSTRAP` in sandbox config | Bootstrap guide written to `.proliferate/actions-guide.md` |
| `agent-contract.md` | Contract → Actions | `proliferate` CLI in system prompts | Prompts document CLI usage for actions |
| `auth-orgs.md` | Actions → Auth | `orgs.getUserRole(userId, orgId)` | Admin/owner role check for approve/deny |

### Security & Auth
- **Sandbox tokens** can invoke actions and create grants but cannot approve/deny.
- **User tokens** with admin/owner role can approve/deny invocations.
- **Member role** users cannot approve/deny (403).
- **Token resolution** happens server-side via Nango — the sandbox never sees integration OAuth tokens.
- **Result redaction**: sensitive keys (`token`, `secret`, `password`, `authorization`, `api_key`, `apikey`) are stripped before DB storage. Source: `service.ts:redactData`
- **Result truncation**: results exceeding 10KB are replaced with `{ _truncated: true, _originalSize }`. Source: `service.ts:truncateResult`

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
