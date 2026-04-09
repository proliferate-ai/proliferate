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
    BillingEntitlement,
    BillingGrant,
    SandboxEventReceipt,
    UsageSegment,
)
from proliferate.db.models.cloud import CloudSandbox, CloudWorkspace
from proliferate.server.billing.models import coerce_utc, utcnow

T = TypeVar("T")


@dataclass(frozen=True)
class BillingSnapshotState:
    sandboxes: list[CloudSandbox]
    grants: list[BillingGrant]
    entitlements: list[BillingEntitlement]
    usage_segments: list[UsageSegment]
    historical_billable_seconds: float = 0.0


async def ensure_free_included_grant(db: AsyncSession, user_id: UUID) -> bool:
    now = utcnow()
    result = await db.execute(
        pg_insert(BillingGrant)
        .values(
            user_id=user_id,
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


async def list_cloud_sandboxes_for_user(db: AsyncSession, user_id: UUID) -> list[CloudSandbox]:
    return list(
        (
            await db.execute(
                select(CloudSandbox)
                .join(CloudWorkspace, CloudSandbox.cloud_workspace_id == CloudWorkspace.id)
                .where(CloudWorkspace.user_id == user_id)
            )
        )
        .scalars()
        .all()
    )


async def list_grants(db: AsyncSession, user_id: UUID) -> list[BillingGrant]:
    return list(
        (
            await db.execute(
                select(BillingGrant)
                .where(BillingGrant.user_id == user_id)
                .order_by(BillingGrant.effective_at.asc(), BillingGrant.created_at.asc())
            )
        )
        .scalars()
        .all()
    )


async def list_entitlements(db: AsyncSession, user_id: UUID) -> list[BillingEntitlement]:
    return list(
        (
            await db.execute(
                select(BillingEntitlement)
                .where(BillingEntitlement.user_id == user_id)
                .order_by(
                    BillingEntitlement.effective_at.asc(),
                    BillingEntitlement.created_at.asc(),
                )
            )
        )
        .scalars()
        .all()
    )


async def list_usage_segments(
    db: AsyncSession,
    user_id: UUID,
    *,
    window_started_at: datetime | None = None,
) -> list[UsageSegment]:
    conditions = [
        UsageSegment.user_id == user_id,
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
    user_id: UUID,
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
            UsageSegment.user_id == user_id,
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


async def create_usage_segment(
    db: AsyncSession,
    *,
    user_id: UUID,
    workspace_id: UUID,
    sandbox_id: UUID,
    external_sandbox_id: str | None,
    sandbox_execution_id: str | None,
    started_at: datetime,
    opened_by: str,
    is_billable: bool = True,
) -> UsageSegment:
    existing = await get_open_usage_segment(db, sandbox_id)
    if existing is not None:
        return existing

    now = utcnow()
    segment = UsageSegment(
        user_id=user_id,
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
    db.add(segment)
    await db.flush()
    return segment


async def close_usage_segment(
    db: AsyncSession,
    *,
    sandbox_id: UUID,
    ended_at: datetime,
    closed_by: str,
    is_billable: bool | None = None,
) -> UsageSegment | None:
    segment = await get_open_usage_segment(db, sandbox_id)
    if segment is None:
        return None

    segment.ended_at = coerce_utc(ended_at) or utcnow()
    segment.closed_by = closed_by
    if is_billable is not None:
        segment.is_billable = is_billable
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
    existing = (
        await db.execute(
            select(SandboxEventReceipt).where(SandboxEventReceipt.event_id == event_id)
        )
    ).scalar_one_or_none()
    if existing is not None:
        return False

    db.add(
        SandboxEventReceipt(
            event_id=event_id,
            provider=provider,
            event_type=event_type,
            external_sandbox_id=external_sandbox_id,
            received_at=utcnow(),
        )
    )
    await db.flush()
    return True


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


async def load_billing_snapshot_state(user_id: UUID) -> BillingSnapshotState:
    async with db_engine.async_session_factory() as db:
        changed = await ensure_free_included_grant(db, user_id)
        if changed:
            await db.commit()
        now = utcnow()
        recent_window_started_at = now - timedelta(days=USAGE_SEGMENT_RECENT_LOOKBACK_DAYS)
        grants = await list_grants(db, user_id)
        entitlements = await list_entitlements(db, user_id)
        return BillingSnapshotState(
            sandboxes=await list_cloud_sandboxes_for_user(db, user_id),
            grants=grants,
            entitlements=entitlements,
            usage_segments=await list_usage_segments(
                db,
                user_id,
                window_started_at=recent_window_started_at,
            ),
            historical_billable_seconds=await sum_billable_usage_seconds_before(
                db,
                user_id,
                window_started_at=recent_window_started_at,
            ),
        )


async def open_usage_segment_for_sandbox(
    *,
    user_id: UUID,
    workspace_id: UUID,
    sandbox_id: UUID,
    external_sandbox_id: str | None,
    sandbox_execution_id: str | None,
    started_at: datetime,
    opened_by: str,
    is_billable: bool = True,
) -> UsageSegment:
    async with db_engine.async_session_factory() as db:
        segment = await create_usage_segment(
            db,
            user_id=user_id,
            workspace_id=workspace_id,
            sandbox_id=sandbox_id,
            external_sandbox_id=external_sandbox_id,
            sandbox_execution_id=sandbox_execution_id,
            started_at=started_at,
            opened_by=opened_by,
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
) -> UsageSegment | None:
    async with db_engine.async_session_factory() as db:
        segment = await close_usage_segment(
            db,
            sandbox_id=sandbox_id,
            ended_at=ended_at,
            closed_by=closed_by,
            is_billable=is_billable,
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
