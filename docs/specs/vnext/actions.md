# Actions — System Spec

> **vNext (target architecture)** — This spec describes the intended Actions runtime after gateway hardening + unified integrations.
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
- Gateway action routes (invoke, approve, deny, list, guide).
- Gateway rate limiting for abuse protection (Redis-based, multi-instance safe).
- Invocation sweeper (expiry job for pending approvals).
- Actions list (org-level inbox for pending approvals).

### Out of Scope
- OAuth connection lifecycle and token storage — see `./integrations.md`.
- Trigger ingestion and polling — see `./triggers.md`.
- Automation run pipeline after an action is executed — see `automations-runs.md`.
- Session runtime (hub, WebSocket streaming, sandbox lifecycle) — see `./sessions-gateway.md`, `./sandbox-providers.md`.
- Sandbox tool injection schemas — see `./agent-contract.md`.

### Mental Model

Actions are platform-mediated operations the agent asks the gateway to perform on external services. The agent sees one flat action catalog for a session (`GET /:sessionId/actions/available`) that merges Code-defined integration actions (e.g., Sentry), Org-scoped MCP connector tools (e.g., Context7), and Database connectors (e.g. Postgres) into a single polymorphic interface: `ActionSource`.

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
- **Source-Agnostic Permissioning:** Mode resolution is deterministic (Automation Override → Org Default → Inferred Default) and blind to the underlying execution protocol.
- **Stateless Providers:** Action sources never read PostgreSQL or Redis. Tokens and configuration are dynamically injected via context.
- **JSON-Aware Truncation:** Results stored in the DB are redacted and structurally JSON-truncated (max 10KB) without producing invalid JSON.
- **Rate limiting** is enforced per session via Redis (`ratelimit:actions:<sessionId>`), so it works across multiple gateway instances.
- **Fail-Safe Drift Detection:** MCP tools that change since the last admin review are flagged as drifted. `allow` downgrades to `require_approval`; `deny` stays `deny`.
- **Pending Cap:** A session can have at most 10 pending invocations simultaneously.
- **Expiry:** Pending invocations expire after 5 minutes for interactive sessions, or 24 hours for unattended runs.

---

## 2. Core Concepts & Reference Implementations

### 2.1 The `ActionSource` Interface (The Data Plane)
All action catalogs and execution paths flow through this single polymorphic interface. The Gateway calls this without knowing if the underlying system is REST, MCP, or a raw TCP Socket.

```typescript
// packages/providers/src/action-source.ts
import type { z } from "zod";

export type RiskLevel = "read" | "write" | "danger";

export interface ActionDefinition {
  id: string;
  description: string;
  riskLevel: RiskLevel; // Static hint ONLY. Enforcement happens via the Mode Cascade.
  params: z.ZodType<any>; // MUST use Zod to support enums and deep schemas
}

export interface ActionExecutionContext {
  token?: string; // Live token resolved & injected by the platform
  orgId: string;
  sessionId: string;
}

export interface ActionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  _truncated?: boolean;
}

export interface ActionSource {
  id: string; // e.g., "sentry", "connector:<uuid-ctx7>", "db:<uuid>"
  displayName: string;
  guide?: string;
  
  // Async discovery. Static for adapters, dynamic for MCP over network.
  listActions(ctx: ActionExecutionContext): Promise<ActionDefinition[]>;
  
  // Stateless execution.
  execute(
    actionId: string, 
    params: Record<string, unknown>, 
    ctx: ActionExecutionContext
  ): Promise<ActionResult>;
}

```

### 2.2 Archetype A: Code-Defined Integration (Sentry)

Code-defined integrations are implemented as stateless modules (`IntegrationProvider`).

```typescript
// packages/providers/src/providers/sentry/actions.ts
import { z } from "zod";

export const updateIssue: ActionDefinition = {
  id: "update_issue",
  description: "Update a Sentry issue status",
  riskLevel: "write", // Inferred default: require_approval
  params: z.object({
    issue_id: z.string(),
    status: z.enum(["resolved", "ignored", "unresolved"]) // Zod properly handles enums
  }),
  execute: async (actionId: string, params: Record<string, unknown>, ctx: ActionExecutionContext) => {
    // STATELESS EXECUTION! ctx.token is safely injected by the framework.
    const typed = params as { issue_id: string; status: string };
    const res = await fetch(`https://sentry.io/api/0/issues/${typed.issue_id}/`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${ctx.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ status: typed.status })
    });
    
    if (!res.ok) throw new Error(`Sentry API Error: ${res.statusText}`);
    return { success: true, data: await res.json() };
  }
};

```

### 2.3 Archetype B: Dynamic MCP Connector (Context7)

MCP tools are dynamically discovered at runtime.

```typescript
// packages/providers/src/action-source.ts
import { jsonSchemaToZod } from "./helpers/schema";

export class McpConnectorActionSource implements ActionSource {
  id: string;
  displayName: string;

  constructor(private connectorRow: OrgConnector) {
    this.id = `connector:${connectorRow.id}`; 
    this.displayName = connectorRow.name;
  }

  async listActions(ctx: ActionExecutionContext) {
    const client = await this.connectMcp(ctx); // Resolves API key from DB secrets
    const mcpTools = await client.listTools(); 
    
    return mcpTools.tools.map(tool => ({
      id: tool.name,
      description: tool.description,
      riskLevel: tool.readOnlyHint ? "read" : "write",
      // MAGIC: Translate MCP JSON Schema into Zod dynamically
      params: jsonSchemaToZod(tool.inputSchema) 
    }));
  }

  async execute(actionId: string, params: Record<string, unknown>, ctx: ActionExecutionContext) {
    const client = await this.connectMcp(ctx);
    const result = await client.callTool({ name: actionId, arguments: params });
    return { success: !result.isError, data: result.content };
  }
}

```

### 2.4 Archetype C: Database Connector (PostgreSQL)

A direct TCP connection that bypasses REST/HTTP entirely.

```typescript
// packages/providers/src/action-source.ts
export class DatabaseActionSource implements ActionSource {
  constructor(private connectionString: string) {
    this.id = `db:${hash(connectionString)}`;
    this.displayName = "PostgreSQL";
  }

  async listActions(ctx: ActionExecutionContext) {
    return [{
      id: "run_query",
      description: "Run a readonly SQL query",
      riskLevel: "write",
      params: z.object({ sql: z.string() })
    }];
  }

  async execute(actionId: string, params: any, ctx: ActionExecutionContext) {
    if (actionId === "run_query") {
      const pool = new pg.Pool({ connectionString: this.connectionString });
      const result = await pool.query(params.sql);
      return { success: true, data: result.rows.slice(0, 100) }; // Safe row limits
    }
    return { success: false, error: "Unsupported action" };
  }
}

```

### 2.5 Three-Mode Permissioning

Every invocation resolves to one mode via a simple cascade:

1. Automation override (`automations.action_modes["<sourceId>:<actionId>"]`)
2. Org default (`organizations.action_modes["<sourceId>:<actionId>"]`)
3. Inferred default (from action definition `risk` hints: `risk: "read"` → `allow`, `risk: "write"` → `require_approval`)

* Key detail agents get wrong: `risk` is a hint for defaults only. Enforcement is entirely via mode overrides and the resolved mode recorded on each invocation.

### 2.6 Connector Tool Drift Detection (Hashing)

Dynamic MCP tools can change at runtime. vNext stores a stable hash for each tool definition alongside its configured mode. On listing, the gateway compares the stored hash with the current hash.

Hashing rules (avoid false-positive drift):

* Use a deterministic JSON stringifier (stable key ordering).
* Hash a normalized JSON Schema that strips `description`, `default`, and `enum` fields (these commonly contain dynamic data).

Drift handling rules:

* Previous `allow` → set effective mode to `require_approval` until re-confirmed.
* Previous `require_approval` → keep `require_approval`.
* Previous `deny` → keep `deny` (still drifted; must be explicitly re-enabled by an admin).
* Key detail agents get wrong: drift detection must never "upgrade" a denied tool into an approvable tool.

### 2.7 Zod Schemas (Params and Results)

Action definitions use Zod for parameter validation and JSON Schema export (UI + agent guide).

* Key detail agents get wrong: schema conversion must be stable for hashing; use one shared `zodToJsonSchema()` implementation. Flat schemas (`ActionParam[]`) are deprecated.

---

## 3. File Tree

vNext introduces `packages/providers/` as the single home for code-defined integration modules and the `ActionSource` seam.

```
packages/providers/src/
├── index.ts                          # Exports registry, types, ActionSource adapters
├── types.ts                          # IntegrationProvider, ActionDefinition, trigger types
├── action-source.ts                  # ActionSource interface + ProviderActionSource adapter
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
├── index.ts
├── service.ts                        # Invoke/approve/deny, mode resolution, audit persistence
├── db.ts                             # Drizzle queries for action_invocations
└── modes.ts                          # Mode resolution helpers (org + automation + inferred)

apps/gateway/src/api/proliferate/http/
├── actions.ts                        # Routes: available, invoke, invocations, approve/deny
└── actions.test.ts

apps/worker/src/sweepers/
└── index.ts                          # Action expiry sweeper (setInterval)

packages/services/src/connectors/     # (Integrations-owned) CRUD for org_connectors

packages/db/src/schema/
├── schema.ts                         # action_invocations columns (vNext) + organizations/automations action_modes
└── connectors.ts                     # org_connectors.tool_risk_overrides

apps/web/src/server/routers/
└── actions.ts                        # oRPC router for org-level actions inbox

```

---

## 4. Data Models & Schemas

### Database Tables

```sql
-- NOTE: action_grants is completely removed in vNext

action_invocations
├── id                UUID PRIMARY KEY DEFAULT gen_random_uuid()
├── session_id        UUID NOT NULL FK → sessions(id) ON DELETE CASCADE
├── organization_id   TEXT NOT NULL FK → organization(id) ON DELETE CASCADE
├── integration_id    UUID FK → integrations(id) ON DELETE SET NULL
├── integration       TEXT NOT NULL                 -- sourceId (e.g. "linear", "connector:<uuid>")
├── action            TEXT NOT NULL                 -- actionId (e.g. "create_issue", "search_docs")
├── risk_level        TEXT NOT NULL                 -- "read" | "write" (hint copied at invocation time)
├── mode              TEXT NOT NULL                 -- "allow" | "deny" | "require_approval" (resolved)
├── mode_source       TEXT NOT NULL                 -- "automation_override" | "org_default" | "inferred_default"
├── params            JSONB                         -- action parameters (redacted before store)
├── status            TEXT NOT NULL DEFAULT 'pending' -- pending | executed | denied | expired | failed
├── result            JSONB                         -- execution result (redacted, structurally truncated)
├── error             TEXT                          -- error message on failure
├── denied_reason     TEXT                          -- policy | human | expired
├── duration_ms       INTEGER                       -- execution time
├── approved_by       TEXT                          -- user ID who approved/denied
├── approved_at       TIMESTAMPTZ
├── completed_at      TIMESTAMPTZ
├── expires_at        TIMESTAMPTZ                   -- 5m interactive, 24h unattended
└── created_at        TIMESTAMPTZ DEFAULT now()

-- Mode overrides (ownership: Actions)
organizations
├── id                TEXT PRIMARY KEY
└── action_modes      JSONB                         -- { "<sourceId>:<actionId>": "allow|deny|require_approval", ... }

automations
├── id                UUID PRIMARY KEY
└── action_modes      JSONB                         -- same shape; highest priority

-- Connector tool modes (persistence owned by Integrations)
org_connectors
├── id                  UUID PRIMARY KEY
├── organization_id     TEXT NOT NULL
├── name                TEXT NOT NULL
├── url                 TEXT NOT NULL
├── auth                JSONB NOT NULL
├── enabled             BOOLEAN NOT NULL DEFAULT true
└── tool_risk_overrides JSONB                       -- { "<toolName>": { mode, hash }, ... }

```

### Core TypeScript Types

```ts
// packages/providers/src/action-source.ts (dependency)
export type ActionMode = "allow" | "deny" | "require_approval";

export interface ModeResolution {
    mode: ActionMode;
    source: "automation_override" | "org_default" | "inferred_default";
}

export interface ActionExecutionContext {
  token?: string; 
  orgId: string;
  sessionId: string;
}

export interface ActionSource {
  id: string;
  displayName: string;
  guide?: string;
  listActions(ctx: ActionExecutionContext): Promise<ActionDefinition[]>;
  execute(actionId: string, params: Record<string, unknown>, ctx: ActionExecutionContext): Promise<ActionResult>;
}

```

### Key Indexes & Query Patterns

* `idx_action_invocations_session` (session_id) — `listBySession`, `listPendingBySession`
* `idx_action_invocations_org_created` (organization_id, created_at) — `listByOrg`, `countByOrg`
* `idx_action_invocations_status_expires` (status, expires_at) — `expirePendingInvocations` sweeper
* Org policy lookup is a point read on `organizations.action_modes` (JSONB), keyed by `"<sourceId>:<actionId>"`.

---

## 5. Conventions & Patterns

### Do

* Keep mode resolution centralized and deterministic (`modes.ts`), and record `mode` + `mode_source` on every invocation.
* Validate params against Zod schema before mode resolution and execution.
* Redact + **JSON-truncate results before storing (10KB max)**. Truncation must structurally prune arrays/objects to preserve valid JSON and include a `_truncated: true` marker when applied. Do not string-slice.
* Cache connector `tools/list` results (5 minutes) and include tool hash comparisons during listing.
* Fail safe on drift: if a tool hash changes, downgrade `allow` to `require_approval` but never relax `deny`.

### Don't

* Don't implement per-source permissioning branches in the invocation pipeline (mode resolution is uniform).
* Don't rely on provider `riskLevel` as enforcement (it is only an inferred default hint).
* Don't store or return raw tokens from action routes.
* Don't construct JSON strings manually in bash commands (sandbox agent must use the provided JSON schema).

### Reliability

* External API timeouts: default 30s per action execution (via `AbortSignal`).
* Rate limiting: Redis `INCR` + `EXPIRE` on `ratelimit:actions:<sessionId>` (60 calls/min). Fail open if Redis is unavailable (abuse protection only).
* Pending cap: Max 10 pending invocations per session.
* Result truncation: never string-slice JSON. Prune structurally until under the limit and return/store a valid JSON value.

---

## 6. Subsystem Deep Dives

### 6.1 List Available Actions

**What it does:** Returns a merged catalog of actions available to a session, across all action source types.

**Happy path:**

1. Load session context: `session_connections` (provider-backed sources) and `org_connectors` (connector sources).
2. Build `ActionSource[]` for provider-backed sources (`ProviderRegistry` → `ProviderActionSource`) and connector-backed sources (`McpConnectorActionSource`, tools cached 5 mins).
3. For each source, call `listActions(ctx)` and compute modes per `(sourceId, actionId)` via mode resolution cascade.
4. Return one flat list and use it to generate the sandbox guide (`.proliferate/actions-guide.md`).

**Edge cases:**

* Connector is unreachable at list-time → return connector source with an error marker; do not block other sources.
* Tool hash changed since last review → mark drifted; `allow` becomes `require_approval`, `deny` stays `deny`, and surface "needs re-review" in admin UI.

### 6.2 Invoke An Action (`POST /invoke`)

**What it does:** Validates an invocation, resolves mode, and either executes, denies, or creates a pending approval.

**Pipeline:**

1. Resolve `ActionSource` by `sourceId` and locate `ActionDefinition` by `actionId`.
2. Validate params via Zod (`safeParse`) and reject invalid payloads early.
3. If source is a connector tool, compute drift status using normalized schema hashing:
* Deterministic JSON stringifier (stable key order).
* Strip `description`, `default`, and `enum` before hashing (these frequently contain dynamic upstream data).
* Compare against stored `tool_risk_overrides` hash.


4. Resolve mode (automation override → org default → inferred default).
5. Apply drift guardrail (connector tools only): drifted `allow` downgrades to `require_approval`; drifted `deny` stays `deny`.
6. Execute mode branch:
* `deny` → persist invocation as denied, return HTTP 403.
* `require_approval` → persist invocation as pending, broadcast approval request, return HTTP 202 with pending metadata.
* `allow` → execute `source.execute()` immediately.


7. For executed responses, redact and structurally JSON-truncate results to <=10KB (never string-slice JSON), persist audit row, then return HTTP 200 with the safe payload.

### 6.3 Approve/Deny Pending Invocations

**What it does:** Resolves a pending invocation into an executed or denied state.

**Routes:**

* `POST /invocations/:invocationId/approve`
* `POST /invocations/:invocationId/deny`

**Approve modes:**

* `mode: "once"` (default) — approves this invocation only.
* `mode: "always"` — approves this invocation AND updates `organizations.action_modes` (or `automations.action_modes`) to `allow` for this `sourceId:actionId` pair.

Interactive sessions use WebSocket-connected human clients to approve/deny via the Org Inbox UI. Unattended automation runs pause, notify a Slack channel, and wait for human resumption (owned by `automations-runs.md`).

### 6.4 Actions List (Org Inbox)

**What it does:** oRPC route for querying action invocations at the org level, consumed by the inline attention inbox tray.

**Frontend surface:** Pending approvals are surfaced via an inline **inbox tray** (`apps/web/src/components/coding-session/inbox-tray.tsx`). The tray merges current-session WebSocket approval requests, org-level polled pending approvals, and pending automation runs. The UI allows administrators to quickly review the LLM's requested parameters and click `[ Approve Once ]`, `[ Deny ]`, or `[ Approve & Always Allow ]`.

### 6.5 Invocation Sweeper

**What it does:** Periodically marks stale pending invocations as expired.
**Mechanism:** `setInterval` every 60 seconds calling `actions.expireStaleInvocations()`, which runs `UPDATE action_invocations SET status='expired', completed_at=now() WHERE status='pending' AND expires_at <= now()`. Uses the `idx_action_invocations_status_expires` index.

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
| --- | --- | --- | --- |
| Integrations | Actions → Integrations | `getToken()` | Runtime token resolution for provider-backed actions. |
| Providers package | Actions → Providers | `ProviderRegistry`, `ActionSource` | Listing + execution via provider-backed sources. |
| Sessions | Sessions → Actions | `GET/POST actions routes` | Interactive approval UX depends on session connectivity. |
| Automations | Actions → Automations | "needs_human" pause/resume | Unattended approvals are run-owned. |
| Secrets | Actions → Secrets | `resolveSecretValue()` | Connector auth secrets for MCP action sources. |
| Auth | Actions → Auth | `orgs.getUserRole()` | Admin/owner role required for approve/deny endpoints. |

### Security & Auth

* **Sandbox tokens** can invoke actions but cannot approve/deny.
* **User tokens** with admin/owner role can approve/deny invocations. Member roles receive a 403.
* Always redact secrets (`token`, `secret`, `password`, `authorization`, `api_key`) from stored params/results.

### Observability

* Service functions log via `getServicesLogger().child({ module: "actions" })`.
* Log fields: `sessionId`, `organizationId`, `sourceId`, `actionId`, `mode`, `mode_source`, `status`, `duration_ms`.
* Metrics: invoke counts by mode, pending queue depth, approval latency, connector list latency, tool drift events.

---

## 8. Acceptance Gates

* [ ] Old CAS grant system (`action_grants` table and `grants.ts`) completely deleted.
* [ ] Drift hashing uses a deterministic stringifier and strips `enum`, `default`, and `description`.
* [ ] JSON-aware truncation correctly prunes large payloads structurally without returning malformed JSON strings.
* [ ] The `POST /invoke` pipeline handles `allow | require_approval | deny` mode resolution uniformly across all action source types.

---

## 9. Known Limitations & Tech Debt

* [ ] Database connectors are planned; initial vNext only unifies provider-backed + MCP connector-backed actions.
* [ ] Unattended approval pause/resume is cross-cutting and requires coordinated changes in `automations-runs.md` and `sessions-gateway.md`.
* [ ] Drift hashing relies on stable JSON Schema conversion; changes to `zodToJsonSchema()` can cause false-positive drift and should be treated as a breaking change.