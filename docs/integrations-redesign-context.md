# Integrations/Actions/MCP Redesign — Full Codebase Context

> Compiled audit of all UI components, API routes, services, data models, types, and permission logic related to integrations, actions, MCPs, and org-wide permissioning. Raw context for spec and implementation planning.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Database Schema](#2-database-schema)
3. [Type System](#3-type-system)
4. [MCP vs Adapter Distinction](#4-mcp-vs-adapter-distinction)
5. [Permission & Role System](#5-permission--role-system)
6. [UI Components](#6-ui-components)
7. [API Routes](#7-api-routes)
8. [Service Layer](#8-service-layer)
9. [Gateway Action Routes](#9-gateway-action-routes)
10. [Credentials & Secrets Management](#10-credentials--secrets-management)
11. [Connector Presets](#11-connector-presets)
12. [Onboarding Flows](#12-onboarding-flows)
13. [Specs](#13-specs)
14. [Complete File Inventory](#14-complete-file-inventory)
15. [Flags & Inconsistencies](#15-flags--inconsistencies)

---

## 1. System Overview

The integrations system has **three conceptual layers** that are currently muddled together:

1. **Connections** (OAuth integrations) — org-wide, stored in `integrations` table
2. **Connectors** (MCP servers) — org-wide, stored in `org_connectors` table
3. **Actions** (what agents can do) — derived from both, with approval/permission flow

| Concept | Storage | Auth | Admin manages | User controls |
|---------|---------|------|---------------|---------------|
| OAuth integrations (GitHub, Sentry, Linear) | `integrations` table | Nango/GitHub App OAuth | Connect/disconnect | Toggle on/off |
| Slack | `slack_installations` table (separate) | Custom OAuth flow | Connect/disconnect | Toggle on/off |
| MCP connectors (Context7, PostHog, custom) | `org_connectors` table | Org secrets by reference | Full CRUD + risk policy | Toggle on/off |

Both adapters and connectors implement the `ActionSource` interface and merge into the same `GET /available` endpoint. The gateway distinguishes them by ID prefix: `"linear"` vs `"connector:uuid"`.

---

## 2. Database Schema

### 2.1 Core Tables

| Table | Purpose | Scope |
|-------|---------|-------|
| `integrations` | OAuth connections (Nango, GitHub App) | Org-wide |
| `org_connectors` | MCP server configs | Org-wide |
| `user_connections` | User-level connections (new, underused) | Per-user |
| `user_action_preferences` | Per-user source enable/disable toggles | Per-user per-org |
| `action_invocations` | Audit trail for action executions | Per-session |
| `slack_installations` | Slack OAuth installations | Per-org |
| `secrets` | Encrypted credentials/API keys | Org or repo-scoped |
| `organization.action_modes` | JSONB org-level action permission overrides | Per-org |
| `automations.action_modes` | JSONB automation-level permission overrides | Per-automation |

### 2.2 `integrations` Table

**File:** `packages/db/src/schema/schema.ts` (lines 381-422)

```typescript
export const integrations = pgTable(
  "integrations",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    organizationId: text("organization_id").notNull(),
    provider: text().notNull(),                    // 'nango', 'github-app'
    integrationId: text("integration_id").notNull(), // 'github', 'sentry', 'linear'
    connectionId: text("connection_id").notNull(),
    displayName: text("display_name"),
    scopes: text().array(),
    status: text().default("active"),              // 'active', 'expired', 'revoked'
    visibility: text().default("org"),             // 'org', 'private'
    githubInstallationId: text("github_installation_id"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow(),
  },
  (table) => [
    index("idx_integrations_github_installation"),
    index("idx_integrations_org"),
    foreignKey({ columns: [table.organizationId], foreignColumns: [organization.id] }),
    foreignKey({ columns: [table.createdBy], foreignColumns: [user.id] }),
    unique("integrations_connection_id_key").on(table.connectionId),
    check("integrations_visibility_check", sql`visibility = ANY (ARRAY['org'::text, 'private'::text])`),
  ],
);
```

### 2.3 `org_connectors` Table

**File:** `packages/db/src/schema/schema.ts` (lines 1656-1685)

```typescript
export const orgConnectors = pgTable(
  "org_connectors",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    organizationId: text("organization_id").notNull(),
    name: text().notNull(),
    transport: text().notNull().default("remote_http"),
    url: text().notNull(),
    auth: jsonb().notNull(),                         // ConnectorAuth (bearer or custom_header)
    riskPolicy: jsonb("risk_policy"),                // ConnectorRiskPolicy
    toolRiskOverrides: jsonb("tool_risk_overrides"), // Per-tool risk + hash for drift detection
    enabled: boolean().notNull().default(true),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow(),
  },
  (table) => [
    index("idx_org_connectors_org").on(table.organizationId),
    foreignKey({ columns: [table.organizationId], foreignColumns: [organization.id] }),
    foreignKey({ columns: [table.createdBy], foreignColumns: [user.id] }),
  ],
);
```

### 2.4 `action_invocations` Table

**File:** `packages/db/src/schema/schema.ts` (lines 1112-1167)

```typescript
export const actionInvocations = pgTable(
  "action_invocations",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    sessionId: uuid("session_id").notNull(),
    organizationId: text("organization_id").notNull(),
    integrationId: uuid("integration_id"),           // NULL for connector-backed actions
    integration: text("integration").notNull(),      // "linear", "sentry", "slack" OR "connector:uuid"
    action: text("action").notNull(),
    riskLevel: text("risk_level").notNull(),          // "read" | "write" | "danger"
    mode: text("mode"),                               // "allow" | "require_approval" | "deny"
    modeSource: text("mode_source"),
    params: jsonb("params"),
    status: text("status").default("pending").notNull(),
    result: jsonb("result"),
    error: text("error"),
    deniedReason: text("denied_reason"),
    durationMs: integer("duration_ms"),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "date" }),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
  },
  (table) => [
    index("idx_action_invocations_session"),
    index("idx_action_invocations_org_created"),
    index("idx_action_invocations_status_expires"),
    foreignKey({ columns: [table.organizationId], foreignColumns: [organization.id] }),
    foreignKey({ columns: [table.integrationId], foreignColumns: [integrations.id] }),
    foreignKey({ columns: [table.sessionId], foreignColumns: [sessions.id] }),
  ],
);
```

**Key distinction:** `integrationId` is NULL for MCP connectors (no OAuth connection). The `integration` field contains either a provider ID ("linear") or connector ID ("connector:uuid").

### 2.5 `user_connections` Table

**File:** `packages/db/src/schema/schema.ts` (lines 1819-1859)

```typescript
export const userConnections = pgTable(
  "user_connections",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: text("user_id").notNull(),
    organizationId: text("organization_id").notNull(),
    provider: text().notNull(),
    connectionId: text("connection_id").notNull(),
    displayName: text("display_name"),
    status: text().default("active"),
    metadata: jsonb(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow(),
  },
  (table) => [
    index("idx_user_connections_user"),
    index("idx_user_connections_org"),
    foreignKey({ columns: [table.userId], foreignColumns: [user.id] }),
    foreignKey({ columns: [table.organizationId], foreignColumns: [organization.id] }),
    unique("user_connections_user_org_provider_connection_key").on(
      table.userId, table.organizationId, table.provider, table.connectionId,
    ),
  ],
);
```

**Note:** Created in vNext migration but has no significant UI or service logic referencing it yet.

### 2.6 `user_action_preferences` Table

**File:** `packages/db/src/schema/schema.ts` (lines 1867-1899)

```typescript
export const userActionPreferences = pgTable(
  "user_action_preferences",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: text("user_id").notNull(),
    organizationId: text("organization_id").notNull(),
    sourceId: text("source_id").notNull(),           // "linear", "connector:<uuid>"
    actionId: text("action_id"),                     // null = source-level toggle
    enabled: boolean().notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow(),
  },
  (table) => [
    index("idx_user_action_prefs_user_org"),
    foreignKey({ columns: [table.userId], foreignColumns: [user.id] }),
    foreignKey({ columns: [table.organizationId], foreignColumns: [organization.id] }),
    unique("user_action_prefs_user_org_source_action_key")
      .on(table.userId, table.organizationId, table.sourceId, table.actionId)
      .nullsNotDistinct(),
  ],
);
```

### 2.7 `slack_installations` Table

**File:** `packages/db/src/schema/schema.ts` (lines 1267-1310)

```typescript
export const slackInstallations = pgTable(
  "slack_installations",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    organizationId: text("organization_id").notNull(),
    teamId: text("team_id").notNull(),
    teamName: text("team_name"),
    encryptedBotToken: text("encrypted_bot_token").notNull(),
    botUserId: text("bot_user_id").notNull(),
    scopes: text().array(),
    installedBy: text("installed_by"),
    status: text().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow(),
    supportChannelId: text("support_channel_id"),
    supportChannelName: text("support_channel_name"),
    supportInviteId: text("support_invite_id"),
    supportInviteUrl: text("support_invite_url"),
  },
  (table) => [
    index("idx_slack_installations_org"),
    index("idx_slack_installations_team"),
    foreignKey({ columns: [table.organizationId], foreignColumns: [organization.id] }),
    foreignKey({ columns: [table.installedBy], foreignColumns: [user.id] }),
    unique("slack_installations_organization_id_team_id_key").on(table.organizationId, table.teamId),
  ],
);
```

### 2.8 `secrets` Table

**File:** `packages/db/src/schema/schema.ts` (lines 424-469)

```typescript
export const secrets = pgTable(
  "secrets",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    organizationId: text("organization_id").notNull(),
    repoId: uuid("repo_id"),                         // null = org-wide
    key: text().notNull(),
    encryptedValue: text("encrypted_value").notNull(),
    secretType: text("secret_type").default("env"),   // 'env', 'docker_registry', 'file'
    description: text(),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).defaultNow(),
    prebuildId: uuid("prebuild_id"),
  },
  (table) => [
    index("idx_secrets_org"),
    index("idx_secrets_repo"),
    foreignKey({ columns: [table.organizationId], foreignColumns: [organization.id] }),
    foreignKey({ columns: [table.repoId], foreignColumns: [repos.id] }),
    foreignKey({ columns: [table.createdBy], foreignColumns: [user.id] }),
    foreignKey({ columns: [table.prebuildId], foreignColumns: [configurations.id] }),
    unique("secrets_org_repo_prebuild_key_unique").on(
      table.organizationId, table.repoId, table.key, table.prebuildId,
    ),
  ],
);
```

### 2.9 `organization.action_modes` and `automations.action_modes`

Both the `organization` and `automations` tables have `actionModes: jsonb("action_modes")` columns storing `Record<"sourceId:actionId", "allow"|"deny"|"require_approval">`.

### 2.10 Entity Relationships

```
Organization (1) ──── (N) Integrations
Organization (1) ──── (N) OrgConnectors
Organization (1) ──── (N) Secrets
Organization (1) ──── (N) UserConnections
Organization (1) ──── (N) SlackInstallations

User (1) ──── (N) Integrations (createdBy)
User (1) ──── (N) OrgConnectors (createdBy)
User (1) ──── (N) UserConnections
User (1) ──── (N) UserActionPreferences

Session (1) ──── (N) ActionInvocations
Integration (1) ──── (N) ActionInvocations
Integration (1) ──── (N) RepoConnections
```

### 2.11 vNext Phase 0 Migration (0025)

**File:** `packages/db/drizzle/0025_vnext_phase0.sql`

Key changes:
- Dropped `action_grants` table (replaced by `action_modes` JSONB on org/automation)
- Created `user_connections`, `user_action_preferences` tables
- Added `org_connectors.tool_risk_overrides` JSONB column
- Added `organization.action_modes` and `automations.action_modes` JSONB columns

---

## 3. Type System

### 3.1 Core Types (`packages/providers/src/types.ts`)

```typescript
export type RiskLevel = "read" | "write" | "danger";
export type ActionMode = "allow" | "require_approval" | "deny";

export interface ActionDefinition {
  id: string;
  description: string;
  riskLevel: RiskLevel;
  params: z.ZodType;
}

export interface ActionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  durationMs?: number;
}

export interface ActionExecutionContext {
  token: string;          // OAuth token (adapter) or org secret (MCP)
  orgId: string;
  sessionId: string;
}

export interface ActionModes {
  defaultMode?: ActionMode;
  integrations?: Record<string, ActionMode>;       // per-source overrides
  actions?: Record<string, ActionMode>;            // "sourceId:actionId" overrides
}
```

### 3.2 ActionSource Interface (`packages/providers/src/action-source.ts`)

```typescript
export interface ActionSource {
  id: string;                    // "sentry" or "connector:uuid"
  displayName: string;
  guide?: string;
  listActions(ctx: ActionExecutionContext): Promise<ActionDefinition[]>;
  execute(actionId: string, params: Record<string, unknown>, ctx: ActionExecutionContext): Promise<ActionResult>;
}

export interface ActionSourceRegistration {
  id: string;
  displayName: string;
  origin: "adapter" | "connector";    // KEY DISTINCTION
  defaultRisk?: RiskLevel;
  toolRiskOverrides?: Record<string, RiskLevel>;
}

export interface ResolvedActionSources {
  sources: ActionSource[];
  allActions: Array<{ source: ActionSource; action: ActionDefinition }>;
}
```

**Two implementations:**
- `ProviderActionSource` — wraps static adapter modules (Linear, Sentry, Slack)
- `McpConnectorActionSource` — wraps DB row from `org_connectors`, discovers tools via MCP protocol

### 3.3 Connector Types (`packages/shared/src/connectors.ts`)

```typescript
export type ConnectorTransport = "remote_http";

export interface ConnectorAuthBearer {
  type: "bearer";
  secretKey: string;            // Reference to org secret (NOT raw value)
}

export interface ConnectorAuthCustomHeader {
  type: "custom_header";
  secretKey: string;
  headerName: string;           // e.g. "X-Api-Key", "CONTEXT7_API_KEY"
}

export type ConnectorAuth = ConnectorAuthBearer | ConnectorAuthCustomHeader;

export interface ConnectorRiskPolicy {
  defaultRisk?: "read" | "write" | "danger";
  overrides?: Record<string, "read" | "write" | "danger">;
}

export interface ConnectorConfig {
  id: string;
  name: string;
  transport: ConnectorTransport;
  url: string;
  auth: ConnectorAuth;
  riskPolicy?: ConnectorRiskPolicy;
  enabled: boolean;
}

export interface ConnectorPreset {
  key: string;
  name: string;
  description: string;
  defaults: Omit<ConnectorConfig, "id">;
  guidance?: string;
  quickSetup?: boolean;
  secretLabel?: string;
  recommendedSecretKey?: string;
  docsUrl?: string;
}
```

### 3.4 Zod Validation Schemas (`packages/shared/src/connectors.ts`)

```typescript
export const ConnectorAuthSchema = z.discriminatedUnion("type", [
  ConnectorAuthBearerSchema,
  ConnectorAuthCustomHeaderSchema,
]);

export const ConnectorRiskPolicySchema = z.object({
  defaultRisk: riskLevelSchema.optional(),
  overrides: z.record(z.string(), riskLevelSchema).optional(),
});

export const ConnectorConfigSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  transport: z.literal("remote_http"),
  url: z.string().url(),
  auth: ConnectorAuthSchema,
  riskPolicy: ConnectorRiskPolicySchema.optional(),
  enabled: z.boolean(),
});

export const ConnectorsArraySchema = z.array(ConnectorConfigSchema).max(20);
```

### 3.5 Frontend Adapter Metadata (`apps/web/src/lib/action-adapters.ts`)

Static mirror of backend adapter definitions for UI consumption:

```typescript
export type AdapterProvider = "linear" | "sentry";

export interface ActionMeta {
  name: string;
  description: string;
  riskLevel: "read" | "write";
}

export interface AdapterMeta {
  integration: AdapterProvider;
  displayName: string;
  description: string;
  actions: ActionMeta[];
}

export const ACTION_ADAPTERS: AdapterMeta[] = [
  {
    integration: "linear",
    displayName: "Linear",
    description: "Create, read, and update Linear issues from sessions",
    actions: [
      { name: "list_issues", description: "...", riskLevel: "read" },
      { name: "get_issue", description: "...", riskLevel: "read" },
      { name: "create_issue", description: "...", riskLevel: "write" },
      { name: "update_issue", description: "...", riskLevel: "write" },
      { name: "add_comment", description: "...", riskLevel: "write" },
    ],
  },
  {
    integration: "sentry",
    displayName: "Sentry",
    description: "Query and manage Sentry issues from sessions",
    actions: [
      { name: "list_issues", description: "...", riskLevel: "read" },
      { name: "get_issue", description: "...", riskLevel: "read" },
      { name: "list_issue_events", description: "...", riskLevel: "read" },
      { name: "get_event", description: "...", riskLevel: "read" },
      { name: "update_issue", description: "...", riskLevel: "write" },
    ],
  },
];
```

**Note:** Slack is NOT in this list (handled separately as a "communication" integration).

### 3.6 Integration Catalog Entry (UI)

```typescript
export interface CatalogEntry {
  key: string;
  name: string;
  description: string;
  category: IntegrationCategory;
  type: "oauth" | "slack" | "mcp-preset";    // TYPE DISTINCTION
  provider?: Provider;
  presetKey?: string;
}
```

---

## 4. MCP vs Adapter Distinction

### 4.1 Comparison Table

| Aspect | Adapters (Static) | MCPs (Dynamic) |
|--------|-------------------|----------------|
| Definition | Code-registered modules | DB rows in `org_connectors` |
| Registry | `Map<string, ProviderActionModule>` | PostgreSQL table |
| Providers | Linear (5 actions), Sentry (5 actions), Slack (1 action) | Any MCP server |
| Auth | OAuth via Nango/GitHub App | Org secrets by reference |
| Actions | Fixed set with Zod schemas | Discovered via MCP `tools/list` |
| ID format | `"linear"`, `"sentry"`, `"slack"` | `"connector:uuid"` |
| Risk levels | Static per-action | Dynamic: annotations -> policy -> default -> "write" fallback |
| Drift detection | N/A (never drift) | Hash-based per-tool |
| Scope | Per-session (needs OAuth connection) | Per-org (catalog) |
| `integrationId` in invocations | UUID FK | NULL |
| UI component | `AdapterCard` | `ConnectorForm` / `QuickSetupForm` |
| Presets | None (hardcoded) | 7 built-in + custom |
| Guide | Hardcoded markdown | Auto-generated from tools |

### 4.2 Gateway Resolution Logic

**File:** `apps/gateway/src/api/proliferate/http/actions.ts` (lines 215-293)

```typescript
async function resolveActionSource(sessionId, integration, action, auth?) {
  // BRANCH 1: MCP Connector
  if (integration.startsWith("connector:")) {
    const connectorId = integration.slice("connector:".length);
    const { connector, orgId, secret } = await resolveConnector(sessionId, connectorId);
    // Look up tools from cached session connector tools
    // Check drift via hash comparison
    const source = new McpConnectorActionSource(connector, secret);
    return { source, actionDef, ctx: { token: secret, orgId, sessionId }, isDrifted };
  }

  // BRANCH 2: Provider Adapter
  const module = getProviderActions(integration); // static map lookup
  const actionDef = module.actions.find((a) => a.id === action);
  const source = new ProviderActionSource(integration, integration, module);
  // Resolve OAuth token from session's active connections
  const token = await integrations.getToken({...});
  return { source, actionDef, ctx: { token, orgId, sessionId }, isDrifted: false };
}
```

### 4.3 `GET /available` Merges Both Types

```typescript
// Filter to active integrations that have a provider module
const available = connections
  .filter((c) => c.integration?.status === "active")
  .map((c) => {
    const module = getProviderActions(c.integration!.integrationId);
    if (!module) return null;
    return {
      integrationId: c.integrationId,
      integration: c.integration!.integrationId,      // "linear", "sentry", "slack"
      displayName: c.integration!.displayName,
      actions: module.actions.map(actionToResponse),
    };
  });

// Merge connector-backed tools
const connectorTools = await listSessionConnectorTools(sessionId);
const connectorIntegrations = connectorTools
  .filter((ct) => ct.actions.length > 0)
  .map((ct) => ({
    integrationId: null,                               // NULL for connectors
    integration: `connector:${ct.connectorId}`,        // PREFIXED
    displayName: ct.connectorName,
    actions: ct.actions.map(actionToResponse),
  }));

let allIntegrations = [...available, ...connectorIntegrations];
```

### 4.4 Adapter Implementations

**Linear** (`packages/providers/src/providers/linear/actions.ts`):
- 5 actions: list_issues (read), get_issue (read), create_issue (write), update_issue (write), add_comment (write)
- GraphQL to `https://api.linear.app/graphql`
- Bearer token in Authorization header, 30s timeout

**Sentry** (`packages/providers/src/providers/sentry/actions.ts`):
- 5 actions: list_issues (read), get_issue (read), list_issue_events (read), get_event (read), update_issue (write)
- REST to `https://sentry.io/api/0`
- Bearer token, 30s timeout

**Slack** (`packages/providers/src/providers/slack/actions.ts`):
- 1 action: post_message (write)
- REST to `https://slack.com/api`
- Bot token, 30s timeout

**Registry** (`packages/providers/src/providers/registry.ts`):
```typescript
const registry = new Map<string, ProviderActionModule>();
registry.set("linear", linearActions);
registry.set("sentry", sentryActions);
registry.set("slack", slackActions);
```

### 4.5 MCP Connector Implementation

**McpConnectorActionSource** (`packages/services/src/actions/connectors/action-source.ts`):

```typescript
export class McpConnectorActionSource implements ActionSource {
  readonly id: string;       // "connector:{uuid}"
  readonly displayName: string;

  constructor(private config: ConnectorConfig, private resolvedSecret: string)

  async listActions(): Promise<ActionDefinition[]> {
    const tools = await listConnectorToolsRaw(this.config, this.resolvedSecret);
    return tools.map((tool) => ({
      id: tool.name,
      description: tool.description ?? "",
      riskLevel: deriveRiskLevel(tool.name, tool.annotations, this.config.riskPolicy),
      params: jsonSchemaToZod((tool.inputSchema as Record<string, unknown>) ?? { type: "object" }),
    }));
  }

  async execute(actionId, params, _ctx): Promise<ActionResult> {
    const result = await callConnectorTool(this.config, this.resolvedSecret, actionId, params);
    // Retries once on 404 (session invalidation)
  }
}
```

**Risk Derivation** (`packages/services/src/actions/connectors/risk.ts`):

```typescript
export function deriveRiskLevel(toolName, annotations, policy): RiskLevel {
  // 1. Explicit per-tool override: riskPolicy.overrides[toolName]
  // 2. MCP annotations: destructiveHint → danger, readOnlyHint → read
  // 3. Connector-level default: riskPolicy.defaultRisk
  // 4. Safe fallback: "write" (requires approval)
}
```

**Drift Detection** (`packages/services/src/actions/connectors/client.ts`):

```typescript
export function computeDriftStatus(tools, storedOverrides) {
  // For each tool: compare current definition hash against stored hash
  // New tools: drift=false
  // Hash mismatch: drift=true
}
```

---

## 5. Permission & Role System

### 5.1 Role Hierarchy

**File:** `apps/web/src/lib/roles.ts`

```typescript
export type OrgRole = "owner" | "admin" | "member";

export const ROLE_HIERARCHY: Record<OrgRole, number> = {
  owner: 3,
  admin: 2,
  member: 1,
};

export type Permission =
  | "view"
  | "create_session"
  | "add_repo"
  | "manage_connections"
  | "invite_members"
  | "manage_roles"
  | "manage_domains"
  | "delete_org";

const ROLE_PERMISSIONS: Record<OrgRole, Permission[]> = {
  owner: ["view", "create_session", "add_repo", "manage_connections",
          "invite_members", "manage_roles", "manage_domains", "delete_org"],
  admin: ["view", "create_session", "add_repo", "manage_connections", "invite_members"],
  member: ["view", "create_session"],
};
```

### 5.2 Permission Matrix (Current State)

| Operation | Owner | Admin | Member |
|-----------|-------|-------|--------|
| View integrations list | Yes | Yes | Yes |
| Add/connect OAuth integration | Yes | Yes | No (UI-only gate) |
| Disconnect integration | Yes | Yes | Creator only |
| Create/edit/delete MCP connector | Yes | Yes | No |
| Validate MCP connector | Yes | Yes | No |
| Set action mode (allow/deny/approval) | Yes | Yes | No |
| Approve/deny action invocation | Yes | Yes | No |
| Toggle source on/off for self | Yes | Yes | Yes |
| View action invocations | Yes | Yes | Yes |
| Manage roles | Yes | No | No |
| Delete org | Yes | No | No |

### 5.3 oRPC Middleware Procedures

**File:** `apps/web/src/server/routers/middleware.ts`

```typescript
// Four tiers of protection:
1. publicProcedure           // No auth required
2. protectedProcedure        // Any authenticated user
3. orgProcedure              // Authenticated user + active org context
4. billingGatedProcedure     // Org + billing gate
```

### 5.4 Admin Checks

**Connector routes** (custom check in integrations router):
```typescript
async function requireConnectorAdmin(userId: string, orgId: string): Promise<void> {
  const role = await orgs.getUserRole(userId, orgId);
  if (role !== "owner" && role !== "admin") {
    throw new ORPCError("FORBIDDEN", { message: "Admin or owner role required" });
  }
}
```

**Gateway action approval/denial:**
```typescript
async function requireAdminRole(userId: string, orgId: string): Promise<void> {
  const role = await orgs.getUserRole(userId, orgId);
  if (role !== "owner" && role !== "admin") {
    throw new ApiError(403, "Admin or owner role required for action approvals");
  }
}
```

**Action modes** (`packages/services/src/actions/modes.ts`):
```typescript
export async function setActionMode(orgId, userId, key, mode) {
  const role = await orgsDb.getUserRole(userId, orgId);
  if (role !== "owner" && role !== "admin") {
    throw new Error("Only admins and owners can manage action modes");
  }
}
```

### 5.5 Three-Tier Action Mode Cascade

**File:** `packages/services/src/actions/modes.ts`

```typescript
export async function resolveMode(input: ResolveModeInput): Promise<ModeResolution> {
  // 1. Automation override (highest priority)
  //    automations.action_modes["sourceId:actionId"]
  if (input.automationId) {
    const automationModes = await modesDb.getAutomationActionModes(input.automationId);
    const raw = automationModes[modeKey];
    if (raw && VALID_ACTION_MODES.has(raw)) {
      return { mode: raw, source: "automation_override" };
    }
  }

  // 2. Org default
  //    organization.action_modes["sourceId:actionId"]
  const orgModes = await modesDb.getOrgActionModes(input.orgId);
  const orgRaw = orgModes[modeKey];
  if (orgRaw && VALID_ACTION_MODES.has(orgRaw)) {
    return { mode: orgRaw, source: "org_default" };
  }

  // 3. Inferred from risk level
  //    read → allow, write → require_approval, danger → deny
  const inferred = inferModeFromRisk(input.riskLevel);
  return { mode: inferred, source: "inferred_default" };
}
```

**Drift guard:** If MCP connector tool has drifted (`isDrifted: true`), "allow" downgrades to "require_approval".

### 5.6 Integration Visibility

**File:** `packages/services/src/integrations/mapper.ts`

```typescript
export function filterByVisibility(integrations, userId) {
  return integrations.filter((integration) => {
    if (integration.visibility === "org" || !integration.visibility) return true;
    return integration.created_by === userId; // private = only visible to creator
  });
}
```

**Note:** Filtering is in-memory, not at DB query level.

### 5.7 Connection Management Access

**File:** `apps/web/src/lib/permissions.ts`

```typescript
export async function canManageConnection(userId, organizationId, connectionCreatedBy) {
  if (connectionCreatedBy === userId) return true;  // Creator can always manage
  const role = await getUserOrgRole(userId, organizationId);
  return hasRoleOrHigher(role, "admin");             // Otherwise need admin+
}
```

### 5.8 User Action Preferences Enforcement

```typescript
// In gateway GET /available:
const disabled = await userActionPreferences.getDisabledSourceIds(userId, orgId);
allIntegrations = allIntegrations.filter((i) => !disabled.has(i.integration));

// Also re-checked in POST /invoke (belt-and-suspenders):
if (disabled.has(integration)) {
  throw new ApiError(403, "This integration is disabled by user preferences");
}
```

---

## 6. UI Components

### 6.1 Pages/Routes

| Route | File | Purpose | Role Gate |
|-------|------|---------|-----------|
| `/dashboard/integrations` | `apps/web/src/app/(command-center)/dashboard/integrations/page.tsx` | Main hub: OAuth + MCP connectors | Admin: full CRUD. Member: toggle only |
| `/dashboard/integrations/[id]` | `apps/web/src/app/(command-center)/dashboard/integrations/[id]/page.tsx` | Detail: Connection + Permissions tabs | Admin-only features |
| `/dashboard/actions` | `apps/web/src/app/(command-center)/dashboard/actions/page.tsx` | Admin inbox: approve/deny invocations | Admin: approve/deny. Member: read-only |
| `/settings/connections` | `apps/web/src/app/(command-center)/settings/connections/page.tsx` | Legacy redirect -> `/dashboard/integrations` | -- |

### 6.2 Component Tree

```
/dashboard/integrations (page.tsx)
├── IntegrationPickerDialog        — Browse catalog by category, search
│   └── CatalogEntry cards         — icon, name, description, status indicator
├── IntegrationDetailDialog        — Connect/manage single integration
│   ├── ConnectTabContent
│   │   ├── QuickSetupForm         — Simplified API key entry for MCP presets
│   │   ├── ConnectorForm          — Full MCP config (URL, auth, risk, validation)
│   │   └── OAuth connect/status   — Connect button or connected state
│   └── AboutTab                   — Description, links
├── ConnectionCard                 — Reusable: settings/trigger-card/inline variants
├── ConnectorRow                   — MCP connector list row (enable/edit/delete)
├── AdapterCard                    — Static adapter metadata + action list
├── ProviderIcon / ConnectorIcon   — Provider/preset icon rendering
└── ValidationResult               — MCP connection test result display

/dashboard/integrations/[id] (page.tsx)
├── OAuthConnectionTab / ConnectorConnectionTab
├── PermissionsTab
│   └── PermissionControl          — 3-button: Allow / Approval / Deny

/dashboard/actions (page.tsx)
└── ActionInvocationCard           — Row with status, risk badge, approve/deny/grant
```

### 6.3 IntegrationPickerDialog

**File:** `apps/web/src/components/integrations/integration-picker-dialog.tsx`

- Left sidebar: Category navigation (All, Source Control, Monitoring, Project Management, Communication, Developer Tools)
- Right content area: Grid of integration cards (1-3 columns)
- Search with debounce
- Cards show: icon, name, description, connection status (checkmark)
- Empty state: request form to submit integration requests

### 6.4 IntegrationDetailDialog

**File:** `apps/web/src/components/integrations/integration-detail-dialog.tsx`

- Two tabs: Connect, About
- **MCP preset with quickSetup:** Shows `QuickSetupForm`
- **MCP preset advanced:** Shows `ConnectorForm`
- **OAuth/Slack connected:** Success state, reconnect/manage/disconnect buttons
- **OAuth/Slack not connected:** Connect button with loading state

### 6.5 ConnectorForm

**File:** `apps/web/src/components/integrations/connector-form.tsx`

Fields: Name, URL, Auth type (Bearer/Custom Header), Secret (dropdown or custom), Header name (conditional), Default risk level (Read/Write/Danger). Test connection button validates and discovers tools. Save button.

### 6.6 QuickSetupForm

**File:** `apps/web/src/components/integrations/quick-setup-form.tsx`

Toggle: "New API key" vs "Use existing secret". If new: password input. If existing: dropdown of org secrets. Uses `useCreateOrgConnectorWithSecret()` for atomic creation. Auto-validates connection on success.

### 6.7 ConnectionCard

**File:** `apps/web/src/components/integrations/connection-card.tsx`

Three variants:
- `"settings"` — Full card with status, visibility toggle, manage/reconnect/disconnect
- `"trigger-card"` — Compact, shows broken state for missing connections
- `"inline"` — Wizard blocking state (amber alert vs green checkmark)

### 6.8 AdapterCard

**File:** `apps/web/src/components/integrations/adapter-card.tsx`

Header with icon, name, connect/disconnect. Expandable action list showing action name, description, risk level badge. Counts read vs write actions.

### 6.9 PermissionControl

**File:** `apps/web/src/components/integrations/permission-control.tsx`

3-button mode selector: Allow, Approval, Deny. Used on the integration detail Permissions tab.

### 6.10 ActionInvocationCard

**File:** `apps/web/src/components/actions/action-invocation-card.tsx`

Row with: status icon, action name + risk badge, status badge, session link, time ago. Approve dropdown: "Approve once" or "Approve with grant..." (scope + max calls). Countdown timer for pending expirations.

### 6.11 Hooks

| Hook | File | Purpose |
|------|------|---------|
| `useIntegrations()` | `apps/web/src/hooks/use-integrations.ts` | Fetch all OAuth + Slack status |
| `useOrgConnectors()` | `apps/web/src/hooks/use-org-connectors.ts` | CRUD for MCP connectors |
| `useNangoConnect()` | `apps/web/src/hooks/use-nango-connect.ts` | Nango OAuth flow (Linear, Sentry) |
| `useGitHubAppConnect()` | `apps/web/src/hooks/use-github-app-connect.ts` | GitHub App installation flow |
| `useSlackStatus/Connect/Disconnect()` | `apps/web/src/hooks/use-integrations.ts` | Slack lifecycle |
| `useActionModes()` | `apps/web/src/hooks/use-action-modes.ts` | Org-level action permission modes |
| `useSetActionMode()` | `apps/web/src/hooks/use-action-modes.ts` | Set single action mode |
| `useAutomationActionModes()` | `apps/web/src/hooks/use-action-modes.ts` | Automation-level modes |
| `useActionPreferences()` | `apps/web/src/hooks/use-action-preferences.ts` | Per-user source toggles |
| `useToggleActionPreference()` | `apps/web/src/hooks/use-action-preferences.ts` | Toggle source on/off |
| `useOrgActions()` | `apps/web/src/hooks/use-actions.ts` | Paginated org invocations |
| `useSessionActions()` | `apps/web/src/hooks/use-actions.ts` | Session invocations from gateway |
| `useApproveAction()` | `apps/web/src/hooks/use-actions.ts` | Gateway HTTP approve |
| `useDenyAction()` | `apps/web/src/hooks/use-actions.ts` | Gateway HTTP deny |
| `useValidateOrgConnector()` | `apps/web/src/hooks/use-org-connectors.ts` | Test MCP connection |
| `useCreateOrgConnectorWithSecret()` | `apps/web/src/hooks/use-org-connectors.ts` | Atomic create connector + secret |

### 6.12 Zustand Stores

**`useOnboardingStore`** (`apps/web/src/stores/onboarding.ts`):
```typescript
interface OnboardingStore {
  flowType: "developer" | "organization" | null;
  step: OnboardingStep;
  orgName: string;
  selectedTools: string[];      // [github, slack, linear, sentry, posthog]
  questionnaire: { referralSource, companyWebsite, teamSize };
  // Actions: setFlowType, setStep, setOrgName, setSelectedTools, reset
}
```

### 6.13 Role-Based UI Rendering

**Admin-only UI:**
- "Add integration" button
- "Connected by" column
- Integration detail page (Settings, Permissions tabs)
- MCP connector CRUD
- Slack Connect support channel
- Action approve/deny buttons
- Reconnect/disconnect buttons

**All users UI:**
- Toggle integrations on/off (Switch component)
- See which integrations are available (no CRUD)
- View action invocations (read-only)

**Role check pattern:**
```typescript
const currentUserRole = members?.find(m => m.userId === currentUserId)?.role;
const isAdmin = hasRoleOrHigher(currentUserRole, "admin");
```

---

## 7. API Routes

### 7.1 oRPC Integrations Router

**File:** `apps/web/src/server/routers/integrations.ts` (1,081 lines)

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `list` | orgProcedure | List all OAuth + provider status |
| `callback` | orgProcedure | Save OAuth connection after Nango flow |
| `update` | orgProcedure | Update display name |
| `disconnect` | orgProcedure | Delete integration + Nango cleanup |
| `githubSession` | orgProcedure | Get Nango session token for GitHub |
| `sentrySession` | orgProcedure | Get Nango session token for Sentry |
| `linearSession` | orgProcedure | Get Nango session token for Linear |
| `githubStatus` | orgProcedure | GitHub connection status |
| `sentryStatus` | orgProcedure | Sentry connection status |
| `linearStatus` | orgProcedure | Linear connection status |
| `slackStatus` | orgProcedure | Slack connection status |
| `slackConnect` | orgProcedure | Create Slack Connect support channel |
| `slackDisconnect` | orgProcedure | Revoke Slack installation |
| `listConnectors` | orgProcedure + `requireConnectorAdmin()` | List MCP connectors |
| `createConnector` | orgProcedure + `requireConnectorAdmin()` | Create MCP connector |
| `createConnectorWithSecret` | orgProcedure + `requireConnectorAdmin()` | Atomic create + secret |
| `updateConnector` | orgProcedure + `requireConnectorAdmin()` | Update MCP connector |
| `deleteConnector` | orgProcedure + `requireConnectorAdmin()` | Delete MCP connector |
| `validateConnector` | orgProcedure + `requireConnectorAdmin()` | Test + discover tools |
| `requestIntegration` | orgProcedure | Submit integration request |

### 7.2 oRPC Actions Router

**File:** `apps/web/src/server/routers/actions.ts` (54 lines)

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `list` | orgProcedure | Paginated org action invocations with status filter |

### 7.3 oRPC User Action Preferences Router

**File:** `apps/web/src/server/routers/user-action-preferences.ts` (75 lines)

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `list` | orgProcedure | Get user's action preferences |
| `update` | orgProcedure | Toggle single source/action |
| `bulkUpdate` | orgProcedure | Batch toggle (onboarding) |

### 7.4 API Route Handlers (OAuth Callbacks)

| Route | File | Purpose |
|-------|------|---------|
| `GET /api/integrations/github/callback` | `apps/web/src/app/api/integrations/github/callback/route.ts` | GitHub App OAuth callback |
| `GET /api/integrations/slack/oauth` | `apps/web/src/app/api/integrations/slack/oauth/route.ts` | Slack OAuth init (state gen) |
| `GET /api/integrations/slack/oauth/callback` | `apps/web/src/app/api/integrations/slack/oauth/callback/route.ts` | Slack OAuth callback (token exchange) |
| `POST /api/webhooks/nango` | `apps/web/src/app/api/webhooks/nango/route.ts` | Nango webhook (auth/sync events) |
| `POST /api/webhooks/github-app` | `apps/web/src/app/api/webhooks/github-app/route.ts` | GitHub App webhook (install lifecycle) |

---

## 8. Service Layer

### 8.1 Integrations Service

**File:** `packages/services/src/integrations/service.ts` (566+ lines)

Key functions:
- `listIntegrations(orgId, userId)` — Fetch all, filter by visibility, group by provider
- `getIntegration(id, orgId)` — With org check and creator info
- `saveIntegrationFromCallback(input)` — Save OAuth connection (upsert on connectionId)
- `deleteIntegration(integrationId, orgId)` — Delete + Nango cleanup + orphaned repos
- `getGitHubStatus/getSentryStatus/getLinearStatus/getSlackStatus(orgId)` — Provider status
- `saveGitHubAppInstallation(input)` — Upsert GitHub App installation
- `saveSlackInstallation(input)` — Upsert Slack installation

### 8.2 Integrations DB

**File:** `packages/services/src/integrations/db.ts` (500+ lines)

Key queries:
- `listByOrganization(orgId)` — All integrations ordered by createdAt DESC
- `findActiveGitHubApp(orgId)` — Active GitHub App integration
- `findActiveByIntegrationId(orgId, integrationId)` — By provider type
- `upsertGitHubAppInstallation(input)` — Upsert on conflict
- Slack: 12+ specific queries for installation lifecycle

### 8.3 Connectors Service

**File:** `packages/services/src/connectors/service.ts` (290 lines)

Key functions:
- `listConnectors(orgId)` / `listEnabledConnectors(orgId)` — All / enabled only
- `getConnector(id, orgId)` — Single with org check
- `createConnector(input)` / `updateConnector(id, orgId, input)` / `deleteConnector(id, orgId)`
- `createConnectorWithSecret(input)` — Atomic: encrypt secret + create connector in single tx
- `getToolRiskOverrides(id, orgId)` — For drift detection

### 8.4 Connectors DB

**File:** `packages/services/src/connectors/db.ts` (254 lines)

Key queries:
- `listByOrg(orgId)` / `listEnabledByOrg(orgId)` / `findByIdAndOrg(id, orgId)`
- `create(input)` / `update(id, orgId, input)` / `deleteById(id, orgId)`
- `createWithSecret(input)` — Single transaction: secret + connector + collision handling (max 3 retries)
- `listOrgSecretKeys(orgId)` — For "reuse existing secret" dropdown

### 8.5 Actions Service

**File:** `packages/services/src/actions/service.ts` (355+ lines)

Key functions:
- `invokeAction(input)` — Resolve mode -> create invocation (approved/denied/pending)
- `approveAction(invocationId, orgId, userId)` — Check pending + not expired -> approved
- `denyAction(invocationId, orgId, userId)` — Check pending -> denied
- `markExecuting/markCompleted/markFailed(invocationId, ...)` — Status transitions
- `listSessionActions/listPendingActions(sessionId)`
- `listOrgActions(orgId, options)` — Paginated with session title join
- `expireStaleInvocations()` — Worker sweeper

Constants: `MAX_PENDING_PER_SESSION = 10`, `PENDING_EXPIRY_MS = 5 * 60 * 1000`

Redaction: strips token, secret, password, authorization, api_key, apikey. Truncates results to 10KB.

### 8.6 Actions Modes

**File:** `packages/services/src/actions/modes.ts` (117 lines)

- `resolveMode(input)` — Three-tier cascade (automation -> org -> inferred)
- `setOrgActionMode(orgId, key, mode)` — Update org JSONB
- `setAutomationActionMode(automationId, key, mode)` — Update automation JSONB

### 8.7 MCP Client

**File:** `packages/services/src/actions/connectors/client.ts` (309 lines)

- `listConnectorToolsRaw(config, secret)` — Raw MCP protocol `tools/list` (15s timeout)
- `listConnectorToolsOrThrow(config, secret)` — Convert to ActionDefinitions
- `listConnectorTools(config, secret)` — Safe variant (empty on error)
- `callConnectorTool(config, secret, toolName, args)` — Execute tool (30s timeout, retry on 404)
- `computeDriftStatus(tools, storedOverrides)` — Hash comparison for drift detection

### 8.8 User Action Preferences Service

**File:** `packages/services/src/user-action-preferences/service.ts` (76 lines)

- `listPreferences(userId, orgId)` — All preferences
- `getDisabledSourceIds(userId, orgId)` — Hot path: Set of disabled sourceIds
- `setSourceEnabled/setActionEnabled(userId, orgId, sourceId, ...)` — Toggle
- `bulkSetPreferences(userId, orgId, prefs)` — Batch upsert
- `resetPreferences(userId, orgId)` — Delete all (revert to all enabled)

---

## 9. Gateway Action Routes

**File:** `apps/gateway/src/api/proliferate/http/actions.ts` (836 lines)

| Route | Auth | Purpose |
|-------|------|---------|
| `GET /:sessionId/actions/available` | Sandbox OR User (org check) | List all actions (adapters + connectors, filtered by user prefs) |
| `GET /:sessionId/actions/guide/:integration` | Sandbox OR User (org check) | Get integration guide markdown |
| `POST /:sessionId/actions/invoke` | Sandbox ONLY | Invoke action (risk/mode resolution) |
| `GET /:sessionId/actions/invocations/:id` | Sandbox OR User (org check) | Poll invocation status |
| `POST /:sessionId/actions/invocations/:id/approve` | User ONLY + Admin role | Approve pending |
| `POST /:sessionId/actions/invocations/:id/deny` | User ONLY + Admin role | Deny pending |
| `GET /:sessionId/actions/invocations` | Sandbox OR User (org check) | List session invocations |
| `POST /:sessionId/actions/grants` | Sandbox ONLY | Create grant |
| `GET /:sessionId/actions/grants` | Sandbox OR User (org check) | List grants |

**`POST /invoke` flow:**
1. Resolve action source (adapter vs connector branch)
2. Validate params against Zod schema
3. Call `actions.invokeAction()` -> resolves mode
4. If auto-approved: execute via `source.execute()`, return result
5. If pending: broadcast `action_approval_request`, return 202
6. If denied: return 403

---

## 10. Credentials & Secrets Management

### 10.1 Adapters (OAuth)

**File:** `packages/services/src/integrations/tokens.ts`

Token resolution via:
1. **Nango OAuth broker** (Sentry, Linear, optional GitHub) — `getNango().getConnection()`
2. **GitHub App installation tokens** — `getInstallationOctokit()`

Tokens resolved at execution time, not stored locally for Nango.

### 10.2 MCPs (Organization Secrets)

Connectors reference org secrets:
```typescript
auth: {
  type: "bearer",
  secretKey: "POSTHOG_API_KEY",     // Reference to org secret (NOT raw value)
};
```

At runtime:
```typescript
const secret = await secrets.resolveSecretValue(orgId, connector.auth.secretKey);
```

### 10.3 Slack

`slack_installations.encryptedBotToken` — AES encrypted, decrypted for API calls and revocation.

### 10.4 Redaction

Action results have sensitive keys stripped: `token`, `secret`, `password`, `authorization`, `api_key`, `apikey` (case-insensitive). Results truncated to 10KB.

---

## 11. Connector Presets

**File:** `packages/shared/src/connectors.ts` (lines 143-255)

| Preset | Auth | Default Risk | Quick Setup |
|--------|------|-------------|-------------|
| Context7 | custom_header (CONTEXT7_API_KEY) | read | Yes |
| PostHog | bearer | read | Yes |
| Firecrawl | bearer | read | Yes |
| Neon | bearer | write | Yes |
| Stripe | bearer | write | Yes |
| Custom | (blank template) | — | No |
| Playwright | (self-hosted) | — | No |

Presets are hardcoded in the shared package. Adding a new one requires a code change and deploy.

---

## 12. Onboarding Flows

### 12.1 StepToolSelection

**File:** `apps/web/src/components/onboarding/step-tool-selection.tsx`

Button list: GitHub, Slack, Linear, Sentry, PostHog. Toggle selection with checkmarks. Stores in Zustand `useOnboardingStore.setSelectedTools()`.

### 12.2 StepGitHubConnect

**File:** `apps/web/src/components/onboarding/step-github-connect.tsx`

If connected: shows "GitHub Connected" with continue/reconnect. If not: shows `GitHubConnectButton`. Checks GitHub App slug config.

### 12.3 StepSlackConnect

**File:** `apps/web/src/components/onboarding/step-slack-connect.tsx`

Three states:
1. Just completed OAuth: Slack Connect channel setup form
2. Already connected: "Slack already connected" with reconnect/continue
3. Not connected: "Add to Slack" button + "Skip for now"

---

## 13. Specs

Relevant specs to read before implementing:

| Spec | Path | Covers |
|------|------|--------|
| Actions | `docs/specs/actions.md` | Risk classification, grant evaluation, adapter registry, invocation lifecycle |
| Integrations | `docs/specs/integrations.md` | OAuth connections, connector catalog, token resolution, metadata queries |
| Auth & Orgs | `docs/specs/auth-orgs.md` | Roles, members, permissions, invitations |

---

## 14. Complete File Inventory

### UI (21+ files)

**Pages:**
- `apps/web/src/app/(command-center)/dashboard/integrations/page.tsx`
- `apps/web/src/app/(command-center)/dashboard/integrations/[id]/page.tsx`
- `apps/web/src/app/(command-center)/dashboard/actions/page.tsx`
- `apps/web/src/app/(command-center)/settings/connections/page.tsx`

**Components — Integrations:**
- `apps/web/src/components/integrations/integration-picker-dialog.tsx`
- `apps/web/src/components/integrations/integration-detail-dialog.tsx`
- `apps/web/src/components/integrations/connection-card.tsx`
- `apps/web/src/components/integrations/connection-selector.tsx`
- `apps/web/src/components/integrations/integration-connect-button.tsx`
- `apps/web/src/components/integrations/connector-form.tsx`
- `apps/web/src/components/integrations/quick-setup-form.tsx`
- `apps/web/src/components/integrations/connector-row.tsx`
- `apps/web/src/components/integrations/connector-icon.tsx`
- `apps/web/src/components/integrations/adapter-card.tsx`
- `apps/web/src/components/integrations/validation-result.tsx`
- `apps/web/src/components/integrations/permission-control.tsx`
- `apps/web/src/components/integrations/provider-icon.tsx`
- `apps/web/src/components/integrations/github-connect-button.tsx`

**Components — Actions:**
- `apps/web/src/components/actions/action-invocation-card.tsx`

**Components — Onboarding:**
- `apps/web/src/components/onboarding/step-tool-selection.tsx`
- `apps/web/src/components/onboarding/step-github-connect.tsx`
- `apps/web/src/components/onboarding/step-slack-connect.tsx`

**Hooks:**
- `apps/web/src/hooks/use-integrations.ts`
- `apps/web/src/hooks/use-org-connectors.ts`
- `apps/web/src/hooks/use-actions.ts`
- `apps/web/src/hooks/use-action-modes.ts`
- `apps/web/src/hooks/use-action-preferences.ts`
- `apps/web/src/hooks/use-nango-connect.ts`
- `apps/web/src/hooks/use-github-app-connect.ts`

**Lib/Stores:**
- `apps/web/src/lib/action-adapters.ts`
- `apps/web/src/lib/roles.ts`
- `apps/web/src/lib/permissions.ts`
- `apps/web/src/stores/onboarding.ts`

### API/Backend (20+ files)

**oRPC Routers:**
- `apps/web/src/server/routers/integrations.ts` (1,081 lines)
- `apps/web/src/server/routers/actions.ts`
- `apps/web/src/server/routers/user-action-preferences.ts`
- `apps/web/src/server/routers/middleware.ts`

**API Route Handlers:**
- `apps/web/src/app/api/integrations/github/callback/route.ts`
- `apps/web/src/app/api/integrations/slack/oauth/route.ts`
- `apps/web/src/app/api/integrations/slack/oauth/callback/route.ts`
- `apps/web/src/app/api/webhooks/nango/route.ts`
- `apps/web/src/app/api/webhooks/github-app/route.ts`

**Gateway:**
- `apps/gateway/src/api/proliferate/http/actions.ts` (836 lines)

### Services (14 files)

- `packages/services/src/integrations/service.ts`
- `packages/services/src/integrations/db.ts`
- `packages/services/src/integrations/mapper.ts`
- `packages/services/src/connectors/service.ts`
- `packages/services/src/connectors/db.ts`
- `packages/services/src/actions/service.ts`
- `packages/services/src/actions/db.ts`
- `packages/services/src/actions/modes.ts`
- `packages/services/src/actions/modes-db.ts`
- `packages/services/src/actions/connectors/action-source.ts`
- `packages/services/src/actions/connectors/client.ts`
- `packages/services/src/actions/connectors/risk.ts`
- `packages/services/src/user-action-preferences/service.ts`
- `packages/services/src/user-action-preferences/db.ts`

### Providers (5 files)

- `packages/providers/src/action-source.ts`
- `packages/providers/src/types.ts`
- `packages/providers/src/providers/registry.ts`
- `packages/providers/src/providers/linear/actions.ts`
- `packages/providers/src/providers/sentry/actions.ts`
- `packages/providers/src/providers/slack/actions.ts`

### Schema/Types (2 files)

- `packages/db/src/schema/schema.ts`
- `packages/shared/src/connectors.ts`

### Specs (3 files)

- `docs/specs/actions.md`
- `docs/specs/integrations.md`
- `docs/specs/auth-orgs.md`

---

## 15. Flags & Inconsistencies

### Broken / Redundant

1. **`user_connections` table exists but is unused.** Created in vNext migration, meant for user-level connections, but nothing in UI or services actually uses it.

2. **Slack is a special snowflake.** Own table (`slack_installations`), own OAuth flow (`/api/integrations/slack/oauth`), own status hooks, NOT in `ACTION_ADAPTERS` metadata. Yet the Slack action adapter exists in `packages/providers/src/providers/slack/actions.ts`. Needs to be unified or explicitly carved out.

3. **Visibility filtering is in-memory.** `filterByVisibility()` in the mapper does JS filtering, not DB-level WHERE clause.

4. **`action_grants` table was dropped in vNext but grant system still exists.** The grant creation/evaluation code is still in gateway `actions.ts`. The `action_modes` JSONB replaced grants for org defaults, but the two systems coexist awkwardly.

5. **Adapter metadata is duplicated.** `ACTION_ADAPTERS` in `apps/web/src/lib/action-adapters.ts` manually mirrors backend adapter definitions. They can drift independently.

### Inconsistent with Redesign Goals

6. **No backend admin gate on OAuth connect.** The `integrations.callback` oRPC endpoint is `orgProcedure` (any member can call). Admin enforcement is UI-only (hidden buttons). Needs a real backend permission check.

7. **MCP permissions tab is a placeholder.** For MCP connectors on the detail page, the Permissions tab shows "dynamic tools discovered at runtime" instead of actual per-tool permission controls.

8. **MCP setup exposes too much by default.** Unless a preset has `quickSetup: true`, users see URL, auth type, secret key, risk level fields. Goal: "only ever expose the API key or whatever credential they need."

9. **No "admin-connected, user-configurable" data model.** Users can only toggle sources on/off via `user_action_preferences`. No per-action mode preferences for users, no way to select which tools from a connector they want active.

10. **End users can't see which actions are available from admin-connected integrations.** The toggle is source-level (all-or-nothing). No UI shows "here are the 5 actions Linear provides, toggle the ones you want."

11. **Connector presets are hardcoded.** `CONNECTOR_PRESETS` is a static array in `packages/shared/src/connectors.ts`. Adding a new one requires a code change and deploy.

12. **No unified "actions available to me" view for end users.** The actions page (`/dashboard/actions`) is an admin approval inbox. There's no user-facing page showing "here are all the actions available in my sessions and how they're configured."
