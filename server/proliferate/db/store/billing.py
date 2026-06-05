"""Billing persistence layer."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import func, or_, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.billing import (
    BILLING_HOLD_KIND_PAYMENT_FAILED,
    BILLING_HOLD_STATUS_ACTIVE,
    BILLING_SEAT_ADJUSTMENT_MAX_ATTEMPTS,
    BILLING_SUBJECT_KIND_ORGANIZATION,
    BILLING_USAGE_EXPORT_STATUS_FAILED_RETRYABLE,
    BILLING_USAGE_EXPORT_STATUS_OBSERVED,
    BILLING_USAGE_EXPORT_STATUS_PENDING,
    BILLING_USAGE_EXPORT_STATUS_SENDING,
    BILLING_USAGE_EXPORT_STATUS_SUCCEEDED,
    USAGE_SEGMENT_RECENT_LOOKBACK_DAYS,
)
from proliferate.constants.organizations import ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE
from proliferate.db.models.billing import (
    BillingEntitlement,
    BillingGrant,
    BillingHold,
    BillingSeatAdjustment,
    BillingSubject,
    BillingSubscription,
    BillingUsageCursor,
    BillingUsageExport,
    UsageSegment,
)
from proliferate.db.models.cloud.repo_config import CloudRepoConfig
from proliferate.db.models.cloud.runtime_environments import CloudRuntimeEnvironment
from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.models.organizations import OrganizationMembership
from proliferate.utils.time import utcnow


def coerce_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


@dataclass(frozen=True)
class BillingSnapshotState:
    subject: BillingSubject
    billing_subject_id: UUID
    sandboxes: list[CloudSandbox]
    grants: list[BillingGrant]
    entitlements: list[BillingEntitlement]
    holds: list[BillingHold]
    subscriptions: list[BillingSubscription]
    usage_segments: list[UsageSegment]
    active_cloud_repo_count: int = 0
    unaccounted_billable_seconds: float = 0.0
    historical_billable_seconds: float = 0.0
    active_seat_count: int = 1
    managed_cloud_overage_used_cents: int = 0


@dataclass(frozen=True)
class ClaimedSeatAdjustment:
    id: UUID
    billing_subject_id: UUID
    billing_subscription_id: UUID
    user_id: UUID | None
    membership_id: UUID | None
    stripe_subscription_id: str
    monthly_subscription_item_id: str
    previous_quantity: int | None
    target_quantity: int
    grant_quantity: int
    period_start: datetime | None
    period_end: datetime | None
    effective_at: datetime | None
    source_ref: str


@dataclass(frozen=True)
class InitialSeatReconcileAdjustment:
    id: UUID
    monthly_subscription_item_id: str
    target_quantity: int


async def list_cloud_sandboxes_for_subject(
    db: AsyncSession,
    billing_subject_id: UUID,
) -> list[CloudSandbox]:
    return list(
        (
            await db.execute(
                select(CloudSandbox)
                .outerjoin(
                    CloudRuntimeEnvironment,
                    CloudRuntimeEnvironment.active_sandbox_id == CloudSandbox.id,
                )
                .outerjoin(
                    CloudWorkspace,
                    CloudWorkspace.active_sandbox_id == CloudSandbox.id,
                )
                .where(
                    or_(
                        CloudSandbox.billing_subject_id == billing_subject_id,
                        (
                            CloudSandbox.billing_subject_id.is_(None)
                            & or_(
                                CloudRuntimeEnvironment.billing_subject_id == billing_subject_id,
                                CloudWorkspace.billing_subject_id == billing_subject_id,
                            )
                        ),
                    )
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
    repo_keys = {
        (
            git_provider,
            git_owner_norm,
            git_repo_name_norm,
        )
        for git_provider, git_owner_norm, git_repo_name_norm in (
            await db.execute(
                select(
                    CloudWorkspace.git_provider,
                    func.coalesce(
                        CloudRuntimeEnvironment.git_owner_norm,
                        func.lower(func.btrim(CloudWorkspace.git_owner)),
                    ),
                    func.coalesce(
                        CloudRuntimeEnvironment.git_repo_name_norm,
                        func.lower(func.btrim(CloudWorkspace.git_repo_name)),
                    ),
                )
                .outerjoin(
                    CloudRuntimeEnvironment,
                    CloudWorkspace.runtime_environment_id == CloudRuntimeEnvironment.id,
                )
                .where(
                    CloudWorkspace.billing_subject_id == billing_subject_id,
                    CloudWorkspace.archived_at.is_(None),
                )
                .distinct()
            )
        ).all()
    }

    subject = await db.get(BillingSubject, billing_subject_id)
    if subject is not None and subject.user_id is not None:
        repo_keys.update(
            (
                "github",
                git_owner_norm,
                git_repo_name_norm,
            )
            for git_owner_norm, git_repo_name_norm in (
                await db.execute(
                    select(
                        func.lower(func.btrim(CloudRepoConfig.git_owner)),
                        func.lower(func.btrim(CloudRepoConfig.git_repo_name)),
                    )
                    .where(
                        CloudRepoConfig.user_id == subject.user_id,
                        CloudRepoConfig.configured.is_(True),
                    )
                    .distinct()
                )
            ).all()
        )

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
    active_workspace_id = await db.scalar(
        select(CloudWorkspace.id)
        .outerjoin(
            CloudRuntimeEnvironment,
            CloudWorkspace.runtime_environment_id == CloudRuntimeEnvironment.id,
        )
        .where(
            CloudWorkspace.billing_subject_id == billing_subject_id,
            CloudWorkspace.git_provider == git_provider,
            func.coalesce(
                CloudRuntimeEnvironment.git_owner_norm,
                func.lower(func.btrim(CloudWorkspace.git_owner)),
            )
            == git_owner_norm,
            func.coalesce(
                CloudRuntimeEnvironment.git_repo_name_norm,
                func.lower(func.btrim(CloudWorkspace.git_repo_name)),
            )
            == git_repo_name_norm,
            CloudWorkspace.archived_at.is_(None),
        )
        .limit(1)
    )
    if active_workspace_id is not None:
        return True

    subject = await db.get(BillingSubject, billing_subject_id)
    if subject is None or subject.user_id is None or git_provider != "github":
        return False

    configured_repo_id = await db.scalar(
        select(CloudRepoConfig.id)
        .where(
            CloudRepoConfig.user_id == subject.user_id,
            func.lower(func.btrim(CloudRepoConfig.git_owner)) == git_owner_norm,
            func.lower(func.btrim(CloudRepoConfig.git_repo_name)) == git_repo_name_norm,
            CloudRepoConfig.configured.is_(True),
        )
        .limit(1)
    )
    return configured_repo_id is not None


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


async def list_active_holds(db: AsyncSession, billing_subject_id: UUID) -> list[BillingHold]:
    return list(
        (
            await db.execute(
                select(BillingHold)
                .where(
                    BillingHold.billing_subject_id == billing_subject_id,
                    BillingHold.status == BILLING_HOLD_STATUS_ACTIVE,
                )
                .order_by(BillingHold.created_at.asc())
            )
        )
        .scalars()
        .all()
    )


async def list_subscriptions(
    db: AsyncSession,
    billing_subject_id: UUID,
) -> list[BillingSubscription]:
    return list(
        (
            await db.execute(
                select(BillingSubscription)
                .where(BillingSubscription.billing_subject_id == billing_subject_id)
                .order_by(
                    BillingSubscription.current_period_end.desc().nullslast(),
                    BillingSubscription.updated_at.desc(),
                )
            )
        )
        .scalars()
        .all()
    )


async def upsert_billing_subscription(
    db: AsyncSession,
    *,
    billing_subject_id: UUID,
    stripe_subscription_id: str,
    stripe_customer_id: str,
    status: str,
    cancel_at_period_end: bool,
    canceled_at: datetime | None,
    current_period_start: datetime | None,
    current_period_end: datetime | None,
    cloud_monthly_price_id: str | None,
    overage_price_id: str | None,
    monthly_subscription_item_id: str | None,
    metered_subscription_item_id: str | None,
    latest_invoice_id: str | None,
    latest_invoice_status: str | None,
    hosted_invoice_url: str | None,
    seat_quantity: int | None = None,
) -> BillingSubscription:
    now = utcnow()
    values = {
        "billing_subject_id": billing_subject_id,
        "stripe_subscription_id": stripe_subscription_id,
        "stripe_customer_id": stripe_customer_id,
        "status": status,
        "cancel_at_period_end": cancel_at_period_end,
        "canceled_at": coerce_utc(canceled_at),
        "current_period_start": coerce_utc(current_period_start),
        "current_period_end": coerce_utc(current_period_end),
        "cloud_monthly_price_id": cloud_monthly_price_id,
        "overage_price_id": overage_price_id,
        "seat_quantity": seat_quantity,
        "monthly_subscription_item_id": monthly_subscription_item_id,
        "metered_subscription_item_id": metered_subscription_item_id,
        "latest_invoice_id": latest_invoice_id,
        "latest_invoice_status": latest_invoice_status,
        "hosted_invoice_url": hosted_invoice_url,
        "created_at": now,
        "updated_at": now,
    }
    result = await db.execute(
        pg_insert(BillingSubscription)
        .values(**values)
        .on_conflict_do_update(
            index_elements=[BillingSubscription.stripe_subscription_id],
            set_={
                key: value
                for key, value in values.items()
                if key not in {"stripe_subscription_id", "created_at"}
            }
            | {"updated_at": now},
        )
        .returning(BillingSubscription.id)
    )
    subscription_id = result.scalar_one()
    subscription = await db.get(BillingSubscription, subscription_id)
    if subscription is None:
        raise RuntimeError("Billing subscription disappeared after upsert.")
    return subscription


async def upsert_stripe_subscription_record(
    db: AsyncSession,
    *,
    billing_subject_id: UUID,
    stripe_subscription_id: str,
    stripe_customer_id: str,
    status: str,
    cancel_at_period_end: bool,
    canceled_at: datetime | None,
    current_period_start: datetime | None,
    current_period_end: datetime | None,
    cloud_monthly_price_id: str | None,
    overage_price_id: str | None,
    monthly_subscription_item_id: str | None,
    metered_subscription_item_id: str | None,
    latest_invoice_id: str | None,
    latest_invoice_status: str | None,
    hosted_invoice_url: str | None,
    seat_quantity: int | None = None,
    default_pro_overage_enabled: bool = False,
) -> BillingSubscription:
    subscription = await upsert_billing_subscription(
        db,
        billing_subject_id=billing_subject_id,
        stripe_subscription_id=stripe_subscription_id,
        stripe_customer_id=stripe_customer_id,
        status=status,
        cancel_at_period_end=cancel_at_period_end,
        canceled_at=canceled_at,
        current_period_start=current_period_start,
        current_period_end=current_period_end,
        cloud_monthly_price_id=cloud_monthly_price_id,
        overage_price_id=overage_price_id,
        monthly_subscription_item_id=monthly_subscription_item_id,
        metered_subscription_item_id=metered_subscription_item_id,
        latest_invoice_id=latest_invoice_id,
        latest_invoice_status=latest_invoice_status,
        hosted_invoice_url=hosted_invoice_url,
        seat_quantity=seat_quantity,
    )
    if default_pro_overage_enabled:
        subject = await db.get(BillingSubject, billing_subject_id)
        if subject is not None and subject.overage_preference_set_at is None:
            now = utcnow()
            subject.overage_enabled = True
            subject.overage_preference_set_at = now
            subject.updated_at = now
    await db.flush()
    return subscription


async def maybe_create_org_seat_adjustment(
    db: AsyncSession,
    *,
    organization_id: UUID,
    membership_id: UUID | None,
    pro_billing_enabled: bool,
    pro_monthly_price_id: str,
) -> bool:
    if not pro_billing_enabled:
        return False
    subject = (
        await db.execute(
            select(BillingSubject)
            .where(
                BillingSubject.kind == BILLING_SUBJECT_KIND_ORGANIZATION,
                BillingSubject.organization_id == organization_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if subject is None:
        return False
    subscription = (
        await db.execute(
            select(BillingSubscription)
            .where(
                BillingSubscription.billing_subject_id == subject.id,
                BillingSubscription.status.in_(["active", "trialing"]),
            )
            .order_by(
                BillingSubscription.current_period_end.desc().nulls_last(),
                BillingSubscription.updated_at.desc(),
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if (
        subscription is None
        or subscription.monthly_subscription_item_id is None
        or not pro_monthly_price_id
        or subscription.cloud_monthly_price_id != pro_monthly_price_id
        or subscription.current_period_start is None
    ):
        return False
    target_quantity = await count_active_seats_for_billing_subject(db, subject)
    previous_quantity = (
        int(subscription.seat_quantity)
        if subscription.seat_quantity is not None
        else target_quantity
    )
    period_start = (
        coerce_utc(subscription.current_period_start) or subscription.current_period_start
    )
    now = utcnow()
    grant_quantity = 0
    if target_quantity > previous_quantity and membership_id is not None:
        membership = await db.get(OrganizationMembership, membership_id)
        had_current_period_decrease = await _has_current_period_seat_decrease_for_membership(
            db,
            billing_subscription_id=subscription.id,
            membership_id=membership_id,
            period_start=subscription.current_period_start,
        )
        if (
            membership is not None
            and membership.status == ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE
            and now >= period_start
            and not had_current_period_decrease
        ):
            grant_quantity = min(target_quantity - previous_quantity, 1)
    if target_quantity == previous_quantity and grant_quantity == 0:
        return False
    source_ref = (
        "stripe:seat-adjustment:"
        f"{subscription.stripe_subscription_id}:{membership_id or organization_id}:"
        f"{int(subscription.current_period_start.timestamp())}:"
        f"{int(now.timestamp() * 1_000_000)}"
    )
    result = await db.execute(
        pg_insert(BillingSeatAdjustment)
        .values(
            billing_subject_id=subject.id,
            billing_subscription_id=subscription.id,
            organization_id=organization_id,
            membership_id=membership_id,
            stripe_subscription_id=subscription.stripe_subscription_id,
            monthly_subscription_item_id=subscription.monthly_subscription_item_id,
            previous_quantity=previous_quantity,
            target_quantity=target_quantity,
            grant_quantity=grant_quantity,
            attempt_count=0,
            period_start=subscription.current_period_start,
            effective_at=now,
            source_ref=source_ref,
            status="pending",
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_nothing(index_elements=[BillingSeatAdjustment.source_ref])
    )
    return (result.rowcount or 0) > 0


async def claim_pending_seat_adjustments(
    db: AsyncSession,
    limit: int = 100,
) -> list[ClaimedSeatAdjustment]:
    rows = (
        await db.execute(
            select(BillingSeatAdjustment, BillingSubscription, BillingSubject)
            .join(
                BillingSubscription,
                BillingSubscription.id == BillingSeatAdjustment.billing_subscription_id,
            )
            .join(
                BillingSubject,
                BillingSubject.id == BillingSeatAdjustment.billing_subject_id,
            )
            .where(BillingSeatAdjustment.status.in_(["pending", "failed_retryable"]))
            .order_by(BillingSeatAdjustment.created_at.asc())
            .limit(limit)
            .with_for_update(
                skip_locked=True,
                of=(BillingSeatAdjustment, BillingSubscription, BillingSubject),
            )
        )
    ).all()
    now = utcnow()
    claimed: list[ClaimedSeatAdjustment] = []
    for adjustment, subscription, subject in rows:
        if adjustment.monthly_subscription_item_id is None:
            adjustment.status = "failed_terminal"
            adjustment.last_error = "Missing Stripe subscription item id."
            adjustment.updated_at = now
            continue
        if adjustment.stripe_confirmed_at is None:
            current_quantity = await count_active_seats_for_billing_subject(db, subject)
            confirmed_quantity = (
                int(subscription.seat_quantity)
                if subscription.seat_quantity is not None
                else adjustment.previous_quantity
            )
            if confirmed_quantity is None:
                confirmed_quantity = current_quantity
            grant_quantity = 0
            period_start = coerce_utc(adjustment.period_start)
            # Use the persisted adjustment time when reclaiming rows; a retry may run
            # much later than the membership activation that created the adjustment.
            effective_at = coerce_utc(adjustment.effective_at or adjustment.created_at)
            membership = (
                await db.get(OrganizationMembership, adjustment.membership_id)
                if adjustment.membership_id is not None
                else None
            )
            if (
                current_quantity > confirmed_quantity
                and membership is not None
                and membership.status == ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE
                and period_start is not None
                and effective_at is not None
                and effective_at >= period_start
                and not await _has_current_period_seat_decrease_for_membership(
                    db,
                    billing_subscription_id=subscription.id,
                    membership_id=adjustment.membership_id,
                    period_start=adjustment.period_start,
                )
            ):
                grant_quantity = min(current_quantity - confirmed_quantity, 1)

            adjustment.previous_quantity = confirmed_quantity
            adjustment.target_quantity = current_quantity
            adjustment.grant_quantity = grant_quantity
            adjustment.updated_at = now
            if current_quantity == confirmed_quantity and grant_quantity == 0:
                adjustment.status = "succeeded"
                adjustment.stripe_confirmed_at = now
                adjustment.grant_issued_at = now
                adjustment.last_error = "stale_seat_adjustment_noop"
                continue
        claimed.append(
            ClaimedSeatAdjustment(
                id=adjustment.id,
                billing_subject_id=adjustment.billing_subject_id,
                billing_subscription_id=adjustment.billing_subscription_id,
                user_id=subject.user_id,
                membership_id=adjustment.membership_id,
                stripe_subscription_id=adjustment.stripe_subscription_id,
                monthly_subscription_item_id=adjustment.monthly_subscription_item_id,
                previous_quantity=adjustment.previous_quantity,
                target_quantity=adjustment.target_quantity,
                grant_quantity=adjustment.grant_quantity,
                period_start=adjustment.period_start,
                period_end=subscription.current_period_end,
                effective_at=adjustment.effective_at or adjustment.created_at,
                source_ref=adjustment.source_ref,
            )
        )
    await db.flush()
    return claimed


async def mark_seat_adjustment_stripe_confirmed(
    db: AsyncSession,
    *,
    adjustment_id: UUID,
) -> None:
    adjustment = await db.get(BillingSeatAdjustment, adjustment_id)
    if adjustment is not None:
        now = utcnow()
        adjustment.stripe_confirmed_at = now
        adjustment.last_error = None
        adjustment.updated_at = now
        subscription = await db.get(BillingSubscription, adjustment.billing_subscription_id)
        if subscription is not None:
            subscription.seat_quantity = adjustment.target_quantity
            subscription.updated_at = now
    await db.flush()


async def mark_seat_adjustment_grant_issued(
    db: AsyncSession,
    *,
    adjustment_id: UUID,
) -> None:
    adjustment = await db.get(BillingSeatAdjustment, adjustment_id)
    if adjustment is not None:
        now = utcnow()
        adjustment.grant_issued_at = now
        adjustment.status = "succeeded"
        adjustment.last_error = None
        adjustment.updated_at = now
    await db.flush()


async def mark_seat_adjustment_failed(
    db: AsyncSession,
    *,
    adjustment_id: UUID,
    error: str,
    terminal: bool = False,
) -> None:
    adjustment = await db.get(BillingSeatAdjustment, adjustment_id)
    if adjustment is not None:
        adjustment.attempt_count = int(adjustment.attempt_count or 0) + 1
        should_terminal = terminal or (
            adjustment.attempt_count >= BILLING_SEAT_ADJUSTMENT_MAX_ATTEMPTS
        )
        adjustment.status = "failed_terminal" if should_terminal else "failed_retryable"
        adjustment.last_error = error[:4000]
        adjustment.updated_at = utcnow()
    await db.flush()


async def apply_payment_failed_hold(
    db: AsyncSession,
    *,
    billing_subject_id: UUID,
    source: str,
    source_ref: str | None,
) -> None:
    existing = (
        await db.execute(
            select(BillingHold).where(
                BillingHold.billing_subject_id == billing_subject_id,
                BillingHold.kind == BILLING_HOLD_KIND_PAYMENT_FAILED,
                BillingHold.status == BILLING_HOLD_STATUS_ACTIVE,
            )
        )
    ).scalar_one_or_none()
    now = utcnow()
    if existing is not None:
        existing.source_ref = source_ref or existing.source_ref
        existing.updated_at = now
    else:
        db.add(
            BillingHold(
                billing_subject_id=billing_subject_id,
                kind=BILLING_HOLD_KIND_PAYMENT_FAILED,
                status=BILLING_HOLD_STATUS_ACTIVE,
                source=source,
                source_ref=source_ref,
                created_at=now,
                resolved_at=None,
                updated_at=now,
            )
        )
    await db.flush()


async def clear_payment_failed_holds(
    db: AsyncSession,
    *,
    billing_subject_id: UUID,
) -> None:
    holds = list(
        (
            await db.execute(
                select(BillingHold).where(
                    BillingHold.billing_subject_id == billing_subject_id,
                    BillingHold.kind == BILLING_HOLD_KIND_PAYMENT_FAILED,
                    BillingHold.status == BILLING_HOLD_STATUS_ACTIVE,
                )
            )
        )
        .scalars()
        .all()
    )
    now = utcnow()
    for hold in holds:
        hold.status = "resolved"
        hold.resolved_at = now
        hold.updated_at = now
    await db.flush()


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


async def count_active_seats_for_billing_subject(
    db: AsyncSession,
    subject: BillingSubject,
) -> int:
    if subject.kind == BILLING_SUBJECT_KIND_ORGANIZATION and subject.organization_id is not None:
        count = await db.scalar(
            select(func.count(OrganizationMembership.id)).where(
                OrganizationMembership.organization_id == subject.organization_id,
                OrganizationMembership.status == ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            )
        )
        return max(int(count or 0), 1)
    return 1


async def count_active_seats_for_billing_subject_id(
    db: AsyncSession,
    billing_subject_id: UUID,
) -> int:
    subject = await db.get(BillingSubject, billing_subject_id)
    if subject is None:
        return 1
    return await count_active_seats_for_billing_subject(db, subject)


async def prepare_initial_org_seat_reconcile(
    db: AsyncSession,
    *,
    billing_subscription_id: UUID,
    pro_billing_enabled: bool,
    pro_monthly_price_id: str,
) -> InitialSeatReconcileAdjustment | None:
    if not pro_billing_enabled:
        return None
    subscription = await db.get(
        BillingSubscription,
        billing_subscription_id,
        with_for_update=True,
    )
    if subscription is None:
        return None
    subject = await db.get(
        BillingSubject,
        subscription.billing_subject_id,
        with_for_update=True,
    )
    if (
        subject is None
        or subject.kind != BILLING_SUBJECT_KIND_ORGANIZATION
        or subject.organization_id is None
        or subscription.status not in {"active", "trialing"}
        or subscription.monthly_subscription_item_id is None
        or subscription.current_period_start is None
        or not pro_monthly_price_id
        or subscription.cloud_monthly_price_id != pro_monthly_price_id
    ):
        return None

    target_quantity = await count_active_seats_for_billing_subject(db, subject)
    previous_quantity = (
        int(subscription.seat_quantity)
        if subscription.seat_quantity is not None
        else target_quantity
    )
    period_start_unix = int(subscription.current_period_start.timestamp())
    source_ref = (
        f"stripe:initial-reconcile:{subscription.stripe_subscription_id}:{period_start_unix}"
    )
    now = utcnow()
    existing = (
        await db.execute(
            select(BillingSeatAdjustment)
            .where(BillingSeatAdjustment.source_ref == source_ref)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if existing is not None:
        if existing.status == "succeeded":
            if target_quantity == existing.target_quantity:
                if subscription.seat_quantity != existing.target_quantity:
                    subscription.seat_quantity = existing.target_quantity
                    subscription.updated_at = now
                await db.flush()
                return None
            # Webhook retries are idempotent, but a later subscription update in the
            # same period can still reveal active-seat drift. Reuse the per-period
            # reconcile row and let the Stripe idempotency key include the new target.
            existing.status = "pending"
            existing.stripe_confirmed_at = None
            existing.grant_issued_at = None
            existing.last_error = None
            existing.previous_quantity = previous_quantity
            existing.target_quantity = target_quantity
            existing.grant_quantity = 0
            existing.attempt_count = 0
            existing.updated_at = now
            if subscription.seat_quantity != previous_quantity:
                subscription.seat_quantity = previous_quantity
                subscription.updated_at = now
            await db.flush()
            return InitialSeatReconcileAdjustment(
                id=existing.id,
                monthly_subscription_item_id=existing.monthly_subscription_item_id
                or subscription.monthly_subscription_item_id,
                target_quantity=existing.target_quantity,
            )
        if existing.stripe_confirmed_at is None:
            existing.previous_quantity = previous_quantity
            existing.target_quantity = target_quantity
            existing.grant_quantity = 0
            existing.attempt_count = 0
            existing.updated_at = now
        await db.flush()
        return InitialSeatReconcileAdjustment(
            id=existing.id,
            monthly_subscription_item_id=existing.monthly_subscription_item_id
            or subscription.monthly_subscription_item_id,
            target_quantity=existing.target_quantity,
        )

    if target_quantity == previous_quantity:
        return None

    result = await db.execute(
        pg_insert(BillingSeatAdjustment)
        .values(
            billing_subject_id=subject.id,
            billing_subscription_id=subscription.id,
            organization_id=subject.organization_id,
            membership_id=None,
            stripe_subscription_id=subscription.stripe_subscription_id,
            monthly_subscription_item_id=subscription.monthly_subscription_item_id,
            previous_quantity=previous_quantity,
            target_quantity=target_quantity,
            grant_quantity=0,
            attempt_count=0,
            period_start=subscription.current_period_start,
            effective_at=now,
            source_ref=source_ref,
            status="pending",
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_nothing(index_elements=[BillingSeatAdjustment.source_ref])
        .returning(BillingSeatAdjustment.id)
    )
    adjustment_id = result.scalar_one_or_none()
    if adjustment_id is None:
        await db.flush()
        return None
    await db.flush()
    return InitialSeatReconcileAdjustment(
        id=adjustment_id,
        monthly_subscription_item_id=subscription.monthly_subscription_item_id,
        target_quantity=target_quantity,
    )


async def load_billing_subscription_by_id(
    db: AsyncSession,
    billing_subscription_id: UUID,
) -> BillingSubscription | None:
    return await db.get(BillingSubscription, billing_subscription_id)


async def get_billing_subscription_by_stripe_subscription_id(
    db: AsyncSession,
    stripe_subscription_id: str,
) -> BillingSubscription | None:
    return (
        await db.execute(
            select(BillingSubscription).where(
                BillingSubscription.stripe_subscription_id == stripe_subscription_id
            )
        )
    ).scalar_one_or_none()


async def _has_current_period_seat_decrease_for_membership(
    db: AsyncSession,
    *,
    billing_subscription_id: UUID,
    membership_id: UUID,
    period_start: datetime,
) -> bool:
    # A same-period decrease means that seat was already covered by the period grant.
    # Re-adding it should sync Stripe quantity without issuing another prorated grant.
    return (
        await db.execute(
            select(BillingSeatAdjustment.id)
            .where(
                BillingSeatAdjustment.billing_subscription_id == billing_subscription_id,
                BillingSeatAdjustment.membership_id == membership_id,
                BillingSeatAdjustment.period_start == period_start,
                BillingSeatAdjustment.previous_quantity.is_not(None),
                BillingSeatAdjustment.previous_quantity > BillingSeatAdjustment.target_quantity,
            )
            .limit(1)
        )
    ).scalar_one_or_none() is not None


async def _build_billing_snapshot_state_for_subject(
    db: AsyncSession,
    billing_subject_id: UUID,
) -> BillingSnapshotState:
    now = utcnow()
    subject = await db.get(BillingSubject, billing_subject_id)
    if subject is None:
        raise RuntimeError("Billing subject not found.")
    recent_window_started_at = now - timedelta(days=USAGE_SEGMENT_RECENT_LOOKBACK_DAYS)
    grants = await list_grants(db, billing_subject_id)
    entitlements = await list_entitlements(db, billing_subject_id)
    subscriptions = await list_subscriptions(db, billing_subject_id)
    return BillingSnapshotState(
        subject=subject,
        billing_subject_id=billing_subject_id,
        sandboxes=await list_cloud_sandboxes_for_subject(db, billing_subject_id),
        grants=grants,
        entitlements=entitlements,
        holds=await list_active_holds(db, billing_subject_id),
        subscriptions=subscriptions,
        usage_segments=await list_usage_segments(
            db,
            billing_subject_id,
            window_started_at=recent_window_started_at,
        ),
        active_cloud_repo_count=await count_active_cloud_repo_environments(
            db,
            billing_subject_id,
        ),
        unaccounted_billable_seconds=await estimate_unaccounted_billable_seconds(
            db,
            billing_subject_id,
            now=now,
        ),
        historical_billable_seconds=await sum_billable_usage_seconds_before(
            db,
            billing_subject_id,
            window_started_at=recent_window_started_at,
        ),
        active_seat_count=await count_active_seats_for_billing_subject(db, subject),
        managed_cloud_overage_used_cents=0,
    )


async def get_billing_snapshot_state_for_subject(
    db: AsyncSession,
    billing_subject_id: UUID,
) -> BillingSnapshotState:
    return await _build_billing_snapshot_state_for_subject(db, billing_subject_id)
