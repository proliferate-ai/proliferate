# Context
You are implementing the "Universal Credit Gating" and "Snapshot Quota Enforcement" updates as defined in `docs/specs/billing-metering.md`. Follow all rules in `CLAUDE.md`.

# Strict File Boundaries (Only touch these files)
- `packages/services/src/billing/gate.ts` (Create this)
- `apps/web/src/lib/billing.ts`
- `apps/web/src/server/routers/sessions-create.ts`
- `apps/gateway/src/api/proliferate/http/sessions.ts`
- `packages/services/src/billing/snapshot-limits.ts`
- `apps/web/src/server/routers/sessions-pause.ts`
- `apps/web/src/server/routers/sessions-snapshot.ts`
- `packages/services/src/billing/org-pause.ts`
- `packages/shared/src/billing/billing-token.ts` (Delete this)

# Instructions
1. **The Iron Door Gate:**
   - Create `packages/services/src/billing/gate.ts`.
   - Move the DB-backed gating logic out of `apps/web/src/lib/billing.ts` into this new file. Implement `checkBillingGateForOrg` and `assertBillingGateForOrg`. It should evaluate against the pure gate in `@proliferate/shared/billing/gating`. On denial, throw a domain error (fail-closed).
   - Update `apps/web/src/server/routers/sessions-create.ts` to call `assertBillingGateForOrg` *before* inserting the session record.
   - **Critical:** Inject `assertBillingGateForOrg` into `apps/gateway/src/api/proliferate/http/sessions.ts` so Automations and API clients can no longer bypass billing.

2. **Snapshot Quota Enforcement:**
   - Open `packages/services/src/billing/snapshot-limits.ts`.
   - Ensure `ensureSnapshotCapacity` actually accepts a provider callback to *physically delete* the oldest snapshot from the cloud provider, then clears its DB reference.
   - Wire `ensureSnapshotCapacity` into `apps/web/src/server/routers/sessions-pause.ts` and `apps/web/src/server/routers/sessions-snapshot.ts` before the new snapshot is taken.

3. **Dead Code Cleanup:**
   - Delete `packages/shared/src/billing/billing-token.ts` completely and remove any imports pointing to it.
   - In `packages/services/src/billing/org-pause.ts`, completely delete the V1 `handleCreditsExhausted` auto-top-up logic. Ensure only the V2 termination logic remains.

# Validation
Run `pnpm typecheck`. Ensure no core gating enforcement logic remains purely in the web layer.
