"""Billing seat adjustment persistence helpers."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.billing import (
    BILLING_SEAT_ADJUSTMENT_MAX_ATTEMPTS,
    BILLING_SUBJECT_KIND_ORGANIZATION,
)
from proliferate.constants.organizations import ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE
from proliferate.db.models.billing import (
    BillingSeatAdjustment,
    BillingSubject,
    BillingSubscription,
)
from proliferate.db.models.organizations import OrganizationMembership
from proliferate.utils.time import utcnow


def coerce_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


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
