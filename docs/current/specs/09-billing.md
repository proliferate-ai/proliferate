# 09 — Billing

Status: implementation-ready spec.

Date: 2026-05-20.

Depends on: [`00-sandbox-foundation.md`](00-sandbox-foundation.md),
[`02-agent-auth.md`](02-agent-auth.md),
[`04-cloud-running-alignment.md`](04-cloud-running-alignment.md).

Soft: 03, 06, 07, 08.

Billing is the entitlement layer that gates managed compute and
managed LLM credits. **Most of it is already shipped.** Spec 09's
job is to close the specific gaps, wire the existing
`authorize_sandbox_start` check into spec 04's wake hook, link the
managed-credit budget to plan entitlement, and protect the free
trial from re-creation abuse.

## 1. Purpose & Scope

In scope:

- Wire spec 04's `kick_off_managed_slot_wake` to the existing
  `authorize_sandbox_start` gate. No new abstraction; the function
  is already the canonical billing check.
- Tie `agent_gateway_budget_subject.included_budget_usd` to the
  billing subscription/plan, replacing today's flat
  `settings.agent_gateway_default_managed_budget_usd` stand-in.
  Pro plans get a higher managed-credit budget; free plans get
  the default.
- Add a small `free_cloud_allocation` table keyed by GitHub
  provider user id so a user cannot reset the free trial by
  creating a new Proliferate account against the same GitHub.
- Surface billing state in workspace responses and SSE patches so
  web/mobile/Desktop/Slack can render "Compute exhausted",
  "Credits exhausted", "Overage cap reached", or
  "Payment failed" without recomputing the snapshot.
- Add a web Settings → Billing pane (Desktop already has one).
- Process additional Stripe webhook events that today's handler
  ignores: `invoice.upcoming`, `customer.subscription.trial_will_end`.
- Acceptance tests that prove the wake gate consults billing
  exactly as expected: paused slot + exhausted budget → command
  transitions queued → `failed_delivery` with
  `error_code='sandbox_wake_blocked'`.

Out of scope:

- A `plan_entitlement` DB table. The existing
  `BillingPlanPolicy` dataclass + constants in
  `policy.py` and `constants/billing.py` are the source of truth
  for plan rules. Migrating those to DB is migration ceremony
  for an unshipped product; keep them in code.
- A `compute_subject_period` rollup table. The existing
  `usage_segment` + `billing_grant` + `billing_grant_consumption`
  model already gives us per-period usage by summing remaining
  seconds across grants.
- A `compute_rate_card` table. Today billing is per-second uniform
  per the policy; rate cards become needed when we offer multiple
  sandbox shapes with different prices.
- A `sandbox_pause_request` queue. Today the reconciler pauses
  directly via the E2B API and the existing `billing_hold` row
  prevents resumes. The planning notes' indirection is unnecessary
  given the implemented synchronous path.
- A new compute-overage product surface beyond the existing
  `BillingSubject.overage_enabled` + `overage_cap_cents_per_seat`
  per-subject opt-in.
- A managed LLM credits overage path. LLM credits remain hard-
  capped in V1 (per spec 02 §1).
- Mobile billing UI. Desktop has the canonical billing pane; web
  gains parity. Mobile defers.
- Per-org compute hard cap distinct from `overage_cap_cents_per_seat`.
  Today's per-seat cap is the cap; if product needs an additional
  org-wide ceiling, follow-up spec.

## 2. Mental Model

```text
billing_subject              the thing that pays
                             (one per user; one per org)
  stripe_customer_id
  overage_enabled
  overage_cap_cents_per_seat

billing_subscription         the active plan (free or pro)
  current_period_*
  seat_quantity
  cloud_monthly_price_id    Pro: monthly seat price
  overage_price_id          Pro: metered overage price
  status                    active | past_due | canceled | ...

billing_grant                pre-paid compute time
  grant_type                 free_included | free_trial_v2 |
                             pro_period | pro_seat_proration |
                             refill_10h
  hours_granted, remaining_seconds
  effective_at, expires_at

usage_segment                actual compute usage (one per slot run)
  external_sandbox_id        E2B sandbox id
  started_at, ended_at
  is_billable

billing_grant_consumption    debit links grant -> segment

billing_hold                 reasons a subject CAN'T launch
  kind                       payment_failed | credits_exhausted |
                             active_spend_hold | abuse | ...
  status                     active | resolved
  source                     stripe_webhook | reconciler |
                             admin | abuse_detector
                             (= "compute_runtime_block" in the
                              planning vocabulary)

billing_usage_export         metered overage usage reported to Stripe
  quantity_seconds
  meter_quantity_cents
  cap_cents_snapshot
  stripe_meter_event_identifier
```

The flow:

```text
1. subscription updates set the plan policy via Stripe webhooks
2. plan policy defines: free hours/period, managed cloud allowed,
   shared cloud allowed, etc.
3. grants are issued on plan changes (refills, prorations)
4. each sandbox run consumes from grants in priority order
5. when grants exhausted:
     - if overage_enabled + cap not reached -> billing_usage_export
       writes to Stripe metered usage
     - else -> insert billing_hold(kind='credits_exhausted')
6. holds gate authorize_sandbox_start; subsequent create/resume
   commands fail closed
7. reconciler catches drift (orphan E2B sandboxes, missed
   webhooks, expired grants past period boundary)
```

Spec 04's wake gate calls `authorize_sandbox_start` synchronously
inside the background `run_managed_slot_wake_job`; if the result
is `allowed=false`, queued wake-required commands transition to
`failed_delivery` with `error_code='sandbox_wake_blocked'` and the
`SandboxStartAuthorization.start_block_reason` populates the
command's `error_message`.

Managed LLM credits are a separate spend track:

```text
agent_gateway_budget_subject       per-org (organization)
  included_budget_usd              currently from
                                   settings.agent_gateway_default_managed_budget_usd
                                   (flat config)
  litellm_team_id                  LiteLLM enforces the hard cap
  budget_duration                  30d
```

Spec 09 wires `included_budget_usd` to plan entitlement so a Pro
org gets the Pro managed-credit allowance, and a free org gets
the free allowance (which may be `$0` until product decides to
offer free LLM credits — operational toggle).

## 3. Dependencies

Hard:

- Spec 00: `sandbox_profile`, `cloud_sandbox` slot lifecycle.
  Billing snapshots reference the slot's `billing_subject_id`.
- Spec 04: `kick_off_managed_slot_wake` is the V1 integration
  point. Spec 04 already names it as the spec-09 hook stub; spec
  09 fills it in.
- Spec 02: `agent_gateway_budget_subject` exists; spec 09 wires
  `included_budget_usd` to plan entitlement.

Soft:

- Spec 03: `useIsAdmin(org)` gates the billing UI; existing
  `RuntimeReadinessPanel` consumes billing state.
- Spec 06 (automations) and spec 07 (Slack) and spec 08 (web/
  mobile/cowork) all enqueue commands that go through
  `authorize_sandbox_start`. Spec 09 doesn't change their
  enqueue surface; it ensures the gate returns useful typed
  errors.
- Spec 08: web billing UI mirrors Desktop's; the wire format is
  the same `BillingSnapshot`.

## 4. Current Repo State

Verified against the current repository worktree on 2026-05-20.

### 4.1 What is shipped

**Tables** (in `server/proliferate/db/models/billing.py`):

```text
billing_subject
  id, kind ('personal' | 'organization'),
  user_id, organization_id, stripe_customer_id,
  overage_enabled (bool), overage_cap_cents_per_seat (default 2000),
  overage_preference_set_at
  (NB: no plan_id column; plan derived at runtime)

billing_subscription
  billing_subject_id, stripe_subscription_id, stripe_customer_id,
  status, cancel_at_period_end, canceled_at,
  current_period_start, current_period_end,
  cloud_monthly_price_id, overage_price_id, seat_quantity,
  monthly_subscription_item_id, metered_subscription_item_id,
  latest_invoice_id/status/url

billing_hold
  billing_subject_id, kind, status, source, source_ref,
  resolved_at

billing_decision_event
  audit log (authorize_start, enforce_active_spend, overage_export)

billing_grant
  user_id, billing_subject_id, grant_type, hours_granted,
  remaining_seconds, effective_at, expires_at, source_ref

billing_grant_consumption
  links grant -> usage_segment_id

billing_usage_cursor
  per-segment watermark

billing_usage_export
  metered overage events to Stripe

billing_entitlement
  manual entitlements (kind='unlimited_cloud', etc.)

billing_seat_adjustment
  pending seat-count changes to Stripe

billing_overage_remainder
  fractional-cent carry-forward

usage_segment
  user_id, billing_subject_id, runtime_environment_id,
  workspace_id, sandbox_id, external_sandbox_id,
  started_at, ended_at, is_billable, opened_by, closed_by

webhook_event_receipt
  Stripe + E2B idempotency
```

**Plan policies** in code, not DB
(`server/proliferate/server/billing/policy.py`):

```text
free_v2_policy()
pro_policy(seats: int)
unlimited_numeric_policy()

BillingPlanPolicy dataclass:
  hours_per_period
  managed_cloud_allowed
  shared_cloud_allowed
  automation_allowed
  slack_allowed
  ssh_target_limit
  (and others)
```

**Stripe integration** (`server/proliferate/server/billing/`):

```text
api.py             route registration
stripe_webhooks.py handle_stripe_webhook + signature verify
service.py         authorize_sandbox_start, snapshot building,
                   create_cloud_checkout_session,
                   update_overage_settings,
                   run_billing_accounting_pass,
                   send_pending_usage_exports
accounting.py      thin wrapper over domain accounting
reconciler.py      background loop; polls E2B; closes orphan
                   segments; pauses over-budget sandboxes
policy.py          plan-policy pure helpers
pricing.py         price ids from settings
seats.py           proration grant helpers
domain/            pure functions: accounting, plan rules,
                   pricing, seat calcs, webhook parsing
integrations/billing/stripe.py
                   raw Stripe API calls
```

**Stripe webhook events handled today**:

```text
checkout.session.completed       -> refill_10h grant if applicable
customer.subscription.created    -> sync sub + reconcile seats
customer.subscription.updated    -> same
customer.subscription.deleted    -> sync + apply payment hold
invoice.paid                     -> sync + pro_period grant +
                                    clear payment-failed holds
invoice.payment_failed           -> apply payment_failed hold

NOT handled: invoice.upcoming, customer.subscription.trial_will_end,
payment_intent.*, charge.*
```

**E2B webhook** (`server/proliferate/server/cloud/webhooks/`):

```text
created   -> open usage_segment; sandbox.status='running'
resumed   -> open segment; if active_spend_hold, immediately pause
paused    -> close segment (closed_by='webhook_paused'); status='paused'
killed    -> close segment (closed_by='webhook_killed'); status='destroyed'
timeout   -> NOT handled today (silently acked)
```

**The canonical billing check** is
`authorize_sandbox_start(db, billing_subject, ...)`
in `service.py`:

```text
returns SandboxStartAuthorization {
  allowed: bool
  start_blocked: bool
  start_block_reason: str | None
  active_spend_hold: bool
}

start_block_reason values today:
  'credits_exhausted'
  'overage_disabled'
  'cap_exhausted'
  'payment_failed'
  'unlimited_disabled'
  'plan_not_allowed'
  'subscription_required_for_team'
  'subject_not_allowed_for_cloud'
```

Called from:

```text
server/proliferate/server/cloud/runtime/provision.py line 941
server/proliferate/server/cloud/workspaces/service.py lines 546, 766, 847
```

**Overage opt-in**: fully shipped.
`BillingSubject.overage_enabled` + `overage_cap_cents_per_seat`
(default 2000 cents = $20). Toggled via
`update_overage_settings`. Reconciler enforces cap.

**Managed LLM budget**
(`server/proliferate/server/cloud/agent_auth/service.py:2554`):

```text
_managed_credit_entitlement_budget() reads
  settings.agent_gateway_default_managed_budget_usd  (config default "0")

Not wired to plan entitlement. Pro orgs and free orgs get the
same value.
```

**Desktop billing UI**:

```text
desktop/src/components/settings/panes/BillingPane.tsx
  CloudBillingSummary (personal)
  OrganizationBillingSection (when active org)
  plan, hours used/remaining, upgrade/manage buttons
```

**Web billing UI**: none. `web/src/pages/SettingsPage.tsx` has no
billing section.

**Mobile billing UI**: none.

**Free trial dedup**: NO `free_cloud_allocation` table. Free trial
is keyed by `billing_subject_id` (one per user account). A user
creating a new Proliferate account against the same GitHub gets
a fresh `free_trial_v2` grant.

### 4.2 Gaps spec 09 closes

- `kick_off_managed_slot_wake` (spec 04) calls a stub billing
  hook; spec 09 wires it to `authorize_sandbox_start`.
- `agent_gateway_budget_subject.included_budget_usd` is a flat
  config value; spec 09 derives it from plan entitlement.
- No GitHub-identity-keyed free trial dedup.
- Web Settings has no billing pane.
- Workspace / target responses don't include billing-blocked
  state, so UI surfaces (web/mobile/Slack) can't render
  appropriate copy without an extra fetch.
- Stripe webhook handler ignores `invoice.upcoming` and
  `customer.subscription.trial_will_end` (useful for proactive
  notifications).
- E2B `timeout` event is silently acked.

## 5. Target Model

### 5.1 What spec 09 adds (small)

```text
free_cloud_allocation                                          (new)
billing_snapshot in workspace + target responses               (extend existing)
plan-derived managed-credit budget                             (wire existing)
spec 04 wake hook -> authorize_sandbox_start                   (wire existing)
Stripe webhook: invoice.upcoming, trial_will_end               (extend handler)
E2B webhook: timeout                                           (handle, close segment)
web Settings > Billing pane                                    (new)
```

What spec 09 does NOT add (intentional non-changes):

```text
no plan_entitlement table
no compute_subject_period table
no compute_rate_card table
no sandbox_pause_request queue
no mobile billing UI
no LLM credit overage path
```

### 5.2 `free_cloud_allocation` (new)

Keyed by GitHub provider user id so a user cannot reset the free
trial by creating a new Proliferate account.

```text
free_cloud_allocation
  id                          uuid pk
  github_provider_user_id     text                            NOT NULL
                              -- from AuthIdentity where provider='github'
                              -- the platform-stable id, not the login
  allocation_kind             text                            NOT NULL
                              'personal_free' | 'team_trial'

  billing_subject_id          uuid fk billing_subject.id      NOT NULL
                              -- the subject this allocation was issued to
  issued_billing_grant_id     uuid fk billing_grant.id        NOT NULL
                              -- the free_trial_v2 grant this allocation
                                  controls

  period_start                timestamptz                     NOT NULL
  period_end                  timestamptz                     NOT NULL

  status                      text                            NOT NULL
                              'active' | 'exhausted' | 'closed' | 'revoked'

  created_at, updated_at

  UNIQUE (github_provider_user_id, allocation_kind, period_start)
  CHECK ck_free_cloud_allocation_status
```

`period_start` and `period_end` semantics (server-computed at
issuance time):

```text
period_start = the start of the current monthly billing window
               for free allocations. V1 uses a fixed
               billing_subject.created_at-anchored rolling
               30-day window:
                 floor_to_30d(billing_subject.created_at, now)
               i.e. align to the same calendar day each month
                 (UTC).
period_end   = period_start + 30 days (UTC).
allocation_kind: 'personal_free' uses this 30d window.
                 'team_trial' uses the same shape today but is
                 not exercised in V1.

If the trial concept later moves to calendar-month or to a
subscription-period anchor, period_start/end shift accordingly.
The schema accommodates either; only the helper that computes
the window changes.

Helper: server/proliferate/server/billing/free_trial_window.py
  current_free_trial_period(billing_subject) -> (start, end)
  pure function over billing_subject.created_at + now.
```

The `(github_provider_user_id, allocation_kind, period_start)`
uniqueness is the abuse gate: a single Proliferate-internal
free-trial period (typically a calendar month) keyed by GitHub
identity admits exactly one allocation.

Issuance flow (modifies the existing free_trial_v2 grant
issuance in
`server/proliferate/server/billing/service.py`):

```text
ensure_free_cloud_allocation(user_id, billing_subject_id):
  load AuthIdentity for user_id where provider='github'
  if no GitHub identity:
    reject free trial issuance with 'github_required_for_free_trial'

  github_provider_user_id = identity.provider_subject

  attempt INSERT free_cloud_allocation
    (github_provider_user_id, allocation_kind='personal_free',
     period_start=<current period>, billing_subject_id, status='active')
  on unique conflict:
    load the existing row
    if existing.billing_subject_id == billing_subject_id:
      no-op; allocation already in place
    else:
      reject free trial issuance with 'github_identity_already_used'

  on success:
    issue billing_grant(grant_type='free_trial_v2')
    set free_cloud_allocation.issued_billing_grant_id = grant.id
```

The check fires before `billing_grant` insertion. It does NOT
delete or merge grants on the original subject — those belong to
that subject. The denied user sees a "free trial unavailable on
this account" message; they can upgrade to Pro on the new
account.

The `team_trial` kind reserves the table shape for future "team
free trial" semantics; not exercised in V1 (Team always pays).

The product can later relax the per-period uniqueness when the
free trial cadence changes; the schema accommodates without
migration.

### 5.3 Wire managed-credit budget to plan entitlement

`agent_gateway_budget_subject.included_budget_usd` becomes derived
from the billing subscription:

```text
server/proliferate/server/cloud/agent_auth/service.py
  _managed_credit_entitlement_budget(org_id):

    load billing_subject for org
    snapshot = build_billing_snapshot(billing_subject)
    plan = snapshot.plan_policy_kind   (free_v2 | pro | unlimited | ...)

    return settings.managed_credit_budget_for_plan(plan)
      free_v2      -> settings.agent_gateway_managed_budget_free_usd       default "0"
      pro          -> settings.agent_gateway_managed_budget_pro_usd        default "0"
      unlimited    -> settings.agent_gateway_managed_budget_unlimited_usd  default "0"

    -- code defaults are fail-closed ($0); hosted production operators
    -- configure non-zero values via deploy env. Self-hosted operators
    -- can keep all three at "0" to ship without managed credits at all.

    -- if entitlement billing_entitlement(kind='custom_managed_credit_budget')
       is set on the subject, override with that
```

The settings keys replace the single
`settings.agent_gateway_default_managed_budget_usd` (which is
retired). The reconciler in `agent_gateway/reconciler.py` (spec
02) already updates the LiteLLM team max_budget when
`included_budget_usd` changes; spec 09 keeps that path. The
trigger to re-reconcile is added to the Stripe subscription
update path:

```text
customer.subscription.updated webhook handler:
  ... existing subscription sync ...
  enqueue agent_gateway_budget_reconcile(org_id) for any org
    whose subscription tier just changed
```

Pro orgs upgrading get the Pro managed-credit budget within one
webhook + reconciler tick. Cancellations downgrade the budget on
the next subscription period boundary (so users don't immediately
lose access mid-period).

### 5.4 Spec 04 wake hook integration

Spec 04 §5.6's wake job consults a billing hook. Spec 09 names it
exactly:

```text
server/proliferate/server/cloud/runtime/wake.py
  run_managed_slot_wake_job(target_id):
    ...
    billing_subject = load_billing_subject_for_target(target_id)
    authorization = authorize_sandbox_start(
      db,
      billing_subject,
      sandbox_intent='resume',   -- or 'create' for first wake
    )
    if not authorization.allowed:
      mark all queued wake-required commands for this target as
        failed_delivery with
          error_code='sandbox_wake_blocked'
          error_message=authorization.start_block_reason
      return
    ... proceed with E2B resume ...
```

No new abstraction. `authorize_sandbox_start` already returns the
right shape.

`load_billing_subject_for_target(target_id)` resolves through:

```text
target -> sandbox_profile (via cloud_targets.sandbox_profile_id)
       -> billing_subject_id (on sandbox_profile, set at profile
          creation per spec 00 §5.2)
```

Spec 00 already wired `sandbox_profile.billing_subject_id`. Spec
09 uses it.

`start_block_reason` → command `error_code` mapping (for the
wake-hook failure path):

```text
start_block_reason                error_code on the queued command
---------------------------------  --------------------------------
'credits_exhausted'                'sandbox_wake_blocked'
'overage_disabled'                 'sandbox_wake_blocked'
'cap_exhausted'                    'sandbox_wake_blocked'
'payment_failed'                   'sandbox_wake_blocked'
'unlimited_disabled'               'sandbox_wake_blocked'
'plan_not_allowed'                 'sandbox_wake_blocked'
'subscription_required_for_team'   'sandbox_wake_blocked'
'subject_not_allowed_for_cloud'    'sandbox_wake_blocked'
(authorization_response.allowed=true but slot create fails)
                                   'sandbox_wake_failed'
(authorization_response.allowed=true but heartbeat times out)
                                   'sandbox_wake_timeout'
```

The `start_block_reason` itself is preserved in the command's
`error_message` for UI display.

### 5.5 Billing-blocked state in workspace responses + SSE patches

Workspace listing responses (spec 04 §5.2 / spec 08 §5.2) include
a `billing` envelope per workspace:

```text
billing: {
  block_status: 'allowed' | 'blocked' | 'warn',
  block_reason: string | null,
  hold_kind: string | null,
                  -- e.g. 'credits_exhausted', 'payment_failed'
  remaining_seconds_in_period: integer | null,
  overage_enabled: bool,
  overage_cap_cents_per_seat: integer,
  overage_used_cents_this_period: integer,
}
```

`block_status='warn'` covers near-limit conditions (e.g. <10%
remaining) so the UI can surface a soft warning before hard block.

The same envelope flows on the workspace SSE stream (spec 04 §5.5
/ spec 08 §5.1) as a `billing_patch` event. The web/mobile
`RuntimeReadinessPanel` (spec 03 §5.4) and Desktop sidebar badge
(spec 08 §5.8) consume it.

Implementation:

```text
server/proliferate/server/cloud/workspaces/service.py
  workspace response builder calls
    build_billing_snapshot(billing_subject)
  projects relevant fields into the response

server/proliferate/server/billing/service.py
  publish_billing_patch_for_subject(subject_id)
    -> publishes a patch on every workspace SSE stream whose
       workspace's billing_subject_id == subject_id

  callers:
    after authorize_sandbox_start returns blocked
    after billing_hold insert/update
    after Stripe webhook subscription/invoice transitions
    after reconciler enforces a hold
```

The patch is per-subject; the SSE multiplexer expands it to all
affected workspaces.

### 5.5a `customer.subscription.deleted` refinement

The current handler unconditionally applies a `payment_failed` hold
on `deleted`. Spec 09 refines the rule (Open Q #2):

```text
on customer.subscription.deleted:
  reason = stripe_subscription.cancellation_details.reason
  prior_status = stored billing_subscription.status before delete

  case A: reason in ('cancellation_requested', None) AND
          prior_status in ('active','trialing'):
    -- clean cancellation reaching period end (or admin cancel)
    sync subscription record (canceled_at set; cancel_at_period_end true)
    schedule managed-credit budget downgrade at current_period_end
    NO payment_failed hold
    (the existing pro_period grant continues to consume until
     period end; new grants stop being issued)

  case B: prior_status in ('past_due','unpaid'):
    -- deletion driven by failed payment
    apply payment_failed hold (existing behaviour)
    keep current managed-credit budget until current_period_end
    enqueue agent_gateway_budget_reconcile at period_end

  case C: stripe-side immediate cancel that wipes paid entitlement
          before period_end (rare; manual admin action in Stripe):
    sync; downgrade now; managed-credit budget reconciles immediately
    payment_failed hold only if also driven by payment problem
```

The reconciler / subscription sync code already tracks
`current_period_end`; spec 09 just gates the hold insert and the
budget downgrade timing on the reason.

### 5.6 New Stripe webhook events

Handler bodies (in
`server/proliferate/server/billing/stripe_webhooks.py`):

```text
handle_invoice_upcoming(event):
  invoice = event.data.object
  billing_subject = load_billing_subject_by_stripe_customer(invoice.customer)
  if billing_subject is None:
    log + return       (orphan webhook; no-op)
  insert billing_decision_event(
    billing_subject_id = billing_subject.id,
    kind = 'upcoming_invoice',
    payload_json = {
      'invoice_id':         invoice.id,
      'period_start':       invoice.period_start,
      'period_end':         invoice.period_end,
      'amount_due_cents':   invoice.amount_due,
      'currency':           invoice.currency,
      'days_until_due':     (invoice.due_date - now()).days,
    }
  )
  publish_billing_patch_for_subject(billing_subject.id)
  -- web/mobile/Desktop UIs read the next workspace response and
     see block_status='warn' + a hold_kind='upcoming_invoice'
     equivalent (informational; never blocks launch)

handle_customer_subscription_trial_will_end(event):
  subscription = event.data.object
  billing_subject = load_billing_subject_by_stripe_subscription(subscription.id)
  if billing_subject is None:
    log + return
  insert billing_decision_event(
    billing_subject_id = billing_subject.id,
    kind = 'trial_will_end',
    payload_json = {
      'subscription_id':    subscription.id,
      'trial_end':          subscription.trial_end,
      'days_until_end':     (subscription.trial_end - now()).days,
    }
  )
  publish_billing_patch_for_subject(billing_subject.id)
  -- UI surfaces a "Your trial ends in N days" banner; never
     blocks. Acts as a soft deadline for the user to add a
     payment method.
```

Neither event applies a `billing_hold` or affects launch. Both
are informational. The published billing_patch carries the
relevant fields (e.g. `upcoming_invoice_amount_cents`,
`trial_ends_at`) so the UI banner can render without an extra
fetch.

No new tables. Three lines added to the
`_dispatch_stripe_event` switch in
`server/proliferate/server/billing/stripe_webhooks.py`.

### 5.7 E2B `timeout` event

Today `timeout` is silently acked. Spec 09 handles it like a
pause:

```text
timeout   -> close usage_segment (closed_by='webhook_timeout')
             set sandbox.status='paused'
             keep billing_grant_consumption rows intact
             do NOT insert billing_hold (timeout is not a block;
                                          user can resume)
```

This prevents a hung-open `usage_segment` when E2B times out the
sandbox before it sends a `paused` event.

### 5.8 Web Settings → Billing pane

Mirror of Desktop's `BillingPane.tsx`:

```text
web/src/pages/SettingsPage.tsx
  add Billing section under Organization & Account

web/src/components/settings/billing/
  PersonalBillingSummary.tsx
  OrganizationBillingSection.tsx
  OverageSettingsCard.tsx
  BillingPlanCard.tsx
  UsageHistoryList.tsx
```

Consumes the same Cloud SDK billing client (no schema change).
Uses spec 03 primitives where the web app has equivalents (it
doesn't fully — web uses a subset of the design tokens; spec 08
already wired `useCloudBilling`-style hooks indirectly via
existing SDK).

Mobile billing UI is deferred (spec 08 Open Q #5).

### 5.9 Vocabulary alignment

The planning notes (`docs/current/cllloud/8) Billing.md`) used
names that don't match the implemented schema. Spec 09 keeps the
existing names; the planning vocabulary maps as:

```text
planning name             actual repo name
-----------------------   --------------------------------
compute_runtime_block     billing_hold
compute_subject_period    derived from billing_grant +
                          billing_grant_consumption +
                          billing_subscription.current_period_*
compute_usage_segment     usage_segment
compute_rate_card         (not modeled; uniform per-second)
sandbox_pause_request     (no separate queue; reconciler pauses
                          directly via E2B API)
billing_event             billing_decision_event
plan_entitlement          BillingPlanPolicy (in code; policy.py)
llm_credit_period         agent_gateway_budget_subject
                          (organization-scoped; 30d duration)
free_cloud_allocation     (new; spec 09 §5.2)
billing_subject           billing_subject  (matches)
subscription              billing_subscription (matches)
```

Acceptance criteria use the actual repo names. Anywhere a future
spec references the planning vocabulary, the mapping above is
the authoritative translation.

## 6. Files To Change

Server (Python):

```text
server/proliferate/db/models/billing.py
  + FreeCloudAllocation

server/proliferate/db/migrations/versions/<NEW>_billing_alignment.py
  - free_cloud_allocation table

server/proliferate/db/store/billing.py
  + ensure_free_cloud_allocation helper
  + load_billing_subject_for_target helper

server/proliferate/server/billing/service.py
  - free_trial_v2 grant issuance: gate on ensure_free_cloud_allocation;
    reject with 'github_identity_already_used' on conflict
  - publish_billing_patch_for_subject helper
  - extend SandboxStartAuthorization callers in workspace
    responses to populate the billing envelope

server/proliferate/server/billing/stripe_webhooks.py
  + handle_invoice_upcoming
  + handle_customer_subscription_trial_will_end
  - enqueue agent_gateway_budget_reconcile on
    customer.subscription.updated when tier changes

server/proliferate/server/cloud/runtime/wake.py
  - import authorize_sandbox_start
  - call it inside run_managed_slot_wake_job
  - fail queued wake-required commands on block

server/proliferate/server/cloud/agent_auth/service.py
  - _managed_credit_entitlement_budget rewritten to use the
    billing-snapshot-derived plan kind

server/proliferate/server/cloud/agent_auth/reconciler.py
  - on subscription tier change, reconcile org budget subject

server/proliferate/server/cloud/webhooks/service.py
  - handle 'timeout' event: close segment as paused

server/proliferate/server/cloud/workspaces/service.py
  - workspace response builder includes the billing envelope
    (§5.5)

server/proliferate/server/cloud/live/service.py
  - publish billing patches on workspace SSE streams when
    publish_billing_patch_for_subject fires

server/proliferate/config.py
  + agent_gateway_managed_budget_free_usd       default "0"
  + agent_gateway_managed_budget_pro_usd        default "0"   (set via deploy env)
  + agent_gateway_managed_budget_unlimited_usd  default "0"   (set via deploy env)
  - retire agent_gateway_default_managed_budget_usd (rename + drop;
    no-users migration posture)
```

SDK regeneration:

```text
cloud/sdk/src/client/billing.ts                                  extend
cloud/sdk/src/types/generated.ts                                  regen
```

Web:

```text
web/src/pages/SettingsPage.tsx                                   add Billing section
web/src/components/settings/billing/                             (new)
  PersonalBillingSummary.tsx
  OrganizationBillingSection.tsx
  OverageSettingsCard.tsx
  BillingPlanCard.tsx
  UsageHistoryList.tsx
web/src/hooks/access/cloud/billing/                              (new; mirrors Desktop)
```

Desktop:

```text
desktop/src/components/settings/panes/BillingPane.tsx
  consume the new billing envelope from workspace responses
  (optional; existing snapshot endpoint already works)

desktop/src/components/workspace/shell/sidebar/
  use-workspace-sidebar-billing-badge.ts                          (new)
  consumes billing envelope from workspace listing
```

Mobile: no changes in V1.

## 7. Implementation Chunks

```text
Chunk A  Wake hook integration (smallest first)
  - load_billing_subject_for_target helper
  - run_managed_slot_wake_job calls authorize_sandbox_start
  - failed wake transitions queued commands to failed_delivery
    with sandbox_wake_blocked + start_block_reason
  - tests: paused slot + credits_exhausted hold -> command fails

Chunk B  Managed credits budget from plan
  - _managed_credit_entitlement_budget rewrite
  - settings.agent_gateway_managed_budget_{free,pro,unlimited}_usd
  - retire agent_gateway_default_managed_budget_usd
  - subscription.updated triggers budget reconcile
  - tests: pro upgrade increases budget; cancel restores free at
    period end

Chunk C  Free trial dedup
  - free_cloud_allocation table
  - ensure_free_cloud_allocation helper
  - free_trial_v2 grant issuance gated on GitHub identity
  - reject second-account trial with typed error
  - tests: same GitHub id across two billing subjects -> deny

Chunk D  Billing envelope in workspace responses + SSE patches
  - response builder includes billing
  - publish_billing_patch_for_subject helper
  - workspace SSE pumps billing_patch events
  - tests: hold insert publishes patch; clearing publishes again

Chunk E  Web billing UI
  - mirror Desktop BillingPane structure
  - hooks in web/src/hooks/access/cloud/billing/
  - manage/upgrade buttons route to Stripe portal

Chunk F  New webhook events
  - invoice.upcoming handler
  - customer.subscription.trial_will_end handler
  - E2B timeout event closes segment

Chunk G  Sidebar billing badge (small Desktop polish)
  - workspace listing -> billing envelope -> badge
  - "Compute exhausted" / "Credits exhausted" / "Payment failed"
    labels via copy/settings/billing-copy.ts

Chunk H  Tests + smoke
```

All chunks land in one PR.

## 8. Acceptance Criteria

1. `kick_off_managed_slot_wake` (spec 04) calls
   `authorize_sandbox_start` inside the background wake job.
   `allowed=false` transitions queued wake-required commands for
   the target to `failed_delivery` with
   `error_code='sandbox_wake_blocked'` and
   `error_message` set from `start_block_reason`.
2. `load_billing_subject_for_target(target_id)` resolves through
   `cloud_targets.sandbox_profile_id` →
   `sandbox_profile.billing_subject_id` and is the only path
   used by the wake hook.
3. `agent_gateway_budget_subject.included_budget_usd` is derived
   from the billing subscription's plan kind via
   `settings.agent_gateway_managed_budget_*_usd`. The flat
   `agent_gateway_default_managed_budget_usd` setting is
   removed.
4. Pro subscription upgrade triggers
   `agent_gateway_budget_reconcile` for the org; the LiteLLM
   team `max_budget` reflects the Pro value within one
   reconciler tick.
5. Subscription cancellation downgrades the org's managed-credit
   budget at the **next subscription period boundary** for clean
   cancellations (the user paid through the period). Immediate
   downgrade only when no paid entitlement remains.
5a. `customer.subscription.deleted` is reason-sensitive (§5.5a):
    clean cancel → no payment_failed hold; payment-driven
    deletion → apply hold + keep budget until period_end.
5b. The GitHub-link path runs `ensure_free_cloud_allocation` AFTER
    linking. A GitHub identity already used elsewhere returns
    `github_identity_already_used` and the trial grant is denied,
    but the identity link itself is preserved.
6. `free_cloud_allocation` exists with UNIQUE
   `(github_provider_user_id, allocation_kind, period_start)`.
7. Issuing a `free_trial_v2` grant requires a linked GitHub
   identity. Missing identity returns
   `github_required_for_free_trial`.
8. A second Proliferate account by the same GitHub identity is
   denied the free trial with
   `github_identity_already_used`. The original allocation
   persists on the original `billing_subject`.
9. Workspace listing responses include a `billing` envelope
   (block_status, block_reason, hold_kind,
   remaining_seconds_in_period, overage_enabled,
   overage_cap_cents_per_seat, overage_used_cents_this_period).
10. The workspace SSE stream emits `billing_patch` events when
    `publish_billing_patch_for_subject` fires; all workspaces
    whose `billing_subject_id` matches receive the patch.
11. Stripe webhook handler processes `invoice.upcoming` and
    `customer.subscription.trial_will_end`; both insert
    `billing_decision_event` rows and publish billing patches.
12. E2B `timeout` event closes the open `usage_segment` with
    `closed_by='webhook_timeout'` and sets sandbox status to
    `paused`. No `billing_hold` is inserted (timeout is not a
    block).
13. Web Settings has a Billing section that renders the user's
    personal billing summary and, when an active org is present
    AND admin, the organization billing section.
14. Web Billing pane uses the same Cloud SDK billing client as
    Desktop; no new server endpoints.
15. Existing `BillingPlanPolicy` in `policy.py` is unchanged; no
    `plan_entitlement` DB table is introduced.
16. No `compute_subject_period`, `compute_rate_card`, or
    `sandbox_pause_request` tables are introduced.
17. `authorize_sandbox_start` continues to be the sole billing
    gate for managed sandbox start/resume/connect. New callers
    (spec 04 wake job; future specs) use it directly; no
    parallel check.
18. The spec 02 `agent_gateway/reconciler.py` continues to be the
    single owner of LiteLLM mirror reconciliation. Spec 09's
    plan-derived budget feeds into it; spec 09 does not write
    LiteLLM state directly.

## 9. Verification / Tests

Server:

```bash
cd server
uv run pytest -q
```

Targeted server tests:

```text
tests/server/cloud/runtime/test_wake_hook_consults_billing.py
  - paused slot + active billing_hold('credits_exhausted')
    -> command transitions to failed_delivery sandbox_wake_blocked
  - paused slot + allowed -> wake proceeds
tests/server/billing/test_free_trial_github_dedup.py
  - missing github_identity -> github_required_for_free_trial
  - first issuance succeeds
  - second account same github -> github_identity_already_used
tests/server/billing/test_managed_credit_budget_from_plan.py
  - free org -> free budget
  - pro org -> pro budget
  - unlimited org -> unlimited budget
  - billing_entitlement custom_managed_credit_budget overrides
tests/server/billing/test_subscription_updated_triggers_reconcile.py
tests/server/billing/test_cancel_downgrades_at_period_boundary.py
tests/server/billing/test_subscription_deleted_clean_cancel_no_hold.py
  - cancellation_details.reason='cancellation_requested',
    prior_status='active' -> no payment_failed hold; budget
    schedules downgrade at period_end
tests/server/billing/test_subscription_deleted_payment_failure_holds.py
  - prior_status='past_due' -> payment_failed hold; budget
    preserved until period_end
tests/server/billing/test_subscription_deleted_immediate_cancel.py
  - effective_at < current_period_end with no paid entitlement
    -> immediate downgrade; hold only if payment problem
tests/server/billing/test_github_link_preserves_link_denies_trial.py
  - link succeeds even when GitHub id used elsewhere
  - free_trial_v2 grant denied with github_identity_already_used
tests/server/billing/test_invoice_upcoming_emits_decision_event.py
tests/server/billing/test_trial_will_end_emits_decision_event.py
tests/server/cloud/webhooks/test_e2b_timeout_closes_segment.py
tests/server/cloud/workspaces/test_response_includes_billing_envelope.py
tests/server/cloud/live/test_billing_patch_on_hold_change.py
tests/server/billing/test_existing_authorize_sandbox_start_unchanged.py
tests/server/billing/test_no_new_plan_entitlement_table.py
  -- structural test that plan_entitlement schema is NOT introduced
tests/server/billing/test_no_compute_subject_period_table.py
```

Web:

```bash
cd web && pnpm test -- --run && pnpm typecheck
```

Targeted web tests:

```text
web/src/components/settings/billing/PersonalBillingSummary.test.tsx
web/src/components/settings/billing/OrganizationBillingSection.test.tsx
web/src/components/settings/billing/OverageSettingsCard.test.tsx
web/src/pages/SettingsPage.test.tsx
  - Billing section visible
  - Stripe portal manage button
```

Desktop:

```bash
cd desktop && pnpm test -- --run && pnpm typecheck
```

Targeted Desktop tests:

```text
desktop/src/components/workspace/shell/sidebar/
  use-workspace-sidebar-billing-badge.test.ts
desktop/src/components/settings/panes/BillingPane.test.tsx
  - existing tests pass with billing envelope shape
```

Manual smoke:

```text
1. Wake gate fails with exhausted credits
   - org's grants are zero remaining; no overage enabled
   - user clicks "Continue remotely" on a personal workspace
     (forces a wake-required start_session)
   - command lands queued
   - wake job runs; authorize_sandbox_start returns
     allowed=false reason=credits_exhausted
   - command transitions to failed_delivery
     sandbox_wake_blocked credits_exhausted
   - web UI shows the typed error and a "Buy refill" CTA
     deep-linking to Stripe portal

2. Pro upgrade increases managed-credit budget
   - org upgrades from Free to Pro via Stripe checkout
   - webhook customer.subscription.created fires
   - subscription tier change triggers agent_gateway_budget_reconcile
   - LiteLLM team max_budget reflects the Pro value within ~30s
   - gateway requests stop returning credits_exhausted

3. Subscription cancel downgrades at period end
   - org cancels Pro
   - webhook customer.subscription.updated fires
     (cancel_at_period_end=true)
   - included_budget_usd stays at Pro value until current_period_end
   - at period_end (next webhook + reconciler tick),
     included_budget_usd drops to free value

4. Free trial GitHub dedup
   - user signs up account A, links GitHub, gets free trial
   - user creates account B, links the same GitHub
   - free trial issuance on B returns
     github_identity_already_used
   - account A's grants are unaffected

5. Workspace listing includes billing envelope
   - GET /v1/cloud/workspaces?scope=exposed returns each
     workspace with a billing field
   - workspace whose subject has an active hold shows
     block_status='blocked' and the typed reason

6. Web Billing pane
   - logged-in user opens app.proliferate.ai/settings
   - sees Billing section with hours used, plan name,
     manage/upgrade buttons
   - clicking Manage opens Stripe portal in new tab

7. E2B timeout cleans up
   - simulate timeout event (production: sandbox idle past TTL)
   - usage_segment closes with closed_by='webhook_timeout'
   - sandbox.status='paused'
   - usage_segment ended_at matches event.timestamp
   - no billing_hold inserted
```

## 10. Open Questions

1. **Should the free trial dedup also gate `team_trial`?**

   V1 only `personal_free` is in use. `team_trial` would gate
   when teams get a trial. Bias: yes, mirror the personal logic
   when team trial ships; same table, different `allocation_kind`.

2. **`customer.subscription.deleted` is reason-sensitive.**

   The current handler always applies a payment_failed hold. That's
   wrong for clean cancellations. Refined rule:

   ```text
   - Scheduled cancel reaches period end (cancel_at_period_end=true
     terminating naturally):
       downgrade now (no managed-credit budget refresh delay; we
       are at the period boundary anyway). NO payment_failed hold.

   - Payment failure / Stripe deletion driven by unpaid state
     (subscription.status was 'unpaid' or 'past_due' before
     deletion):
       apply payment_failed hold. Keep current managed-credit
       budget until current_period_end (already paid for).
       At period_end the budget downgrades anyway.

   - Immediate admin/user cancellation before period end
     (Stripe effective_at < current_period_end):
       honor Stripe's effective end. If no paid entitlement
       remains for the rest of the period, downgrade immediately.
       Apply payment_failed hold only if the cancellation was
       driven by a payment problem.
   ```

   The handler reads `subscription.cancellation_details.reason`
   from Stripe (when set) plus the prior `subscription.status` to
   decide.

3. **Mobile billing UI in V1?**

   No. Spec 08 already deferred. Mobile users tap a "Manage in
   web" deep-link that opens app.proliferate.ai/settings on the
   browser (which then opens Stripe portal).

4. **Should the GitHub-identity dedup also apply to anonymous-
   to-authenticated transitions (e.g. user signs up email-first
   then links GitHub)?**

   Yes, at link-time — but **do not refuse the GitHub link
   itself**. The dedup check denies the *free trial allocation*,
   not the identity link.

   Concretely, on the GitHub-link path:
     1. Link the OAuth identity normally. (Cross-account linking
        of the same GitHub identity to a second Proliferate user
        is handled by the auth-identity uniqueness path, which is
        a separate concern.)
     2. After linking, run `ensure_free_cloud_allocation` for the
        user's billing subject.
     3. If the GitHub identity has already allocated a free trial
        on a different `billing_subject_id`: do NOT issue a new
        `free_trial_v2` grant. Surface
        `github_identity_already_used` in the UI so the user
        knows why they aren't on the trial. The link itself
        remains intact.

   This protects against the "create account with email,
   exhaust trial, link GitHub later" abuse without blocking
   legitimate identity linking (e.g. a user adopting GitHub
   sign-in for an account whose trial is already in flight on a
   matching identity).

5. **Should `invoice.upcoming` and `trial_will_end` immediately
   publish billing patches, or batch?**

   Bias: immediate publish. UI surfaces these as banners; latency
   matters more than throughput here.

6. **Should the LLM credits hard cap stay forever, or is V2
   overage path eventually allowed?**

   Spec 02 §1 keeps managed LLM credits hard-capped. V2 with
   per-org spend cap + opt-in overage is conceivable; deferred to
   product decision. Schema is forward-compatible (the
   `agent_gateway_budget_subject` already has a `status` enum
   that can grow `overage_enabled` later).

7. **Should the new `agent_gateway_managed_budget_*_usd` settings
   be per-deployment (self-hosted operators choose) or per-plan
   constants?**

   Both. Plan constants are the canonical defaults; per-deploy
   settings override (especially useful for self-hosted who may
   ship without managed credits at all). Existing pattern in
   `policy.py` and constants matches.
