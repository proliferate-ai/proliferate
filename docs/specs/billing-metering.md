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
