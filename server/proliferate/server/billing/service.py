"""Billing service layer."""

from __future__ import annotations

import logging
import math
from datetime import datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import OwnerContext, OwnerSelection, require_org_role
from proliferate.config import settings
from proliferate.constants.billing import (
    ACTIVE_SANDBOX_STATUSES,
    BILLING_DECISION_AUTHORIZE_START,
    BILLING_DECISION_OVERAGE_EXPORT,
    BILLING_MODE_ENFORCE,
    BILLING_MODE_OBSERVE,
    BILLING_MODE_OFF,
    BILLING_PLAN_FREE,
    BILLING_PLAN_PRO,
    BILLING_SUBJECT_KIND_PERSONAL,
    BILLING_USAGE_EXPORT_STATUS_FAILED_TERMINAL,
    BILLING_USAGE_EXPORT_STATUS_OBSERVED,
    BILLING_USAGE_EXPORT_STATUS_SUCCEEDED,
    FREE_INCLUDED_GRANT_TYPE,
    FREE_TRIAL_V2_GRANT_TYPE,
    PRO_DEFAULT_OVERAGE_CAP_CENTS_PER_SEAT,
    PRO_OVERAGE_CAP_CENTS_PER_SEAT_MAX,
    PRO_OVERAGE_PRICE_PER_HOUR_CENTS,
    PRO_SEAT_PRORATION_GRANT_TYPE,
    WORKSPACE_ACTION_BLOCK_KIND_CAP_EXHAUSTED,
    WORKSPACE_ACTION_BLOCK_KIND_CONCURRENCY_LIMIT,
    WORKSPACE_ACTION_BLOCK_KIND_CREDITS_EXHAUSTED,
    WORKSPACE_ACTION_BLOCK_KIND_OVERAGE_DISABLED,
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
    claim_pending_seat_adjustments,
    claim_usage_exports_for_sending,
    count_active_seats_for_billing_subject_id,
    ensure_billing_grant_record,
    get_billing_snapshot_state_for_subject,
    get_billing_snapshot_state_for_user,
    get_or_create_organization_stripe_customer_state,
    get_or_create_user_stripe_customer_state,
    list_billing_subject_ids_for_usage_accounting,
    load_billing_snapshot_state,
    load_billing_snapshot_state_for_subject,
    mark_seat_adjustment_failed,
    mark_seat_adjustment_grant_issued,
    mark_seat_adjustment_stripe_confirmed,
    mark_usage_export_failed,
    mark_usage_export_succeeded,
    record_billing_decision_event,
    resolve_billing_subject_id_for_workspace,
    set_overage_policy_for_subject,
    set_overage_policy_for_user,
)
from proliferate.db.store.organizations import (
    get_organization_with_membership,
    load_organization_by_billing_subject,
)
from proliferate.errors import ProliferateError
from proliferate.integrations.billing import stripe as stripe_billing
from proliferate.server.billing.domain.accounting import (
    stripe_status_is_terminal,
    terminal_meter_event_error,
    usage_export_identifier,
)
from proliferate.server.billing.domain.plans import (
    BillingPlanRuleConfig,
    UnlimitedCloudHoursState,
    active_hold_reason,
    authorization_message,
    compute_unlimited_cloud_hours_state,
    grant_applies_to_paid_state,
    grant_is_active,
    repo_limit_for_billing_state,
    subscription_in_rollover_grace,
    subscription_is_pro,
)
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
from proliferate.server.billing.policy import free_v2_policy, pro_policy, unlimited_numeric_policy
from proliferate.server.billing.pricing import (
    billing_price_ids_from_settings,
    configured_managed_cloud_meter_event_name,
    configured_managed_cloud_overage_price_id,
    configured_pro_monthly_price_id,
)
from proliferate.server.billing.seats import (
    prorated_seat_grant_hours,
    seat_proration_grant_source_ref,
)

logger = logging.getLogger("proliferate.billing.service")


def _billing_plan_rule_config() -> BillingPlanRuleConfig:
    return BillingPlanRuleConfig(
        pro_billing_enabled=settings.pro_billing_enabled,
        cloud_monthly_price_id=settings.stripe_cloud_monthly_price_id,
        price_ids=billing_price_ids_from_settings(),
    )


def _grant_is_active(grant: BillingGrant, now: datetime) -> bool:
    return grant_is_active(grant, now)


def _compute_unlimited_cloud_hours_state(
    *,
    subscriptions: list[BillingSubscription],
    entitlements: list[BillingEntitlement],
    now: datetime,
) -> UnlimitedCloudHoursState:
    return compute_unlimited_cloud_hours_state(
        subscriptions=subscriptions,
        entitlements=entitlements,
        now=now,
        config=_billing_plan_rule_config(),
    )


def _hold_reason(holds: list[BillingHold]) -> str | None:
    return active_hold_reason(holds)


def _subscription_is_pro(subscription: BillingSubscription) -> bool:
    return subscription_is_pro(subscription, config=_billing_plan_rule_config())


def _subscription_in_rollover_grace(
    subscription: BillingSubscription | None,
    now: datetime,
) -> bool:
    return subscription_in_rollover_grace(subscription, now)


def repo_limit_for_billing_snapshot(snapshot: BillingSnapshot) -> int | None:
    return repo_limit_for_billing_state(
        billing_mode=snapshot.billing_mode,
        pro_billing_enabled=settings.pro_billing_enabled,
        is_paid_cloud=snapshot.is_paid_cloud,
        has_unlimited_cloud_hours=snapshot.has_unlimited_cloud_hours,
        repo_environment_limit=snapshot.repo_environment_limit,
        paid_cloud_repo_limit=settings.cloud_paid_repo_limit,
        free_cloud_repo_limit=settings.cloud_free_repo_limit,
    )


def _grant_applies_to_paid_state(grant: BillingGrant, *, is_paid_cloud: bool) -> bool:
    return grant_applies_to_paid_state(
        grant.grant_type,
        is_paid_cloud=is_paid_cloud,
        pro_billing_enabled=settings.pro_billing_enabled,
    )


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


async def _get_billing_snapshot_for_request(
    db: AsyncSession,
    user_id: UUID,
) -> BillingSnapshot:
    state = await get_billing_snapshot_state_for_user(db, user_id)
    return _build_billing_snapshot(state)


async def _get_billing_snapshot_for_subject_request(
    db: AsyncSession,
    billing_subject_id: UUID,
) -> BillingSnapshot:
    state = await get_billing_snapshot_state_for_subject(db, billing_subject_id)
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
    is_pro_subscription = (
        settings.pro_billing_enabled
        and healthy_subscription is not None
        and _subscription_is_pro(healthy_subscription)
    )
    active_manual_unlimited = unlimited_state.manual_entitlement is not None
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

    has_unlimited_cloud_hours = unlimited_state.has_unlimited_cloud_hours
    remaining_seconds_value = None if has_unlimited_cloud_hours else max(remaining_seconds, 0.0)

    active_sandbox_count = sum(
        1 for sandbox in state.sandboxes if sandbox.status in ACTIVE_SANDBOX_STATUSES
    )

    if settings.pro_billing_enabled:
        if is_pro_subscription:
            numeric_policy = pro_policy(
                billable_seat_count=state.active_seat_count,
                overage_cap_cents_per_seat=state.subject.overage_cap_cents_per_seat,
            )
        elif has_unlimited_cloud_hours:
            numeric_policy = unlimited_numeric_policy(byo_runtime_allowed=True)
        else:
            numeric_policy = free_v2_policy()
    else:
        numeric_policy = None

    rollover_grace = _subscription_in_rollover_grace(healthy_subscription, now)
    over_quota = not has_unlimited_cloud_hours and remaining_seconds <= 0 and not rollover_grace
    managed_cloud_overage_cap_cents = (
        numeric_policy.managed_cloud_overage_cap_cents if numeric_policy is not None else None
    )
    cap_exhausted = (
        is_pro_subscription
        and managed_cloud_overage_cap_cents is not None
        and state.managed_cloud_overage_used_cents >= managed_cloud_overage_cap_cents
    )
    paid_overage_allowed = (
        not has_unlimited_cloud_hours
        and is_paid_cloud
        and state.subject.overage_enabled
        and payment_healthy
        and not cap_exhausted
    )
    concurrent_sandbox_limit = (
        numeric_policy.active_environment_limit
        if numeric_policy is not None
        else (None if is_paid_cloud else settings.cloud_concurrent_sandbox_limit)
    )
    concurrency_limited = (
        concurrent_sandbox_limit is not None and active_sandbox_count >= concurrent_sandbox_limit
    )
    hold_reason = _hold_reason(state.holds)
    credit_reason = None
    if over_quota and not paid_overage_allowed:
        if is_pro_subscription and not state.subject.overage_enabled:
            credit_reason = WORKSPACE_ACTION_BLOCK_KIND_OVERAGE_DISABLED
        elif is_pro_subscription and cap_exhausted:
            credit_reason = WORKSPACE_ACTION_BLOCK_KIND_CAP_EXHAUSTED
        else:
            credit_reason = WORKSPACE_ACTION_BLOCK_KIND_CREDITS_EXHAUSTED
    concurrency_reason = (
        WORKSPACE_ACTION_BLOCK_KIND_CONCURRENCY_LIMIT if concurrency_limited else None
    )
    start_block_reason = hold_reason or credit_reason or concurrency_reason
    active_spend_hold_reason = hold_reason or credit_reason
    start_blocked = start_block_reason is not None
    active_spend_hold = active_spend_hold_reason is not None
    legacy_cloud_subscription = (
        unlimited_state.legacy_cloud_subscription and settings.pro_billing_enabled
    )
    if settings.pro_billing_enabled:
        plan = (
            BILLING_PLAN_PRO if (is_paid_cloud or active_manual_unlimited) else BILLING_PLAN_FREE
        )
        cloud_repo_limit = (
            numeric_policy.repo_environment_limit if numeric_policy is not None else None
        )
        billable_seat_count = (
            numeric_policy.billable_seat_count if numeric_policy is not None else None
        )
        included_managed_cloud_hours = (
            numeric_policy.included_managed_cloud_hours if numeric_policy is not None else None
        )
        remaining_managed_cloud_hours = (
            remaining_seconds_value / 3600.0
            if included_managed_cloud_hours is not None and remaining_seconds_value is not None
            else None
        )
        repo_environment_limit = (
            numeric_policy.repo_environment_limit if numeric_policy is not None else None
        )
        active_environment_limit = (
            numeric_policy.active_environment_limit if numeric_policy is not None else None
        )
        byo_runtime_allowed = (
            numeric_policy.byo_runtime_allowed if numeric_policy is not None else False
        )
    else:
        plan = "cloud" if is_paid_cloud else ("unlimited" if active_manual_unlimited else "free")
        cloud_repo_limit = (
            settings.cloud_paid_repo_limit
            if is_paid_cloud or has_unlimited_cloud_hours
            else settings.cloud_free_repo_limit
        )
        billable_seat_count = None
        included_managed_cloud_hours = None
        remaining_managed_cloud_hours = None
        managed_cloud_overage_cap_cents = None
        repo_environment_limit = cloud_repo_limit
        active_environment_limit = concurrent_sandbox_limit
        byo_runtime_allowed = False

    return BillingSnapshot(
        billing_subject_id=state.billing_subject_id,
        plan=plan,
        billing_mode=settings.cloud_billing_mode,
        pro_billing_enabled=settings.pro_billing_enabled,
        is_unlimited=active_manual_unlimited,
        has_unlimited_cloud_hours=has_unlimited_cloud_hours,
        over_quota=over_quota,
        is_paid_cloud=is_paid_cloud,
        payment_healthy=payment_healthy,
        overage_enabled=state.subject.overage_enabled,
        included_hours=None if has_unlimited_cloud_hours else included_seconds / 3600.0,
        used_hours=used_seconds / 3600.0,
        remaining_hours=(None if has_unlimited_cloud_hours else remaining_seconds_value / 3600.0),
        cloud_repo_limit=cloud_repo_limit,
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
        billable_seat_count=billable_seat_count,
        included_managed_cloud_hours=included_managed_cloud_hours,
        remaining_managed_cloud_hours=remaining_managed_cloud_hours,
        managed_cloud_overage_enabled=state.subject.overage_enabled,
        managed_cloud_overage_cap_cents=managed_cloud_overage_cap_cents,
        managed_cloud_overage_used_cents=(
            0 if has_unlimited_cloud_hours else state.managed_cloud_overage_used_cents
        ),
        overage_price_per_hour_cents=PRO_OVERAGE_PRICE_PER_HOUR_CENTS,
        active_environment_limit=active_environment_limit,
        repo_environment_limit=repo_environment_limit,
        byo_runtime_allowed=byo_runtime_allowed,
        legacy_cloud_subscription=legacy_cloud_subscription,
    )


def _authorization_message(reason: str | None) -> str | None:
    return authorization_message(reason)


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
        active_environment_limit=snapshot.active_environment_limit,
    )


async def get_billing_overview(db: AsyncSession, user_id: UUID) -> BillingOverview:
    snapshot = await _get_billing_snapshot_for_request(db, user_id)
    return _billing_overview_from_snapshot(snapshot)


async def get_billing_overview_for_owner(
    db: AsyncSession,
    user: User,
    owner_selection: OwnerSelection,
) -> BillingOverview:
    context = await _resolve_billing_owner_context(db, user, owner_selection)
    snapshot = await _get_billing_snapshot_for_subject_request(db, context.billing_subject_id)
    return _billing_overview_from_snapshot(snapshot)


async def get_current_plan(db: AsyncSession, user_id: UUID) -> PlanInfo:
    snapshot = await _get_billing_snapshot_for_request(db, user_id)
    return PlanInfo(
        plan=snapshot.plan,
        usage_minutes=int(round(snapshot.used_hours * 60.0)),
        pro_billing_enabled=snapshot.pro_billing_enabled,
    )


async def get_cloud_plan(db: AsyncSession, user_id: UUID) -> CloudPlanInfo:
    snapshot = await _get_billing_snapshot_for_request(db, user_id)
    return _cloud_plan_from_snapshot(snapshot)


async def get_cloud_plan_for_owner(
    db: AsyncSession,
    user: User,
    owner_selection: OwnerSelection,
) -> CloudPlanInfo:
    context = await _resolve_billing_owner_context(db, user, owner_selection)
    snapshot = await _get_billing_snapshot_for_subject_request(db, context.billing_subject_id)
    return _cloud_plan_from_snapshot(snapshot)


def _billing_overview_from_snapshot(snapshot: BillingSnapshot) -> BillingOverview:
    return BillingOverview(
        plan=snapshot.plan,
        billing_mode=snapshot.billing_mode,
        pro_billing_enabled=snapshot.pro_billing_enabled,
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
        billable_seat_count=snapshot.billable_seat_count,
        included_managed_cloud_hours=(
            round(snapshot.included_managed_cloud_hours, 2)
            if snapshot.included_managed_cloud_hours is not None
            else None
        ),
        remaining_managed_cloud_hours=(
            round(snapshot.remaining_managed_cloud_hours, 4)
            if snapshot.remaining_managed_cloud_hours is not None
            else None
        ),
        managed_cloud_overage_enabled=snapshot.managed_cloud_overage_enabled,
        managed_cloud_overage_cap_cents=snapshot.managed_cloud_overage_cap_cents,
        managed_cloud_overage_used_cents=snapshot.managed_cloud_overage_used_cents,
        overage_price_per_hour_cents=snapshot.overage_price_per_hour_cents,
        active_environment_limit=snapshot.active_environment_limit,
        repo_environment_limit=snapshot.repo_environment_limit,
        byo_runtime_allowed=snapshot.byo_runtime_allowed,
        legacy_cloud_subscription=snapshot.legacy_cloud_subscription,
    )


def _cloud_plan_from_snapshot(snapshot: BillingSnapshot) -> CloudPlanInfo:
    return CloudPlanInfo(
        plan=snapshot.plan,
        billing_mode=snapshot.billing_mode,
        pro_billing_enabled=snapshot.pro_billing_enabled,
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
        billable_seat_count=snapshot.billable_seat_count,
        included_managed_cloud_hours=(
            round(snapshot.included_managed_cloud_hours, 2)
            if snapshot.included_managed_cloud_hours is not None
            else None
        ),
        remaining_managed_cloud_hours=(
            round(snapshot.remaining_managed_cloud_hours, 4)
            if snapshot.remaining_managed_cloud_hours is not None
            else None
        ),
        managed_cloud_overage_enabled=snapshot.managed_cloud_overage_enabled,
        managed_cloud_overage_cap_cents=snapshot.managed_cloud_overage_cap_cents,
        managed_cloud_overage_used_cents=snapshot.managed_cloud_overage_used_cents,
        overage_price_per_hour_cents=snapshot.overage_price_per_hour_cents,
        active_environment_limit=snapshot.active_environment_limit,
        repo_environment_limit=snapshot.repo_environment_limit,
        byo_runtime_allowed=snapshot.byo_runtime_allowed,
        legacy_cloud_subscription=snapshot.legacy_cloud_subscription,
    )


def is_free_included_grant(grant_type: str) -> bool:
    if settings.pro_billing_enabled:
        return grant_type == FREE_TRIAL_V2_GRANT_TYPE
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


def _require_owner_selection_uuid(value: str | UUID | None, *, field: str) -> UUID:
    if isinstance(value, UUID):
        return value
    if value:
        try:
            return UUID(value)
        except ValueError as exc:
            raise BillingServiceError(
                "invalid_organization_id",
                f"{field} must be a valid UUID.",
                status_code=400,
            ) from exc
    raise BillingServiceError(
        "missing_organization_id",
        f"{field} is required for organization scope.",
        status_code=400,
    )


async def _resolve_billing_owner_context(
    db: AsyncSession,
    user: User,
    owner_selection: OwnerSelection,
) -> OwnerContext:
    selection = owner_selection or OwnerSelection()
    if selection.owner_scope == "personal":
        if selection.organization_id is not None:
            raise BillingServiceError(
                "invalid_owner_selection",
                "organizationId is not valid for personal scope.",
                status_code=400,
            )
        state = await get_or_create_user_stripe_customer_state(db, user.id)
        if state.kind != BILLING_SUBJECT_KIND_PERSONAL:
            raise BillingServiceError(
                "invalid_owner_selection",
                "Personal billing subject could not be resolved.",
                status_code=500,
            )
        return OwnerContext(
            owner_scope="personal",
            actor_user_id=user.id,
            owner_user_id=user.id,
            organization_id=None,
            membership_id=None,
            membership_role=None,
            billing_subject_id=state.billing_subject_id,
        )

    organization_id = _require_owner_selection_uuid(
        selection.organization_id,
        field="organizationId",
    )
    record = await get_organization_with_membership(
        db,
        organization_id=organization_id,
        user_id=user.id,
    )
    if record is None:
        raise BillingServiceError(
            "organization_not_found",
            "Organization not found.",
            status_code=404,
        )
    state = await get_or_create_organization_stripe_customer_state(db, organization_id)
    return OwnerContext(
        owner_scope="organization",
        actor_user_id=user.id,
        owner_user_id=None,
        organization_id=organization_id,
        membership_id=record.membership.id,
        membership_role=record.membership.role,
        billing_subject_id=state.billing_subject_id,
    )


async def _ensure_stripe_customer_for_owner(
    db: AsyncSession,
    user: User,
    owner_selection: OwnerSelection,
    *,
    owner_context: OwnerContext | None = None,
) -> tuple[UUID, str]:
    async with db.begin():
        context = owner_context or await _resolve_billing_owner_context(db, user, owner_selection)
        if context.owner_scope == "organization":
            try:
                require_org_role(context, {ORGANIZATION_ROLE_OWNER, ORGANIZATION_ROLE_ADMIN})
            except ProliferateError as error:
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
            state = await get_or_create_organization_stripe_customer_state(
                db,
                context.organization_id,
            )
            organization = await load_organization_by_billing_subject(
                db,
                state.billing_subject_id,
            )
            customer_name = organization.name if organization is not None else "Organization"
            organization_id = str(context.organization_id)
            created_by_user_id = str(user.id)
        else:
            state = await get_or_create_user_stripe_customer_state(db, user.id)
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
    async with db.begin():
        state = await bind_stripe_customer_to_billing_subject(
            db,
            billing_subject_id=state.billing_subject_id,
            stripe_customer_id=customer_id,
        )
    return state.billing_subject_id, customer_id


async def create_cloud_checkout_session(
    db: AsyncSession,
    user: User,
    owner_selection: OwnerSelection | None = None,
) -> BillingUrlResponse:
    selection = owner_selection or OwnerSelection()
    org_context: OwnerContext | None = None
    if selection.owner_scope == "organization":
        async with db.begin():
            org_context = await _resolve_billing_owner_context(db, user, selection)
            try:
                require_org_role(org_context, {ORGANIZATION_ROLE_OWNER, ORGANIZATION_ROLE_ADMIN})
            except ProliferateError as error:
                raise BillingServiceError(
                    error.code,
                    error.message,
                    status_code=error.status_code,
                ) from error
        if not settings.pro_billing_enabled:
            raise BillingServiceError(
                "org_pro_billing_disabled",
                "Organization Pro billing is not available yet.",
                status_code=409,
            )
    success_url, cancel_url, portal_return_url = _require_redirect_urls()
    try:
        if settings.pro_billing_enabled:
            await stripe_billing.validate_pro_subscription_price_configuration()
        else:
            await stripe_billing.validate_cloud_subscription_price_configuration()
    except stripe_billing.StripeBillingError as error:
        raise _map_stripe_error(error) from error

    subject_id, stripe_customer_id = await _ensure_stripe_customer_for_owner(
        db,
        user,
        selection,
        owner_context=org_context,
    )
    async with db.begin():
        snapshot = await _get_billing_snapshot_for_subject_request(db, subject_id)
        seat_quantity = (
            await count_active_seats_for_billing_subject_id(db, subject_id)
            if org_context is not None and not snapshot.is_paid_cloud
            else 1
        )
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
        monthly_price_id = (
            configured_pro_monthly_price_id()
            if settings.pro_billing_enabled
            else settings.stripe_cloud_monthly_price_id
        )
        checkout = await stripe_billing.create_subscription_checkout_session(
            stripe_customer_id=stripe_customer_id,
            billing_subject_id=str(subject_id),
            organization_id=(
                str(org_context.organization_id)
                if org_context is not None and org_context.organization_id is not None
                else None
            ),
            created_by_user_id=str(user.id) if org_context is not None else None,
            cloud_monthly_price_id=monthly_price_id,
            overage_price_id=(
                configured_managed_cloud_overage_price_id()
                if settings.pro_billing_enabled
                else None
            ),
            seat_quantity=seat_quantity,
            success_url=success_url,
            cancel_url=cancel_url,
            idempotency_key=(
                f"cloud-checkout:org:{subject_id}:seats:{seat_quantity}"
                if org_context is not None
                else f"cloud-checkout:{subject_id}"
            ),
        )
    except stripe_billing.StripeBillingError as error:
        raise _map_stripe_error(error) from error
    return BillingUrlResponse(url=checkout.url)


async def create_refill_checkout_session(
    db: AsyncSession,
    user: User,
    owner_selection: OwnerSelection | None = None,
) -> BillingUrlResponse:
    selection = owner_selection or OwnerSelection()
    if selection.owner_scope == "organization":
        raise BillingServiceError(
            "refill_checkout_not_supported_for_org",
            "Refill checkout is not supported for organizations.",
            status_code=409,
        )
    if settings.pro_billing_enabled:
        raise BillingServiceError(
            "refill_checkout_disabled",
            "Refill checkout is not available for Pro billing.",
            status_code=409,
        )
    success_url, cancel_url, _portal_return_url = _require_redirect_urls()
    try:
        await stripe_billing.validate_refill_price_configuration()
    except stripe_billing.StripeBillingError as error:
        raise _map_stripe_error(error) from error
    subject_id, stripe_customer_id = await _ensure_stripe_customer_for_owner(
        db,
        user,
        selection,
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
    db: AsyncSession,
    user: User,
    owner_selection: OwnerSelection | None = None,
) -> BillingUrlResponse:
    _success_url, _cancel_url, portal_return_url = _require_redirect_urls()
    subject_id, stripe_customer_id = await _ensure_stripe_customer_for_owner(
        db,
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
    db: AsyncSession,
    user: User,
    *,
    enabled: bool,
    cap_cents_per_seat: int | None = None,
    owner_selection: OwnerSelection | None = None,
) -> OverageSettingsResponse:
    if cap_cents_per_seat is not None and not (
        0 <= cap_cents_per_seat <= PRO_OVERAGE_CAP_CENTS_PER_SEAT_MAX
    ):
        raise BillingServiceError(
            "invalid_overage_cap",
            "Overage cap must be between 0 and 1000000 cents per seat.",
            status_code=400,
        )
    selection = owner_selection or OwnerSelection()
    if selection.owner_scope == "personal":
        subject = await set_overage_policy_for_user(
            db,
            user_id=user.id,
            overage_enabled=enabled,
            overage_cap_cents_per_seat=cap_cents_per_seat,
        )
    else:
        context = await _resolve_billing_owner_context(db, user, selection)
        try:
            require_org_role(context, {ORGANIZATION_ROLE_OWNER, ORGANIZATION_ROLE_ADMIN})
        except ProliferateError as error:
            raise BillingServiceError(
                error.code,
                error.message,
                status_code=error.status_code,
            ) from error
        subject = await set_overage_policy_for_subject(
            db,
            billing_subject_id=context.billing_subject_id,
            overage_enabled=enabled,
            overage_cap_cents_per_seat=cap_cents_per_seat,
        )
    return OverageSettingsResponse(
        overage_enabled=enabled,
        overage_cap_cents_per_seat=subject.overage_cap_cents_per_seat,
    )


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
        overage_cap_cents=(
            max(state.active_seat_count, 1)
            * int(
                state.subject.overage_cap_cents_per_seat
                if state.subject.overage_cap_cents_per_seat is not None
                else PRO_DEFAULT_OVERAGE_CAP_CENTS_PER_SEAT
            )
            if subscription is not None and settings.pro_billing_enabled
            else None
        ),
        billing_mode=settings.cloud_billing_mode,
        consume_grants=consume_grants,
        export_overage=subscription is not None and settings.pro_billing_enabled,
        scan_until=scan_until,
    )


async def run_billing_accounting_pass(*, subject_limit: int = 100) -> None:
    if settings.cloud_billing_mode not in {BILLING_MODE_OBSERVE, BILLING_MODE_ENFORCE}:
        return

    await process_pending_seat_adjustments()

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
        pro_subscription = (
            unlimited_state.subscription
            if (
                settings.pro_billing_enabled
                and unlimited_state.subscription is not None
                and _subscription_is_pro(unlimited_state.subscription)
            )
            else None
        )
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
                    subscription=None,
                )
            )
        elif pro_subscription is not None:
            results.append(
                await _account_usage_for_snapshot_state(
                    state,
                    scan_until=now,
                    consume_grants=True,
                    subscription=pro_subscription,
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


async def process_pending_seat_adjustments(*, limit: int = 100) -> None:
    if not settings.pro_billing_enabled or settings.cloud_billing_mode == BILLING_MODE_OFF:
        return

    adjustments = await claim_pending_seat_adjustments(limit=limit)
    for adjustment in adjustments:
        try:
            await stripe_billing.update_subscription_item_quantity(
                subscription_item_id=adjustment.monthly_subscription_item_id,
                quantity=adjustment.target_quantity,
                idempotency_key=f"seat-quantity:{adjustment.id}:seats:{adjustment.target_quantity}",
            )
            await mark_seat_adjustment_stripe_confirmed(adjustment_id=adjustment.id)
            if (
                adjustment.period_start is not None
                and adjustment.period_end is not None
                and adjustment.effective_at is not None
                and adjustment.membership_id is not None
                and adjustment.grant_quantity > 0
            ):
                period_start_unix = int(adjustment.period_start.timestamp())
                grant_source_ref = seat_proration_grant_source_ref(
                    subscription_id=adjustment.stripe_subscription_id,
                    membership_id=str(adjustment.membership_id),
                    period_start_unix=period_start_unix,
                )
                hours_granted = prorated_seat_grant_hours(
                    added_seats=adjustment.grant_quantity,
                    period_start=adjustment.period_start,
                    period_end=adjustment.period_end,
                    effective_at=adjustment.effective_at,
                )
                await ensure_billing_grant_record(
                    user_id=adjustment.user_id,
                    billing_subject_id=adjustment.billing_subject_id,
                    grant_type=PRO_SEAT_PRORATION_GRANT_TYPE,
                    hours_granted=hours_granted,
                    effective_at=adjustment.effective_at,
                    expires_at=adjustment.period_end,
                    source_ref=grant_source_ref,
                )
            await mark_seat_adjustment_grant_issued(adjustment_id=adjustment.id)
        except stripe_billing.StripeBillingError as error:
            await mark_seat_adjustment_failed(
                adjustment_id=adjustment.id,
                error=error.message,
                terminal=_stripe_error_is_terminal(error),
            )
        except Exception as error:
            await mark_seat_adjustment_failed(
                adjustment_id=adjustment.id,
                error=f"{type(error).__name__}: {error}",
            )


def _stripe_error_is_terminal(error: stripe_billing.StripeBillingError) -> bool:
    return stripe_status_is_terminal(error.status_code)


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

        legacy_seconds_export = export.meter_quantity_cents is None
        quantity = (
            max(1, math.ceil(export.quantity_seconds))
            if legacy_seconds_export
            else max(1, int(export.meter_quantity_cents or 0))
        )
        identifier = usage_export_identifier(export.id)
        try:
            meter_kwargs = {
                "event_name": (
                    settings.stripe_sandbox_meter_event_name
                    if legacy_seconds_export
                    else configured_managed_cloud_meter_event_name()
                ),
                "stripe_customer_id": export.stripe_customer_id,
                "identifier": identifier,
                "timestamp": int((coerce_utc(export.accounted_until) or now).timestamp()),
                "idempotency_key": export.idempotency_key,
            }
            if legacy_seconds_export:
                meter_kwargs["quantity_seconds"] = quantity
            else:
                meter_kwargs["quantity"] = quantity
            payload = await stripe_billing.create_meter_event(**meter_kwargs)
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
    return terminal_meter_event_error(accounted_until, now=now)


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
