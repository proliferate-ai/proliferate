# Consolidated Specs: Billing & Metering + LLM Proxy

Generated: 2026-02-15T07:25:07Z
Old source: docs/specs/archived/* (ARCHIVED on 2026-02-15; commit 27cd382)
New source: working tree canonical specs

Old version of them

<<< BEGIN OLD: docs/specs/billing-metering.md >>>
> ARCHIVED on 2026-02-15; describes behavior as of commit 27cd382.
>
> Canonical spec: ../billing-metering.md

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
- Org pause / session termination on zero balance
- Overage policy (pause vs allow, per-org)
- Checkout flow (plan activation, credit top-ups via Autumn)
- Snapshot quota management (count and retention limits)
- Distributed locks for concurrent billing operations
- Billing worker (interval-based cycles)
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
├── distributed-lock.ts         # Redis SET NX locking (acquire/renew/release)
├── billing-token.ts            # JWT tokens for sandbox billing auth
└── autumn-client.test.ts       # Autumn client tests

packages/services/src/billing/
├── index.ts                    # Re-exports all billing service modules
├── db.ts                       # Billing event queries, LLM cursor ops, LiteLLM spend reads
├── shadow-balance.ts           # Atomic deduct/add/reconcile/initialize shadow balance
├── metering.ts                 # Compute metering cycle, sandbox liveness, finalization
├── outbox.ts                   # Outbox worker: retry failed Autumn posts
├── org-pause.ts                # Bulk pause/terminate sessions, overage handling
├── trial-activation.ts         # Auto-activate plan after trial exhaustion
└── snapshot-limits.ts          # Snapshot quota checking and cleanup

packages/db/src/schema/
└── billing.ts                  # billingEvents, llmSpendCursors, billingReconciliations tables

apps/web/src/server/routers/
└── billing.ts                  # oRPC routes: getInfo, updateSettings, activatePlan, buyCredits

apps/web/src/lib/
└── billing.ts                  # Session gating helpers (checkCanStartSession, isBillingEnabled)

apps/worker/src/billing/
├── index.ts                    # Worker exports (start/stop/health)
└── worker.ts                   # Interval-based billing worker (metering, LLM sync, outbox, grace)
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
llm_spend_cursors
├── id                   TEXT PK DEFAULT 'global'
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
- Always deduct from shadow balance via `deductShadowBalance()` — it is the **only** path for credit deduction (`packages/services/src/billing/shadow-balance.ts:deductShadowBalance`).
- Use deterministic idempotency keys: `compute:{sessionId}:{fromMs}:{toMs}` for regular intervals, `compute:{sessionId}:{fromMs}:final` for finalization, `llm:{requestId}` for LLM events.
- Acquire a distributed lock before running metering or outbox cycles (`packages/shared/src/billing/distributed-lock.ts`).
- Check lock validity between sessions during metering to fail fast if lock is lost.

### Don't
- Do not call Autumn APIs in the session start/resume hot path — use `checkBillingGate()` with local shadow balance.
- Do not insert billing events outside a `deductShadowBalance` transaction — this breaks the atomicity invariant.
- Do not skip billing events for trial orgs — insert them with `status = 'skipped'` so the ledger is complete.

### Error Handling
Billing is **fail-closed**: if org lookup fails, billing state is unreadable, or shadow balance can't be computed, the operation is denied. See `apps/web/src/lib/billing.ts:checkCanStartSession`.

### Reliability
- **Metering lock**: 30s TTL, renewed every 10s. If renewal fails, the cycle aborts.
- **Outbox retries**: exponential backoff from 60s base, max 1h, up to 5 attempts. After 5 failures, event is permanently marked `failed`.
- **Idempotency**: `billingEvents.idempotency_key` UNIQUE constraint with `onConflictDoNothing` — prevents double-billing without aborting the transaction.
- **Sandbox liveness**: 3 consecutive alive-check failures before declaring dead (`METERING_CONFIG.graceFailures`).

---

## 6. Subsystem Deep Dives

### 6.1 Compute Metering — `Implemented`

**What it does:** Bills running sessions for elapsed compute time every 30 seconds.

**Happy path:**
1. `runMeteringCycle()` acquires the `billing:metering:lock` via Redis (`packages/services/src/billing/metering.ts:runMeteringCycle`).
2. Queries all sessions with `status = 'running'`.
3. Checks sandbox liveness via provider `checkSandboxes()` with grace period (3 consecutive failures = dead).
4. For alive sandboxes: computes `billableSeconds = floor((now - meteredThroughAt) / 1000)`, skips if < 10s.
5. Calls `deductShadowBalance()` with deterministic idempotency key.
6. Advances `sessions.metered_through_at`.
7. If `shouldTerminateSessions`, calls `handleCreditsExhaustedV2()` — unless transitioning from trial (tries `tryActivatePlanAfterTrial()` first).

**Edge cases:**
- Dead sandbox → `billFinalInterval()` bills through `last_seen_alive_at + pollInterval`, not detection time. Marks session `stopped`.
- Lock renewal failure → cycle aborts immediately to prevent conflicting with another worker.

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

**`addShadowBalance`:** Adds credits (top-ups, refunds). If state is `grace`/`exhausted` and new balance > 0, transitions back to `active`. Inserts a `billing_reconciliations` record.

**`reconcileShadowBalance`:** Corrects drift between local and Autumn balance. Inserts reconciliation record for audit trail.

**Files touched:** `packages/services/src/billing/shadow-balance.ts`, `packages/db/src/schema/billing.ts`

### 6.3 Credit Gating — `Partial`

**What it does:** Single entry point for session-lifecycle billing checks.

**Happy path:**
1. `checkCanStartSession()` fetches org billing info from DB (`apps/web/src/lib/billing.ts`).
2. Calls `checkBillingGate()` with org state, shadow balance, session counts, and operation type.
3. Gate checks (in order): grace expiry → billing state → credit sufficiency (min 11 credits) → concurrent session limit.
4. Returns `{ allowed: true }` or `{ allowed: false, errorCode, message, action }`.

**Operations gated:** `session_start`, `session_resume`, `cli_connect`, `automation_trigger`. Resume and CLI connect skip the concurrent limit check.

**Gap:** Gating is only enforced in the oRPC `createSessionHandler` (`apps/web/src/server/routers/sessions-create.ts:48`). Automation runs create sessions via the gateway HTTP route (`apps/gateway/src/api/proliferate/http/sessions.ts`), which has no billing check. Automations can therefore create sessions even when the org is out of credits or over concurrent limits.

**Files touched:** `packages/shared/src/billing/gating.ts`, `apps/web/src/lib/billing.ts`

### 6.4 LLM Spend Sync — `Implemented`

**What it does:** Ingests LLM cost data from LiteLLM's `LiteLLM_SpendLogs` table into billing events using cursor-based pagination.

**Happy path:**
1. Worker calls `syncLLMSpend()` every 30s (`apps/worker/src/billing/worker.ts`).
2. Fetches current cursor from `llm_spend_cursors` (singleton row `id = 'global'`).
3. Reads spend logs after cursor position, ordered by `(startTime, request_id)`.
4. For each log: calculates `credits = spend × 3 / 0.01`, calls `deductShadowBalance()` with key `llm:{request_id}`.
5. Handles state transitions (same as metering — trial auto-activation, exhausted enforcement).
6. Advances cursor after each batch.
7. Performs a lookback sweep for late-arriving logs (5-minute window, idempotency handles duplicates).

**Bootstrap modes:** `recent` (default, 5-minute lookback) or `full` (backfills from earliest log). Configurable via `LLM_SYNC_BOOTSTRAP_MODE` env var.

**Files touched:** `apps/worker/src/billing/worker.ts`, `packages/services/src/billing/db.ts`

### 6.5 Outbox Processing — `Implemented`

**What it does:** Retries posting billing events to Autumn that failed or haven't been posted yet.

**Happy path:**
1. `processOutbox()` acquires `billing:outbox:lock` via Redis (`packages/services/src/billing/outbox.ts`).
2. Queries billing events with `status IN ('pending', 'failed')`, `retry_count < 5`, `next_retry_at < now()`.
3. For each event: calls `autumnDeductCredits()` to post to Autumn.
4. On success: marks `status = 'posted'`. If Autumn denies, transitions org to `exhausted` and terminates sessions.
5. On failure: increments retry count, sets exponential backoff, marks `failed` after 5 retries.

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

**Enforcement actions:** `grace` → blocks new sessions. `exhausted`/`suspended` → terminates all running sessions.

**Files touched:** `packages/shared/src/billing/state.ts`

### 6.7 Org Pause & Session Termination — `Implemented`

**What it does:** Bulk-pauses or terminates all running sessions for an org when credits are exhausted.

**V1 (`handleCreditsExhausted`):** Checks overage policy. If `pause` → pauses all sessions. If `allow` → attempts auto top-up via Autumn; on failure, pauses.

**V2 (`handleCreditsExhaustedV2`):** Terminates sessions sequentially (stops sandbox via provider, marks session `stopped`). Used when grace period expires or overdraft cap is exceeded.

**`canOrgStartSession`:** Checks concurrent session count against plan limit.

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

### 6.10 Snapshot Quota Management — `Partial`

**What it does:** Defines per-plan snapshot count and retention limits. Snapshots are free within quota (no credit charge).

**`canCreateSnapshot`:** Checks count of sessions with `snapshot_id IS NOT NULL` against plan limit.

**`ensureSnapshotCapacity`:** If at limit, deletes oldest snapshot (by `paused_at`).

**`cleanupExpiredSnapshots`:** Deletes snapshots older than retention period.

**Gap:** All three functions are exported but have **no callers** in the codebase. Neither session pause nor any worker invokes quota checks. Snapshot limits are currently unenforced.

**Files touched:** `packages/services/src/billing/snapshot-limits.ts`

### 6.11 Distributed Locks — `Implemented`

**What it does:** Ensures only one worker runs metering or outbox processing at a time.

**Implementation:** Redis `SET NX` with token-based ownership. Lua scripts for atomic renew (`check-then-pexpire`) and release (`check-then-del`). `withLock()` helper handles acquisition, renewal interval, and release in a try/finally.

**Lock keys:** `billing:metering:lock`, `billing:outbox:lock`. TTL: 30s. Renewal: every 10s.

**Files touched:** `packages/shared/src/billing/distributed-lock.ts`

### 6.12 Billing Worker — `Implemented`

**What it does:** Runs four periodic tasks as `setInterval` loops inside the worker process.

| Task | Interval | Function |
|------|----------|----------|
| Compute metering | 30s | `billing.runMeteringCycle()` |
| LLM spend sync | 30s | `syncLLMSpend()` (inline in worker) |
| Outbox processing | 60s | `billing.processOutbox()` |
| Grace expiration | 60s | `checkGraceExpirations()` |

Initial runs: metering at +5s, LLM sync at +3s after start. Guarded by `NEXT_PUBLIC_BILLING_ENABLED` env var.

**Files touched:** `apps/worker/src/billing/worker.ts`

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
| `llm-proxy.md` | LLM → Billing | `LiteLLM_SpendLogs` table | LLM spend sync reads from LiteLLM's external table |
| `sessions-gateway.md` | Sessions → Billing | `checkCanStartSession()` | Session creation calls billing gate |
| `sessions-gateway.md` | Billing → Sessions | `sessions.status`, `metered_through_at` | Metering reads/updates session rows |
| `sandbox-providers.md` | Billing → Providers | `provider.checkSandboxes()`, `provider.terminate()` | Liveness checks and session termination |
| `automations-runs.md` | Automations → Billing | (not yet wired) | `automation_trigger` gate type exists but automations bypass billing via gateway HTTP route |

### Security & Auth
- Billing routes use `orgProcedure` middleware (authenticated + org context). Settings and checkout require admin/owner role.
- Billing tokens use HS256 JWT with `BILLING_JWT_SECRET`. Token version enables instant revocation.
- No sensitive data in billing events (no prompt content, no tokens). LLM metadata includes model name and token counts only.

### Observability
- Structured logging via `@proliferate/logger` with modules: `metering`, `org-pause`, `outbox`, `llm-sync`, `trial-activation`, `snapshot-limits`.
- Key log fields: `sessionId`, `orgId`, `billableSeconds`, `credits`, `balance`, `enforcementReason`.
- `getOutboxStats()` provides pending/failed/permanently-failed event counts for monitoring (`packages/services/src/billing/outbox.ts:getOutboxStats`).

---

## 8. Acceptance Gates

- [ ] Typecheck passes (`pnpm typecheck`)
- [ ] Billing tests pass (Autumn client tests)
- [ ] This spec is updated (file tree, data models, deep dives)
- [ ] Idempotency keys follow the deterministic pattern
- [ ] Shadow balance is only modified via `deductShadowBalance` or `addShadowBalance`
- [ ] No Autumn API calls in session start/resume hot path

---

## 9. Known Limitations & Tech Debt

- [ ] **Automation runs bypass billing gate** — the `automation_trigger` gate type exists in `checkBillingGate` but automations create sessions via the gateway HTTP route (`apps/gateway/src/api/proliferate/http/sessions.ts`), which has no billing check. Only the oRPC `createSessionHandler` enforces gating. — Expected fix: add billing gate to the gateway session creation path or have the worker call gating before dispatching.
- [ ] **Snapshot quota functions have no callers** — `canCreateSnapshot`, `ensureSnapshotCapacity`, and `cleanupExpiredSnapshots` are exported but never invoked. Snapshot count and retention limits are unenforced. — Expected fix: wire into session pause/snapshot paths and add cleanup to billing worker.
- [ ] **Billing token not wired into request authorization** — `validateBillingToken` has no callers. No gateway middleware or session creation path mints or validates billing tokens. — Expected fix: integrate into gateway or sandbox request auth.
- [ ] **Overage auto-charge (V1) not integrated with V2 state machine** — `handleCreditsExhausted` (V1) uses `autumnAutoTopUp` and pause, while V2 uses `handleCreditsExhaustedV2` with termination. Both exist but V2 is the active path for shadow-balance enforcement. — Expected fix: remove V1 once V2 is fully validated.
- [ ] **No automated reconciliation with Autumn** — `reconcileShadowBalance()` exists but is not called on a schedule. Shadow balance can drift from Autumn's actual balance indefinitely. — Expected fix: add periodic reconciliation in billing worker.
- [ ] **Grace expiration check is polling-based** — `checkGraceExpirations()` runs every 60s, meaning grace can overrun by up to 60s. — Impact: minor, grace window is 5 minutes.
- [ ] **Permanently failed outbox events have no alerting** — events that exhaust all 5 retries are marked `failed` but no alert is raised. — Expected fix: add monitoring/alerting on permanently failed events.
- [ ] **LLM model allowlist is manually maintained** — `ALLOWED_LLM_MODELS` set in `types.ts` must be updated when adding models to the proxy. — Impact: new models will be rejected until added.
<<< END OLD: docs/specs/billing-metering.md >>>

<<< BEGIN OLD: docs/specs/llm-proxy.md >>>
> ARCHIVED on 2026-02-15; describes behavior as of commit 27cd382.
>
> Canonical spec: ../llm-proxy.md

# LLM Proxy — System Spec

## 1. Scope & Purpose

### In Scope
- Virtual key generation: per-session, per-org temporary keys via LiteLLM admin API
- Key scoping model: team = org, user = session for cost isolation
- Key duration and lifecycle
- LiteLLM API integration contract (endpoints called, auth model)
- Spend tracking via LiteLLM's `LiteLLM_SpendLogs` table
- LLM spend cursors (DB sync state for billing reconciliation)
- Environment configuration (`LLM_PROXY_URL`, `LLM_PROXY_MASTER_KEY`, `LLM_PROXY_KEY_DURATION`, etc.)
- How providers (Modal, E2B) pass the virtual key to sandboxes

### Feature Status

| Feature | Status | Evidence |
|---------|--------|----------|
| Virtual key generation | Implemented | `packages/shared/src/llm-proxy.ts:generateVirtualKey` |
| Key scoping (team/user) | Implemented | `packages/shared/src/llm-proxy.ts:generateVirtualKey` — `team_id=orgId`, `user_id=sessionId` |
| Key duration config | Implemented | `packages/environment/src/schema.ts:LLM_PROXY_KEY_DURATION` |
| Team (org) provisioning | Implemented | `packages/shared/src/llm-proxy.ts:ensureTeamExists` |
| Sandbox key injection (Modal) | Implemented | `packages/shared/src/providers/modal-libmodal.ts:createSandbox` |
| Sandbox key injection (E2B) | Implemented | `packages/shared/src/providers/e2b.ts:createSandbox` |
| Spend sync (cursor-based) | Implemented | `apps/worker/src/billing/worker.ts:syncLLMSpend` |
| LLM spend cursors (DB) | Implemented | `packages/db/src/schema/billing.ts:llmSpendCursors` |
| Model routing config | Implemented | `apps/llm-proxy/litellm/config.yaml` |
| Key revocation on session end | Planned | No code — see §9 |

### Out of Scope
- LiteLLM service internals (model routing config, caching, rate limiting) — external dependency, not our code
- Billing policy, credit gating, charging — see `billing-metering.md`
- Sandbox boot mechanics — see `sandbox-providers.md`
- Session lifecycle (create/pause/resume/delete) — see `sessions-gateway.md`
- Secret decryption and injection — see `secrets-environment.md`

### Mental Model

The LLM proxy is an **external LiteLLM service** that Proliferate routes sandbox LLM requests through. This spec documents our **integration contract** with it — the API calls we make, the keys we generate, and the spend data we read back — not the service itself.

The integration solves two problems: (1) **security** — sandboxes never see real API keys; they get short-lived virtual keys scoped to a single session, and (2) **cost isolation** — every LLM request is attributed to an org (team) and session (user) in LiteLLM's spend tracking, enabling per-org billing.

The flow is: session creation → generate virtual key → pass key + proxy base URL to sandbox → sandbox makes LLM calls through proxy → LiteLLM logs spend → billing worker syncs spend logs into billing events.

**Core entities:**
- **Virtual key** — a temporary LiteLLM API key (e.g., `sk-xxx`) scoped to one session and one org. Generated via LiteLLM's `/key/generate` admin endpoint.
- **Team** — LiteLLM's grouping for cost tracking. Maps 1:1 to a Proliferate org. Created via `/team/new` if it doesn't exist.
- **LLM spend cursor** — a single-row DB table tracking the sync position when reading spend logs from LiteLLM's `LiteLLM_SpendLogs` table.

**Key invariants:**
- Virtual keys are always scoped: `team_id = orgId`, `user_id = sessionId`.
- When `LLM_PROXY_URL` is not set, sandboxes fall back to a direct `ANTHROPIC_API_KEY` (no proxy, no spend tracking).
- When `LLM_PROXY_REQUIRED=true` and `LLM_PROXY_URL` is unset, session creation fails hard.
- The spend sync is eventually consistent — logs appear in LiteLLM's table and are polled every 30 seconds by the billing worker.

---

## 2. Core Concepts

### LiteLLM Virtual Keys
LiteLLM's virtual key system (free tier) generates temporary API keys that the proxy validates on each request. Each key carries `team_id` and `user_id` metadata, which LiteLLM uses to attribute spend in its `LiteLLM_SpendLogs` table.
- Key detail agents get wrong: we use virtual keys (free tier), NOT JWT auth (enterprise tier). The master key is only used for admin API calls, never passed to sandboxes.
- Reference: [LiteLLM virtual keys docs](https://docs.litellm.ai/docs/proxy/virtual_keys)

### Admin URL vs Public URL
Two separate URLs exist for the proxy: the **admin URL** for key generation and team management (requires master key, may be internal-only), and the **public URL** for sandbox LLM requests (accepts virtual keys, must be reachable from sandboxes).
- Key detail agents get wrong: `LLM_PROXY_ADMIN_URL` is optional — if unset, `LLM_PROXY_URL` is used for both admin calls and public access. `LLM_PROXY_PUBLIC_URL` controls what base URL sandboxes see.
- Reference: `packages/shared/src/llm-proxy.ts:generateVirtualKey`, `packages/shared/src/llm-proxy.ts:getLLMProxyBaseURL`

### Model Routing Configuration
The LiteLLM config (`apps/llm-proxy/litellm/config.yaml`) maps OpenCode model IDs (e.g., `anthropic/claude-sonnet-4-5`) to actual Anthropic API model IDs (often with date suffixes, e.g., `anthropic/claude-sonnet-4-5-20250929`, though some like `anthropic/claude-opus-4-6` map without a suffix). The proxy also accepts short aliases (e.g., `claude-sonnet-4-5`).
- Key detail agents get wrong: model routing is configured in `config.yaml`, not in our TypeScript code. Adding a new model requires editing the YAML config and redeploying the proxy container.
- Reference: `apps/llm-proxy/litellm/config.yaml`

### Spend Sync Architecture
LiteLLM writes spend data to its own `LiteLLM_SpendLogs` table in a shared PostgreSQL database. Our billing worker reads from this table using cursor-based pagination and converts spend logs into billing events. The two systems share a database but use different schemas.
- Key detail agents get wrong: we read from LiteLLM's schema (`litellm.LiteLLM_SpendLogs` by default) via raw SQL, not via Drizzle ORM. The schema name is configurable via `LITELLM_DB_SCHEMA`.
- Reference: `packages/services/src/billing/db.ts:LITELLM_SPEND_LOGS_REF`

---

## 3. File Tree

```
apps/llm-proxy/
├── Dockerfile                          # LiteLLM container image (ghcr.io/berriai/litellm)
├── README.md                           # Deployment docs, architecture diagram
└── litellm/
    └── config.yaml                     # Model routing, master key, DB URL, retry settings

packages/shared/src/
├── llm-proxy.ts                        # Virtual key generation, team management, URL helpers

packages/services/src/
├── sessions/
│   └── sandbox-env.ts                  # Calls generateSessionAPIKey during session creation
└── billing/
    └── db.ts                           # LLM spend cursor CRUD, raw SQL reads from LiteLLM_SpendLogs

packages/environment/src/
└── schema.ts                           # LLM_PROXY_* env var definitions

packages/db/src/schema/
└── billing.ts                          # llmSpendCursors table definition

apps/worker/src/billing/
└── worker.ts                           # syncLLMSpend() — polling loop that reads spend logs

packages/shared/src/providers/
├── modal-libmodal.ts                   # Passes LLM_PROXY_API_KEY + ANTHROPIC_BASE_URL to sandbox
└── e2b.ts                             # Same key/URL injection pattern as Modal
```

---

## 4. Data Models & Schemas

### Database Tables

```sql
llm_spend_cursors
├── id              TEXT PRIMARY KEY DEFAULT 'global'  -- singleton row
├── last_start_time TIMESTAMPTZ NOT NULL               -- cursor position in LiteLLM_SpendLogs
├── last_request_id TEXT                               -- tie-breaker for deterministic ordering
├── records_processed INTEGER DEFAULT 0                -- total records synced (monotonic)
└── synced_at       TIMESTAMPTZ DEFAULT NOW()          -- last sync timestamp
```

### Core TypeScript Types

```typescript
// packages/shared/src/llm-proxy.ts
interface VirtualKeyOptions {
  duration?: string;       // e.g., "15m", "1h", "24h"
  maxBudget?: number;      // max spend in USD
  metadata?: Record<string, unknown>;
}

interface VirtualKeyResponse {
  key: string;             // "sk-xxx" — the virtual key
  expires: string;         // ISO timestamp
  team_id: string;         // orgId
  user_id: string;         // sessionId
}

// packages/services/src/billing/db.ts
interface LLMSpendLog {
  request_id: string;
  team_id: string | null;  // our orgId
  user: string | null;     // our sessionId
  spend: number;           // cost in USD
  model: string;
  model_group: string | null;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  startTime?: Date | string;
}

interface LLMSpendCursor {
  lastStartTime: Date;
  lastRequestId: string | null;
  recordsProcessed: number;
  syncedAt: Date;
}
```

### Key Indexes & Query Patterns
- `llm_spend_cursors` has no additional indexes — single-row table queried by `WHERE id = 'global'`.
- `LiteLLM_SpendLogs` (external, LiteLLM-managed) is queried with `ORDER BY "startTime" ASC, request_id ASC` for deterministic cursor pagination. Index coverage depends on LiteLLM's schema — not under our control.

---

## 5. Conventions & Patterns

### Do
- Always call `ensureTeamExists(orgId)` before generating a virtual key — `generateSessionAPIKey` does this automatically (`packages/shared/src/llm-proxy.ts:generateSessionAPIKey`)
- Use `buildSandboxEnvVars()` from `packages/services/src/sessions/sandbox-env.ts` to generate all sandbox env vars, including the virtual key — it handles the proxy/direct key decision centrally
- Strip trailing slashes and `/v1` before appending paths to admin URLs — `generateVirtualKey` does this (`adminUrl` normalization at line 69)

### Don't
- Don't pass `LLM_PROXY_MASTER_KEY` to sandboxes — only virtual keys go to sandboxes
- Don't read `LiteLLM_SpendLogs` via Drizzle ORM — the table is managed by LiteLLM, use raw SQL via `packages/services/src/billing/db.ts`
- Don't assume `LLM_PROXY_URL` is always set — graceful fallback to direct API key is required unless `LLM_PROXY_REQUIRED=true`

### Error Handling

```typescript
// Key generation failure is fatal when proxy is configured
if (!proxyUrl) {
  if (requireProxy) {
    throw new Error("LLM proxy is required but LLM_PROXY_URL is not set");
  }
  envVars.ANTHROPIC_API_KEY = directApiKey ?? "";
} else {
  try {
    const apiKey = await generateSessionAPIKey(sessionId, orgId);
    envVars.LLM_PROXY_API_KEY = apiKey;
  } catch (err) {
    throw new Error(`LLM proxy enabled but failed to generate session key: ${message}`);
  }
}
```
_Source: `packages/services/src/sessions/sandbox-env.ts:buildSandboxEnvVars`_

### Reliability
- Team creation is idempotent — `ensureTeamExists` checks via `GET /team/info` first, handles "already exists" errors from `POST /team/new` (`packages/shared/src/llm-proxy.ts:ensureTeamExists`)
- Spend sync uses cursor-based pagination with deterministic ordering (`startTime ASC, request_id ASC`) to avoid duplicates (`packages/services/src/billing/db.ts:getLLMSpendLogsByCursor`)
- Lookback sweep catches late-arriving logs; idempotency keys prevent double-billing (`apps/worker/src/billing/worker.ts:syncLLMSpend`)

### Testing Conventions
- No dedicated tests exist for the LLM proxy integration. Key generation and spend sync are verified via manual testing and production observability.
- To test locally, run LiteLLM via Docker Compose (`docker compose up -d llm-proxy`) and set `LLM_PROXY_URL=http://localhost:4000`.

---

## 6. Subsystem Deep Dives

### 6.1 Virtual Key Generation

**What it does:** Generates a short-lived LiteLLM virtual key for a sandbox session, scoped to an org for spend tracking.

**Happy path:**
1. `buildSandboxEnvVars()` is called during session creation (`packages/services/src/sessions/sandbox-env.ts`)
2. It checks if `LLM_PROXY_URL` is set. If yes, calls `generateSessionAPIKey(sessionId, orgId)` (`packages/shared/src/llm-proxy.ts:generateSessionAPIKey`)
3. `generateSessionAPIKey` first calls `ensureTeamExists(orgId)` — `GET /team/info?team_id={orgId}` to check, then `POST /team/new` if needed (`packages/shared/src/llm-proxy.ts:ensureTeamExists`)
4. Then calls `generateVirtualKey(sessionId, orgId)` — `POST /key/generate` with `team_id=orgId`, `user_id=sessionId`, `duration` from env (`packages/shared/src/llm-proxy.ts:generateVirtualKey`)
5. Returns the `key` string. The caller stores it as `envVars.LLM_PROXY_API_KEY`

**Edge cases:**
- `LLM_PROXY_URL` unset + `LLM_PROXY_REQUIRED=false` → falls back to direct `ANTHROPIC_API_KEY`
- `LLM_PROXY_URL` unset + `LLM_PROXY_REQUIRED=true` → throws, blocking session creation
- Team creation race condition → `ensureTeamExists` tolerates "already exists" / "duplicate" errors
- Key generation failure → throws, blocking session creation (no silent fallback when proxy is configured)

**Files touched:** `packages/shared/src/llm-proxy.ts`, `packages/services/src/sessions/sandbox-env.ts`

**Status:** Implemented

### 6.2 Sandbox Key Injection

**What it does:** Passes the virtual key and proxy base URL to the sandbox so OpenCode routes LLM requests through the proxy.

**Happy path:**
1. Provider reads `opts.envVars.LLM_PROXY_API_KEY` (set by `buildSandboxEnvVars`) and calls `getLLMProxyBaseURL()` (`packages/shared/src/llm-proxy.ts:getLLMProxyBaseURL`)
2. `getLLMProxyBaseURL()` returns `LLM_PROXY_PUBLIC_URL || LLM_PROXY_URL` normalized with `/v1` suffix
3. Provider sets two env vars on the sandbox: `ANTHROPIC_API_KEY = virtualKey`, `ANTHROPIC_BASE_URL = proxyBaseUrl`
4. OpenCode inside the sandbox uses these standard env vars to route all Anthropic API calls through the proxy
5. The same env vars are set again as process-level env when launching the OpenCode server (after `setupEssentialDependencies` writes config files)

**Edge cases:**
- No proxy configured → `ANTHROPIC_API_KEY` is set to the direct key, `ANTHROPIC_BASE_URL` is not set
- E2B snapshot resume → proxy vars (`ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`) are **excluded** from the shell profile re-injection and only passed as process-level env vars to the OpenCode server process via `envs: opencodeEnv`. Other env vars are re-exported to the shell. (`packages/shared/src/providers/e2b.ts:createSandbox`, lines ~182-189 and ~646-659)

**Files touched:** `packages/shared/src/providers/modal-libmodal.ts:createSandbox`, `packages/shared/src/providers/e2b.ts:createSandbox`, `packages/shared/src/llm-proxy.ts:getLLMProxyBaseURL`

**Status:** Implemented

### 6.3 LLM Spend Sync

**What it does:** Periodically reads LLM spend logs from LiteLLM's database and converts them into billing events for Proliferate's billing system.

**Happy path:**
1. Billing worker calls `syncLLMSpend()` every 30 seconds, guarded by `NEXT_PUBLIC_BILLING_ENABLED` (`apps/worker/src/billing/worker.ts`)
2. Reads current cursor from `llm_spend_cursors` table — `getLLMSpendCursor()` (`packages/services/src/billing/db.ts`)
3. Queries `litellm.LiteLLM_SpendLogs` via raw SQL, ordered by `startTime ASC, request_id ASC`, batched at `llmSyncBatchSize` (`packages/services/src/billing/db.ts:getLLMSpendLogsByCursor`)
4. For each log with a valid `team_id` and positive `spend`, calls `billing.deductShadowBalance()` with `eventType: "llm"` and `idempotencyKey: "llm:{request_id}"` — this atomically deducts credits and creates a billing event (see `billing-metering.md` for shadow balance details)
5. Updates cursor position after each batch (`packages/services/src/billing/db.ts:updateLLMSpendCursor`)
6. After cursor-based sweep, runs a lookback sweep for late-arriving logs (`getLLMSpendLogsLookback`)

**Edge cases:**
- First run (no cursor) with `LLM_SYNC_BOOTSTRAP_MODE=full` → seeds cursor from earliest log in `LiteLLM_SpendLogs`
- First run with `LLM_SYNC_BOOTSTRAP_MODE=recent` (default) → starts from 5-minute lookback window
- Duplicate logs → `deductShadowBalance` uses unique `idempotencyKey` (`llm:{request_id}`), duplicates are silently skipped
- Max batches exceeded → logs warning but does not fail; remaining logs are picked up next cycle

**Files touched:** `apps/worker/src/billing/worker.ts:syncLLMSpend`, `packages/services/src/billing/db.ts`

**Status:** Implemented

### 6.4 Environment Configuration

**What it does:** Six env vars control the LLM proxy integration.

| Env Var | Required | Default | Purpose |
|---------|----------|---------|---------|
| `LLM_PROXY_URL` | No | — | Base URL of the LiteLLM proxy. When set, enables proxy mode. |
| `LLM_PROXY_ADMIN_URL` | No | `LLM_PROXY_URL` | Separate admin URL for key/team management. Falls back to `LLM_PROXY_URL`. |
| `LLM_PROXY_PUBLIC_URL` | No | `LLM_PROXY_URL` | Public-facing URL that sandboxes use. Falls back to `LLM_PROXY_URL`. |
| `LLM_PROXY_MASTER_KEY` | When proxy is enabled | — | Master key for LiteLLM admin API (key generation, team management). |
| `LLM_PROXY_KEY_DURATION` | No | `"24h"` | Default virtual key validity duration. Supports LiteLLM duration strings. |
| `LLM_PROXY_REQUIRED` | No | `false` | When `true`, session creation fails if proxy is not configured. |

Additional env vars used by the spend sync (read via raw `process.env`, not in the typed schema):
- `LITELLM_DB_SCHEMA` — PostgreSQL schema containing `LiteLLM_SpendLogs` (default: `"litellm"`) (`packages/services/src/billing/db.ts`)
- `LLM_SYNC_BOOTSTRAP_MODE` — `"recent"` (default) or `"full"` for first-run backfill behavior (`apps/worker/src/billing/worker.ts`)
- `LLM_SYNC_MAX_BATCHES` — max batches per sync cycle (default: 100, or 20 on bootstrap) (`apps/worker/src/billing/worker.ts`)

**Files touched:** `packages/environment/src/schema.ts` (LLM_PROXY_* vars), `packages/shared/src/llm-proxy.ts`, `packages/services/src/billing/db.ts`, `apps/worker/src/billing/worker.ts`

**Status:** Implemented

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| Sandbox Providers | Providers → This | `getLLMProxyBaseURL()`, reads `envVars.LLM_PROXY_API_KEY` | Both Modal and E2B inject the virtual key and base URL at sandbox boot. See `sandbox-providers.md` §6. |
| Sessions | Sessions → This | `buildSandboxEnvVars()` → `generateSessionAPIKey()` | Session creation triggers key generation. See `sessions-gateway.md` §6. |
| Billing & Metering | Billing → This | `syncLLMSpend()` reads `LiteLLM_SpendLogs`, writes `billing_events` | Billing worker polls spend data. Charging policy owned by `billing-metering.md`. |
| Environment | This → Environment | `env.LLM_PROXY_*` | Typed `LLM_PROXY_*` vars read from env schema (`packages/environment/src/schema.ts`). Sync tuning vars (`LITELLM_DB_SCHEMA`, `LLM_SYNC_*`) are raw `process.env` reads — see §6.4. |

### Security & Auth
- The master key (`LLM_PROXY_MASTER_KEY`) is never exposed to sandboxes — it stays server-side for admin API calls only.
- Virtual keys are the only credential sandboxes receive. They are short-lived (default 24h) and scoped to a single session.
- The master key authenticates all admin API calls via `Authorization: Bearer {masterKey}` header.
- Sandbox env vars filter out `LLM_PROXY_API_KEY`, `ANTHROPIC_API_KEY`, and `ANTHROPIC_BASE_URL` from the pass-through env loop to prevent double-setting or leaking the real key when proxy is active (`packages/shared/src/providers/modal-libmodal.ts:createSandbox`, `packages/shared/src/providers/e2b.ts:createSandbox`).

### Observability
- Key generation latency is logged at debug level: `"Generated LLM proxy session key"` with `durationMs` (`packages/services/src/sessions/sandbox-env.ts`)
- Spend sync logs totals: `"Synced LLM spend logs"` with `totalProcessed` and `batchCount` (`apps/worker/src/billing/worker.ts`)
- Key generation failures log at error level before throwing (`packages/services/src/sessions/sandbox-env.ts`)

---

## 8. Acceptance Gates

- [ ] Typecheck passes
- [ ] Relevant tests pass
- [ ] This spec is updated (file tree, data models, deep dives)
- [ ] LLM proxy env vars documented in environment schema if added/changed
- [ ] Virtual key duration and scoping unchanged unless explicitly approved

---

## 9. Known Limitations & Tech Debt

- [ ] **No key revocation on session end** — virtual keys remain valid until their duration expires, even after a session is terminated. Impact: minimal (keys are short-lived and sandboxes are destroyed), but a revocation call on session delete would be cleaner. Expected fix: call `POST /key/delete` on session terminate.
- [ ] **Shared database coupling** — the spend sync reads directly from LiteLLM's PostgreSQL schema, coupling our billing worker to LiteLLM's internal table format. Impact: LiteLLM schema changes could break the sync. Expected fix: use LiteLLM's HTTP spend API instead of raw SQL if one becomes available.
- [ ] **Single global cursor** — the `llm_spend_cursors` table uses a singleton row (`id = 'global'`). This means only one billing worker instance can sync spend logs at a time. Impact: acceptable at current scale. Expected fix: per-org cursors or distributed lock if needed.
- [ ] **No budget enforcement on virtual keys** — `maxBudget` is passed through to LiteLLM but not actively used in session creation. Budget enforcement is handled by Proliferate's billing system, not the proxy. Impact: none currently, as billing gating is separate.
<<< END OLD: docs/specs/llm-proxy.md >>>

New version of them

<<< BEGIN NEW: docs/specs/billing-metering.md >>>
# Billing & Metering - System Spec

## 1. Scope & Purpose

### In Scope
- **Domain-layer credit gating:** single gate enforced via `@proliferate/services/billing` so no transport (Web oRPC, Gateway HTTP, Automations) can bypass it.
- **Shadow balance:** locally cached credits with atomic deductions, plus a bulk-deduct path for high-frequency ingestion.
- **Compute metering:** interval-based compute billing driven by BullMQ repeatable jobs (no `setInterval` workers).
- **LLM spend sync:** API-based ingestion from LiteLLM Admin REST API, partitioned per org via BullMQ fan-out.
- **Outbox:** asynchronous posting of usage to Autumn with retries/backoff (Autumn is never in the hot path).
- **V2 enforcement:** fail-closed gating, grace expiry enforcement, and termination on exhaustion.
- **Nightly reconciliation:** automated drift healing against Autumn's authoritative balance.
- **Snapshot quota enforcement:** hard snapshot count enforcement on pause/snapshot flows (including provider-side deletion).
- Trial credit provisioning and checkout flows (plan activation + credit top-ups via Autumn).

### Out of Scope
- Custom distributed cron via Node.js `setInterval` and custom Redis locks for billing coordination (replaced by BullMQ repeatables).
- Raw cross-schema database reads into LiteLLM's internal tables (replaced by LiteLLM Admin REST API).
- V1 overage auto-charge / pause mechanics (deprecated; V2 termination is the only enforcement path).
- LiteLLM virtual key generation, budgeting, and revocation (see `llm-proxy.md`).
- Provider pause/terminate mechanics (see `sessions-gateway.md` and `sandbox-providers.md`).

### Mental Model

Billing tracks consumption and enforces limits for each organization. Two cost streams feed a single credit pool:
- **Compute**: sandbox uptime (metered every 30s).
- **LLM**: inference spend (polled from LiteLLM and converted to credits).

Both streams deduct from a **shadow balance**: a locally cached credit counter stored on the `organization` row. Shadow balance is the source of truth for gating decisions. Autumn is the asynchronous source of truth for payments/subscriptions and is reconciled nightly.

The system is designed around four invariants:
1. **Core domain enforcement:** gating decisions happen in `packages/services`, not in web-only helpers.
2. **Exactly-once deductions:** idempotency keys + unique constraints prevent double-charges.
3. **Batched Postgres locks where needed:** high-frequency sources (LLM spend logs) are aggregated and applied with a single `FOR UPDATE` lock + bulk insert.
4. **Queue-driven state:** all periodic work runs via BullMQ repeatable jobs (distributed locking, stalled recovery, and concurrency controls).

---

## 2. Core Concepts

### Credits
- 1 credit = **$0.01** (`CREDIT_VALUE_USD = 0.01`).
- Compute rate: **1 credit/minute** (`COMPUTE_CREDITS_PER_MINUTE = 1`).
- LLM rate: LiteLLM actual USD cost x **3x markup** converted to credits (`calculateLLMCredits()`).

### Autumn
Autumn is the external billing system (Stripe-backed). It is **never** called in the session gating hot path. It is only called by:
- Billing checkout routes (plan attach, credit purchase)
- Outbox processing (posting usage with idempotency keys)
- Nightly reconciliation (`autumnGetBalance`)

### BullMQ Worker Topology
Billing runs periodic tasks via BullMQ repeatable jobs in the worker app:
- `metering-cycle` (every 30s): compute metering + sandbox liveness
- `llm-sync-dispatcher` (every 30s): enqueues `llm-sync-org:{orgId}` jobs
- `billing-outbox` (every 60s): posts pending usage to Autumn
- `grace-expirations` (every 60s): expires grace windows and enforces termination
- `autumn-reconcile` (nightly @ 00:00 UTC): drift correction vs Autumn

---

## 3. File Tree

```text
packages/shared/src/billing/
|-- index.ts
|-- types.ts                    # rates + config + billing types
|-- state.ts                    # billing FSM transitions
|-- gating.ts                   # pure gate evaluator (no DB)
|-- autumn-client.ts            # Autumn HTTP client
|-- autumn-types.ts             # Autumn API type definitions
`-- billing-token.ts            # JWT tokens for sandbox <-> platform auth (NOT gateway WS auth)

packages/services/src/billing/
|-- index.ts
|-- db.ts                       # billing_events queries + llm_spend_cursors CRUD
|-- gate.ts                     # DB-backed gate: checkBillingGateForOrg/assertBillingGateForOrg
|-- shadow-balance.ts           # deduct/add/reconcile + bulkDeductShadowBalance()
|-- metering.ts                 # runMeteringCycle() + finalizeSessionBilling()
|-- litellm-api.ts              # LiteLLM Admin REST wrapper (/spend/logs/v2)
|-- outbox.ts                   # processOutbox() -> autumnDeductCredits()
|-- org-pause.ts                # V2 enforcement: handleCreditsExhaustedV2(), terminateAllOrgSessions()
|-- trial-activation.ts
`-- snapshot-limits.ts          # ensureSnapshotCapacity()

apps/web/src/lib/
`-- billing.ts                  # web wrapper for gate decisions

apps/web/src/server/routers/
|-- sessions-create.ts          # checks gate before session record insert
|-- sessions-pause.ts           # ensureSnapshotCapacity + terminate + revoke LLM key
`-- sessions-snapshot.ts        # ensureSnapshotCapacity

apps/gateway/src/api/proliferate/http/
`-- sessions.ts                 # checks gate for gateway-initiated session creation (incl automations)

apps/worker/src/billing/
`-- worker.ts                   # BullMQ repeatables + LLM sync fan-out/worker

packages/queue/src/index.ts     # BullMQ queues + worker factories (billing queues included)

packages/db/src/schema/
`-- schema.ts                   # billing_events, llm_spend_cursors, billing_reconciliations
```

---

## 4. Data Models & Schemas

### `billing_events` (Ledger + Outbox)
Immutable ledger rows that also act as an outbox for Autumn posting.
- Idempotency is enforced by a unique constraint on `idempotency_key`.
- LLM spend events use `llm:{request_id}`.
- Compute events use deterministic interval boundaries:
  - Regular: `compute:{sessionId}:{fromMs}:{toMs}`
  - Final: `compute:{sessionId}:{fromMs}:final`

### `llm_spend_cursors` (Partitioned Per Org)
Per-org cursor state for LiteLLM spend log ingestion.

```sql
llm_spend_cursors
|-- organization_id      TEXT PK FK -> organization.id (CASCADE)
|-- last_start_time      TIMESTAMPTZ NOT NULL
|-- last_request_id      TEXT
|-- records_processed    INT NOT NULL DEFAULT 0
`-- synced_at            TIMESTAMPTZ NOT NULL DEFAULT now()
```

Migration note: `0026_llm_spend_cursors_partition.sql` renames the legacy singleton table to `llm_spend_cursors_global`.

### `billing_reconciliations`
Audit trail for any shadow balance correction (nightly drift sync, manual adjustments, refunds).

---

## 5. Subsystem Deep Dives

### 5.1 Universal Credit Gating (Iron Door)
**Goal:** no entry point can create/resume sessions without passing the same gate.

**Implementation:**
1. Entry point calls `billing.checkBillingGateForOrg(orgId, operation)` or `billing.assertBillingGateForOrg(...)`.
2. The service loads org billing state + shadow balance and session counts.
3. The pure gate evaluator (`@proliferate/shared/billing:checkBillingGate`) returns `{ allowed, message, action }`.
4. Denies are **fail-closed**. If grace has expired, the gate best-effort expires grace in DB.

**Enforced in:**
- Web oRPC session create: `apps/web/src/server/routers/sessions-create.ts`
- Gateway HTTP session create (includes automations): `apps/gateway/src/api/proliferate/http/sessions.ts`

### 5.2 Compute Metering (BullMQ)
**Goal:** bill compute without distributed cron or lock races.

**Flow:**
1. BullMQ repeatable job `metering-cycle` runs every 30s (`apps/worker/src/billing/worker.ts`).
2. Calls `billing.runMeteringCycle(providers)`.
3. Groups by provider for liveness checks (`provider.checkSandboxes()`), uses a grace counter before declaring dead.
4. Bills deterministic intervals via `deductShadowBalance()`; advances `metered_through_at` even when idempotent.
5. If state transition requires enforcement, calls `handleCreditsExhaustedV2()` (termination).
6. If a sandbox is declared dead and the session is stopped, the worker revokes the session's LLM proxy key (best-effort).

### 5.3 LLM Spend Sync (BullMQ + REST + Bulk Deduct)
**Goal:** horizontally scalable ingestion without a global cursor or per-log DB locks.

**Dispatcher:**
- BullMQ repeatable job `llm-sync-dispatcher` runs every 30s.
- Enqueues one job per org: `llm-sync-org:{orgId}` (deduped by `jobId`).
- Org set = `running-orgs` union `cursor-orgs` so we keep syncing orgs that recently stopped but still have cursors.

**Org worker:**
1. Reads per-org cursor from `llm_spend_cursors`.
2. Calls LiteLLM Admin API `/spend/logs/v2` for `team_id=orgId` over a bounded window (`start_date` to `end_date`).
3. Sorts client-side by `(startTime, request_id)` and filters strictly after the cursor.
4. Transforms logs into `ShadowBalanceBulkEvent[]`.
5. Calls `bulkDeductShadowBalance(orgId, events)`:
   - single `FOR UPDATE` on `organization`
   - bulk insert into `billing_events` with `ON CONFLICT DO NOTHING`
   - deducts only credits for inserted rows
6. Advances cursor using the last processed `(startTime, request_id)`.
7. Performs a lookback sweep for late-arriving logs (idempotent; does not advance cursor).

### 5.4 Outbox (Autumn Posting)
**Goal:** never block on Autumn, and reliably converge.

**Flow:**
1. BullMQ repeatable job `billing-outbox` runs every 60s.
2. `processOutbox()` selects `billing_events` where:
   - `status in ('pending','failed')`
   - `retry_count < maxRetries`
   - `next_retry_at <= now()`
3. Posts to Autumn using the event's `idempotency_key`.
4. Updates event status (`posted` or backoff + `retry_count`).
5. If Autumn denies credits, the org is marked exhausted and V2 enforcement runs.

### 5.5 Grace Expiry Enforcement
**Flow:**
1. BullMQ repeatable job `grace-expirations` runs every 60s.
2. For orgs where grace has expired, transitions to exhausted and terminates running sessions.

### 5.6 Nightly Reconciliation
**Flow (00:00 UTC):**
1. BullMQ job `autumn-reconcile` fetches Autumn's authoritative balance (`autumnGetBalance`).
2. Calls `reconcileShadowBalance()` to inject an audit record and align local shadow balance.
3. If actual balance `<= 0`, enforces termination (V2).

### 5.7 Snapshot Quota Enforcement
**Flow:**
1. `ensureSnapshotCapacity(orgId, plan, deleteSnapshotFn)` is called before creating a snapshot.
2. If at plan limit, evicts the oldest paused snapshot, calls the provider to delete it, and clears the DB reference.
3. Snapshots are not credit-billed; they are bounded by count + retention limits.

---

## 6. Acceptance Gates

- [x] Gating enforced via `packages/services/src/billing/gate.ts` in both Web and Gateway session creation paths.
- [x] BullMQ repeatable jobs drive metering/outbox/grace/reconcile (no `setInterval` billing loops).
- [x] LLM spend sync uses LiteLLM Admin REST API and per-org cursors (no shared DB schema coupling).
- [x] LLM spend ingestion uses `bulkDeductShadowBalance()` to avoid `FOR UPDATE` contention per log line.
- [x] V1 overage enforcement removed; V2 termination is the only enforcement path.

---

## 7. Known Limitations

- Billing tokens (`packages/shared/src/billing/billing-token.ts`) are not used for Gateway WebSocket auth (they remain sandbox-auth focused and are currently minimally wired).
- Outbox retries/backoff are persisted on `billing_events` rows (BullMQ schedules the tick; per-event backoff is DB-driven, not per-event BullMQ delayed jobs).
<<< END NEW: docs/specs/billing-metering.md >>>

<<< BEGIN NEW: docs/specs/llm-proxy.md >>>
# LLM Proxy - System Spec

## 1. Scope & Purpose

### In Scope
- **Strict key lifecycle:** per-session virtual key generation with dynamic `max_budget` enforcement and best-effort synchronous revocation on session termination.
- Key scoping model: team = org, user = session.
- LiteLLM admin API integration contract (endpoints called, auth model, URL rules).
- Spend tracking ingestion via LiteLLM Admin REST API (see `billing-metering.md` for metering policy).
- Environment configuration (`LLM_PROXY_URL`, `LLM_PROXY_MASTER_KEY`, `LLM_PROXY_KEY_DURATION`, etc.).
- How providers (Modal, E2B) pass the virtual key to sandboxes.

### Out of Scope
- LiteLLM service internals (model routing config, caching, rate limiting) - external dependency.
- Billing policy and credit gating - see `billing-metering.md`.
- Sandbox boot mechanics - see `sandbox-providers.md`.
- Session lifecycle policy - see `sessions-gateway.md`.
- Any raw cross-schema reads into LiteLLM's internal database schema (deprecated and removed).

### Mental Model

The LLM proxy is an external LiteLLM service. Proliferate integrates with it to achieve:
- **Security:** sandboxes never receive real provider API keys; they receive per-session virtual keys.
- **Cost isolation:** every LLM request is attributed to an org (team) + session (user) in LiteLLM spend logs.
- **Financial circuit breaking:** keys are minted with a `max_budget` ceiling so LiteLLM can reject spend even between spend-sync cycles.
- **Post-session containment:** when a session ends, its key is revoked immediately (best-effort) to reduce key exfiltration windows.

---

## 2. Core Concepts

### Virtual Keys (LiteLLM)
We use LiteLLM virtual keys (free tier), not enterprise JWT auth. The master key is only used server-side for admin calls and never enters the sandbox.

### Key Alias = Session ID
Keys are created with `key_alias = sessionId`, so we can revoke keys by alias without storing raw key material.

### Dynamic Max Budget
When billing is enabled, session creation converts the org's current shadow balance to USD and passes it as `max_budget` when generating the virtual key:
- `budgetUsd = max(0, shadow_balance * 0.01)`

This acts as a circuit breaker against runaway spend between spend-sync cycles.

### Admin URL vs Public URL
- Admin calls use `LLM_PROXY_ADMIN_URL || LLM_PROXY_URL` (normalized: trim trailing `/` and optional `/v1`).
- Sandboxes receive `LLM_PROXY_PUBLIC_URL || LLM_PROXY_URL` as their `ANTHROPIC_BASE_URL`.

---

## 3. File Tree

```text
packages/shared/src/
`-- llm-proxy.ts                        # generateVirtualKey(), revokeVirtualKey(), ensureTeamExists()

packages/services/src/sessions/
`-- sandbox-env.ts                      # computes maxBudget + injects LLM key

packages/services/src/billing/
`-- litellm-api.ts                      # LiteLLM Admin REST wrapper (/spend/logs/v2)

apps/worker/src/billing/
`-- worker.ts                           # BullMQ LLM spend sync jobs (per-org fan-out)

packages/shared/src/providers/
|-- modal-libmodal.ts                   # passes proxy env vars to sandbox
`-- e2b.ts                              # passes proxy env vars to sandbox
```

---

## 4. Subsystem Deep Dives

### 4.1 Virtual Key Generation & Budgeting
**Flow:**
1. `buildSandboxEnvVars()` determines whether proxy mode is enabled (`LLM_PROXY_URL`).
2. If proxy mode is enabled, it computes `maxBudget` when billing is enabled:
- reads org shadow balance
- converts credits -> USD (`credits * 0.01`)
3. Calls `generateSessionAPIKey(sessionId, orgId, { maxBudget })`.
4. `generateSessionAPIKey()` ensures the LiteLLM team exists (`ensureTeamExists(orgId)`), then calls `POST /key/generate` with:
- `team_id = orgId`
- `user_id = sessionId`
- `key_alias = sessionId`
- `duration = LLM_PROXY_KEY_DURATION` (default `24h`)
- `max_budget = maxBudget` (when present)

### 4.2 Synchronous Revocation (Best-Effort)
**Goal:** if a key is exfiltrated from a sandbox, it should be unusable after the session ends.

**Implementation:**
- `revokeVirtualKey(sessionId)` calls `POST /key/delete` with `{ key_aliases: [sessionId] }`.
- 404 is treated as success (already deleted).
- Revocation is wired best-effort into session termination paths (pause/finalize/enforcement/migration).

### 4.3 Spend Logs
Spend ingestion is done via the LiteLLM Admin REST API (`/spend/logs/v2`) and processed by the billing worker. See `billing-metering.md` section 5.3 for ingestion and cursor semantics.

---

## 5. Security & Auth Constraints

- **Master key isolation:** `LLM_PROXY_MASTER_KEY` is only used for backend admin calls; it must never be passed to sandboxes.
- **Circuit breaker:** `max_budget` is the zero-trust safeguard against runaway spend inside the sandbox.

---

## 6. Environment Configuration

| Env Var | Required | Purpose |
| --- | --- | --- |
| `LLM_PROXY_URL` | No | Public base URL of the proxy. Enables proxy mode if set. |
| `LLM_PROXY_PUBLIC_URL` | No | Optional override for the URL sandboxes should use. |
| `LLM_PROXY_ADMIN_URL` | No | Optional admin URL for key/team/spend endpoints. |
| `LLM_PROXY_MASTER_KEY` | If proxy on (server admin) | Bearer token for LiteLLM admin API. |
| `LLM_PROXY_KEY_DURATION` | No | Fallback TTL (default `24h`). Keys are revoked earlier on session end. |
| `LLM_PROXY_REQUIRED` | No | If true, session creation fails when proxy is unset. |

---

## 7. Acceptance Gates

- [x] Per-session virtual keys include `key_alias=sessionId` and `max_budget` when billing is enabled.
- [x] Best-effort `POST /key/delete` is invoked during session termination paths.
- [x] Spend log ingestion uses LiteLLM Admin REST API (no raw SQL reads into LiteLLM DB schema).

---

## 8. Known Limitations

- Revocation is best-effort and currently lives in a few termination code paths (not a single centralized "session ended" hook). If a new termination path is added, it must also revoke the key.
- `max_budget` is set at session start from shadow balance. It is not updated mid-session.
<<< END NEW: docs/specs/llm-proxy.md >>>
