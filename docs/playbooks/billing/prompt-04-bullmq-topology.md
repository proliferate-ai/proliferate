# Context
You are migrating the core compute billing infrastructure to BullMQ, as defined in `docs/specs/billing-metering.md`. Follow all rules in `CLAUDE.md`.

# Strict File Boundaries (Only touch these files)
- `packages/shared/src/billing/distributed-lock.ts` (Delete this)
- `apps/worker/src/billing/worker.ts`
- `apps/worker/src/jobs/billing/*.ts` (Create these)
- `packages/queue/src/index.ts` (Register new queues)

# Instructions
1. **Rip out legacy distributed cron:**
   - Delete `packages/shared/src/billing/distributed-lock.ts` entirely. Remove any imports.
   - Open `apps/worker/src/billing/worker.ts` and completely gut all `setInterval` loops and custom Redis lock acquisitions.

2. **Implement BullMQ Repeatable Jobs:**
   - In `packages/queue/src/index.ts` (or your standard BullMQ queue setup file), define the new queues/workers for billing.
   - In `apps/worker/src/jobs/billing/`, create the BullMQ processors for:
     - `metering.job.ts`: runs `billing.runMeteringCycle()` every 30s.
     - `outbox.job.ts`: runs `processOutbox()` every 60s.
     - `grace.job.ts`: checks and expires grace windows every 60s.
     - `reconcile.job.ts`: runs `reconcileShadowBalance()` nightly at 00:00 UTC.

3. **BullMQ Fan-Out Sync:**
   - Create `llm-sync-dispatcher.job.ts` (every 30s) that queries active orgs and enqueues a `llm-sync-org` job for each org.
   - Create `llm-sync-org.job.ts` that processes the individual org. *(Note: If `bulkDeductShadowBalance` and `litellm-api.ts` do not exist on this branch yet, create empty mock functions for them so the typechecker passes. We will wire them up during the merge).*

# Validation
Run `pnpm typecheck`. Verify that no custom Redis Lua scripts or `setInterval` calls remain in the billing worker.
