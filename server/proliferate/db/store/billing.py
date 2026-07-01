"""Billing persistence layer."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.billing import (
    BILLING_USAGE_EXPORT_STATUS_FAILED_RETRYABLE,
    BILLING_USAGE_EXPORT_STATUS_OBSERVED,
    BILLING_USAGE_EXPORT_STATUS_PENDING,
    BILLING_USAGE_EXPORT_STATUS_SENDING,
    BILLING_USAGE_EXPORT_STATUS_SUCCEEDED,
)
from proliferate.db.models.billing import (
    BillingEntitlement,
    BillingGrant,
    BillingSubject,
    BillingUsageCursor,
    BillingUsageExport,
    UsageSegment,
)
from proliferate.constants.cloud import RepoEnvironmentKind
from proliferate.db.models.cloud.repositories import RepoConfig, RepoEnvironment
from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.db.models.cloud.workspaces import CloudWorkspace


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
