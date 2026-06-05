"""Billing seat adjustment and initial reconciliation orchestration."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db import session_ops as db_session
from proliferate.db.models.billing import BillingSubscription
from proliferate.db.store import billing_seats, billing_subscriptions
from proliferate.integrations import stripe as stripe_billing
from proliferate.server.billing.domain.accounting import stripe_status_is_terminal
from proliferate.server.billing.pricing import configured_pro_monthly_price_id


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
        return await _reload_subscription_or_record(record)
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
    return await _reload_subscription_or_record(record)


async def _reload_subscription_or_record(record: BillingSubscription) -> BillingSubscription:
    async with db_session.open_async_session() as db:
        reloaded = await billing_subscriptions.load_billing_subscription_by_id(db, record.id)
    return reloaded or record
