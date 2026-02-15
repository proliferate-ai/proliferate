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
