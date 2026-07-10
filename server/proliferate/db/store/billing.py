"""Billing persistence layer."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import delete, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from proliferate.constants.billing import (
    BILLING_USAGE_EXPORT_STATUS_FAILED_RETRYABLE,
    BILLING_USAGE_EXPORT_STATUS_OBSERVED,
    BILLING_USAGE_EXPORT_STATUS_PENDING,
    BILLING_USAGE_EXPORT_STATUS_SENDING,
    BILLING_USAGE_EXPORT_STATUS_SUCCEEDED,
)
from proliferate.constants.cloud import RepoEnvironmentKind
from proliferate.db.models.billing import (
    BillingBudgetLimit,
    BillingEntitlement,
    BillingGrant,
    BillingSubject,
    BillingUsageCursor,
    BillingUsageExport,
    UsageSegment,
)
from proliferate.db.models.cloud.repositories import RepoConfig, RepoEnvironment
from proliferate.db.models.cloud.sandboxes import CloudSandbox


def coerce_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


async def list_cloud_sandboxes_for_subject(
    db: AsyncSession,
    billing_subject_id: UUID,
) -> list[CloudSandbox]:
    subject = await db.get(BillingSubject, billing_subject_id)
    if subject is None or subject.user_id is None:
        return []
    return list(
        (
            await db.execute(
                select(CloudSandbox).where(
                    CloudSandbox.owner_user_id == subject.user_id,
                    CloudSandbox.destroyed_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )


async def count_active_cloud_repo_environments(
    db: AsyncSession,
    billing_subject_id: UUID,
) -> int:
    subject = await db.get(BillingSubject, billing_subject_id)
    if subject is None or subject.user_id is None:
        return 0

    repo_keys = {
        ("github", git_owner_norm, git_repo_name_norm)
        for git_owner_norm, git_repo_name_norm in (
            await db.execute(
                select(
                    func.lower(func.btrim(RepoConfig.git_owner)),
                    func.lower(func.btrim(RepoConfig.git_repo_name)),
                )
                .join(RepoEnvironment, RepoEnvironment.repo_config_id == RepoConfig.id)
                .where(
                    RepoConfig.user_id == subject.user_id,
                    RepoConfig.deleted_at.is_(None),
                    RepoEnvironment.environment_kind == RepoEnvironmentKind.cloud,
                    RepoEnvironment.deleted_at.is_(None),
                )
                .distinct()
            )
        ).all()
    }

    return len(repo_keys)


async def cloud_repo_slot_exists(
    db: AsyncSession,
    *,
    billing_subject_id: UUID,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
) -> bool:
    git_owner_norm = git_owner.strip().lower()
    git_repo_name_norm = git_repo_name.strip().lower()
    subject = await db.get(BillingSubject, billing_subject_id)
    if subject is None or subject.user_id is None or git_provider != "github":
        return False

    configured_repo_environment_id = await db.scalar(
        select(RepoEnvironment.id)
        .join(RepoConfig, RepoEnvironment.repo_config_id == RepoConfig.id)
        .where(
            RepoConfig.user_id == subject.user_id,
            RepoConfig.deleted_at.is_(None),
            func.lower(func.btrim(RepoConfig.git_owner)) == git_owner_norm,
            func.lower(func.btrim(RepoConfig.git_repo_name)) == git_repo_name_norm,
            RepoEnvironment.environment_kind == RepoEnvironmentKind.cloud,
            RepoEnvironment.deleted_at.is_(None),
        )
        .limit(1)
    )
    return configured_repo_environment_id is not None


async def acquire_billing_subject_repo_limit_lock(
    db: AsyncSession,
    billing_subject_id: UUID,
) -> None:
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": f"cloud-repo-limit:{billing_subject_id}"},
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


async def estimate_unaccounted_billable_seconds(
    db: AsyncSession,
    billing_subject_id: UUID,
    *,
    now: datetime,
) -> float:
    rows = (
        await db.execute(
            select(UsageSegment, BillingUsageCursor.accounted_until)
            .outerjoin(
                BillingUsageCursor,
                BillingUsageCursor.usage_segment_id == UsageSegment.id,
            )
            .where(
                UsageSegment.billing_subject_id == billing_subject_id,
                UsageSegment.is_billable.is_(True),
            )
        )
    ).all()
    total = 0.0
    current_time = coerce_utc(now) or now
    for segment, cursor_accounted_until in rows:
        segment_end = coerce_utc(segment.ended_at) or current_time
        accounted_from = max(
            coerce_utc(segment.started_at) or current_time,
            coerce_utc(cursor_accounted_until) or (coerce_utc(segment.started_at) or current_time),
        )
        if segment_end > accounted_from:
            total += (segment_end - accounted_from).total_seconds()
    return max(total, 0.0)


_CAP_COUNTING_EXPORT_STATUSES = {
    BILLING_USAGE_EXPORT_STATUS_PENDING,
    BILLING_USAGE_EXPORT_STATUS_SENDING,
    BILLING_USAGE_EXPORT_STATUS_SUCCEEDED,
    # Retryable rows are durable billable exports that have already advanced usage
    # cursors. Keep them in cap spend so later accounting passes cannot overrun
    # the cap while Stripe delivery is being retried for the same row.
    BILLING_USAGE_EXPORT_STATUS_FAILED_RETRYABLE,
    BILLING_USAGE_EXPORT_STATUS_OBSERVED,
}


async def sum_meter_quantity_cents_for_subject(
    db: AsyncSession,
    billing_subject_id: UUID,
    *,
    period_start: datetime | None = None,
) -> int:
    conditions = [
        BillingUsageExport.billing_subject_id == billing_subject_id,
        BillingUsageExport.status.in_(_CAP_COUNTING_EXPORT_STATUSES),
        BillingUsageExport.meter_quantity_cents.is_not(None),
    ]
    if period_start is not None:
        conditions.append(
            BillingUsageExport.period_start == (coerce_utc(period_start) or period_start)
        )
    result = await db.scalar(
        select(func.coalesce(func.sum(BillingUsageExport.meter_quantity_cents), 0)).where(
            *conditions
        )
    )
    return int(result or 0)


def _clipped_segment_seconds(now: datetime) -> ColumnElement[float]:
    """Segment duration in seconds, clipping still-open segments at ``now``.

    NOTE (rollup seam): each segment's full duration is attributed to the
    bucket of its ``started_at`` rather than being split across bucket
    boundaries. This is exact for closed same-bucket segments and good enough
    at current volumes; revisit with a rollup/materialized table if a segment
    routinely straddles many buckets.
    """
    clipped_now = coerce_utc(now) or now
    return func.extract(
        "epoch",
        func.coalesce(UsageSegment.ended_at, clipped_now) - UsageSegment.started_at,
    )


async def compute_usage_seconds_timeseries(
    db: AsyncSession,
    *,
    billing_subject_id: UUID,
    granularity: str,
    start: datetime,
    end: datetime,
    now: datetime,
    user_id: UUID | None = None,
) -> list[tuple[datetime, float]]:
    """Billable compute seconds bucketed by ``date_trunc(granularity, started_at)``.

    Buckets are attributed by ``started_at`` (see ``_clipped_segment_seconds``).
    Missing buckets are not zero-filled here — the caller fills gaps.
    """
    bucket = func.date_trunc(granularity, UsageSegment.started_at)
    window_start = coerce_utc(start) or start
    window_end = coerce_utc(end) or end
    conditions = [
        UsageSegment.billing_subject_id == billing_subject_id,
        UsageSegment.is_billable.is_(True),
        UsageSegment.started_at >= window_start,
        UsageSegment.started_at < window_end,
    ]
    if user_id is not None:
        conditions.append(UsageSegment.user_id == user_id)
    rows = (
        await db.execute(
            select(
                bucket.label("bucket"),
                func.coalesce(func.sum(_clipped_segment_seconds(now)), 0.0),
            )
            .where(*conditions)
            .group_by(bucket)
            .order_by(bucket)
        )
    ).all()
    return [
        ((coerce_utc(bucket_start) or bucket_start), float(seconds or 0.0))
        for bucket_start, seconds in rows
    ]


async def compute_usage_seconds_by_user(
    db: AsyncSession,
    *,
    billing_subject_id: UUID,
    start: datetime,
    end: datetime,
    now: datetime,
) -> dict[UUID, float]:
    """Billable compute seconds per user over ``[start, end)`` for a subject."""
    window_start = coerce_utc(start) or start
    window_end = coerce_utc(end) or end
    rows = (
        await db.execute(
            select(
                UsageSegment.user_id,
                func.coalesce(func.sum(_clipped_segment_seconds(now)), 0.0),
            )
            .where(
                UsageSegment.billing_subject_id == billing_subject_id,
                UsageSegment.is_billable.is_(True),
                UsageSegment.started_at >= window_start,
                UsageSegment.started_at < window_end,
            )
            .group_by(UsageSegment.user_id)
        )
    ).all()
    return {user_id: float(seconds or 0.0) for user_id, seconds in rows}


async def compute_usage_seconds_by_user_for_org(
    db: AsyncSession,
    *,
    organization_id: UUID,
    start: datetime,
    end: datetime,
    now: datetime,
) -> dict[UUID, float]:
    """Billable compute seconds per user over ``[start, end)`` scoped to an org.

    Groups by ``UsageSegment.organization_id`` (not billing subject) so the
    org-admin usage-by-user view aggregates every member's compute regardless of
    which subject each segment is invoiced to — the same scope the enforcement
    path sums (``compute_usage_seconds_in_window_for_org``). Segments opened
    before org compute billed the org still carry ``organization_id`` (stamped at
    open time since #1028), so they are included even where their paying subject
    is still a personal one.
    """
    window_start = coerce_utc(start) or start
    window_end = coerce_utc(end) or end
    rows = (
        await db.execute(
            select(
                UsageSegment.user_id,
                func.coalesce(func.sum(_clipped_segment_seconds(now)), 0.0),
            )
            .where(
                UsageSegment.organization_id == organization_id,
                UsageSegment.is_billable.is_(True),
                UsageSegment.started_at >= window_start,
                UsageSegment.started_at < window_end,
            )
            .group_by(UsageSegment.user_id)
        )
    ).all()
    return {user_id: float(seconds or 0.0) for user_id, seconds in rows}


async def compute_usage_seconds_in_window(
    db: AsyncSession,
    *,
    billing_subject_id: UUID,
    start: datetime,
    end: datetime,
    now: datetime,
    user_id: UUID | None = None,
) -> float:
    """Total billable compute seconds over ``[start, end)`` for enforcement.

    ``user_id=None`` sums the whole subject (org-wide); otherwise it filters to
    that user. Segment attribution uses ``started_at`` (see the timeseries note).
    """
    window_start = coerce_utc(start) or start
    window_end = coerce_utc(end) or end
    conditions = [
        UsageSegment.billing_subject_id == billing_subject_id,
        UsageSegment.is_billable.is_(True),
        UsageSegment.started_at >= window_start,
        UsageSegment.started_at < window_end,
    ]
    if user_id is not None:
        conditions.append(UsageSegment.user_id == user_id)
    result = await db.scalar(
        select(func.coalesce(func.sum(_clipped_segment_seconds(now)), 0.0)).where(*conditions)
    )
    return float(result or 0.0)


async def compute_usage_seconds_in_window_for_org(
    db: AsyncSession,
    *,
    organization_id: UUID,
    start: datetime,
    end: datetime,
    now: datetime,
    user_id: UUID | None = None,
) -> float:
    """Total billable compute seconds over ``[start, end)`` scoped to an org.

    Sums by ``UsageSegment.organization_id`` (not by billing subject) so an
    org's compute usage aggregates across every member's segments regardless of
    which personal subject each one is invoiced to. ``user_id=None`` sums the
    whole org (org-wide cap); otherwise it filters to that member (per-user cap).
    Segment attribution uses ``started_at`` (see the timeseries note).
    """
    window_start = coerce_utc(start) or start
    window_end = coerce_utc(end) or end
    conditions = [
        UsageSegment.organization_id == organization_id,
        UsageSegment.is_billable.is_(True),
        UsageSegment.started_at >= window_start,
        UsageSegment.started_at < window_end,
    ]
    if user_id is not None:
        conditions.append(UsageSegment.user_id == user_id)
    result = await db.scalar(
        select(func.coalesce(func.sum(_clipped_segment_seconds(now)), 0.0)).where(*conditions)
    )
    return float(result or 0.0)


@dataclass(frozen=True)
class BudgetLimitInput:
    """A single limit in a full-replace limit set."""

    user_id: UUID | None
    kind: str
    window: str
    cap_value: Decimal
    enabled: bool


async def list_budget_limits(
    db: AsyncSession,
    organization_id: UUID,
) -> list[BillingBudgetLimit]:
    return list(
        (
            await db.execute(
                select(BillingBudgetLimit)
                .where(BillingBudgetLimit.organization_id == organization_id)
                .order_by(
                    BillingBudgetLimit.user_id.is_(None).desc(),
                    BillingBudgetLimit.kind.asc(),
                    BillingBudgetLimit.window.asc(),
                )
            )
        )
        .scalars()
        .all()
    )


async def replace_budget_limits(
    db: AsyncSession,
    *,
    organization_id: UUID,
    limits: list[BudgetLimitInput],
) -> list[BillingBudgetLimit]:
    """Full-replace the org's limit set (delete existing, insert the new set)."""
    await db.execute(
        delete(BillingBudgetLimit).where(BillingBudgetLimit.organization_id == organization_id)
    )
    await db.flush()
    db.add_all(
        BillingBudgetLimit(
            organization_id=organization_id,
            user_id=limit.user_id,
            kind=limit.kind,
            window=limit.window,
            cap_value=limit.cap_value,
            enabled=limit.enabled,
        )
        for limit in limits
    )
    await db.flush()
    return await list_budget_limits(db, organization_id)
