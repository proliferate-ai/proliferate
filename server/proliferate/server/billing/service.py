"""Billing service layer."""

from __future__ import annotations

import logging
from datetime import datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import (
    AuthenticatedUser,
    OwnerSelection,
)
from proliferate.config import settings
from proliferate.constants.billing import (
    BILLING_DECISION_OVERAGE_EXPORT,
    BILLING_MODE_ENFORCE,
    BILLING_MODE_OBSERVE,
    BILLING_USAGE_EXPORT_STATUS_OBSERVED,
    FREE_INCLUDED_GRANT_TYPE,
    FREE_TRIAL_V2_GRANT_TYPE,
)
from proliferate.db import session_ops as db_session
from proliferate.db.models.billing import (
    BillingEntitlement,
    BillingSubscription,
)
from proliferate.db.store import billing_seats, billing_subscriptions
from proliferate.db.store.billing_accounting import (
    BillingAccountingResult,
    ClaimedUsageExport,
    list_billing_subject_ids_for_usage_accounting,
)
from proliferate.db.store.billing_runtime_usage import (
    close_usage_segment_for_sandbox,
    open_usage_segment_for_sandbox,
    record_billing_decision_event,
    remember_sandbox_event_receipt,
)
from proliferate.db.store.billing_subjects import (
    BillingSubjectStripeState,
    get_or_create_organization_stripe_customer_state,
    get_or_create_user_stripe_customer_state,
)
from proliferate.integrations import stripe as stripe_billing
from proliferate.server.billing import accounting as billing_accounting_service
from proliferate.server.billing import authorization as billing_authorization
from proliferate.server.billing import snapshot_state
from proliferate.server.billing import snapshots as billing_snapshots
from proliferate.server.billing.checkout import resolve_billing_owner_context
from proliferate.server.billing.domain.accounting import (
    stripe_status_is_terminal,
)
from proliferate.server.billing.domain.plans import UnlimitedCloudHoursState
from proliferate.server.billing.models import (
    BillingOverview,
    BillingSnapshot,
    CloudPlanInfo,
    GrantAllocation,
    GrantAllocationInfo,
    PlanInfo,
    SandboxStartAuthorization,
    utcnow,
)
from proliferate.server.billing.pricing import (
    configured_pro_monthly_price_id,
)
from proliferate.server.billing.snapshot_state import BillingSnapshotState

logger = logging.getLogger("proliferate.billing.service")


def _compute_unlimited_cloud_hours_state(
    *,
    subscriptions: list[BillingSubscription],
    entitlements: list[BillingEntitlement],
    now: datetime,
) -> UnlimitedCloudHoursState:
    return billing_snapshots.compute_unlimited_cloud_hours_state_for_settings(
        subscriptions=subscriptions,
        entitlements=entitlements,
        now=now,
    )


def _subscription_is_pro(subscription: BillingSubscription) -> bool:
    return billing_snapshots.subscription_is_pro_for_settings(subscription)


def repo_limit_for_billing_snapshot(snapshot: BillingSnapshot) -> int | None:
    return billing_snapshots.repo_limit_for_billing_snapshot(snapshot)


async def ensure_personal_billing_subject_state(
    db: AsyncSession,
    user_id: UUID,
) -> BillingSubjectStripeState:
    return await get_or_create_user_stripe_customer_state(db, user_id)


async def ensure_organization_billing_subject_state(
    db: AsyncSession,
    organization_id: UUID,
) -> BillingSubjectStripeState:
    return await get_or_create_organization_stripe_customer_state(db, organization_id)


async def maybe_create_organization_seat_adjustment(
    db: AsyncSession,
    *,
    organization_id: UUID,
    membership_id: UUID | None,
) -> bool:
    return await billing_seats.maybe_create_org_seat_adjustment(
        db,
        organization_id=organization_id,
        membership_id=membership_id,
        pro_billing_enabled=settings.pro_billing_enabled,
        pro_monthly_price_id=configured_pro_monthly_price_id(),
    )


async def reconcile_initial_org_subscription_seats(
    record: BillingSubscription,
) -> BillingSubscription:
    async with db_session.open_async_transaction() as db:
        adjustment = await billing_seats.prepare_initial_org_seat_reconcile(
            db,
            billing_subscription_id=record.id,
            pro_billing_enabled=settings.pro_billing_enabled,
            pro_monthly_price_id=configured_pro_monthly_price_id(),
        )
    if adjustment is None:
        async with db_session.open_async_session() as db:
            reloaded = await billing_subscriptions.load_billing_subscription_by_id(db, record.id)
        return reloaded or record
    try:
        await stripe_billing.update_subscription_item_quantity(
            subscription_item_id=adjustment.monthly_subscription_item_id,
            quantity=adjustment.target_quantity,
            idempotency_key=f"initial-seat-reconcile:{adjustment.id}:seats:{adjustment.target_quantity}",
        )
        async with db_session.open_async_transaction() as db:
            await billing_seats.mark_seat_adjustment_stripe_confirmed(
                db,
                adjustment_id=adjustment.id,
            )
        async with db_session.open_async_transaction() as db:
            await billing_seats.mark_seat_adjustment_grant_issued(
                db,
                adjustment_id=adjustment.id,
            )
    except stripe_billing.StripeBillingError as error:
        async with db_session.open_async_transaction() as db:
            await billing_seats.mark_seat_adjustment_failed(
                db,
                adjustment_id=adjustment.id,
                error=error.message,
                terminal=stripe_status_is_terminal(error.status_code),
            )
        raise
    except Exception as error:
        async with db_session.open_async_transaction() as db:
            await billing_seats.mark_seat_adjustment_failed(
                db,
                adjustment_id=adjustment.id,
                error=f"{type(error).__name__}: {error}",
            )
        raise
    async with db_session.open_async_session() as db:
        reloaded = await billing_subscriptions.load_billing_subscription_by_id(db, record.id)
    return reloaded or record


async def remember_cloud_sandbox_event_receipt(
    db: AsyncSession,
    *,
    event_id: str,
    provider: str,
    event_type: str,
    external_sandbox_id: str | None,
) -> bool:
    return await remember_sandbox_event_receipt(
        db,
        event_id=event_id,
        provider=provider,
        event_type=event_type,
        external_sandbox_id=external_sandbox_id,
    )


async def record_cloud_sandbox_usage_started(
    *,
    runtime_environment_id: UUID | None = None,
    workspace_id: UUID | None = None,
    sandbox_id: UUID,
    external_sandbox_id: str | None,
    sandbox_execution_id: str | None,
    started_at: datetime,
    opened_by: str,
    user_id: UUID | None = None,
    is_billable: bool = True,
    event_id: str | None = None,
) -> object:
    async with db_session.open_async_transaction() as db:
        return await open_usage_segment_for_sandbox(
            db,
            runtime_environment_id=runtime_environment_id,
            workspace_id=workspace_id,
            sandbox_id=sandbox_id,
            external_sandbox_id=external_sandbox_id,
            sandbox_execution_id=sandbox_execution_id,
            started_at=started_at,
            opened_by=opened_by,
            user_id=user_id,
            is_billable=is_billable,
            event_id=event_id,
        )


async def record_cloud_sandbox_usage_stopped(
    *,
    sandbox_id: UUID,
    ended_at: datetime,
    closed_by: str,
    is_billable: bool | None = None,
    event_id: str | None = None,
) -> object | None:
    async with db_session.open_async_transaction() as db:
        return await close_usage_segment_for_sandbox(
            db,
            sandbox_id=sandbox_id,
            ended_at=ended_at,
            closed_by=closed_by,
            is_billable=is_billable,
            event_id=event_id,
        )


async def get_billing_snapshot(user_id: UUID) -> BillingSnapshot:
    return await billing_snapshots.get_billing_snapshot(user_id)


async def get_billing_snapshot_for_request(
    db: AsyncSession,
    user_id: UUID,
) -> BillingSnapshot:
    return await billing_snapshots.get_billing_snapshot_for_request(db, user_id)


async def get_billing_snapshot_for_subject(billing_subject_id: UUID) -> BillingSnapshot:
    return await billing_snapshots.get_billing_snapshot_for_subject(billing_subject_id)


async def get_billing_snapshot_for_subject_in_session(
    db: AsyncSession,
    billing_subject_id: UUID,
) -> BillingSnapshot:
    return await billing_snapshots.get_billing_snapshot_for_subject_in_session(
        db,
        billing_subject_id,
    )


async def _get_billing_snapshot_for_request(
    db: AsyncSession,
    user_id: UUID,
) -> BillingSnapshot:
    return await billing_snapshots.get_billing_snapshot_for_request(db, user_id)


async def _get_billing_snapshot_for_subject_request(
    db: AsyncSession,
    billing_subject_id: UUID,
) -> BillingSnapshot:
    return await billing_snapshots.get_billing_snapshot_for_subject_in_session(
        db,
        billing_subject_id,
    )


def _build_billing_snapshot(state: BillingSnapshotState) -> BillingSnapshot:
    return billing_snapshots.build_billing_snapshot(state)


async def authorize_sandbox_start_for_billing_subject(
    *,
    actor_user_id: UUID | None,
    billing_subject_id: UUID,
    workspace_id: UUID | None = None,
) -> SandboxStartAuthorization:
    return await billing_authorization.authorize_sandbox_start_for_billing_subject(
        actor_user_id=actor_user_id,
        billing_subject_id=billing_subject_id,
        workspace_id=workspace_id,
    )


async def authorize_sandbox_start(
    *,
    user_id: UUID,
    workspace_id: UUID | None,
) -> SandboxStartAuthorization:
    return await billing_authorization.authorize_sandbox_start(
        user_id=user_id,
        workspace_id=workspace_id,
    )


async def get_billing_overview(db: AsyncSession, user_id: UUID) -> BillingOverview:
    snapshot = await _get_billing_snapshot_for_request(db, user_id)
    return _billing_overview_from_snapshot(snapshot)


async def get_billing_overview_for_owner(
    db: AsyncSession,
    user: AuthenticatedUser,
    owner_selection: OwnerSelection,
) -> BillingOverview:
    context = await resolve_billing_owner_context(db, user, owner_selection)
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
    user: AuthenticatedUser,
    owner_selection: OwnerSelection,
) -> CloudPlanInfo:
    context = await resolve_billing_owner_context(db, user, owner_selection)
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


def is_free_included_grant(grant_type: str) -> bool:
    if settings.pro_billing_enabled:
        return grant_type == FREE_TRIAL_V2_GRANT_TYPE
    return grant_type == FREE_INCLUDED_GRANT_TYPE


async def state_with_overage_usage(
    db: AsyncSession,
    state: BillingSnapshotState,
) -> BillingSnapshotState:
    return await billing_snapshots.state_with_overage_usage(db, state)


async def account_usage_for_billing_subject(
    *,
    billing_subject_id: UUID,
    is_paid_cloud: bool,
    billing_subscription_id: UUID | None,
    period_start: datetime | None,
    period_end: datetime | None,
    overage_enabled: bool,
    billing_mode: str,
    overage_cap_cents: int | None = None,
    consume_grants: bool = True,
    export_overage: bool = True,
    scan_until: datetime | None = None,
) -> BillingAccountingResult:
    return await billing_accounting_service.account_usage_for_billing_subject(
        billing_subject_id=billing_subject_id,
        is_paid_cloud=is_paid_cloud,
        billing_subscription_id=billing_subscription_id,
        period_start=period_start,
        period_end=period_end,
        overage_enabled=overage_enabled,
        billing_mode=billing_mode,
        overage_cap_cents=overage_cap_cents,
        consume_grants=consume_grants,
        export_overage=export_overage,
        scan_until=scan_until,
    )


async def claim_usage_exports_for_sending(*, limit: int = 100) -> list[ClaimedUsageExport]:
    return await billing_accounting_service.claim_usage_exports_for_sending(limit=limit)


async def run_billing_accounting_pass(*, subject_limit: int = 100) -> None:
    if settings.cloud_billing_mode not in {BILLING_MODE_OBSERVE, BILLING_MODE_ENFORCE}:
        return

    await process_pending_seat_adjustments()

    async with db_session.open_async_transaction() as db:
        subject_ids = await list_billing_subject_ids_for_usage_accounting(
            db,
            limit=subject_limit,
        )
    for billing_subject_id in subject_ids:
        async with db_session.open_async_transaction() as db:
            state = await snapshot_state.load_snapshot_state_for_subject(db, billing_subject_id)
            state = await state_with_overage_usage(db, state)
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
                    await billing_accounting_service.account_usage_for_snapshot_state(
                        state,
                        scan_until=unlimited_state.unlimited_window_start,
                        consume_grants=True,
                        subscription=None,
                    )
                )
            results.append(
                await billing_accounting_service.account_usage_for_snapshot_state(
                    state,
                    scan_until=now,
                    consume_grants=False,
                    subscription=None,
                )
            )
        elif pro_subscription is not None:
            results.append(
                await billing_accounting_service.account_usage_for_snapshot_state(
                    state,
                    scan_until=now,
                    consume_grants=True,
                    subscription=pro_subscription,
                )
            )
        else:
            results.append(
                await billing_accounting_service.account_usage_for_snapshot_state(
                    state,
                    scan_until=now,
                    consume_grants=True,
                    subscription=None,
                )
            )

        if any(result.export_count > 0 for result in results):
            snapshot = _build_billing_snapshot(state)
            async with db_session.open_async_transaction() as db:
                await record_billing_decision_event(
                    db,
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
    await billing_accounting_service.process_pending_seat_adjustments(limit=limit)


async def send_pending_usage_exports(*, limit: int = 100) -> None:
    await billing_accounting_service.send_pending_usage_exports(limit=limit)
