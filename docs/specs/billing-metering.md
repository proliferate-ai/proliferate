# Billing & Metering — System Spec

## 1. Scope & Purpose

### In Scope
- Credit-based billing model and pricing tiers
- Billing state machine and enforcement per organization
- Shadow balance (local credit counter) and atomic deductions
- Compute metering for running sessions (1 credit/hr)
- LLM spend sync from LiteLLM Admin API (3x markup converted to credits)
- Credit gating for session lifecycle operations
- Billing event outbox posting to Autumn
- Reconciliation (nightly and on-demand fast reconcile)
- Free tier provisioning (5 permanent credits, no credit card)
- Plan management (Dev, Pro) and credit top-up packs
- Auto-recharge with circuit breaker and optional spend cap
- Grace period enforcement (paid plans only, 5-min window)
- Snapshot quota and retention cleanup policies
- Atomic concurrent session admission enforcement
- Billing BullMQ workers and schedules

### Out of Scope
- LLM key minting/model routing (`llm-proxy.md`)
- Onboarding UX and org lifecycle (`auth-orgs.md`)
- Session runtime mechanics beyond billing contracts (`sessions-gateway.md`)
- Sandbox provider implementation details (`sandbox-providers.md`)
- Custom API key passthrough (not supported; all LLM traffic goes through the gateway)

### Mental Model
Billing is a credits-first control system with external reconciliation.

1. **Credits are the single unit of account.** All usage (compute and LLM) is metered in credits. 1 credit = $1 face value.
2. **Hot path is local and fail-closed.** Session start/resume decisions are made from org state + shadow balance in Postgres, not live Autumn reads.
3. **Ledger before side effects.** Usage is written locally as immutable billing events with deterministic idempotency keys, then posted to Autumn asynchronously.
4. **State machine drives access.** `billingState` controls whether new sessions are blocked and whether running sessions must be paused.
5. **Two independent cost streams, one balance.** Compute and LLM usage both deduct from the same `shadowBalance` and Autumn `credits` feature.
6. **Enforcement is pause-first, not destructive.** Credit enforcement preserves resumability via pause/snapshot flows.

### Things Agents Get Wrong
- Autumn is not part of the session start/resume gate; `checkBillingGateForOrg` is local (`packages/services/src/billing/gate.ts`).
- The shadow balance can be negative; overdraft is allowed briefly and then enforced (`packages/services/src/billing/shadow-balance.ts`).
- `free` depletion transitions directly to `exhausted` (no grace period); only `active` enters `grace` (`packages/shared/src/billing/state.ts`).
- `session_resume` skips the minimum-credit and concurrent-limit checks; it still enforces state-level blocking (`packages/shared/src/billing/gating.ts`).
- Gate concurrency checks are advisory; authoritative concurrent-limit enforcement happens at session insert under advisory lock (`packages/services/src/sessions/db.ts`).
- Free-tier deductions write events as `status: "skipped"` for idempotency safety (`packages/services/src/billing/shadow-balance.ts`).
- LLM per-org sync jobs are not enqueue-deduped by `jobId`; idempotency is at billing-event level (`apps/worker/src/jobs/billing/llm-sync-dispatcher.job.ts`).
- Grace with `NULL graceExpiresAt` is treated as expired (fail-closed) (`packages/services/src/orgs/db.ts`, `packages/shared/src/billing/state.ts`).
- Billing feature flag off (`NEXT_PUBLIC_BILLING_ENABLED=false`) disables both gate enforcement and billing workers.

---

## 2. Core Concepts

### Credits
The single unit of account for all billing. 1 credit = $1 face value.
- **Compute**: 1 credit/hr of sandbox time (E2B 4vCPU/8GiB, ~$0.33/hr cost, ~67% margin).
- **LLM**: Raw LLM cost multiplied by 3x, converted to credits. Blended gross margin ~50-60%.
- All orgs start with 5 free credits (permanent, no expiry, no credit card required).

### Pricing Tiers

**Top-Up Packs** (one-time purchases, no subscription required):

| Pack | Price | Credits | $/Credit |
|------|-------|---------|----------|
| Starter | $10 | 10 | $1.00 |
| Builder | $20 | 20 | $1.00 |
| Growth | $50 | 50 | $1.00 |
| Scale | $100 | 100 | $1.00 |
| Enterprise | $1,000 | 1,000 | $1.00 |

**Subscription Plans** (monthly, includes credit allocation):

| Plan | Price | Credits/mo | Effective $/Credit |
|------|-------|------------|-------------------|
| Dev | $50/mo | 100 | $0.50 |
| Pro | $200/mo | 400 | $0.50 |

All plans include the 5 free credits on top of their allocation.

### Margin Model

| Cost Stream | Our Cost | We Charge | Gross Margin |
|------------|----------|-----------|-------------|
| Compute (E2B 4vCPU/8GiB) | ~$0.33/hr | 1 credit/hr ($1) | ~67% |
| LLM | Varies | 3x raw cost in credits | ~67% |
| **Blended** | | | **~50-60%** |

Blended margin depends on tier mix: top-up packs at ~67% margin, plans at ~33% margin (2x credit value per dollar). Most plan users won't burn full allocation, pushing effective margin higher.

### Autumn
External billing provider for subscriptions, checkout, and authoritative feature balances.
- Used in checkout, outbox posting, plan activation, and reconciliation.
- Not used in session admission hot path.
- Reference: `packages/shared/src/billing/autumn-client.ts`

### Shadow Balance
Per-org local credit balance used by the gate.
- Stored on `organization.shadow_balance`.
- Deducted atomically with billing event insertion.
- Reconciled asynchronously against Autumn.
- Reference: `packages/services/src/billing/shadow-balance.ts`

### Billing State Machine
Org FSM that controls admission and enforcement behavior.
- States: `free`, `active`, `grace`, `exhausted`, `suspended`.
- `exhausted` and `suspended` require pause enforcement for running sessions.
- Reference: `packages/shared/src/billing/state.ts`

#### State Definitions

| State | Entry Condition | Behavior |
|-------|----------------|----------|
| `free` | Org created, 5 free credits provisioned | Can create sessions while `shadowBalance > 0`. No grace window on depletion. |
| `active` | Paid plan subscribed OR top-up purchased | Full access. Grace window available on depletion (if auto-recharge off). |
| `grace` | `active` org's balance hits zero (auto-recharge off) | 5-min window for in-flight work to save. New sessions blocked, running sessions continue. Countdown visible. |
| `exhausted` | `free` balance hits zero, OR grace period expires, OR `active` with auto-recharge card decline | All sessions force-paused with snapshots. Non-dismissable banner. Buy credits or upgrade to resume. |
| `suspended` | Manual override for billing issues | Everything blocked. Contact support. |

#### State Transitions

```
                    ┌─────────────────────────────────────────────┐
                    │                                             │
  ┌──────┐    buy credits    ┌────────┐                          │
  │ free │ ────────────────► │ active │ ◄────── buy credits ─────┤
  │      │    or subscribe   │        │                          │
  └──┬───┘                   └───┬────┘                          │
     │                           │                               │
     │ balance = 0               │ balance = 0                   │
     │ (no grace)                │                               │
     │                    ┌──────┴──────┐                        │
     │                    │             │                        │
     │              auto-recharge    auto-recharge               │
     │                 OFF              ON                       │
     │                    │             │                        │
     │              ┌─────▼──┐    charge card                   │
     │              │ grace  │    (keep running)                │
     │              │ (5min) │         │                        │
     │              └────┬───┘    card decline                  │
     │                   │             │                        │
     │              grace expires      │                        │
     │                   │             │                        │
     ▼                   ▼             ▼                        │
  ┌──────────┐                                          ┌───────┴──┐
  │exhausted │ ◄───────────────────────────────────────►│suspended │
  └──────────┘          manual override                 └──────────┘
```

### Billing Event Ledger + Outbox
`billing_events` is both immutable local usage ledger and outbox queue.
- Events are inserted first, then posted to Autumn later.
- Retry/backoff and permanent-failure signaling are outbox responsibilities.
- Reference: `packages/services/src/billing/outbox.ts`

### Auto-Recharge
Automatic credit reloading for `active` orgs when balance runs low.
- Charges card for credits when balance approaches zero.
- Sessions keep running seamlessly during successful recharges.
- Circuit breaker on card decline falls back to exhausted (no grace).
- Optional cap on auto-recharge spend per billing cycle.
- Should always refill by default when enabled.
- Reference: `packages/services/src/billing/auto-topup.ts`

### Reconciliation
Corrects drift between local shadow balance and Autumn balances.
- Nightly full reconcile + on-demand fast reconcile.
- Reconciliation writes auditable records.
- Reference: `apps/worker/src/jobs/billing/reconcile.job.ts`, `apps/worker/src/jobs/billing/fast-reconcile.job.ts`

---

## 3. Banners & User Communication

Billing banners communicate credit state to users. Defined in `apps/web/src/components/dashboard/billing-banner.tsx`.

| State | Dismissable | CTA | Behavior |
|-------|------------|-----|----------|
| Suspended | No | "Contact support" | Blocks everything. |
| Exhausted | No | "Buy credits" / "Upgrade" | All sessions paused. Must purchase to resume. |
| Grace period | No | "Buy credits" + countdown | Shows remaining time (5 min). New sessions blocked. |
| Low credits | Yes | "View billing" | Warning threshold. |

**Banner priority** (highest first): Suspended > Exhausted > Grace > Low credits.

Low credit warning thresholds:
- **Approaching**: 80% of plan-included credits used (or < 20% of balance remaining for non-plan).
- **Critical**: 95% of plan-included credits used (or < 5% of balance remaining).

---

## 4. Reloading Flows

### Free tier (balance hits zero)
1. Balance hits zero → straight to `exhausted` (no grace window).
2. All running sessions snapshot → pause.
3. Buy credits or upgrade whenever to resume.

### Paid plans, auto-recharge OFF (default)
1. Balance hits zero → enter `grace` (5-min window for in-flight work).
2. Grace expires → `exhausted`, sessions snapshot → pause.
3. Buy credits to resume.

### Paid plans, auto-recharge ON
1. Balance runs low → auto-charges card for credits.
2. Sessions keep running seamlessly.
3. Circuit breaker on card decline → falls back to `exhausted`, sessions pause.
4. Optional cap on auto-recharge spend per cycle.

---

## 5. Conventions & Patterns

### Do
- Deduct credits only via `deductShadowBalance` / `bulkDeductShadowBalance`.
- Use deterministic idempotency keys:
  - Compute interval: `compute:{sessionId}:{fromMs}:{toMs}`
  - Compute finalization: `compute:{sessionId}:{fromMs}:final`
  - LLM event: `llm:{requestId}`
- Keep billing gate checks in service-layer gate helpers (`assertBillingGateForOrg`, `checkBillingGateForOrg`).
- Convert LLM spend to credits using the 3x multiplier before deduction.
- Provision 5 free credits on org creation, regardless of selected plan.

### Don't
- Don't call Autumn in session start/resume hot path.
- Don't update `shadowBalance` directly from route handlers.
- Don't bypass admission guard for billable session creation paths.
- Don't allow custom API key passthrough; all LLM traffic must route through the gateway.
- Don't grant grace periods to `free`-tier orgs.

### Error Handling
- Billing gate is fail-closed on lookup/load failures.
- Worker processors isolate per-org/per-event failures where possible and continue batch progress.

### Reliability
- Metering/outbox/grace/reconcile/snapshot-cleanup/partition-maintenance workers run with BullMQ concurrency `1`.
- LLM org sync worker runs with concurrency `5`.
- Fast reconcile worker runs with concurrency `3`.
- Outbox retry uses exponential backoff (`60s` base, `1h` cap, `5` max attempts).

---

## 6. Subsystem Deep Dives (Declarative Invariants)

### 6.1 Compute Metering — `Implemented`

**Invariants**
- Only `sessions.status = 'running'` are metered (`packages/services/src/billing/metering.ts`).
- Compute rate: 1 credit per hour of sandbox time, prorated to the second.
- A compute interval is billable at most once by deterministic idempotency key.
- Metering skips intervals under `METERING_CONFIG.minBillableSeconds`.
- Dead-sandbox finalization bills only through last-known-alive bound, not detection time.
- Dead sandboxes are transitioned to `paused` with `pauseReason: "inactivity"` (resumable behavior).

**Rules**
- Metered time boundary moves forward only after deduct attempt.
- Idempotency correctness is more important than real-time boundary smoothness.

### 6.2 LLM Spend Metering — `Implemented`

**Invariants**
- LLM raw cost from LiteLLM is multiplied by 3x to derive credit deduction amount.
- Dispatcher periodically enumerates billable orgs and enqueues per-org jobs.
- Per-org worker pulls spend logs from LiteLLM Admin REST API, sorts deterministically, and converts positive spend to ledger events.
- Deduction path is bulk and idempotent (`llm:{request_id}` keys).
- Tokenized zero/negative spend records are treated as anomaly logs and are not billed.
- Cursor advancement occurs after deduction attempt.

**Rules**
- Duplicate org jobs are tolerated; idempotency keys protect financial correctness.
- Cursor movement and deductions should be reasoned about as eventually consistent, not atomic.

### 6.3 Shadow Balance + Atomic Ledger Writes — `Implemented`

**Invariants**
- Deductions are atomic with event insert in one DB transaction with `FOR UPDATE` org row lock.
- Global idempotency is enforced by `billing_event_keys` before event insert.
- Duplicate idempotency key means no additional balance movement.
- Free-tier deductions write events as `status: "skipped"` (idempotency preserved, outbox ignored).
- State transitions are derived from post-deduction balance (`active|free` depletion, grace overdraw).
- Overdraft cap is enforced after deduction (`GRACE_WINDOW_CONFIG.maxOverdraftCredits`).

**Rules**
- `addShadowBalance` and `reconcileShadowBalance` are the only non-deduct balance mutation paths.
- All balance corrections must write reconciliation records.

### 6.4 Credit Gating — `Implemented`

**Invariants**
- Service gate is the authoritative API for billing admission checks.
- Gate denies on load errors (fail-closed).
- When billing feature flag is disabled, gate allows by design.
- `session_start` and `automation_trigger` enforce:
  - state allow-list (`free` with balance > 0, `active`)
  - minimum credits (`MIN_CREDITS_TO_START`)
  - concurrent session limit
  - active coworker limit (`maxActiveCoworkers` per plan)
- `session_resume` enforces state rules only (no minimum-credit/concurrency check).
- Coworker metric lookups are fail-closed; load errors deny the gate.

**Rules**
- Grace expiry denial should trigger best-effort state cleanup (`expireGraceForOrg`).
- UI helper checks (`canPossiblyStart`) are informative only; gate methods remain authoritative.

### 6.5 Atomic Concurrent Admission — `Implemented`

**Invariants**
- Concurrent limit enforcement at session insert is serialized per org using `pg_advisory_xact_lock(hashtext(orgId || ':session_admit'))`.
- Count set for admission is `status IN ('starting','pending','running')`.
- Session row insert and concurrency check happen in the same transaction.
- Setup-session admission uses the same lock and counting rules.

**Rules**
- Fast gate concurrency checks are not sufficient by themselves.
- Any new session-create path must use admission-guard variants when billing is enabled.

### 6.6 Outbox Processing — `Implemented`

**Invariants**
- Outbox only processes events in retryable states with due retry time.
- Outbox resolves Autumn customer identity from `organization.autumnCustomerId`; missing customer ID fails closed.
- Autumn denial attempts auto-recharge before forcing `exhausted` enforcement.
- Event status transitions to `posted` only after denial/top-up/enforcement branches complete.
- Retry metadata (`retryCount`, `nextRetryAt`, `lastError`) is updated on failure.
- Permanent failures emit alerting logs.

**Rules**
- `skipped` events are never part of outbox processing.
- Outbox idempotency must rely on the original event idempotency key.
- If credits-exhausted enforcement fails to pause all targeted sessions, outbox processing throws so the event remains retryable.

### 6.7 Org Enforcement (Pause/Snapshot) — `Implemented`

**Invariants**
- Credit exhaustion enforcement iterates currently running sessions and applies lock-safe pause/snapshot.
- Per-session enforcement is migration-lock guarded (`runWithMigrationLock`).
- Snapshot strategy order is provider-capability aware: memory snapshot, then pause snapshot, then filesystem snapshot.
- CAS update with sandbox fencing prevents stale actors from overwriting advanced state.
- Enforcement prefers `paused` with reason codes over destructive terminal states.

**Rules**
- Failed pauses are logged and counted; failures do not abort entire org enforcement pass.
- Enforcement callers must expect partial success and re-entry in later cycles.

### 6.8 Auto-Recharge — `Implemented`

**Invariants**
- Auto-recharge executes only when enabled on the org and circuit breaker is not active.
- Recharge path is outside shadow-balance deduction transaction.
- Per-org auto-recharge concurrency is serialized via dedicated advisory lock (`:auto_topup`).
- Monthly counters are lazily reset by `overage_cycle_month`.
- Guardrails: per-cycle velocity limit, minimum interval rate limit, optional spend cap, card-decline circuit breaker.
- Successful charge credits are applied via `addShadowBalance` after lock transaction commit.
- Card decline triggers circuit breaker → falls back to `exhausted` (skips grace).

**Rules**
- Recharge sizing is deficit-aware (`abs(deficit) + increment`), then pack-rounded and cap-clamped.
- Circuit breaker paths should fail closed and trigger enforcement.

### 6.9 Free Credits + Plan Activation + Checkout — `Implemented`

**Invariants**
- Org creation provisions 5 free credits and sets state to `free`. No credit card required.
- Free credits are permanent (no expiry). Usable at any time, forever.
- All orgs receive the 5 free credits regardless of plan selection during onboarding.
- Plan activation (Dev/Pro) transitions state from `free` → `active` and adds plan credits on top of remaining free balance.
- Top-up purchases are available to any org and transition `free` → `active` if it's the first purchase.
- Plan activation and credit purchase may return checkout URLs or immediate success.
- Immediate purchases attempt local balance credit and then enqueue fast reconcile.

**Rules**
- Billing settings and plan mutations require admin/owner permissions.
- Customer ID drift from Autumn responses must be persisted back to org metadata.

### 6.10 Grace Period — `Implemented`

**Invariants**
- Grace period is 5 minutes, available only to `active` orgs (paid plan or purchased credits).
- `free` orgs skip grace entirely; depletion → `exhausted` immediately.
- During grace: new sessions are blocked, running sessions continue.
- Grace expiry triggers force-pause with snapshots for all running sessions.
- Auto-recharge-enabled orgs attempt card charge first; card decline → `exhausted` (skips grace).

**Rules**
- Grace expiry enforcement runs on the `billing-grace` worker.
- `graceExpiresAt IS NULL` in `grace` state is treated as expired (fail-closed).

### 6.11 Snapshot Quota Management — `Implemented`

**Invariants**
- Snapshot creation is guarded by `ensureSnapshotCapacity` in pause/snapshot handlers.
- Eviction order is deterministic: expired snapshots first, then oldest snapshots by `pausedAt`.
- Global cleanup worker evicts expired snapshots daily with bounded batch size.
- Snapshot resources are treated as free within quota (no credit charge).

**Rules**
- Snapshot DB reference clearing requires successful delete callback contract.
- Current provider delete callback is a no-op placeholder; eviction still clears DB refs through that contract.

### 6.12 Reconciliation — `Implemented`

**Invariants**
- Nightly reconciliation runs against billable orgs with Autumn customer IDs.
- Fast reconcile is on-demand and keyed by `jobId = orgId` to avoid queue spam per org.
- Reconciliation writes balance deltas to audit table and updates `lastReconciledAt`.
- Drift thresholds produce tiered warn/error/critical signals.

**Rules**
- Reconciliation should correct drift, not be part of hot-path admission.
- Staleness detection is part of operational health, not user-facing gating.

### 6.13 Billing Worker Topology — `Implemented`

| Queue | Cadence | Worker Concurrency | Purpose |
|---|---|---|---|
| `billing-metering` | every 30s | 1 | compute metering |
| `billing-outbox` | every 60s | 1 | Autumn posting retries |
| `billing-grace` | every 60s | 1 | grace expiry enforcement |
| `billing-reconcile` | daily 00:00 UTC | 1 | nightly shadow reconcile |
| `billing-llm-sync-dispatch` | every 30s | 1 | per-org LLM sync fan-out |
| `billing-llm-sync-org` | on-demand | 5 | org-level LLM spend sync |
| `billing-fast-reconcile` | on-demand | 3 | rapid balance correction |
| `billing-snapshot-cleanup` | daily 01:00 UTC | 1 | snapshot retention cleanup |
| `billing-partition-maintenance` | daily 02:00 UTC | 1 | partition/key retention maintenance |

**Rules**
- Worker startup is gated by `NEXT_PUBLIC_BILLING_ENABLED`.
- Repeatable schedules must stay idempotent under restarts.

### 6.14 Billing Event Partition Maintenance — `Implemented`

**Invariants**
- `billing_event_keys` provides global idempotency independent of table partitioning strategy.
- Daily maintenance attempts next-month partition creation and safely no-ops if `billing_events` is not partitioned.
- Old idempotency keys are cleaned based on hot-retention window.
- Candidate partition detachment is currently signaled via logs (operator runbook), not auto-detached.

**Rules**
- Financial correctness must not depend on whether physical partitioning is enabled.

### 6.15 Billing UI & Banners — `Implemented`

**Invariants**
- Billing page (`apps/web/src/app/(command-center)/settings/billing/page.tsx`) shows: credit balance, usage summary, plan info, top cost drivers, recent billing events, plan selection, auto-recharge settings.
- Usage summary aggregates billing events by type (compute/llm) for the current calendar month (`packages/services/src/billing/db.ts:getUsageSummary`).
- Top cost drivers are grouped by session from billing event `sessionIds` arrays (`packages/services/src/billing/db.ts:getTopCostDrivers`).
- Entitlement status includes concurrent sessions, active coworkers (`packages/services/src/billing/gate.ts:getEntitlementStatus`).
- Warning thresholds: approaching (80%), critical (95%) (`packages/shared/src/billing/types.ts:WARNING_THRESHOLDS`).
- Billing banner (`apps/web/src/components/dashboard/billing-banner.tsx`) displays nearing-limit warnings at approaching and critical thresholds; non-dismissable for exhausted/suspended/grace states.
- Plan limits include `maxActiveCoworkers` per plan (dev: 3, pro: 25).
- Error codes: `COWORKER_LIMIT`, `BUDGET_EXHAUSTED` in `BillingErrorCode`.

**Rules**
- Non-dismissable banners cannot be hidden by user action.
- Entitlement metric lookups (coworker count) are fail-closed; load errors deny the gate.

### 6.16 Removed Subsystems — `Removed`

- Distributed lock helper was removed; BullMQ queue/worker semantics are used.
- Billing token subsystem and `sessions.billing_token_version` were removed.
- `unconfigured` and `trial` billing states replaced by `free` state.
- Monthly usage threshold gating removed (replaced by pure credit-balance gating).
- Overage policy `pause` vs `allow` dichotomy replaced by auto-recharge toggle.
- `MONTHLY_LIMIT` error code removed (credit balance is the only limit).
- `cli_connect` gate operation type removed (no direct callers).

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `auth-orgs.md` | Billing ↔ Orgs | `orgs.getBillingInfoV2`, `orgs.initializeBillingState`, `orgs.expireGraceForOrg` | Billing state fields live on `organization` row. |
| `sessions-gateway.md` | Sessions → Billing | `assertBillingGateForOrg`, `checkBillingGateForOrg`, `getOrgPlanLimits` | Enforced in oRPC create, gateway HTTP create, setup-session flows, runtime resume path. |
| `sessions-gateway.md` | Billing → Sessions | `sessions.meteredThroughAt`, `sessions.lastSeenAliveAt`, session status transitions | Metering/enforcement update session lifecycle columns. |
| `sandbox-providers.md` | Billing → Providers | `provider.checkSandboxes`, snapshot/pause/snapshot+terminate methods | Used by metering liveness and enforcement pause/snapshot. |
| `llm-proxy.md` | LLM → Billing | LiteLLM Admin spend logs API | Billing consumes spend logs via REST, not cross-schema SQL. LLM cost is 3x-multiplied into credits. |
| `automations-runs.md` | Automations → Billing | `automation_trigger` gate operation | Automation-created sessions use the same gate contract. |

### Security & Auth
- Billing procedures are org-scoped and role-gated (admin/owner for settings and purchasing).
- Billing events intentionally avoid prompt payloads and secrets.
- Runtime auth remains session/gateway-token based; no billing token layer exists.
- Custom API keys are not supported; all LLM traffic must route through the gateway for accurate metering.

### Observability
- Billing modules emit structured logs with module tags (`metering`, `outbox`, `org-pause`, `llm-sync`, `auto-recharge`, `reconcile`).
- Alert-like log fields are used for permanent outbox failures, drift thresholds, and LLM anomaly detection.
- Outbox stats are queryable via `getOutboxStats` for operational dashboards.

---

## 8. Acceptance Gates

- Behavior changes in billing code must update this spec's invariants in the same PR.
- Keep this spec implementation-referential; avoid static file-tree or schema snapshots.
- New billable admission paths must explicitly call billing gate helpers and admission guards.
- New balance mutation paths must go through existing shadow-balance service functions.
- New asynchronous billing jobs must define idempotency and retry semantics before merging.
- Update `docs/specs/feature-registry.md` when billing feature status or ownership changes.
- LLM credit conversion must always use the 3x multiplier; changes to margin require spec update.
- Free credit amount (5) is a product constant; changes require spec + code update.

---

## 9. Known Limitations & Tech Debt

### Behavioral / Financial Risk
- [x] **Enforcement retry path from outbox denial flow (P0)** — denied events now throw when credits-exhausted enforcement leaves failed targets, so outbox retries re-drive enforcement (`packages/services/src/billing/outbox.ts`, `packages/services/src/billing/org-pause.ts`).
- [ ] **LLM cursor update is not atomic with deduction (P1)** — cursor advance happens after `bulkDeductShadowBalance`, so worker crashes can replay logs (idempotent but noisy) (`apps/worker/src/jobs/billing/llm-sync-org.job.ts`).
- [x] **Outbox customer ID source (P1)** — outbox now posts against persisted `organization.autumnCustomerId` and fails closed when missing (`packages/services/src/billing/outbox.ts`).

### Reliability / Operational Risk
- [ ] **Metered-through crash window (P2)** — session `meteredThroughAt` update is separate from deduction transaction; idempotency prevents overcharge but can cause replay noise (`packages/services/src/billing/metering.ts`).
- [ ] **LLM dispatcher has no enqueue dedupe by org (P2)** — multiple jobs for same org can coexist under backlog conditions; correctness depends on idempotency keys (`apps/worker/src/jobs/billing/llm-sync-dispatcher.job.ts`).
- [ ] **Grace-null behavior is implicit (P2)** — `graceExpiresAt IS NULL` is treated as immediately expired (fail-closed) without explicit schema-level guardrails (`packages/services/src/orgs/db.ts`, `packages/shared/src/billing/state.ts`).

### Data Lifecycle / Drift
- [ ] **Partition archival remains operator-driven (P1)** — maintenance logs detachment candidates but does not auto-archive old partitions (`apps/worker/src/jobs/billing/partition-maintenance.job.ts`).
- [ ] **Snapshot provider deletion is placeholder (P2)** — provider delete hook is no-op until provider APIs exist (`packages/services/src/billing/snapshot-limits.ts`).
- [ ] **Fast reconcile trigger coverage is narrow (P2)** — direct enqueue currently happens in billing purchase/activation routes; other drift-inducing paths rely on nightly reconcile unless additional triggers are added (`apps/web/src/server/routers/billing.ts`).

### Migration
- [ ] **State migration from `unconfigured`/`trial` to `free` (P0)** — existing orgs with `unconfigured` or `trial` state need data migration to `free`. Orgs with `trial` credits should retain their remaining balance.
