# Automation Runs v2

This document is the canonical reference for the Automation Runs v2 pipeline.
It is intended to be a print-and-implement spec that prioritizes correctness,
reliability, and operational clarity over short-term convenience.

## Executive Summary

Automation Runs v2 rebuilds automation execution into a reliable, idempotent,
and observable pipeline.

The core guarantees are:

1. Runs always reach a terminal state.
2. Duplicate execution is prevented at every stage.
3. Webhook ingestion is fast, idempotent, and side-effect free.
4. Enrichment produces sanitized artifacts and a source ledger before prompting.
5. Completion is explicit and durable, with artifacts written asynchronously.

## Non-Negotiable Invariants

1. Ingress never creates sessions.
2. Automation execution never uses `initialPrompt`.
3. Automation execution never relies on UI attachment or UI auto-send.
4. Every stage must be claim-and-lease protected.
5. All gateway calls that can be retried must support `Idempotency-Key`.
6. All external side effects must accept `effect_id` and be idempotent.
7. Runs must be finalized even when the agent never calls `automation.complete`.

## File Tree Map

This map shows where changes live. Paths are repo-root relative.

```
repo/
├─ apps/
│  ├─ web/
│  │  ├─ src/
│  │  │  ├─ app/api/webhooks/                  # ingress handlers (create runs + outbox only)
│  │  │  ├─ app/api/runs/                       # run status endpoints
│  │  │  └─ components/coding-session/runtime/  # UI runtime (must not auto-send for automation)
│  ├─ gateway/
│  │  ├─ src/api/proliferate/http/
│  │  │  ├─ sessions.ts                         # Idempotency-Key support + session status
│  │  │  └─ message.ts                          # Idempotency-Key support
│  │  ├─ src/hub/capabilities/tools/
│  │  │  └─ automation-complete.ts              # intercept automation.complete
│  │  └─ src/lib/
│  │     └─ idempotency.ts                      # Idempotency-Key storage
│  ├─ worker/
│  │  ├─ src/automation/                         # enrich/execute/finalize + outbox dispatcher
├─ packages/
│  ├─ services/
│  │  ├─ src/runs/                               # run state machine + transitions
│  │  ├─ src/outbox/                             # transactional outbox helpers
│  ├─ db/
│  │  ├─ src/schema/schema.ts                    # tables
│  │  └─ drizzle/0004_automation_runs.sql         # migration
│  └─ shared/
│     └─ src/opencode-tools/                     # automation.complete tool definition
└─ docs/
   └─ AUTOMATION_RUNS.md                          # this doc
```

## Core Entities

### trigger_events

Purpose: immutable ingress audit and dedup source.

Key fields:

- `trigger_id`
- `organization_id`
- `dedup_key`
- `raw_payload`
- `created_at`

### automation_runs

Purpose: authoritative run record and state machine.

Key fields:

- identity: `organization_id`, `automation_id`, `trigger_event_id`, `trigger_id`
- state: `status`, `status_reason`, `failure_stage`
- leasing: `lease_owner`, `lease_expires_at`, `lease_version`
- timestamps: `queued_at`, `enrichment_started_at`, `enrichment_completed_at`, `execution_started_at`, `prompt_sent_at`, `completed_at`, `last_activity_at`, `deadline_at`
- session: `session_id`, `session_created_at`
- completion: `completion_id`, `completion_json`, `completion_artifact_ref`
- artifacts: `enrichment_artifact_ref`, `sources_artifact_ref`, `policy_artifact_ref`

### automation_run_events

Purpose: append-only run history for debugging and audits.

Key fields:

- `run_id`
- `type`
- `from_status`, `to_status`
- `data`
- `created_at`

### automation_side_effects

Purpose: idempotency ledger for external actions.

Key fields:

- `organization_id`, `effect_id` (unique)
- `run_id`
- `kind`, `provider`
- `response_json`

### outbox

Purpose: transactional enqueue to queue worker.

Key fields:

- `organization_id`
- `kind`
- `payload`
- `status`, `attempts`, `available_at`, `last_error`

## State Machine

Primary flow:

```
queued -> enriching -> ready -> running -> succeeded | failed | needs_human
```

Additional terminal states:

- `canceled`
- `timed_out`
- `skipped`

Rules:

- only the runs service transitions status
- every transition writes an event row
- transitions are idempotent and safe under retries

## Ingestion Flow

Ingress is fast and deterministic. It never creates sessions and performs no external calls.

Steps in a single DB transaction:

1. verify signature or token
2. compute dedup key
3. insert `trigger_event` (or return existing on dedup)
4. insert `automation_run` in `queued` status
5. insert outbox row `{kind: 'enqueue_enrich', payload: {run_id}}`
6. respond `202 Accepted`

## Outbox Dispatcher

The dispatcher is at-least-once and idempotent.

1. select pending rows
2. enqueue jobs to BullMQ
3. mark outbox row `dispatched` or `failed`

## Worker Stages

### Leasing

All stages use a lease claim to prevent duplicate work.

Claim query pattern:

```
UPDATE automation_runs
SET lease_owner = $workerId,
    lease_expires_at = now() + interval '5 minutes',
    lease_version = lease_version + 1
WHERE id = $runId
  AND status IN (...)
  AND (lease_expires_at IS NULL OR lease_expires_at < now())
RETURNING *;
```

### Enrichment

- claim `queued`
- transition to `enriching`
- redact and normalize context
- transition to `ready`
- outbox enqueue `execute`

### Execute

- claim `ready`
- transition to `running`
- create session with `Idempotency-Key: run:{run_id}:session`
- send prompt via `/message` with `Idempotency-Key: run:{run_id}:prompt:v1`
- never use `initialPrompt`

### Finalize

Runs periodically to mark zombie runs.

- query runs in `running` past deadline or inactivity
- check gateway session status endpoint
- mark `timed_out` or `failed` if session terminated without completion

## Gateway Requirements

1. `Idempotency-Key` support for session create and message send.
2. Session status endpoint for finalizer.
3. `automation.complete` tool interception that forwards to runs service.

## Completion

Completion writes are transactional and idempotent.

Flow:

1. gateway intercepts tool call and forwards to runs service
2. runs service stores completion JSON and transitions status
3. run events are recorded for auditing

## Side Effects

All external side effects require an `effect_id` and are idempotent.

## Observability

Minimum required signals:

- structured logs with `run_id`, `trigger_event_id`, `session_id`, `organization_id`
- metrics for stage latency and error rates
- queue depth and job age
- correlation id propagated across services

## Implementation Phases

Phase 1: correctness floor

- schema + migrations
- webhook ingestion -> run + outbox
- outbox dispatcher
- leasing helpers
- worker jobs: enrich, execute, finalize
- gateway idempotency + status endpoint
- UI runtime: no auto-send for automation sessions

Phase 2: completion durability

- `automation.complete` -> runs service
- completion stored in DB
- artifact writer job

Phase 3: side effects + artifact tools

- side effects service + provider integration
- artifact tools + policy hardening

Phase 4: consolidation + scale

- single canonical ingress
- full egress restrictions
- provider rate limiting
