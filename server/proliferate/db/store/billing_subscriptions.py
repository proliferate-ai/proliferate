"""Billing subscription and payment hold persistence helpers."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.billing import (
    BILLING_HOLD_KIND_PAYMENT_FAILED,
    BILLING_HOLD_STATUS_ACTIVE,
    BILLING_SUBJECT_KIND_PERSONAL,
)
from proliferate.db.models.billing import BillingHold, BillingSubject, BillingSubscription
from proliferate.lib.infra.time.wall_clock import utcnow

# Mirrors ``HEALTHY_STRIPE_SUBSCRIPTION_STATUSES`` in
# ``proliferate.server.billing.domain.plans``, inlined because no other store
# module imports from the server layer and this one should not be the first.
_HEALTHY_SUBSCRIPTION_STATUSES: frozenset[str] = frozenset({"active", "trialing"})


def coerce_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


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


async def user_has_healthy_personal_subscription(db: AsyncSession, user_id: UUID) -> bool:
    """Does this user's PERSONAL subject carry a live subscription?

    Read-only, and deliberately does not create the subject: this answers "is
    personal still the payer here?" for the owner-context redirect (W-F1), and
    minting a subject to answer it would defeat the point.

    Org-everywhere routes billing reads to the paying org, but subscriptions are
    still sold personally (org subscriptions need PRO, which is off at launch).
    Without this check a customer who is genuinely paying reads back
    ``plan: free`` / ``isPaidCloud: false`` from their org subject, losing the
    unlimited hours and raised concurrency they bought — a worse failure than the
    stranded balance the redirect exists to fix.
    """
    subject_id = (
        await db.execute(
            select(BillingSubject.id).where(
                BillingSubject.kind == BILLING_SUBJECT_KIND_PERSONAL,
                BillingSubject.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if subject_id is None:
        return False
    return bool(
        await db.scalar(
            select(BillingSubscription.id)
            .where(
                BillingSubscription.billing_subject_id == subject_id,
                BillingSubscription.status.in_(_HEALTHY_SUBSCRIPTION_STATUSES),
            )
            .limit(1)
        )
    )


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
