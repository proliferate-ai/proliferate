"""Billing-related constants."""

from decimal import Decimal

FREE_INCLUDED_GRANT_TYPE = "free_included"
FREE_TRIAL_V2_GRANT_TYPE = "free_trial_v2"
FREE_CLOUD_ALLOCATION_KIND_PERSONAL_TRIAL = "personal_trial"
FREE_CLOUD_ALLOCATION_KIND_AGENT_GATEWAY_FREE_CREDITS = "agent_gateway_free_credits"
FREE_CLOUD_ALLOCATION_PERIOD_V2 = "trial_v2"
MONTHLY_CLOUD_GRANT_TYPE = "cloud_monthly"
PRO_PERIOD_GRANT_TYPE = "pro_period"
PRO_SEAT_PRORATION_GRANT_TYPE = "pro_seat_proration"
REFILL_10H_GRANT_TYPE = "refill_10h"
UNLIMITED_CLOUD_ENTITLEMENT = "unlimited_cloud"

BILLING_PLAN_FREE = "free"
BILLING_PLAN_PRO = "pro"
BILLING_PLAN_LEGACY_CLOUD = "legacy_cloud"
BILLING_PRICE_CLASS_PRO = "pro"
BILLING_PRICE_CLASS_LEGACY_CLOUD = "legacy_cloud"
BILLING_PRICE_CLASS_UNKNOWN = "unknown"

# Stripe ``invoice.billing_reason`` values that mean "a new subscription period
# began", and so are the only ones that may mint the period's seat allowance.
# A mid-period seat change also produces a PAID invoice carrying a cloud
# subscription line, but its allowance is prorated and issued separately by the
# seat-adjustment pass (``PRO_SEAT_PRORATION_GRANT_TYPE``) — granting a second,
# full-period allowance for it is a double allocation. See W-F2.
BILLING_PERIOD_GRANT_INVOICE_REASONS = frozenset(
    {"subscription_create", "subscription_cycle"},
)
# Reasons we affirmatively know do NOT open a period, so skipping the grant for
# them is ordinary expected traffic. Kept as its own set rather than inferred as
# "everything else": the failure direction of this gate is a paid invoice that
# mints NOTHING, so an unrecognized reason — including a missing one — has to be
# loud instead of silently sharing the expected path. Stripe adding a reason, or
# an API version that stops sending the field, would otherwise zero out every
# renewal for every paying org with only an info log to show for it.
#
# Checked against the full ``invoice.billing_reason`` enum in Stripe's OpenAPI
# spec (2026-06-24.dahlia), which has nine values. The two above plus these six
# account for eight. The ninth, ``subscription``, is deliberately in NEITHER
# set: Stripe retired it for subscriptions created before May 2018, when no
# distinction was drawn between cycles, updates and thresholds. Because it could
# stand in for a *cycle*, classifying it benign would silently skip a real
# period grant — the one failure direction this split exists to prevent — so it
# stays unrecognized and pages. It cannot occur here in any case: every
# subscription we have was created in 2026.
BILLING_NON_PERIOD_INVOICE_REASONS = frozenset(
    {
        "subscription_update",
        "subscription_threshold",
        "manual",
        "upcoming",
        "quote_accept",
        "automatic_pending_invoice_item_invoice",
    },
)

PRO_SEAT_MONTHLY_AMOUNT_CENTS = 2000
# Each active billed seat ($20/mo) allocates a $5 managed-LLM contribution and a
# $15-equivalent compute contribution into two *separate* shared org pools. The
# compute allocation is expressed in dollars (not flat hours): metered
# sandbox-hours are derived at grant time from the configured compute price
# (E2B list price x margin multiplier), so the dollar value survives provider
# price changes. See ``server/billing/pricing.py`` for the derivation helpers
# and ``domain/seats.py`` / ``domain/accounting.py`` for the pure math.
PRO_LLM_ALLOCATION_USD_PER_SEAT = Decimal("5")
PRO_COMPUTE_ALLOCATION_USD_PER_SEAT = Decimal("15")
# Default overage exposure is a flat org/month cap (not per-seat): at cap,
# compute pauses (WORKSPACE_ACTION_BLOCK_KIND_CAP_EXHAUSTED) rather than
# auto-writing-off usage. A per-subject ``overage_cap_cents_per_seat`` override
# is reinterpreted as an org-level cap value when set.
PRO_DEFAULT_OVERAGE_CAP_CENTS_PER_ORG_MONTH = 5000
PRO_ACTIVE_ENVIRONMENTS_PER_SEAT = 2
PRO_REPO_ENVIRONMENTS_PER_SEAT = 4
PRO_FREE_TRIAL_HOURS = 1.0
PRO_FREE_ACTIVE_ENVIRONMENT_LIMIT = 1
PRO_OVERAGE_CAP_CENTS_PER_SEAT_MAX = 1_000_000

BILLING_SUBJECT_KIND_PERSONAL = "personal"
BILLING_SUBJECT_KIND_ORGANIZATION = "organization"
BILLING_HOLD_KIND_PAYMENT_FAILED = "payment_failed"
BILLING_HOLD_KIND_ADMIN_HOLD = "admin_hold"
BILLING_HOLD_KIND_EXTERNAL_BILLING_HOLD = "external_billing_hold"
BILLING_HOLD_STATUS_ACTIVE = "active"

BILLING_MODE_OFF = "off"
BILLING_MODE_OBSERVE = "observe"
BILLING_MODE_ENFORCE = "enforce"
BILLING_MODES: frozenset[str] = frozenset(
    {BILLING_MODE_OFF, BILLING_MODE_OBSERVE, BILLING_MODE_ENFORCE}
)
USAGE_SEGMENT_RECENT_LOOKBACK_DAYS = 90
BILLING_PERIOD_ROLLOVER_GRACE_SECONDS = 24 * 60 * 60
STRIPE_METER_EVENT_MAX_PAST_SECONDS = 35 * 24 * 60 * 60
STRIPE_METER_EVENT_MAX_FUTURE_SECONDS = 5 * 60

# CloudSandboxStatus values ("creating"/"ready") that consume compute; the
# pre-#803/#809 lifecycle names (allocating/provisioning/running) no longer
# exist on cloud_sandbox rows.
ACTIVE_SANDBOX_STATUSES: frozenset[str] = frozenset({"creating", "ready"})

USAGE_SEGMENT_OPENED_BY_PROVISION = "provision"
USAGE_SEGMENT_OPENED_BY_RESUME = "resume"
USAGE_SEGMENT_OPENED_BY_WEBHOOK_RESUMED = "webhook_resumed"
USAGE_SEGMENT_OPENED_BY_RECONCILER_REPAIR = "reconciler_repair"
USAGE_SEGMENT_OPENED_BY_VALUES: frozenset[str] = frozenset(
    {
        USAGE_SEGMENT_OPENED_BY_PROVISION,
        USAGE_SEGMENT_OPENED_BY_RESUME,
        USAGE_SEGMENT_OPENED_BY_WEBHOOK_RESUMED,
        USAGE_SEGMENT_OPENED_BY_RECONCILER_REPAIR,
    }
)

USAGE_SEGMENT_CLOSED_BY_MANUAL_STOP = "manual_stop"
USAGE_SEGMENT_CLOSED_BY_DESTROY = "destroy"
USAGE_SEGMENT_CLOSED_BY_WEBHOOK_PAUSED = "webhook_paused"
USAGE_SEGMENT_CLOSED_BY_WEBHOOK_KILLED = "webhook_killed"
USAGE_SEGMENT_CLOSED_BY_WEBHOOK_TIMEOUT = "webhook_timeout"
USAGE_SEGMENT_CLOSED_BY_RECONCILER = "reconciler"
USAGE_SEGMENT_CLOSED_BY_PROVISION_FAILURE = "provision_failure"
USAGE_SEGMENT_CLOSED_BY_QUOTA_ENFORCEMENT = "quota_enforcement"
USAGE_SEGMENT_CLOSED_BY_BINDING_CONVERGENCE = "binding_convergence"
USAGE_SEGMENT_CLOSED_BY_VALUES: frozenset[str] = frozenset(
    {
        USAGE_SEGMENT_CLOSED_BY_MANUAL_STOP,
        USAGE_SEGMENT_CLOSED_BY_DESTROY,
        USAGE_SEGMENT_CLOSED_BY_WEBHOOK_PAUSED,
        USAGE_SEGMENT_CLOSED_BY_WEBHOOK_KILLED,
        USAGE_SEGMENT_CLOSED_BY_WEBHOOK_TIMEOUT,
        USAGE_SEGMENT_CLOSED_BY_RECONCILER,
        USAGE_SEGMENT_CLOSED_BY_PROVISION_FAILURE,
        USAGE_SEGMENT_CLOSED_BY_QUOTA_ENFORCEMENT,
        USAGE_SEGMENT_CLOSED_BY_BINDING_CONVERGENCE,
    }
)

PROVIDER_EVENT_KIND_CREATED = "created"
PROVIDER_EVENT_KIND_RESUMED = "resumed"
PROVIDER_EVENT_KIND_PAUSED = "paused"
PROVIDER_EVENT_KIND_TIMEOUT = "timeout"
PROVIDER_EVENT_KIND_KILLED = "killed"
PROVIDER_EVENT_KIND_PRECEDENCE: dict[str, int] = {
    PROVIDER_EVENT_KIND_CREATED: 1,
    PROVIDER_EVENT_KIND_RESUMED: 2,
    PROVIDER_EVENT_KIND_PAUSED: 3,
    PROVIDER_EVENT_KIND_TIMEOUT: 4,
    PROVIDER_EVENT_KIND_KILLED: 5,
}

WORKSPACE_ACTION_BLOCK_KIND_BILLING_QUOTA = "billing_quota"
WORKSPACE_ACTION_BLOCK_KIND_CONCURRENCY_LIMIT = "concurrency_limit"
WORKSPACE_ACTION_BLOCK_KIND_CREDITS_EXHAUSTED = "credits_exhausted"
WORKSPACE_ACTION_BLOCK_KIND_OVERAGE_DISABLED = "overage_disabled"
WORKSPACE_ACTION_BLOCK_KIND_CAP_EXHAUSTED = "cap_exhausted"
WORKSPACE_ACTION_BLOCK_KIND_PAYMENT_FAILED = "payment_failed"
WORKSPACE_ACTION_BLOCK_KIND_ADMIN_HOLD = "admin_hold"
WORKSPACE_ACTION_BLOCK_KIND_EXTERNAL_BILLING_HOLD = "external_billing_hold"

BILLING_DECISION_AUTHORIZE_START = "authorize_start"
BILLING_DECISION_ENFORCE_ACTIVE_SPEND = "enforce_active_spend"
BILLING_DECISION_OVERAGE_EXPORT = "overage_export"
# Org budget-limit (billing_budget_limit) compute-cap pauses, distinct from the
# grant/overage ``enforce_active_spend`` hold.
BILLING_DECISION_USER_LIMIT_PAUSE = "user_limit_pause"
BILLING_DECISION_ORG_LIMIT_PAUSE = "org_limit_pause"
# Law N6 (corridor E6): the enforcement gate could not READ billing state (DB
# error, resolver blowup). The denial is recorded under its own decision type so
# an operator can tell "billing said no" apart from "billing was unreadable" in
# billing_decision_event without joining logs.
BILLING_DECISION_READ_UNAVAILABLE = "billing_read_unavailable"

BILLING_USAGE_EXPORT_STATUS_PENDING = "pending"
BILLING_USAGE_EXPORT_STATUS_OBSERVED = "observed"
BILLING_USAGE_EXPORT_STATUS_SENDING = "sending"
BILLING_USAGE_EXPORT_STATUS_SUCCEEDED = "succeeded"
BILLING_USAGE_EXPORT_STATUS_FAILED_RETRYABLE = "failed_retryable"
BILLING_USAGE_EXPORT_STATUS_FAILED_TERMINAL = "failed_terminal"
BILLING_USAGE_EXPORT_STATUS_WRITTEN_OFF = "written_off"

# Receipt reason for an accounting pass whose uncovered slice was refused by the
# org-month overage cap. The slice is paused, not billed and not auto-written-off
# (write-off is operator-only, ruled 2026-07-14), but law A2 forbids dropping it
# silently: the pass records this durable decision receipt instead.
BILLING_DECISION_REASON_OVERAGE_CAP_REACHED = "overage_cap_reached"

BILLING_RECONCILE_INTERVAL_SECONDS = 900
BILLING_SEAT_ADJUSTMENT_MAX_ATTEMPTS = 3

# Single global advisory lock for the billing reconciler loop.
BILLING_RECONCILER_LOCK_KEY = 4_203_901
