# Trigger Services (GitHub, Linear, Sentry, Slack)

## Goal
Turn external events into reliable internal work requests for agents.

## Core rule
Trigger-service ingests and persists events quickly, then async workers process them.
Do not run heavy agent logic directly in webhook HTTP handlers.

Current key files:
- [webhooks ingestion](/Users/pablo/proliferate/apps/trigger-service/src/api/webhooks.ts)
- [webhook inbox worker](/Users/pablo/proliferate/apps/trigger-service/src/webhook-inbox/worker.ts)
- [polling worker](/Users/pablo/proliferate/apps/trigger-service/src/polling/worker.ts)
- [trigger services](/Users/pablo/proliferate/packages/services/src/triggers)

## Trigger subsystem file tree

```text
apps/trigger-service/src/
  api/webhooks.ts               # provider webhook entrypoints
  webhook-inbox/worker.ts       # async processing from durable inbox
  polling/worker.ts             # scheduled pull-based events

packages/services/src/triggers/
  service.ts                    # trigger CRUD + orchestration rules
  db.ts                         # trigger and trigger event persistence
  mapper.ts                     # API shape mapping

packages/services/src/webhook-inbox/
  db.ts                         # raw inbox persistence + claim/retry
```

## Core data models

| Model | Purpose | File |
|---|---|---|
| `triggers` | Trigger definitions (provider, type, config, integration binding) | `packages/db/src/schema/triggers.ts` |
| `trigger_events` | Durable event records before/after processing | `packages/db/src/schema/triggers.ts` |
| `trigger_event_actions` | Audit of tool actions from trigger processing | `packages/db/src/schema/triggers.ts` |
| `trigger_poll_groups` | Polling fan-in by org/provider/integration for scale | `packages/db/src/schema/schema.ts` |
| `webhook_inbox` | Raw webhook durability and retry safety | `packages/db/src/schema/schema.ts` |

## V1 trigger scope
Required:
- GitHub (mentions, issue/PR events, CI signal entrypoints)
- Linear (issue updates/comments)
- Sentry (issue events)
- Slack (mentions/commands)

Optional/later:
- PostHog batch analysis
- Jira parity for enterprise bundles
- Docs/productivity sources (for example Google Docs) via connector-backed triggers

## Wake model (recommended)
Use both methods:
- Webhooks for immediate user/issue events
- Polling for periodic backlog scans and resilience

Why both:
- Webhooks are fast but can miss events
- Polling is reliable but slower and rate-limited
- Together they provide speed + recovery

## Event pipeline
1. Receive event from provider
2. Validate source/signature
3. Persist inbox row
4. Ack provider quickly
5. Worker claims inbox row
6. Match to target agent(s)
7. Create trigger event + manager wake request (not child coding run)
8. Dispatch wake via outbox/worker pipeline

Run-storm prevention rule:
- Trigger-service must not spawn child coding runs directly.
- If manager is already running/queued for a coworker, coalesce additional wake events into inbox.
- Trigger-service performs deterministic pre-LLM grouping so manager receives summarized batches, not raw firehose payloads.
- Manager harness decides child run fanout from grouped summaries.

Deterministic grouping requirements (before manager inbox):
- Group by provider-specific stable keys (for example `sentry_issue_id`, `linear_issue_id`, `github_repo+pr+event_type`).
- Maintain counters and first/last occurrence timestamps per group.
- Store representative payload sample (or normalized summary) instead of every duplicate event body.
- Enforce max grouped items per inbox wake payload; overflow items remain queued for subsequent wakes.

## Dedup and idempotency
Must dedupe on:
- Provider event id
- Content hash + source + time window

Must support safe reprocessing if worker crashes.

## Trigger-to-agent mapping
Mapping model should support:
- Org-level agent owning source (for example global Sentry triager)
- Repo/project scoped agent binding
- Manual override in UI

Routing precedence (required):
1. Explicit trigger -> coworker binding
2. Repo/project scoped coworker binding
3. Org default coworker for provider

Fanout/backpressure rules (required):
- Default fanout is one target coworker per trigger event unless explicitly configured.
- If multiple targets are allowed, enforce max fanout per event.
- When org concurrency cap is reached, queue events and mark as delayed (not dropped).

## UX expectations
Users should not configure brittle technical trigger graphs for V1.
They should configure:
- Which sources this agent watches
- Which projects/repos are included
- Poll cadence (if applicable)
- Per-source cron tabs with defaults (`every 5m`, `hourly`, `daily`) and custom cron option
- \"Run now\" test action for each configured trigger

## Definition of done checklist
- [ ] Webhook ingestion is durable and async
- [ ] Polling path exists for at least one provider batch source
- [ ] Dedup prevents duplicate run storms
- [ ] Trigger events map cleanly to target agents
- [ ] Trigger failures are visible and retryable
- [ ] Trigger setup UX supports both webhook and cron-style workflows without manual JSON editing
