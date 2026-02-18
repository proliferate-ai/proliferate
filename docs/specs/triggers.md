# Triggers — System Spec

## 1. Scope & Purpose

### In Scope
- Trigger CRUD (create, update, delete, list, get)
- Trigger events log and trigger event actions (audit trail)
- Trigger service (`apps/trigger-service/` — dedicated Express app)
- Async webhook inbox pattern (fast-ack + BullMQ worker for reliable ingestion)
- Direct webhook routes: GitHub App installation lifecycle, Nango auth/sync (`apps/web/src/app/api/webhooks/`)
- Webhook dispatch and matching (event → trigger → automation run)
- Integration-scoped polling via poll groups (`trigger_poll_groups` table — one job per group, not per trigger)
- Cron scheduling via SCHEDULED queue (Partial — queue defined, worker not running)
- Provider registry (`packages/triggers/src/service/registry.ts`)
- Provider adapters: GitHub (webhook), Linear (webhook + polling), Sentry (webhook), PostHog (webhook, HMAC), Gmail (polling via Composio)
- `NormalizedTriggerEvent` interface and `ProviderTriggers` contract (`packages/providers/src/types.ts`)
- Schedule CRUD (get, update, delete)
- PubSub session events subscriber
- Handoff to automations (enqueue via outbox `enqueue_enrich`)

### Out of Scope
- Automation run pipeline after handoff — see `automations-runs.md`
- Integration OAuth setup and connection lifecycle — see `integrations.md`
- Session lifecycle — see `sessions-gateway.md`
- Sandbox boot and provider interface — see `sandbox-providers.md`

### Mental Model

Triggers are the inbound event layer of Proliferate. External services (GitHub, Linear, Sentry, PostHog, Gmail) emit events that Proliferate ingests, normalizes, filters, deduplicates, and converts into automation runs. There are three ingestion mechanisms: **webhooks** (provider pushes events — via Nango forwarding to trigger-service, or via direct Next.js API routes for installation lifecycle), **polling** (Proliferate pulls from provider APIs on a schedule), and **scheduled** (pure cron triggers with no external event source — queue defined but worker not yet running).

Webhook ingestion uses the **async webhook inbox** pattern: Express routes do exactly three things — verify signatures, insert into `webhook_inbox`, and return `200 OK`. A BullMQ worker asynchronously drains the inbox, parsing payloads, matching triggers, and creating runs. This decoupling prevents upstream providers from timing out during bulk event storms.

Polling uses **integration-scoped poll groups**: one BullMQ repeatable job per `(organization_id, provider, integration_id)` group, not per trigger. The worker calls the provider API once, then fans out events in-memory to all active triggers in the group. This turns an O(N) network fan-out into a single API call + O(N) in-memory matching.

Every trigger belongs to exactly one automation. When an event passes filtering and deduplication, the trigger processor creates a `trigger_event` record and an `automation_run` record inside a single transaction, using the transactional outbox pattern to guarantee the run will be picked up by the worker.

**Core entities:**
- **Trigger** — a configured event source bound to an automation and an integration. Types: `webhook` or `polling`.
- **Trigger event** — an individual event occurrence, with lifecycle: `queued` → `processing` → `completed`/`failed`/`skipped`.
- **Trigger event action** — audit log of tool executions within a trigger event.
- **Webhook inbox** — raw webhook payloads stored for async processing. Lifecycle: `pending` → `processing` → `completed`/`failed`.
- **Trigger poll group** — groups polling triggers by `(org, provider, integration)` for efficient batch polling.
- **Schedule** — a cron expression attached to an automation for time-based runs.
- **Provider adapter** — a `WebhookTrigger` or `PollingTrigger` subclass that knows how to parse, filter, and contextualize events from a specific external service. Being consolidated into the `ProviderTriggers` contract.
- **NormalizedTriggerEvent** — provider-agnostic representation of an inbound event, defined in `packages/providers/src/types.ts`.

**Core invariants:**
1. **Async Webhook Inbox:** Express webhook routes must do exactly three things: verify signatures, extract routing identity, and `INSERT INTO webhook_inbox`. They must return `200 OK` instantly to prevent upstream rate-limit timeouts.
2. **Integration-Scoped Polling:** Polling is scheduled per poll group (org + provider + integration), NOT per trigger. The worker fetches events once from the provider, then fans out in-memory to evaluate filters across all active triggers.
3. **Pure Matching:** The `matches()` / `filter()` function declared by providers must be strictly pure (no DB calls, no network calls, no side effects).
4. **Stateless Providers:** Providers never read PostgreSQL, write Redis, or schedule jobs. The framework owns all persistence and deduplication.
5. Each trigger belongs to exactly one automation (FK `automation_id`).
6. Deduplication is enforced via a unique index on `(trigger_id, dedup_key)` in `trigger_events`.
7. Polling cursors are stored in `trigger_poll_groups.cursor` (PostgreSQL). Legacy per-trigger Redis cursor storage is being phased out.
8. Webhook signature verification happens at the ingestion layer (Nango HMAC in the fast-ack route, provider-specific signatures in provider adapters).

---

## 2. Core Concepts

### Async Webhook Inbox
External webhooks are received by Express routes in the trigger service. Instead of processing synchronously (which risks timeouts during bulk event storms), the routes verify the signature, store the raw payload in the `webhook_inbox` table, and return `200 OK` immediately. A BullMQ worker (`apps/trigger-service/src/webhook-inbox/worker.ts`) drains the inbox every 5 seconds, parsing payloads, resolving integrations, running trigger matching, and creating automation runs.
- Key detail agents get wrong: the webhook route does NOT parse events, run matching, or create runs. All of that happens asynchronously in the inbox worker.
- Reference: `apps/trigger-service/src/api/webhooks.ts`, `apps/trigger-service/src/webhook-inbox/worker.ts`

### Nango Forwarding
External webhooks from GitHub, Linear, and Sentry are received by Nango, which forwards them to the trigger service as a unified envelope with type `"forward"`. The envelope includes `connectionId`, `providerConfigKey`, and `payload`. The fast-ack route verifies the Nango HMAC signature, extracts the provider and connectionId, and stores the raw payload in the webhook inbox.
- Key detail agents get wrong: the trigger service receives Nango's envelope, not raw provider payloads. The `parseNangoForwardWebhook` function extracts the inner payload.
- Reference: `packages/triggers/src/service/adapters/nango.ts`, `apps/trigger-service/src/lib/webhook-dispatcher.ts`

### Provider Registry (Service Layer)
The trigger service uses a class-based registry (`TriggerRegistry`) with separate maps for webhook and polling triggers. Providers register via `registerDefaultTriggers()` at startup. This registry is used by the webhook inbox worker and polling worker to resolve trigger definitions. The `ProviderTriggers` contract in `packages/providers/src/types.ts` defines the target interface that all integration modules will implement.
- Key detail agents get wrong: two abstraction layers currently coexist — the service-layer `WebhookTrigger`/`PollingTrigger` classes (used by trigger-service) and the `ProviderTriggers` interface (target architecture). Migration to the consolidated `ProviderTriggers` interface is in progress.
- Reference: `packages/triggers/src/service/registry.ts`, `packages/providers/src/types.ts`

### The `ProviderTriggers` Contract
The `ProviderTriggers` interface in `packages/providers/src/types.ts` defines the target trigger contract for integration modules. Key types:
- **`NormalizedTriggerEvent`** — provider-agnostic event representation with `provider`, `eventType`, `providerEventType`, `occurredAt`, `dedupKey`, `title`, `context`, and optional `url`, `externalId`, `raw`.
- **`WebhookRequest`** — normalized HTTP request with mandatory `rawBody: Buffer` for HMAC verification.
- **`WebhookParseInput`** — input to the provider's `parse()` method (json, headers, providerEventType, receivedAt).
- **`WebhookVerificationResult`** — verification result with routing `identity` (org/integration/trigger) and optional `immediateResponse` for challenge protocols.
- **`TriggerType<TConfig>`** — typed trigger definition with pure `matches()` function and Zod `configSchema`.
- Key detail agents get wrong: `matches()` must be pure — no DB calls, no network, no side effects. The framework owns all persistence.
- Reference: `packages/providers/src/types.ts`

### Integration-Scoped Polling (Poll Groups)
Instead of scheduling one BullMQ job per polling trigger (which causes N API calls for N triggers against the same provider), polling is grouped by `(organization_id, provider, integration_id)` in the `trigger_poll_groups` table. One repeatable BullMQ job runs per group. The worker acquires a Redis lock, calls the provider's `poll()` method once, then fans out events in-memory to all active triggers in the group.
- Key detail agents get wrong: the cursor lives on the poll group row, not on individual triggers. All triggers in a group share a single cursor and a single API call.
- Reference: `apps/trigger-service/src/polling/worker.ts`, `packages/services/src/poll-groups/db.ts`

### Transactional Outbox Handoff
When a trigger event passes all checks, `createRunFromTriggerEvent` inserts both the `trigger_event` and `automation_run` rows in a single transaction, plus an outbox entry with kind `enqueue_enrich`. The outbox dispatcher (owned by `automations-runs.md`) picks this up.
- Key detail agents get wrong: the handoff is NOT a direct BullMQ enqueue. It goes through the outbox for reliability.
- Reference: `packages/services/src/runs/service.ts:createRunFromTriggerEvent`

---

## 3. File Tree

```
apps/trigger-service/src/
├── index.ts                          # Entry point: registers triggers, starts server + workers
├── server.ts                         # Express app setup (health, providers, webhooks routes)
├── api/
│   ├── webhooks.ts                   # Fast-Ack ingestion (POST /webhooks/nango, /webhooks/direct/:providerId)
│   └── providers.ts                  # GET /providers — provider metadata for UI
├── lib/
│   ├── logger.ts                     # Service logger
│   ├── webhook-dispatcher.ts         # Dispatches Nango webhooks, extracts routing info
│   └── trigger-processor.ts          # Processes events: filter, dedup, create run
├── webhook-inbox/
│   └── worker.ts                     # BullMQ worker: drains webhook_inbox rows (parse, match, handoff)
├── gc/
│   └── inbox-gc.ts                   # BullMQ worker: garbage collects old inbox rows (hourly, 7-day retention)
└── polling/
    └── worker.ts                     # BullMQ worker: poll per group, fan-out in memory

packages/providers/src/
├── index.ts                          # Package exports
├── types.ts                          # IntegrationProvider, NormalizedTriggerEvent, ProviderTriggers, WebhookRequest, etc.
├── action-source.ts                  # Action source types
├── helpers/
│   ├── schema.ts                     # Schema helpers
│   └── truncation.ts                 # Truncation helpers
└── providers/
    ├── registry.ts                   # ProviderActionRegistry (action modules — Linear, Sentry, Slack)
    ├── linear/
    │   └── actions.ts                # Linear action implementations
    ├── sentry/
    │   └── actions.ts                # Sentry action implementations
    └── slack/
        └── actions.ts                # Slack action implementations

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
├── service.ts                        # Business logic (CRUD, event management, poll group scheduling)
├── db.ts                             # Drizzle queries
├── mapper.ts                         # DB row → API type mapping
└── processor.ts                      # Shared trigger event processor (filter/dedup/handoff)

packages/services/src/webhook-inbox/
├── index.ts                          # Module exports
└── db.ts                             # Webhook inbox Drizzle queries (insert, claim, mark, gc)

packages/services/src/poll-groups/
├── index.ts                          # Module exports
└── db.ts                             # Poll groups Drizzle queries (find/create, list, cursor, orphan cleanup)

packages/services/src/schedules/
├── index.ts                          # Module exports
├── service.ts                        # Schedule CRUD logic
├── db.ts                             # Drizzle queries
└── mapper.ts                         # DB row → API type mapping

packages/db/src/schema/
├── schema.ts                         # triggers, trigger_events, trigger_event_actions, webhook_inbox, trigger_poll_groups tables
└── (schedules defined in schema.ts)  # schedules table

packages/services/src/types/
├── triggers.ts                       # Re-exported trigger DB types
└── schedules.ts                      # Schedule input/output types

apps/web/src/server/routers/
├── triggers.ts                       # Trigger CRUD + provider metadata oRPC routes
└── schedules.ts                      # Schedule CRUD oRPC routes

apps/web/src/app/api/webhooks/
├── nango/route.ts                    # Nango webhook handler (auth + sync lifecycle only; forwards return 200 stub)
└── github-app/route.ts              # GitHub App installation lifecycle only (deleted, suspend, unsuspend)

apps/worker/src/pubsub/
├── index.ts                          # Exports SessionSubscriber
└── session-events.ts                 # Redis PubSub subscriber for session events
```

---

## 4. Data Models & Schemas

### Database Tables

```sql
webhook_inbox
├── id                    UUID PRIMARY KEY
├── organization_id       TEXT                             -- nullable, resolved from routing identity
├── provider              TEXT NOT NULL                    -- e.g. 'github', 'linear', 'sentry'
├── external_id           TEXT                             -- optional provider-specific ID
├── headers               JSONB                            -- raw HTTP headers for deferred parsing
├── payload               JSONB NOT NULL                   -- raw webhook body
├── signature             TEXT                             -- raw signature header for deferred verification
├── status                TEXT NOT NULL DEFAULT 'pending'   -- pending | processing | completed | failed
├── error                 TEXT                             -- error message on failure
├── processed_at          TIMESTAMPTZ                      -- when the inbox worker processed this row
├── received_at           TIMESTAMPTZ DEFAULT now()        -- when the webhook was received
└── created_at            TIMESTAMPTZ DEFAULT now()
    INDEXES: (status, received_at), provider, organization_id

trigger_poll_groups
├── id                    UUID PRIMARY KEY
├── organization_id       TEXT NOT NULL → organization.id (CASCADE)
├── provider              TEXT NOT NULL
├── integration_id        UUID → integrations.id (SET NULL)
├── cron_expression       TEXT NOT NULL
├── enabled               BOOLEAN DEFAULT true
├── last_polled_at        TIMESTAMPTZ
├── cursor                JSONB                            -- opaque cursor for provider pagination
├── created_at            TIMESTAMPTZ DEFAULT now()
└── updated_at            TIMESTAMPTZ DEFAULT now()
    INDEXES: organization_id, enabled
    UNIQUE(organization_id, provider, integration_id) NULLS NOT DISTINCT

triggers
├── id                    UUID PRIMARY KEY
├── organization_id       TEXT NOT NULL → organization.id (CASCADE)
├── automation_id         UUID NOT NULL → automations.id (CASCADE)
├── name                  TEXT (deprecated — use automation.name)
├── description           TEXT (deprecated)
├── trigger_type          TEXT NOT NULL DEFAULT 'webhook'  -- 'webhook' | 'polling'
├── provider              TEXT NOT NULL                    -- 'sentry' | 'linear' | 'github' | 'custom' | 'webhook' | 'posthog' | 'gmail' | 'scheduled'
├── enabled               BOOLEAN DEFAULT true
├── execution_mode        TEXT DEFAULT 'auto' (deprecated)
├── allow_agentic_repo_selection  BOOLEAN DEFAULT false (deprecated)
├── agent_instructions    TEXT (deprecated)
├── webhook_secret        TEXT                             -- random 32-byte hex
├── webhook_url_path      TEXT UNIQUE                      -- /webhooks/t_{uuid12}
├── polling_cron          TEXT                             -- cron expression
├── polling_endpoint      TEXT
├── polling_state         JSONB DEFAULT {}                 -- legacy cursor backup (being replaced by poll groups)
├── last_polled_at        TIMESTAMPTZ
├── config                JSONB DEFAULT {}                 -- provider-specific filters; { _manual: true } marks manual-run triggers
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
// packages/providers/src/types.ts — vNext provider trigger contract

interface NormalizedTriggerEvent {
  provider: string;          // e.g. "sentry"
  eventType: string;         // Internal normalized type (e.g. "error_created")
  providerEventType: string; // Native type from header (e.g. "issue.created")
  occurredAt: string;        // ISO 8601 timestamp
  dedupKey: string;          // Globally unique key for deduplication
  title: string;
  url?: string;
  externalId?: string;       // External event identifier from the provider
  context: Record<string, unknown>; // Parsed, structured data
  raw?: unknown;             // Optional: original payload
}

interface WebhookRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string | undefined>;
  params: Record<string, string | undefined>;
  rawBody: Buffer; // Mandatory for accurate HMAC verification
  body: unknown;
}

interface WebhookParseInput {
  json: unknown;
  headers: Record<string, string | string[] | undefined>;
  providerEventType?: string;
  receivedAt: string;
}

interface WebhookVerificationResult {
  ok: boolean;
  identity?: { kind: "org" | "integration" | "trigger"; id: string };
  immediateResponse?: { status: number; body?: unknown }; // For Slack/Jira challenges
}

interface TriggerType<TConfig = unknown> {
  id: string;
  description: string;
  configSchema: z.ZodType<TConfig>;
  // Pure, synchronous, no side effects
  matches(event: NormalizedTriggerEvent, config: TConfig): boolean;
}

interface ProviderTriggers {
  types: TriggerType[];

  webhook?: {
    verify(req: WebhookRequest, secret: string | null): Promise<WebhookVerificationResult>;
    parse(input: WebhookParseInput): Promise<NormalizedTriggerEvent[]>;
  };

  polling?: {
    defaultIntervalSeconds: number;
    poll(ctx: {
      cursor: unknown;
      token?: string;
      orgId: string;
    }): Promise<{ events: NormalizedTriggerEvent[]; nextCursor: unknown; backoffSeconds?: number }>;
  };

  // Called ONCE per event batch to fetch missing data (e.g. fetching Jira issue fields via API)
  hydrate?: (event: NormalizedTriggerEvent, ctx: { token: string }) => Promise<NormalizedTriggerEvent>;
}

// packages/triggers/src/service/base.ts — current service-layer base classes (being consolidated)
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
```

### Key Indexes & Query Patterns
- Webhook inbox drain: `claimBatch()` uses `SELECT FOR UPDATE SKIP LOCKED` on `(status, received_at)` for concurrent worker safety.
- Webhook lookup: `findActiveWebhookTriggers(integrationId)` uses `(integration_id, enabled, trigger_type)`.
- Dedup check: `eventExistsByDedupKey(triggerId, dedupKey)` uses unique index `(trigger_id, dedup_key)`.
- Poll group lookup: `findTriggersForGroup(orgId, provider, integrationId)` matches triggers by org + provider + integration.
- Orphan cleanup: `deleteOrphanedGroups()` removes poll groups with no matching active triggers.
- Event listing: `listEvents(orgId, options)` uses `(organization_id, status)` with pagination.

---

## 5. Conventions & Patterns

### Do
- Use the transactional outbox (`createRunFromTriggerEvent`) for all trigger-to-run handoffs — guarantees atomicity.
- Register new providers in `registerDefaultTriggers()` (`packages/triggers/src/service/register.ts`).
- Store webhook payloads in the inbox for async processing — never process webhooks synchronously in the Express handler.
- Use poll groups for polling triggers — never schedule per-trigger polling jobs.
- Keep `matches()` / `filter()` functions pure — no DB calls, no network, no side effects.
- When adding a new provider, implement `ProviderTriggers` in `packages/providers/src/types.ts` (target contract) and optionally bridge via `WebhookTrigger`/`PollingTrigger` classes during migration.

### Don't
- Skip deduplication — always implement `computeDedupKey` / `idempotencyKey`.
- Directly enqueue BullMQ jobs from trigger processing — use the outbox.
- Add raw SQL to `packages/services/src/triggers/db.ts` — use Drizzle query builder (exception: `claimBatch` in webhook-inbox uses raw SQL for `FOR UPDATE SKIP LOCKED`).
- Log raw webhook payloads (may contain sensitive data). Log trigger IDs, event counts, and provider names instead.
- Process webhooks synchronously in Express routes — always use the inbox pattern.
- Schedule per-trigger polling jobs — use poll groups.

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
- **Webhook inbox concurrency**: `claimBatch()` uses `SELECT FOR UPDATE SKIP LOCKED` for safe concurrent processing. Worker drains every 5 seconds with configurable batch size (default 10).
- **Webhook signature verification**: Nango HMAC-SHA256 via `verifyNangoSignature()` using `timingSafeEqual`. Provider-specific signatures (Linear-Signature, X-Hub-Signature-256, Sentry-Hook-Signature, X-PostHog-Signature) verified by provider adapters.
- **Inbox garbage collection**: BullMQ worker runs hourly, deleting completed/failed rows older than 7 days to prevent PostgreSQL bloat.
- **Polling concurrency**: Redis lock per poll group (`poll:<groupId>`) with 120-second TTL prevents concurrent polls for the same group.
- **Polling job options**: Repeatable BullMQ jobs per poll group, scheduled at startup via `scheduleEnabledPollGroups()`.
- **Idempotency**: Unique index `(trigger_id, dedup_key)` prevents duplicate event processing.

---

## 6. Subsystem Deep Dives

### 6.1 Async Webhook Ingestion

**What it does:** Receives webhooks via fast-ack Express routes, stores in `webhook_inbox`, and processes asynchronously via BullMQ worker. **Status: Implemented.**

**Phase 1 — Fast-Ack Express Route (`apps/trigger-service/src/api/webhooks.ts`):**
1. `POST /webhooks/nango` receives a Nango-forwarded webhook.
2. `dispatchIntegrationWebhook("nango", req)` verifies the Nango HMAC signature and extracts provider + connectionId from the forward envelope.
3. The route calls `webhookInbox.insertInboxRow()` to store the raw payload with provider and headers.
4. Returns `200 OK` immediately. No parsing, no matching, no run creation.

**Phase 1b — Direct Provider Route:**
1. `POST /webhooks/direct/:providerId` receives webhooks from providers that bypass Nango.
2. Stores the raw payload in the inbox with the provider ID.
3. Returns `200 OK` immediately.

**Phase 2 — BullMQ Inbox Worker (`apps/trigger-service/src/webhook-inbox/worker.ts`):**
1. A repeatable BullMQ job fires every 5 seconds.
2. `claimBatch()` uses `SELECT FOR UPDATE SKIP LOCKED` to safely claim pending rows.
3. For each row, the worker:
   - Extracts `connectionId` from the Nango payload.
   - Resolves the integration via `integrations.findByConnectionIdAndProvider()`.
   - Finds active webhook triggers for that integration.
   - Resolves trigger definitions from the registry via `registry.webhooksByProvider()`.
   - Parses events using the trigger definition's `webhook()` method.
   - Calls `processTriggerEvents()` to filter, dedup, and create runs.
4. On success, marks the row `completed`. On failure, marks it `failed` with error message.

**Edge cases:**
- No connectionId in payload (direct webhook) → throws error (direct processing not yet fully implemented).
- Integration not found for connectionId → row marked completed, no events processed.
- No active triggers for integration → row marked completed.
- Invalid Nango signature → `401` response (rejected at fast-ack layer, never reaches inbox).
- Inbox worker failure → row stays in `processing` state until manually resolved or re-claimed.

**Files touched:** `apps/trigger-service/src/api/webhooks.ts`, `apps/trigger-service/src/webhook-inbox/worker.ts`, `apps/trigger-service/src/lib/webhook-dispatcher.ts`, `apps/trigger-service/src/lib/trigger-processor.ts`, `packages/services/src/webhook-inbox/db.ts`

### 6.2 Inbox Garbage Collection

**What it does:** Periodically deletes old completed/failed webhook inbox rows to prevent PostgreSQL table bloat. **Status: Implemented.**

**Happy path:**
1. A repeatable BullMQ job fires every hour.
2. `webhookInbox.gcOldRows(retentionDays)` deletes rows where `status IN ('completed', 'failed') AND processed_at < NOW() - INTERVAL '7 days'`.
3. Logs the number of deleted rows.

**Files touched:** `apps/trigger-service/src/gc/inbox-gc.ts`, `packages/services/src/webhook-inbox/db.ts`

### 6.3 Integration-Scoped Polling (Poll Groups)

**What it does:** Polls external APIs efficiently using one job per integration group, then fans out events in-memory. **Status: Implemented.**

**Happy path:**
1. When a polling trigger is created/updated, the service calls `pollGroups.findOrCreateGroup()` to ensure a poll group exists for `(org, provider, integration)`, then schedules a BullMQ repeatable job for the group.
2. At startup, `scheduleEnabledPollGroups()` schedules jobs for all enabled groups.
3. The poll group worker (`apps/trigger-service/src/polling/worker.ts`) processes each job:
   - Loads the poll group row.
   - Acquires a Redis lock (`poll:<groupId>`) with 120-second TTL to prevent concurrent polls.
   - Finds all active polling triggers in the group via `pollGroups.findTriggersForGroup()`.
   - Resolves the integration's connectionId.
   - Calls the polling trigger's `poll(connection, config, cursor)` once for the group.
   - Updates the group cursor via `pollGroups.updateGroupCursor()`.
   - **In-memory fan-out:** iterates events across all triggers in the group, calling `processTriggerEvents()` for each.
4. On trigger disable/delete, orphaned poll groups (with no matching active triggers) are cleaned up via `pollGroups.deleteOrphanedGroups()`.

**Edge cases:**
- Redis lock already held → skips this poll cycle (prevents concurrent polls).
- No active triggers in group → skips (group may be orphaned).
- Missing connectionId → logs warning, returns.
- Cursor missing → first poll (cursor = null).

**Files touched:** `apps/trigger-service/src/polling/worker.ts`, `packages/services/src/poll-groups/db.ts`, `packages/services/src/triggers/service.ts`

### 6.4 Trigger CRUD

**What it does:** oRPC routes for managing triggers. **Status: Implemented.**

**Happy path:**
1. `create` validates prebuild and integration existence, generates `webhookUrlPath` (UUID-based) and `webhookSecret` (32-byte hex) for webhook triggers, creates an automation parent record, then creates the trigger. For polling triggers, finds or creates a poll group and schedules a BullMQ repeatable job.
2. `update` modifies trigger fields. For polling triggers, reschedules or removes the repeatable job based on `enabled` state and `pollingCron`.
3. `delete` removes the trigger (cascades to events). For polling triggers, cleans up orphaned poll groups.
4. `list` returns triggers with integration data and pending event counts.
5. `get` returns a single trigger with recent events and event status counts.
6. `listEvents` returns paginated events with trigger and session relations.
7. `skipEvent` marks a queued event as `skipped` with reason `manual`.

**Files touched:** `apps/web/src/server/routers/triggers.ts`, `packages/services/src/triggers/service.ts`, `packages/services/src/triggers/db.ts`

### 6.5 Provider Adapters

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

#### Manual Run Trigger (Implemented — via automation service)
- Not a traditional provider — created on-demand by `triggerManualRun()` when users click "Run Now" in the automation detail page.
- Uses `provider: "webhook"`, `triggerType: "webhook"`, `enabled: false` with `config: { _manual: true }` flag to distinguish from real webhook triggers.
- The trigger is disabled (`enabled: false`) so it never participates in webhook ingestion or matching.
- `findManualTrigger()` queries by JSONB `config->>'_manual' = 'true'` rather than by provider value.
- The UI filters manual triggers from display using the `config._manual` flag.
- Files: `packages/services/src/automations/service.ts:triggerManualRun`, `packages/services/src/automations/db.ts:findManualTrigger`

### 6.6 Schedule CRUD

**What it does:** Manages cron schedules attached to automations. **Status: Implemented.**

**Happy path:**
1. `getSchedule(id, orgId)` returns a single schedule.
2. `updateSchedule(id, orgId, input)` validates cron expression (5-6 fields) and updates.
3. `deleteSchedule(id, orgId)` removes the schedule.
4. `createSchedule` (called from automations context) validates cron and inserts.

**Files touched:** `apps/web/src/server/routers/schedules.ts`, `packages/services/src/schedules/service.ts`, `packages/services/src/schedules/db.ts`

### 6.7 PubSub Session Events Subscriber

**What it does:** Listens on Redis PubSub for session events and wakes async clients (e.g., Slack). **Status: Implemented.**

**Happy path:**
1. `SessionSubscriber` subscribes to `SESSION_EVENTS_CHANNEL` on Redis.
2. On `user_message` events, looks up the session's `clientType`.
3. Finds the registered `WakeableClient` for that type and calls `wake(sessionId, metadata, source, options)`.

**Edge cases:**
- Session has no async client → no-op.
- No registered client for type → logs warning.

**Files touched:** `apps/worker/src/pubsub/session-events.ts`

### 6.8 Provider Registry & Metadata API

**What it does:** Exposes registered trigger providers and their config schemas. **Status: Implemented.**

**Happy path:**
1. `GET /providers` iterates all registered triggers and returns ID, provider name, type (webhook/polling), metadata, and JSON Schema from Zod config schema.
2. `GET /providers/:id` returns a single provider definition.

**Files touched:** `apps/trigger-service/src/api/providers.ts`, `packages/triggers/src/service/registry.ts`

### 6.9 Web App Webhook Routes (Lifecycle Only)

**What it does:** Next.js API routes that handle non-trigger webhook events (auth lifecycle, installation management). Trigger event processing has been moved to the trigger service. **Status: Implemented.**

#### Nango route (`/api/webhooks/nango`)
- Verifies `X-Nango-Hmac-Sha256` signature.
- Handles `auth` webhooks (updates integration status on creation, override, refresh failure).
- Handles `sync` webhooks (logged only).
- `forward` webhooks return `200` with a migration stub — actual processing happens in the trigger service.
- File: `apps/web/src/app/api/webhooks/nango/route.ts`

#### GitHub App route (`/api/webhooks/github-app`)
- Receives webhooks directly from GitHub App installations (not via Nango).
- Verifies `X-Hub-Signature-256` using `GITHUB_APP_WEBHOOK_SECRET`.
- Handles installation lifecycle events only (deleted, suspend, unsuspend) by updating integration status.
- All other GitHub events return `200` with a migration message — processing happens in the trigger service via Nango forwarding.
- File: `apps/web/src/app/api/webhooks/github-app/route.ts`

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| Automations | Triggers → Automations | `runs.createRunFromTriggerEvent()` | Handoff point. Creates trigger event + automation run + outbox entry in one transaction. |
| Providers package | Trigger service → Providers | `ProviderTriggers` contract, `ProviderRegistry` | Target interface for integration modules. Defines `NormalizedTriggerEvent`, `verify()`, `parse()`, `matches()`, `poll()`. |
| Integrations | Triggers → Integrations | `integrations.findByConnectionIdAndProvider()`, `integrations.findActiveByGitHubInstallationId()` | Resolves Nango connectionId or GitHub installation ID to integration record. |
| Integrations | Triggers ← Integrations | `trigger.integrationId` FK | Trigger references its OAuth connection. |
| Queue (BullMQ) | Triggers → Queue | `createWebhookInboxQueue()`, `createPollGroupQueue()`, `schedulePollGroupJob()` | Inbox drain (every 5s), inbox GC (hourly), poll group repeatable jobs. |
| Redis | Triggers → Redis | `REDIS_KEYS.pollGroupLock(groupId)` | Lock for poll group concurrency control. |
| Outbox | Triggers → Outbox | `outbox.insert({ kind: "enqueue_enrich" })` | Reliable handoff to automation run pipeline. See `automations-runs.md`. |
| Sessions | Events → Sessions | `trigger_events.session_id` FK | Links event to resulting session (set after run execution). |
| Secrets | Triggers → Secrets | webhook secrets | Webhook verification secrets stored on trigger rows or resolved from provider config. |

### Security & Auth
- **Trigger CRUD**: Protected by `orgProcedure` middleware (requires authenticated user + org membership).
- **Trigger-service webhooks**: Public endpoints. Signature verified at ingestion layer:
  - Nango route: `verifyNangoSignature()` using Nango HMAC-SHA256 (`timingSafeEqual`).
  - Direct route: deferred to inbox worker via `ProviderTriggers.webhook.verify()` (when fully implemented).
- **Web app webhook routes**: Public endpoints for lifecycle events only. Signature verification:
  - Nango route: `X-Nango-Hmac-Sha256` header.
  - GitHub App route: `X-Hub-Signature-256` header against `GITHUB_APP_WEBHOOK_SECRET` env var.
- **Webhook secrets**: 32-byte random hex stored in DB. Generated on trigger creation.
- Provider verification must not leak secrets in error messages or logs.

### Observability
- Trigger service logger: `@proliferate/logger` with `{ service: "trigger-service" }`.
- Child loggers per module: `{ module: "webhooks" }`, `{ module: "webhook-inbox-worker" }`, `{ module: "poll-groups" }`, `{ module: "inbox-gc" }`, `{ module: "trigger-processor" }`.
- Structured fields: `triggerId`, `connectionId`, `sessionId`, `groupId`, `inboxId`, `provider`.
- Metrics to track: webhook request counts by provider, inbox queue depth, inbox drain latency, parse failures, dedup hits, poll duration, poll backoffs, run creation failures.
- **Inbox garbage collection**: Hourly cron deletes `completed`/`failed` rows older than 7 days to prevent PostgreSQL bloat.

---

## 8. Acceptance Gates

- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] Relevant tests pass (`pnpm test`)
- [ ] All webhook ingestion routes through trigger-service fast-ack pattern
- [ ] `NormalizedTriggerEvent` types compile with no strict errors
- [ ] Orphaned poll groups are correctly removed (when the last trigger in a group is deleted, the BullMQ job is unscheduled)
- [ ] This spec is updated (file tree, data models, deep dives)

---

## 9. Known Limitations & Tech Debt

- [ ] **SCHEDULED queue worker not instantiated** — `createScheduledWorker()` exists in `packages/queue/src/index.ts` and jobs can be enqueued, but no worker is started in any running service. The scheduled trigger worker was archived (`apps/worker/src/_archived/`). Cron-based triggers that rely on this queue do not execute. — High impact.
- [ ] **Dual abstraction layers** — Both `TriggerProvider` interface (`packages/triggers/src/types.ts`) and `WebhookTrigger`/`PollingTrigger` classes (`packages/triggers/src/service/base.ts`) coexist alongside the target `ProviderTriggers` contract (`packages/providers/src/types.ts`). The inbox worker still uses the class-based registry. Should consolidate all providers to the `ProviderTriggers` interface. — Medium complexity.
- [ ] **Direct webhook processing not yet implemented** — The `POST /webhooks/direct/:providerId` route stores payloads in the inbox, but the inbox worker only handles Nango-forwarded webhooks (requires `connectionId`). Direct provider webhooks need identity resolution via `ProviderTriggers.webhook.verify()`. — Medium impact.
- [ ] **Deprecated trigger fields** — `name`, `description`, `executionMode`, `allowAgenticRepoSelection`, `agentInstructions` on the triggers table are deprecated in favor of the parent automation's fields, but still populated on create. — Low impact, remove when safe.
- [ ] **Gmail provider requires Composio** — Gmail polling uses Composio as an OAuth token broker, adding an external dependency. Only registered when `COMPOSIO_API_KEY` is set. Full implementation exists but external dependency makes it Partial.
- [ ] **PostHog not registered in trigger service** — The `PostHogProvider` exists in `packages/triggers/src/posthog.ts` and registers in the functional provider registry, but there is no `PostHogNangoTrigger` adapter in `service/adapters/`. PostHog webhooks were previously handled via a separate web app API route (now removed). Needs a trigger-service adapter or migration to `ProviderTriggers`. — Medium impact.
- [ ] **No retry logic for failed trigger event processing** — If `createRunFromTriggerEvent` fails, the event is marked as skipped with reason `run_create_failed`. There is no automatic retry mechanism. — Events can be manually retried via re-processing.
- [ ] **HMAC helper duplication** — The `hmacSha256` function is duplicated across `github.ts`, `linear.ts`, `sentry.ts`, `posthog.ts`, and the web app Nango route. Should be extracted to a shared utility (the `ProviderTriggers` architecture uses `packages/providers/src/helpers/` for this). — Low impact.
- [ ] **Manual triggers use webhook provider** — Manual run triggers are stored with `provider: "webhook"` and a `config._manual` JSONB flag rather than a dedicated provider value. This avoids enum violations but means manual triggers are distinguished only by their config, not by a first-class provider type. Impact: low — `findManualTrigger` queries by config flag reliably. Expected fix: add "manual" to the `TriggerProviderSchema` enum when a migration is appropriate.
- [ ] **Providers with expiring webhook registrations** — Providers like Jira that require webhook registration refresh need a refresh job and `external_webhook_id` persistence (deferred to Jira implementation).
- [ ] **Secret resolution chicken-and-egg** — For per-integration secrets (e.g., PostHog), the framework must extract a "candidate identity" from URL params or headers, look up the secret from the DB, and *then* call `verify()`. Not yet implemented for the direct webhook path.
- [ ] **Legacy per-trigger polling state** — The `polling_state` JSONB column on the `triggers` table and Redis `poll:{triggerId}` keys are legacy from per-trigger polling. Poll groups now own cursor state. Legacy columns should be removed once all polling triggers are migrated to groups.
