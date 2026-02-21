# Actions — System Spec

## 1. Scope & Purpose

### In Scope
- Gateway-mediated action listing, invocation, approval, denial, and status polling.
- Three-mode policy resolution (`allow`, `require_approval`, `deny`) and mode-source attribution.
- Provider-backed action sources (Linear, Sentry, Slack) and connector-backed MCP action sources.
- Org-level and automation-level action mode overrides.
- User action source preferences (source-level enable/disable) in list/invoke paths.
- Invocation persistence, expiry sweep, redaction, and truncation.
- Org inbox query surface for pending approvals.
- Sandbox bootstrap guidance and CLI contracts (`proliferate actions list|guide|run`).

### Out of Scope
- Session lifecycle orchestration and WebSocket transport internals (`sessions-gateway.md`).
- OAuth connection lifecycle details (`integrations.md`).
- Trigger ingestion and run orchestration (`triggers.md`, `automations-runs.md`).
- Sandbox tool injection contracts and base system prompts (`agent-contract.md`).

### Mental Models
- **Actions are policy-gated side effects, not chat tools.** Every external side effect goes through gateway policy and audit rows (`action_invocations`), even when execution is immediate.
- **One catalog, two source archetypes.** Sessions see one merged catalog, but runtime execution is polymorphic (`ActionSource`) across static provider adapters and dynamic MCP connectors.
- **Two independent control planes exist.** User preferences control source visibility (`user_action_preferences`), while org/automation mode maps control execution policy (`action_modes` JSONB).
- **The CLI is synchronous UX over async workflow.** `proliferate actions run` may return immediately (allow), fail immediately (deny), or block with polling while waiting for human approval (require_approval).
- **Risk is only a default hint.** `riskLevel` informs inferred defaults; enforcement is always the resolved mode.

### Things Agents Get Wrong
- Mode map keys are `sourceId:actionId` (colon), not slash.
- `POST /approve` executes the action immediately after status transition; approval is not "mark-only".
- There is no gateway "approve with always mode" payload contract; "always allow" is implemented by a second org/automation mode write from web UI.
- Connector listing failures are degraded to empty tool lists; they do not fail the entire `/available` response.
- Connector drift guard only applies when a stored tool hash exists; absence of a stored hash means "not drifted".
- Sandbox callers can invoke/list/guide/status, but only user tokens with `owner|admin` can approve/deny.
- Result handling is not passthrough: DB writes always redact sensitive keys and structurally truncate JSON.

---

## 2. Core Concepts

### 2.1 Three-Mode Permissioning
Mode resolution is deterministic and centralized in `packages/services/src/actions/modes.ts`:

1. Automation override (`automations.action_modes["<sourceId>:<actionId>"]`)
2. Org default (`organization.action_modes["<sourceId>:<actionId>"]`)
3. Inferred default from action risk (`read→allow`, `write→require_approval`, `danger→deny`)

The resolved mode and mode source are stored on every invocation row.

### 2.2 `ActionSource` Polymorphism
All execution flows through `ActionSource` (`packages/providers/src/action-source.ts`):
- `ProviderActionSource` wraps static modules in `packages/providers/src/providers/*`.
- `McpConnectorActionSource` wraps org-scoped connector config and resolves tools dynamically (`packages/services/src/actions/connectors/action-source.ts`).

Gateway invocation code remains source-agnostic; it resolves source + action definition, validates params, and executes through a shared contract.

### 2.3 Schema Contract and Hashing
- Action params are Zod schemas (`ActionDefinition.params`), reused for runtime validation and JSON Schema export.
- Connector drift hashing uses stable stringification and normalized schemas that strip `description`, `default`, and `enum` (`packages/providers/src/helpers/schema.ts`).

### 2.4 Connector Risk Derivation
Connector risk level precedence (`packages/services/src/actions/connectors/risk.ts`):
1. Explicit connector per-tool override
2. MCP annotations (`destructiveHint` before `readOnlyHint`)
3. Connector default risk
4. Fallback `write` (safe default requiring approval)

### 2.5 Agent Bootstrap and CLI
- Sandbox setup writes `.proliferate/actions-guide.md` from `ACTIONS_BOOTSTRAP` (`packages/shared/src/sandbox/config.ts`).
- Actual runtime discovery always comes from `GET /actions/available` via `proliferate actions list`.
- `proliferate actions run` polls invocation status every 2s while pending (`packages/sandbox-mcp/src/proliferate-cli.ts`).

---

## 5. Conventions & Patterns

### Do
- Keep mode resolution logic in `modes.ts`; do not fork per integration/source.
- Build mode keys as `${sourceId}:${actionId}` consistently across all writers/readers.
- Validate params with action Zod schema before invocation creation.
- Route all source execution via `ActionSource.execute()`; keep adapters stateless.
- Resolve tokens/secrets server-side only (`integrations.getToken`, `secrets.resolveSecretValue`).
- Redact then truncate result payloads before persistence (`redactData` + `truncateJson`).
- Treat connector drift as fail-safe only: `allow → require_approval`, never relax `deny`.

### Don't
- Don't use `riskLevel` as direct enforcement.
- Don't persist raw provider responses or credential-shaped fields.
- Don't allow sandbox tokens to approve/deny.
- Don't assume connector permissions and drift state are discoverable from static UI metadata.
- Don't depend on legacy grant endpoints (`/actions/grants`) for policy management.

### Error Handling
- Service error classes map to explicit gateway statuses:
  - `ActionNotFoundError` → `404`
  - `ActionExpiredError` → `410`
  - `ActionConflictError` → `409`
  - `PendingLimitError` → `429`
- Execution failures map to `502` and mark invocation `failed`.

### Reliability
- Pending approvals expire after 5 minutes (`PENDING_EXPIRY_MS`).
- Max pending approvals per session is 10 (`MAX_PENDING_PER_SESSION`).
- Gateway invoke rate limit is 60/min/session (in-memory map).
- Connector tool cache TTL is 5 minutes per session (in-memory).
- Connector tool listing timeout is 15s; tool call timeout is 30s.

### Testing Conventions
- Current automated coverage is service-focused:
  - `packages/services/src/actions/service.test.ts`
  - `packages/services/src/actions/connectors/client.test.ts`
  - `packages/services/src/actions/connectors/risk.test.ts`
- Gateway route-level tests for `apps/gateway/src/api/proliferate/http/actions.ts` are currently absent.

---

## 6. Subsystem Invariants

### 6.1 Catalog Invariants
- `GET /:sessionId/actions/available` must return a merged catalog of:
  - Active session provider integrations with registered modules.
  - Enabled org connectors with non-empty discovered tool lists.
- Connector/tool discovery failures must degrade to omission, not global request failure.
- User source-level disable preferences must be enforced in both listing and invoke paths.

### 6.2 Invocation and Policy Invariants
- Every invocation must resolve to exactly one mode and one mode source.
- Mode resolution order must remain: automation override → org default → inferred default.
- Unknown/invalid stored mode values must fail safe to denied invocation with `unknown_mode:*`.
- Policy key format must remain `sourceId:actionId` across org and automation maps.

### 6.3 State Machine Invariants
- Allowed persisted statuses are: `pending`, `approved`, `executing`, `completed`, `denied`, `failed`, `expired`.
- `approveAction` and `denyAction` must only transition from `pending`; all other origins are conflicts.
- Pending records must have bounded lifetime (`expiresAt`) and be swept to `expired`.
- `allow` mode must create approved invocation before execution begins.
- `deny` mode must persist denied invocation (with policy reason) without execution.

### 6.4 Auth and Transport Invariants
- Only sandbox auth can call `/invoke`.
- Approval/denial requires user auth plus org role `owner|admin`.
- Session-scoped sandbox callers can only read invocations from their own session.
- User callers must belong to session org to list/inspect/approve/deny.

### 6.5 Execution and Persistence Invariants
- Gateway must mark execution lifecycle (`approved` → `executing` → `completed|failed`) around action execution.
- Persisted results must always be redacted for sensitive keys and structurally truncated to valid JSON.
- Gateway responses for executed actions may include truncated result payloads; DB persistence applies redaction/truncation regardless.
- External action credentials must never be returned to clients or sandbox filesystem by actions routes.

### 6.6 Approval and Notification Invariants
- Pending invocations must produce `action_approval_request` WS messages best-effort.
- Successful/failed executions after approval must produce `action_completed`.
- Explicit denials must produce `action_approval_result` with `status: denied`.
- Approval routes do not emit a distinct "approved" WS event before execution.

### 6.7 Connector Invariants
- Connector calls are stateless per operation (fresh MCP client/transport per list/call).
- 404/session invalidation on call retries once with re-initialized connection.
- Drift checks compare current definition hash against persisted connector override hash when available.
- Drift guard may only tighten policy; it must never relax policy.

### 6.8 UI Policy Surface Invariants
- Org-level mode management writes `organization.action_modes`.
- Automation-level mode management writes `automations.action_modes`.
- Inbox, integrations, and automation permission UIs all mutate the same mode maps and must preserve key format invariants.

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `integrations.md` | Actions → Integrations | `sessions.listSessionConnections()`, `integrations.getToken()` | Provider availability + token resolution |
| `integrations.md` | Actions ↔ Connectors | `connectors.listEnabledConnectors()`, `connectors.getConnector()`, `connectors.getToolRiskOverrides()` | Connector catalog + drift inputs |
| `secrets-environment.md` | Actions → Secrets | `secrets.resolveSecretValue(orgId, key)` | Connector auth secret resolution |
| `auth-orgs.md` | Actions → Orgs | `orgs.getUserRole(userId, orgId)` | Approval role checks |
| `agent-contract.md` | Contract → Actions | `ACTIONS_BOOTSTRAP`, system prompt CLI instructions | Agent discovery and usage model |
| `sessions-gateway.md` | Actions → Gateway WS | `action_approval_request`, `action_completed`, `action_approval_result` | Human-in-loop signaling |
| `automations-runs.md` | Actions ↔ Automations | automation mode APIs + integration-action resolver | Automation-scoped permissions UI/metadata |
| `user-action-preferences` | Actions ↔ Preferences | `getDisabledSourceIds()` | Source-level visibility/enforcement |

### Security & Auth
- Sandbox tokens are limited to invoke/list/guide/status session surfaces.
- Approval/denial is user-authenticated and role-gated.
- Provider OAuth tokens and connector secrets are resolved server-side only.
- Redaction removes common sensitive keys before DB persistence.

### Observability
- Service logger namespace: `module: "actions"` and connector child modules.
- Key lifecycle logs: invocation creation, policy denial, pending approval, expiry sweep counts, connector call outcomes.
- Gateway in-memory counters/caches include periodic cleanup loops.

---

## 8. Acceptance Gates

- [ ] `pnpm typecheck` passes.
- [ ] `pnpm lint` passes.
- [ ] `packages/services/src/actions/service.test.ts` passes.
- [ ] `packages/services/src/actions/connectors/client.test.ts` and `risk.test.ts` pass.
- [ ] Manual smoke: `/available`, `/invoke` (allow/deny/pending), `/approve`, `/deny`, pending expiry sweep.
- [ ] Mode keys remain colon-delimited and produce effective policy resolution.
- [ ] Spec is updated whenever mode semantics, auth boundaries, or lifecycle invariants change.

---

## 9. Known Limitations & Tech Debt

- [ ] **In-memory rate limiting**: gateway per-session limit is process-local; multi-instance deployments do not share counters.
- [ ] **Automation override not wired in invoke path**: `actions.invokeAction()` supports `automationId`, but gateway `/invoke` currently does not pass `session.automationId`, so automation overrides are not applied in that path.
- [ ] **Connector drift hash persistence gap**: drift checks read `org_connectors.tool_risk_overrides[*].hash`, but there is no first-class write flow in current connector CRUD/permissions UI to persist these hashes.
- [ ] **Inbox "Always Allow" key format mismatch**: inbox writes org mode keys as `${integration}/${action}` while resolver expects `${sourceId}:${actionId}`.
- [ ] **Connector permission UX gap**: integration detail page shows placeholder text for connector tool permissions; connector action-mode editing is not fully exposed there.
- [ ] **Action-level user preferences not enforced in gateway**: preference schema supports `actionId`, but gateway enforcement currently checks disabled sources only.
- [ ] **Legacy grant CLI commands remain**: sandbox CLI still exposes `proliferate actions grant*` commands even though gateway grant routes are removed.
- [ ] **Gateway route test gap**: no route-level automated tests currently cover `apps/gateway/src/api/proliferate/http/actions.ts`.
- [ ] **Database connectors planned**: provider-backed + MCP connector-backed sources are implemented; DB-native action sources are still planned.
