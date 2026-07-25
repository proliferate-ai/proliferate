from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.billing import PRO_PERIOD_GRANT_TYPE
from proliferate.db.models.auth import User
from proliferate.db.models.billing import BillingGrant, BillingSubscription
from proliferate.db.store.billing_subjects import ensure_personal_billing_subject
from proliferate.server.billing.reconciler import reconcile_current_pro_period_grants


def _user(user_id: uuid.UUID, email: str) -> User:
    return User(
        id=user_id,
        email=email,
        hashed_password="unused",
        is_active=True,
        is_superuser=False,
        is_verified=True,
        display_name="Billing Reconcile",
        github_login=None,
    )


@pytest.mark.asyncio
async def test_reconcile_repairs_missing_current_pro_grant_idempotently(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "pro_billing_enabled", True)
    monkeypatch.setattr(settings, "stripe_pro_monthly_price_id", "price_pro")
    monkeypatch.setattr(settings, "stripe_legacy_cloud_monthly_price_id", "")
    now = datetime.now(UTC)
    user_id = uuid.uuid4()
    db_session.add(_user(user_id, "missing-pro-grant@example.com"))
    subject = await ensure_personal_billing_subject(db_session, user_id)
    subscription = BillingSubscription(
        billing_subject_id=subject.id,
        stripe_subscription_id="sub_missing_pro_grant",
        stripe_customer_id="cus_missing_pro_grant",
        status="active",
        cancel_at_period_end=False,
        current_period_start=now - timedelta(days=1),
        current_period_end=now + timedelta(days=29),
        cloud_monthly_price_id="price_pro",
        overage_price_id="price_overage",
        seat_quantity=2,
        monthly_subscription_item_id="si_missing_pro_grant",
        metered_subscription_item_id="si_missing_pro_overage",
    )
    db_session.add(subscription)
    await db_session.flush()

    assert await reconcile_current_pro_period_grants(db_session) == 1
    assert await reconcile_current_pro_period_grants(db_session) == 1

    grants = list(
        (
            await db_session.execute(
                select(BillingGrant).where(
                    BillingGrant.billing_subject_id == subject.id,
                    BillingGrant.grant_type == PRO_PERIOD_GRANT_TYPE,
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(grants) == 1
    assert grants[0].hours_granted == 40.0
    assert grants[0].remaining_seconds == 40.0 * 3600.0
    assert grants[0].expires_at == subscription.current_period_end
    assert grants[0].source_ref == (
        "stripe:pro-period:sub_missing_pro_grant:"
        f"{int(subscription.current_period_start.timestamp())}"
    )

    subscription.seat_quantity = 3
    await db_session.flush()
    assert await reconcile_current_pro_period_grants(db_session) == 1
    await db_session.flush()
    await db_session.refresh(grants[0])
    assert grants[0].hours_granted == 60.0
    assert grants[0].remaining_seconds == 60.0 * 3600.0


@pytest.mark.asyncio
async def test_reconcile_skips_unsafe_or_non_pro_subscription_rows(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "pro_billing_enabled", True)
    monkeypatch.setattr(settings, "stripe_pro_monthly_price_id", "price_pro")
    monkeypatch.setattr(settings, "stripe_legacy_cloud_monthly_price_id", "")
    now = datetime.now(UTC)
    cases = (
        ("legacy", "active", "price_legacy", now - timedelta(days=1), now + timedelta(days=1)),
        ("expired", "active", "price_pro", now - timedelta(days=31), now - timedelta(days=1)),
        ("past_due", "past_due", "price_pro", now - timedelta(days=1), now + timedelta(days=1)),
        ("future", "active", "price_pro", now + timedelta(days=1), now + timedelta(days=31)),
        ("unknown_end", "active", "price_pro", now - timedelta(days=1), None),
    )
    for suffix, status, price_id, period_start, period_end in cases:
        user_id = uuid.uuid4()
        db_session.add(_user(user_id, f"{suffix}@example.com"))
        subject = await ensure_personal_billing_subject(db_session, user_id)
        db_session.add(
            BillingSubscription(
                billing_subject_id=subject.id,
                stripe_subscription_id=f"sub_{suffix}",
                stripe_customer_id=f"cus_{suffix}",
                status=status,
                cancel_at_period_end=False,
                current_period_start=period_start,
                current_period_end=period_end,
                cloud_monthly_price_id=price_id,
                overage_price_id=None,
                seat_quantity=1,
                monthly_subscription_item_id=f"si_{suffix}",
                metered_subscription_item_id=None,
            )
        )
    await db_session.flush()

    assert await reconcile_current_pro_period_grants(db_session) == 0
    grants = list((await db_session.execute(select(BillingGrant))).scalars().all())
    assert grants == []


@pytest.mark.asyncio
async def test_reconcile_is_disabled_with_pro_billing_flag(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "pro_billing_enabled", False)
    assert await reconcile_current_pro_period_grants(db_session) == 0


@pytest.mark.asyncio
async def test_reconcile_skips_price_configured_as_both_pro_and_legacy(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "pro_billing_enabled", True)
    monkeypatch.setattr(settings, "stripe_pro_monthly_price_id", "price_ambiguous")
    monkeypatch.setattr(
        settings,
        "stripe_legacy_cloud_monthly_price_id",
        "price_ambiguous",
    )
    now = datetime.now(UTC)
    user_id = uuid.uuid4()
    db_session.add(_user(user_id, "ambiguous-price@example.com"))
    subject = await ensure_personal_billing_subject(db_session, user_id)
    db_session.add(
        BillingSubscription(
            billing_subject_id=subject.id,
            stripe_subscription_id="sub_ambiguous_price",
            stripe_customer_id="cus_ambiguous_price",
            status="active",
            cancel_at_period_end=False,
            current_period_start=now - timedelta(days=1),
            current_period_end=now + timedelta(days=29),
            cloud_monthly_price_id="price_ambiguous",
            overage_price_id=None,
            seat_quantity=1,
            monthly_subscription_item_id="si_ambiguous_price",
            metered_subscription_item_id=None,
        )
    )
    await db_session.flush()

    assert await reconcile_current_pro_period_grants(db_session) == 0
    assert list((await db_session.execute(select(BillingGrant))).scalars().all()) == []
