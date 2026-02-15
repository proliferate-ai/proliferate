# Triggers — System Spec

> **vNext (target architecture)** — This spec describes the intended trigger ingestion and dispatch design after webhook consolidation + unified integration modules, and may not match `main` yet.
>
> Current implemented spec: `../triggers.md`  
> Design change set: `../../../integrations_architecture.md`

Terminology note: this spec uses `IntegrationProvider` / "integration module" for external service integrations (Linear/Sentry/etc). This is distinct from sandbox compute providers (Modal/E2B) in `./sandbox-providers.md`.

## 1. Scope & Purpose

### In Scope
- Trigger CRUD (create, update, delete, list, get).
- Trigger service (`apps/trigger-service/`) ingestion: Nango-forwarded webhooks (`POST /webhooks/nango`).
- Trigger service (`apps/trigger-service/`) ingestion: direct webhooks (`POST /webhooks/direct/:providerId/...`).
- Provider-declared trigger types, config schemas, and pure filtering (`IntegrationProvider.triggers.types[].matches()`).
- Provider-declared webhook verification + parsing (`IntegrationProvider.triggers.webhook.verify/parse`).
- Provider-declared polling (`IntegrationProvider.triggers.polling.poll()`), cursor storage, and scheduling via BullMQ repeatable jobs.
- Event normalization, deduplication, and handoff to automations via transactional outbox.
- Webhook identity routing (provider extracts identity; framework resolves identity → org → triggers).

### Out of Scope
- Automation run pipeline after the outbox enqueue — see `automations-runs.md`.
- Action execution and permissioning — see `./actions.md`.
- OAuth connection lifecycle and token storage — see `./integrations.md`.
- Session lifecycle and sandbox runtime — see `./sessions-gateway.md`, `./sandbox-providers.md`.

### Mental Model

Triggers are the inbound event layer of Proliferate. External services emit events that Proliferate ingests, normalizes, filters, deduplicates, and converts into automation runs. In vNext, trigger provider logic is consolidated into code-defined integration modules (`IntegrationProvider`), and webhook ingestion is consolidated into the trigger service (eliminating the dual-ingestion path via Next.js API routes).

Integration modules are stateless and framework-owned state is explicit:
- Providers never read PostgreSQL, write Redis, or schedule jobs.
- Providers declare trigger types and implement pure parsing/filtering functions.
- The trigger service owns persistence, deduplication, cursor storage, rate limiting, job scheduling, retries, and observability.

**Core entities:**
- **Trigger** — a configured event source bound to an automation. Types: webhook or polling.
- **Normalized event** — provider-normalized event payload used for matching, dedup, and storage.
- **Trigger type** — a provider-declared event type with config schema and `matches()` function.

**Key invariants:**
- Webhook ingestion happens only in `apps/trigger-service` in vNext.
- Webhook HTTP handlers must acknowledge quickly (after verification + persistence). All hydration/network work happens asynchronously.
- `matches()` is pure and fast: no API calls, no side effects.
- Complex filtering uses optional `hydrate()` which runs once per event (not per trigger) and is cached per-ingest batch.
- Deduplication is enforced by a unique constraint on `(trigger_id, dedup_key)`.

---

## 2. Core Concepts

### IntegrationProvider Triggers Contract
Providers declare trigger behavior via `IntegrationProvider.triggers`:
- `types[]` describes trigger types, config schema, and `matches()`.
- `webhook` optionally implements verification and parsing.
- `polling` optionally implements cursor-based polling.
- `hydrate` optionally enriches normalized events once per event.
- Key detail agents get wrong: providers are not allowed to touch lifecycle state (no DB, no Redis, no scheduling). They only operate on inputs and return outputs.
- Reference: `../../../integrations_architecture.md` §4

### Webhook Verification + Parsing (Ingestion-Neutral)
Webhook parsing uses an ingestion-neutral `WebhookParseInput` so providers don't branch on "Nango vs direct". The framework constructs `WebhookRequest` from the raw Express request and passes secrets in explicitly.
- Key detail agents get wrong: verification must use the raw request body (`Buffer`) and should be implemented as a pure function (`verify(req, secret)`).
- Reference: `../../../integrations_architecture.md` §4, §9

### Webhook Identity Routing
Providers extract an identity used for routing (`triggerId`, external integration instance ID like GitHub installation ID, or an org ID). The framework resolves identity → organization → active triggers.
- Key detail agents get wrong: identity extraction can happen during verification (before parsing) and must not require database access in provider code.
- Reference: `../../../integrations_architecture.md` §4, §9

### Webhook Inbox (Async Processing Boundary)
Webhook providers expect fast responses (often a few seconds) and may retry or disable endpoints if handlers are slow. In vNext, webhook ingestion is split into two phases:
1. **Ingestion (HTTP request)**: verify signature, capture minimal metadata, persist to `webhook_inbox`, return 2xx immediately.
2. **Processing (async worker)**: parse, optional `hydrate()` (with backoff on 429), match, dedup, and create runs.

- Key detail agents get wrong: calling `hydrate()` inside the Express request handler can cause a rate limit storm (concurrent webhooks) and lead to upstream webhook timeouts/retries.

### Generic Trigger Pipeline
Both webhook and polling processing feed a single generic pipeline (run in workers, not in the webhook HTTP handler):
- Parse provider payload into `NormalizedTriggerEvent[]`
- Optional `hydrate()` (once per event, cached per processing batch)
- Per-trigger `matches(event, config)` evaluation
- Dedup insert guard `(trigger_id, dedup_key)`
- Transactional insert of `trigger_event`, `automation_run`, and outbox enqueue
- Reference: `../../../integrations_architecture.md` §9, §10

### Polling (Integration-Scoped, Cursor-Based)
Polling is cursor-based and framework-owned, but is scheduled per polling group (typically per `(organizationId, providerId, integrationId)`), not per trigger. This avoids rate limit fan-out when many triggers share the same provider token.
- A single poll fetches a superset of recent events for the connection.
- The framework then fans out those events in-memory to evaluate `matches()` across all active triggers in the group.
- Key detail agents get wrong: the cursor is opaque provider data (not always a timestamp).
- Reference: `../../../integrations_architecture.md` §10

---

## 3. File Tree

vNext consolidates webhook ingestion into the trigger service and moves provider-specific logic into `packages/providers/`.

```
apps/trigger-service/src/
├── index.ts                          # Entry point: starts server + polling worker
├── server.ts                         # Express app setup (health, webhook routes)
├── api/
│   └── webhooks.ts                   # Verify + enqueue (POST /webhooks/nango, POST /webhooks/direct/:providerId)
├── lib/
│   ├── logger.ts
│   ├── identity-resolver.ts          # Resolve WebhookIdentity → organization + triggers
│   └── trigger-processor.ts          # Generic pipeline (hydrate, matches, dedup, run creation)
├── webhook-inbox/
│   └── worker.ts                     # BullMQ worker: process webhook_inbox rows
└── polling/
    └── worker.ts                     # BullMQ worker: poll per polling group, then fan out to triggers

packages/providers/src/
├── registry.ts                       # ProviderRegistry (static Map)
├── types.ts                          # IntegrationProvider + trigger types
└── providers/
    ├── linear/                       # webhook + polling
    ├── sentry/                       # webhook-only
    ├── github/                       # direct webhooks
    └── posthog/                      # direct, per-trigger webhooks

packages/services/src/triggers/
├── service.ts                        # Trigger CRUD + scheduling orchestration
├── db.ts
└── mapper.ts

packages/db/src/schema/
└── triggers.ts                       # triggers + trigger_events tables

apps/web/src/app/api/webhooks/        # Deprecated in vNext (deleted at cutover)
```

---

## 4. Data Models & Schemas

### Database Tables

The vNext pipeline stores normalized event fields explicitly and retains raw payload as optional debug/audit context.

```sql
triggers
├── id                    UUID PK
├── organization_id       TEXT NOT NULL
├── automation_id         UUID NOT NULL
├── trigger_type          TEXT NOT NULL          -- "webhook" | "polling"
├── provider              TEXT NOT NULL          -- provider id ("linear", "sentry", "github", "posthog", "custom")
├── event_type            TEXT                  -- provider trigger type id (optional)
├── enabled               BOOLEAN NOT NULL
├── config                JSONB NOT NULL         -- validated via provider TriggerType.schema
├── integration_id        UUID                   -- token source for polling/hydrate (nullable)
├── webhook_secret        TEXT                   -- if provider uses per-trigger secrets
├── webhook_url_path      TEXT UNIQUE            -- if provider uses per-trigger URLs
├── polling_state         JSONB                  -- deprecated: cursor stored on trigger_poll_groups.cursor
├── last_polled_at        TIMESTAMPTZ            -- deprecated: use trigger_poll_groups.last_polled_at
├── external_webhook_id   TEXT                   -- optional: providers with expiring registrations (e.g., Jira)
├── created_at            TIMESTAMPTZ
└── updated_at            TIMESTAMPTZ
    INDEX(organization_id)
    INDEX(automation_id)
```

```sql
-- New in vNext: decouple webhook ingestion from processing
webhook_inbox
├── id                    UUID PK
├── received_at           TIMESTAMPTZ NOT NULL
├── provider              TEXT NOT NULL
├── provider_event_type   TEXT
├── headers               JSONB
├── payload               JSONB NOT NULL          -- verified provider payload (or verified Nango inner payload)
├── status                TEXT NOT NULL           -- queued | processing | completed | failed
├── attempt               INT NOT NULL DEFAULT 0
├── next_attempt_at       TIMESTAMPTZ
├── last_error            TEXT
└── processed_at          TIMESTAMPTZ
    INDEX(status, next_attempt_at)
```

```sql
-- New in vNext: polling state is stored per polling group (typically per integration), not per trigger
trigger_poll_groups
├── id                    UUID PK
├── organization_id       TEXT NOT NULL
├── provider              TEXT NOT NULL
├── integration_id        UUID                   -- nullable for providers that don't require tokens
├── cursor                JSONB                  -- opaque provider cursor
├── interval_seconds      INT NOT NULL
├── last_polled_at        TIMESTAMPTZ
├── created_at            TIMESTAMPTZ
└── updated_at            TIMESTAMPTZ
    UNIQUE(organization_id, provider, integration_id)
```

```sql
trigger_events
├── id                    UUID PK
├── trigger_id             UUID NOT NULL
├── organization_id       TEXT NOT NULL
├── provider              TEXT NOT NULL
├── event_type            TEXT NOT NULL          -- normalized internal type
├── provider_event_type   TEXT                   -- native event type (header/envelope)
├── occurred_at           TIMESTAMPTZ NOT NULL
├── dedup_key             TEXT NOT NULL
├── title                 TEXT NOT NULL
├── url                   TEXT
├── context               JSONB NOT NULL         -- structured normalized data
├── raw_payload           JSONB                  -- optional original payload
├── status                TEXT NOT NULL
├── error_message         TEXT
├── created_at            TIMESTAMPTZ
└── processed_at          TIMESTAMPTZ
    UNIQUE(trigger_id, dedup_key)
```

### Core TypeScript Types

```ts
// packages/providers/src/types.ts (dependency)
interface NormalizedTriggerEvent {
	provider: string;
	eventType: string;
	providerEventType: string;
	occurredAt: string;
	dedupKey: string;
	title: string;
	url?: string;
	context: Record<string, unknown>;
	raw?: unknown;
}
```

---

## 5. Conventions & Patterns

### Do
- Keep `matches()` pure: no network, no DB, no side effects.
- Use `hydrate()` only when webhook/poll payloads are insufficient for `matches()` and cache it per ingest batch.
- Verify signatures using raw body bytes and constant-time comparisons.
- Consolidate all webhooks into trigger-service routes; delete Next.js webhook routes at cutover.
- Enqueue webhooks to `webhook_inbox` and return 2xx quickly; do not block request handlers on provider API calls.

### Don't
- Don't parse Nango envelopes inside provider code. Framework extracts raw provider payload and passes ingestion-neutral inputs.
- Don't implement provider logic in trigger-service classes; it belongs in `packages/providers/src/providers/<id>/`.
- Don't run concurrent polls for the same polling group; use a Redis lock to skip duplicate cycles.
- Don't call `hydrate()` inside webhook HTTP handlers.

### Reliability
- Polling uses a Redis lock `poll:<providerId>:<integrationId>` with TTL equal to the poll interval. If locked, skip the cycle (best-effort).
- Provider polling can return `backoffSeconds` to inform scheduler backoff on rate limiting.

---

## 6. Subsystem Deep Dives

### 6.1 Nango-Forwarded Webhook Ingestion

**What it does:** Verifies Nango-forwarded webhooks, enqueues them, and processes them asynchronously into trigger events.

**Happy path:**
1. `POST /webhooks/nango` verifies Nango envelope signature.
2. Framework extracts `{ providerId, providerEventType, rawProviderPayload }`.
3. Insert a `webhook_inbox` row (providerId, providerEventType, payload, receivedAt, headers).
4. Return 2xx immediately.
5. Async worker claims the inbox row, calls `provider.triggers.webhook.parse(...)`, resolves identity, optionally calls `hydrate()` with backoff on 429, then runs `matches()`/dedup and creates runs via transactional outbox.

### 6.2 Direct Webhook Ingestion

**What it does:** Verifies direct provider webhooks, enqueues them, and processes them asynchronously into trigger events.

**Happy path:**
1. `POST /webhooks/direct/:providerId/...` looks up provider in `ProviderRegistry`.
2. Framework resolves verification secret (env/config/DB based on untrusted candidate identity).
3. Call `provider.triggers.webhook.verify(req, secret)`.
4. If `immediateResponse` is returned, respond (challenge-response).
5. Insert a `webhook_inbox` row (providerId, providerEventType, verified payload, receivedAt, headers).
6. Return 2xx immediately.
7. Async worker claims the inbox row, calls `provider.triggers.webhook.parse(...)`, resolves identity, and runs the generic pipeline.

### 6.3 Generic Pipeline (Hydrate, Match, Dedup, Run)

**What it does:** Matches events against triggers and creates automation runs.

**Happy path:**
1. Parse provider payload into normalized events via `provider.triggers.webhook.parse(...)` (webhooks) or `provider.triggers.polling.poll(...)` (polling).
2. If provider defines `hydrate`, call it once per event and cache the result.
3. Load active triggers for `(orgId, providerId)`.
4. For each trigger, validate config and run `matches(event, config)`.
5. If matched, attempt insert guarded by `UNIQUE(trigger_id, dedup_key)`.
6. Insert `trigger_event`, `automation_run`, and outbox record in one transaction.

### 6.4 Polling Cycle

**What it does:** Pulls events from provider APIs on an interval per polling group (typically per integration), then evaluates matches across all triggers in the group.

**Happy path:**
1. BullMQ job loads polling group (orgId, providerId, integrationId) + cursor.
2. Acquire Redis lock `poll:<providerId>:<integrationId>`; if locked, skip.
3. Resolve token (if required) via `getToken()` (Integrations-owned).
4. Call provider polling once for the group to fetch a superset of recent events.
5. Persist `nextCursor` on the polling group record.
6. Load active triggers in the group and evaluate `matches()` for each event/trigger pair in-memory.
7. Dedup and create runs via the generic pipeline.

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| Providers package | Trigger service → Providers | `ProviderRegistry` | Lookup integration modules for parsing/polling/matching. |
| Integrations | Trigger service → Integrations | `getToken()` | Polling and optional `hydrate()` token resolution. |
| Automations | Triggers → Automations | `createRunFromTriggerEvent()` | Transactional outbox handoff. |
| Secrets | Triggers → Secrets | `resolveSecretValue()` | Webhook verification secrets (provider-specific). |

### Security & Auth
- Webhook endpoints are unauthenticated by design; signature verification is mandatory where the provider supports it.
- Provider verification must not leak secrets in error messages or logs.

### Observability
- Log fields: `providerId`, `organizationId` (after resolution), `triggerId`, `providerEventType`, `eventType`, `dedupKey`.
- Metrics: webhook request counts by provider, parse failures, dedup hits, poll duration, poll backoffs, run creation failures.

---

## 8. Acceptance Gates

- [ ] Specs updated in `docs/specs/vnext/` when changing trigger ingestion or provider trigger contracts.
- [ ] Typecheck passes
- [ ] Trigger ingestion paths have integration tests for signature verification + parsing (if implementing code)

---

## 9. Known Limitations & Tech Debt

- [ ] Providers with expiring webhook registrations (e.g., Jira) require a refresh job and `external_webhook_id` persistence. See `../../../integrations_architecture.md` §8.
- [ ] Secret resolution can be chicken-and-egg for per-integration secrets; use a two-step "candidate identity -> secret -> verify" pattern. See `../../../integrations_architecture.md` §9.
