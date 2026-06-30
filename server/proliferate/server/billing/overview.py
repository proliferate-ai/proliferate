"""Billing overview and plan read models."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import AuthenticatedUser, OwnerContext, OwnerSelection
from proliferate.server.billing import snapshots as billing_snapshots
from proliferate.server.billing.checkout import resolve_billing_owner_context
from proliferate.server.billing.models import (
    BillingOverview,
    BillingSnapshot,
    CloudPlanInfo,
    GrantAllocation,
    GrantAllocationInfo,
    PlanInfo,
)


async def get_billing_overview(db: AsyncSession, user_id: UUID) -> BillingOverview:
    snapshot = await billing_snapshots.get_billing_snapshot_for_request(db, user_id)
    return _billing_overview_from_snapshot(snapshot)


async def get_billing_overview_for_owner(
    db: AsyncSession,
    user: AuthenticatedUser,
    owner_selection: OwnerSelection,
) -> BillingOverview:
    context = await resolve_billing_owner_context(db, user, owner_selection)
    return await get_billing_overview_for_context(db, context)


async def get_billing_overview_for_context(
    db: AsyncSession,
    context: OwnerContext,
) -> BillingOverview:
    snapshot = await billing_snapshots.get_billing_snapshot_for_subject_in_session(
        db,
        context.billing_subject_id,
    )
    return _billing_overview_from_snapshot(snapshot)


async def get_current_plan(db: AsyncSession, user_id: UUID) -> PlanInfo:
    snapshot = await billing_snapshots.get_billing_snapshot_for_request(db, user_id)
    return PlanInfo(
        plan=snapshot.plan,
        usage_minutes=int(round(snapshot.used_hours * 60.0)),
        pro_billing_enabled=snapshot.pro_billing_enabled,
    )


async def get_cloud_plan(db: AsyncSession, user_id: UUID) -> CloudPlanInfo:
    snapshot = await billing_snapshots.get_billing_snapshot_for_request(db, user_id)
    return _cloud_plan_from_snapshot(snapshot)


async def get_cloud_plan_for_owner(
    db: AsyncSession,
    user: AuthenticatedUser,
    owner_selection: OwnerSelection,
) -> CloudPlanInfo:
    context = await resolve_billing_owner_context(db, user, owner_selection)
    return await get_cloud_plan_for_context(db, context)


async def get_cloud_plan_for_context(
    db: AsyncSession,
    context: OwnerContext,
) -> CloudPlanInfo:
    snapshot = await billing_snapshots.get_billing_snapshot_for_subject_in_session(
        db,
        context.billing_subject_id,
    )
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
        grant_allocations=[
            _grant_allocation_info(allocation) for allocation in snapshot.grant_allocations
        ],
    )


def _grant_allocation_info(allocation: GrantAllocation) -> GrantAllocationInfo:
    return GrantAllocationInfo(
        grant_type=allocation.grant_type,
        total_seconds=round(allocation.total_seconds, 4),
        consumed_seconds=round(allocation.consumed_seconds, 4),
        remaining_seconds=round(allocation.remaining_seconds, 4),
        active=allocation.active,
    )
