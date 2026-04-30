from __future__ import annotations

import hashlib
import hmac
import json
import time
import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from proliferate.config import settings
from proliferate.db import engine as engine_module
from proliferate.db.models.billing import BillingGrant, BillingSubscription
from proliferate.db.store.billing import ensure_personal_billing_subject
from proliferate.server.billing import stripe_webhooks


def _stripe_signature(payload: bytes, *, secret: str, timestamp: int | None = None) -> str:
    timestamp = int(time.time()) if timestamp is None else timestamp
    signed_payload = str(timestamp).encode("ascii") + b"." + payload
    digest = hmac.new(secret.encode("utf-8"), signed_payload, hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={digest}"


@pytest.mark.asyncio
async def test_stripe_webhook_accepts_signed_event(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    secret = "whsec_test_secret"
    monkeypatch.setattr(settings, "stripe_webhook_secret", secret)
    payload = json.dumps(
        {
            "id": "evt_test_checkout",
            "livemode": False,
            "type": "checkout.session.completed",
        },
        separators=(",", ":"),
    ).encode("utf-8")

    response = await client.post(
        "/v1/billing/webhooks/stripe",
        content=payload,
        headers={"Stripe-Signature": _stripe_signature(payload, secret=secret)},
    )

    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "eventId": "evt_test_checkout",
        "eventType": "checkout.session.completed",
        "livemode": False,
    }


@pytest.mark.asyncio
async def test_stripe_webhook_rejects_bad_signature(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_test_secret")
    payload = b'{"id":"evt_bad","type":"invoice.payment_failed"}'

    response = await client.post(
        "/v1/billing/webhooks/stripe",
        content=payload,
        headers={"Stripe-Signature": f"t={int(time.time())},v1=bad"},
    )

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "stripe_webhook_invalid_signature"


@pytest.mark.asyncio
async def test_stripe_webhook_requires_configuration(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "stripe_webhook_secret", "")

    response = await client.post(
        "/v1/billing/webhooks/stripe",
        content=b'{"id":"evt_missing_config","type":"invoice.paid"}',
        headers={"Stripe-Signature": "t=1800000000,v1=bad"},
    )

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "stripe_webhook_unconfigured"


@pytest.mark.asyncio
async def test_invoice_paid_uses_current_stripe_line_and_item_period_shapes(
    db_session: AsyncSession,
    test_engine,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        engine_module,
        "async_session_factory",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )
    monkeypatch.setattr(settings, "stripe_cloud_monthly_price_id", "price_cloud")

    user_id = uuid.uuid4()
    subject = await ensure_personal_billing_subject(db_session, user_id)
    subject.stripe_customer_id = "cus_cloud"
    await db_session.commit()

    async def _retrieve_subscription(subscription_id: str) -> dict[str, object]:
        assert subscription_id == "sub_cloud"
        return {
            "id": "sub_cloud",
            "customer": "cus_cloud",
            "status": "active",
            "cancel_at_period_end": False,
            "canceled_at": None,
            "current_period_start": None,
            "current_period_end": None,
            "latest_invoice": "in_cloud",
            "metadata": {
                "billing_subject_id": str(subject.id),
                "purpose": "cloud_subscription",
            },
            "items": {
                "data": [
                    {
                        "id": "si_monthly",
                        "price": {"id": "price_cloud"},
                        "current_period_start": 1_776_586_422,
                        "current_period_end": 1_779_178_422,
                    },
                ]
            },
        }

    monkeypatch.setattr(
        stripe_webhooks.stripe_billing,
        "retrieve_subscription",
        _retrieve_subscription,
    )

    await stripe_webhooks._handle_invoice_paid(
        {
            "id": "in_cloud",
            "customer": "cus_cloud",
            "subscription": None,
            "parent": {
                "subscription_details": {
                    "subscription": "sub_cloud",
                    "metadata": {
                        "billing_subject_id": str(subject.id),
                        "purpose": "cloud_subscription",
                    },
                },
                "type": "subscription_details",
            },
            "period_start": 1_776_586_422,
            "period_end": 1_776_586_422,
            "lines": {
                "data": [
                    {
                        "id": "il_cloud",
                        "pricing": {
                            "price_details": {
                                "price": "price_cloud",
                                "product": "prod_cloud",
                            },
                            "type": "price_details",
                        },
                        "period": {
                            "start": 1_776_586_422,
                            "end": 1_779_178_422,
                        },
                        "parent": {
                            "subscription_item_details": {
                                "subscription": "sub_cloud",
                                "subscription_item": "si_monthly",
                            },
                            "type": "subscription_item_details",
                        },
                    }
                ]
            },
        }
    )

    grants = list(
        (
            await db_session.execute(
                select(BillingGrant).where(BillingGrant.billing_subject_id == subject.id)
            )
        )
        .scalars()
        .all()
    )
    assert grants == []

    subscription = (
        await db_session.execute(
            select(BillingSubscription).where(
                BillingSubscription.billing_subject_id == subject.id,
                BillingSubscription.stripe_subscription_id == "sub_cloud",
            )
        )
    ).scalar_one()
    assert subscription.current_period_start == datetime.fromtimestamp(1_776_586_422, tz=UTC)
    assert subscription.current_period_end == datetime.fromtimestamp(1_779_178_422, tz=UTC)
    assert subscription.cloud_monthly_price_id == "price_cloud"
    assert subscription.overage_price_id is None
    assert subscription.monthly_subscription_item_id == "si_monthly"
    assert subscription.metered_subscription_item_id is None
