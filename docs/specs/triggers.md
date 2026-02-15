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
├── triggers.ts                       # Trigger CRUD + provider metadata oRPC routes
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
1. `create` validates configuration and integration existence, generates `webhookUrlPath` (UUID-based) and `webhookSecret` (32-byte hex) for webhook triggers, creates an automation parent record, then creates the trigger. For polling triggers, schedules a BullMQ repeatable job.
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
