# Triggers — System Spec

## 1. Scope & Purpose

### In Scope
- Trigger CRUD, trigger event listing, and skip flow (`apps/web/src/server/routers/triggers.ts`, `packages/services/src/triggers/service.ts`, `packages/services/src/triggers/db.ts`).
- Automation-scoped trigger creation and manual run trigger bootstrapping (`apps/web/src/server/routers/automations.ts`, `packages/services/src/automations/service.ts`).
- Trigger service runtime (`apps/trigger-service/src/index.ts`, `apps/trigger-service/src/server.ts`).
- Async webhook inbox ingestion and processing (`apps/trigger-service/src/api/webhooks.ts`, `packages/services/src/webhook-inbox/db.ts`, `apps/trigger-service/src/webhook-inbox/worker.ts`).
- Poll-group scheduling and execution (`packages/services/src/poll-groups/db.ts`, `apps/trigger-service/src/polling/worker.ts`, `packages/queue/src/index.ts`).
- Provider trigger registration and adapter contracts (`packages/triggers/src/service/register.ts`, `packages/triggers/src/service/registry.ts`, `packages/triggers/src/service/base.ts`).
- Trigger-to-run handoff via transactional outbox (`packages/services/src/runs/service.ts`, `apps/worker/src/automation/index.ts`).
- Schedule CRUD APIs (data management only) (`apps/web/src/server/routers/schedules.ts`, `packages/services/src/schedules/service.ts`).
- Webhook lifecycle routes that remain in web app (Nango auth/sync and GitHub installation lifecycle only) (`apps/web/src/app/api/webhooks/nango/route.ts`, `apps/web/src/app/api/webhooks/github-app/route.ts`).

### Out of Scope
- Automation run enrichment/execute/finalize internals after outbox dispatch (`automations-runs.md`, `apps/worker/src/automation/index.ts`).
- OAuth connection lifecycle and integration UX (`integrations.md`, `packages/services/src/integrations/service.ts`).
- Session runtime semantics inside gateway hubs (`sessions-gateway.md`, `apps/gateway/src/hub`).
- Action execution and approval policy (`actions.md`).

### Mental Models
1. Triggers are an ingestion layer, not an execution layer. They decide whether an event should start a run; they do not run agent logic themselves (`apps/trigger-service/src/lib/trigger-processor.ts`, `packages/services/src/runs/service.ts`).
2. The durable unit of webhook work is `webhook_inbox`, not an HTTP request. Reliability comes from DB persistence plus async workers (`apps/trigger-service/src/api/webhooks.ts`, `packages/services/src/webhook-inbox/db.ts`).
3. Polling scale is integration-scoped. The system polls once per poll group and fans out to triggers in-memory (`packages/services/src/poll-groups/db.ts`, `apps/trigger-service/src/polling/worker.ts`).
4. Trigger matching and trigger processing are separate concerns. Providers parse/filter event payloads; services own dedup, persistence, and run creation (`packages/triggers/src/service/base.ts`, `apps/trigger-service/src/lib/trigger-processor.ts`).
5. Trigger events are audit facts and workflow state, not transient logs. Their status drives operator visibility and downstream reconciliation (`packages/db/src/schema/triggers.ts`, `apps/worker/src/automation/finalizer.ts`).
6. A trigger firing does not enqueue BullMQ directly; it writes outbox work in the same DB transaction as run/event creation (`packages/services/src/runs/service.ts`, `apps/worker/src/automation/index.ts`).
7. Registered runtime providers are explicit. A provider existing in code is not the same as being active in trigger-service registry (`packages/triggers/src/index.ts`, `packages/triggers/src/service/register.ts`).

### Things Agents Get Wrong
- Assuming Next.js API routes are in the trigger event path. Real trigger ingestion is in trigger-service (`apps/trigger-service/src/api/webhooks.ts`), while web app webhook routes now handle lifecycle-only flows (`apps/web/src/app/api/webhooks/nango/route.ts`, `apps/web/src/app/api/webhooks/github-app/route.ts`).
- Assuming webhook handlers create runs synchronously. Run creation occurs in async workers after inbox claim (`apps/trigger-service/src/webhook-inbox/worker.ts`, `apps/trigger-service/src/lib/trigger-processor.ts`).
- Assuming one polling job per trigger. Runtime scheduling is per poll group (`packages/services/src/poll-groups/db.ts`, `apps/trigger-service/src/polling/worker.ts`).
- Assuming `/providers` is the complete feature list for UI providers. UI also hardcodes standalone providers (`apps/trigger-service/src/api/providers.ts`, `apps/web/src/components/automations/trigger-config-form.tsx`).
- Assuming schedule CRUD in `schedules` drives runtime cron execution. Runtime cron triggers are `triggers.provider = "scheduled"` rows with `pollingCron`, executed by trigger-service workers (`apps/trigger-service/src/scheduled/worker.ts`, `packages/services/src/triggers/service.ts`).
- Assuming direct webhooks are production-ready. `/webhooks/direct/:providerId` stores inbox rows, but inbox worker still requires a Nango `connectionId` path (`apps/trigger-service/src/api/webhooks.ts`, `apps/trigger-service/src/webhook-inbox/worker.ts`).
- Assuming trigger list pending counts represent queued work. Current query counts `status = "pending"`, but event lifecycle uses `queued` (`packages/services/src/triggers/db.ts`, `packages/db/src/schema/triggers.ts`).
- Assuming manual runs have a first-class trigger provider. Manual runs are represented as disabled webhook triggers with `config._manual = true` (`packages/services/src/automations/service.ts`, `packages/services/src/automations/db.ts`).

---

## 2. Core Concepts

### Async Webhook Inbox
- HTTP ingestion acknowledges quickly and defers real processing to workers.
- Inbox rows transition across `pending` / `processing` / `completed` / `failed` with GC cleanup.
- Evidence: `apps/trigger-service/src/api/webhooks.ts`, `packages/services/src/webhook-inbox/db.ts`, `apps/trigger-service/src/gc/inbox-gc.ts`.

### Nango-Forwarded Identity
- Current primary routing identity comes from Nango forward envelopes (`connectionId`, `providerConfigKey`).
- Integration resolution is done against integration provider `nango`.
- Evidence: `packages/triggers/src/service/adapters/nango.ts`, `apps/trigger-service/src/webhook-inbox/worker.ts`, `packages/services/src/integrations/db.ts`.

### Poll Groups
- Poll groups are persisted in `trigger_poll_groups` and keyed by org + provider + integration.
- Group cursor state lives on poll-group rows, not on trigger rows.
- Evidence: `packages/db/src/schema/schema.ts`, `packages/services/src/poll-groups/db.ts`, `apps/trigger-service/src/polling/worker.ts`.

### Trigger Event + Run Handoff
- A trigger match creates a `trigger_events` row and an `automation_runs` row together.
- Outbox `enqueue_enrich` is inserted in the same transaction.
- Evidence: `packages/services/src/runs/service.ts`, `apps/worker/src/automation/index.ts`.

### Provider Contracts (Current vs Target)
- Current trigger-service runtime uses class-based `WebhookTrigger` / `PollingTrigger` and a runtime registry.
- Target architecture defines `ProviderTriggers` + `NormalizedTriggerEvent` in `@proliferate/providers`.
- Both coexist; trigger-service runtime still depends on class-based registry.
- Evidence: `packages/triggers/src/service/base.ts`, `packages/triggers/src/service/registry.ts`, `packages/providers/src/types.ts`.

### Trigger Event Lifecycle
- New trigger events start as `queued`.
- Execution path moves them to `processing` when session starts, then `completed` or `failed` when runs terminate/complete; unmatched or blocked events are `skipped`.
- Evidence: `packages/services/src/runs/service.ts`, `apps/worker/src/automation/index.ts`, `apps/gateway/src/hub/capabilities/tools/automation-complete.ts`, `apps/worker/src/automation/finalizer.ts`.

---

_Sections 3 (File Tree) and 4 (Data Models) are intentionally removed. Code and schema files are the source of truth._

## 5. Conventions & Patterns

### Do
- Use trigger-service webhook routes only for ingress and durability boundaries; do matching/handoff asynchronously (`apps/trigger-service/src/api/webhooks.ts`, `apps/trigger-service/src/webhook-inbox/worker.ts`).
- Keep DB writes in `packages/services` modules (`packages/services/src/triggers/db.ts`, `packages/services/src/webhook-inbox/db.ts`).
- Use poll groups for polling scheduling and cleanup (`packages/services/src/poll-groups/db.ts`, `packages/services/src/triggers/service.ts`).
- Persist skipped events for auditability when filters/automation state block execution (`apps/trigger-service/src/lib/trigger-processor.ts`).
- Use `createRunFromTriggerEvent()` for atomic event+run+outbox writes (`packages/services/src/runs/service.ts`).

### Don’t
- Don’t enqueue automation run jobs directly from trigger matching code; always write outbox (`packages/services/src/runs/service.ts`, `apps/worker/src/automation/index.ts`).
- Don’t treat `/providers` response as full product capability; it only reflects registered trigger-service definitions (`apps/trigger-service/src/api/providers.ts`, `packages/triggers/src/service/register.ts`).
- Don’t schedule per-trigger polling jobs in new logic (`apps/trigger-service/src/polling/worker.ts`, `packages/services/src/poll-groups/db.ts`).
- Don’t assume `status = pending` means queued trigger work in current DB state (`packages/services/src/triggers/db.ts`, `packages/db/src/schema/triggers.ts`).

### Reliability and Safety Rules
- Inbox claim must remain lock-safe (`FOR UPDATE SKIP LOCKED`) for concurrent workers (`packages/services/src/webhook-inbox/db.ts`).
- Poll execution must hold a per-group distributed lock to avoid concurrent provider calls (`apps/trigger-service/src/polling/worker.ts`, `packages/queue/src/index.ts`).
- Signature checks must happen before trusting webhook identity (Nango route verifies through adapters; web app lifecycle routes verify their own signatures) (`packages/triggers/src/service/adapters/nango.ts`, `apps/web/src/app/api/webhooks/nango/route.ts`, `apps/web/src/app/api/webhooks/github-app/route.ts`).

---

## 6. Subsystem Deep Dives (Invariants & Rules)

### 6.1 Ingestion Boundary Invariants (Status: Implemented/Partial)
- Invariant: Public webhook endpoints must durably persist inbound payloads before any run-side effects.
  Evidence: `apps/trigger-service/src/api/webhooks.ts`, `packages/services/src/webhook-inbox/db.ts`.
- Invariant: Trigger-service webhook endpoints do not create `trigger_events` or `automation_runs` directly.
  Evidence: `apps/trigger-service/src/api/webhooks.ts`, `packages/services/src/runs/service.ts`.
- Invariant: `/webhooks/nango` is the only fully wired production ingress for trigger events today.
  Evidence: `apps/trigger-service/src/api/webhooks.ts`, `apps/trigger-service/src/webhook-inbox/worker.ts`.
- Rule: `/webhooks/direct/:providerId` is currently ingress-only; downstream identity resolution is not complete.
  Evidence: `apps/trigger-service/src/api/webhooks.ts`, `apps/trigger-service/src/webhook-inbox/worker.ts`.

### 6.2 Webhook Inbox State Invariants (Status: Implemented)
- Invariant: Inbox rows are claimed in batches with row-level locking semantics.
  Evidence: `packages/services/src/webhook-inbox/db.ts:claimBatch`.
- Invariant: Successfully processed rows are marked `completed`; processing errors are marked `failed` with error text.
  Evidence: `apps/trigger-service/src/webhook-inbox/worker.ts`, `packages/services/src/webhook-inbox/db.ts`.
- Invariant: Inbox table retention is bounded by periodic GC (default 7 days for completed/failed rows).
  Evidence: `apps/trigger-service/src/gc/inbox-gc.ts`, `packages/services/src/webhook-inbox/db.ts:gcOldRows`.

### 6.3 Webhook Matching Invariants (Status: Implemented/Partial)
- Invariant: Inbox processing resolves integration identity from Nango `connectionId`, then fetches active webhook triggers by integration ID.
  Evidence: `apps/trigger-service/src/webhook-inbox/worker.ts`, `packages/services/src/triggers/db.ts:findActiveWebhookTriggers`.
- Invariant: Provider matching only runs when trigger row provider matches trigger definition provider.
  Evidence: `apps/trigger-service/src/webhook-inbox/worker.ts`.
- Rule: If integration is absent or no active triggers exist, inbox rows are treated as completed no-op work.
  Evidence: `apps/trigger-service/src/webhook-inbox/worker.ts`.
- Rule: No-connection direct rows currently error and become failed rows.
  Evidence: `apps/trigger-service/src/webhook-inbox/worker.ts:extractConnectionId`.

### 6.4 Trigger Processing Invariants (Status: Implemented)
- Invariant: Automation enabled-state gates trigger execution; disabled automations produce skipped trigger events.
  Evidence: `apps/trigger-service/src/lib/trigger-processor.ts`.
- Invariant: Trigger config is validated with adapter schema (`safeParse`), then adapter filtering is applied per event.
  Evidence: `apps/trigger-service/src/lib/trigger-processor.ts`.
- Invariant: Dedup check is per `(trigger_id, dedup_key)` and enforced before run creation.
  Evidence: `apps/trigger-service/src/lib/trigger-processor.ts`, `packages/services/src/triggers/db.ts:eventExistsByDedupKey`, `packages/db/src/schema/triggers.ts`.
- Invariant: Run-creation failures are recorded as skipped trigger events with `run_create_failed`.
  Evidence: `apps/trigger-service/src/lib/trigger-processor.ts`.

### 6.5 Poll Group Invariants (Status: Implemented)
- Invariant: Poll worker executes one provider poll call per poll group and fans results out to all active triggers in that group.
  Evidence: `apps/trigger-service/src/polling/worker.ts`, `packages/services/src/poll-groups/db.ts`.
- Invariant: Poll concurrency is guarded by a Redis lock per group with TTL.
  Evidence: `apps/trigger-service/src/polling/worker.ts`, `packages/queue/src/index.ts:REDIS_KEYS.pollGroupLock`.
- Invariant: Poll cursors are persisted in `trigger_poll_groups.cursor`.
  Evidence: `packages/services/src/poll-groups/db.ts:updateGroupCursor`, `packages/db/src/schema/schema.ts`.
- Rule: Orphan poll groups are removed when no active polling triggers remain; BullMQ repeatables are unscheduled accordingly.
  Evidence: `packages/services/src/triggers/service.ts`, `packages/services/src/poll-groups/db.ts`, `packages/queue/src/index.ts:removePollGroupJob`.

### 6.6 Trigger-to-Run Handoff Invariants (Status: Implemented)
- Invariant: `createRunFromTriggerEvent` atomically inserts trigger event, automation run, and outbox row (`enqueue_enrich`).
  Evidence: `packages/services/src/runs/service.ts`.
- Invariant: Outbox dispatcher is responsible for queueing enrich/execute work; trigger-service is not.
  Evidence: `apps/worker/src/automation/index.ts:dispatchOutbox`.
- Invariant: Trigger event IDs are carried through to session creation for run/session/event traceability.
  Evidence: `apps/worker/src/automation/index.ts`.

### 6.7 Trigger Event Status Invariants (Status: Implemented)
- Invariant: New matched events are created in `queued` state.
  Evidence: `packages/services/src/runs/service.ts`.
- Invariant: Event transitions to `processing` when execution session is created.
  Evidence: `apps/worker/src/automation/index.ts`.
- Invariant: Event transitions to `completed` on successful `automation.complete`, otherwise `failed` for failed/timed-out/no-completion paths.
  Evidence: `apps/gateway/src/hub/capabilities/tools/automation-complete.ts`, `apps/worker/src/automation/finalizer.ts`.
- Rule: Non-matches / disabled automation / explicit operator skip are represented with `skipped` and specific `skipReason` values.
  Evidence: `apps/trigger-service/src/lib/trigger-processor.ts`, `packages/services/src/triggers/service.ts:skipTriggerEvent`.

### 6.8 Provider Registry and Contract Invariants (Status: Partial)
- Invariant: Trigger-service runtime registry is populated only by explicit `registerDefaultTriggers()` calls.
  Evidence: `apps/trigger-service/src/index.ts`, `packages/triggers/src/service/register.ts`.
- Invariant: Runtime-registered defaults are GitHub/Linear/Sentry webhooks, plus Gmail polling only when Composio API key is configured.
  Evidence: `packages/triggers/src/service/register.ts`.
- Rule: `ProviderTriggers` in `@proliferate/providers` is the target architecture, but trigger-service currently runs class-based adapters.
  Evidence: `packages/providers/src/types.ts`, `packages/triggers/src/service/base.ts`.

### 6.9 Scheduled and Manual Trigger Invariants (Status: Implemented)
- Invariant: Schedule CRUD exists and validates cron format, but schedule CRUD itself does not execute runs.
  Evidence: `apps/web/src/server/routers/schedules.ts`, `packages/services/src/schedules/service.ts`.
- Invariant: Trigger-service starts a scheduled worker and restores repeatable jobs for enabled cron triggers at startup.
  Evidence: `apps/trigger-service/src/index.ts`, `apps/trigger-service/src/scheduled/worker.ts`, `packages/services/src/triggers/service.ts:listEnabledScheduledTriggers`.
- Invariant: Scheduled trigger CRUD keeps BullMQ repeatable cron jobs in sync on create/update/delete paths.
  Evidence: `packages/services/src/automations/service.ts:createAutomationTrigger`, `packages/services/src/triggers/service.ts`.
- Invariant: Manual runs bypass external webhook/polling ingest by creating synthetic trigger events through a dedicated manual trigger marker (`config._manual = true`).
  Evidence: `packages/services/src/automations/service.ts:triggerManualRun`, `packages/services/src/automations/db.ts:findManualTrigger`.

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| Automations/Runs | Triggers → Automations | `runs.createRunFromTriggerEvent()` | Atomic trigger event + run + outbox insertion. |
| Outbox/Workers | Triggers → Worker | `outbox.kind = enqueue_enrich` | Trigger system hands off via outbox, not direct queue push. |
| Integrations | Triggers → Integrations | `findByConnectionIdAndProvider()`, `findById()` | Nango `connectionId` resolution and poll-group connection lookup. |
| Queue/BullMQ | Triggers → Queue | `createWebhookInboxWorker`, `createPollGroupWorker`, repeatables | Inbox drain, poll groups, and GC scheduling. |
| Redis | Triggers → Redis | `REDIS_KEYS.pollGroupLock()` | Distributed lock for per-group poll mutual exclusion. |
| Providers Runtime | Trigger-service → `@proliferate/triggers` | `registry`, `WebhookTrigger`, `PollingTrigger` | Current runtime matching/parsing contract. |
| Providers Target Contract | Triggers ↔ `@proliferate/providers` | `ProviderTriggers`, `NormalizedTriggerEvent` | Migration target; not yet trigger-service runtime path. |
| Web App Lifecycle Webhooks | Web app ↔ Integrations | `/api/webhooks/nango`, `/api/webhooks/github-app` | Handles auth/sync and installation lifecycle, not trigger event execution. |

### Security & Auth
- Trigger CRUD APIs are org-scoped (`orgProcedure`) (`apps/web/src/server/routers/triggers.ts`).
- Trigger-service webhook routes are public and rely on signature/identity validation paths (`apps/trigger-service/src/api/webhooks.ts`, `packages/triggers/src/service/adapters/nango.ts`).
- Nango/GitHub lifecycle routes in web app have independent signature validation (`apps/web/src/app/api/webhooks/nango/route.ts`, `apps/web/src/app/api/webhooks/github-app/route.ts`).
- Direct provider webhook route currently does not enforce provider-specific verification in trigger-service runtime path (`apps/trigger-service/src/api/webhooks.ts`).

### Observability
- Trigger-service uses structured child loggers by module (`apps/trigger-service/src/lib/logger.ts`, usage across workers/routes).
- Key identifiers: `inboxId`, `provider`, `connectionId`, `triggerId`, `groupId`, `sessionId` (`apps/trigger-service/src/webhook-inbox/worker.ts`, `apps/trigger-service/src/polling/worker.ts`, `apps/trigger-service/src/lib/trigger-processor.ts`).
- Inbox GC limits table growth and should be monitored alongside inbox backlog and poll-group lag (`apps/trigger-service/src/gc/inbox-gc.ts`).

---

## 8. Acceptance Gates

- [ ] `pnpm typecheck` passes.
- [ ] Trigger-service starts cleanly with registered default triggers and workers (`apps/trigger-service/src/index.ts`).
- [ ] Webhook ingress remains durable-first (payload persisted before run-side effects).
- [ ] Poll group lifecycle works end-to-end: schedule on create/update, cleanup on orphan.
- [ ] Scheduled trigger lifecycle works end-to-end: schedule on create/update/delete and execute by cron.
- [ ] Trigger event lifecycle remains coherent (`queued` → `processing` → terminal or skipped).
- [ ] This spec stays aligned with runtime invariants, mental models, and known failure modes.

---

## 9. Known Limitations & Tech Debt

- [ ] **Direct webhook execution gap (High):** `/webhooks/direct/:providerId` stores inbox rows, but inbox worker still requires Nango `connectionId`; direct identity resolution path is not wired. Evidence: `apps/trigger-service/src/api/webhooks.ts`, `apps/trigger-service/src/webhook-inbox/worker.ts`.
- [ ] **Fast-ack duplicate parse path (Medium):** Ingress route currently calls dispatcher logic that may parse provider events, then inbox worker parses again. This violates strict "ingress-only" intent and adds duplicate CPU. Evidence: `apps/trigger-service/src/api/webhooks.ts`, `apps/trigger-service/src/lib/webhook-dispatcher.ts`, `apps/trigger-service/src/webhook-inbox/worker.ts`.
- [ ] **PostHog runtime registration mismatch (Medium):** PostHog provider exists in package-level provider map but is not registered in trigger-service default registry; trigger-service `/providers` will not expose it as runnable. Evidence: `packages/triggers/src/posthog.ts`, `packages/triggers/src/service/register.ts`, `apps/trigger-service/src/api/providers.ts`.
- [ ] **Webhook URL path mismatch (Medium):** Trigger rows store `webhookUrlPath` values (for `/webhooks/t_*` style URLs), but trigger-service currently exposes `/webhooks/nango` and `/webhooks/direct/:providerId` only; web app form still shows legacy `/api/webhooks/automation/:id` and `/api/webhooks/posthog/:id` paths that do not exist. Evidence: `packages/services/src/triggers/service.ts`, `apps/trigger-service/src/api/webhooks.ts`, `apps/web/src/components/automations/trigger-config-form.tsx`, `apps/web/src/app/api/webhooks/`.
- [ ] **Dual provider abstraction layers (Medium):** `TriggerProvider` and class-based trigger adapters coexist with target `ProviderTriggers`; runtime is still class-based. Evidence: `packages/triggers/src/types.ts`, `packages/triggers/src/service/base.ts`, `packages/providers/src/types.ts`.
- [ ] **Pending count status bug (Medium):** Trigger list pending count query uses `status = "pending"` while canonical lifecycle uses `queued`; counts can under-report or stay zero. Evidence: `packages/services/src/triggers/db.ts:getPendingEventCounts`, `packages/db/src/schema/triggers.ts`.
- [ ] **Poll config fan-out coupling (Low/Medium):** Poll-group worker calls provider `poll()` with group-level empty config and first trigger definition; trigger-specific filters happen only after poll, which can increase provider/API load. Evidence: `apps/trigger-service/src/polling/worker.ts`.
- [ ] **Legacy polling fields still present (Low):** `triggers.polling_state` remains in schema and API mapper even though poll groups own cursor state in active flow. Evidence: `packages/db/src/schema/triggers.ts`, `packages/services/src/triggers/mapper.ts`, `packages/services/src/poll-groups/db.ts`.
- [ ] **HMAC helper duplication (Low):** Per-provider HMAC helpers are duplicated across trigger modules and webhook routes. Evidence: `packages/triggers/src/github.ts`, `packages/triggers/src/linear.ts`, `packages/triggers/src/sentry.ts`, `packages/triggers/src/posthog.ts`, `apps/web/src/app/api/webhooks/nango/route.ts`.
