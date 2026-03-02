# Billing on Cloud (V1)

## Goal
Bill managed-cloud customers in a way that is simple, explainable, and tied to real agent usage.

Current code anchors:
- [web billing router](/Users/pablo/proliferate/apps/web/src/server/routers/billing.ts)
- [billing services](/Users/pablo/proliferate/packages/services/src/billing)
- [metering](/Users/pablo/proliferate/packages/services/src/billing/metering.ts)
- [billing worker](/Users/pablo/proliferate/apps/worker/src/billing/worker.ts)
- [billing outbox processor](/Users/pablo/proliferate/apps/worker/src/jobs/billing/outbox.job.ts)

## Billing file tree

```text
apps/web/src/server/routers/
  billing.ts                  # customer-facing billing APIs

apps/worker/src/billing/
  worker.ts                   # recurring billing jobs

apps/worker/src/jobs/billing/
  outbox.job.ts               # outbox posting/sync jobs
  fast-reconcile.job.ts       # on-demand reconciliation

packages/services/src/billing/
  metering.ts                 # usage event creation
  gate.ts                     # runtime gating checks
  org-pause.ts                # pause org on policy/credit rules
  shadow-balance.ts           # fast balance approximation
  outbox.ts                   # outbox posting helpers
```

## Core data models

| Model | Purpose | File |
|---|---|---|
| `billing_events` | Usage ledger + outbox posting state (`pending`, `posted`, `failed`) | `packages/db/src/schema/billing.ts` |
| `llm_spend_cursors` | Incremental sync cursor for LLM spend ingestion | `packages/db/src/schema/billing.ts` |
| `billing_reconciliations` | Manual/automatic corrections with audit trail | `packages/db/src/schema/billing.ts` |
| `sessions` | Runtime duration and lifecycle timestamps used for compute metering | `packages/db/src/schema/sessions.ts` |
| `organization` billing fields | Current balance/plan and gating behavior | `packages/db/src/schema/schema.ts` / auth schema |

## V1 pricing model (recommended)
Two-part model:
1. Platform fee (seat/base)
2. Usage fee (runtime and model usage)

Keep invoicing transparent:
- Session runtime minutes
- Model token spend proxy
- Optional premium for heavy sandbox usage

## What to meter in V1
Required metering dimensions:
- Session/runtime duration
- Run count
- Invocation count for expensive connectors
- LLM token usage (from LiteLLM spend logs)

If LLM proxy spend data is unavailable for a path, meter runtime minutes as fallback and label estimate in reporting.

## Metering source-of-truth rules
- LLM token usage source-of-truth is LiteLLM spend ingestion (`llm-sync-*` worker jobs, per-org cursor).
- Gateway runtime stream usage frames are advisory telemetry only (not billable token truth).
- Session compute duration is derived from durable lifecycle timestamps (`startedAt`, `pausedAt`, `endedAt`) with pause windows excluded.
- Pause/resume boundaries must create deterministic metering cut points to avoid double counting.
- Approval-wait time is billable only while session is still running; once idle pause triggers, paused window is not billable.

Budget enforcement split (required):
- Ledger truth remains async (spend ingestion).
- Hard budget/rate enforcement must happen synchronously at LLM proxy virtual-key layer.
- Billing worker reconciliation must not be the first line of budget defense for runaway loops.

## Metering event model
Create durable usage records when:
- Session starts/stops
- Run completes/fails
- Invocation executes expensive side effects

Each usage row needs:
- org id
- source (session/run/invocation)
- quantity + unit
- timestamp
- correlation id for debugging
- provider/model metadata when applicable

## Billing UX requirements
Customer can see:
- Current billing period usage summary
- Top cost drivers (by agent/repo/workflow)
- Recent billable events
- Plan limits and nearing-limit warnings

## Entitlement gates (cloud only)
Need soft/hard gates for:
- Max concurrent runs
- Max active background agents
- Monthly usage thresholds

Gates should fail with clear reason and upgrade path.

## Metering event contract (minimum fields)
Every billable event must include:
- `organizationId`
- `eventType` (`compute` or `llm`)
- `quantity`, `credits`
- `idempotencyKey`
- `sessionIds` (where relevant)
- `metadata` for debugging/explaining invoices

## Non-goals (V1)
- Highly complex pricing permutations
- Per-action micro-pricing for every connector
- Full finance-grade cost attribution by every subcomponent

## Definition of done checklist
- [ ] Metering records are durable and queryable
- [ ] Billing UI shows usage and recent billable activity
- [ ] Plan limits are enforced with clear user messaging
- [ ] Invoices/charges can be explained from recorded events
- [ ] Outbox/reconciliation jobs can recover from transient posting failures
