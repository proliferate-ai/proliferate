# Billing on Cloud (V1)

## Goal
Bill managed-cloud customers in a way that is simple, explainable, and tied to real agent usage.

Current code anchors:
- [web billing router](/Users/pablo/proliferate/apps/web/src/server/routers/billing.ts)
- [billing services](/Users/pablo/proliferate/packages/services/src/billing)
- [metering](/Users/pablo/proliferate/packages/services/src/billing/metering.ts)

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
- Token usage where available

If exact token metrics are unavailable for a path, meter runtime minutes.

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

## Non-goals (V1)
- Highly complex pricing permutations
- Per-action micro-pricing for every connector
- Full finance-grade cost attribution by every subcomponent

## Definition of done checklist
- [ ] Metering records are durable and queryable
- [ ] Billing UI shows usage and recent billable activity
- [ ] Plan limits are enforced with clear user messaging
- [ ] Invoices/charges can be explained from recorded events
