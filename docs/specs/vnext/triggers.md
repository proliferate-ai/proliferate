
# Triggers — System Spec

> **vNext (target architecture)** — This spec describes the intended trigger ingestion and dispatch design after webhook consolidation + unified integration modules.
>
> Current implemented spec: `../triggers.md`  
> Design change set: `../../../integrations_architecture.md`

Terminology note: this spec uses `IntegrationProvider` / "integration module" for external service integrations (Linear/Sentry/etc). This is distinct from sandbox compute providers (Modal/E2B) in `./sandbox-providers.md`.

## 1. Scope & Purpose

Triggers are the inbound event layer of Proliferate. External services (Sentry, Linear, GitHub, etc.) emit events that Proliferate ingests, normalizes, filters, deduplicates, and converts into Automation Runs.

In vNext, trigger logic is consolidated into stateless integration modules (`IntegrationProvider`), and webhook ingestion is aggressively decoupled from processing to survive API rate-limit storms.

### The Core Invariants
1. **Async Webhook Inbox:** Express webhook routes must do exactly three things: verify signatures, extract routing identity, and `INSERT INTO webhook_inbox`. They must return `200 OK` instantly to prevent upstream rate-limit timeouts.
2. **Integration-Scoped Polling:** Polling is scheduled per-Integration, NOT per-Trigger. The worker fetches events once from the provider, then fans out in-memory to evaluate `matches()` across all active triggers to prevent API rate limit multipliers.
3. **Pure Matching:** The `matches()` function declared by providers is strictly pure (no DB calls, no network calls, no side effects).
4. **Stateless Providers:** Providers never read PostgreSQL, write Redis, or schedule jobs. The framework owns all persistence and deduplication.

---

## 2. Core Interfaces & Reference Implementations

### 2.1 The `IntegrationProvider.triggers` Contract

This is the exact interface all integration modules must implement to support inbound events.

```typescript
// packages/providers/src/types.ts
import type { z } from "zod";

export interface NormalizedTriggerEvent {
  provider: string;          // e.g. "sentry"
  eventType: string;         // Internal normalized type (e.g. "error_created")
  providerEventType: string; // Native type from header (e.g. "issue.created")
  occurredAt: string;        // ISO 8601 timestamp
  dedupKey: string;          // Globally unique key for deduplication
  title: string;
  url?: string;
  context: Record<string, unknown>; // Parsed, structured data
  raw?: unknown;             // Optional: original payload
}

export interface WebhookRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string | undefined>;
  params: Record<string, string | undefined>;
  rawBody: Buffer; // Mandatory for accurate HMAC verification
  body: unknown;
}

export interface WebhookParseInput {
  json: unknown;
  headers: Record<string, string | string[] | undefined>;
  providerEventType?: string;
  receivedAt: string;
}

export interface WebhookVerificationResult {
  ok: boolean;
  identity?: { kind: "org" | "integration" | "trigger"; id: string };
  immediateResponse?: { status: number; body?: unknown }; // For Slack/Jira challenges
}

export interface TriggerType<TConfig = any> {
  id: string;
  description: string;
  configSchema: z.ZodType<TConfig>;
  // Pure, synchronous, no side effects
  matches(event: NormalizedTriggerEvent, config: TConfig): boolean;
}

export interface ProviderTriggers {
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
      orgId: string 
    }): Promise<{ events: NormalizedTriggerEvent[]; nextCursor: unknown; backoffSeconds?: number }>;
  };

  // Called ONCE per event batch to fetch missing data (e.g. fetching Jira issue fields via API)
  hydrate?: (event: NormalizedTriggerEvent, ctx: { token: string }) => Promise<NormalizedTriggerEvent>;
}

```

### 2.2 Archetype A: Direct Webhook (Sentry)

Here is a complete reference implementation of a stateless Webhook Trigger using the vNext interfaces.

```typescript
// packages/providers/src/providers/sentry/triggers.ts
import { z } from "zod";
import { constantTimeEqual, hmacSha256 } from "../../helpers/crypto";
import type { ProviderTriggers } from "../../types";

const severityRank = { debug: 1, info: 2, warning: 3, error: 4, fatal: 5 };

export const sentryTriggers: ProviderTriggers = {
  types: [
    {
      id: "error_created",
      description: "Triggers when a new error matches the severity filter.",
      configSchema: z.object({ minSeverity: z.enum(["info", "error", "fatal"]) }),
      matches: (event, config) => {
        // PURE FUNCTION: No DB or Network calls.
        const eventSeverity = String(event.context.severity);
        const rank = severityRank[eventSeverity as keyof typeof severityRank] ?? 0;
        const minRank = severityRank[config.minSeverity as keyof typeof severityRank] ?? 0;
        return rank >= minRank;
      }
    }
  ],
  webhook: {
    verify: async (req, secret) => {
      if (!secret) return { ok: false };
      const signature = req.headers["sentry-hook-signature"] as string;
      const expected = hmacSha256(req.rawBody, secret);
      
      return { 
        ok: constantTimeEqual(expected, signature),
        // Tells the framework how to route this webhook to a specific Org
        identity: { kind: "org", id: req.headers["sentry-org"] as string } 
      };
    },
    parse: async ({ json, providerEventType, receivedAt }) => {
      const payload = json as any;
      if (!payload.data?.event) return []; // Ignore pings

      return [{
        provider: "sentry",
        eventType: "error_created",
        providerEventType: providerEventType ?? "unknown",
        occurredAt: receivedAt,
        dedupKey: `sentry:${payload.data.event.id}`, // Guaranteed unique
        title: payload.data.event.title ?? "Sentry event",
        context: { severity: payload.data.event.level ?? "error" },
        raw: payload
      }];
    }
  }
};

```

---

## 3. Subsystem Deep Dives

### 3.1 Async Webhook Ingestion (The Rate Limit Bomb Fix)

When an upstream service (like Jira) bulk-updates 100 tickets, it fires 100 concurrent webhooks. If the Express route parses, fetches API data (`hydrate()`), and queries the DB synchronously, the framework will hit HTTP 429 limits, block the Node event loop, and time out. The upstream provider will drop the webhooks and disable the endpoint.

**Phase 1: The Fast-Ack Express Route (`apps/trigger-service/src/api/webhooks.ts`)**

```typescript
app.post("/webhooks/direct/:providerId", async (req, res) => {
  const provider = ProviderRegistry.get(req.params.providerId);
  if (!provider?.triggers?.webhook) return res.status(404).send();

  // 1. Resolve secret & Verify
  const secret = await resolveWebhookSecret(req.params.providerId, req); 
  const verification = await provider.triggers.webhook.verify(req, secret);
  
  if (!verification.ok) return res.status(401).send();
  if (verification.immediateResponse) {
      return res.status(verification.immediateResponse.status).send(verification.immediateResponse.body);
  }

  // 2. SHOCK ABSORBER: Save and acknowledge instantly. No hydration. No matching.
  await db.insert(webhookInbox).values({
    provider: provider.id,
    providerEventType: req.header("x-event-type") ?? null,
    payload: req.body,
    headers: req.headers,
    organizationId: verification.identity?.kind === 'org' ? verification.identity.id : null,
    status: "pending"
  });
  
  return res.status(200).send("OK");
});

```

**Phase 2: The BullMQ Async Worker (`apps/trigger-service/src/webhook-inbox/worker.ts`)**

A BullMQ worker safely drains the `webhook_inbox` table:

1. Claims an inbox row.
2. Calls `provider.triggers.webhook.parse()`.
3. Calls `provider.triggers.hydrate()` (utilizing BullMQ's native `rateLimit` configuration to back off on HTTP 429s).
4. Runs `matches()` against all active triggers for the resolved organization.
5. Executes the Transactional Outbox Handoff.

### 3.2 The Polling Fan-Out Multiplier Fix

If an org creates 50 Sentry triggers for different projects, scheduling 50 BullMQ jobs will instantly exceed Sentry's API limits.

Instead, BullMQ schedules ONE repeatable job per `trigger_poll_groups` (Unique by `organization_id + provider + integration_id`).

1. The worker acquires a Redis Lock: `poll:<provider>:<integrationId>` to prevent overlap.
2. It resolves the Integration OAuth token.
3. It calls `provider.triggers.polling.poll(cursor, token)`. The provider fetches a superset of *all* recent events for that connection.
4. The worker persists the `nextCursor` to `trigger_poll_groups`.
5. **The In-Memory Fan Out:** The worker loads all active triggers for that polling group and executes `matches(event, config)` locally in RAM.

This turns an  external network fan-out problem into an  network call.

### 3.3 Transactional Outbox Handoff

When an event passes `matches()`, the system must prevent duplicate execution and ensure the Automation worker picks it up safely.

```typescript
await db.transaction(async (tx) => {
  // 1. UNIQUE(trigger_id, dedup_key) guard prevents double-processing
  const event = await tx.insert(triggerEvents).values({...}).returning();
  
  // 2. Create the run
  const run = await tx.insert(automationRuns).values({
    triggerEventId: event[0].id,
    automationId: trigger.automationId,
    status: "queued"
  }).returning();

  // 3. Inform the automation pipeline
  await tx.insert(outbox).values({
    kind: "enqueue_enrich",
    payload: { runId: run[0].id }
  });
});

```

---

## 4. File Tree

```
apps/trigger-service/src/
├── index.ts                          # Entry point: starts server + polling worker
├── server.ts                         # Express app setup (health, webhook routes)
├── api/
│   └── webhooks.ts                   # Fast-Ack ingestion (POST /webhooks/nango, /direct/:providerId)
├── lib/
│   ├── identity-resolver.ts          # Resolve WebhookIdentity → org
│   └── trigger-processor.ts          # Generic pipeline (hydrate, matches, dedup, handoff)
├── webhook-inbox/
│   └── worker.ts                     # BullMQ worker: process webhook_inbox rows
└── polling/
    └── worker.ts                     # BullMQ worker: poll per group, fan-out in memory

packages/providers/src/
├── registry.ts                       # ProviderRegistry (static Map)
├── types.ts                          # IntegrationProvider + Trigger types
└── providers/
    ├── linear/                       # webhook + polling implementations
    ├── sentry/                       # webhook-only
    └── posthog/                      # direct, per-trigger webhooks

```

---

## 5. Data Models & Schemas

### Database Tables

```sql
-- Decouples ingestion from processing for reliability
CREATE TABLE webhook_inbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id TEXT,
    provider TEXT NOT NULL,
    provider_event_type TEXT,
    headers JSONB,
    payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT,
    received_at TIMESTAMPTZ DEFAULT now(),
    processed_at TIMESTAMPTZ
);
CREATE INDEX idx_webhook_inbox_status ON webhook_inbox (status, received_at);

-- Groups polling triggers by provider+connection for efficient batch polling
CREATE TABLE trigger_poll_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    integration_id UUID,
    cron_expression TEXT NOT NULL,
    enabled BOOLEAN DEFAULT true,
    last_polled_at TIMESTAMPTZ,
    cursor JSONB,
    UNIQUE(organization_id, provider, integration_id)
);

CREATE TABLE triggers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id TEXT NOT NULL,
    automation_id UUID NOT NULL,
    trigger_type TEXT NOT NULL,          -- "webhook" | "polling"
    provider TEXT NOT NULL,
    event_type TEXT,
    enabled BOOLEAN NOT NULL DEFAULT true,
    config JSONB NOT NULL,
    integration_id UUID,
    webhook_secret TEXT,
    webhook_url_path TEXT UNIQUE,
    external_webhook_id TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE trigger_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trigger_id UUID NOT NULL,
    organization_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    event_type TEXT NOT NULL,
    provider_event_type TEXT,
    occurred_at TIMESTAMPTZ NOT NULL,
    dedup_key TEXT NOT NULL,
    title TEXT NOT NULL,
    context JSONB NOT NULL,
    raw_payload JSONB,
    status TEXT NOT NULL DEFAULT 'queued',
    created_at TIMESTAMPTZ DEFAULT now(),
    processed_at TIMESTAMPTZ,
    UNIQUE(trigger_id, dedup_key)
);

```

---

## 6. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
| --- | --- | --- | --- |
| Providers package | Trigger service → Providers | `ProviderRegistry` | Lookup integration modules for parsing/polling/matching. |
| Integrations | Trigger service → Integrations | `getToken()` | Polling and optional `hydrate()` token resolution. |
| Automations | Triggers → Automations | `createRunFromTriggerEvent()` | Transactional outbox handoff. |
| Secrets | Triggers → Secrets | `resolveSecretValue()` | Webhook verification secrets (provider-specific). |

### Security & Auth

* Webhook endpoints are unauthenticated by design; signature verification is mandatory where the provider supports it.
* Provider verification must not leak secrets in error messages or logs.

### Observability

* Log fields: `providerId`, `organizationId` (after resolution), `triggerId`, `providerEventType`, `eventType`, `dedupKey`.
* Metrics: webhook request counts by provider, parse failures, dedup hits, poll duration, poll backoffs, run creation failures.
* **Inbox Garbage Collection:** A lightweight cron worker must be scheduled to `DELETE FROM webhook_inbox WHERE status IN ('completed', 'failed') AND processed_at < NOW() - INTERVAL '7 days'` to prevent PostgreSQL bloat.

---

## 7. Acceptance Gates

* [ ] All webhooks route through `apps/trigger-service/src/api/webhooks.ts`.
* [ ] Old `apps/web/src/app/api/webhooks/` directory deleted entirely.
* [ ] `pnpm typecheck` passes with no strict type errors on `NormalizedTriggerEvent`.
* [ ] Orphaned pollers are correctly removed (when the last trigger in a poll group is deleted, the BullMQ job is unscheduled).

---

## 8. Known Limitations & Tech Debt

* [ ] Providers with expiring webhook registrations (e.g., Jira) require a refresh job and `external_webhook_id` persistence (deferred to later Jira implementation).
* [ ] Secret resolution can be chicken-and-egg for per-integration secrets (e.g., PostHog). Framework must extract a "candidate identity" from URL params or headers, look up the secret from the DB, and *then* call `verify()`.

