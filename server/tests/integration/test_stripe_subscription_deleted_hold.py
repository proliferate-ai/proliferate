"""customer.subscription.deleted hold semantics (regression for #1032).

A clean voluntary cancellation (cancel at period end; Stripe deletes the
subscription with cancellation_details.reason=cancellation_requested) must not
apply a payment_failed hold. A deletion reached through failed-payment dunning
(explicit payment reason, or prior past_due/unpaid status with no reason) must
keep it. Shares the signed-webhook helpers with test_stripe_webhooks.py.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from proliferate.config import settings
from proliferate.db import engine as engine_module
from proliferate.db.models.auth import User
from proliferate.db.models.billing import BillingHold, BillingSubscription
from proliferate.db.store.billing_subjects import ensure_personal_billing_subject

from tests.integration.test_stripe_webhooks import (
    _handle_subscription_event,
    _subscription_payload,
)


def _payload_with_cancellation_reason(
    *,
    subject_id: str,
    customer_id: str,
    subscription_id: str,
    status: str,
    canceled_at: int | None = None,
    cancellation_reason: str | None = None,
) -> dict[str, object]:
    payload = _subscription_payload(
        subject_id=subject_id,
        customer_id=customer_id,
        subscription_id=subscription_id,
        status=status,
        canceled_at=canceled_at,
    )
    if cancellation_reason is not None:
        payload["cancellation_details"] = {"reason": cancellation_reason}
    return payload


async def _seed_subject(
    db_session: AsyncSession,
    *,
    email: str,
    github_login: str,
    stripe_customer_id: str,
) -> uuid.UUID:
    user_id = uuid.uuid4()
    db_session.add(
        User(
            id=user_id,
            email=email,
            hashed_password="unused",
            is_active=True,
            is_superuser=False,
            is_verified=True,
            display_name=github_login,
            github_login=github_login,
        )
    )
    subject = await ensure_personal_billing_subject(db_session, user_id)
    subject.stripe_customer_id = stripe_customer_id
    subject_id = subject.id
    await db_session.commit()
    return subject_id


@pytest.mark.asyncio
async def test_subscription_deleted_voluntary_cancel_does_not_apply_payment_hold(
    db_session: AsyncSession,
    test_engine,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Regression test for #1032: a clean cancel-at-period-end deletion must
    not be labeled payment_failed."""
    monkeypatch.setattr(
        engine_module,
        "async_session_factory",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )
    secret = "whsec_test_secret"
    monkeypatch.setattr(settings, "stripe_webhook_secret", secret)
    monkeypatch.setattr(settings, "stripe_cloud_monthly_price_id", "price_cloud")

    subject_id = await _seed_subject(
        db_session,
        email="voluntary-cancel@example.com",
        github_login="voluntary-cancel",
        stripe_customer_id="cus_voluntary_cancel",
    )

    await _handle_subscription_event(
        secret=secret,
        event_id="evt_voluntary_created",
        event_type="customer.subscription.created",
        subscription=_payload_with_cancellation_reason(
            subject_id=str(subject_id),
            customer_id="cus_voluntary_cancel",
            subscription_id="sub_voluntary_cancel",
            status="active",
        ),
    )
    await _handle_subscription_event(
        secret=secret,
        event_id="evt_voluntary_deleted",
        event_type="customer.subscription.deleted",
        subscription=_payload_with_cancellation_reason(
            subject_id=str(subject_id),
            customer_id="cus_voluntary_cancel",
            subscription_id="sub_voluntary_cancel",
            status="canceled",
            canceled_at=1_777_100_000,
            cancellation_reason="cancellation_requested",
        ),
    )

    db_session.expire_all()
    holds = (
        (
            await db_session.execute(
                select(BillingHold).where(BillingHold.billing_subject_id == subject_id)
            )
        )
        .scalars()
        .all()
    )
    assert holds == []

    subscription = (
        await db_session.execute(
            select(BillingSubscription).where(
                BillingSubscription.stripe_subscription_id == "sub_voluntary_cancel"
            )
        )
    ).scalar_one()
    assert subscription.status == "canceled"


@pytest.mark.asyncio
async def test_subscription_deleted_after_dunning_applies_payment_hold(
    db_session: AsyncSession,
    test_engine,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A subscription that lapsed into past_due before Stripe deleted it is
    a payment failure, not a voluntary cancel, and must keep the hold."""
    monkeypatch.setattr(
        engine_module,
        "async_session_factory",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )
    secret = "whsec_test_secret"
    monkeypatch.setattr(settings, "stripe_webhook_secret", secret)
    monkeypatch.setattr(settings, "stripe_cloud_monthly_price_id", "price_cloud")

    subject_id = await _seed_subject(
        db_session,
        email="dunning-cancel@example.com",
        github_login="dunning-cancel",
        stripe_customer_id="cus_dunning_cancel",
    )

    await _handle_subscription_event(
        secret=secret,
        event_id="evt_dunning_created",
        event_type="customer.subscription.created",
        subscription=_payload_with_cancellation_reason(
            subject_id=str(subject_id),
            customer_id="cus_dunning_cancel",
            subscription_id="sub_dunning_cancel",
            status="active",
        ),
    )
    await _handle_subscription_event(
        secret=secret,
        event_id="evt_dunning_past_due",
        event_type="customer.subscription.updated",
        subscription=_payload_with_cancellation_reason(
            subject_id=str(subject_id),
            customer_id="cus_dunning_cancel",
            subscription_id="sub_dunning_cancel",
            status="past_due",
        ),
    )
    await _handle_subscription_event(
        secret=secret,
        event_id="evt_dunning_deleted",
        event_type="customer.subscription.deleted",
        subscription=_payload_with_cancellation_reason(
            subject_id=str(subject_id),
            customer_id="cus_dunning_cancel",
            subscription_id="sub_dunning_cancel",
            status="canceled",
            canceled_at=1_777_200_000,
        ),
    )

    db_session.expire_all()
    hold = (
        await db_session.execute(
            select(BillingHold).where(BillingHold.billing_subject_id == subject_id)
        )
    ).scalar_one()
    assert hold.kind == "payment_failed"
    assert hold.status == "active"
    assert hold.source_ref == "sub_dunning_cancel"
