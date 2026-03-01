# Trigger Services (Tick Engine + Source Ingestion)

## Goal
Turn external source state into reliable internal work requests for coworkers.

## Core rule
Trigger-service is ingestion + scheduling infrastructure, not the LLM reasoning layer.
It should persist quickly, schedule safely, and hand off deterministic work.

Current key files:
- [polling worker](/Users/pablo/proliferate/apps/trigger-service/src/polling/worker.ts)
- [scheduled worker](/Users/pablo/proliferate/apps/trigger-service/src/scheduled/worker.ts)
- [webhooks ingestion (optional external ingress)](/Users/pablo/proliferate/apps/trigger-service/src/api/webhooks.ts)
- [trigger services](/Users/pablo/proliferate/packages/services/src/triggers)

## Trigger subsystem file tree

```text
apps/trigger-service/src/
  polling/worker.ts             # tick cadence execution + source polling
  scheduled/worker.ts           # cron scheduler restore + due trigger execution
  api/webhooks.ts               # optional external ingress path (normalized into wake pipeline)
  webhook-inbox/worker.ts       # async ingestion processing for external ingress path

packages/services/src/triggers/
  service.ts                    # trigger/tick CRUD + orchestration rules
  db.ts                         # trigger and trigger event persistence
  mapper.ts                     # API shape mapping

packages/services/src/webhook-inbox/
  db.ts                         # raw external ingress durability + claim/retry
```

## Core data models

| Model | Purpose | File |
|---|---|---|
| `triggers` | Trigger/tick definitions (provider, cadence, config, integration binding) | `packages/db/src/schema/triggers.ts` |
| `trigger_events` | Durable event records before/after processing | `packages/db/src/schema/triggers.ts` |
| `trigger_event_actions` | Audit of tool actions from trigger processing | `packages/db/src/schema/triggers.ts` |
| `trigger_poll_groups` | Polling fan-in by org/provider/integration for scale | `packages/db/src/schema/schema.ts` |
| `webhook_inbox` | Raw external event durability and retry safety | `packages/db/src/schema/schema.ts` |

Checkpoint model:
- `agent_source_cursors` (or equivalent) for per-coworker/per-source checkpoint state, replacing broad poll-group-only cursor ownership.

## V1 source scope
Required:
- GitHub (issues/PR/CI signal entrypoints)
- Linear (issue updates/comments)
- Sentry (issue events)
- Slack (mentions/commands)

Optional/later:
- PostHog batch analysis
- Jira parity for enterprise bundles
- Docs/productivity sources (for example Google Docs) via connector-backed ingestion

## Wake model (tick-first)
Primary path:
- A cadence tick determines due coworkers.
- Worker polls configured sources outbound.
- If there is no new source delta, worker updates checkpoint and exits.
- If there is new source delta, worker creates wake event + manager wake request.

Secondary path (optional ingress):
- Webhooks can still be ingested where needed.
- Webhook payloads are normalized into the same internal wake/event path.

Why this shape:
- Works in private-network/self-host environments without public inbound routing.
- Keeps operator model simple: polling cadence + checkpoints + idempotency.

## Event pipeline
1. Tick scheduler identifies due coworker/source scope
2. Poll source APIs outbound (or ingest external event via ingress path)
3. Normalize payload to internal event shape
4. Persist wake event
5. Deduplicate/group bursty events deterministically
6. Create manager wake request (not child coding run)
7. Dispatch wake via outbox/worker pipeline

Run-storm prevention rule:
- Trigger-service must not spawn child coding runs directly.
- If manager is already running/queued for a coworker, coalesce additional wake events.
- Trigger-service performs deterministic pre-LLM grouping so manager receives summarized batches, not raw firehose payloads.
- Manager harness decides child run fanout from grouped summaries.

Context handoff rule:
- Trigger-service and manager handoff must preserve structured source context for child run creation.
- Minimum handoff shape includes:
  - provider + stable group key
  - first/last seen timestamps + count
  - representative payload summary + links
- This structured bundle is passed to child run context assembly (see `16-agent-tool-contract.md`).

Deterministic grouping requirements:
- Group by provider-specific stable keys (for example `sentry_issue_id`, `linear_issue_id`, `github_repo+pr+event_type`).
- Maintain counters and first/last occurrence timestamps per group.
- Store representative payload sample (or normalized summary), not every duplicate body.
- Enforce max grouped items per wake payload; overflow items remain queued.

## Dedup and idempotency
Must dedupe on:
- Provider event id or source cursor checkpoint
- Content hash + source + time window
- Tick idempotency key (`coworkerId + source + scheduledWindow`)

Must support safe reprocessing if worker crashes.

## Trigger-to-agent mapping
Mapping model should support:
- Org-level coworker owning source (for example global Sentry triager)
- Repo/project scoped coworker binding
- Manual override in UI

Routing precedence (required):
1. Explicit source/tick -> coworker binding
2. Repo/project scoped coworker binding
3. Org default coworker for provider/source

Fanout/backpressure rules (required):
- Default fanout is one target coworker per wake event unless explicitly configured.
- If multiple targets are allowed, enforce max fanout per event.
- When org concurrency cap is reached, queue events and mark delayed (not dropped).

## UX expectations
Users should not configure brittle technical trigger graphs for V1.
They should configure:
- Which sources this coworker watches
- Which projects/repos are included
- Tick cadence (`every 5m`, `hourly`, `daily`) and optional custom cron
- "Run now" test action for each configured source

## Definition of done checklist
- [ ] Tick-based polling path is durable and idempotent
- [ ] Optional external ingress path normalizes into same wake pipeline
- [ ] Dedup prevents duplicate run storms
- [ ] Wake events map cleanly to target coworkers
- [ ] Failures are visible and retryable
- [ ] Trigger setup UX supports tick cadence without manual JSON editing
