# Billing & Metering — System Spec

## 1. Scope & Purpose

### In Scope
- Billing state machine and enforcement per organization
- Shadow balance (local credit counter) and atomic deductions
- Compute metering for running sessions
- LLM spend sync from LiteLLM Admin API
- Credit gating for session lifecycle operations
- Billing event outbox posting to Autumn
- Reconciliation (nightly and on-demand fast reconcile)
- Trial credit provisioning and trial auto-activation
- Overage policy execution (`pause` vs `allow` with auto-top-up)
- Checkout flows for plan activation and credit purchases
- Snapshot quota and retention cleanup policies
- Atomic concurrent session admission enforcement
- Billing BullMQ workers and schedules

### Out of Scope
- LLM key minting/model routing (`llm-proxy.md`)
- Onboarding UX and org lifecycle (`auth-orgs.md`)
- Session runtime mechanics beyond billing contracts (`sessions-gateway.md`)
- Sandbox provider implementation details (`sandbox-providers.md`)

### Mental Model
Billing is a local-first control system with external reconciliation.

1. **Hot path is local and fail-closed.** Session start/resume decisions are made from org state + shadow balance in Postgres, not live Autumn reads.
2. **Ledger before side effects.** Usage is written locally as immutable billing events with deterministic idempotency keys, then posted to Autumn asynchronously.
3. **State machine drives access.** `billingState` controls whether new sessions are blocked and whether running sessions must be paused.
4. **Two independent cost streams, one balance.** Compute and LLM usage both deduct from the same `shadowBalance` and Autumn `credits` feature.
5. **Enforcement is pause-first, not destructive.** Credit enforcement attempts to preserve resumability via pause/snapshot flows.

### Things Agents Get Wrong
- Autumn is not part of the session start/resume gate; `checkBillingGateForOrg` is local (`packages/services/src/billing/gate.ts`).
- The shadow balance can be negative; overdraft is allowed briefly and then enforced (`packages/services/src/billing/shadow-balance.ts`).
- `trial` depletion transitions directly to `exhausted`; only `active` enters `grace` (`packages/shared/src/billing/state.ts`).
- `session_resume` skips the minimum-credit and concurrent-limit checks; it still enforces state-level blocking (`packages/shared/src/billing/gating.ts`).
- Gate concurrency checks are advisory; authoritative concurrent-limit enforcement happens at session insert under advisory lock (`packages/services/src/sessions/db.ts`).
- Trial/unconfigured orgs still get billing events inserted (`status: "skipped"`) for idempotency safety (`packages/services/src/billing/shadow-balance.ts`).
- LLM per-org sync jobs are not enqueue-deduped by `jobId`; idempotency is at billing-event level (`apps/worker/src/jobs/billing/llm-sync-dispatcher.job.ts`).
- Grace with `NULL graceExpiresAt` is treated as expired (fail-closed) (`packages/services/src/orgs/db.ts`, `packages/shared/src/billing/state.ts`).
- Billing feature flag off (`NEXT_PUBLIC_BILLING_ENABLED=false`) disables both gate enforcement and billing workers.
- `cli_connect` exists as a gate operation type but currently has no direct caller in runtime flows.

---

## 2. Core Concepts

### Autumn
External billing provider for subscriptions, checkout, and authoritative feature balances.
- Used in checkout, outbox posting, trial activation, and reconciliation.
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
- States: `unconfigured`, `trial`, `active`, `grace`, `exhausted`, `suspended`.
- `exhausted` and `suspended` require pause enforcement for running sessions.
- Reference: `packages/shared/src/billing/state.ts`

### Billing Event Ledger + Outbox
`billing_events` is both immutable local usage ledger and outbox queue.
- Events are inserted first, then posted to Autumn later.
- Retry/backoff and permanent-failure signaling are outbox responsibilities.
- Reference: `packages/services/src/billing/outbox.ts`

### Overage
Optional auto-top-up behavior when credits go negative.
- `pause`: fail-closed enforcement.
- `allow`: attempt card charge in fixed packs with guardrails.
- Reference: `packages/services/src/billing/auto-topup.ts`

### Reconciliation
Corrects drift between local shadow balance and Autumn balances.
- Nightly full reconcile + on-demand fast reconcile.
- Reconciliation writes auditable records.
- Reference: `apps/worker/src/jobs/billing/reconcile.job.ts`, `apps/worker/src/jobs/billing/fast-reconcile.job.ts`

---

## 5. Conventions & Patterns

### Do
- Deduct credits only via `deductShadowBalance` / `bulkDeductShadowBalance`.
- Use deterministic idempotency keys:
  - Compute interval: `compute:{sessionId}:{fromMs}:{toMs}`
  - Compute finalization: `compute:{sessionId}:{fromMs}:final`
  - LLM event: `llm:{requestId}`
- Keep billing gate checks in service-layer gate helpers (`assertBillingGateForOrg`, `checkBillingGateForOrg`).

### Don’t
- Don’t call Autumn in session start/resume hot path.
- Don’t update `shadowBalance` directly from route handlers.
- Don’t bypass admission guard for billable session creation paths.

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
- A compute interval is billable at most once by deterministic idempotency key.
- Metering skips intervals under `METERING_CONFIG.minBillableSeconds`.
- Dead-sandbox finalization bills only through last-known-alive bound, not detection time.
- Dead sandboxes are transitioned to `paused` with `pauseReason: "inactivity"` (resumable behavior).

**Rules**
- Metered time boundary moves forward only after deduct attempt.
- Idempotency correctness is more important than real-time boundary smoothness.

### 6.2 Shadow Balance + Atomic Ledger Writes — `Implemented`

**Invariants**
- Deductions are atomic with event insert in one DB transaction with `FOR UPDATE` org row lock.
- Global idempotency is enforced by `billing_event_keys` before event insert.
- Duplicate idempotency key means no additional balance movement.
- Trial/unconfigured deductions write events as `status: "skipped"` (idempotency preserved, outbox ignored).
- State transitions are derived from post-deduction balance (`active|trial` depletion, grace overdraw).
- Overdraft cap is enforced after deduction (`GRACE_WINDOW_CONFIG.maxOverdraftCredits`).

**Rules**
- `addShadowBalance` and `reconcileShadowBalance` are the only non-deduct balance mutation paths.
- All balance corrections must write reconciliation records.

### 6.3 Credit Gating — `Implemented`

**Invariants**
- Service gate is the authoritative API for billing admission checks.
- Gate denies on load errors (fail-closed).
- When billing feature flag is disabled, gate allows by design.
- `session_start` and `automation_trigger` enforce:
  - state allow-list
  - minimum credits (`MIN_CREDITS_TO_START = 11`)
  - concurrent session limit
- `session_resume` and `cli_connect` enforce state rules only (no minimum-credit/concurrency check).

**Rules**
- Grace expiry denial should trigger best-effort state cleanup (`expireGraceForOrg`).
- UI helper checks (`canPossiblyStart`) are informative only; gate methods remain authoritative.

### 6.4 Atomic Concurrent Admission — `Implemented`

**Invariants**
- Concurrent limit enforcement at session insert is serialized per org using `pg_advisory_xact_lock(hashtext(orgId || ':session_admit'))`.
- Count set for admission is `status IN ('starting','pending','running')`.
- Session row insert and concurrency check happen in the same transaction.
- Setup-session admission uses the same lock and counting rules.

**Rules**
- Fast gate concurrency checks are not sufficient by themselves.
- Any new session-create path must use admission-guard variants when billing is enabled.

### 6.5 LLM Spend Sync — `Implemented`

**Invariants**
- Dispatcher periodically enumerates billable orgs and enqueues per-org jobs.
- Per-org worker pulls spend logs from LiteLLM Admin REST API, sorts deterministically, and converts positive spend to ledger events.
- Deduction path is bulk and idempotent (`llm:{request_id}` keys).
- Tokenized zero/negative spend records are treated as anomaly logs and are not billed.
- Cursor advancement occurs after deduction attempt.

**Rules**
- Duplicate org jobs are tolerated; idempotency keys protect financial correctness.
- Cursor movement and deductions should be reasoned about as eventually consistent, not atomic.

### 6.6 Outbox Processing — `Implemented`

**Invariants**
- Outbox only processes events in retryable states with due retry time.
- Successful Autumn post marks event `posted` with provider response payload.
- Autumn denial attempts overage top-up before forcing `exhausted` enforcement.
- Retry metadata (`retryCount`, `nextRetryAt`, `lastError`) is updated on failure.
- Permanent failures emit alerting logs.

**Rules**
- `skipped` events are never part of outbox processing.
- Outbox idempotency must rely on the original event idempotency key.

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

### 6.8 Overage Auto-Top-Up — `Implemented`

**Invariants**
- Auto-top-up executes only when policy is `allow` and circuit breaker is not active.
- Top-up path is outside shadow-balance deduction transaction.
- Per-org auto-top-up concurrency is serialized via dedicated advisory lock (`:auto_topup`).
- Monthly counters are lazily reset by `overage_cycle_month`.
- Guardrails: per-cycle velocity limit, minimum interval rate limit, optional cap, card-decline circuit breaker.
- Successful charge credits are applied via `addShadowBalance` after lock transaction commit.

**Rules**
- Top-up sizing is deficit-aware (`abs(deficit) + increment`), then pack-rounded and cap-clamped.
- Circuit breaker paths should fail closed and trigger enforcement.

### 6.9 Trial Activation + Checkout — `Implemented`

**Invariants**
- Trial provisioning sets plan selection and initializes trial balance when org is `unconfigured`.
- Trial depletion can attempt automatic paid plan activation (`tryActivatePlanAfterTrial`).
- Plan activation and credit purchase may return checkout URLs or immediate success.
- Immediate purchases attempt local balance credit and then enqueue fast reconcile.
- Legacy `/api/billing/*` endpoints are adapters; oRPC router is the primary API surface.

**Rules**
- Billing settings and plan mutations require admin/owner permissions.
- Customer ID drift from Autumn responses must be persisted back to org metadata.

### 6.10 Snapshot Quota Management — `Implemented`

**Invariants**
- Snapshot creation is guarded by `ensureSnapshotCapacity` in pause/snapshot handlers.
- Eviction order is deterministic: expired snapshots first, then oldest snapshots by `pausedAt`.
- Global cleanup worker evicts expired snapshots daily with bounded batch size.
- Snapshot resources are treated as free within quota (no credit charge).

**Rules**
- Snapshot DB reference clearing requires successful delete callback contract.
- Current provider delete callback is a no-op placeholder; eviction still clears DB refs through that contract.

### 6.11 Reconciliation — `Implemented`

**Invariants**
- Nightly reconciliation runs against billable orgs with Autumn customer IDs.
- Fast reconcile is on-demand and keyed by `jobId = orgId` to avoid queue spam per org.
- Reconciliation writes balance deltas to audit table and updates `lastReconciledAt`.
- Drift thresholds produce tiered warn/error/critical signals.

**Rules**
- Reconciliation should correct drift, not be part of hot-path admission.
- Staleness detection is part of operational health, not user-facing gating.

### 6.12 Billing Worker Topology — `Implemented`

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

### 6.13 Billing Event Partition Maintenance — `Implemented`

**Invariants**
- `billing_event_keys` provides global idempotency independent of table partitioning strategy.
- Daily maintenance attempts next-month partition creation and safely no-ops if `billing_events` is not partitioned.
- Old idempotency keys are cleaned based on hot-retention window.
- Candidate partition detachment is currently signaled via logs (operator runbook), not auto-detached.

**Rules**
- Financial correctness must not depend on whether physical partitioning is enabled.

### 6.14 Removed Subsystems — `Removed`

- Distributed lock helper was removed; BullMQ queue/worker semantics are used.
- Billing token subsystem and `sessions.billing_token_version` were removed.

---

## 7. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `auth-orgs.md` | Billing ↔ Orgs | `orgs.getBillingInfoV2`, `orgs.initializeBillingState`, `orgs.expireGraceForOrg` | Billing state fields live on `organization` row. |
| `sessions-gateway.md` | Sessions → Billing | `assertBillingGateForOrg`, `checkBillingGateForOrg`, `getOrgPlanLimits` | Enforced in oRPC create, gateway HTTP create, setup-session flows, runtime resume path. |
| `sessions-gateway.md` | Billing → Sessions | `sessions.meteredThroughAt`, `sessions.lastSeenAliveAt`, session status transitions | Metering/enforcement update session lifecycle columns. |
| `sandbox-providers.md` | Billing → Providers | `provider.checkSandboxes`, snapshot/pause/snapshot+terminate methods | Used by metering liveness and enforcement pause/snapshot. |
| `llm-proxy.md` | LLM → Billing | LiteLLM Admin spend logs API | Billing consumes spend logs via REST, not cross-schema SQL. |
| `automations-runs.md` | Automations → Billing | `automation_trigger` gate operation | Automation-created sessions use the same gate contract. |

### Security & Auth
- Billing procedures are org-scoped and role-gated (admin/owner for settings and purchasing).
- Billing events intentionally avoid prompt payloads and secrets.
- Runtime auth remains session/gateway-token based; no billing token layer exists.

### Observability
- Billing modules emit structured logs with module tags (`metering`, `outbox`, `org-pause`, `llm-sync`, `auto-topup`, `reconcile`).
- Alert-like log fields are used for permanent outbox failures, drift thresholds, and LLM anomaly detection.
- Outbox stats are queryable via `getOutboxStats` for operational dashboards.

---

## 8. Acceptance Gates

- Behavior changes in billing code must update this spec’s invariants in the same PR.
- Keep this spec implementation-referential; avoid static file-tree or schema snapshots.
- New billable admission paths must explicitly call billing gate helpers and admission guards.
- New balance mutation paths must go through existing shadow-balance service functions.
- New asynchronous billing jobs must define idempotency and retry semantics before merging.
- Update `docs/specs/feature-registry.md` when billing feature status or ownership changes.

---

## 9. Known Limitations & Tech Debt

### Behavioral / Financial Risk
- [ ] **Enforcement retry gap (P0)** — `enforceCreditsExhausted` logs per-session pause failures but does not queue targeted retries; sessions can remain running until another enforcement cycle catches them (`packages/services/src/billing/org-pause.ts`).
- [ ] **LLM cursor update is not atomic with deduction (P1)** — cursor advance happens after `bulkDeductShadowBalance`, so worker crashes can replay logs (idempotent but noisy) (`apps/worker/src/jobs/billing/llm-sync-org.job.ts`).
- [ ] **Outbox uses org ID as Autumn customer ID (P1)** — `autumnDeductCredits(event.organizationId, ...)` assumes customer ID equals org ID; this is brittle if Autumn customer IDs diverge (`packages/services/src/billing/outbox.ts`).

### Reliability / Operational Risk
- [ ] **Metered-through crash window (P2)** — session `meteredThroughAt` update is separate from deduction transaction; idempotency prevents overcharge but can cause replay noise (`packages/services/src/billing/metering.ts`).
- [ ] **LLM dispatcher has no enqueue dedupe by org (P2)** — multiple jobs for same org can coexist under backlog conditions; correctness depends on idempotency keys (`apps/worker/src/jobs/billing/llm-sync-dispatcher.job.ts`).
- [ ] **Grace-null behavior is implicit (P2)** — `graceExpiresAt IS NULL` is treated as immediately expired (fail-closed) without explicit schema-level guardrails (`packages/services/src/orgs/db.ts`, `packages/shared/src/billing/state.ts`).

### Data Lifecycle / Drift
- [ ] **Partition archival remains operator-driven (P1)** — maintenance logs detachment candidates but does not auto-archive old partitions (`apps/worker/src/jobs/billing/partition-maintenance.job.ts`).
- [ ] **Snapshot provider deletion is placeholder (P2)** — provider delete hook is no-op until provider APIs exist (`packages/services/src/billing/snapshot-limits.ts`).
- [ ] **Fast reconcile trigger coverage is narrow (P2)** — direct enqueue currently happens in billing purchase/activation routes; other drift-inducing paths rely on nightly reconcile unless additional triggers are added (`apps/web/src/server/routers/billing.ts`).
