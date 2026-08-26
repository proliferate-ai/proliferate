# Billing

> **Superseded (2026-08-25).** The billing system spec now lives at
> [`specs/codebase/systems/product/billing/README.md`](../codebase/systems/product/billing/README.md)
> (Organization Standard anatomy; laws A/M/N/T and the corridor IDs carried
> over verbatim and re-verified after the cull). This file is retained for
> its inbound links and the historical corridor narrative; do not extend it.
> Sections referencing `reconciler.py`, `cloud/materialization`,
> `cloud/cloud_sandboxes` and the E2B webhook lane describe code deleted by
> the cull (PR #2222 and PR-Ab).

Status: target. This document describes the accepted destination for
billing. The body is written in the ideal state. Every difference from
`main` today is listed in [Current gaps](#current-gaps); the list shrinks as
follow-up PRs land, and the label comes off when it is empty.

Billing owns the shared accounting, authorization, and product contracts
for managed compute and managed LLM usage: plan/subscription state, grants
or credit balances, holds, seats, two independent usage ledgers, and
optional organization budget limits. Billing is reused by several product
systems; it does not own their navigation or workflow-specific
presentation.

Fences, one owner per concern:

- **Lifecycle owns the sandbox primitives; billing owns the math.**
  [sandbox-lifecycle.md](SANDBOX/lifecycle.md) names the events (create,
  resume, pause, kill) that open and close a `usage_segment`; this document
  owns what a segment costs, who it is attributed to, and every
  enforcement decision made from it. Lifecycle never computes a balance;
  billing never opens or closes a provider binding.
- Managed-LLM key issuance, budgets on the LiteLLM proxy, and the account
  model belong to [MODELS.md](MODELS.md); this document owns
  the credit ledger those budgets are rendered from and the org-limit
  enforcement that acts on it.
- Organization membership, roles, and invitations belong to the
  organizations platform; this document only reads active membership count
  to converge seats and to resolve who pays.

## Mental Model

```text
organization or personal billing subject (always the payer)
  ├── plan, subscription, grants or credit balances, and holds
  ├── seats: entitled membership <-> Stripe quantity, converged both ways
  ├── compute usage: seconds in usage_segment, attributed to (subject, user)
  ├── managed LLM usage: USD in agent_llm_usage_event, attributed to (subject, user)
  └── optional organization budget limits
        organization-wide and/or per-user, compute | llm, day | month (UTC)
                 |
        enforcement + APIs/SDK + UI
```

Compute seconds and LLM dollars are separate meters, never summed into one
number.

**The organization always pays; spend is attributed per user** (Pablo,
2026-07-28). Every `usage_segment` and `agent_llm_usage_event` names exactly
one `billing_subject_id` — the payer — and, separately, the acting
`user_id` for reporting and per-user budget limits. Solo work still bills an
org: every account gets a default organization
([`registration.py`](../../server/proliferate/server/organizations/registration.py)'s
`ensure_default_organization_for_account`, wired into signup in
[`membership_policy.py`](../../server/proliferate/server/organizations/membership_policy.py)),
so "personal" is a one-member organization, not a distinct payer kind at the
product layer. The personal `BillingSubject` kind still exists for
attribution paths that predate the default-organization cutover — see
[Current gaps](#current-gaps).

**The org-only subject target (#1564) is a later target, not the launch
contract.** [sandbox-lifecycle.md](SANDBOX/lifecycle.md#account-model) and
[MODELS.md](MODELS.md#account-model) settle the further ruling
that *orgs are the only billing subject*: no personal subject at all, one
sandbox per `(user, organization)` with `organization_id` NOT NULL, and the
payer derived from the org rather than stored. That is the accepted
destination for the subject model and those two documents own its migration
(backfill to each owner's default org, re-key uniqueness, drop the stored
subject column). It is explicitly OUT of launch scope (Pablo, ruling 3,
2026-07-28). Until it lands, the launch contract in this document is the
two-kind subject above — personal and organization, mutually exclusive,
payer resolved per attribution path by one membership lookup — and every law
below is stated against that current shape. The org-only cutover subsumes,
not contradicts, "the organization always pays": it removes the personal
fallback rather than changing who the payer is when an org exists.

## Durable State And Ownership

`billing_subject_id` is `personal` (`user_id` set, `organization_id` null)
or `organization` (`organization_id` set, `user_id` null), mutually
exclusive by check constraint
([`billing.py`](../../server/proliferate/db/models/billing.py)).
Every compute-attribution path resolves the payer from one membership
lookup (`resolve_billing_subject_id_for_user`,
[`billing_runtime_usage.py`](../../server/proliferate/db/store/billing_runtime_usage.py)):
a user under a current org membership bills the org subject; an org-less
user bills personal. Segment open, the live resume gate, and the reconciler
all call through this one resolution so attribution and enforcement scope
never disagree.

`free_cloud_allocation` is the anti-abuse reservation for personal compute
trials and managed-LLM free credits, deduped on allocation kind + linked
GitHub provider identity + period so another account cannot claim the same
free allocation. Owned by
[`billing_subjects.py`](../../server/proliferate/db/store/billing_subjects.py).

Compute is recorded in seconds in `usage_segment`; managed LLM usage in USD
in `agent_llm_usage_event`. Current usage reads aggregate these raw
ledgers; there is no rollup or materialized usage table. Materialization
opens exact-provider compute usage in the same transaction as a new
binding and idempotently reopens it after every successful resume;
provider created/resumed webhooks are advisory reinforcement, never the
sole opening authority. Pause, timeout, kill, quota enforcement, and
reconciliation close only the expected provider's segment inside the same
cloud-row-first transaction as the lifecycle state change, so a
replacement binding cannot inherit or lose another provider's accounting;
every close clamps `ended_at` to at least `started_at`. Recovery closes a
pre-existing null-attributed open segment under its unchanged unknown
identity (`binding_convergence`) before provider I/O; a non-null
conflicting provider id is left open with a durable receipt instead, since
that provider may still be live — duration is never reattributed across
provider ids. An already-destroyed row's later exact-provider terminal
evidence closes retained usage without reviving deletion state. The
provider-event boundary itself is documented by the usage-fencing primitives
in
[`sandbox-lifecycle.md`](SANDBOX/lifecycle.md#usage-fencing-the-billing-primitives)
(absorbed there from the retired `sandbox-provisioning.md` by #1564).

**A2 — no orphaned spend.** Every closed segment is grant-covered,
exported (pending or sent), or explicitly written off; there is no silent
fourth bucket. The accounting pass (below) walks every unaccounted range
per subject exactly once per cursor advance.

**A3 — no double-counting.** Webhook replay, accounting re-run, and export
retry are all idempotent: webhook dedup is a receipt keyed on
`(provider, event_id)` (`claim_webhook_event`,
[`billing_runtime_usage.py`](../../server/proliferate/db/store/billing_runtime_usage.py)),
grant consumption is keyed by
`(billing_subject_id, usage_segment_id, accounted_from, accounted_until)`
inside one row-locked transaction, and each usage export carries a
deterministic `idempotency_key` derived from that same tuple
([`accounting.py`](../../server/proliferate/server/billing/accounting.py)).
Pinned by
[`test_accounting_cursor_prevents_duplicate_consumption`](../../server/tests/integration/test_billing_accounting_boundaries.py).

Organizations may add limits over the existing rules:

```text
billing_budget_limit
  organization_id
  user_id             null = organization-wide; set = per-user
  kind                compute | llm
  window              day | month, calendar UTC
  cap_value           nonnegative seconds or USD according to kind
  enabled
```

**N4 — every applicable enabled limit is evaluated independently; no
tightest-cap masking.** A member breaches when ANY applicable enabled row
breaches, not just the row with the lowest raw `cap_value` — a per-user day
cap and an org month cap are different rates over different windows and
neither dominates. Both compute paths
([`reconciler.py`](../../server/proliferate/server/billing/reconciler.py)'s
`_resolve_compute_limit_pause`,
[`authorization.py`](../../server/proliferate/server/billing/authorization.py)'s
`_compute_budget_cap_breach`) and the LLM import path
([`usage_import.py`](../../server/proliferate/server/agent_auth/usage_import.py)'s
`_enforce_org_llm_limits`) check every enabled row before deciding.
Display-only,
[`resolve_effective_limit`](../../server/proliferate/server/billing/budget_limits.py)
returns one row (the raw-tightest, possibly across different windows) and
is explicitly documented as not an enforcement decision. Personal usage has
no personal `billing_budget_limit` row. The full-replacement admin API
accepts at most one row per user scope/kind/window — an API validation
rule, not a stronger claim about nullable DB uniqueness.

## Seats

**M3 — seat count converges to entitled membership from both drift
directions; a paying member is never stranded.** The entitled count is
`count_active_seats_for_billing_subject`
([`billing_seats.py`](../../server/proliferate/db/store/billing_seats.py)):
active `OrganizationMembership` rows for an org subject, or 1 for personal.
Stripe's subscription-item `quantity` converges to it asynchronously
through queued `BillingSeatAdjustment` rows — never a synchronous Stripe
call on the membership-change request path. A membership status change or
invitation accept
([`organizations/service.py`](../../server/proliferate/server/organizations/service.py))
calls
[`seat_reconciliation.py`](../../server/proliferate/server/billing/seat_reconciliation.py)'s
`maybe_create_organization_seat_adjustment`, staging a pending adjustment
deduped on a per-event `source_ref`; a subscription create/update from
Stripe calls `reconcile_initial_org_subscription_seats`, keyed on
`(subscription, period_start)` so a same-period reconcile reuses the row
instead of double-issuing. `process_pending_seat_adjustments`
([`accounting.py`](../../server/proliferate/server/billing/accounting.py)),
run at the top of every accounting pass, claims pending/`failed_retryable`
rows (`skip_locked`), calls `update_subscription_item_quantity` with an
idempotency key derived from the adjustment id and target quantity, then —
only for a mid-period seat add on an active membership at/after
`period_start`, and only if that membership has no same-period seat
decrease already recorded — issues one `pro_seat_proration` grant of
prorated compute-hours
([`domain/seats.py`](../../server/proliferate/server/billing/domain/seats.py)'s
`prorated_seat_grant_hours`). A Stripe error marks the row
`failed_retryable` up to `BILLING_SEAT_ADJUSTMENT_MAX_ATTEMPTS`, then
`failed_terminal`; a row that reconfirms it is already converged is marked
`succeeded` as a no-op rather than retried forever.

The $5/seat managed-LLM pool allocation (`PRO_LLM_ALLOCATION_USD_PER_SEAT`,
[`constants/billing.py`](../../server/proliferate/constants/billing.py))
and the $15/seat compute allocation
([`pricing.py`](../../server/proliferate/server/billing/pricing.py)'s
`compute_hours_per_seat`) grant once per paid period on `invoice.paid`,
keyed by `(subscription_id, period_start)` — reflecting the seat count
reconciled for that period. Only the *compute* allocation is topped up by
seat-adjustment grants for seats added mid-period; the LLM pool allocation
inserts `on_conflict_do_nothing` on its period key and the seat-adjustment
pass issues no LLM grant, so a seat added mid-period receives prorated
compute hours and no LLM allocation until the next renewal. That gap
predates the M2a boundary gate (the period grant never topped up either) and
is tracked, not fixed, here.

## Team checkout

A user with no organization starts a paid team directly from checkout
([`team_checkout/`](../../server/proliferate/server/billing/team_checkout/)).
`POST /billing/team-checkout` validates the team name, stages an
idempotency-keyed `CheckoutIntentRecord` (24h expiry), creates the org's
Stripe customer, and opens a subscription Checkout session (Pro monthly +
overage, seat quantity 1) tagged `purpose: team_subscription` with the
intent id. `checkout.session.completed` hands off to
[`activation.py`](../../server/proliferate/server/billing/team_checkout/activation.py)'s
`activate_team_checkout_from_stripe_session`, which re-fetches the
subscription, cross-checks session metadata against the subscription's own
before trusting it, refuses a non-`active`/`trialing` status, and only then
activates the org — staging invite emails and enrolling the agent gateway.
A re-delivered webhook for an intent already past `pending` is a no-op.

## Money-in

Stripe is the money authority; every local table is a projection, not an
independent ledger.

**M1 — webhooks are verified, deduped, and converge out-of-order.**
`construct_webhook_event`
([`integrations/stripe/webhooks.py`](../../server/proliferate/integrations/stripe/webhooks.py))
checks the HMAC-SHA256 signature within a 300s tolerance and 401s a
missing/invalid signature before the payload is parsed.
`handle_stripe_webhook`
([`stripe_webhooks.py`](../../server/proliferate/server/billing/stripe_webhooks.py))
claims a `WebhookEventReceipt` keyed on `(provider, event_id)` before
dispatch: `processed` skips, concurrently-`processing` 409s (retryable),
and a handler exception marks it `failed` (re-claimable), never processed.
`customer.subscription.*` and `invoice.paid` funnel through
`upsert_stripe_subscription_record`, keyed on `stripe_subscription_id`, so
replaying either in any order converges the row to Stripe's current state
instead of accumulating deltas. `customer.subscription.deleted`
distinguishes a voluntary cancel from dunning-driven deletion and only the
latter applies a payment-failed hold.

**M2 — grants are created exactly once per entitling event.** Every grant
carries a deterministic `source_ref` scoped to the entitling event:
`pro_period` keys on `(subscription_id, period_start_unix)`
([`domain/seats.py`](../../server/proliferate/server/billing/domain/seats.py)),
`refill_10h` keys on the checkout session id, and free-tier grants dedupe
through `free_cloud_allocation` on the linked GitHub identity, not the
account — a second account on the same GitHub identity gets no grant (see
[Current gaps](#current-gaps) for live-proof status). `ensure_billing_grant_record`
upserts idempotently on `source_ref`.

**M2a — only a period boundary mints the period allowance.** A `source_ref`
keyed on `period_start` is idempotent per period, but `invoice.paid` fires
for more than renewals: a mid-period seat change raises its own paid invoice
carrying a cloud subscription line with the period *unchanged*
(`billing_reason: subscription_update`, confirmed against live Stripe
2026-07-28; the wire shape is pinned in
`server/tests/integration/test_billing_invoice_period_boundary.py`). That
collided with the renewal's own `source_ref`, and because
the handler tops the existing row up, the larger seat count re-granted a
full seat-month for seats the seat-adjustment pass already covers pro rata.
So `_handle_invoice_paid` now grants only for
`BILLING_PERIOD_GRANT_INVOICE_REASONS` (`subscription_create`,
`subscription_cycle`) and drops anything else *before* the grant gate, so
"gate closed" keeps meaning a boundary invoice that paid and produced no
hours. A non-boundary invoice still clears a payment-failed hold: dunning
recovery settles on whatever invoice finally pays. A reason that is neither
a boundary reason nor a known non-period one — including the field being
absent — pages rather than logging at info, because this gate's failure
direction is a renewal that collects money and grants zero hours.

**Invariant this creates:** the full-period grant is gated on
`pro_billing_enabled` alone, but the prorated seat grant additionally
requires `run_background_workers` AND `cloud_billing_mode != off` (it runs
inside the reconciler's accounting pass). Before M2a the invoice top-up
accidentally masked that asymmetry; now a deployment with Pro pricing on,
the reconciler off, and seats added mid-period grants those seats *nothing*
until renewal. Any deployment running `PRO_BILLING_ENABLED=true` must also
run the billing reconciler.

**M4 — overage exports only in-period, only with `overage_enabled`;
pre-period usage drains grants but never bills.**
`account_usage_for_billing_subject`
([`accounting.py`](../../server/proliferate/server/billing/accounting.py))
walks unaccounted usage ranges, consumes grants oldest-expiring-first, and
exports the uncovered remainder only when `overage_enabled` AND a paid
subscription AND the slice starts at or after `period_start`; a
pre-`period_start` slice drains grants the same way but never exports. At
the org/month overage cap (default
`PRO_DEFAULT_OVERAGE_CAP_CENTS_PER_ORG_MONTH` = $50), the over-cap
remainder is neither exported nor billed — compute pauses
(`WORKSPACE_ACTION_BLOCK_KIND_CAP_EXHAUSTED`); write-offs are
operator-only, never automatic. Each closed segment rounds uncovered
seconds up to whole cents with no fractional carry across segments (ruled
2026-07-14). `send_pending_usage_exports` sends claimed exports as Stripe
meter events on each export's own `idempotency_key`: a terminal failure is
`failed_terminal` (no retry), a retryable Stripe error `failed_retryable`
for the next pass. Seat draining runs before usage accounting in the same
pass so per-seat grants land before that pass's usage is walked.

## Enforcement

**N1 — a held/exhausted subject cannot START compute; typed 402 before any
provider I/O.** In enforce mode, `assert_cloud_sandbox_resume_allowed`/
`_for_owner`
([`authorization.py`](../../server/proliferate/server/billing/authorization.py))
runs at the top of `connect_ready_sandbox`
([`connect.py`](../../server/proliferate/server/cloud/materialization/sandbox_io/connect.py))
and `ensure_cloud_sandbox_ready`
([`cloud_sandboxes/service.py`](../../server/proliferate/server/cloud/cloud_sandboxes/service.py)),
before either stages a provider call or a new-row INSERT, and raises
`CloudSandboxResumeBlockedError` (HTTP 402) on an active spend hold or
over-cap compute budget, committing its own audit `BillingDecisionEvent`
first (the caller rolls back its session on exception).

**N2 — a held/over-limit subject cannot CONTINUE; the reconciler pauses
within one pass, and a stray `resumed` webhook re-pauses and closes.** The
15-minute reconciler
([`reconciler.py`](../../server/proliferate/server/billing/reconciler.py))
lists every open segment, resolves its subject's live snapshot and any
breached limit, and pauses the provider sandbox
(`USAGE_SEGMENT_CLOSED_BY_QUOTA_ENFORCEMENT`) under the same per-sandbox
lock the live path uses. A `created`/`resumed` provider webhook landing on
an enforced spend hold is re-paused and closed by the webhook handler's own
billing check
(`webhooks/service.py` (deleted with the E2B webhook lane, cull part 1))
— a separate, narrower gate than the resume-path one. In the target state
it resolves the payer the same way segment attribution does and evaluates
budget caps as well as the hold, so an over-limit wake cannot stand until
the next reconciler pass; today it checks only `active_spend_hold` on the
personal subject — see [Current gaps](#current-gaps).

**N3 — `limit_reached` and `exhausted` are distinct; purchasing credit
never bypasses an active budget limit.**
`AGENT_GATEWAY_BUDGET_STATUS_*`
([`constants/agent_gateway.py`](../../server/proliferate/constants/agent_gateway.py))
has `ok`, `exhausted` (credit ran out), `limit_reached` (an admin cap
bound, regardless of credit). `_enforce_subject_exhaustion`
([`usage_import.py`](../../server/proliferate/server/agent_auth/usage_import.py))
never overwrites `limit_reached`; top-up reactivation
([`topups.py`](../../server/proliferate/server/agent_auth/topups.py))
only clears `exhausted`. Only `_enforce_org_llm_limits` clears
`limit_reached`, once every applicable limit passes and credit is positive.

**N5 — denials are never cached; a fixed subject succeeds within one
enforcement cycle.** The billing snapshot and resume gate read fresh state
every call. The adjacent gateway *access* cache (60s TTL,
[`gateway/service.py`](../../server/proliferate/server/cloud/gateway/service.py))
bounds destroy/recreate propagation and is not a billing decision cache.

**N6 — a billing-state read failure on an enforcement path fails closed,
with a durable receipt and an alert** (ruling, 2026-07-28). An unhandled
exception while resolving the billing snapshot propagates as a typed deny,
never an implicit allow — see [Current gaps](#current-gaps) for the
receipt/alert wiring this still needs.

## Truth surfaces

**T1 — the UI never fabricates plan or balance on a failed read.** Desktop
and Web reuse
[`BillingSettingsSurface`](../../apps/packages/product-client/src/components/settings/panes/billing/BillingSettingsSurface.tsx),
which reads the selected owner's plan and both unit balances independently
and preserves loading, error, deployment-disabled, and absent-data states —
never a default plan, active status, zero balance, or sample compute
balance when the backend read is unavailable. Plan status reflects returned
entitlement/health fields including holds, payment health, legacy status,
and unlimited access. Pinned by
[`BillingSettingsSurface.test.tsx`](../../apps/packages/product-client/src/components/settings/panes/billing/BillingSettingsSurface.test.tsx).
Mobile's smaller personal
[`Billing section`](../../apps/mobile/src/components/settings/MobileSettingsScreen.tsx)
shows plan/usage and portal/checkout/refill actions and does not reuse the
Desktop/Web surface.

**T2 — out-of-credit at spend time is typed and actionable on every
surface, never raw provider noise.** The 402 body carries `code`,
`decision_type`, and optionally `reason`/`remaining_seconds`; the client
maps `billing_credits_exhausted` to upgrade copy and
`billing_start_blocked` to a generic block. On the LLM side,
`budget_status = limit_reached`/`exhausted` disables virtual keys so a
launch attempt gets a typed refusal at mint/launch time, not a raw LiteLLM
error mid-session. See [Current gaps](#current-gaps) for the standalone
upgrade/refill state components this ruling calls for.

Desktop additionally renders the organization-admin **Usage & Limits**
pane: separate compute/LLM balances and timeseries, member usage
drill-down, and an editor for org-wide or per-member limits on either
meter/window
([`OrganizationBudgetsPane.tsx`](../../apps/packages/product-client/src/components/settings/panes/OrganizationBudgetsPane.tsx),
[`OrganizationLimitsEditor.tsx`](../../apps/packages/product-client/src/components/settings/panes/OrganizationLimitsEditor.tsx)).

When authenticated with usage metering enabled, usage renders inside the
account popover as status rows — one per meter, each stating its label,
percentage used, and what remains — rather than behind a separate footer
trigger. The rows come from
[`SidebarConsumptionCard`](../../apps/packages/product-client/src/components/app/sidebar/SidebarConsumptionCard.tsx),
mounted by
[`SidebarUsageSection`](../../apps/packages/product-client/src/components/app/sidebar/SidebarUsageSection.tsx),
which renders nothing at all — separator included — when the capability is
off; both are pinned by
[`SidebarConsumptionCard.test.tsx`](../../apps/packages/product-client/src/components/app/sidebar/SidebarConsumptionCard.test.tsx).
It preserves explicit loading/unavailable states, renders each ready meter
from its own returned units and limit state, and gates the billing action
independently by the billing capability: a self-service org owner gets one
owner-preserving **Billing** action, members get the same destination with
admin-managed copy, and personal owners get none — Desktop has no
owner-correct personal billing destination, so the card explains why
instead of falling back to an unrelated org.

## Interfaces And Product Surfaces

Owner-scoped reads default to the personal owner and use an organization
only when selected and authorized; the usage summary is the current user's
usage inside that selected owner and billing subject, not aggregate
organization usage:

```text
GET /billing/usage/summary
GET /billing/usage/timeseries
GET /billing/llm-balance
POST /billing/team-checkout
GET /billing/team-checkout/current
POST /billing/team-checkout/{intent_id}/cancel
```

Organization aggregation and administration use the org-admin routes:

```text
GET /organizations/{organization_id}/usage/by-user
GET /organizations/{organization_id}/usage/users/{user_id}/timeseries
GET /organizations/{organization_id}/limits
PUT /organizations/{organization_id}/limits   full replacement
```

Owner-scoped and team-checkout endpoints are implemented by
[`billing/api.py`](../../server/proliferate/server/billing/api.py) and
[`team_checkout/api.py`](../../server/proliferate/server/billing/team_checkout/api.py);
org aggregation/limits by
[`organizations/usage/api.py`](../../server/proliferate/server/organizations/usage/api.py).
The Cloud SDK
[`billing client`](../../cloud/sdk/src/client/billing.ts) and React SDK
[`billing hooks`](../../cloud/sdk-react/src/hooks/billing.ts) expose
the matching client contracts.

## Corridor

Named, binary assertions from the 2026-07-28 launch-hardening plan (laws
A2-A3/N1-N6/M1-M4/T1-T2 above; A1 — one billing subject plus acting user
on every ledger row — is stated in the Mental Model); IDs are stable,
tests reference them by name. A corridor with a linked test is proven; one without is an open work
item even where the underlying code already behaves correctly. Coverage
outside any single corridor ID: compute attribution end-to-end
([test_billing_compute_attribution.py](../../server/tests/integration/test_billing_compute_attribution.py)),
store-level invariants
([test_billing_store_invariants.py](../../server/tests/integration/test_billing_store_invariants.py)),
Stripe integration unit tests
([test_stripe_billing.py](../../server/tests/unit/test_stripe_billing.py)).

**B — attribution & accounting**

- **B1** Segment/event attribution matches the org-always-pays ruling; the
  personal-context hardcode (`organization_id=None` in
  [`cloud_sandboxes.py`](../../server/proliferate/db/store/cloud_sandboxes.py))
  is a documented deferral — see [Current gaps](#current-gaps).
- **B2** Accounting pass ×2 over the same segments yields identical
  balances, one export row per slice.
  [`test_accounting_cursor_prevents_duplicate_consumption`](../../server/tests/integration/test_billing_accounting_boundaries.py).
- **B3** A period-straddling slice splits at `period_start`; the
  pre-period part never exports.
  [`test_accounting_splits_pre_subscription_usage_before_unlimited_hours`](../../server/tests/integration/test_billing_accounting_boundaries.py),
  [`test_paid_accounting_does_not_export_pre_subscription_free_overage`](../../server/tests/integration/test_billing_accounting.py).
- **B4** Export retry after an ambiguous Stripe failure does not
  double-report.
  [`test_enforce_mode_export_success_retryable_and_terminal_paths`](../../server/tests/integration/test_billing_accounting.py).

**E — enforcement**

- **E1** Exhausted subject → ensure/resume → 402 with decision detail; zero
  provider calls.
  [`test_credits_exhausted_uses_stable_402_code`](../../server/tests/integration/test_billing_start_block_paging.py),
  [`test_ensure_denied_when_exhausted`](../../server/tests/integration/test_cloud_sandbox_ensure_billing_gate.py).
- **E2** Reconciler pauses an open over-limit segment, closes as quota
  enforcement.
  [`test_enforce_segment_pauses_on_limit_breached`](../../server/tests/integration/test_billing_limit_enforcement_compute.py).
- **E3** A per-user day cap AND an org month cap both enforce when both
  apply — no raw-tightest masking.
  [`test_per_user_daily_cap_does_not_mask_org_wide_monthly_cap`](../../server/tests/integration/test_billing_limit_enforcement_llm.py).
- **E4** A `limit_reached` key re-enables only via limit reconciliation with
  positive credit; a refill alone does not.
  [`test_llm_topup_reactivation_never_clears_limit_reached`](../../server/tests/integration/test_billing_limit_enforcement_llm.py).
- **E5** A 402 is never cached; a fixed subject succeeds on the next
  request. No dedicated test — [Current gaps](#current-gaps).
- **E6** A billing-state read exception on the authorization path is a
  typed deny with a durable receipt (N6); a fail-open path here is a
  finding. No dedicated test — [Current gaps](#current-gaps).

**W — webhooks & money-in**

- **W1** A duplicate Stripe delivery is a no-op.
  [`test_stripe_webhook_duplicate_processed_event_does_not_dispatch_again`](../../server/tests/integration/test_stripe_webhooks.py).
- **W2** Out-of-order subscription events converge to Stripe's current
  state.
  [`test_invoice_paid_before_subscription_created_still_schedules_positive_once`](../../server/tests/integration/test_stripe_webhooks.py).
- **W3** A bad signature is a 4xx with zero state change.
  [`test_stripe_webhook_rejects_bad_signature`](../../server/tests/integration/test_stripe_webhooks.py).
- **W4** Seat reconciliation converges from both drift directions.
  [`test_two_active_subscriptions_do_not_raise_and_pick_the_newest`](../../server/tests/integration/test_billing_seat_adjustment.py),
  [`test_org_pro_subscription_sync_reconciles_active_seats_before_period_grant`](../../server/tests/integration/test_stripe_webhooks.py).

**U — UI truth**

- **U1** `BillingSettingsSurface` shows an error state, not defaults, on
  failed reads.
  [`BillingSettingsSurface.test.tsx`](../../apps/packages/product-client/src/components/settings/panes/billing/BillingSettingsSurface.test.tsx).
- **U2** `SidebarConsumptionCard` renders each meter only from returned
  units.
  [`SidebarConsumptionCard.test.tsx`](../../apps/packages/product-client/src/components/app/sidebar/SidebarConsumptionCard.test.tsx).
- **U3** New upgrade/refill state components render every state (loading,
  blocked, low, exhausted, error) and register in `PlaygroundLibrary`. Not
  yet built — [Current gaps](#current-gaps).

## Failure modes

- Enforce-mode billing block at resume/ensure: typed 402 before any
  provider I/O; the materialization runner logs it as routine business
  logic rather than paging
  ([`runner.py`](../../server/proliferate/server/cloud/materialization/runner.py)).
- Over-limit compute observed by the reconciler: paused and closed as
  quota enforcement within one 15-minute pass.
- LLM subject exhausted or over a budget cap: affected keys disabled,
  `budget_status` flips; the next launch attempt gets a typed refusal
  instead of a mid-session provider error.
- Stripe webhook signature invalid or stale: 401, zero state change.
- Stripe webhook handler exception: receipt marked `failed`, re-claimable,
  never marked processed.
- Usage export terminal failure: `failed_terminal`, no retry; a retryable
  Stripe error is `failed_retryable` for the next pass.
- Seat adjustment Stripe failure: `failed_retryable` up to the attempt cap,
  then `failed_terminal`; Stripe `quantity` stays at its last-confirmed
  value rather than being guessed.
- Team checkout metadata mismatch or non-active subscription at
  activation: the intent is marked failed with a typed error code; no
  organization is activated.

## Current gaps

Deltas between this document and `main`, each struck by its follow-up PR:

- [ ] **B1.** `cloud_sandbox_value`
      ([`cloud_sandboxes.py`](../../server/proliferate/db/store/cloud_sandboxes.py))
      hardcodes `organization_id=None`/`billing_subject_id=None` on every
      mapped row; the personal-context path never carries org attribution
      through this value object, even though segment-open and the resume
      gate separately re-resolve the org via membership lookup. The org-only
      sandbox-subject migration (one sandbox row keyed by
      `(owner_user_id, organization_id)`, `organization_id` NOT NULL, no
      stored subject) is the ruled direction that removes this hardcode; it
      landed as spec in #1564 and is owned by
      [sandbox-lifecycle.md](SANDBOX/lifecycle.md#current-gaps) — its gap
      list carries the migration steps. It is OUT of launch scope (Pablo,
      ruling 3, 2026-07-28) and stays a documented deferral here, not a
      silent fix.
- [ ] **N2 webhook gate.** The `created`/`resumed` webhook re-pause check
      (`webhooks/service.py` (deleted with the E2B webhook lane, cull part 1))
      resolves `ensure_personal_billing_subject` (never the org payer the
      way `resolve_billing_subject_id_for_user` does) and tests only
      `active_spend_hold` — it does not evaluate compute budget caps, so
      an over-limit (cap-breach) wake stands until the next reconciler
      pass, and an org-held member's wake is checked against the wrong
      subject. Align it with the resume-path gate's subject resolution
      and checks.
- [ ] **E5/E6.** No dedicated test asserts a 402 is never cached (E5), and
      `assert_cloud_sandbox_resume_allowed`/
      `assert_cloud_sandbox_resume_allowed_for_owner`
      ([`authorization.py`](../../server/proliferate/server/billing/authorization.py))
      have no explicit `except` around the billing-snapshot read: an
      unhandled exception propagates uncaught (the request fails; it is
      not an implicit allow) but with no durable receipt and no alert
      wired specifically to this path (N6/E6). Lands via PR #1572
      (typed `billing_unavailable` 503, receipt on
      `billing_decision_event`, `report_critical` alert, six pinning
      tests incl. the E5 no-denial-cache pair).
- [ ] **U3.** The standalone upgrade/refill startup-state components (out
      of credit → upgrade; low/exhausted → refill) are not on `main` yet.
      Net-new deliverable per the 2026-07-28 ruling; lands via PR #1570
      (`product-client/components/patterns/BillingGateState` + `PlaygroundLibrary`
      registration).
- [ ] **M2 live proof.** The free-tier anti-abuse key (GitHub identity, not
      account) is unit-true in
      [`billing_subjects.py`](../../server/proliferate/db/store/billing_subjects.py)
      but has no live Stripe-TEST-mode proof run end-to-end (checkout →
      webhook → grant → drain → export).
- [ ] Web and Mobile do not expose the organization **Usage & Limits**
      pane.
- [ ] Usage reads aggregate the raw ledgers; no rollup or materialized
      usage table exists.
