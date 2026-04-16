"""Billing service layer."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from proliferate.config import settings
from proliferate.constants.billing import (
    ACTIVE_SANDBOX_STATUSES,
    BILLING_DECISION_AUTHORIZE_START,
    BILLING_MODE_ENFORCE,
    FREE_INCLUDED_GRANT_TYPE,
    UNLIMITED_CLOUD_ENTITLEMENT,
    WORKSPACE_ACTION_BLOCK_KIND_ADMIN_HOLD,
    WORKSPACE_ACTION_BLOCK_KIND_CONCURRENCY_LIMIT,
    WORKSPACE_ACTION_BLOCK_KIND_CREDITS_EXHAUSTED,
    WORKSPACE_ACTION_BLOCK_KIND_EXTERNAL_BILLING_HOLD,
    WORKSPACE_ACTION_BLOCK_KIND_PAYMENT_FAILED,
)
from proliferate.db.models.billing import (
    BillingEntitlement,
    BillingGrant,
    BillingHold,
    UsageSegment,
)
from proliferate.db.store.billing import (
    BillingSnapshotState,
    load_billing_snapshot_state,
    load_billing_snapshot_state_for_subject,
    record_billing_decision_event,
    resolve_billing_subject_id_for_user,
    resolve_billing_subject_id_for_workspace,
)
from proliferate.server.billing.models import (
    BillingOverview,
    BillingSnapshot,
    CloudPlanInfo,
    GrantAllocation,
    PlanInfo,
    SandboxStartAuthorization,
    coerce_utc,
    duration_seconds,
    utcnow,
)

_ACTIVE_HOLD_REASONS: dict[str, str] = {
    "payment_failed": WORKSPACE_ACTION_BLOCK_KIND_PAYMENT_FAILED,
    "admin_hold": WORKSPACE_ACTION_BLOCK_KIND_ADMIN_HOLD,
    "external_billing_hold": WORKSPACE_ACTION_BLOCK_KIND_EXTERNAL_BILLING_HOLD,
}


def _grant_is_active(grant: BillingGrant, now: datetime) -> bool:
    effective_at = coerce_utc(grant.effective_at) or now
    expires_at = coerce_utc(grant.expires_at)
    return effective_at <= now and (expires_at is None or expires_at > now)


def _entitlement_is_active(entitlement: BillingEntitlement, now: datetime) -> bool:
    effective_at = coerce_utc(entitlement.effective_at) or now
    expires_at = coerce_utc(entitlement.expires_at)
    return effective_at <= now and (expires_at is None or expires_at > now)


def _hold_reason(holds: list[BillingHold]) -> str | None:
    for hold in holds:
        reason = _ACTIVE_HOLD_REASONS.get(hold.kind)
        if reason is not None:
            return reason
    return None


def _allocate_usage(
    grants: list[BillingGrant],
    *,
    total_used_seconds: float,
    now: datetime,
) -> list[GrantAllocation]:
    remaining_usage = max(total_used_seconds, 0.0)
    allocations: list[GrantAllocation] = []

    for grant in grants:
        total_seconds = max(grant.hours_granted * 3600.0, 0.0)
        consumed_seconds = min(total_seconds, remaining_usage)
        remaining_usage = max(remaining_usage - consumed_seconds, 0.0)
        allocations.append(
            GrantAllocation(
                grant_type=grant.grant_type,
                total_seconds=total_seconds,
                consumed_seconds=consumed_seconds,
                remaining_seconds=max(total_seconds - consumed_seconds, 0.0),
                active=_grant_is_active(grant, now),
            )
        )

    return allocations


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


async def resolve_billing_subject_for_user(user_id: UUID) -> UUID:
    return await resolve_billing_subject_id_for_user(user_id)


def _build_billing_snapshot(state: BillingSnapshotState) -> BillingSnapshot:
    now = utcnow()
    used_seconds = state.historical_billable_seconds + sum(
        _segment_seconds(segment, now) for segment in state.usage_segments
    )
    allocations = _allocate_usage(state.grants, total_used_seconds=used_seconds, now=now)

    active_allocations = [allocation for allocation in allocations if allocation.active]
    included_seconds = sum(allocation.total_seconds for allocation in active_allocations)
    remaining_seconds = sum(allocation.remaining_seconds for allocation in active_allocations)

    active_unlimited = any(
        entitlement.kind == UNLIMITED_CLOUD_ENTITLEMENT
        and _entitlement_is_active(entitlement, now)
        for entitlement in state.entitlements
    )
    remaining_seconds_value = None if active_unlimited else max(remaining_seconds, 0.0)

    active_sandbox_count = sum(
        1 for sandbox in state.sandboxes if sandbox.status in ACTIVE_SANDBOX_STATUSES
    )

    over_quota = not active_unlimited and remaining_seconds <= 0
    concurrency_limited = active_sandbox_count >= settings.cloud_concurrent_sandbox_limit
    hold_reason = _hold_reason(state.holds)
    credit_reason = WORKSPACE_ACTION_BLOCK_KIND_CREDITS_EXHAUSTED if over_quota else None
    concurrency_reason = (
        WORKSPACE_ACTION_BLOCK_KIND_CONCURRENCY_LIMIT if concurrency_limited else None
    )
    start_block_reason = hold_reason or credit_reason or concurrency_reason
    active_spend_hold_reason = hold_reason or credit_reason
    start_blocked = start_block_reason is not None
    active_spend_hold = active_spend_hold_reason is not None
    blocked_reason = (
        start_block_reason if settings.cloud_billing_mode == BILLING_MODE_ENFORCE else None
    )

    return BillingSnapshot(
        billing_subject_id=state.billing_subject_id,
        plan="unlimited" if active_unlimited else "free",
        billing_mode=settings.cloud_billing_mode,
        is_unlimited=active_unlimited,
        over_quota=over_quota,
        included_hours=None if active_unlimited else included_seconds / 3600.0,
        used_hours=used_seconds / 3600.0,
        remaining_hours=None if active_unlimited else remaining_seconds_value / 3600.0,
        concurrent_sandbox_limit=settings.cloud_concurrent_sandbox_limit,
        active_sandbox_count=active_sandbox_count,
        start_blocked=start_blocked,
        start_block_reason=start_block_reason,
        active_spend_hold=active_spend_hold,
        hold_reason=active_spend_hold_reason,
        remaining_seconds=remaining_seconds_value,
        blocked=blocked_reason is not None,
        blocked_reason=blocked_reason,
    )


def _authorization_message(reason: str | None) -> str | None:
    if reason == WORKSPACE_ACTION_BLOCK_KIND_CONCURRENCY_LIMIT:
        return "Sandbox limit reached. Stop another cloud workspace before starting a new one."
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
        over_quota=snapshot.over_quota,
        included_hours=(
            round(snapshot.included_hours, 2) if snapshot.included_hours is not None else None
        ),
        used_hours=round(snapshot.used_hours, 4),
        remaining_hours=(
            round(snapshot.remaining_hours, 4) if snapshot.remaining_hours is not None else None
        ),
        concurrent_sandbox_limit=snapshot.concurrent_sandbox_limit,
        active_sandbox_count=snapshot.active_sandbox_count,
        start_blocked=snapshot.start_blocked,
        start_block_reason=snapshot.start_block_reason,
        active_spend_hold=snapshot.active_spend_hold,
        hold_reason=snapshot.hold_reason,
        blocked=snapshot.blocked,
        blocked_reason=snapshot.blocked_reason,
    )


async def get_current_plan(user_id: UUID) -> PlanInfo:
    snapshot = await get_billing_snapshot(user_id)
    return PlanInfo(
        plan=snapshot.plan,
        usage_minutes=int(round(snapshot.used_hours * 60.0)),
    )


async def get_cloud_plan(user_id: UUID) -> CloudPlanInfo:
    snapshot = await get_billing_snapshot(user_id)
    return CloudPlanInfo(
        plan=snapshot.plan,
        billing_mode=snapshot.billing_mode,
        is_unlimited=snapshot.is_unlimited,
        over_quota=snapshot.over_quota,
        free_sandbox_hours=(
            round(snapshot.included_hours, 2) if snapshot.included_hours is not None else None
        ),
        used_sandbox_hours=round(snapshot.used_hours, 4),
        remaining_sandbox_hours=(
            round(snapshot.remaining_hours, 4) if snapshot.remaining_hours is not None else None
        ),
        concurrent_sandbox_limit=snapshot.concurrent_sandbox_limit,
        active_sandbox_count=snapshot.active_sandbox_count,
        start_blocked=snapshot.start_blocked,
        start_block_reason=snapshot.start_block_reason,
        active_spend_hold=snapshot.active_spend_hold,
        hold_reason=snapshot.hold_reason,
        blocked=snapshot.blocked,
        blocked_reason=snapshot.blocked_reason,
    )


def is_free_included_grant(grant_type: str) -> bool:
    return grant_type == FREE_INCLUDED_GRANT_TYPE
