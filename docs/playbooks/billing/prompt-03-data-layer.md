# Context
You are implementing the data layer foundations for the horizontally scalable LLM Spend Sync and Bulk Ledger deductions as defined in `docs/specs/billing-metering.md`. Follow all rules in `CLAUDE.md`.

# Strict File Boundaries (Only touch these files)
- `packages/db/src/schema/billing.ts` (and generate the migration)
- `packages/services/src/billing/db.ts`
- `packages/services/src/billing/litellm-api.ts` (Create this)
- `packages/services/src/billing/shadow-balance.ts`

# Instructions
1. **Partitioned DB Cursors:**
   - In `packages/db/src/schema/billing.ts`, rename `llm_spend_cursors` to `llm_spend_cursors_global` (to archive it).
   - Create a NEW `llm_spend_cursors` table where the primary key is `organization_id` (FK to `organization.id` CASCADE).
   - Generate the Drizzle migration (`pnpm -C packages/db db:generate`).

2. **LiteLLM Admin REST API Client:**
   - Create `packages/services/src/billing/litellm-api.ts`.
   - Implement a fetch wrapper to call LiteLLM's `GET /spend/logs/v2` using `LLM_PROXY_ADMIN_URL` and `LLM_PROXY_MASTER_KEY` as a Bearer token. It must accept `team_id` (orgId).
   - Remove the old raw SQL cross-schema queries (`LITELLM_SPEND_LOGS_REF`) from `packages/services/src/billing/db.ts`.

3. **Bulk Ledger Updates (Fixing Postgres Contention):**
   - Add `bulkDeductShadowBalance(orgId, totalCredits, events)` to `packages/services/src/billing/shadow-balance.ts`.
   - Implementation: Open exactly ONE Postgres transaction -> lock the org row (`FOR UPDATE`) -> execute a bulk `INSERT INTO billing_events ON CONFLICT (idempotency_key) DO NOTHING` -> sum the credits *only for the successfully inserted rows* -> deduct that sum from the shadow balance.

# Validation

Run `pnpm typecheck`. Ensure zero raw SQL queries against `litellm.LiteLLM_SpendLogs` remain.