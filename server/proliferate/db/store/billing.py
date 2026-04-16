"""Billing persistence layer."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import TypeVar
from uuid import UUID

from sqlalchemy import func, or_, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.billing import (
    BILLING_RECONCILER_LOCK_KEY,
    FREE_INCLUDED_GRANT_TYPE,
    USAGE_SEGMENT_RECENT_LOOKBACK_DAYS,
)
from proliferate.db import engine as db_engine
from proliferate.db.models.billing import (
    BillingDecisionEvent,
    BillingEntitlement,
    BillingGrant,
    BillingHold,
    BillingSubject,
    SandboxEventReceipt,
    UsageSegment,
)
from proliferate.db.models.cloud import CloudSandbox, CloudWorkspace
from proliferate.server.billing.models import coerce_utc, utcnow

T = TypeVar("T")


@dataclass(frozen=True)
class BillingSnapshotState:
    billing_subject_id: UUID
    sandboxes: list[CloudSandbox]
    grants: list[BillingGrant]
    entitlements: list[BillingEntitlement]
    holds: list[BillingHold]
    usage_segments: list[UsageSegment]
    historical_billable_seconds: float = 0.0


async def ensure_personal_billing_subject(db: AsyncSession, user_id: UUID) -> BillingSubject:
    now = utcnow()
    result = await db.execute(
        pg_insert(BillingSubject)
        .values(
            kind="personal",
            user_id=user_id,
            organization_id=None,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_nothing(index_elements=[BillingSubject.user_id])
        .returning(BillingSubject.id)
    )
    subject_id = result.scalar_one_or_none()
    if subject_id is None:
        subject = (
            await db.execute(
                select(BillingSubject).where(
                    BillingSubject.kind == "personal",
                    BillingSubject.user_id == user_id,
                )
            )
        ).scalar_one()
    else:
        subject = await db.get(BillingSubject, subject_id)
        if subject is None:
            raise RuntimeError("Billing subject disappeared after creation.")
    return subject


async def ensure_free_included_grant(db: AsyncSession, user_id: UUID) -> bool:
    subject = await ensure_personal_billing_subject(db, user_id)
    now = utcnow()
    result = await db.execute(
        pg_insert(BillingGrant)
        .values(
            user_id=user_id,
            billing_subject_id=subject.id,
            grant_type=FREE_INCLUDED_GRANT_TYPE,
            hours_granted=settings.cloud_free_sandbox_hours,
            effective_at=now,
            expires_at=None,
            source_ref=f"{FREE_INCLUDED_GRANT_TYPE}:{user_id}",
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_nothing(index_elements=[BillingGrant.source_ref])
    )
    return (result.rowcount or 0) > 0


async def list_cloud_sandboxes_for_subject(
    db: AsyncSession,
    billing_subject_id: UUID,
) -> list[CloudSandbox]:
    return list(
        (
            await db.execute(
                select(CloudSandbox)
                .join(CloudWorkspace, CloudSandbox.cloud_workspace_id == CloudWorkspace.id)
                .where(CloudWorkspace.billing_subject_id == billing_subject_id)
            )
        )
        .scalars()
        .all()
    )


async def list_grants(db: AsyncSession, billing_subject_id: UUID) -> list[BillingGrant]:
    return list(
        (
            await db.execute(
                select(BillingGrant)
                .where(BillingGrant.billing_subject_id == billing_subject_id)
                .order_by(BillingGrant.effective_at.asc(), BillingGrant.created_at.asc())
            )
        )
        .scalars()
        .all()
    )


async def list_entitlements(
    db: AsyncSession,
    billing_subject_id: UUID,
) -> list[BillingEntitlement]:
    return list(
        (
            await db.execute(
                select(BillingEntitlement)
                .where(BillingEntitlement.billing_subject_id == billing_subject_id)
                .order_by(
                    BillingEntitlement.effective_at.asc(),
                    BillingEntitlement.created_at.asc(),
                )
            )
        )
        .scalars()
        .all()
    )


async def list_active_holds(db: AsyncSession, billing_subject_id: UUID) -> list[BillingHold]:
    return list(
        (
            await db.execute(
                select(BillingHold)
                .where(
                    BillingHold.billing_subject_id == billing_subject_id,
                    BillingHold.status == "active",
                )
                .order_by(BillingHold.created_at.asc())
            )
        )
        .scalars()
        .all()
    )


async def list_usage_segments(
    db: AsyncSession,
    billing_subject_id: UUID,
    *,
    window_started_at: datetime | None = None,
) -> list[UsageSegment]:
    conditions = [
        UsageSegment.billing_subject_id == billing_subject_id,
        UsageSegment.is_billable.is_(True),
    ]
    if window_started_at is not None:
        recent_cutoff = coerce_utc(window_started_at) or window_started_at
        conditions.append(
            or_(
                UsageSegment.started_at >= recent_cutoff,
                UsageSegment.ended_at.is_(None),
                UsageSegment.ended_at >= recent_cutoff,
            )
        )
    return list(
        (
            await db.execute(
                select(UsageSegment)
                .where(*conditions)
                .order_by(UsageSegment.started_at.asc(), UsageSegment.created_at.asc())
            )
        )
        .scalars()
        .all()
    )


async def sum_billable_usage_seconds_before(
    db: AsyncSession,
    billing_subject_id: UUID,
    *,
    window_started_at: datetime,
) -> float:
    recent_cutoff = coerce_utc(window_started_at) or window_started_at
    result = await db.scalar(
        select(
            func.coalesce(
                func.sum(func.extract("epoch", UsageSegment.ended_at - UsageSegment.started_at)),
                0.0,
            )
        ).where(
            UsageSegment.billing_subject_id == billing_subject_id,
            UsageSegment.is_billable.is_(True),
            UsageSegment.ended_at.is_not(None),
            UsageSegment.started_at < recent_cutoff,
            UsageSegment.ended_at < recent_cutoff,
        )
    )
    return float(result or 0.0)


async def get_open_usage_segment(
    db: AsyncSession,
    sandbox_id: UUID,
) -> UsageSegment | None:
    return (
        await db.execute(
            select(UsageSegment).where(
                UsageSegment.sandbox_id == sandbox_id,
                UsageSegment.ended_at.is_(None),
            )
        )
    ).scalar_one_or_none()


async def get_latest_usage_segment(
    db: AsyncSession,
    sandbox_id: UUID,
) -> UsageSegment | None:
    return (
        await db.execute(
            select(UsageSegment)
            .where(UsageSegment.sandbox_id == sandbox_id)
            .order_by(UsageSegment.started_at.desc(), UsageSegment.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def load_latest_usage_segment_for_sandbox(sandbox_id: UUID) -> UsageSegment | None:
    async with db_engine.async_session_factory() as db:
        return await get_latest_usage_segment(db, sandbox_id)


async def _get_workspace_billing_subject(
    db: AsyncSession,
    workspace_id: UUID,
) -> tuple[UUID, UUID]:
    workspace = await db.get(CloudWorkspace, workspace_id)
    if workspace is None:
        raise RuntimeError("Cloud workspace not found while opening usage segment.")
    return workspace.billing_subject_id, workspace.user_id


async def resolve_billing_subject_id_for_workspace(workspace_id: UUID) -> UUID:
    async with db_engine.async_session_factory() as db:
        billing_subject_id, _owner_user_id = await _get_workspace_billing_subject(
            db,
            workspace_id,
        )
        return billing_subject_id


async def create_usage_segment(
    db: AsyncSession,
    *,
    user_id: UUID,
    billing_subject_id: UUID,
    workspace_id: UUID,
    sandbox_id: UUID,
    external_sandbox_id: str | None,
    sandbox_execution_id: str | None,
    started_at: datetime,
    opened_by: str,
    is_billable: bool = True,
) -> UsageSegment:
    now = utcnow()
    result = await db.execute(
        pg_insert(UsageSegment)
        .values(
            user_id=user_id,
            billing_subject_id=billing_subject_id,
            workspace_id=workspace_id,
            sandbox_id=sandbox_id,
            external_sandbox_id=external_sandbox_id,
            sandbox_execution_id=sandbox_execution_id,
            started_at=coerce_utc(started_at) or now,
            ended_at=None,
            is_billable=is_billable,
            opened_by=opened_by,
            closed_by=None,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_nothing(
            index_elements=[UsageSegment.sandbox_id],
            index_where=UsageSegment.ended_at.is_(None),
        )
        .returning(UsageSegment.id)
    )
    segment_id = result.scalar_one_or_none()
    if segment_id is not None:
        segment = await db.get(UsageSegment, segment_id)
        if segment is None:
            raise RuntimeError("Usage segment disappeared after creation.")
        return segment

    existing = await get_open_usage_segment(db, sandbox_id)
    if existing is None:
        raise RuntimeError("Usage segment insert conflicted but no open segment was found.")
    return existing


async def close_usage_segment(
    db: AsyncSession,
    *,
    sandbox_id: UUID,
    ended_at: datetime,
    closed_by: str,
) -> UsageSegment | None:
    segment = await get_open_usage_segment(db, sandbox_id)
    if segment is None:
        return None

    segment.ended_at = coerce_utc(ended_at) or utcnow()
    segment.closed_by = closed_by
    segment.updated_at = utcnow()
    await db.flush()
    return segment


async def mark_usage_segment_non_billable(
    db: AsyncSession,
    *,
    segment_id: UUID,
    reason: str,
) -> UsageSegment:
    segment = await db.get(UsageSegment, segment_id)
    if segment is None:
        raise RuntimeError("Usage segment not found.")
    segment.is_billable = False
    segment.closed_by = reason
    segment.updated_at = utcnow()
    await db.flush()
    return segment


async def list_open_usage_segments(db: AsyncSession) -> list[UsageSegment]:
    return list(
        (await db.execute(select(UsageSegment).where(UsageSegment.ended_at.is_(None))))
        .scalars()
        .all()
    )


async def record_sandbox_event_receipt(
    db: AsyncSession,
    *,
    event_id: str,
    provider: str,
    event_type: str,
    external_sandbox_id: str | None,
) -> bool:
    result = await db.execute(
        pg_insert(SandboxEventReceipt)
        .values(
            event_id=event_id,
            provider=provider,
            event_type=event_type,
            external_sandbox_id=external_sandbox_id,
            received_at=utcnow(),
        )
        .on_conflict_do_nothing(index_elements=[SandboxEventReceipt.event_id])
    )
    return (result.rowcount or 0) > 0


async def ensure_sandbox_usage_started(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    sandbox_id: UUID,
    actor_user_id: UUID | None,
    external_sandbox_id: str | None,
    sandbox_execution_id: str | None,
    observed_at: datetime,
    source: str,
    event_id: str,
    is_billable: bool,
) -> UsageSegment:
    await record_sandbox_event_receipt(
        db,
        event_id=event_id,
        provider="proliferate",
        event_type=source,
        external_sandbox_id=external_sandbox_id,
    )
    billing_subject_id, owner_user_id = await _get_workspace_billing_subject(db, workspace_id)
    return await create_usage_segment(
        db,
        user_id=actor_user_id or owner_user_id,
        billing_subject_id=billing_subject_id,
        workspace_id=workspace_id,
        sandbox_id=sandbox_id,
        external_sandbox_id=external_sandbox_id,
        sandbox_execution_id=sandbox_execution_id,
        started_at=observed_at,
        opened_by=source,
        is_billable=is_billable,
    )


async def ensure_sandbox_usage_stopped(
    db: AsyncSession,
    *,
    sandbox_id: UUID,
    observed_at: datetime,
    source: str,
    event_id: str,
    reason: str,
) -> UsageSegment | None:
    await record_sandbox_event_receipt(
        db,
        event_id=event_id,
        provider="proliferate",
        event_type=source,
        external_sandbox_id=None,
    )
    return await close_usage_segment(
        db,
        sandbox_id=sandbox_id,
        ended_at=observed_at,
        closed_by=reason,
    )


async def try_acquire_billing_reconciler_lock(db: AsyncSession) -> bool:
    result = await db.scalar(
        text("SELECT pg_try_advisory_lock(:lock_key)"),
        {"lock_key": BILLING_RECONCILER_LOCK_KEY},
    )
    return bool(result)


async def release_billing_reconciler_lock(db: AsyncSession) -> None:
    await db.execute(
        text("SELECT pg_advisory_unlock(:lock_key)"),
        {"lock_key": BILLING_RECONCILER_LOCK_KEY},
    )


async def _build_billing_snapshot_state_for_subject(
    db: AsyncSession,
    billing_subject_id: UUID,
) -> BillingSnapshotState:
    now = utcnow()
    recent_window_started_at = now - timedelta(days=USAGE_SEGMENT_RECENT_LOOKBACK_DAYS)
    grants = await list_grants(db, billing_subject_id)
    entitlements = await list_entitlements(db, billing_subject_id)
    return BillingSnapshotState(
        billing_subject_id=billing_subject_id,
        sandboxes=await list_cloud_sandboxes_for_subject(db, billing_subject_id),
        grants=grants,
        entitlements=entitlements,
        holds=await list_active_holds(db, billing_subject_id),
        usage_segments=await list_usage_segments(
            db,
            billing_subject_id,
            window_started_at=recent_window_started_at,
        ),
        historical_billable_seconds=await sum_billable_usage_seconds_before(
            db,
            billing_subject_id,
            window_started_at=recent_window_started_at,
        ),
    )


async def load_billing_snapshot_state(user_id: UUID) -> BillingSnapshotState:
    async with db_engine.async_session_factory() as db:
        subject = await ensure_personal_billing_subject(db, user_id)
        await ensure_free_included_grant(db, user_id)
        await db.commit()
        return await _build_billing_snapshot_state_for_subject(db, subject.id)


async def load_billing_snapshot_state_for_subject(
    billing_subject_id: UUID,
) -> BillingSnapshotState:
    async with db_engine.async_session_factory() as db:
        subject = await db.get(BillingSubject, billing_subject_id)
        if subject is None:
            raise RuntimeError("Billing subject not found.")
        if subject.kind == "personal" and subject.user_id is not None:
            await ensure_free_included_grant(db, subject.user_id)
            await db.commit()
        return await _build_billing_snapshot_state_for_subject(db, billing_subject_id)


async def resolve_billing_subject_id_for_user(user_id: UUID) -> UUID:
    async with db_engine.async_session_factory() as db:
        subject = await ensure_personal_billing_subject(db, user_id)
        await db.commit()
        return subject.id


async def open_usage_segment_for_sandbox(
    *,
    workspace_id: UUID,
    sandbox_id: UUID,
    external_sandbox_id: str | None,
    sandbox_execution_id: str | None,
    started_at: datetime,
    opened_by: str,
    user_id: UUID | None = None,
    is_billable: bool = True,
    event_id: str | None = None,
) -> UsageSegment:
    async with db_engine.async_session_factory() as db:
        segment = await ensure_sandbox_usage_started(
            db,
            workspace_id=workspace_id,
            sandbox_id=sandbox_id,
            actor_user_id=user_id,
            external_sandbox_id=external_sandbox_id,
            sandbox_execution_id=sandbox_execution_id,
            observed_at=started_at,
            source=opened_by,
            event_id=event_id or f"usage-start:{opened_by}:{sandbox_id}:{started_at.isoformat()}",
            is_billable=is_billable,
        )
        await db.commit()
        await db.refresh(segment)
        return segment


async def close_usage_segment_for_sandbox(
    *,
    sandbox_id: UUID,
    ended_at: datetime,
    closed_by: str,
    is_billable: bool | None = None,
    event_id: str | None = None,
) -> UsageSegment | None:
    async with db_engine.async_session_factory() as db:
        segment = await ensure_sandbox_usage_stopped(
            db,
            sandbox_id=sandbox_id,
            observed_at=ended_at,
            source=closed_by,
            event_id=event_id or f"usage-stop:{closed_by}:{sandbox_id}:{ended_at.isoformat()}",
            reason=closed_by,
        )
        if segment is not None and is_billable is False:
            segment = await mark_usage_segment_non_billable(
                db,
                segment_id=segment.id,
                reason=closed_by,
            )
        await db.commit()
        if segment is None:
            return None
        await db.refresh(segment)
        return segment


async def list_all_open_usage_segments() -> list[UsageSegment]:
    async with db_engine.async_session_factory() as db:
        return await list_open_usage_segments(db)


async def remember_sandbox_event_receipt(
    *,
    event_id: str,
    provider: str,
    event_type: str,
    external_sandbox_id: str | None,
) -> bool:
    async with db_engine.async_session_factory() as db:
        created = await record_sandbox_event_receipt(
            db,
            event_id=event_id,
            provider=provider,
            event_type=event_type,
            external_sandbox_id=external_sandbox_id,
        )
        await db.commit()
        return created


async def record_billing_decision_event(
    *,
    billing_subject_id: UUID,
    actor_user_id: UUID | None,
    workspace_id: UUID | None,
    decision_type: str,
    mode: str,
    would_block_start: bool,
    would_pause_active: bool,
    reason: str | None,
    active_sandbox_count: int,
    remaining_seconds: float | None,
) -> None:
    async with db_engine.async_session_factory() as db:
        db.add(
            BillingDecisionEvent(
                billing_subject_id=billing_subject_id,
                actor_user_id=actor_user_id,
                workspace_id=workspace_id,
                decision_type=decision_type,
                mode=mode,
                would_block_start=would_block_start,
                would_pause_active=would_pause_active,
                reason=reason,
                active_sandbox_count=active_sandbox_count,
                remaining_seconds=remaining_seconds,
                created_at=utcnow(),
            )
        )
        await db.commit()


async def with_billing_reconciler_lock[T](
    callback: Callable[[AsyncSession], Awaitable[T]],
) -> tuple[bool, T | None]:
    async with db_engine.async_session_factory() as db:
        acquired = await try_acquire_billing_reconciler_lock(db)
        if not acquired:
            return False, None
        try:
            result = await callback(db)
            await db.commit()
            return True, result
        finally:
            await release_billing_reconciler_lock(db)
