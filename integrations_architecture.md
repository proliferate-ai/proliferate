# Proliferate: Unified Integrations Architecture

> Canonical architecture spec — February 2026
> Supersedes prior integration design fragments across `packages/services/src/actions/`, `packages/triggers/src/`, `apps/trigger-service/`, and `apps/web/src/app/api/webhooks/`.

---

## 1. Problem Statement

Today, adding a new external integration to Proliferate means touching 3–4 files across different packages with different interfaces. Action adapters live in `packages/services/src/actions/`, trigger providers in `packages/triggers/src/providers/`, webhook handlers in both `apps/trigger-service/` and `apps/web/src/app/api/webhooks/` (a known dual-ingestion bug), and OAuth config in yet another place. There's no single answer to "what can Proliferate do with Linear?" — you have to read across the entire codebase to find out.

The goal of this architecture is to make each integration a self-contained, declarative module: one directory that defines everything about a provider (connection requirements, actions, triggers, webhook parsing, polling logic), consumed by framework systems (the gateway action pipeline, the trigger service, the automation pipeline) that remain provider-agnostic.

---

## 2. Core Design Principles

**Provider code is stateless.** Providers receive tokens, cursors, config, and secrets as arguments. They never read from PostgreSQL, write to Redis, schedule BullMQ jobs, or manage any lifecycle state. The framework does all of that.

**Providers declare what they need, not how it's fulfilled.** A provider says `type: "oauth2"`, not `"nango"`. If we replace Nango with first-party OAuth via Arctic, zero provider code changes.

**Three fundamentally different action source types stay separate.** Code-defined providers (Linear, Sentry), MCP connectors (runtime-discovered, org-configured), and database connectors (TCP, connection strings) are different enough that forcing them into one interface creates more problems than it solves. They share a thin seam (`ActionSource`) at the agent-facing layer.

**Triggers are exclusively an IntegrationProvider concept.** MCP connectors and database connectors have no trigger capability. Triggers require provider-specific parsing, filtering, and event normalization that can't be discovered dynamically.

**The permissioning system is source-agnostic.** Every action from every source type has exactly one mode — allow, deny, or require_approval — resolved the same way regardless of whether it comes from a static provider, an MCP connector, or a database connector. The approval pipeline sits above the `ActionSource` interface and has no source-specific branches.

---

## 3. Two-Layer Architecture

The system splits into two layers with a clear boundary between them.

```
What the agent sees:
                ┌──────────────────────────┐
                │   GET /actions/available  │
                │                          │
                │   • linear.create_issue   │
                │   • sentry.list_issues    │
                │   • mcp:ctx7.search_docs  │
                │   • db:prod.run_query     │
                │                          │
                │   (one flat list)         │
                └────────┬─────────────────┘
                         │
          ┌──────────────┼──────────────┐
          │              │              │
          ▼              ▼              ▼
┌─────────────┐  ┌────────────┐  ┌───────────┐
│  Provider    │  │  MCP       │  │  Database  │
│  Registry    │  │  Connector │  │  Connector │
│              │  │  Manager   │  │  Manager   │
│  Static,     │  │  Dynamic,  │  │  Direct    │
│  code-defined│  │  runtime-  │  │  TCP,      │
│  OAuth/API   │  │  discovered│  │  conn      │
│  tokens      │  │  API keys  │  │  strings   │
└─────────────┘  └────────────┘  └───────────┘

Layer 1: IntegrationProvider          Layer 2: ActionSource
(code-defined, compile-time)          (agent-facing, source-agnostic)
```

**Layer 1: IntegrationProvider** — for providers where we write the code. Each provider is a stateless module that declares its connection requirements, actions, and triggers. The framework injects tokens, cursors, and secrets. A single provider object declares everything about one external service.

**Layer 2: ActionSource** — a thin interface that the gateway's action pipeline consumes. Every action source (static providers, MCP connectors, database connectors) implements this so the agent sees one flat list and the approval pipeline doesn't care where actions came from.

### Why these don't collapse into one interface

| Dimension | Provider Registry | MCP Connectors | Database Connectors |
|---|---|---|---|
| **Configured via** | Code + OAuth flow | Admin pastes URL + API key | Admin pastes connection string |
| **Capabilities known** | Compile time | Runtime (`tools/list`) | Compile time (fixed: `run_query`, `list_tables`) |
| **Auth model** | OAuth tokens, bot tokens, app JWTs | API keys | Connection strings |
| **Triggers** | Yes (webhook + polling) | No | No |
| **Provider-specific code** | ~200–500 lines per provider | Zero | Minimal SQL execution wrapper |

Forcing MCP connectors into `IntegrationProvider` would mean adding stubs for `triggers`, `connections`, and `webhook` that are never used. Forcing providers into a flat `ActionSource` would lose the trigger system entirely. The two-layer split keeps both sides clean.

---

## 4. The IntegrationProvider Interface

This is the full interface a code-defined provider implements. Everything is optional except `meta` — a provider can declare only actions, only triggers, both, or neither.

```typescript
// packages/providers/src/types.ts

// ─── Provider Identity ───────────────────────────────────────────────

interface ProviderMeta {
  id: string;                          // "linear", "sentry", "github", "slack"
  name: string;                        // "Linear"
  description?: string;
  icon?: { kind: "svg" | "url"; value: string };
}

// ─── Connection Requirements ─────────────────────────────────────────
//
// Declarative: providers say WHAT they need, not HOW it's fulfilled.
// The framework resolves credentials via getToken() and injects them.
//
// Supports multiple named credentials per provider to handle cases
// like GitHub (org-level App token for triggers, user-level OAuth
// for commit authorship, with fallback).

type ConnectionType =
  | "oauth2"              // Linear, Sentry, Jira, user-scoped GitHub
  | "app_installation"    // GitHub App (org-scoped)
  | "bot_token"           // Slack
  | "api_key"             // PostHog, generic
  | "none";               // Custom webhooks, no auth needed

interface ConnectionRequirement {
  type: ConnectionType;
  scope: "org" | "user";
  scopes?: string[];       // OAuth scopes needed (e.g., ["repo", "read:org"])
  optional?: boolean;      // If true, provider works without this credential
  preset?: string;         // Stable OAuth preset hint (e.g., "linear", "jira")
                           // Maps to Arctic presets or Nango integration keys.
                           // NOT Nango-specific — survives auth layer replacement.
}

// Providers declare one or two named credentials.
// Actions can specify which credential to prefer.

interface ProviderConnections {
  org: ConnectionRequirement;
  user?: ConnectionRequirement;    // Optional user-scoped credential
}

// ─── Actions ─────────────────────────────────────────────────────────

// Risk annotations are static hints used ONLY to suggest default modes
// during admin onboarding. They are NOT runtime enforcement tiers.
// Actual enforcement uses the three-mode system (allow/deny/require_approval).
type RiskLevel = "read" | "write";

interface ActionDefinition<TParams = unknown, TResult = unknown> {
  id: string;                      // "create_issue", "run_query"
  title: string;
  description: string;
  risk: RiskLevel;                 // Always static. Used to infer default mode.
                                   // "read" → default allow, "write" → default require_approval

  // Zod schema for params. Provides:
  //   - Runtime validation (parse)
  //   - JSON Schema export (for agent guide + UI)
  //   - Enum/array/nested object support (solving §5.3 limitations)
  params: z.ZodType<TParams>;
  result?: z.ZodType<TResult>;

  examples?: Array<{
    description?: string;
    params: TParams;
  }>;

  // Which credential to use for this action.
  // Default: "org".
  // For Git operations: { prefer: "user", fallback: "org" }
  credential?: "org" | "user" | { prefer: "user"; fallback: "org" };

  execute(ctx: ActionContext, params: TParams): Promise<TResult>;
}

interface ActionContext {
  organizationId: string;
  sessionId: string;
  userId?: string;
  token: string;                   // Resolved by framework via getToken()
  signal?: AbortSignal;            // For timeout/cancellation
  logger?: Logger;
}

interface ProviderActions {
  guide?: string;                  // Provider-specific markdown for agent consumption
  definitions: ActionDefinition[];
}

// ─── Triggers ────────────────────────────────────────────────────────

interface NormalizedTriggerEvent {
  provider: string;                // "linear", "sentry"
  eventType: string;               // Internal type (e.g., "issue.created")
  providerEventType: string;       // Native type (e.g., "issues.opened")
  occurredAt: string;              // ISO 8601
  dedupKey: string;                // For (trigger_id, dedup_key) unique index
  title: string;                   // Human-readable summary
  url?: string;                    // Link to the event in the provider
  context: Record<string, unknown>; // Provider-specific structured data
  raw?: unknown;                   // Original payload (optional)
}

// A trigger type represents one kind of event a user can subscribe to.
// Multiple triggers can exist for the same type with different configs
// (e.g., one Sentry trigger for prod errors, another for staging warnings).

interface TriggerType<TConfig = unknown> {
  id: string;                      // Matches triggers.event_type in DB
  title: string;
  description: string;
  config: {
    schema: z.ZodType<TConfig>;    // Config schema for UI + validation
    ui?: { summary?: string };
  };

  // MUST be pure and fast. No API calls. No side effects.
  // Framework calls this per-trigger to filter events.
  // Receives the normalized event (possibly hydrated) and the trigger's config.
  matches(event: NormalizedTriggerEvent, config: TConfig): boolean;
}

// ─── Webhook Handling ────────────────────────────────────────────────

// Transport-agnostic webhook input. Framework constructs this from
// Express req regardless of whether the webhook came via Nango or direct.
interface WebhookRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string | undefined>;
  params: Record<string, string | undefined>;
  rawBody: Buffer;
}

// Provider extracts an identity for routing. Framework resolves
// identity → org → triggers. Provider never touches the database.
type WebhookIdentity =
  | { kind: "trigger"; triggerId: string }              // PostHog, custom
  | { kind: "integration"; externalId: string }         // GitHub (installationId)
  | { kind: "org"; organizationId: string };

interface WebhookVerificationResult {
  ok: boolean;
  immediateResponse?: {            // For challenge-response (Slack, Jira)
    status: number;
    body?: unknown;
    headers?: Record<string, string>;
  };
  identity?: WebhookIdentity;     // For routing to org/triggers
  json?: unknown;                 // Parsed body (if ok)
  error?: string;
}

// Ingestion-neutral parse input. Both Nango and direct routes populate
// this identically. Providers never branch on "am I behind Nango?"
interface WebhookParseInput {
  json: unknown;
  providerEventType?: string;     // From X-GitHub-Event header or Nango envelope
  headers?: Record<string, string | string[] | undefined>;
  receivedAt: string;             // ISO 8601
}

interface WebhookHandlerSpec {
  // Pure verification. Secret material provided by framework (from env/config/DB).
  verify(req: WebhookRequest, secret: string | null): Promise<WebhookVerificationResult>;

  // Convert verified payload into normalized events.
  // Uses WebhookParseInput so it's ingestion-neutral.
  parse(input: WebhookParseInput): Promise<NormalizedTriggerEvent[]>;
}

// ─── Polling ─────────────────────────────────────────────────────────

interface PollContext<TConfig = unknown> {
  organizationId: string;
  triggerId: string;
  config: TConfig;
  cursor: unknown;                 // Framework stores/loads; provider interprets
  token?: string;                  // Resolved by framework via getToken()
}

interface PollResult {
  events: NormalizedTriggerEvent[];
  nextCursor: unknown;
  backoffSeconds?: number;         // Rate limit hint for scheduler
}

interface PollingHandlerSpec<TConfig = unknown> {
  defaultIntervalSeconds: number;  // Default: 60
  minIntervalSeconds: number;      // Floor: 30
  poll(ctx: PollContext<TConfig>): Promise<PollResult>;
}

// ─── Hydrate (Optional) ─────────────────────────────────────────────
//
// For providers where the webhook payload doesn't contain enough fields
// for matches() to work (e.g., Jira JQL filtering). Called ONCE per
// event, not per trigger. Result is cached and reused across all
// triggers for that provider.

type HydrateFunction = (
  event: NormalizedTriggerEvent,
  ctx: { token?: string }
) => Promise<NormalizedTriggerEvent>;

// ─── Provider Triggers ───────────────────────────────────────────────

interface ProviderTriggers {
  types: TriggerType[];
  hydrate?: HydrateFunction;       // Optional once-per-event enrichment
  webhook?: WebhookHandlerSpec;
  polling?: PollingHandlerSpec;
}

// ─── The Provider ────────────────────────────────────────────────────

interface IntegrationProvider {
  meta: ProviderMeta;
  connections: ProviderConnections;
  actions?: ProviderActions;
  triggers?: ProviderTriggers;
}
```

### Key design decisions in this interface

**Risk annotations are static hints, not enforcement.** `risk: "read" | "write"` exists on every action definition, but it only controls one thing: what the default mode is when no admin override exists. `read` → default `allow`, `write` → default `require_approval`. An admin can override any action to any mode. There's no `danger` tier that "unconditionally denies" — if an admin wants to allow `delete_issue`, they can. This keeps the system simple and gives admins full control. For DB connectors and MCP tools, the admin sets modes per-tool at onboarding time.

**Multiple named credentials.** `connections.org` + `connections.user?` handles the GitHub case: org-level App token for triggers, user-level OAuth for commit authorship. Per-action `credential` preference (with fallback) means the framework resolves the right token without the provider touching the database. This also cleanly models the eventual user-scoped connections described in the original architecture doc (§6.3).

**`hydrate()` as a first-class escape hatch.** Complex providers (Jira with JQL, GitHub with label-based filtering) may need additional API data for `matches()` to work. `hydrate()` runs once per event (not per trigger), its result is cached, and `matches()` stays pure and fast. For simple providers where the webhook payload is rich enough (Sentry, Linear), `hydrate` is `undefined` and skipped.

**Ingestion-neutral parse input.** Both the Nango route and direct webhook routes populate the same `WebhookParseInput` shape. The Nango route extracts `providerEventType` from the envelope; the direct route extracts it from headers (e.g., `X-GitHub-Event`). Provider parse code never branches on "am I behind Nango?" This is what makes the Nango isolation story actually hold.

**Zod for schemas.** Replaces the minimal `ActionParam` type (which couldn't express enums, arrays, or nested objects). Zod provides runtime validation (`parse`), JSON Schema export (for agent guide + UI), and rich type inference. Every provider already uses TypeScript, so Zod adds no cognitive overhead.

---

## 5. The ActionSource Interface

This is the agent-facing seam. The gateway's `GET /actions/available` route collects `ActionSource[]`, calls `listActions()` on each, and merges results into one flat list. The approval pipeline consumes `ActionSource` and is completely source-agnostic.

```typescript
// packages/providers/src/action-source.ts

interface ActionSource {
  // Stable internal ID. Use UUID-based IDs for dynamic sources
  // (e.g., "connector:<uuid>", "db:<uuid>") to survive renames.
  // Static providers use their meta.id (e.g., "linear", "sentry").
  id: string;

  meta?: { name: string; description?: string; icon?: string };

  // Context is required — availability is session-scoped (session_connections)
  // and org-scoped (org_connectors). Without context, you'd have to construct
  // per-request ActionSource instances, which is awkward and stateful.
  listActions(ctx: ActionContext): Promise<{
    guide?: string;
    definitions: ActionDefinition[];
  }>;

  execute(
    actionId: string,
    params: Record<string, unknown>,
    ctx: ActionContext
  ): Promise<unknown>;
}
```

### How each source type implements ActionSource

**Static providers (Linear, Sentry, Slack):** An adapter wraps `IntegrationProvider.actions`, resolving the token via `getToken()` and delegating to the provider's `execute()`. The adapter is mechanical — ~30 lines per provider.

**MCP connectors:** The `McpConnectorActionSource` calls `tools/list` on the configured MCP server (cached 5 minutes), maps tool definitions to `ActionDefinition[]`, and maps `tools/call` to `execute()`. Risk levels are assigned by the admin during connector onboarding (with name-based heuristic suggestions). Scoped org-wide via `org_connectors`.

**Database connectors:** The `DatabaseActionSource` exposes fixed actions (`run_query`, `list_tables`, `describe_table`). Each action gets a static risk annotation (`list_tables` = read, `run_query` = write). The admin sets the mode (allow/deny/require_approval) per-tool at onboarding time. Execution opens a TCP connection, runs the query, and returns results with row/column limits.

### MCP tool drift detection

MCP tools can change at runtime — schema changes, semantics changes, risk hint changes. If an admin set a tool to `allow` and the tool later becomes destructive, the mode should be re-evaluated.

Every `ActionDefinition` gets a stable hash computed from: `actionId + JSON.stringify(params.jsonSchema) + description`. This hash is stored on the connector's `tool_risk_overrides`. When `tools/list` returns a tool whose hash differs from the stored hash, the system flags the tool as "changed since last review" in the admin UI and resets its mode to `require_approval` until the admin re-confirms. This is lightweight (one hash comparison per listing) and prevents stale permissions on dynamic sources.

```typescript
function computeDefinitionHash(def: ActionDefinition): string {
  const content = JSON.stringify({
    id: def.id,
    schema: zodToJsonSchema(def.params),
    description: def.description,
  });
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}
```

---

## 6. Provider Registry

The registry is a static `Map<string, IntegrationProvider>` populated at boot. It answers "what exists in the codebase?" — not "what's enabled for this org."

```typescript
// packages/providers/src/registry.ts

import { linear } from "./providers/linear";
import { sentry } from "./providers/sentry";
import { github } from "./providers/github";
import { slack } from "./providers/slack";
import { posthog } from "./providers/posthog";

const providers = new Map<string, IntegrationProvider>([
  ["linear", linear],
  ["sentry", sentry],
  ["github", github],
  ["slack", slack],
  ["posthog", posthog],
]);

// Boot-time validation (catches registration bugs early)
function validateRegistry(registry: Map<string, IntegrationProvider>): void {
  const ids = new Set<string>();
  for (const [key, provider] of registry) {
    if (key !== provider.meta.id) {
      throw new Error(`Registry key "${key}" !== provider.meta.id "${provider.meta.id}"`);
    }
    if (ids.has(key)) {
      throw new Error(`Duplicate provider ID: "${key}"`);
    }
    ids.add(key);

    // Validate action ID uniqueness within provider
    const actionIds = new Set<string>();
    for (const action of provider.actions?.definitions ?? []) {
      if (actionIds.has(action.id)) {
        throw new Error(`Duplicate action "${action.id}" in provider "${key}"`);
      }
      actionIds.add(action.id);
    }

    // Validate trigger type ID uniqueness within provider
    const triggerIds = new Set<string>();
    for (const type of provider.triggers?.types ?? []) {
      if (triggerIds.has(type.id)) {
        throw new Error(`Duplicate trigger type "${type.id}" in provider "${key}"`);
      }
      triggerIds.add(type.id);
    }

    // Validate connection coherence
    if (provider.connections.org.type === "oauth2" && !provider.connections.org.scopes?.length) {
      console.warn(`Provider "${key}" declares oauth2 but no scopes — intentional?`);
    }
  }
}

validateRegistry(providers);
export { providers as ProviderRegistry };
```

### Availability resolution (separate from registry)

"What's enabled for this org/session?" is data-driven, not code-driven. The registry doesn't know about orgs. A separate `ProviderAvailabilityResolver` (consumed by the gateway's `GET /actions/available` route) handles this:

```
Request: GET /:sessionId/actions/available

1. Load session context (session_connections + org_connectors)
2. For each session_connection:
   - Look up provider in ProviderRegistry
   - If provider has actions, create a ProviderActionSource (wraps IntegrationProvider)
   - Add to ActionSource[]
3. For each org_connector:
   - Create McpConnectorActionSource
   - Add to ActionSource[]
4. For each database connector (future):
   - Create DatabaseActionSource
   - Add to ActionSource[]
5. Call listActions(ctx) on each ActionSource
6. Merge + return flat list
```

The registry is static. Enabling/disabling is org config in PostgreSQL. Boot-time validation catches code bugs. Runtime availability catches config issues.

---

## 7. File Structure

```
packages/providers/
├── src/
│   ├── index.ts                     # Exports registry, types, ActionSource adapters
│   ├── types.ts                     # All interfaces from §4
│   ├── action-source.ts             # ActionSource interface + ProviderActionSource adapter
│   ├── registry.ts                  # Static Map + boot validation
│   │
│   ├── helpers/
│   │   ├── hmac.ts                  # verifyHmacSha256({ rawBody, secret, header })
│   │   ├── http.ts                  # Retry/backoff, pagination, rate limit helpers
│   │   ├── schema.ts               # zodToJsonSchema(), computeDefinitionHash()
│   │   └── errors.ts               # ProviderError { code, message, retryable }
│   │
│   └── providers/
│       ├── linear/
│       │   ├── index.ts             # Assembles + exports LinearProvider
│       │   ├── actions.ts           # create_issue, update_issue, add_comment, list_issues, get_issue
│       │   ├── triggers.ts          # TriggerTypes + poll() + webhook parse()
│       │   ├── schemas.ts           # Shared Zod schemas (issue, comment, team, etc.)
│       │   └── client.ts            # GraphQL client wrapper
│       │
│       ├── sentry/
│       │   ├── index.ts
│       │   ├── actions.ts           # list_issues, get_issue, update_issue, add_comment, get_event
│       │   ├── triggers.ts
│       │   ├── schemas.ts
│       │   └── client.ts
│       │
│       ├── github/
│       │   ├── index.ts
│       │   ├── triggers.ts          # Webhook-only triggers (push, PR, issue events)
│       │   ├── webhooks.ts          # GitHub HMAC signature verify + identity extraction
│       │   └── schemas.ts
│       │
│       ├── slack/
│       │   ├── index.ts
│       │   └── actions.ts           # send_message (no triggers today)
│       │
│       └── posthog/
│           ├── index.ts
│           ├── triggers.ts          # Webhook-only triggers
│           └── webhooks.ts          # PostHog signature verify
```

### Conventions

**Every provider has an `index.ts`.** This is the only required file. It assembles and exports the final `IntegrationProvider` object. If a provider is small (Slack today: one action, no triggers), everything lives in `index.ts` until it grows.

**Everything else is optional.** Don't enforce `actions.ts` / `triggers.ts` / `schemas.ts` for PostHog if it only needs 2 files. Let structure follow complexity.

**Adding a new provider** means creating `providers/<name>/` with an `index.ts` and registering it in `registry.ts`. That's it. The provider directory is the blast radius of the integration — everything about Jira is in `providers/jira/`.

---

## 8. Per-Provider Mapping

How each current (and anticipated) provider maps into the interface.

### Linear

```
meta.id: "linear"
connections:
  org: { type: "oauth2", scope: "org", scopes: ["read", "write"], preset: "linear" }
actions: [create_issue, update_issue, add_comment, list_issues, get_issue]
  All risk: create/update = "write", list/get = "read"
triggers:
  types: [issue_created, issue_updated, comment_created]
  webhook: Nango-forwarded → parse Linear webhook payload
  polling: GraphQL with cursor (existing logic)
```

### Sentry

```
meta.id: "sentry"
connections:
  org: { type: "oauth2", scope: "org", scopes: ["event:read", "org:read"], preset: "sentry" }
actions: [list_issues, get_issue, update_issue, add_comment, get_event]
  risk: update = "write", everything else = "read"
triggers:
  types: [error_created, error_spike]
  webhook: Nango-forwarded → parse Sentry event payload
  config filter: project slug, environment, min severity
```

### GitHub App

```
meta.id: "github"
connections:
  org: { type: "app_installation", scope: "org" }
  user: { type: "oauth2", scope: "user", scopes: ["repo"], optional: true, preset: "github" }
actions: (optional today, add later without touching triggers)
  If added: create_pr, merge_pr, create_issue
  credential: { prefer: "user", fallback: "org" } for authorship-sensitive actions
triggers:
  types: [push, pull_request_opened, issue_opened, issue_comment_created]
  webhook: Direct (not Nango). HMAC signature verify. Identity: { kind: "integration", externalId: installationId }
  No polling needed (GitHub webhooks are reliable and never expire)
```

### Slack

```
meta.id: "slack"
connections:
  org: { type: "bot_token", scope: "org" }
actions: [send_message]
  risk: "write"
triggers: none today
  Future: Socket Mode for real-time workspace events (outbound WS, works behind firewalls)
  NOT polling (Slack can't be polled at workspace scale)
```

### PostHog

```
meta.id: "posthog"
connections:
  org: { type: "none" }  // Webhooks are configured per-trigger, no org-level auth
actions: none
triggers:
  types: [action_performed, event_received]
  webhook: Direct, per-trigger URL (/webhooks/direct/posthog/:triggerId)
  Identity: { kind: "trigger", triggerId } from URL param
  No polling (no suitable API)
```

### Jira (anticipated)

```
meta.id: "jira"
connections:
  org: { type: "oauth2", scope: "org", scopes: ["read:jira-work", "write:jira-work"], preset: "jira" }
actions: [create_issue, update_issue, add_comment, list_issues, transition_issue]
triggers:
  types: [issue_created, issue_updated, issue_transitioned]
  webhook: Direct. Jira HMAC verify.
    Note: Jira webhooks expire after 30 days → framework needs a refresh job
    (stored external_webhook_id on trigger row, BullMQ repeatable job re-registers)
  polling: REST API with JQL cursor (fallback for expired webhooks)
  hydrate: Fetch full issue fields once per event (Jira webhooks are sparse)
    → matches() stays pure even for JQL-style filters
```

---

## 9. Webhook Consolidation

All webhook ingestion moves to the trigger service. The dual-ingestion path (trigger service + web app API routes) is eliminated.

### Two routes, one service

**`POST /webhooks/nango`** — Nango-forwarded webhooks (Sentry, Linear today).

```
1. Verify Nango envelope signature (shared HMAC helper)
2. Extract providerId from envelope (e.g., "linear")
3. Extract providerEventType from envelope
4. Extract raw provider payload from envelope
5. Look up provider in ProviderRegistry
6. Call provider.triggers.webhook.parse({
     json: rawProviderPayload,
     providerEventType: fromEnvelope,
     receivedAt: now
   })
   → NormalizedTriggerEvent[]
7. Resolve identity → org → triggers
8. Generic pipeline: matches() → dedup → create run
```

The provider's `parse()` receives native provider payloads — it has zero awareness that Nango exists. When we replace Nango with first-party OAuth, we route those providers to `/webhooks/direct/:providerId` and delete the Nango route. Zero provider code changes.

**`POST /webhooks/direct/:providerId` (or `/:providerId/:triggerId`)** — Direct webhooks (GitHub, PostHog, custom, future Jira).

```
1. Look up provider in ProviderRegistry
2. Fetch verification secret (from env/config/DB based on identity type)
3. Call provider.triggers.webhook.verify(req, secret)
   → WebhookVerificationResult { ok, identity, json, immediateResponse }
4. If immediateResponse (Slack challenge, Jira verification): return it
5. Extract providerEventType from headers (e.g., X-GitHub-Event)
6. Call provider.triggers.webhook.parse({
     json: verifiedPayload,
     providerEventType: fromHeaders,
     headers: req.headers,
     receivedAt: now
   })
   → NormalizedTriggerEvent[]
7. Resolve identity → org → triggers
8. Generic pipeline: matches() → dedup → create run
```

### The generic pipeline (shared by both routes)

```
NormalizedTriggerEvent[]
    │
    ├── For each event:
    │   ├── If provider.triggers.hydrate exists:
    │   │   └── Call hydrate(event, { token }) ONCE, cache result
    │   │
    │   ├── Find all active triggers for this provider + org
    │   │
    │   ├── For each trigger:
    │   │   ├── Load trigger config
    │   │   ├── Call provider.triggers.types[i].matches(event, config)
    │   │   └── If matches:
    │   │       ├── Check dedup: (trigger_id, event.dedupKey) unique index
    │   │       └── If not duplicate:
    │   │           └── INSERT trigger_event + automation_run + outbox
    │   │               (single transaction)
    │   │
    └── Return 200 OK
```

### Migration path

**Option A (preferred): Infra cutover with path-based routing.** If the deployment uses an ingress/load balancer, route `/api/webhooks/**` to the trigger service and everything else to the web app. Delete the Next.js webhook routes.

**Option B (temporary): Internal forwarding.** Keep Next.js routes temporarily, have them forward raw body + headers to the trigger service internally. Once external webhook configs are updated (provider dashboards pointing to the new URLs), remove the Next routes.

**Nango deduplication:** Choose one canonical Nango target URL (trigger service's `/webhooks/nango`). Remove the duplicate web app Nango handler.

### Webhook secret resolution: the chicken-and-egg problem

Some providers need the secret before verification, but the secret may depend on identity (which is inside the unverified body). In practice this is manageable because:

- GitHub App: webhook secret is instance-level (one secret for the app)
- Slack: signing secret is app-level
- Nango: envelope secret is instance-level
- PostHog/custom: per-trigger URL (secret selection by path param)

For future providers where secrets are per-integration-instance, use a two-step approach: extract an untrusted "candidate identity" from headers/path, look up the secret, then verify. Document this as a first-class pattern so it doesn't become ad hoc.

---

## 10. Polling Infrastructure

Polling stays in the trigger service via BullMQ repeatable jobs, unchanged from the current architecture. The only change is that the poll function comes from the provider module instead of a standalone adapter class.

```
Framework responsibilities (unchanged):
  - Schedule BullMQ repeatable jobs per active trigger
  - Store/load cursors in Redis (with PostgreSQL backup)
  - Enforce per-org rate limiting
  - Handle 429 backoff
  - Feed results into the generic pipeline

Provider responsibilities (now via IntegrationProvider):
  - Implement poll(ctx) → { events, nextCursor, backoffSeconds? }
  - Interpret cursor format
  - Call provider API and parse results
  - Return NormalizedTriggerEvent[]
```

The provider never schedules jobs, acquires locks, or manages Redis state. It receives a cursor and token, calls the API, and returns events + next cursor.

### Implementing the unused pollLock

The current codebase defines a `pollLock` mechanism that's never used. It should be: concurrent polls for the same trigger waste rate limit budget. Use a Redis lock keyed on `poll:<triggerId>` with TTL equal to the poll interval. If the lock is held, skip the poll cycle.

---

## 11. Connection System Changes

The `getToken()` abstraction boundary is preserved. Providers declare what they need; the framework fulfills it. The main changes are:

### User-scoped connections (new)

```sql
-- New table
user_connections
├── id               UUID PK
├── user_id          TEXT FK(users)
├── provider         TEXT           -- "github"
├── connection_id    TEXT           -- OAuth connection reference
├── status           TEXT           -- "active" | "inactive"
└── timestamps...
```

`getToken()` gains an optional `userId` parameter:

```typescript
async function getToken(
  integration: IntegrationForToken,
  opts?: { userId?: string }
): Promise<string> {
  // For providers that support user-scoped credentials:
  if (opts?.userId) {
    const userConn = await findUserConnection(opts.userId, integration.provider);
    if (userConn) return resolveToken(userConn);
  }
  // Fall back to org-scoped credential
  return resolveOrgToken(integration);
}
```

The action pipeline reads `credential` from the `ActionDefinition`:

- `"org"` → call `getToken(integration)` (current behavior)
- `"user"` → call `getToken(integration, { userId: ctx.userId })`
- `{ prefer: "user", fallback: "org" }` → try user, fall back to org, never fail

### OAuth preset mapping

When adding a new OAuth provider, the framework needs to know authorization URL, token URL, issuer, and provider quirks. The `preset` field on `ConnectionRequirement` provides this mapping without leaking Nango/Arctic specifics into provider code:

```typescript
// Framework-level mapping (not in provider code)
const oauthPresets: Record<string, OAuthConfig> = {
  linear: { /* Arctic preset or Nango integration key */ },
  sentry: { /* ... */ },
  jira:   { /* ... */ },
  github: { /* ... */ },
};
```

Adding a new OAuth provider means: (1) register the preset in this mapping, (2) set `preset: "jira"` on the provider's `ConnectionRequirement`. The provider module itself has no awareness of how OAuth is fulfilled.

---

## 12. Action Permissioning

The old grant-based system (grant matching, CAS budget consumption, session-scoped vs org-wide grants) is replaced with a simpler three-mode system.

### The three modes

Every action has exactly one mode: **allow**, **deny**, or **require_approval**.

**Allow** means the action executes immediately with no human involvement. **Deny** means it never executes — the agent gets an error. **Require_approval** means it blocks until a human approves or denies it.

### Mode resolution

When an invocation arrives, the gateway checks three places in order:

```
1. Automation override: Does the automation this run belongs to have
   an override for this specific (integration, action) pair?
   → If yes, use it.

2. Org default: Does the org have a default for this (integration, action)?
   → If yes, use it.

3. Inferred default: Use the action definition's risk annotation.
   → risk: "read"  → default mode: allow
   → risk: "write" → default mode: require_approval
   → MCP tools with readOnlyHint: true → allow
   → MCP tools with no annotation → require_approval
```

This is the same resolution for all action source types — static providers, MCP connectors, and database connectors.

### Invocation flow

```
CLI POST /:sessionId/actions/invoke
    │
    ├── Validate integration exists and session has access
    ├── Validate params against action schema
    │
    ├── Resolve mode (automation override → org default → inferred)
    │
    ├── If mode = "deny":
    │   └── Return { status: "denied", reason: "policy" } (sync)
    │
    ├── If mode = "allow":
    │   ├── Execute action (source.execute())
    │   ├── Redact + truncate result (max 10KB)
    │   ├── Write audit record
    │   └── Return { status: "executed", result } (sync)
    │
    ├── If mode = "require_approval":
    │   ├── Create invocation record (status: "pending")
    │   ├── Return { status: "pending", invocationId } (sync — CLI polls)
    │   │
    │   ├── Interactive session (human WebSocket clients connected):
    │   │   ├── Broadcast approval request to human clients
    │   │   ├── Dashboard shows action, integration, params
    │   │   ├── Human approves or denies
    │   │   │   ├── "Approve once" → execute, return result
    │   │   │   └── "Approve and set to allow" → execute + update mode config
    │   │   └── 5-minute expiry if no response
    │   │
    │   └── Automation run (no human connected):
    │       ├── Snapshot sandbox
    │       ├── Stop compute, mark run "needs_human"
    │       ├── Send Slack notification with approve/deny buttons
    │       ├── 24-hour expiry
    │       └── On approval:
    │           ├── Execute action
    │           ├── Boot new sandbox from snapshot
    │           └── Send agent: "Action X approved. Result: [...]. Continue."
    │
    └── Audit: Every invocation recorded with action, integration, params,
        result, mode, mode_source, approver (if applicable), timing, status
```

### CLI polling for pending invocations

`POST /invoke` returns synchronously for `allow` and `deny` modes. For `require_approval`, it returns `{ status: "pending", invocationId }` immediately. The CLI polls `GET /:sessionId/actions/invocations/:invocationId` until the status resolves to `executed`, `denied`, or `expired`.

### MCP connector onboarding

When an admin enables a new MCP connector, the system fetches `tools/list`, displays all tools with suggested risk levels (names containing get/list/search suggest `read`, names containing create/update suggest `write`, names containing delete/destroy get a destructive warning badge), and the admin sets allow/deny/require_approval per tool. These overrides are stored as `tool_risk_overrides` JSONB on the `org_connectors` row and used for mode inference at runtime.

### Database schema changes

**Removed:** The `action_grants` table and everything it touched — `grant_id` FK on `action_invocations`, `max_calls`, `used_calls`, `grant_version`, CAS concurrency. The `proliferate actions grant request` CLI command.

**Added:**

```sql
-- Mode overrides stored as JSONB on existing tables
-- organizations.action_modes: { "linear:create_issue": "allow", "sentry:update_issue": "deny", ... }
-- automations.action_modes: { "linear:create_issue": "allow", ... }

-- On action_invocations (new columns):
ALTER TABLE action_invocations ADD COLUMN mode TEXT;          -- 'allow' | 'deny' | 'require_approval'
ALTER TABLE action_invocations ADD COLUMN mode_source TEXT;   -- 'automation_override' | 'org_default' | 'inferred_default'
ALTER TABLE action_invocations ADD COLUMN expires_at TIMESTAMPTZ; -- 5min interactive, 24hr automation
ALTER TABLE action_invocations ADD COLUMN denied_reason TEXT; -- 'policy' | 'human' | 'expired'

-- On org_connectors (new column for MCP tool mode overrides):
ALTER TABLE org_connectors ADD COLUMN tool_risk_overrides JSONB; -- { "search_docs": { "mode": "allow", "hash": "abc123" }, ... }
```

### Rate limiting

60 calls per minute per session stays as abuse protection. Moves from in-memory to Redis (`INCR` on `ratelimit:actions:<sessionId>` with 60-second TTL) to work correctly across multiple gateway instances.

---

## 13. Agent Guide Generation

At session start, the gateway writes `.proliferate/actions-guide.md` to the sandbox. This guide is now generated from the registry + MCP connector tools:

```
For each ActionSource available to this session:
  1. If source has guide text, include it
  2. For each ActionDefinition:
     - Action name: source.id + "." + action.id
     - Description
     - Mode: allow / require_approval / deny (so agent knows what to expect)
     - Parameter schema (from Zod → JSON Schema → readable markdown)
     - Examples (if provided)
```

The agent reads this file, understands what's available, and uses the CLI to invoke actions. The guide is regenerated if session connections change (currently they don't mid-session, but this future-proofs it).

---

## 14. What Stays Separate (Explicit Non-Goals)

These systems are deliberately NOT unified into the provider interface:

**Token resolution and storage.** `getToken()` remains the boundary. Providers declare `connections.org.type` but don't read from PostgreSQL, decrypt secrets, or call Nango. The framework does all credential management.

**The action permissioning system.** Providers declare static risk annotations. The three-mode system (allow/deny/require_approval), mode resolution cascade, approval UX, automation snapshot-stop-resume, and audit logging are all framework concerns. Providers implement `execute()` and nothing else.

**Polling infrastructure.** Providers implement `poll(ctx) → { events, nextCursor }`. BullMQ scheduling, cursor persistence in Redis, per-org rate limiting, lock acquisition, and backoff logic stay in the framework.

**Webhook server plumbing.** Providers implement `verify(req, secret)` and `parse(input)`. Express route handling, raw body capture, secret lookup, error handling, retries, metrics, and logging stay in the trigger service.

**MCP connector discovery.** MCP connectors implement `ActionSource` directly. They're not `IntegrationProvider` instances — they're runtime-configured, dynamically discovered, and have no triggers. The `tools/list` + `tools/call` lifecycle stays in `McpConnectorActionSource`.

---

## 15. Implementation Sequence

### Phase 1: Foundation (Week 1)

1. Create `packages/providers/` with `types.ts`, `action-source.ts`, `registry.ts`, and `helpers/`.
2. Implement `zodToJsonSchema()` and `computeDefinitionHash()` helpers.
3. Port Linear as the reference provider (it has both actions and triggers, covering the most surface area).
4. Write the `ProviderActionSource` adapter that wraps `IntegrationProvider.actions` as an `ActionSource`.
5. Validate that the gateway's `GET /actions/available` route can consume the new `ActionSource` alongside existing MCP connector sources.

### Phase 2: Webhook Consolidation (Week 2)

1. Move all webhook handling into the trigger service.
2. Implement the two-route structure (`/webhooks/nango`, `/webhooks/direct/:providerId`).
3. Implement the generic pipeline with `hydrate()` support.
4. Port GitHub and PostHog webhook handlers into their provider modules.
5. Delete the duplicate Next.js webhook routes.
6. Delete the old `WebhookTrigger` / `PollingTrigger` abstraction layer.

### Phase 3: Remaining Providers (Week 2–3)

1. Port Sentry, Slack, PostHog into the provider structure.
2. Port polling logic into provider `poll()` functions.
3. Update the trigger service polling worker to call `provider.triggers.polling.poll()` instead of the old adapter classes.
4. Delete old adapter code in `packages/services/src/actions/` and `packages/triggers/src/`.

### Phase 4: Action Permissioning (Week 3)

1. Implement the three-mode system (allow/deny/require_approval) with cascading resolution.
2. Add `action_modes` JSONB to `organizations` and `automations` tables.
3. Add `mode`, `mode_source`, `expires_at`, `denied_reason` columns to `action_invocations`.
4. Build the approval UX: WebSocket broadcast for interactive, Slack notification for automation runs.
5. Implement automation snapshot-stop-resume flow for `require_approval` in unattended runs.
6. Implement MCP connector onboarding flow with tool listing, name-based risk suggestions, and per-tool mode overrides.
7. Add `tool_risk_overrides` JSONB to `org_connectors` with definition hashing for drift detection.
8. Move rate limiting to Redis.
9. Remove the `action_grants` table and all grant-related code.
10. Implement the `McpConnectorActionSource` wrapper using the `ActionSource` interface.

### Phase 5: User-Scoped Connections (When Needed)

1. Add `user_connections` table.
2. Update `getToken()` with `userId` parameter.
3. Add user connection UI flow.
4. Update GitHub provider to declare `connections.user` with `{ prefer: "user", fallback: "org" }`.

This is gated on design partner feedback — if they're fine with bot-attributed commits, defer it.

---

## 16. Validation Checklist

Before considering this architecture "done," verify:

- [ ] Adding a new provider (e.g., Jira) requires only: creating `providers/jira/`, registering in `registry.ts`, and adding OAuth preset mapping. No changes to gateway, trigger service, or permissioning system.
- [ ] Removing Nango requires only: swapping `getToken()` implementation for `oauth2` providers, replacing the Connect UI, and rerouting those providers from `/webhooks/nango` to `/webhooks/direct/:providerId`. Zero provider code changes.
- [ ] A `write` action from an MCP connector resolves its mode (allow/deny/require_approval) via the same cascade as a `write` action from Linear. The permissioning system has no source-specific branches.
- [ ] `matches()` never makes API calls. Complex filtering uses `hydrate()` (once per event).
- [ ] DB connector `run_query` is set to allow/deny/require_approval by the admin at onboarding time, same as MCP tools. No runtime SQL classification needed.
- [ ] Webhook identity routing works for all current providers (GitHub: installationId, PostHog: triggerId, Nango: connectionId → org resolution).
- [ ] An MCP tool whose schema changes since the admin last reviewed it is automatically reset to `require_approval` until re-confirmed.
- [ ] `POST /invoke` returns synchronously for `allow` and `deny` modes, and returns `{ status: "pending", invocationId }` for `require_approval`.
- [ ] Automation runs hitting `require_approval` with no human connected trigger snapshot → stop compute → Slack notify → resume from snapshot on approval.