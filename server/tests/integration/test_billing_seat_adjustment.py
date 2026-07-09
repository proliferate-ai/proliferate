"""Regression coverage for maybe_create_org_seat_adjustment (issue #1044).

A billing subject can end up with more than one active/trialing
BillingSubscription row (double checkout, re-subscribing while the old sub
is still cancelling, a support-created sub). Before the fix, the
subscription lookup in billing_seats.maybe_create_org_seat_adjustment had no
.limit(1), so a second active row made scalar_one_or_none() raise
MultipleResultsFound -- and every membership change on that org (invite,
remove, role change, SSO resolution) 500'd until the extra row was cleaned
up by hand.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_ROLE_MEMBER,
    ORGANIZATION_ROLE_OWNER,
    ORGANIZATION_STATUS_ACTIVE,
)
from proliferate.db.models.auth import User
from proliferate.db.models.billing import BillingSeatAdjustment, BillingSubscription
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.store import billing_seats
from proliferate.db.store.billing_subjects import ensure_organization_billing_subject

PRO_PRICE_ID = "price_pro_test"


async def _make_user(db: AsyncSession, *, email: str) -> User:
    user = User(
        email=email,
        hashed_password="unused",
        is_active=True,
        is_superuser=False,
        is_verified=True,
        display_name=email,
    )
    db.add(user)
    await db.flush()
    return user


async def _make_org_with_two_active_members(
    db: AsyncSession,
) -> tuple[Organization, OrganizationMembership]:
    now = datetime.now(UTC)
    organization = Organization(
        name="Multisub Test Org",
        status=ORGANIZATION_STATUS_ACTIVE,
        created_at=now,
        updated_at=now,
    )
    db.add(organization)
    await db.flush()

    owner = await _make_user(db, email=f"owner-{uuid.uuid4()}@example.com")
    member = await _make_user(db, email=f"member-{uuid.uuid4()}@example.com")

    db.add(
        OrganizationMembership(
            organization_id=organization.id,
            user_id=owner.id,
            role=ORGANIZATION_ROLE_OWNER,
            status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            joined_at=now,
        )
    )
    membership = OrganizationMembership(
        organization_id=organization.id,
        user_id=member.id,
        role=ORGANIZATION_ROLE_MEMBER,
        status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
        joined_at=now,
    )
    db.add(membership)
    await db.flush()
    return organization, membership


def _active_subscription(
    *,
    billing_subject_id: uuid.UUID,
    stripe_subscription_id: str,
    monthly_subscription_item_id: str,
    seat_quantity: int,
    current_period_start: datetime,
    current_period_end: datetime,
    updated_at: datetime,
) -> BillingSubscription:
    return BillingSubscription(
        billing_subject_id=billing_subject_id,
        stripe_subscription_id=stripe_subscription_id,
        stripe_customer_id=f"cus_{stripe_subscription_id}",
        status="active",
        cancel_at_period_end=False,
        canceled_at=None,
        current_period_start=current_period_start,
        current_period_end=current_period_end,
        cloud_monthly_price_id=PRO_PRICE_ID,
        overage_price_id=None,
        seat_quantity=seat_quantity,
        monthly_subscription_item_id=monthly_subscription_item_id,
        metered_subscription_item_id=None,
        latest_invoice_id=None,
        latest_invoice_status=None,
        hosted_invoice_url=None,
        updated_at=updated_at,
    )


@pytest.mark.asyncio
async def test_two_active_subscriptions_do_not_raise_and_pick_the_newest(
    db_session: AsyncSession,
) -> None:
    organization, membership = await _make_org_with_two_active_members(db_session)
    subject = await ensure_organization_billing_subject(db_session, organization.id)

    now = datetime.now(UTC)
    # Older active row: earlier period end, stale seat_quantity. If this one
    # got picked by mistake, the created adjustment would carry its
    # seat_quantity (99) and stripe ids instead of the newer sub's.
    old_sub = _active_subscription(
        billing_subject_id=subject.id,
        stripe_subscription_id="sub_old_multisub",
        monthly_subscription_item_id="si_old",
        seat_quantity=99,
        current_period_start=now - timedelta(days=10),
        current_period_end=now + timedelta(days=5),
        updated_at=now - timedelta(days=10),
    )
    new_sub = _active_subscription(
        billing_subject_id=subject.id,
        stripe_subscription_id="sub_new_multisub",
        monthly_subscription_item_id="si_new",
        seat_quantity=1,
        current_period_start=now - timedelta(days=2),
        current_period_end=now + timedelta(days=28),
        updated_at=now,
    )
    db_session.add_all([old_sub, new_sub])
    await db_session.flush()

    created = await billing_seats.maybe_create_org_seat_adjustment(
        db_session,
        organization_id=organization.id,
        membership_id=membership.id,
        pro_billing_enabled=True,
        pro_monthly_price_id=PRO_PRICE_ID,
    )

    assert created is True

    adjustment = (
        await db_session.execute(
            select(BillingSeatAdjustment).where(
                BillingSeatAdjustment.billing_subject_id == subject.id
            )
        )
    ).scalar_one()
    # Newest subscription by (current_period_end desc, updated_at desc) won,
    # matching the ordering latest_healthy_cloud_subscription() uses.
    assert adjustment.billing_subscription_id == new_sub.id
    assert adjustment.stripe_subscription_id == "sub_new_multisub"
    assert adjustment.previous_quantity == 1
    assert adjustment.target_quantity == 2
    assert adjustment.grant_quantity == 1


@pytest.mark.asyncio
async def test_single_active_subscription_behavior_is_unchanged(
    db_session: AsyncSession,
) -> None:
    organization, membership = await _make_org_with_two_active_members(db_session)
    subject = await ensure_organization_billing_subject(db_session, organization.id)

    now = datetime.now(UTC)
    sub = _active_subscription(
        billing_subject_id=subject.id,
        stripe_subscription_id="sub_only",
        monthly_subscription_item_id="si_only",
        seat_quantity=1,
        current_period_start=now - timedelta(days=2),
        current_period_end=now + timedelta(days=28),
        updated_at=now,
    )
    db_session.add(sub)
    await db_session.flush()

    created = await billing_seats.maybe_create_org_seat_adjustment(
        db_session,
        organization_id=organization.id,
        membership_id=membership.id,
        pro_billing_enabled=True,
        pro_monthly_price_id=PRO_PRICE_ID,
    )

    assert created is True

    adjustment = (
        await db_session.execute(
            select(BillingSeatAdjustment).where(
                BillingSeatAdjustment.billing_subject_id == subject.id
            )
        )
    ).scalar_one()
    assert adjustment.billing_subscription_id == sub.id
    assert adjustment.previous_quantity == 1
    assert adjustment.target_quantity == 2
    assert adjustment.grant_quantity == 1
