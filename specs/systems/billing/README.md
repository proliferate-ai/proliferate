# Billing

Status: current (grade B). System spec in the Organization Standard anatomy. The laws below were lifted from the retired target document [`specs/systems/billing/deep-dive.md`](deep-dive.md) (now a pointer) and re-verified against `main` after the 2026-08-25 cull. Corridor IDs (A/N/M/T, B/E/W/U) are stable; tests reference them by name.

## 1. Purpose

Billing owns the money math for managed compute and managed LLM usage: who pays, what a usage segment costs, how grants are consumed, when overage is exported to Stripe, and every enforcement decision that follows from a balance or a limit. It never opens or closes a provider binding, never owns a navigation surface, and never decides membership.

**Ruled 2026-08-25 (Core Architecture §10, the three-way split):**

1. **Personal-class usage fencing: KEEP.** Epochs, binding fences, freshness
   floors and resume acceptance are essential complexity pinned by race
   suites; never delete-and-rebuild.
2. **Task-class segments: NEW SIMPLE PATH** (not yet built). One segment per
   task environment: open at provision, close at terminal, run-tagged. No
   fencing.
3. **Budgets: REBUILD as the run-envelope primitive** (not yet built).
   Envelopes on runs, attenuated down spawn trees, enforced at the billing
   gate, the model gateway and the integration gateway. `billing_budget_limit`
   (org/user × compute/llm × day/month) is the predecessor and stays until the
   envelope lands.

> [!decision] PABLO DECIDES: envelope cutover shape.
> Data preservation is not a constraint (ruling 2026-08-25), so the envelope
> rebuild may drop `billing_budget_limit` outright rather than dual-write.
> Options: (a) drop the table and the org **Usage & Limits** editor together
> when envelopes ship — recommended; (b) keep org/user caps as a *default
> envelope* source so admin-set caps seed every run's envelope. (b) is the
> better product; (a) is the smaller PR. Recommendation: ship (a) now, add
> (b) as the first envelope follow-up.

## 2. Owned state

Only billing writes these tables ([`db/models/billing.py`](../../../server/proliferate/db/models/billing.py)):

| Table | Meaning |
| --- | --- |
| `billing_subject` | The payer: `personal` (`user_id`) or `organization` (`organization_id`), mutually exclusive by check constraint; Stripe customer id; overage preference and org/month cap. |
| `billing_subscription` | Projection of the Stripe subscription (status, period, item ids, seat quantity). Stripe is the authority. |
| `billing_hold` | Active spend holds (`payment_failed`, admin). |
| `billing_grant` / `billing_grant_consumption` / `billing_usage_cursor` | Compute-hour grants, their consumption per segment slice, and the per-segment accounting cursor. |
| `billing_usage_export` / `billing_overage_remainder` | Overage slices exported as Stripe meter events (idempotency-keyed) and the per-period fractional-cent remainder. |
| `billing_entitlement` | Operator entitlements (unlimited, legacy). |
| `billing_seat_adjustment` | Queued Stripe seat-quantity convergence rows. |
| `billing_decision_event` | Audit receipt for every enforcement decision, including refused cents. |
| `billing_budget_limit` | Org-scoped caps (see ruling 3). |
| `free_cloud_allocation` | Anti-abuse reservation keyed on GitHub identity + period. |
| `usage_segment` | The compute meter: seconds per environment binding, attributed to (subject, user). |
| `webhook_event_receipt` | `(provider, event_id)` dedup receipts for Stripe (and formerly E2B). |

The managed-LLM meter `agent_llm_usage_event` is written by `agent_auth`'s usage import and only *read* here (see Fences).

## 3. Public surface

Routes (mounted under `/v1` by [`main.py`](../../../server/proliferate/main.py)):

```text
GET  /billing/plan · /billing/cloud-plan · /billing/overview
GET  /billing/usage/summary · /billing/usage/timeseries · /billing/llm-balance
POST /billing/cloud-checkout · /billing/refill-checkout · /billing/customer-portal
POST /billing/overage-settings
POST /billing/webhooks/stripe
POST /billing/team-checkout · GET /billing/team-checkout/current
POST /billing/team-checkout/{intent_id}/cancel
```

Owner-scoped reads default to the personal owner and use an organization only when selected and authorized; the usage summary is the current user's usage inside the selected owner, not aggregate org usage. Org aggregation and the limits editor are served by `organizations` (`/organizations/{id}/usage/**`, `/limits`) on top of billing's store reads.

Python surface (MANIFEST `public_surface`): `proliferate.server.billing.api`, `proliferate.server.billing.models`. Other systems may additionally call the named orchestration seams listed in Fences (`subjects`, `seat_reconciliation`, `authorization`, `runtime_usage`); anything else in the package is internal.

SDK: [`cloud/sdk/src/client/billing.ts`](../../../cloud/sdk/src/client/billing.ts), [`cloud/sdk-react/src/hooks/billing.ts`](../../../cloud/sdk-react/src/hooks/billing.ts).

## 4. Consumes

- `organizations`: active membership count (seats) and membership lookup to
  resolve the payer (`resolve_billing_subject_id_for_user`); org profile for
  team checkout.
- `accounts`: the acting `User`; linked GitHub identity as the free-tier
  anti-abuse key.
- `agent_auth`: `agent_llm_usage_event` rows (read) and the virtual-key
  `budget_status` flips (`exhausted` / `limit_reached`) it owns.
- Vendor leaf [`integrations/stripe`](../../../server/proliferate/integrations/stripe):
  checkout sessions, portal, subscription items, meter events, webhook
  signature verification.
- `permissions.py`: `OwnerContext` / `CurrentOrgUser` request deps.
- Capabilities: `lib/infra/time`, Sentry `report_critical` for page-worthy
  drops.
- Config: `pro_billing_enabled`, `cloud_billing_mode ∈ {off, observe,
  enforce}`, `run_background_workers`, Stripe keys/prices, cap defaults
  ([`constants/billing.py`](../../../server/proliferate/constants/billing.py)).

## 5. Laws

**A — attribution & accounting**

- **A1** The organization always pays; spend is attributed per user. Every
  `usage_segment` and `agent_llm_usage_event` names one `billing_subject_id`
  and, separately, the acting `user_id`. Every account gets a default org, so
  "personal" is a one-member org at the product layer; the `personal`
  subject kind survives for pre-cutover attribution paths (gap B1).
- **A2** No orphaned spend: every closed segment is grant-covered, exported
  (pending or sent), or explicitly written off — no silent fourth bucket.
- **A3** No double-counting: webhook dedup by `(provider, event_id)`; grant
  consumption keyed by `(subject, segment, from, until)` in one row-locked
  transaction; each export carries a deterministic `idempotency_key`.
- Compute is recorded in seconds, LLM usage in USD; the meters are never
  summed. Usage reads aggregate the raw ledgers; there is no rollup table.

**M — money-in (Stripe is the authority; local tables are projections)**

- **M1** Webhooks are signature-verified (HMAC-SHA256, 300s tolerance, 401
  before parsing), claimed on a receipt before dispatch (`processed` skips,
  concurrent `processing` 409s, handler exception marks `failed` and stays
  re-claimable), and converge out of order through
  `upsert_stripe_subscription_record` keyed on `stripe_subscription_id`.
- **M2** Grants are created exactly once per entitling event via a
  deterministic `source_ref`; free-tier grants dedupe on the linked GitHub
  identity (not the account) through `free_cloud_allocation`.
- **M2a** Only a period boundary mints the period allowance:
  `invoice.paid` grants only for `subscription_create` / `subscription_cycle`;
  a non-boundary invoice still clears a payment-failed hold; an unknown or
  absent `billing_reason` pages rather than logging. Because the prorated
  seat grant runs inside the reconciler pass, any deployment with
  `PRO_BILLING_ENABLED=true` must also run the reconciler.
- **M3** Seat count converges to entitled membership from both drift
  directions through queued `billing_seat_adjustment` rows, never a
  synchronous Stripe call on the membership-change path; a mid-period seat
  add earns one prorated compute grant; Stripe failures retry up to
  `BILLING_SEAT_ADJUSTMENT_MAX_ATTEMPTS` then go terminal.
- **M4** Overage exports only in-period and only with `overage_enabled`;
  pre-period usage drains grants but never bills; at the org/month cap
  (default $50) the remainder is neither exported nor billed — compute pauses
  and write-off is operator-only; each closed segment rounds uncovered
  seconds up to whole cents with no fractional carry across segments.
- Team checkout: a pending `organization_checkout_intent` is idempotency
  keyed with a 24h expiry; activation re-fetches the subscription,
  cross-checks session metadata, refuses non-`active`/`trialing`, then
  activates the org, stages invites and enrolls the agent gateway; a
  redelivered webhook for a non-pending intent is a no-op.

**N — enforcement**

- **N1** A held or exhausted subject cannot START compute: in enforce mode
  `assert_cloud_sandbox_resume_allowed[_for_owner]` runs before any provider
  I/O or new-row INSERT and raises a typed 402
  (`billing_credits_exhausted` | `billing_start_blocked`) after committing its
  own `billing_decision_event`.
- **N2** A held or over-limit subject cannot CONTINUE: the reconciler pauses
  open over-limit segments within one 15-minute pass under the same
  per-sandbox lock the live path uses. **The reconciler is deleted by cull
  PR-Ab** (it imports the dark cloud materialization). See Known gaps.
- **N3** `limit_reached` and `exhausted` are distinct; purchasing credit never
  bypasses an active limit (`agent_auth` owns the key flip; billing owns the
  verdict).
- **N4** Every applicable enabled limit is evaluated independently — no
  raw-tightest masking; `resolve_effective_limit` is display-only.
- **N5** Denials are never cached; a fixed subject succeeds within one cycle.
- **N6** A billing-state read failure on an enforcement path fails closed as
  a typed `billing_unavailable` 503 with a durable receipt (all-zero subject
  sentinel when the subject itself did not resolve, 5s bounded receipt
  write) and a `report_critical` alert — never an implicit allow.

**T — truth surfaces**

- **T1** The UI never fabricates plan or balance on a failed read
  (`BillingSettingsSurface` preserves loading/error/disabled/absent states).
- **T2** Out-of-credit at spend time is typed and actionable on every surface,
  never raw provider noise; LLM exhaustion disables keys so the refusal lands
  at mint/launch, not mid-session.

## 6. Emits

- `billing_decision_event` rows — the audit trail other systems and operators
  read (`decision_type`, `mode`, `reason`, `refused_cents`).
- HTTP 402 bodies with stable `code` / `decision_type` / `reason` /
  `remaining_seconds`; HTTP 503 `billing_unavailable`.
- Sentry `report_critical` on: unknown invoice reason, subject-unresolved
  drops, read failures on the gate
  ([`webhook_drops.py`](../../../server/proliferate/server/billing/webhook_drops.py)
  names every drop reason).
- Seat-adjustment and grant rows consumed by `agent_auth` (LLM seat pool
  allocation on `invoice.paid`).

## 7. Fences

- **Environments/lifecycle own the segment boundaries.** Provisioning opens a
  segment in the same transaction as a new binding; pause/timeout/kill/quota
  close it. Billing owns what it costs. The current opener/closer seams are
  [`runtime_usage.py`](../../../server/proliferate/server/billing/runtime_usage.py)
  and the fencing primitives in
  [`db/store/billing_runtime_usage.py`](../../../server/proliferate/db/store/billing_runtime_usage.py);
  their only callers today are the dark `cloud/` systems being deleted by
  PR-Ab — the environments rebuild re-consumes them (ruling 1).
- **`agent_auth` / model gateway** own LLM key issuance, virtual-key budgets,
  `agent_llm_usage_event` writes and top-ups; billing owns the credit ledger
  and the org-limit verdict those act on.
- **`organizations`** own membership, roles, invitations and the
  `/organizations/{id}/usage|limits` admin routes; billing only reads active
  membership to converge seats and resolve the payer, and exposes
  `maybe_create_organization_seat_adjustment` for membership changes.
- **`accounts`** own the user and the GitHub identity; billing keys anti-abuse
  on it but never writes it.
- **Settings surface** (client composition) owns navigation; billing owns
  its panes' truth.

## 8. Code map

```text
server/proliferate/server/billing/**            MANIFEST.toml → this spec
  api.py · models.py · errors.py                public HTTP + response models
  authorization.py                              N1/N5/N6 start gate, 402/503 contract
  snapshots.py · snapshot_state.py · overview.py subject snapshot (plan, balances, holds)
  usage.py · budget_limits.py                   owner-scoped usage reads; pure window math
  accounting.py · accounting_pass.py            A2/A3/M4 accounting walk + exports
  seats.py · seat_reconciliation.py             M3
  stripe_webhooks.py · webhook_drops.py         M1/M2/M2a + named drop reasons
  checkout.py · pricing.py · policy.py          money-in flows, plan policy
  runtime_usage.py                              segment open/close seam (see Fences)
  reconciler.py                                 N2 (deleted by cull PR-Ab)
  team_checkout/**                              team checkout + activation
  domain/{accounting,plans,pricing,seats,webhooks}.py  pure rules
server/proliferate/db/models/billing.py
server/proliferate/db/store/billing{,_accounting,_runtime_usage,_seats,_subjects,_subscriptions}.py
server/proliferate/constants/billing.py
server/proliferate/integrations/stripe/**       vendor leaf (consumed)
cloud/sdk/src/client/billing.ts · cloud/sdk-react/src/hooks/billing.ts
apps/packages/product-client/src/components/settings/panes/billing/**
apps/packages/product-client/src/components/settings/panes/{OrganizationBudgetsPane,OrganizationLimitsEditor}.tsx
apps/packages/product-client/src/components/app/sidebar/SidebarConsumptionCard.tsx
```

Background: the reconciler is an in-process asyncio loop started by `main.py` (`start_billing_reconciler`) when `run_background_workers` and `cloud_billing_mode != off`; the accounting pass runs at the top of each reconciler pass. There is no Celery task for billing.

## 9. Proof

Named corridors and their pins (all under `server/tests/`):

- **B2/B3/B4** accounting idempotency, period split, export retry —
  `integration/test_billing_accounting_boundaries.py`,
  `integration/test_billing_accounting.py`,
  `integration/test_billing_accounting_pass_repeat.py`.
- **E1** exhausted → 402 with zero provider calls —
  `integration/test_billing_start_block_paging.py`,
  `integration/test_cloud_sandbox_ensure_billing_gate.py` (deleted with PR-Ab;
  the environments rebuild must re-pin E1).
- **E2/E3/E4** limit enforcement —
  `integration/test_billing_limit_enforcement_compute.py`,
  `integration/test_billing_limit_enforcement_llm.py`.
- **E6** fail-closed read errors —
  `integration/test_billing_fail_closed_read_errors.py`.
- **W1–W4** webhooks and seats — `integration/test_stripe_webhooks.py`,
  `integration/test_billing_seat_adjustment.py`,
  `integration/test_billing_invoice_period_boundary.py`,
  `integration/test_stripe_subscription_deleted_hold.py`,
  `integration/test_stripe_webhook_drop_visibility.py`.
- Attribution and money-in under org-pays —
  `integration/test_billing_compute_attribution.py`,
  `integration/test_billing_segment_org_attribution.py`,
  `integration/test_billing_org_pays_money_in.py`,
  `integration/test_billing_read_surface_org_pays.py`,
  `integration/test_billing_store_invariants.py`,
  `integration/test_billing_free_trial_allocation.py`,
  `integration/test_billing_overage_cap_receipts.py`.
- Team checkout — `unit/test_billing_team_checkout_activation.py`,
  `unit/test_organization_team_checkout_*.py`.
- Pure rules — `unit/test_billing_domain.py`, `unit/test_billing_service_policy.py`,
  `unit/test_billing_truth.py`, `unit/test_stripe_billing.py`.
- **U1/U2** — `BillingSettingsSurface.test.tsx`, `SidebarConsumptionCard.test.tsx`.

## Known gaps / follow-ups

- **N2 has no CONTINUE gate after PR-Ab** deletes the reconciler; the
  accounting pass and the prorated seat grant (M2a invariant) ride the same
  loop. Until the environments rebuild, an over-limit subject is only stopped
  at the next START. Owner: environments rebuild (task-class simple path).
  > [!decision] PABLO DECIDES: keep the accounting pass alive as its own
  > scheduler entry (a ~40-line Celery beat task calling
  > `run_billing_accounting_pass`) before the rebuild, or accept no exports /
  > no seat grants until then. Recommendation: the beat task — money-out
  > should not wait on the environments rebuild.
- **B1** `personal` subject kind and the org-only subject cutover (#1564)
  remain deferred; with the data-preservation ruling this can now be a
  drop-and-recreate migration rather than a backfill.
- **E5** no dedicated never-cached-denial test; **U3** upgrade/refill state
  components not built; **M2** no live Stripe-TEST end-to-end proof.
- Web and Mobile do not expose the org **Usage & Limits** pane.
- Attribution tags (`run_id`, definition) on segments and spend — the
  workforce-era invoice — are a seam change with `runs` when that spec lands.
