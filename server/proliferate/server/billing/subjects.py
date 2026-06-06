"""Billing subject state orchestration."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.billing_subjects import (
    BillingSubjectStripeState,
    get_or_create_organization_stripe_customer_state,
    get_or_create_user_stripe_customer_state,
)


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
