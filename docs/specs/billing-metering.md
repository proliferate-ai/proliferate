# Billing & Metering — System Spec

## 1. Scope & Purpose

### In Scope
- Billing state machine and state transitions per organization
- Shadow balance (locally cached credit balance with atomic deduction)
- Compute metering (interval-based billing for running sessions)
- LLM spend sync (cursor-based ingestion from LiteLLM spend logs)
- Credit gating (unified gate for session start/resume/CLI/automation)
- Billing event outbox (retry failed Autumn posts)
- Billing reconciliation and audit trail
- Trial credit provisioning and auto-activation
- Org pause / snapshot enforcement on zero balance (resumable)
- Overage policy (pause vs allow, per-org)
- Checkout flow (plan activation, credit top-ups via Autumn)
- Snapshot quota management (count and retention limits)
- Atomic concurrent admission (advisory lock at session insert)
- Billing worker (BullMQ repeatable jobs)
- Billing token system (JWT auth for sandbox billing requests)

### Out of Scope
- LLM virtual key generation and model routing — see `llm-proxy.md`
- Onboarding flow that triggers trial activation — see `auth-orgs.md`
- Session pause/terminate mechanics (provider-side) — see `sessions-gateway.md`
- Sandbox provider interface — see `sandbox-providers.md`

### Mental Model

Billing tracks how much each organization consumes and enforces credit limits. Two independent cost streams feed a single credit pool: **compute** (sandbox uptime, metered every 30s) and **LLM** (model inference, synced from LiteLLM spend logs). Both deduct from a **shadow balance** — a locally cached credit counter that is updated atomically with billing event insertion, then asynchronously reconciled with the external billing provider (Autumn).

The system is designed around three principles: (1) **no external API calls in the hot path** — gating decisions read the local shadow balance, not Autumn; (2) **fail-closed** — on errors, sessions are blocked rather than allowed; (3) **exactly-once billing** — idempotency keys derived from interval boundaries prevent double-charges.

**Core entities:**
- **Shadow balance** — per-org cached credit counter on the `organization` row. Deductions are always atomic with billing event insertion inside `FOR UPDATE` transactions. Initialization and reconciliation may write without `FOR UPDATE`. Source of truth for gating decisions.
- **Billing event** — an immutable ledger row recording a credit deduction. Acts as an outbox entry for Autumn sync.
- **Billing state** — org-level FSM (`unconfigured → trial → active → grace → exhausted → suspended`) that governs session lifecycle enforcement.
- **Billing reconciliation** — audit record for any balance adjustment (manual, sync, refund).

**Key invariants:**
- Shadow balance **deduction** is atomic with billing event insertion (single Postgres transaction with `FOR UPDATE` row lock). Initialization (`initializeShadowBalance`) writes without `FOR UPDATE`.
- A `[from, to)` compute interval is billed exactly once; idempotency key = `compute:{sessionId}:{fromMs}:{toMs}`.
- Billing events in `trial` or `unconfigured` state are inserted with `status = 'skipped'` (no Autumn post).
- Grace period defaults to 5 minutes (max configurable: 1 hour); maximum overdraft is 500 credits.

---

## 2. Core Concepts

### Autumn
Open-source billing system on top of Stripe. Handles subscriptions, metered usage, and credit systems. Proliferate uses Autumn for plan management, payment collection, and as the authoritative balance (reconciled asynchronously with shadow balance).
- Key detail agents get wrong: Autumn is **not** called in the session/CLI gating hot path. It is called by the outbox worker, billing API routes (`getInfo`, `activatePlan`, `buyCredits`), and trial auto-activation — but never during session start/resume decisions.
- Reference: `packages/shared/src/billing/autumn-client.ts`

### Shadow Balance
A locally-persisted credit counter stored as `shadow_balance` on the `organization` table. Updated atomically with billing event insertions inside a `FOR UPDATE` transaction. Periodically reconciled with Autumn's actual balance.
- Key detail agents get wrong: The shadow balance can go negative (overdraft). Enforcement happens after deduction to keep the ledger accurate.
- Reference: `packages/services/src/billing/shadow-balance.ts`

### Billing State Machine
Six-state FSM on the organization governing what operations are allowed. Transitions are triggered by balance depletion, grace expiry, credit additions, and manual overrides.
- Key detail agents get wrong: `trial → exhausted` is direct (no grace period for trials). `active → grace → exhausted` uses a timed grace window.
- Reference: `packages/shared/src/billing/state.ts`

### Credit System
1 credit = $0.01 (1 cent). Compute: 1 credit/minute. LLM: `response_cost × 3× markup / $0.01`.
- Key detail agents get wrong: Both compute and LLM costs deduct from the same `credits` feature in Autumn.
- Reference: `packages/shared/src/billing/types.ts:calculateComputeCredits`, `calculateLLMCredits`

---

## 3. File Tree

```
packages/shared/src/billing/
├── index.ts                    # Module re-exports
├── types.ts                    # BillingState, PlanConfig, credit rates, metering config
├── state.ts                    # State machine transitions, enforcement actions
├── gating.ts                   # Unified billing gate (checkBillingGate)
├── autumn-client.ts            # Autumn HTTP client (attach, check, track, top-up)
├── autumn-types.ts             # Autumn API type definitions, feature/product IDs
├── billing-token.ts            # JWT tokens for sandbox billing auth
└── autumn-client.test.ts       # Autumn client tests

packages/services/src/billing/
├── index.ts                    # Re-exports all billing service modules
├── gate.ts                     # Iron Door: checkBillingGateForOrg, assertBillingGateForOrg, getOrgPlanLimits
├── db.ts                       # Billing event queries, per-org LLM cursor ops, billable org enumeration
├── litellm-api.ts              # LiteLLM Admin REST API client (GET /spend/logs/v2)
├── shadow-balance.ts           # Atomic deduct/add/bulk-deduct/reconcile/initialize shadow balance
├── metering.ts                 # Compute metering cycle, sandbox liveness, finalization
├── outbox.ts                   # Outbox worker: retry failed Autumn posts
├── org-pause.ts                # Billing enforcement orchestration (pause/snapshot policy)
├── trial-activation.ts         # Auto-activate plan after trial exhaustion
└── snapshot-limits.ts          # Snapshot quota checking, retention cleanup, provider-side deletion

packages/services/src/sessions/
└── db.ts                       # createWithAdmissionGuard, createSetupSessionWithAdmissionGuard (atomic concurrent admission)

packages/db/src/schema/
└── billing.ts                  # billingEvents, llmSpendCursors (per-org), billingReconciliations tables

apps/web/src/server/routers/
└── billing.ts                  # oRPC routes: getInfo, updateSettings, activatePlan, buyCredits

apps/web/src/lib/
└── billing.ts                  # Session gating helpers (checkCanStartSession, isBillingEnabled)

apps/worker/src/billing/
├── index.ts                    # Worker exports (start/stop/health)
└── worker.ts                   # BullMQ-based billing worker lifecycle

apps/worker/src/jobs/billing/
├── providers.ts                # Shared sandbox provider utilities (used by metering for liveness checks)
├── metering.job.ts             # BullMQ processor: compute metering (every 30s)
├── outbox.job.ts               # BullMQ processor: billing outbox (every 60s)
├── grace.job.ts                # BullMQ processor: grace expiration (every 60s)
├── reconcile.job.ts            # BullMQ processor: nightly reconciliation (00:00 UTC)
├── llm-sync-dispatcher.job.ts  # BullMQ processor: LLM sync fan-out (every 30s)
├── llm-sync-org.job.ts         # BullMQ processor: per-org LLM spend sync
└── snapshot-cleanup.job.ts     # BullMQ processor: daily snapshot retention cleanup (01:00 UTC)
```

---

## 4. Data Models & Schemas

### Database Tables

```
billing_events
├── id                UUID PK
├── organization_id   TEXT FK → organization.id (CASCADE)
├── event_type        TEXT NOT NULL ('compute' | 'llm')
├── quantity          NUMERIC(12,6) NOT NULL
├── credits           NUMERIC(12,6) NOT NULL
├── idempotency_key   TEXT NOT NULL UNIQUE
├── session_ids       TEXT[] DEFAULT []
├── status            TEXT NOT NULL DEFAULT 'pending' ('pending'|'posted'|'failed'|'skipped')
├── retry_count       INT DEFAULT 0
├── next_retry_at     TIMESTAMPTZ DEFAULT now()
├── last_error        TEXT
├── autumn_response   JSONB
├── metadata          JSONB DEFAULT {}
└── created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
Indexes: (org_id, created_at), (status, next_retry_at), (org_id, event_type, created_at)
```

```
llm_spend_cursors (per-org, replaces global singleton)
├── organization_id      TEXT PK FK → organization.id (CASCADE)
├── last_start_time      TIMESTAMPTZ NOT NULL
├── last_request_id      TEXT
├── records_processed    INT DEFAULT 0
└── synced_at            TIMESTAMPTZ NOT NULL DEFAULT now()
```


```
billing_reconciliations
├── id                UUID PK
├── organization_id   TEXT FK → organization.id (CASCADE)
├── type              TEXT NOT NULL ('shadow_sync'|'manual_adjustment'|'refund'|'correction')
├── previous_balance  NUMERIC(12,6) NOT NULL
├── new_balance       NUMERIC(12,6) NOT NULL
├── delta             NUMERIC(12,6) NOT NULL
├── reason            TEXT NOT NULL
├── performed_by      TEXT FK → user.id (SET NULL)
├── metadata          JSONB DEFAULT {}
└── created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
Indexes: (org_id, created_at), (type)
```

### Billing Fields on `organization` Table

The following columns live on the `organization` table (owned by `auth-orgs.md`):
- `billing_state` — current FSM state
- `shadow_balance` — cached credit balance (NUMERIC)
- `shadow_balance_updated_at` — last update timestamp
- `grace_entered_at`, `grace_expires_at` — grace window timestamps
- `billing_plan` — selected plan (`dev` | `pro`)
- `billing_settings` — JSONB (overage policy, cap, monthly usage)
- `autumn_customer_id` — external Autumn customer reference

### Plan Configuration

| Plan | Monthly | Credits | Max Sessions | Max Snapshots | Retention |
|------|---------|---------|-------------|---------------|-----------|
| dev  | $20     | 1,000   | 10          | 5             | 30 days   |
| pro  | $500    | 7,500   | 100         | 200           | 90 days   |

Trial: 1,000 credits granted at signup. Top-up pack: 500 credits for $5.

---

## 5. Conventions & Patterns

### Do
- Always deduct from shadow balance via `deductShadowBalance()` or `bulkDeductShadowBalance()` — these are the **only** paths for credit deduction (`packages/services/src/billing/shadow-balance.ts`).
- Use deterministic idempotency keys: `compute:{sessionId}:{fromMs}:{toMs}` for regular intervals, `compute:{sessionId}:{fromMs}:final` for finalization, `llm:{requestId}` for LLM events.
- Billing cycles run as BullMQ repeatable jobs with concurrency 1 — no manual locking needed.

### Don't
- Do not call Autumn APIs in the session start/resume hot path — use `checkBillingGate()` with local shadow balance.
- Do not insert billing events outside a `deductShadowBalance` transaction — this breaks the atomicity invariant.
- Do not skip billing events for trial orgs — insert them with `status = 'skipped'` so the ledger is complete.

### Error Handling
Billing is **fail-closed**: if org lookup fails, billing state is unreadable, or shadow balance can't be computed, the operation is denied. See `apps/web/src/lib/billing.ts:checkCanStartSession`.

### Reliability
- **Metering concurrency**: BullMQ repeatable job with concurrency 1 ensures single-execution.
- **Outbox retries**: exponential backoff from 60s base, max 1h, up to 5 attempts. After 5 failures, event is permanently marked `failed`.
- **Idempotency**: `billingEvents.idempotency_key` UNIQUE constraint with `onConflictDoNothing` — prevents double-billing without aborting the transaction.
- **Sandbox liveness**: 3 consecutive alive-check failures before declaring dead (`METERING_CONFIG.graceFailures`).

---

## 6. Subsystem Deep Dives

### 6.1 Compute Metering — `Implemented`

**What it does:** Bills running sessions for elapsed compute time every 30 seconds.

**Happy path:**
1. `runMeteringCycle()` is invoked by the BullMQ `billing-metering` repeatable job (`packages/services/src/billing/metering.ts:runMeteringCycle`).
2. Queries all sessions with `status = 'running'`.
3. Checks sandbox liveness via provider `checkSandboxes()` with grace period (3 consecutive failures = dead).
4. For alive sandboxes: computes `billableSeconds = floor((now - meteredThroughAt) / 1000)`, skips if < 10s.
5. Calls `deductShadowBalance()` with deterministic idempotency key.
6. Advances `sessions.metered_through_at`.
7. If billing enforcement is required, invokes org-level enforcement flow — unless transitioning from trial (tries `tryActivatePlanAfterTrial()` first).

**Edge cases:**
- Dead sandbox → `billFinalInterval()` bills through `last_seen_alive_at + pollInterval`, not detection time. Marks session `paused` (preserves resumability).
- BullMQ concurrency 1 ensures only one metering cycle runs at a time.

**Files touched:** `packages/services/src/billing/metering.ts`, `shadow-balance.ts`, `org-pause.ts`, `trial-activation.ts`

### 6.2 Shadow Balance — `Implemented`

**What it does:** Maintains an atomic, locally-cached credit balance per organization.

**Happy path (`deductShadowBalance`):**
1. Opens a Postgres transaction with `FOR UPDATE` on the organization row.
2. Inserts billing event (idempotent via `onConflictDoNothing` on `idempotency_key`).
3. If duplicate → returns `{ success: false }` without modifying balance.
4. Computes `newBalance = previousBalance - credits`.
5. Evaluates state transitions: if `newBalance <= 0` and state is `active`/`trial`, transitions to `grace`/`exhausted`.
6. Checks overdraft cap (500 credits); if exceeded in grace, transitions to `exhausted`.
7. Updates `shadow_balance`, `billing_state`, and grace fields atomically.

**`bulkDeductShadowBalance(orgId, events)`:** Batch variant for high-throughput LLM spend sync. Opens exactly one transaction → `FOR UPDATE` org row → bulk `INSERT INTO billing_events ON CONFLICT DO NOTHING` → sums credits only for newly inserted rows → deducts that sum from shadow balance. Same state-transition logic as `deductShadowBalance`.

**`addShadowBalance`:** Adds credits (top-ups, refunds). If state is `grace`/`exhausted` and new balance > 0, transitions back to `active`. Inserts a `billing_reconciliations` record.

**`reconcileShadowBalance`:** Corrects drift between local and Autumn balance. Inserts reconciliation record for audit trail.

**Files touched:** `packages/services/src/billing/shadow-balance.ts`, `packages/db/src/schema/billing.ts`

### 6.3 Credit Gating — `Implemented`

**What it does:** Single entry point for session-lifecycle billing checks.

**Happy path:**
1. `checkCanStartSession()` fetches org billing info from DB (`apps/web/src/lib/billing.ts`).
2. Calls `checkBillingGate()` with org state, shadow balance, session counts, and operation type.
3. Gate checks (in order): grace expiry → billing state → credit sufficiency (min 11 credits) → concurrent session limit.
4. Returns `{ allowed: true }` or `{ allowed: false, errorCode, message, action }`.

**Operations gated:** `session_start`, `session_resume`, `cli_connect`, `automation_trigger`. Resume and CLI connect skip the concurrent limit check **and** the credit minimum threshold (state-level checks still apply).

**Enforcement points:**
- oRPC `createSessionHandler` (`apps/web/src/server/routers/sessions-create.ts`) — `session_start` / `automation_trigger`
- Gateway session creation (`apps/gateway/src/api/proliferate/http/sessions.ts`) — `session_start` / `automation_trigger`
- Gateway setup session (`startSetupSession` in same file) — `session_start`
- Managed prebuild setup session (`packages/services/src/managed-prebuild.ts`) — `session_start` (logs and skips on denial)
- Runtime resume/cold-start (`apps/gateway/src/hub/session-runtime.ts:doEnsureRuntimeReady`) — `session_resume` (already-running sessions skip this check via `ensureRuntimeReady` early return)
- Message path coverage: `postPrompt` → `handlePrompt` → `ensureRuntimeReady` → `doEnsureRuntimeReady`, so the runtime resume gate covers message-triggered cold-starts transitively.

**Atomic concurrent admission (TOCTOU-safe):**

The billing gate's concurrent limit check (Step 4 in `checkBillingGate`) serves as a fast rejection. The authoritative enforcement is at session insert time via `createWithAdmissionGuard` / `createSetupSessionWithAdmissionGuard` (`packages/services/src/sessions/db.ts`).

Approach: **transaction-scoped advisory lock** (`pg_advisory_xact_lock`).
1. Open a Postgres transaction.
2. Acquire `pg_advisory_xact_lock(hashtext(orgId || ':session_admit'))` — serializes per-org admission.
3. Count sessions with `status IN ('starting', 'pending', 'running')` within the transaction.
4. If count >= plan limit, return `{ created: false }` without inserting.
5. Otherwise, insert the session row and commit.

The lock is released automatically when the transaction commits/rolls back. It does not block other orgs, other session operations (update, delete), or non-admission queries.

**Tradeoffs considered:**
- **Advisory lock (chosen):** Minimal scope (per-org, transaction-lifetime), no schema changes, no deadlock risk with other billing operations. Serializes only concurrent creates for the same org.
- **Org row `FOR UPDATE` lock:** Would conflict with shadow balance deductions (which also lock the org row), causing unnecessary contention between metering and session creation.
- **Redis atomic counter:** Adds external dependency to the admission path and requires rollback semantics on insert failure. Not justified given Postgres already handles this well.

**Files touched:** `packages/shared/src/billing/gating.ts`, `packages/services/src/billing/gate.ts`, `packages/services/src/sessions/db.ts`, `apps/web/src/lib/billing.ts`

### 6.4 LLM Spend Sync — `Implemented`

**What it does:** Ingests LLM cost data into billing events via the LiteLLM Admin REST API and per-org cursors. Uses a BullMQ dispatcher → per-org fan-out pattern for parallelism.

**Happy path:**
1. Dispatcher job (`billing-llm-sync-dispatch`, every 30s) lists billable orgs via `billing.listBillableOrgIds()` — states `active`, `trial`, `grace` (`packages/services/src/billing/db.ts`).
2. Enqueues one `billing-llm-sync-org` job per org (deduplicated by org ID).
3. Per-org worker (concurrency 5):
   a. Reads per-org cursor (`billing.getLLMSpendCursor(orgId)`) or defaults to 5-min lookback.
   b. Fetches spend logs via `billing.fetchSpendLogs(orgId, startDate)` (`packages/services/src/billing/litellm-api.ts`).
   c. Converts logs with positive `spend` to `BulkDeductEvent[]` using `calculateLLMCredits()`.
   d. Calls `billing.bulkDeductShadowBalance(orgId, events)` — single transaction with idempotent insert (`packages/services/src/billing/shadow-balance.ts`).
   e. Advances per-org cursor to latest log's `startTime`.
4. Handles state transitions: when enforcement is required, calls `enforceCreditsExhausted(orgId)` to pause/snapshot running sessions.

**Edge cases:**
- First run for an org (no cursor) → starts from 5-min lookback.
- REST API failure for one org → logged and skipped; other orgs continue.
- Duplicate logs → idempotency key `llm:{request_id}` prevents double-billing.

**Files touched:** `apps/worker/src/jobs/billing/llm-sync-dispatcher.job.ts`, `apps/worker/src/jobs/billing/llm-sync-org.job.ts`, `packages/services/src/billing/litellm-api.ts`, `packages/services/src/billing/db.ts`, `packages/services/src/billing/shadow-balance.ts`

### 6.5 Outbox Processing — `Implemented`

**What it does:** Retries posting billing events to Autumn that failed or haven't been posted yet.

**Happy path:**
1. `processOutbox()` is invoked by the BullMQ `billing-outbox` repeatable job (`packages/services/src/billing/outbox.ts`).
2. Queries billing events with `status IN ('pending', 'failed')`, `retry_count < 5`, `next_retry_at < now()`.
3. For each event: calls `autumnDeductCredits()` to post to Autumn.
4. On success: marks `status = 'posted'`. If Autumn denies, transitions org to `exhausted` and calls `enforceCreditsExhausted(orgId)` to pause/snapshot running sessions.
5. On failure: increments retry count, sets exponential backoff. After 5 retries, marks `failed` permanently and emits `alert: true` log with `orgId`, `eventId`, `credits`, and `retryCount` for monitoring.

**Files touched:** `packages/services/src/billing/outbox.ts`, `packages/shared/src/billing/autumn-client.ts`

### 6.6 Billing State Machine — `Implemented`

**What it does:** Governs org billing lifecycle through six states with defined transitions.

**State transition map:**
```
unconfigured → active (plan_attached) | trial (trial_started)
trial        → active (plan_attached) | exhausted (balance_depleted)
active       → grace (balance_depleted) | suspended (manual)
grace        → exhausted (grace_expired/overdraft) | active (credits_added) | suspended (manual)
exhausted    → active (credits_added) | suspended (manual)
suspended    → active (manual_unsuspend)
```

**Enforcement actions (spec policy):** `grace` → blocks new sessions. `exhausted`/`suspended` → pause/snapshot running sessions so they are resumable.

**Cross-spec invariant:** billing must treat `status: "paused"` (for inactivity/credit enforcement) as meter-stopping, equivalent to legacy `stopped` semantics for metering closure.

**Files touched:** `packages/shared/src/billing/state.ts`

### 6.7 Org Billing Enforcement (Pause/Snapshot Policy) — `Implemented`

**What it does:** Applies org-level enforcement when credits are exhausted/suspended by pausing/snapshotting sessions (resumable), not hard-terminating user work.

**`enforceCreditsExhausted(orgId)`:** Iterates all running sessions for the org and calls `pauseSessionWithSnapshot()` for each. Returns `{ paused, failed }`.

**`pauseSessionWithSnapshot()`:** Lock-safe per-session enforcement:
1. Acquires migration lock (300s TTL) via `runWithMigrationLock`
2. Re-verifies session is still running (may have been paused by gateway idle snapshot)
3. Snapshots: memory (preferred) → pause → filesystem, depending on provider capabilities
4. Terminates sandbox (non-pause/non-memory providers only)
5. CAS DB update with `sandbox_id` fencing — `status: "paused"`, `pauseReason: "credit_limit"`
6. Revokes LLM virtual key (best-effort)

If the lock is already held (e.g., by an idle snapshot in progress), the session is skipped. Sessions that fail to pause are counted in `failed` and left running — the next enforcement cycle will retry.

**`canOrgStartSession`:** Checks concurrent session count against plan limit (superseded by atomic admission guard in `sessions/db.ts`).

**Callers:**
- `metering.ts` → `billComputeInterval()` when `shouldTerminateSessions` (after trial auto-activation check)
- `outbox.ts` → `processEvent()` when Autumn denies credits
- `grace.job.ts` → on grace period expiration
- `llm-sync-org.job.ts` → when LLM spend depletes balance

**Files touched:** `packages/services/src/billing/org-pause.ts`

### 6.8 Trial Credit Provisioning — `Implemented`

**What it does:** 1,000 trial credits granted at signup. When trial credits deplete, auto-activates the selected plan if payment method exists.

**`tryActivatePlanAfterTrial`:**
1. Checks if org already has the plan product in Autumn.
2. If yes, resolves credits from Autumn and transitions to `active`.
3. If no, calls `autumnAttach()` — if payment method on file, plan activates; otherwise returns `requiresCheckout`.
4. Handles `product_already_attached` error gracefully.

**Files touched:** `packages/services/src/billing/trial-activation.ts`

### 6.9 Checkout Flow — `Implemented`

**What it does:** Initiates plan activation or credit purchase via Autumn/Stripe checkout.

**`activatePlan`:** Calls `autumnAttach()` with the selected plan product. Returns checkout URL if payment required, otherwise initializes billing state as `active`.

**`buyCredits`:** Purchases 1-10 top-up packs (500 credits / $5 each). If payment method on file, charges immediately and updates shadow balance. Otherwise returns checkout URL.

**Files touched:** `apps/web/src/server/routers/billing.ts`

### 6.10 Snapshot Quota Management — `Implemented`

**What it does:** Defines per-plan snapshot count and retention limits. Snapshots are free within quota (no credit charge).

**Quota enforcement (on snapshot creation):**
- `sessions-pause.ts` and `sessions-snapshot.ts` call `ensureSnapshotCapacity(orgId, plan, deleteSnapshotFromProvider)` before creating snapshots.
- If at limit, evicts oldest snapshot (expired first, then by `paused_at`). Eviction clears DB ref after best-effort provider cleanup via `deleteSnapshotFromProvider`.

**Retention cleanup (daily background):**
- `billing-snapshot-cleanup` BullMQ job runs daily at 01:00 UTC.
- Calls `cleanupAllExpiredSnapshots()` which sweeps all sessions with snapshots past the global `SNAPSHOT_RETENTION_DAYS` cap (default 14 days), bounded to 500 per cycle.

**Provider-side deletion:** `deleteSnapshotFromProvider` is currently a no-op — providers (Modal, E2B) auto-expire snapshot resources. The function serves as the designated hook point for when providers add delete APIs.

**Files touched:** `packages/services/src/billing/snapshot-limits.ts`, `apps/worker/src/jobs/billing/snapshot-cleanup.job.ts`

### 6.11 Distributed Locks — `Removed`

Distributed locks (`packages/shared/src/billing/distributed-lock.ts`) were removed. BullMQ repeatable jobs with concurrency 1 now ensure single-execution guarantees for metering, outbox, and other billing cycles.

### 6.12 Billing Worker — `Implemented` (BullMQ)

**What it does:** Runs billing tasks as BullMQ repeatable jobs with dedicated queues and workers.

| Queue | Schedule | Processor |
|-------|----------|-----------|
| `billing-metering` | Every 30s | `metering.job.ts` → `billing.runMeteringCycle()` |
| `billing-outbox` | Every 60s | `outbox.job.ts` → `billing.processOutbox()` |
| `billing-grace` | Every 60s | `grace.job.ts` → grace expiration checks |
| `billing-reconcile` | Daily 00:00 UTC | `reconcile.job.ts` → enumerates orgs via `billing.listBillableOrgsWithCustomerId()`, fetches Autumn balance per org, calls `billing.reconcileShadowBalance()`, alerts on drift > threshold |
| `billing-llm-sync-dispatch` | Every 30s | `llm-sync-dispatcher.job.ts` → fan-out per-org jobs |
| `billing-llm-sync-org` | On-demand | `llm-sync-org.job.ts` → per-org LLM spend sync |
| `billing-snapshot-cleanup` | Daily 01:00 UTC | `snapshot-cleanup.job.ts` → `billing.cleanupAllExpiredSnapshots()` |

Guarded by `NEXT_PUBLIC_BILLING_ENABLED` env var.

**Files touched:** `apps/worker/src/billing/worker.ts`, `apps/worker/src/jobs/billing/*.ts`, `packages/queue/src/index.ts`

### 6.13 Billing Token — `Partial`

**What it does:** Short-lived JWTs (1h) for sandbox-to-platform billing authentication.

**Claims:** `org_id`, `session_id`, `token_version`. Token version on the session record enables instant revocation. Full validation checks: signature → session existence → running status → org match → version match.

**Gap:** `mintBillingToken` and `verifyBillingToken` are only used in the token refresh endpoint (`apps/web/src/app/api/sessions/[id]/refresh-token/route.ts`). `validateBillingToken` (full DB validation) has **no callers**. No gateway middleware or session creation path mints or validates billing tokens. The token infrastructure exists but is not wired into request authorization.

**Files touched:** `packages/shared/src/billing/billing-token.ts`

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `auth-orgs.md` | Billing → Orgs | `orgs.getBillingInfoV2()`, `orgs.initializeBillingState()` | Reads/writes billing fields on `organization` table |
| `auth-orgs.md` | Orgs → Billing | `startTrial` in onboarding router | Onboarding triggers trial credit provisioning |
| `llm-proxy.md` | LLM → Billing | `GET /spend/logs/v2` REST API | LLM spend sync via `litellm-api.ts` (replaces cross-schema SQL) |
| `sessions-gateway.md` | Sessions → Billing | `checkCanStartSession()` | Session creation calls billing gate |
| `sessions-gateway.md` | Billing → Sessions | `sessions.status`, `metered_through_at` | Metering reads/updates session rows |
| `sandbox-providers.md` | Billing → Providers | `provider.checkSandboxes()`, `getSandboxProvider()` | Liveness checks for metering; `org-pause.ts` resolves providers directly via `getSandboxProvider()` for enforcement pause/snapshot |
| `automations-runs.md` | Automations → Billing | `billing.assertBillingGateForOrg()` | `automation_trigger` gate enforced in gateway session creation route |

### Security & Auth
- Billing routes use `orgProcedure` middleware (authenticated + org context). Settings and checkout require admin/owner role.
- Billing tokens use HS256 JWT with `BILLING_JWT_SECRET`. Token version enables instant revocation.
- No sensitive data in billing events (no prompt content, no tokens). LLM metadata includes model name and token counts only.

### Observability
- Structured logging via `@proliferate/logger` with modules: `metering`, `org-pause`, `outbox`, `llm-sync`, `trial-activation`, `snapshot-limits`.
- Key log fields: `sessionId`, `orgId`, `billableSeconds`, `credits`, `balance`, `enforcementReason`.
- `getOutboxStats()` provides pending/failed/permanently-failed event counts for monitoring (`packages/services/src/billing/outbox.ts:getOutboxStats`).
- **Alerting signals** (`alert: true` log field):
  - Permanently failed outbox events — logged with `orgId`, `eventId`, `credits`, `retryCount`.
  - Reconciliation drift exceeding `METERING_CONFIG.reconcileDriftAlertThreshold` — logged with `orgId`, `drift`, `previousBalance`, `newBalance`.

---

## 8. Acceptance Gates

- [x] Typecheck passes (`pnpm typecheck`) — 22/22
- [ ] Billing tests pass (Autumn client tests)
- [x] This spec is updated (file tree, data models, deep dives)
- [x] Idempotency keys follow the deterministic pattern
- [x] Shadow balance is only modified via `deductShadowBalance`, `bulkDeductShadowBalance`, `addShadowBalance`, or `reconcileShadowBalance`
- [x] No Autumn API calls in session start/resume hot path — gating uses local shadow balance; Autumn called only by outbox worker, reconciliation job, and billing API routes
- [x] All billable admission paths go through `assertBillingGateForOrg` or `checkBillingGateForOrg`
- [x] Concurrent session limits are atomically enforced via `pg_advisory_xact_lock` admission guard
- [x] Exhausted/suspended enforcement uses pause/snapshot (resumable), not hard-terminate

---

## 9. Known Limitations & Tech Debt

### Resolved in this PR

- [x] **All billable admission paths are gated** — Gateway session creation, oRPC session creation, setup sessions (gateway + managed-prebuild), and runtime resume/cold-start all enforce the billing gate. Resume uses `session_resume` (state-only checks, no credit minimum).
- [x] **Concurrent session limits are atomic** — `createWithAdmissionGuard` / `createSetupSessionWithAdmissionGuard` use `pg_advisory_xact_lock` to serialize per-org admission at insert time.
- [x] **Enforcement is pause/snapshot-first (resumable)** — `enforceCreditsExhausted` calls `pauseSessionWithSnapshot()` per session: migration lock → snapshot → CAS update to `status: "paused"` with `pauseReason: "credit_limit"`. Provider instances are resolved internally via `getSandboxProvider()`.
- [x] **Snapshot quota lifecycle is complete** — `ensureSnapshotCapacity` called with `deleteSnapshotFromProvider` in pause/snapshot handlers. `cleanupAllExpiredSnapshots` runs daily via `billing-snapshot-cleanup` BullMQ job at 01:00 UTC.
- [x] **Nightly reconciliation is active** — `listBillableOrgsWithCustomerId()` enumerates orgs with `billingState IN ('active','trial','grace') AND autumnCustomerId IS NOT NULL`. Per-org errors are isolated. Drift exceeding `METERING_CONFIG.reconcileDriftAlertThreshold` (500 credits) emits `alert: true`.
- [x] **Outbox permanent failures are alerted** — Permanently failed events log with `alert: true`, `orgId`, `eventId`, `credits`, and `retryCount`.

### Open

- [ ] **Billing token not wired into request authorization** — `validateBillingToken` has no callers. No gateway middleware or session creation path mints or validates billing tokens. — Expected fix: integrate into gateway or sandbox request auth.
- [ ] **Grace expiration check is polling-based** — `checkGraceExpirations()` runs every 60s, meaning grace can overrun by up to 60s. — Impact: minor, grace window is 5 minutes.
- [ ] **LLM model allowlist is manually maintained** — `ALLOWED_LLM_MODELS` set in `types.ts` must be updated when adding models to the proxy. — Impact: new models will be rejected until added.
- [ ] **`shouldTerminateSessions` field name is legacy** — `DeductResult` and `BulkDeductResult` in `shadow-balance.ts` still use `shouldTerminateSessions` as a field name. The actual enforcement behavior is pause/snapshot, not terminate. — Impact: naming-only; no behavioral issue.