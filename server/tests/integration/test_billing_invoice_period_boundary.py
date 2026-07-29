"""Only a period boundary mints the period's seat allowance (W-F2).

``_handle_invoice_paid`` issues ``pro_period`` hours sized at the FULL seat-month
(``seats x hours_per_seat``) under a ``source_ref`` keyed on the subscription's
``current_period_start``. Stripe sends ``invoice.paid`` for more than renewals,
though: a mid-period seat change produces its own paid invoice, carrying a cloud
subscription line, with the SAME ``current_period_start``. So that invoice hit
the same ``source_ref``, and because the handler passes
``top_up_existing=True``, the higher seat count re-topped the grant by a full
month's hours per added seat.

Those seats already have an allowance. The seat-adjustment pass issues a
correctly *prorated* grant for them under ``pro_seat_proration`` — only the
remaining fraction of the period. So the invoice top-up is a second allocation
for hours already granted, and it is the *unprorated* one: adding a seat one day
before renewal granted a whole extra seat-month of compute.

These tests pin both directions:

* a renewal (``subscription_cycle``) and a first invoice
  (``subscription_create``) still mint the allowance, and
* every other ``billing_reason`` — the proration case is
  ``subscription_update`` — mints nothing, while still clearing a
  payment-failed hold, because dunning recovery settles on whatever invoice
  finally pays.

Prod runs ``PRO_BILLING_ENABLED=true``, so this path is live rather than
hypothetical; the only reason no customer has been over-granted yet is that no
live subscription has had a seat added mid-period.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from proliferate.config import settings
from proliferate.constants.billing import (
    BILLING_HOLD_KIND_PAYMENT_FAILED,
    BILLING_HOLD_STATUS_ACTIVE,
    PRO_PERIOD_GRANT_TYPE,
)
from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_ROLE_MEMBER,
    ORGANIZATION_ROLE_OWNER,
)
from proliferate.db import engine as engine_module
from proliferate.db.models.auth import User
from proliferate.db.models.billing import BillingGrant, BillingHold
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.store.billing_subjects import ensure_organization_billing_subject
from proliferate.server.billing import stripe_webhooks

PERIOD_START = 1_776_586_422
PERIOD_END = 1_779_178_422
HOURS_PER_SEAT = 5.0  # $15/seat at the ruled $3/hr compute price


@pytest.fixture(autouse=True)
def _pro_pricing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "pro_billing_enabled", True)
    monkeypatch.setattr(settings, "stripe_pro_monthly_price_id", "price_pro")
    monkeypatch.setattr(settings, "stripe_cloud_monthly_price_id", "")
    monkeypatch.setattr(settings, "stripe_legacy_cloud_monthly_price_id", "")
    monkeypatch.setattr(settings, "stripe_managed_cloud_overage_price_id", "price_overage")
    # The LLM seat pool is a separate allocation with its own assertions; keeping
    # it off holds this file to the compute-hours question.
    monkeypatch.setattr(settings, "agent_gateway_enabled", False)


async def _add_member(
    db_session: AsyncSession,
    organization_id: uuid.UUID,
    *,
    owner: bool = False,
) -> None:
    user_id = uuid.uuid4()
    db_session.add(
        User(
            id=user_id,
            email=f"boundary-{user_id}@example.com",
            hashed_password="unused",
            is_active=True,
            is_superuser=False,
            is_verified=True,
        )
    )
    db_session.add(
        OrganizationMembership(
            organization_id=organization_id,
            user_id=user_id,
            role=ORGANIZATION_ROLE_OWNER if owner else ORGANIZATION_ROLE_MEMBER,
            status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            joined_at=datetime.now(UTC),
        )
    )
    await db_session.commit()


async def _seed_org_subject(
    db_session: AsyncSession, *, seats: int
) -> tuple[uuid.UUID, uuid.UUID]:
    """An org with ``seats`` active members and a Pro subscription subject."""
    organization = Organization(name=f"boundary-{uuid.uuid4().hex[:8]}")
    db_session.add(organization)
    await db_session.flush()
    organization_id = organization.id
    subject = await ensure_organization_billing_subject(db_session, organization_id)
    subject.stripe_customer_id = "cus_boundary"
    subject_id = subject.id
    await db_session.commit()
    for index in range(seats):
        await _add_member(db_session, organization_id, owner=index == 0)
    return organization_id, subject_id


def _invoice(*, subject_id: uuid.UUID, billing_reason: str) -> dict[str, Any]:
    return {
        "id": f"in_boundary_{billing_reason}",
        "customer": "cus_boundary",
        "status": "paid",
        "paid": True,
        "billing_reason": billing_reason,
        "subscription": "sub_boundary",
        "metadata": {"billing_subject_id": str(subject_id)},
        "lines": {"data": [{"id": "il_boundary", "price": {"id": "price_pro"}}]},
    }


def _patch_stripe(
    monkeypatch: pytest.MonkeyPatch,
    *,
    subject_id: uuid.UUID,
    seats: int,
) -> None:
    async def _retrieve_subscription(subscription_id: str) -> dict[str, Any]:
        assert subscription_id == "sub_boundary"
        return {
            "id": "sub_boundary",
            "customer": "cus_boundary",
            "status": "active",
            "cancel_at_period_end": False,
            "canceled_at": None,
            "latest_invoice": "in_boundary",
            # The same period on every invoice — that is exactly why a proration
            # invoice collided with the renewal's period-keyed source_ref.
            "current_period_start": PERIOD_START,
            "current_period_end": PERIOD_END,
            "metadata": {"billing_subject_id": str(subject_id)},
            "items": {
                "data": [
                    {"id": "si_monthly", "quantity": seats, "price": {"id": "price_pro"}},
                    {"id": "si_overage", "price": {"id": "price_overage"}},
                ]
            },
        }

    async def _update_quantity(**_kwargs: object) -> None:
        return None

    monkeypatch.setattr(
        stripe_webhooks.stripe_billing, "retrieve_subscription", _retrieve_subscription
    )
    monkeypatch.setattr(
        stripe_webhooks.stripe_billing, "update_subscription_item_quantity", _update_quantity
    )


async def _period_grants(db_session: AsyncSession, subject_id: uuid.UUID) -> list[BillingGrant]:
    db_session.expire_all()
    return list(
        (
            await db_session.execute(
                select(BillingGrant).where(
                    BillingGrant.billing_subject_id == subject_id,
                    BillingGrant.grant_type == PRO_PERIOD_GRANT_TYPE,
                )
            )
        )
        .scalars()
        .all()
    )


@pytest.mark.asyncio
async def test_mid_period_seat_proration_does_not_re_grant_the_period(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A seat added mid-period must not mint a second full seat-month.

    The renewal grants 2 seats x 5 h. A third seat is then added mid-period:
    Stripe charges a prorated amount and sends ``invoice.paid`` with
    ``billing_reason: subscription_update``. Before the fix that invoice
    re-topped the same period grant to 3 x 5 h — a whole extra seat-month for a
    seat that the seat-adjustment pass already covers pro rata.
    """
    monkeypatch.setattr(
        engine_module,
        "async_session_factory",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )
    organization_id, subject_id = await _seed_org_subject(db_session, seats=2)
    _patch_stripe(monkeypatch, subject_id=subject_id, seats=2)

    await stripe_webhooks._handle_invoice_paid(
        _invoice(subject_id=subject_id, billing_reason="subscription_cycle")
    )
    grants = await _period_grants(db_session, subject_id)
    assert len(grants) == 1
    assert grants[0].hours_granted == pytest.approx(2 * HOURS_PER_SEAT)
    granted_at_renewal = grants[0].hours_granted

    # A third member joins mid-period. Seat reconciliation raises the billed
    # quantity from the ACTIVE MEMBER COUNT (not from the Stripe payload), which
    # is what makes ``pro_period_grant_hours`` compute a larger allowance and so
    # what made the proration invoice top the existing period grant up.
    await _add_member(db_session, organization_id)
    await stripe_webhooks._handle_invoice_paid(
        _invoice(subject_id=subject_id, billing_reason="subscription_update")
    )

    grants = await _period_grants(db_session, subject_id)
    assert len(grants) == 1, "a proration invoice must not create a second period grant"
    assert grants[0].hours_granted == pytest.approx(granted_at_renewal), (
        "a mid-period proration re-granted a full seat-month of compute — those "
        "seats are already covered pro rata by the seat-adjustment pass"
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("billing_reason", ["subscription_create", "subscription_cycle"])
async def test_period_boundaries_still_mint_the_allowance(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
    billing_reason: str,
) -> None:
    """The two boundary reasons still grant, so the gate cannot starve customers.

    Kept alongside the proration case: a fix that blocked the double grant by
    blocking all grants would pass that test alone while leaving every paying
    org with zero hours.
    """
    monkeypatch.setattr(
        engine_module,
        "async_session_factory",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )
    _organization_id, subject_id = await _seed_org_subject(db_session, seats=2)
    _patch_stripe(monkeypatch, subject_id=subject_id, seats=2)

    await stripe_webhooks._handle_invoice_paid(
        _invoice(subject_id=subject_id, billing_reason=billing_reason)
    )

    grants = await _period_grants(db_session, subject_id)
    assert len(grants) == 1
    assert grants[0].hours_granted == pytest.approx(2 * HOURS_PER_SEAT)


@pytest.mark.asyncio
async def test_non_boundary_invoice_still_clears_a_payment_failed_hold(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Dunning recovery must not be a casualty of the boundary gate.

    A past-due customer is paused by a ``payment_failed`` hold. When their retry
    finally settles, the invoice that settles it may not be a period boundary —
    so returning early on a non-boundary invoice without clearing the hold would
    leave a paid-up customer locked out until their next renewal.
    """
    monkeypatch.setattr(
        engine_module,
        "async_session_factory",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )
    _organization_id, subject_id = await _seed_org_subject(db_session, seats=2)
    _patch_stripe(monkeypatch, subject_id=subject_id, seats=2)
    db_session.add(
        BillingHold(
            billing_subject_id=subject_id,
            kind=BILLING_HOLD_KIND_PAYMENT_FAILED,
            status=BILLING_HOLD_STATUS_ACTIVE,
            source="test",
            created_at=datetime.now(UTC) - timedelta(hours=1),
        )
    )
    await db_session.commit()

    await stripe_webhooks._handle_invoice_paid(
        _invoice(subject_id=subject_id, billing_reason="subscription_update")
    )

    db_session.expire_all()
    holds = list(
        (
            await db_session.execute(
                select(BillingHold).where(
                    BillingHold.billing_subject_id == subject_id,
                    BillingHold.kind == BILLING_HOLD_KIND_PAYMENT_FAILED,
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(holds) == 1
    assert holds[0].status != BILLING_HOLD_STATUS_ACTIVE, (
        "a settled retry must lift the payment-failed hold even when its invoice "
        "is not a period boundary"
    )
    assert await _period_grants(db_session, subject_id) == [], (
        "clearing the hold must not also mint the period allowance"
    )
