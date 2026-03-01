# Agent Entity — System Design

> Technical design for making the Agent the primary entity in Proliferate's data
> model. Covers schema, types, services, routes, gateway, and the restructuring
> of automations into thin trigger policies.
>
> **Date**: 2026-02-25
> **Status**: Draft
> **Depends on**: `docs/architecture-strategic-review.md`

---

## Table of Contents

1. [Design Goal](#1-design-goal)
2. [New Data Model](#2-new-data-model)
3. [Schema Design](#3-schema-design)
4. [Restructuring Automations](#4-restructuring-automations)
5. [Contract Types](#5-contract-types)
6. [Service Layer](#6-service-layer)
7. [oRPC Routes](#7-orpc-routes)
8. [Worker Pipeline](#8-worker-pipeline)
9. [Gateway Changes](#9-gateway-changes)
10. [Context Rehydration](#10-context-rehydration)
11. [Session Lifecycle](#11-session-lifecycle)
12. [Naming Cleanup](#12-naming-cleanup)
13. [Migration](#13-migration)
14. [File Manifest](#14-file-manifest)

---

## 1. Design Goal

The Agent becomes the **primary entity** in Proliferate. Not optional, not
additive — primary. Every session belongs to an agent. The current `automations`
table is a bag of mixed concerns (agent identity + trigger policy + notification
config + environment targeting). This design splits it cleanly.

Principles:

- **Agent is the top-level object.** Users create agents. Agents own sessions.
  Triggers wake agents. The dashboard shows agents, not sessions.
- **Single source of truth per concern.** Agent identity (persona, model, tools)
  lives on the `agents` table only. Trigger policy lives on automations only.
  No field duplication across tables.
- **Clean over compatible.** We don't care about breaking existing flows. We
  care about the right architecture. Migrations can be destructive.
- **Code quality matters.** No dead fields, no legacy shims, no "nullable for
  backward compat." If a field moves, it moves.

---

## 2. New Data Model

### Before (current)

```
Organization
 ├── Automation (mixed: agent config + triggers + notifications)
 │    ├── agentInstructions, agentType, modelId, enabledTools
 │    ├── defaultConfigurationId, configSelectionStrategy, ...
 │    ├── notification config
 │    ├── Triggers
 │    └── Runs → Sessions
 │
 ├── Session (ephemeral, loosely connected)
 │    ├── automationId (optional)
 │    ├── agentConfig (jsonb, duplicates automation fields)
 │    └── systemPrompt (duplicates automation.agentInstructions)
 │
 └── Configuration (repo + snapshot)
```

### After (target)

```
Organization
 ├── Agent (identity + config — the "who")
 │    ├── name, slug, description
 │    ├── systemPrompt, agentType, modelId, enabledTools
 │    ├── defaultConfigurationId, configSelectionStrategy, fallbacks
 │    ├── notificationConfig (jsonb)
 │    ├── Connections (integrations bound to this agent)
 │    ├── Automations (trigger policies — the "when")
 │    │    ├── triggers, schedules
 │    │    ├── llmFilterPrompt, llmAnalysisPrompt (enrichment config)
 │    │    └── Runs (execution records)
 │    └── Sessions (compute runs — the "what happened")
 │         ├── agentId (required, NOT NULL)
 │         ├── automationId, runId (nullable — set if trigger-driven)
 │         └── sandbox, status, outcome, summary, metrics
 │
 └── Configuration (repo + snapshot — unchanged)
```

Key structural changes:

1. **Agent owns everything.** Sessions have a required `agentId`. Automations
   have a required `agentId`. No orphan sessions or automations without an agent.
2. **Automations are thin.** They keep only trigger/enrichment concerns:
   triggers, schedules, LLM filter prompt, LLM analysis prompt, enabled flag.
   All agent-identity fields are removed.
3. **Sessions stop duplicating config.** The `agentConfig` jsonb column and
   `systemPrompt` text column on sessions are removed. The gateway reads agent
   config from the agent via the session's `agentId` FK.
4. **Manual sessions get a "default agent."** When a user types a prompt in the
   dashboard, we create (or reuse) an ephemeral agent for them. Every session
   has an agent — no special-casing.

---

## 3. Schema Design

### 3.1 The `agents` Table

New file: `packages/db/src/schema/agents.ts`

```sql
CREATE TABLE agents (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id               TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,

  -- Identity
  name                          TEXT NOT NULL,
  slug                          TEXT,
  description                   TEXT,

  -- Status
  enabled                       BOOLEAN NOT NULL DEFAULT TRUE,

  -- Persona
  system_prompt                 TEXT,
  agent_type                    TEXT NOT NULL DEFAULT 'opencode',
  model_id                      TEXT NOT NULL DEFAULT 'claude-sonnet-4-20250514',
  reasoning_effort              TEXT DEFAULT 'normal',

  -- Toolbelt
  enabled_tools                 JSONB NOT NULL DEFAULT '{}',

  -- Environment targeting
  default_configuration_id      UUID REFERENCES configurations(id) ON DELETE SET NULL,
  allow_agentic_repo_selection  BOOLEAN NOT NULL DEFAULT FALSE,
  config_selection_strategy     TEXT NOT NULL DEFAULT 'fixed',
  fallback_configuration_id     UUID REFERENCES configurations(id) ON DELETE SET NULL,
  allowed_configuration_ids     JSONB,

  -- Notifications (single jsonb instead of 4 scattered columns)
  notification_config           JSONB NOT NULL DEFAULT '{"type": "none"}',

  -- Metadata
  created_by                    TEXT REFERENCES "user"(id),
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT agents_org_slug_unique UNIQUE (organization_id, slug)
);

CREATE INDEX idx_agents_org ON agents(organization_id);
CREATE INDEX idx_agents_org_enabled ON agents(organization_id) WHERE enabled = TRUE;
```

Design notes:
- `model_id` and `agent_type` are `NOT NULL` with defaults — no ambiguity.
- `notification_config` is a single jsonb column replacing the 4 scattered
  `notification_*` columns on automations. Schema:
  ```ts
  type NotificationConfig =
    | { type: "none" }
    | { type: "slack_dm"; slackUserId: string; slackInstallationId: string }
    | { type: "slack_channel"; channelId: string; slackInstallationId: string };
  ```
- `reasoning_effort` is promoted to a first-class column (currently buried
  inside the `agentConfig` jsonb on sessions).
- `slug` is unique per org for URL-addressable agents (`/agents/my-reviewer`).

### 3.2 Restructured `automations` Table

The automations table is **stripped down** to trigger-policy concerns only.
Agent-identity fields are removed.

**Columns removed from `automations`:**

| Removed column | Moved to |
|---|---|
| `agent_instructions` | `agents.system_prompt` |
| `agent_type` | `agents.agent_type` |
| `model_id` | `agents.model_id` |
| `enabled_tools` | `agents.enabled_tools` |
| `default_configuration_id` | `agents.default_configuration_id` |
| `allow_agentic_repo_selection` | `agents.allow_agentic_repo_selection` |
| `config_selection_strategy` | `agents.config_selection_strategy` |
| `fallback_configuration_id` | `agents.fallback_configuration_id` |
| `allowed_configuration_ids` | `agents.allowed_configuration_ids` |
| `notification_destination_type` | `agents.notification_config` |
| `notification_channel_id` | `agents.notification_config` |
| `notification_slack_user_id` | `agents.notification_config` |
| `notification_slack_installation_id` | `agents.notification_config` |

**Columns remaining on `automations`:**

```sql
ALTER TABLE automations
  ADD COLUMN agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  DROP COLUMN agent_instructions,
  DROP COLUMN agent_type,
  DROP COLUMN model_id,
  DROP COLUMN enabled_tools,
  DROP COLUMN default_configuration_id,
  DROP COLUMN allow_agentic_repo_selection,
  DROP COLUMN config_selection_strategy,
  DROP COLUMN fallback_configuration_id,
  DROP COLUMN allowed_configuration_ids,
  DROP COLUMN notification_destination_type,
  DROP COLUMN notification_channel_id,
  DROP COLUMN notification_slack_user_id,
  DROP COLUMN notification_slack_installation_id;

CREATE INDEX idx_automations_agent ON automations(agent_id);
```

After cleanup, `automations` has:

```
id, organization_id, agent_id (FK, NOT NULL),
name, description, enabled,
llm_filter_prompt, llm_analysis_prompt,
source_template_id,
created_by, created_at, updated_at
```

That's it. An automation is: "this agent wakes up when these triggers fire, with
this enrichment config."

### 3.3 Restructured `sessions` Table

**Columns changed:**

```sql
-- agent_id is required — every session belongs to an agent
ALTER TABLE sessions
  ADD COLUMN agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE;

-- Remove duplicated config (now lives on agent)
ALTER TABLE sessions
  DROP COLUMN agent_config,
  DROP COLUMN system_prompt;

CREATE INDEX idx_sessions_agent ON sessions(agent_id);
```

The `agentConfig` jsonb and `systemPrompt` text columns are removed. The gateway
resolves these from the agent at runtime (see §9).

**`automationId` stays** as a nullable FK — it records which automation
triggered the session, if any. Ad-hoc sessions (user typed a prompt) have
`automationId = NULL`.

### 3.4 Junction Table: `agent_connections`

Replaces `automation_connections`:

```sql
CREATE TABLE agent_connections (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id       UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  integration_id UUID NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(agent_id, integration_id)
);
```

The existing `automation_connections` table is dropped. Connections belong to
agents, not automations.

### 3.5 Drizzle Schema

**`packages/db/src/schema/agents.ts`** (new):

```ts
import { relations } from "drizzle-orm";
import {
  boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth";
import { configurations } from "./configurations";

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    slug: text("slug"),
    description: text("description"),

    enabled: boolean("enabled").notNull().default(true),

    systemPrompt: text("system_prompt"),
    agentType: text("agent_type").notNull().default("opencode"),
    modelId: text("model_id").notNull().default("claude-sonnet-4-20250514"),
    reasoningEffort: text("reasoning_effort").default("normal"),
    enabledTools: jsonb("enabled_tools").notNull().default({}),

    defaultConfigurationId: uuid("default_configuration_id")
      .references(() => configurations.id, { onDelete: "set null" }),
    allowAgenticRepoSelection: boolean("allow_agentic_repo_selection")
      .notNull().default(false),
    configSelectionStrategy: text("config_selection_strategy")
      .notNull().default("fixed"),
    fallbackConfigurationId: uuid("fallback_configuration_id")
      .references(() => configurations.id, { onDelete: "set null" }),
    allowedConfigurationIds: jsonb("allowed_configuration_ids"),

    notificationConfig: jsonb("notification_config").notNull().default({ type: "none" }),

    createdBy: text("created_by").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_agents_org").on(table.organizationId),
    index("idx_agents_org_enabled").on(table.organizationId, table.enabled),
    uniqueIndex("idx_agents_org_slug").on(table.organizationId, table.slug),
  ],
);

export const agentsRelations = relations(agents, ({ one, many }) => ({
  organization: one(organization, {
    fields: [agents.organizationId],
    references: [organization.id],
  }),
  createdByUser: one(user, {
    fields: [agents.createdBy],
    references: [user.id],
  }),
  defaultConfiguration: one(configurations, {
    fields: [agents.defaultConfigurationId],
    references: [configurations.id],
    relationName: "agentDefaultConfig",
  }),
  fallbackConfiguration: one(configurations, {
    fields: [agents.fallbackConfigurationId],
    references: [configurations.id],
    relationName: "agentFallbackConfig",
  }),
  automations: many(automations),
  sessions: many(sessions),
  connections: many(agentConnections),
}));

// Forward declarations
import { automations } from "./automations";
import { sessions } from "./sessions";
import { agentConnections } from "./agent-connections";
```

**Updates to `packages/db/src/schema/sessions.ts`:**

- Add `agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" })`
- Remove `agentConfig` column
- Remove `systemPrompt` column
- Add `agent` relation to `sessionsRelations`
- Add `index("idx_sessions_agent").on(table.agentId)` to table indexes

**Updates to `packages/db/src/schema/automations.ts`:**

- Add `agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" })`
- Remove all 14 agent-identity columns listed in §3.2
- Add `agent` relation to `automationsRelations`
- Remove `defaultConfiguration` and `fallbackConfiguration` relations (moved to agent)
- Add `index("idx_automations_agent").on(table.agentId)`

---

## 4. Restructuring Automations

### What an Automation Becomes

An automation is a **trigger policy** that dispatches work to its parent agent.
It answers: "when should this agent wake up, and what enrichment should happen
before execution?"

```ts
// The lean automation
interface Automation {
  id: string;
  agentId: string;           // Required — which agent this dispatches to
  organizationId: string;
  name: string;
  description: string | null;
  enabled: boolean;

  // Enrichment config (stays on automation — these are per-trigger-policy)
  llmFilterPrompt: string | null;
  llmAnalysisPrompt: string | null;

  // Metadata
  sourceTemplateId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;

  // Relations
  triggers: Trigger[];
  schedules: Schedule[];
  agent: { id: string; name: string };
}
```

Everything else (model, tools, system prompt, configuration targeting,
notifications) is read from the agent.

### Why LLM Filter/Analysis Stay on Automation

These are **per-trigger-policy** concerns, not agent-identity concerns. The same
agent might have two automations: one for Sentry alerts (with a filter prompt
that decides which alerts are actionable) and one for GitHub PR comments (with a
different filter). The filter logic is part of the dispatch policy, not the
agent's personality.

### Default Agent for Manual Sessions

When a user creates a session from the dashboard (no automation), the system
needs an agent to assign it to. Two approaches:

**Option A: Per-user default agent.** Each user gets an auto-created agent
named "{User}'s Agent" on first session creation. Manual sessions belong to this
agent. The agent is created lazily.

**Option B: Per-org default agent.** Each org gets one "Default Agent" that
handles all ad-hoc manual sessions. Simpler.

**Recommendation: Option A.** Per-user default agents let users customize their
personal agent's model, tools, and system prompt — which is what power users
want. The `agents` service exposes a `getOrCreateDefaultAgent(orgId, userId)`
function that lazily creates it.

---

## 5. Contract Types

### 5.1 New: `packages/shared/src/contracts/agents.ts`

```ts
// Notification config — discriminated union, replaces 4 separate columns
export const NotificationConfigSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({
    type: z.literal("slack_dm"),
    slackUserId: z.string(),
    slackInstallationId: z.string().uuid(),
  }),
  z.object({
    type: z.literal("slack_channel"),
    channelId: z.string(),
    slackInstallationId: z.string().uuid(),
  }),
]);

export type NotificationConfig = z.infer<typeof NotificationConfigSchema>;

// Full agent schema
export const AgentSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string(),
  name: z.string(),
  slug: z.string().nullable(),
  description: z.string().nullable(),
  enabled: z.boolean(),

  systemPrompt: z.string().nullable(),
  agentType: z.string(),
  modelId: z.string(),
  reasoningEffort: z.string().nullable(),
  enabledTools: z.record(z.unknown()),

  defaultConfigurationId: z.string().uuid().nullable(),
  defaultConfiguration: ConfigurationSummarySchema.nullable().optional(),
  allowAgenticRepoSelection: z.boolean(),
  configSelectionStrategy: z.enum(["fixed", "agent_decide"]),
  fallbackConfigurationId: z.string().uuid().nullable(),
  allowedConfigurationIds: z.array(z.string().uuid()).nullable(),

  notificationConfig: NotificationConfigSchema,

  creator: CreatorSchema.nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Agent = z.infer<typeof AgentSchema>;

export const AgentListItemSchema = AgentSchema.extend({
  _count: z.object({
    automations: z.number(),
    sessions: z.number(),
  }),
});

export type AgentListItem = z.infer<typeof AgentListItemSchema>;

export const CreateAgentInputSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  systemPrompt: z.string().optional(),
  agentType: z.string().optional(),
  modelId: z.string().optional(),
  reasoningEffort: z.enum(["quick", "normal", "deep"]).optional(),
  enabledTools: z.record(z.unknown()).optional(),
  defaultConfigurationId: z.string().uuid().optional(),
  notificationConfig: NotificationConfigSchema.optional(),
});

export type CreateAgentInput = z.infer<typeof CreateAgentInputSchema>;

export const UpdateAgentInputSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  slug: z.string().regex(/^[a-z0-9-]+$/).max(50).nullable().optional(),
  description: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  systemPrompt: z.string().nullable().optional(),
  agentType: z.string().optional(),
  modelId: z.string().optional(),
  reasoningEffort: z.enum(["quick", "normal", "deep"]).nullable().optional(),
  enabledTools: z.record(z.unknown()).optional(),
  defaultConfigurationId: z.string().uuid().nullable().optional(),
  allowAgenticRepoSelection: z.boolean().optional(),
  configSelectionStrategy: z.enum(["fixed", "agent_decide"]).optional(),
  fallbackConfigurationId: z.string().uuid().nullable().optional(),
  allowedConfigurationIds: z.array(z.string().uuid()).nullable().optional(),
  notificationConfig: NotificationConfigSchema.optional(),
});

export type UpdateAgentInput = z.infer<typeof UpdateAgentInputSchema>;

export const AskAgentInputSchema = z.object({
  prompt: z.string().min(1),
  configurationId: z.string().uuid().optional(),
  modelId: z.string().optional(),
  reasoningEffort: z.enum(["quick", "normal", "deep"]).optional(),
});

export type AskAgentInput = z.infer<typeof AskAgentInputSchema>;
```

### 5.2 Updated: `contracts/automations.ts`

The `AutomationSchema` is stripped to match the lean table:

```ts
export const AutomationSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string(),
  agentId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  enabled: z.boolean(),
  llmFilterPrompt: z.string().nullable(),
  llmAnalysisPrompt: z.string().nullable(),
  sourceTemplateId: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  agent: z.object({ id: z.string().uuid(), name: z.string() }).optional(),
  creator: CreatorSchema.nullable().optional(),
});

export const CreateAutomationInputSchema = z.object({
  agentId: z.string().uuid(),
  name: z.string().optional(),
  description: z.string().optional(),
  llmFilterPrompt: z.string().optional(),
  llmAnalysisPrompt: z.string().optional(),
});

export const UpdateAutomationInputSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  llmFilterPrompt: z.string().nullable().optional(),
  llmAnalysisPrompt: z.string().nullable().optional(),
});
```

### 5.3 Updated: `contracts/sessions.ts`

Add `agentId` (required) and `agent` summary to `SessionSchema`:

```ts
agentId: z.string().uuid(),
agent: z.object({ id: z.string().uuid(), name: z.string() }).optional(),
```

Remove from `SessionSchema`: the `agentConfig` and `systemPrompt` references
(these no longer exist on the session row).

Remove from `CreateSessionInputSchema`: `modelId` and `reasoningEffort` move to
`AskAgentInputSchema` — the agent carries the model config, not the session
creation request.

### 5.4 Registration in `contracts/index.ts`

Add `agentsContract` to the combined router. Re-export all agent types/schemas
following the pattern of the existing automation re-exports (lines 210-247).

---

## 6. Service Layer

### 6.1 New: `packages/services/src/agents/`

Four files, following the `automations/` pattern:

**`db.ts`** — Drizzle queries:

```ts
export async function list(orgId: string): Promise<AgentRow[]>
export async function findById(id: string, orgId: string): Promise<AgentRowWithRelations | null>
export async function findBySlug(slug: string, orgId: string): Promise<AgentRow | null>
export async function create(input: InsertAgent): Promise<AgentRow>
export async function update(id: string, orgId: string, values: Partial<InsertAgent>): Promise<AgentRow>
export async function remove(id: string, orgId: string): Promise<boolean>
export async function getOrCreateDefault(orgId: string, userId: string): Promise<AgentRow>
```

`getOrCreateDefault` is the lazy-create function for the per-user default agent.
It does an upsert keyed on `(organization_id, created_by, slug = 'default')`.

**`service.ts`** — business logic:

```ts
export async function listAgents(orgId: string): Promise<AgentListItem[]>
export async function getAgent(id: string, orgId: string): Promise<Agent>
export async function getAgentBySlug(slug: string, orgId: string): Promise<Agent>
export async function createAgent(orgId: string, userId: string, input: CreateAgentInput): Promise<Agent>
export async function updateAgent(id: string, orgId: string, input: UpdateAgentInput): Promise<Agent>
export async function deleteAgent(id: string, orgId: string): Promise<void>
export async function getOrCreateDefaultAgent(orgId: string, userId: string): Promise<Agent>
export async function askAgent(
  agentId: string,
  orgId: string,
  userId: string,
  input: AskAgentInput,
): Promise<{ sessionId: string }>
```

No `resolveAgentConfig` merge function needed. Agent config is the single source
of truth — there's nothing to merge.

**`mapper.ts`** — DB row to contract type.

**`index.ts`** — barrel.

### 6.2 Updated: `packages/services/src/automations/`

**`service.ts`** — remove all agent-config concerns:
- `createAutomation` requires `agentId` in input
- `updateAutomation` no longer accepts model/tools/config fields
- Remove any `notification_*` field handling (moved to agent)

**`mapper.ts`** — strip all removed fields from output mapping. Include
`agent: { id, name }` summary from the relation.

### 6.3 Updated: `packages/services/src/sessions/`

**`service.ts`**:
- `createSession` requires `agentId` (not optional)
- Remove `agentConfig` and `systemPrompt` from `CreateSessionInput`

**`mapper.ts`**:
- Include `agentId` and `agent: { id, name }` in mapped output
- Remove `agentConfig` mapping

### 6.4 Updated Types: `packages/services/src/types/sessions.ts`

```ts
export interface CreateSessionInput {
  id: string;
  agentId: string;                // Required
  configurationId: string | null;
  organizationId: string;
  sessionType: string;
  status: string;
  sandboxProvider: string;

  createdBy?: string | null;
  snapshotId?: string | null;
  initialPrompt?: string;
  title?: string;
  titleStatus?: string | null;
  clientType?: string;
  clientMetadata?: Record<string, unknown>;
  localPathHash?: string;
  origin?: string;
  automationId?: string | null;
  triggerId?: string | null;
  triggerEventId?: string | null;
}
```

Note: `agentConfig` and `systemPrompt` are gone. The gateway reads these from
the agent at boot time (see §9).

### 6.5 New Types: `packages/services/src/types/agents.ts`

```ts
export interface CreateAgentDbInput {
  organizationId: string;
  name: string;
  createdBy: string;
  description?: string | null;
  systemPrompt?: string | null;
  agentType?: string;
  modelId?: string;
  reasoningEffort?: string | null;
  enabledTools?: Record<string, unknown>;
  defaultConfigurationId?: string | null;
  notificationConfig?: NotificationConfig;
}

export interface UpdateAgentDbInput {
  name?: string;
  slug?: string | null;
  description?: string | null;
  enabled?: boolean;
  systemPrompt?: string | null;
  agentType?: string;
  modelId?: string;
  reasoningEffort?: string | null;
  enabledTools?: Record<string, unknown>;
  defaultConfigurationId?: string | null;
  allowAgenticRepoSelection?: boolean;
  configSelectionStrategy?: string;
  fallbackConfigurationId?: string | null;
  allowedConfigurationIds?: string[] | null;
  notificationConfig?: NotificationConfig;
}
```

### 6.6 Registration

**`packages/services/src/index.ts`**: add `export * as agents from "./agents"`.

---

## 7. oRPC Routes

### 7.1 New: `apps/web/src/server/routers/agents.ts`

```
agents.list              GET    /agents
agents.get               GET    /agents/:id
agents.getBySlug         GET    /agents/by-slug/:slug
agents.create            POST   /agents
agents.update            PATCH  /agents/:id
agents.delete            DELETE /agents/:id
agents.ask               POST   /agents/:id/ask
agents.listSessions      GET    /agents/:id/sessions
agents.listAutomations   GET    /agents/:id/automations
agents.listConnections   GET    /agents/:id/connections
agents.addConnection     POST   /agents/:id/connections
agents.removeConnection  DELETE /agents/:id/connections/:integrationId
```

### 7.2 The `ask` Endpoint

Creates a session owned by this agent. The primary "do something" entry point:

1. Load agent via `agents.getAgent(id, orgId)` — provides all config
2. Resolve configuration (repo/snapshot) from the agent's
   `defaultConfigurationId`
3. Create session via gateway sync client with `agentId`, `clientType: "agent"`
4. Post the prompt to the session
5. Return `{ sessionId }`

### 7.3 Updated: `automations` Router

`CreateAutomationInputSchema` now requires `agentId`. Remove all agent-config
fields from the update endpoint. The automations router becomes simpler.

### 7.4 Updated: `sessions` Router

The `create` endpoint (used by the dashboard "new session" flow) now:
1. Calls `agents.getOrCreateDefaultAgent(orgId, userId)` to get/create the
   user's default agent
2. Creates the session with the agent's `id`

Or, cleaner: the dashboard calls `agents.ask` directly instead of
`sessions.create`. The session creation is an implementation detail of
`agents.ask`.

### 7.5 Registration

**`apps/web/src/server/routers/index.ts`**: add `agents: agentsRouter`.

---

## 8. Worker Pipeline

### 8.1 Updated `handleExecute`

File: `apps/worker/src/automation/index.ts`

The execute function currently reads config from `context.automation` (model,
instructions, tools, configuration targeting). After the restructure, it reads
from the automation's agent instead.

**Before:**

```ts
const automation = context.automation;
// Read config from automation
agentConfig: automation.modelId ? { modelId: automation.modelId } : undefined,
buildPrompt(automation.agentInstructions, runId)
```

**After:**

```ts
const automation = context.automation;
const agent = await agents.getAgent(automation.agentId, run.organizationId);

// All config comes from the agent — no merging, no fallbacks
const sessionRequest = {
  agentId: agent.id,
  organizationId: run.organizationId,
  sessionType: "coding",
  clientType: "automation",
  sandboxMode: "immediate",
  title: buildTitle(automation.name, context.triggerEvent.parsedContext),
  configurationId: target.configurationId,
  automationId: automation.id,
  triggerId: context.trigger?.id,
  triggerEventId: context.triggerEvent.id,
  triggerContext: context.triggerEvent.parsedContext,
  clientMetadata: { ... },
};

// ...

buildPrompt(agent.systemPrompt, runId)
```

No `resolveAgentConfig` merge function. The agent IS the config.

### 8.2 Updated `resolveTarget`

File: `apps/worker/src/automation/resolve-target.ts`

Currently reads `automation.defaultConfigurationId`,
`automation.configSelectionStrategy`, etc. Update to read from the agent:

```ts
export async function resolveTarget(ctx: {
  agent: Agent;              // was: automation
  enrichmentJson: unknown;
  organizationId: string;
}, log: Logger)
```

### 8.3 Context Rehydration

Before sending the prompt, load prior session summaries for this agent:

```ts
const priorSessions = await sessions.listSessions(run.organizationId, {
  agentId: agent.id,
  limit: 5,
  excludeSetup: true,
});

const context = priorSessions
  .filter(s => s.summary && s.id !== sessionId)
  .map(s => `### ${s.title ?? "Session"} (${s.outcome})\n${s.summary}`)
  .join("\n\n");

const prompt = (context ? `## Prior Context\n\n${context}\n\n` : "")
  + buildPrompt(agent.systemPrompt, runId);
```

---

## 9. Gateway Changes

### 9.1 Session Runtime: Read Config from Agent

The gateway's `SessionRuntime` currently reads `agentConfig` and `systemPrompt`
from the session row. With these columns removed, it reads from the agent via
the session's `agentId` relation.

**`apps/gateway/src/hub/session-runtime.ts`** — in `doEnsureRuntimeReady()`:

```ts
// Before:
const agentConfig = session.agentConfig;
const systemPrompt = session.systemPrompt;

// After:
const agent = await agents.getAgent(session.agentId, session.organizationId);
const agentConfig = {
  agentType: agent.agentType,
  modelId: agent.modelId,
  reasoningEffort: agent.reasoningEffort,
};
const systemPrompt = agent.systemPrompt;
```

This is a small change — one extra DB read at session boot time, which is
already doing multiple DB reads. The agent row is small and can be included in
the existing session context query via a Drizzle `with: { agent: true }` join.

**`apps/gateway/src/lib/session-store.ts`** — update `loadSessionContext` to
join the agent relation:

```ts
const session = await db.query.sessions.findFirst({
  where: eq(sessions.id, sessionId),
  with: {
    agent: true,       // NEW
    configuration: true,
    repo: true,
    // ...
  },
});
```

Then `SessionContext` includes `agent: AgentRow` — no separate query needed.

### 9.2 Session Creator

**`apps/gateway/src/lib/session-creator.ts`** — `CreateSessionOptions` requires
`agentId: string`. No more `agentConfig` or `systemPrompt` in the options.

### 9.3 Idle Snapshot Exemption

**`apps/gateway/src/hub/session-hub.ts`** line 622-625:

```ts
// Before:
if (clientType === "automation") return false;

// After:
if (clientType === "automation" || clientType === "agent") return false;
```

### 9.4 Orphan Sweeper

**`apps/gateway/src/sweeper/orphan-sweeper.ts`** — when cleaning up an orphan,
read `agent_id` from the session. If present, set `pauseReason: "agent_idle"`
instead of `"orphaned"`.

### 9.5 Integration Token Resolution

The gateway's session runtime currently resolves integration tokens from
`automation_connections`. This moves to `agent_connections`. Update the token
resolution query to join through `agent_connections` via the session's
`agentId` FK instead of through `automation_connections` via `automationId`.

---

## 10. Context Rehydration

### Phase 1: Summary Injection (Now)

When an agent creates a new session (whether from a trigger or ad-hoc), inject
prior session summaries into the prompt. Uses the existing `outcome` and
`summary` columns on sessions.

Implementation: see §8.3 for trigger-driven sessions, and `agents.askAgent()`
for ad-hoc sessions (same pattern).

### Phase 2: `session_events` Table (Deferred)

A durable event log in Postgres would enable injecting specific tool calls,
code diffs, and conversation turns into the context window — not just summaries.
Deferred until the outbound WS bridge exists.

---

## 11. Session Lifecycle

### State Machine

No changes to the states themselves:

```
starting → running → paused | stopped | failed
```

### `pauseReason` Extensions

| Value | Meaning | Sweeper |
|---|---|---|
| `null` | User-initiated pause | Normal |
| `"orphaned"` | Gateway lost contact | Normal |
| `"automation_completed"` | Automation finished | Skip |
| `"agent_idle"` | Agent sleeping between tasks | Skip |
| `"agent_hibernated"` | Agent sandbox killed, snapshot kept | Skip |

### `clientType` Extensions

| Value | Meaning |
|---|---|
| `"web"` | User in browser |
| `"cli"` | User via CLI |
| `"slack"` | Slack bot |
| `"automation"` | Trigger-driven via automation |
| `"agent"` | Ad-hoc via `agents.ask` |

---

## 12. Naming Cleanup

With agent as the primary entity, some naming is confusing:

| Current | Issue | Rename |
|---|---|---|
| `packages/shared/src/agents.ts` | Defines `AgentConfig`, `ModelId` — model selection, not the Agent entity | `packages/shared/src/models.ts` |
| `AgentConfig` type | Confusing now that "Agent" means the entity | `ModelConfig` |
| `AgentType` type | Same confusion | `CodingEngineType` or just keep, it's small |
| `AgentInfo` type | Same | `CodingEngineInfo` |
| `getDefaultAgentConfig()` | Same | `getDefaultModelConfig()` |
| `automation_connections` table | Connections now belong to agents | Drop, replaced by `agent_connections` |
| `AGENTS` registry constant | Registry of coding engines, not Agent entities | `CODING_ENGINES` or `MODEL_REGISTRY` |

The rename of `packages/shared/src/agents.ts` → `models.ts` is important to
avoid confusion between the file that defines LLM model selection (`ModelId`,
`ModelConfig`) and the new Agent entity. Every import of the old file across the
codebase needs updating — this is a clean break, not a compatibility shim.

---

## 13. Migration

Since we don't care about backward compatibility, the migration is a clean
break:

### 13.1 Data Migration Script

```sql
-- 1. Create agents table
CREATE TABLE agents (...);

-- 2. Migrate automations → agents (one agent per automation)
INSERT INTO agents (
  id, organization_id, name, description, enabled,
  system_prompt, agent_type, model_id, enabled_tools,
  default_configuration_id, allow_agentic_repo_selection,
  config_selection_strategy, fallback_configuration_id,
  allowed_configuration_ids, notification_config,
  created_by, created_at, updated_at
)
SELECT
  gen_random_uuid(), organization_id, name, description, enabled,
  agent_instructions, COALESCE(agent_type, 'opencode'), COALESCE(model_id, 'claude-sonnet-4-20250514'),
  COALESCE(enabled_tools, '{}'),
  default_configuration_id, COALESCE(allow_agentic_repo_selection, false),
  COALESCE(config_selection_strategy, 'fixed'), fallback_configuration_id,
  allowed_configuration_ids,
  jsonb_build_object(
    'type', CASE
      WHEN notification_destination_type = 'slack_dm_user' THEN 'slack_dm'
      WHEN notification_destination_type = 'slack_channel' THEN 'slack_channel'
      ELSE 'none'
    END,
    'slackUserId', notification_slack_user_id,
    'channelId', notification_channel_id,
    'slackInstallationId', notification_slack_installation_id::text
  ),
  created_by, created_at, updated_at
FROM automations;

-- 3. Create a mapping table for automation → agent ID linkage
-- (temporary, used for FK updates)
CREATE TEMP TABLE automation_agent_map AS
SELECT a.id AS automation_id, ag.id AS agent_id
FROM automations a
JOIN agents ag ON ag.organization_id = a.organization_id AND ag.name = a.name;

-- 4. Add agent_id to automations, backfill from map
ALTER TABLE automations ADD COLUMN agent_id UUID REFERENCES agents(id) ON DELETE CASCADE;
UPDATE automations SET agent_id = m.agent_id
FROM automation_agent_map m WHERE automations.id = m.automation_id;
ALTER TABLE automations ALTER COLUMN agent_id SET NOT NULL;

-- 5. Add agent_id to sessions, backfill from automation linkage
ALTER TABLE sessions ADD COLUMN agent_id UUID REFERENCES agents(id) ON DELETE CASCADE;
UPDATE sessions s SET agent_id = a.agent_id
FROM automations a WHERE s.automation_id = a.id;

-- 6. Create default agents for sessions without automations
-- (manual sessions created by users)
INSERT INTO agents (id, organization_id, name, created_by, created_at)
SELECT DISTINCT ON (organization_id, created_by)
  gen_random_uuid(), organization_id,
  COALESCE(u.name, 'Default') || '''s Agent',
  created_by, NOW()
FROM sessions s
LEFT JOIN "user" u ON u.id = s.created_by
WHERE s.agent_id IS NULL AND s.created_by IS NOT NULL;

UPDATE sessions s SET agent_id = ag.id
FROM agents ag
WHERE s.agent_id IS NULL
  AND s.organization_id = ag.organization_id
  AND s.created_by = ag.created_by
  AND ag.slug IS NULL;  -- default agents have no slug yet

-- 7. Handle remaining orphan sessions (no created_by)
-- Create an org-level default agent for these
INSERT INTO agents (id, organization_id, name, created_at)
SELECT DISTINCT ON (organization_id)
  gen_random_uuid(), organization_id, 'Default Agent', NOW()
FROM sessions
WHERE agent_id IS NULL;

UPDATE sessions s SET agent_id = ag.id
FROM agents ag
WHERE s.agent_id IS NULL
  AND s.organization_id = ag.organization_id
  AND ag.name = 'Default Agent';

ALTER TABLE sessions ALTER COLUMN agent_id SET NOT NULL;

-- 8. Migrate automation_connections → agent_connections
CREATE TABLE agent_connections (...);
INSERT INTO agent_connections (agent_id, integration_id, created_at)
SELECT DISTINCT a.agent_id, ac.integration_id, ac.created_at
FROM automation_connections ac
JOIN automations a ON a.id = ac.automation_id;

-- 9. Drop moved columns from automations
ALTER TABLE automations
  DROP COLUMN agent_instructions,
  DROP COLUMN agent_type,
  DROP COLUMN model_id,
  DROP COLUMN enabled_tools,
  DROP COLUMN default_configuration_id,
  DROP COLUMN allow_agentic_repo_selection,
  DROP COLUMN config_selection_strategy,
  DROP COLUMN fallback_configuration_id,
  DROP COLUMN allowed_configuration_ids,
  DROP COLUMN notification_destination_type,
  DROP COLUMN notification_channel_id,
  DROP COLUMN notification_slack_user_id,
  DROP COLUMN notification_slack_installation_id;

-- 10. Drop moved columns from sessions
ALTER TABLE sessions
  DROP COLUMN agent_config,
  DROP COLUMN system_prompt;

-- 11. Drop old junction table
DROP TABLE automation_connections;

-- 12. Indexes
CREATE INDEX idx_agents_org ON agents(organization_id);
CREATE INDEX idx_automations_agent ON automations(agent_id);
CREATE INDEX idx_sessions_agent ON sessions(agent_id);
```

### 13.2 Code Migration Order

1. **Schema**: Create `agents` Drizzle schema, update `sessions` + `automations`
   schemas, generate migration
2. **Services**: Create `agents/` module, update `automations/` and `sessions/`
   services + mappers
3. **Contracts**: Create `contracts/agents.ts`, update `sessions.ts` +
   `automations.ts`, update `index.ts`
4. **Routes**: Create `agents` router, update `automations` + `sessions` routers
5. **Worker**: Update `handleExecute` and `resolveTarget` to read from agent
6. **Gateway**: Update session runtime, session creator, session store, sweeper
7. **Rename**: `agents.ts` → `models.ts` + update all imports

---

## 14. File Manifest

### New Files

| File | Purpose |
|------|---------|
| `packages/db/src/schema/agents.ts` | Drizzle table + relations |
| `packages/db/src/schema/agent-connections.ts` | Junction table |
| `packages/db/drizzle/XXXX_agents.sql` | Migration |
| `packages/shared/src/contracts/agents.ts` | Zod schemas + ts-rest contract |
| `packages/services/src/agents/db.ts` | Drizzle queries |
| `packages/services/src/agents/service.ts` | Business logic |
| `packages/services/src/agents/mapper.ts` | Row → contract type |
| `packages/services/src/agents/index.ts` | Barrel |
| `packages/services/src/types/agents.ts` | Input types |
| `apps/web/src/server/routers/agents.ts` | oRPC handlers |

### Modified Files

| File | Change |
|------|--------|
| `packages/db/src/schema/sessions.ts` | Add `agentId` (NOT NULL), remove `agentConfig` + `systemPrompt` |
| `packages/db/src/schema/automations.ts` | Add `agentId` (NOT NULL), remove 14 agent-identity columns |
| `packages/db/src/schema/index.ts` | Export agents + agent-connections |
| `packages/shared/src/contracts/sessions.ts` | Add `agentId` + `agent`, remove `agentConfig` |
| `packages/shared/src/contracts/automations.ts` | Strip to lean schema, add `agentId` + `agent` |
| `packages/shared/src/contracts/index.ts` | Register agents contract |
| `packages/shared/src/agents.ts` | **Rename to `models.ts`** — `AgentConfig` → `ModelConfig`, etc. |
| `packages/services/src/types/sessions.ts` | `agentId` required, remove `agentConfig` + `systemPrompt` |
| `packages/services/src/sessions/service.ts` | `createSession` requires `agentId` |
| `packages/services/src/sessions/mapper.ts` | Map agent relation, remove `agentConfig` |
| `packages/services/src/automations/service.ts` | Require `agentId`, remove agent-config fields |
| `packages/services/src/automations/mapper.ts` | Strip removed fields, add agent summary |
| `packages/services/src/index.ts` | Export agents module |
| `apps/web/src/server/routers/index.ts` | Register agents router |
| `apps/web/src/server/routers/automations.ts` | Strip agent-config fields from handlers |
| `apps/web/src/server/routers/sessions.ts` | Resolve default agent on manual create |
| `apps/worker/src/automation/index.ts` | Read config from agent, context rehydration |
| `apps/worker/src/automation/resolve-target.ts` | Read config from agent instead of automation |
| `apps/worker/src/automation/notifications.ts` | Read notification config from agent |
| `apps/gateway/src/hub/session-runtime.ts` | Read agent config from agent relation |
| `apps/gateway/src/hub/session-hub.ts` | Add `"agent"` to idle exemption |
| `apps/gateway/src/lib/session-creator.ts` | Require `agentId`, remove `agentConfig` |
| `apps/gateway/src/lib/session-store.ts` | Join agent relation in session context query |
| `apps/gateway/src/sweeper/orphan-sweeper.ts` | Agent-aware `pauseReason` |

### Deleted

| File/Table | Reason |
|------|--------|
| `automation_connections` table | Replaced by `agent_connections` |
| Various columns on `automations` | Moved to `agents` (14 columns) |
| `agent_config` + `system_prompt` on `sessions` | Read from agent at runtime |

---

*This document should be read alongside `docs/architecture-strategic-review.md`.
Update `docs/specs/` when implementing.*
