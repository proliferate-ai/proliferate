"""Billing service layer."""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from proliferate.config import settings
from proliferate.constants.billing import (
    ACTIVE_SANDBOX_STATUSES,
    BILLING_DECISION_AUTHORIZE_START,
    BILLING_DECISION_OVERAGE_EXPORT,
    BILLING_HOLD_KIND_ADMIN_HOLD,
    BILLING_HOLD_KIND_EXTERNAL_BILLING_HOLD,
    BILLING_HOLD_KIND_PAYMENT_FAILED,
    BILLING_MODE_ENFORCE,
    BILLING_MODE_OBSERVE,
    BILLING_MODE_OFF,
    BILLING_USAGE_EXPORT_STATUS_FAILED_TERMINAL,
    BILLING_USAGE_EXPORT_STATUS_OBSERVED,
    BILLING_USAGE_EXPORT_STATUS_SUCCEEDED,
    FREE_INCLUDED_GRANT_TYPE,
    MONTHLY_CLOUD_GRANT_TYPE,
    REFILL_10H_GRANT_TYPE,
    UNLIMITED_CLOUD_ENTITLEMENT,
    WORKSPACE_ACTION_BLOCK_KIND_ADMIN_HOLD,
    WORKSPACE_ACTION_BLOCK_KIND_CONCURRENCY_LIMIT,
    WORKSPACE_ACTION_BLOCK_KIND_CREDITS_EXHAUSTED,
    WORKSPACE_ACTION_BLOCK_KIND_EXTERNAL_BILLING_HOLD,
    WORKSPACE_ACTION_BLOCK_KIND_PAYMENT_FAILED,
)
from proliferate.constants.organizations import ORGANIZATION_ROLE_ADMIN, ORGANIZATION_ROLE_OWNER
from proliferate.db.models.auth import User
from proliferate.db.models.billing import (
    BillingEntitlement,
    BillingGrant,
    BillingHold,
    BillingSubscription,
    UsageSegment,
)
from proliferate.db.store.billing import (
    BillingAccountingResult,
    BillingSnapshotState,
    account_usage_for_billing_subject,
    bind_stripe_customer_to_billing_subject,
    claim_usage_exports_for_sending,
    get_or_create_stripe_customer_state_for_organization,
    get_or_create_stripe_customer_state_for_user,
    list_billing_subject_ids_for_usage_accounting,
    load_billing_snapshot_state,
    load_billing_snapshot_state_for_subject,
    mark_usage_export_failed,
    mark_usage_export_succeeded,
    record_billing_decision_event,
    resolve_billing_subject_id_for_workspace,
    set_overage_enabled_for_subject,
    set_overage_enabled_for_user,
)
from proliferate.db.store.organizations import load_organization_by_billing_subject
from proliferate.integrations.billing import stripe as stripe_billing
from proliferate.server.billing.models import (
    BillingOverview,
    BillingServiceError,
    BillingSnapshot,
    BillingUrlResponse,
    CloudPlanInfo,
    OverageSettingsResponse,
    PlanInfo,
    SandboxStartAuthorization,
    coerce_utc,
    duration_seconds,
    utcnow,
)
from proliferate.server.organizations.service import (
    OrganizationServiceError,
    OwnerContext,
    OwnerSelection,
    require_org_role,
    resolve_owner_context,
)

_ACTIVE_HOLD_REASONS: dict[str, str] = {
    BILLING_HOLD_KIND_PAYMENT_FAILED: WORKSPACE_ACTION_BLOCK_KIND_PAYMENT_FAILED,
    BILLING_HOLD_KIND_ADMIN_HOLD: WORKSPACE_ACTION_BLOCK_KIND_ADMIN_HOLD,
    BILLING_HOLD_KIND_EXTERNAL_BILLING_HOLD: WORKSPACE_ACTION_BLOCK_KIND_EXTERNAL_BILLING_HOLD,
}

_HEALTHY_STRIPE_SUBSCRIPTION_STATUSES = {"active", "trialing"}
_PERIOD_ROLLOVER_GRACE_SECONDS = 24 * 60 * 60
_STRIPE_METER_EVENT_MAX_PAST_SECONDS = 35 * 24 * 60 * 60
_STRIPE_METER_EVENT_MAX_FUTURE_SECONDS = 5 * 60

logger = logging.getLogger("proliferate.billing.service")


@dataclass(frozen=True)
class UnlimitedCloudHoursState:
    subscription: BillingSubscription | None
    manual_entitlement: BillingEntitlement | None
    has_unlimited_cloud_hours: bool
    unlimited_window_start: datetime | None


def _grant_is_active(grant: BillingGrant, now: datetime) -> bool:
    effective_at = coerce_utc(grant.effective_at) or now
    expires_at = coerce_utc(grant.expires_at)
    return effective_at <= now and (expires_at is None or expires_at > now)


def _entitlement_is_active(entitlement: BillingEntitlement, now: datetime) -> bool:
    effective_at = coerce_utc(entitlement.effective_at) or now
    expires_at = coerce_utc(entitlement.expires_at)
    return effective_at <= now and (expires_at is None or expires_at > now)


def _active_unlimited_cloud_entitlement(
    entitlements: list[BillingEntitlement],
    now: datetime,
) -> BillingEntitlement | None:
    active_entitlements = [
        entitlement
        for entitlement in entitlements
        if (
            entitlement.kind == UNLIMITED_CLOUD_ENTITLEMENT
            and _entitlement_is_active(entitlement, now)
        )
    ]
    if not active_entitlements:
        return None
    # Earliest active entitlement gives the accounting split the widest
    # unlimited window and avoids finite accounting in the middle of entitlement coverage.
    return min(
        active_entitlements,
        key=lambda entitlement: (
            coerce_utc(entitlement.effective_at) or now,
            coerce_utc(entitlement.created_at) or now,
        ),
    )


def _subscription_unlimited_window_start(
    subscription: BillingSubscription,
    now: datetime,
) -> datetime | None:
    # Local creation time is stable across Stripe renewals; current_period_start rolls monthly.
    created_at = coerce_utc(subscription.created_at)
    if created_at is not None and created_at <= now:
        return created_at
    period_start = coerce_utc(subscription.current_period_start)
    if period_start is not None and period_start <= now:
        return period_start
    return None


def _compute_unlimited_cloud_hours_state(
    *,
    subscriptions: list[BillingSubscription],
    entitlements: list[BillingEntitlement],
    now: datetime,
) -> UnlimitedCloudHoursState:
    subscription = _latest_healthy_cloud_subscription(subscriptions, now)
    manual_entitlement = _active_unlimited_cloud_entitlement(entitlements, now)
    unlimited_boundaries = [
        boundary
        for boundary in (
            (
                _subscription_unlimited_window_start(subscription, now)
                if subscription is not None
                else None
            ),
            (
                coerce_utc(manual_entitlement.effective_at)
                if manual_entitlement is not None
                else None
            ),
        )
        if boundary is not None and boundary <= now
    ]
    return UnlimitedCloudHoursState(
        subscription=subscription,
        manual_entitlement=manual_entitlement,
        has_unlimited_cloud_hours=subscription is not None or manual_entitlement is not None,
        unlimited_window_start=min(unlimited_boundaries) if unlimited_boundaries else None,
    )


def _hold_reason(holds: list[BillingHold]) -> str | None:
    for hold in holds:
        reason = _ACTIVE_HOLD_REASONS.get(hold.kind)
        if reason is not None:
            return reason
    return None


def _subscription_is_cloud(subscription: BillingSubscription) -> bool:
    configured_price_id = settings.stripe_cloud_monthly_price_id
    if not configured_price_id:
        return False
    return subscription.cloud_monthly_price_id == configured_price_id


def _subscription_is_healthy(subscription: BillingSubscription, now: datetime) -> bool:
    if subscription.status not in _HEALTHY_STRIPE_SUBSCRIPTION_STATUSES:
        return False
    period_end = coerce_utc(subscription.current_period_end)
    if period_end is None:
        return True
    grace_end = period_end.timestamp() + _PERIOD_ROLLOVER_GRACE_SECONDS
    return now.timestamp() <= grace_end


def _subscription_in_rollover_grace(
    subscription: BillingSubscription | None,
    now: datetime,
) -> bool:
    if subscription is None or subscription.status not in _HEALTHY_STRIPE_SUBSCRIPTION_STATUSES:
        return False
    period_end = coerce_utc(subscription.current_period_end)
    if period_end is None or now <= period_end:
        return False
    grace_end = period_end.timestamp() + _PERIOD_ROLLOVER_GRACE_SECONDS
    return now.timestamp() <= grace_end


def _latest_healthy_cloud_subscription(
    subscriptions: list[BillingSubscription],
    now: datetime,
) -> BillingSubscription | None:
    healthy = [
        subscription
        for subscription in subscriptions
        if _subscription_is_cloud(subscription) and _subscription_is_healthy(subscription, now)
    ]
    if not healthy:
        return None
    return max(
        healthy,
        key=lambda subscription: (
            coerce_utc(subscription.current_period_end) or datetime.min.replace(tzinfo=UTC),
            coerce_utc(subscription.updated_at) or datetime.min.replace(tzinfo=UTC),
        ),
    )


def repo_limit_for_billing_snapshot(snapshot: BillingSnapshot) -> int | None:
    if snapshot.billing_mode == BILLING_MODE_OFF:
        return None
    if snapshot.is_paid_cloud or snapshot.has_unlimited_cloud_hours:
        return settings.cloud_paid_repo_limit
    return settings.cloud_free_repo_limit


def _grant_applies_to_paid_state(grant: BillingGrant, *, is_paid_cloud: bool) -> bool:
    if is_paid_cloud:
        return grant.grant_type in {
            MONTHLY_CLOUD_GRANT_TYPE,
            FREE_INCLUDED_GRANT_TYPE,
            REFILL_10H_GRANT_TYPE,
        }
    return grant.grant_type in {FREE_INCLUDED_GRANT_TYPE, REFILL_10H_GRANT_TYPE}


def _segment_seconds(segment: UsageSegment, now: datetime) -> float:
    return duration_seconds(
        started_at=segment.started_at,
        ended_at=segment.ended_at,
        now=now,
    )


async def get_billing_snapshot(user_id: UUID) -> BillingSnapshot:
    state = await load_billing_snapshot_state(user_id)
    return _build_billing_snapshot(state)


async def get_billing_snapshot_for_subject(billing_subject_id: UUID) -> BillingSnapshot:
    state = await load_billing_snapshot_state_for_subject(billing_subject_id)
    return _build_billing_snapshot(state)


def _build_billing_snapshot(state: BillingSnapshotState) -> BillingSnapshot:
    now = utcnow()
    used_seconds = state.historical_billable_seconds + sum(
        _segment_seconds(segment, now) for segment in state.usage_segments
    )
    unlimited_state = _compute_unlimited_cloud_hours_state(
        subscriptions=state.subscriptions,
        entitlements=state.entitlements,
        now=now,
    )
    healthy_subscription = unlimited_state.subscription
    is_paid_cloud = healthy_subscription is not None
    payment_healthy = is_paid_cloud
    eligible_grants = [
        grant
        for grant in state.grants
        if _grant_applies_to_paid_state(grant, is_paid_cloud=is_paid_cloud)
    ]
    active_grants = [grant for grant in eligible_grants if _grant_is_active(grant, now)]
    included_seconds = sum(max(grant.hours_granted * 3600.0, 0.0) for grant in active_grants)
    stored_remaining_seconds = sum(
        max(float(grant.remaining_seconds), 0.0) for grant in active_grants
    )
    remaining_seconds = max(
        stored_remaining_seconds - state.unaccounted_billable_seconds,
        0.0,
    )

    active_manual_unlimited = unlimited_state.manual_entitlement is not None
    has_unlimited_cloud_hours = unlimited_state.has_unlimited_cloud_hours
    remaining_seconds_value = None if has_unlimited_cloud_hours else max(remaining_seconds, 0.0)

    active_sandbox_count = sum(
        1 for sandbox in state.sandboxes if sandbox.status in ACTIVE_SANDBOX_STATUSES
    )

    rollover_grace = _subscription_in_rollover_grace(healthy_subscription, now)
    over_quota = not has_unlimited_cloud_hours and remaining_seconds <= 0 and not rollover_grace
    # Overage plumbing is intentionally retained for legacy/refill controls and possible
    # future finite paid plans; flat paid Cloud makes this false today.
    paid_overage_allowed = (
        not has_unlimited_cloud_hours
        and is_paid_cloud
        and state.subject.overage_enabled
        and payment_healthy
    )
    concurrent_sandbox_limit = None if is_paid_cloud else settings.cloud_concurrent_sandbox_limit
    concurrency_limited = (
        concurrent_sandbox_limit is not None and active_sandbox_count >= concurrent_sandbox_limit
    )
    hold_reason = _hold_reason(state.holds)
    credit_reason = (
        WORKSPACE_ACTION_BLOCK_KIND_CREDITS_EXHAUSTED
        if over_quota and not paid_overage_allowed
        else None
    )
    concurrency_reason = (
        WORKSPACE_ACTION_BLOCK_KIND_CONCURRENCY_LIMIT if concurrency_limited else None
    )
    start_block_reason = hold_reason or credit_reason or concurrency_reason
    active_spend_hold_reason = hold_reason or credit_reason
    start_blocked = start_block_reason is not None
    active_spend_hold = active_spend_hold_reason is not None

    return BillingSnapshot(
        billing_subject_id=state.billing_subject_id,
        plan="cloud" if is_paid_cloud else ("unlimited" if active_manual_unlimited else "free"),
        billing_mode=settings.cloud_billing_mode,
        is_unlimited=active_manual_unlimited,
        has_unlimited_cloud_hours=has_unlimited_cloud_hours,
        over_quota=over_quota,
        is_paid_cloud=is_paid_cloud,
        payment_healthy=payment_healthy,
        overage_enabled=state.subject.overage_enabled,
        included_hours=None if has_unlimited_cloud_hours else included_seconds / 3600.0,
        used_hours=used_seconds / 3600.0,
        remaining_hours=(None if has_unlimited_cloud_hours else remaining_seconds_value / 3600.0),
        cloud_repo_limit=(
            settings.cloud_paid_repo_limit
            if is_paid_cloud or has_unlimited_cloud_hours
            else settings.cloud_free_repo_limit
        ),
        active_cloud_repo_count=state.active_cloud_repo_count,
        concurrent_sandbox_limit=concurrent_sandbox_limit,
        active_sandbox_count=active_sandbox_count,
        start_blocked=start_blocked,
        start_block_reason=start_block_reason,
        active_spend_hold=active_spend_hold,
        hold_reason=active_spend_hold_reason,
        remaining_seconds=remaining_seconds_value,
        hosted_invoice_url=(
            healthy_subscription.hosted_invoice_url if healthy_subscription is not None else None
        ),
    )


def _authorization_message(reason: str | None) -> str | None:
    if reason == WORKSPACE_ACTION_BLOCK_KIND_CONCURRENCY_LIMIT:
        return (
            "Sandbox limit reached. Archive or delete another cloud workspace before "
            "starting a new one."
        )
    if reason == WORKSPACE_ACTION_BLOCK_KIND_CREDITS_EXHAUSTED:
        return "Cloud usage is paused because your included sandbox hours are exhausted."
    if reason == WORKSPACE_ACTION_BLOCK_KIND_PAYMENT_FAILED:
        return "Cloud usage is paused because billing needs attention."
    if reason == WORKSPACE_ACTION_BLOCK_KIND_ADMIN_HOLD:
        return "Cloud usage is paused for this account."
    if reason == WORKSPACE_ACTION_BLOCK_KIND_EXTERNAL_BILLING_HOLD:
        return "Cloud usage is paused because billing needs attention."
    return None


async def authorize_sandbox_start(
    *,
    user_id: UUID,
    workspace_id: UUID | None,
) -> SandboxStartAuthorization:
    if workspace_id is None:
        snapshot = await get_billing_snapshot(user_id)
    else:
        billing_subject_id = await resolve_billing_subject_id_for_workspace(workspace_id)
        snapshot = await get_billing_snapshot_for_subject(billing_subject_id)
    enforced = settings.cloud_billing_mode == BILLING_MODE_ENFORCE
    allowed = not enforced or not snapshot.start_blocked
    reason = snapshot.start_block_reason if snapshot.start_blocked else None
    await record_billing_decision_event(
        billing_subject_id=snapshot.billing_subject_id,
        actor_user_id=user_id,
        workspace_id=workspace_id,
        decision_type=BILLING_DECISION_AUTHORIZE_START,
        mode=settings.cloud_billing_mode,
        would_block_start=snapshot.start_blocked,
        would_pause_active=snapshot.active_spend_hold,
        reason=reason,
        active_sandbox_count=snapshot.active_sandbox_count,
        remaining_seconds=snapshot.remaining_seconds,
    )
    return SandboxStartAuthorization(
        allowed=allowed,
        billing_subject_id=snapshot.billing_subject_id,
        start_blocked=snapshot.start_blocked,
        start_block_reason=snapshot.start_block_reason,
        active_spend_hold=snapshot.active_spend_hold,
        hold_reason=snapshot.hold_reason,
        message=_authorization_message(reason),
        active_sandbox_count=snapshot.active_sandbox_count,
        remaining_seconds=snapshot.remaining_seconds,
    )


async def get_billing_overview(user_id: UUID) -> BillingOverview:
    snapshot = await get_billing_snapshot(user_id)
    return BillingOverview(
        plan=snapshot.plan,
        billing_mode=snapshot.billing_mode,
        is_unlimited=snapshot.is_unlimited,
        has_unlimited_cloud_hours=snapshot.has_unlimited_cloud_hours,
        over_quota=snapshot.over_quota,
        included_hours=(
            round(snapshot.included_hours, 2) if snapshot.included_hours is not None else None
        ),
        used_hours=round(snapshot.used_hours, 4),
        remaining_hours=(
            round(snapshot.remaining_hours, 4) if snapshot.remaining_hours is not None else None
        ),
        cloud_repo_limit=snapshot.cloud_repo_limit,
        active_cloud_repo_count=snapshot.active_cloud_repo_count,
        concurrent_sandbox_limit=snapshot.concurrent_sandbox_limit,
        active_sandbox_count=snapshot.active_sandbox_count,
        is_paid_cloud=snapshot.is_paid_cloud,
        payment_healthy=snapshot.payment_healthy,
        overage_enabled=snapshot.overage_enabled,
        hosted_invoice_url=snapshot.hosted_invoice_url,
        start_blocked=snapshot.start_blocked,
        start_block_reason=snapshot.start_block_reason,
        active_spend_hold=snapshot.active_spend_hold,
        hold_reason=snapshot.hold_reason,
    )


async def get_billing_overview_for_owner(
    user: User,
    owner_selection: OwnerSelection,
) -> BillingOverview:
    context = await _resolve_billing_owner_context(user, owner_selection)
    snapshot = await get_billing_snapshot_for_subject(context.billing_subject_id)
    return _billing_overview_from_snapshot(snapshot)


async def get_current_plan(user_id: UUID) -> PlanInfo:
    snapshot = await get_billing_snapshot(user_id)
    return PlanInfo(
        plan=snapshot.plan,
        usage_minutes=int(round(snapshot.used_hours * 60.0)),
    )


async def get_cloud_plan(user_id: UUID) -> CloudPlanInfo:
    snapshot = await get_billing_snapshot(user_id)
    return _cloud_plan_from_snapshot(snapshot)


async def get_cloud_plan_for_owner(
    user: User,
    owner_selection: OwnerSelection,
) -> CloudPlanInfo:
    context = await _resolve_billing_owner_context(user, owner_selection)
    snapshot = await get_billing_snapshot_for_subject(context.billing_subject_id)
    return _cloud_plan_from_snapshot(snapshot)


def _billing_overview_from_snapshot(snapshot: BillingSnapshot) -> BillingOverview:
    return BillingOverview(
        plan=snapshot.plan,
        billing_mode=snapshot.billing_mode,
        is_unlimited=snapshot.is_unlimited,
        has_unlimited_cloud_hours=snapshot.has_unlimited_cloud_hours,
        over_quota=snapshot.over_quota,
        included_hours=(
            round(snapshot.included_hours, 2) if snapshot.included_hours is not None else None
        ),
        used_hours=round(snapshot.used_hours, 4),
        remaining_hours=(
            round(snapshot.remaining_hours, 4) if snapshot.remaining_hours is not None else None
        ),
        cloud_repo_limit=snapshot.cloud_repo_limit,
        active_cloud_repo_count=snapshot.active_cloud_repo_count,
        concurrent_sandbox_limit=snapshot.concurrent_sandbox_limit,
        active_sandbox_count=snapshot.active_sandbox_count,
        is_paid_cloud=snapshot.is_paid_cloud,
        payment_healthy=snapshot.payment_healthy,
        overage_enabled=snapshot.overage_enabled,
        hosted_invoice_url=snapshot.hosted_invoice_url,
        start_blocked=snapshot.start_blocked,
        start_block_reason=snapshot.start_block_reason,
        active_spend_hold=snapshot.active_spend_hold,
        hold_reason=snapshot.hold_reason,
    )


def _cloud_plan_from_snapshot(snapshot: BillingSnapshot) -> CloudPlanInfo:
    return CloudPlanInfo(
        plan=snapshot.plan,
        billing_mode=snapshot.billing_mode,
        is_unlimited=snapshot.is_unlimited,
        has_unlimited_cloud_hours=snapshot.has_unlimited_cloud_hours,
        over_quota=snapshot.over_quota,
        free_sandbox_hours=(
            round(snapshot.included_hours, 2) if snapshot.included_hours is not None else None
        ),
        used_sandbox_hours=round(snapshot.used_hours, 4),
        remaining_sandbox_hours=(
            round(snapshot.remaining_hours, 4) if snapshot.remaining_hours is not None else None
        ),
        cloud_repo_limit=snapshot.cloud_repo_limit,
        active_cloud_repo_count=snapshot.active_cloud_repo_count,
        concurrent_sandbox_limit=snapshot.concurrent_sandbox_limit,
        active_sandbox_count=snapshot.active_sandbox_count,
        is_paid_cloud=snapshot.is_paid_cloud,
        payment_healthy=snapshot.payment_healthy,
        overage_enabled=snapshot.overage_enabled,
        hosted_invoice_url=snapshot.hosted_invoice_url,
        start_blocked=snapshot.start_blocked,
        start_block_reason=snapshot.start_block_reason,
        active_spend_hold=snapshot.active_spend_hold,
        hold_reason=snapshot.hold_reason,
    )


def is_free_included_grant(grant_type: str) -> bool:
    return grant_type == FREE_INCLUDED_GRANT_TYPE


def _map_stripe_error(error: stripe_billing.StripeBillingError) -> BillingServiceError:
    return BillingServiceError(error.code, error.message, status_code=error.status_code)


def _require_redirect_urls() -> tuple[str, str, str]:
    success_url = settings.stripe_checkout_success_url
    cancel_url = settings.stripe_checkout_cancel_url
    portal_return_url = settings.stripe_customer_portal_return_url
    if not (success_url and cancel_url and portal_return_url):
        raise BillingServiceError(
            "stripe_redirect_urls_unconfigured",
            "Stripe redirect URLs are not configured.",
            status_code=503,
        )
    return success_url, cancel_url, portal_return_url


async def _ensure_stripe_customer_for_user(user: User) -> tuple[UUID, str]:
    state = await get_or_create_stripe_customer_state_for_user(user.id)
    if state.stripe_customer_id:
        return state.billing_subject_id, state.stripe_customer_id
    try:
        customer = await stripe_billing.create_customer(
            email=user.email,
            billing_subject_id=str(state.billing_subject_id),
            idempotency_key=f"customer:{state.billing_subject_id}",
        )
    except stripe_billing.StripeBillingError as error:
        raise _map_stripe_error(error) from error
    customer_id = customer.get("id")
    if not isinstance(customer_id, str):
        raise BillingServiceError(
            "stripe_invalid_response",
            "Stripe did not return a customer id.",
            status_code=502,
        )
    state = await bind_stripe_customer_to_billing_subject(
        billing_subject_id=state.billing_subject_id,
        stripe_customer_id=customer_id,
    )
    return state.billing_subject_id, customer_id


async def _resolve_billing_owner_context(
    user: User,
    owner_selection: OwnerSelection,
) -> OwnerContext:
    try:
        return await resolve_owner_context(user, owner_selection)
    except OrganizationServiceError as error:
        raise BillingServiceError(
            error.code,
            error.message,
            status_code=error.status_code,
        ) from error


async def _ensure_stripe_customer_for_owner(
    user: User,
    owner_selection: OwnerSelection,
) -> tuple[UUID, str]:
    context = await _resolve_billing_owner_context(user, owner_selection)
    if context.owner_scope == "organization":
        try:
            require_org_role(context, {ORGANIZATION_ROLE_OWNER, ORGANIZATION_ROLE_ADMIN})
        except OrganizationServiceError as error:
            raise BillingServiceError(
                error.code,
                error.message,
                status_code=error.status_code,
            ) from error
        if context.organization_id is None:
            raise BillingServiceError(
                "organization_not_found",
                "Organization not found.",
                status_code=404,
            )
        state = await get_or_create_stripe_customer_state_for_organization(
            context.organization_id,
        )
        organization = await load_organization_by_billing_subject(state.billing_subject_id)
        customer_name = organization.name if organization is not None else "Organization"
        organization_id = str(context.organization_id)
        created_by_user_id = str(user.id)
    else:
        state = await get_or_create_stripe_customer_state_for_user(user.id)
        customer_name = None
        organization_id = None
        created_by_user_id = None
    if state.stripe_customer_id:
        return state.billing_subject_id, state.stripe_customer_id
    try:
        customer = await stripe_billing.create_customer(
            email=user.email,
            name=customer_name,
            billing_subject_id=str(state.billing_subject_id),
            organization_id=organization_id,
            created_by_user_id=created_by_user_id,
            idempotency_key=f"customer:{state.billing_subject_id}",
        )
    except stripe_billing.StripeBillingError as error:
        raise _map_stripe_error(error) from error
    customer_id = customer.get("id")
    if not isinstance(customer_id, str):
        raise BillingServiceError(
            "stripe_invalid_response",
            "Stripe did not return a customer id.",
            status_code=502,
        )
    state = await bind_stripe_customer_to_billing_subject(
        billing_subject_id=state.billing_subject_id,
        stripe_customer_id=customer_id,
    )
    return state.billing_subject_id, customer_id


async def create_cloud_checkout_session(
    user: User,
    owner_selection: OwnerSelection | None = None,
) -> BillingUrlResponse:
    success_url, cancel_url, portal_return_url = _require_redirect_urls()
    try:
        await stripe_billing.validate_cloud_subscription_price_configuration()
    except stripe_billing.StripeBillingError as error:
        raise _map_stripe_error(error) from error

    subject_id, stripe_customer_id = await _ensure_stripe_customer_for_owner(
        user,
        owner_selection or OwnerSelection(),
    )
    snapshot = await get_billing_snapshot_for_subject(subject_id)
    if snapshot.is_paid_cloud:
        try:
            portal = await stripe_billing.create_customer_portal_session(
                stripe_customer_id=stripe_customer_id,
                return_url=portal_return_url,
                idempotency_key=f"portal:active-cloud:{subject_id}",
            )
        except stripe_billing.StripeBillingError as error:
            raise _map_stripe_error(error) from error
        return BillingUrlResponse(url=portal.url)

    try:
        checkout = await stripe_billing.create_subscription_checkout_session(
            stripe_customer_id=stripe_customer_id,
            billing_subject_id=str(subject_id),
            cloud_monthly_price_id=settings.stripe_cloud_monthly_price_id,
            success_url=success_url,
            cancel_url=cancel_url,
            idempotency_key=f"cloud-checkout:{subject_id}",
        )
    except stripe_billing.StripeBillingError as error:
        raise _map_stripe_error(error) from error
    return BillingUrlResponse(url=checkout.url)


async def create_refill_checkout_session(
    user: User,
    owner_selection: OwnerSelection | None = None,
) -> BillingUrlResponse:
    success_url, cancel_url, _portal_return_url = _require_redirect_urls()
    try:
        await stripe_billing.validate_refill_price_configuration()
    except stripe_billing.StripeBillingError as error:
        raise _map_stripe_error(error) from error
    subject_id, stripe_customer_id = await _ensure_stripe_customer_for_owner(
        user,
        owner_selection or OwnerSelection(),
    )
    try:
        checkout = await stripe_billing.create_refill_checkout_session(
            stripe_customer_id=stripe_customer_id,
            billing_subject_id=str(subject_id),
            refill_price_id=settings.stripe_refill_10h_price_id,
            success_url=success_url,
            cancel_url=cancel_url,
            idempotency_key=f"refill-10h:{subject_id}",
        )
    except stripe_billing.StripeBillingError as error:
        raise _map_stripe_error(error) from error
    return BillingUrlResponse(url=checkout.url)


async def create_customer_portal_session(
    user: User,
    owner_selection: OwnerSelection | None = None,
) -> BillingUrlResponse:
    _success_url, _cancel_url, portal_return_url = _require_redirect_urls()
    subject_id, stripe_customer_id = await _ensure_stripe_customer_for_owner(
        user,
        owner_selection or OwnerSelection(),
    )
    try:
        portal = await stripe_billing.create_customer_portal_session(
            stripe_customer_id=stripe_customer_id,
            return_url=portal_return_url,
            idempotency_key=f"portal:{subject_id}",
        )
    except stripe_billing.StripeBillingError as error:
        raise _map_stripe_error(error) from error
    return BillingUrlResponse(url=portal.url)


async def update_overage_settings(
    user: User,
    *,
    enabled: bool,
    owner_selection: OwnerSelection | None = None,
) -> OverageSettingsResponse:
    selection = owner_selection or OwnerSelection()
    if selection.owner_scope == "personal":
        await set_overage_enabled_for_user(user_id=user.id, overage_enabled=enabled)
    else:
        context = await _resolve_billing_owner_context(user, selection)
        try:
            require_org_role(context, {ORGANIZATION_ROLE_OWNER, ORGANIZATION_ROLE_ADMIN})
        except OrganizationServiceError as error:
            raise BillingServiceError(
                error.code,
                error.message,
                status_code=error.status_code,
            ) from error
        await set_overage_enabled_for_subject(
            billing_subject_id=context.billing_subject_id,
            overage_enabled=enabled,
        )
    return OverageSettingsResponse(overage_enabled=enabled)


async def _account_usage_for_snapshot_state(
    state: BillingSnapshotState,
    *,
    scan_until: datetime,
    consume_grants: bool,
    subscription: BillingSubscription | None,
) -> BillingAccountingResult:
    return await account_usage_for_billing_subject(
        billing_subject_id=state.billing_subject_id,
        is_paid_cloud=subscription is not None,
        billing_subscription_id=subscription.id if subscription is not None else None,
        period_start=subscription.current_period_start if subscription is not None else None,
        period_end=subscription.current_period_end if subscription is not None else None,
        overage_enabled=state.subject.overage_enabled if subscription is not None else False,
        billing_mode=settings.cloud_billing_mode,
        consume_grants=consume_grants,
        export_overage=False,
        scan_until=scan_until,
    )


async def run_billing_accounting_pass(*, subject_limit: int = 100) -> None:
    if settings.cloud_billing_mode not in {BILLING_MODE_OBSERVE, BILLING_MODE_ENFORCE}:
        return

    subject_ids = await list_billing_subject_ids_for_usage_accounting(limit=subject_limit)
    for billing_subject_id in subject_ids:
        state = await load_billing_snapshot_state_for_subject(billing_subject_id)
        now = utcnow()
        unlimited_state = _compute_unlimited_cloud_hours_state(
            subscriptions=state.subscriptions,
            entitlements=state.entitlements,
            now=now,
        )
        results = []
        if unlimited_state.has_unlimited_cloud_hours:
            if unlimited_state.unlimited_window_start is not None:
                results.append(
                    await _account_usage_for_snapshot_state(
                        state,
                        scan_until=unlimited_state.unlimited_window_start,
                        consume_grants=True,
                        subscription=None,
                    )
                )
            results.append(
                await _account_usage_for_snapshot_state(
                    state,
                    scan_until=now,
                    consume_grants=False,
                    subscription=unlimited_state.subscription,
                )
            )
        else:
            results.append(
                await _account_usage_for_snapshot_state(
                    state,
                    scan_until=now,
                    consume_grants=True,
                    subscription=None,
                )
            )

        if any(result.export_count > 0 for result in results):
            snapshot = _build_billing_snapshot(state)
            await record_billing_decision_event(
                billing_subject_id=billing_subject_id,
                actor_user_id=None,
                workspace_id=None,
                decision_type=BILLING_DECISION_OVERAGE_EXPORT,
                mode=settings.cloud_billing_mode,
                would_block_start=False,
                would_pause_active=False,
                reason=(
                    BILLING_USAGE_EXPORT_STATUS_OBSERVED
                    if settings.cloud_billing_mode == BILLING_MODE_OBSERVE
                    else "pending"
                ),
                active_sandbox_count=snapshot.active_sandbox_count,
                remaining_seconds=snapshot.remaining_seconds,
            )

    if settings.cloud_billing_mode == BILLING_MODE_ENFORCE:
        await send_pending_usage_exports()


async def send_pending_usage_exports(*, limit: int = 100) -> None:
    if settings.cloud_billing_mode != BILLING_MODE_ENFORCE:
        return

    exports = await claim_usage_exports_for_sending(limit=limit)
    now = utcnow()
    for export in exports:
        terminal_error = _terminal_export_error(export.accounted_until, now=now)
        if not export.stripe_customer_id:
            terminal_error = "Billing subject has no Stripe customer id."
        if terminal_error is not None:
            await mark_usage_export_failed(
                export_id=export.id,
                terminal=True,
                error=terminal_error,
            )
            await _record_usage_export_decision(
                billing_subject_id=export.billing_subject_id,
                reason=BILLING_USAGE_EXPORT_STATUS_FAILED_TERMINAL,
            )
            logger.error(
                "billing usage export failed permanently",
                extra={"billing_usage_export_id": str(export.id), "reason": terminal_error},
            )
            continue

        quantity_seconds = max(1, math.ceil(export.quantity_seconds))
        identifier = f"usage_export:{export.id}"
        try:
            payload = await stripe_billing.create_meter_event(
                event_name=settings.stripe_sandbox_meter_event_name,
                stripe_customer_id=export.stripe_customer_id,
                quantity_seconds=quantity_seconds,
                identifier=identifier,
                timestamp=int((coerce_utc(export.accounted_until) or now).timestamp()),
                idempotency_key=export.idempotency_key,
            )
        except stripe_billing.StripeBillingError as error:
            await mark_usage_export_failed(
                export_id=export.id,
                terminal=False,
                error=error.message,
            )
            await _record_usage_export_decision(
                billing_subject_id=export.billing_subject_id,
                reason="failed_retryable",
            )
            logger.warning(
                "billing usage export failed and will be retried",
                extra={"billing_usage_export_id": str(export.id), "error": error.message},
            )
            continue

        meter_identifier = payload.get("identifier")
        await mark_usage_export_succeeded(
            export_id=export.id,
            stripe_meter_event_identifier=(
                meter_identifier if isinstance(meter_identifier, str) else identifier
            ),
        )
        await _record_usage_export_decision(
            billing_subject_id=export.billing_subject_id,
            reason=BILLING_USAGE_EXPORT_STATUS_SUCCEEDED,
        )


def _terminal_export_error(accounted_until: datetime, *, now: datetime) -> str | None:
    event_time = coerce_utc(accounted_until) or now
    if (now - event_time).total_seconds() > _STRIPE_METER_EVENT_MAX_PAST_SECONDS:
        return "Stripe meter events cannot be created for usage older than 35 days."
    if (event_time - now).total_seconds() > _STRIPE_METER_EVENT_MAX_FUTURE_SECONDS:
        return "Stripe meter events cannot be created more than 5 minutes in the future."
    return None


async def _record_usage_export_decision(*, billing_subject_id: UUID, reason: str) -> None:
    await record_billing_decision_event(
        billing_subject_id=billing_subject_id,
        actor_user_id=None,
        workspace_id=None,
        decision_type=BILLING_DECISION_OVERAGE_EXPORT,
        mode=settings.cloud_billing_mode,
        would_block_start=False,
        would_pause_active=False,
        reason=reason,
        active_sandbox_count=0,
        remaining_seconds=None,
    )
