"""Billing snapshot read-model service routines."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.billing import (
    ACTIVE_SANDBOX_STATUSES,
    BILLING_PLAN_FREE,
    BILLING_PLAN_PRO,
    PRO_OVERAGE_PRICE_PER_HOUR_CENTS,
    WORKSPACE_ACTION_BLOCK_KIND_CAP_EXHAUSTED,
    WORKSPACE_ACTION_BLOCK_KIND_CONCURRENCY_LIMIT,
    WORKSPACE_ACTION_BLOCK_KIND_CREDITS_EXHAUSTED,
    WORKSPACE_ACTION_BLOCK_KIND_OVERAGE_DISABLED,
)
from proliferate.db import session_ops as db_session
from proliferate.db.models.billing import (
    BillingEntitlement,
    BillingGrant,
    BillingHold,
    BillingSubscription,
    UsageSegment,
)
from proliferate.db.store.billing import sum_meter_quantity_cents_for_subject
from proliferate.server.billing import snapshot_state
from proliferate.server.billing.domain.accounting import (
    active_pro_period_start,
    ordered_accounting_grants,
)
from proliferate.server.billing.domain.plans import (
    BillingPlanRuleConfig,
    UnlimitedCloudHoursState,
    active_hold_reason,
    compute_unlimited_cloud_hours_state,
    grant_applies_to_paid_state,
    grant_is_active,
    repo_limit_for_billing_state,
    subscription_in_rollover_grace,
    subscription_is_pro,
)
from proliferate.server.billing.models import (
    BillingSnapshot,
    GrantAllocation,
    duration_seconds,
    utcnow,
)
from proliferate.server.billing.policy import free_v2_policy, pro_policy, unlimited_numeric_policy
from proliferate.server.billing.pricing import billing_price_ids_from_settings
from proliferate.server.billing.snapshot_state import BillingSnapshotState


def billing_plan_rule_config() -> BillingPlanRuleConfig:
    return BillingPlanRuleConfig(
        pro_billing_enabled=settings.pro_billing_enabled,
        cloud_monthly_price_id=settings.stripe_cloud_monthly_price_id,
        price_ids=billing_price_ids_from_settings(),
    )


def compute_unlimited_cloud_hours_state_for_settings(
    *,
    subscriptions: list[BillingSubscription],
    entitlements: list[BillingEntitlement],
    now: datetime,
) -> UnlimitedCloudHoursState:
    return compute_unlimited_cloud_hours_state(
        subscriptions=subscriptions,
        entitlements=entitlements,
        now=now,
        config=billing_plan_rule_config(),
    )


def subscription_is_pro_for_settings(subscription: BillingSubscription) -> bool:
    return subscription_is_pro(subscription, config=billing_plan_rule_config())


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


def _grant_is_active(grant: BillingGrant, now: datetime) -> bool:
    return grant_is_active(grant, now)


def _hold_reason(holds: list[BillingHold]) -> str | None:
    return active_hold_reason(holds)


def _subscription_in_rollover_grace(
    subscription: BillingSubscription | None,
    now: datetime,
) -> bool:
    return subscription_in_rollover_grace(subscription, now)


def _grant_applies_to_paid_state(grant: BillingGrant, *, is_paid_cloud: bool) -> bool:
    return grant_applies_to_paid_state(
        grant.grant_type,
        is_paid_cloud=is_paid_cloud,
        pro_billing_enabled=settings.pro_billing_enabled,
    )


def _grant_allocations_for_snapshot(
    *,
    eligible_grants: list[BillingGrant],
    active_grants: list[BillingGrant],
    is_paid_cloud: bool,
    unaccounted_billable_seconds: float,
    now: datetime,
) -> tuple[GrantAllocation, ...]:
    adjusted_remaining_by_id = {
        grant.id: max(float(grant.remaining_seconds), 0.0) for grant in eligible_grants
    }
    uncovered_seconds = max(float(unaccounted_billable_seconds), 0.0)
    for grant in ordered_accounting_grants(
        active_grants,
        pro_billing_enabled=settings.pro_billing_enabled,
        is_paid_cloud=is_paid_cloud,
        at=now,
    ):
        if uncovered_seconds <= 0:
            break
        available_seconds = adjusted_remaining_by_id.get(grant.id, 0.0)
        consumed_seconds = min(available_seconds, uncovered_seconds)
        if consumed_seconds <= 0:
            continue
        adjusted_remaining_by_id[grant.id] = max(available_seconds - consumed_seconds, 0.0)
        uncovered_seconds -= consumed_seconds

    allocations: list[GrantAllocation] = []
    for grant in eligible_grants:
        total_seconds = max(float(grant.hours_granted) * 3600.0, 0.0)
        raw_remaining_seconds = max(float(grant.remaining_seconds), 0.0)
        remaining_seconds = max(
            adjusted_remaining_by_id.get(grant.id, raw_remaining_seconds),
            0.0,
        )
        billable_remaining_seconds = min(remaining_seconds, total_seconds)
        allocations.append(
            GrantAllocation(
                grant_type=grant.grant_type,
                total_seconds=total_seconds,
                consumed_seconds=max(total_seconds - billable_remaining_seconds, 0.0),
                remaining_seconds=remaining_seconds,
                active=_grant_is_active(grant, now),
            )
        )
    return tuple(allocations)


def _segment_seconds(segment: UsageSegment, now: datetime) -> float:
    return duration_seconds(
        started_at=segment.started_at,
        ended_at=segment.ended_at,
        now=now,
    )


async def get_billing_snapshot(user_id: UUID) -> BillingSnapshot:
    async with db_session.open_async_transaction() as db:
        state = await snapshot_state.load_snapshot_state_for_user(db, user_id)
        state = await state_with_overage_usage(db, state)
    return build_billing_snapshot(state)


async def get_billing_snapshot_for_request(
    db: AsyncSession,
    user_id: UUID,
) -> BillingSnapshot:
    state = await snapshot_state.load_snapshot_state_for_user(db, user_id)
    state = await state_with_overage_usage(db, state)
    return build_billing_snapshot(state)


async def get_billing_snapshot_for_subject(billing_subject_id: UUID) -> BillingSnapshot:
    async with db_session.open_async_transaction() as db:
        state = await snapshot_state.load_snapshot_state_for_subject(db, billing_subject_id)
        state = await state_with_overage_usage(db, state)
    return build_billing_snapshot(state)


async def get_billing_snapshot_for_subject_in_session(
    db: AsyncSession,
    billing_subject_id: UUID,
) -> BillingSnapshot:
    state = await snapshot_state.load_snapshot_state_for_subject(db, billing_subject_id)
    state = await state_with_overage_usage(db, state)
    return build_billing_snapshot(state)


def build_billing_snapshot(state: BillingSnapshotState) -> BillingSnapshot:
    now = utcnow()
    used_seconds = state.historical_billable_seconds + sum(
        _segment_seconds(segment, now) for segment in state.usage_segments
    )
    unlimited_state = compute_unlimited_cloud_hours_state_for_settings(
        subscriptions=state.subscriptions,
        entitlements=state.entitlements,
        now=now,
    )
    healthy_subscription = unlimited_state.subscription
    is_pro_subscription = (
        settings.pro_billing_enabled
        and healthy_subscription is not None
        and subscription_is_pro_for_settings(healthy_subscription)
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
    grant_allocations = _grant_allocations_for_snapshot(
        eligible_grants=eligible_grants,
        active_grants=active_grants,
        is_paid_cloud=is_paid_cloud,
        unaccounted_billable_seconds=state.unaccounted_billable_seconds,
        now=now,
    )

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
        overage_cap_cents_per_seat=state.subject.overage_cap_cents_per_seat,
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
        grant_allocations=grant_allocations,
    )


async def state_with_overage_usage(
    db: AsyncSession,
    state: BillingSnapshotState,
) -> BillingSnapshotState:
    active_period_start = active_pro_period_start(
        state.subscriptions,
        now=utcnow(),
        price_ids=billing_price_ids_from_settings(),
    )
    if active_period_start is None:
        return state
    return replace(
        state,
        managed_cloud_overage_used_cents=await sum_meter_quantity_cents_for_subject(
            db,
            state.billing_subject_id,
            period_start=active_period_start,
        ),
    )
