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
from proliferate.constants.billing import PRO_PERIOD_GRANT_TYPE
from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_ROLE_MEMBER,
    ORGANIZATION_ROLE_OWNER,
)
from proliferate.db import engine as engine_module
from proliferate.db.models.auth import User
from proliferate.db.models.billing import BillingGrant, BillingSeatAdjustment, BillingSubscription
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.store.billing import (
    ensure_organization_billing_subject,
    ensure_personal_billing_subject,
)
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
    monkeypatch.setattr(settings, "pro_billing_enabled", False)
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


@pytest.mark.asyncio
async def test_subscription_sync_recognizes_explicit_legacy_cloud_price_in_pro_mode(
    db_session: AsyncSession,
    test_engine,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        engine_module,
        "async_session_factory",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )
    monkeypatch.setattr(settings, "pro_billing_enabled", True)
    monkeypatch.setattr(settings, "stripe_pro_monthly_price_id", "price_pro")
    monkeypatch.setattr(settings, "stripe_cloud_monthly_price_id", "")
    monkeypatch.setattr(settings, "stripe_legacy_cloud_monthly_price_id", "price_legacy")
    monkeypatch.setattr(settings, "stripe_managed_cloud_overage_price_id", "price_overage")

    user_id = uuid.uuid4()
    subject = await ensure_personal_billing_subject(db_session, user_id)
    subject.stripe_customer_id = "cus_legacy_cloud"
    await db_session.commit()

    await stripe_webhooks._sync_subscription(
        {
            "id": "sub_legacy_cloud",
            "customer": "cus_legacy_cloud",
            "status": "active",
            "cancel_at_period_end": False,
            "canceled_at": None,
            "latest_invoice": "in_legacy_cloud",
            "metadata": {
                "billing_subject_id": str(subject.id),
                "purpose": "cloud_subscription",
            },
            "items": {
                "data": [
                    {
                        "id": "si_legacy_monthly",
                        "quantity": 1,
                        "price": {"id": "price_legacy"},
                        "current_period_start": 1_776_586_422,
                        "current_period_end": 1_779_178_422,
                    }
                ]
            },
        }
    )

    subscription = (
        await db_session.execute(
            select(BillingSubscription).where(
                BillingSubscription.billing_subject_id == subject.id,
                BillingSubscription.stripe_subscription_id == "sub_legacy_cloud",
            )
        )
    ).scalar_one()
    await db_session.refresh(subject)
    assert subscription.cloud_monthly_price_id == "price_legacy"
    assert subscription.monthly_subscription_item_id == "si_legacy_monthly"
    assert subscription.seat_quantity == 1
    assert subject.overage_enabled is False
    assert subject.overage_preference_set_at is None


@pytest.mark.asyncio
async def test_org_pro_subscription_sync_reconciles_active_seats_before_period_grant(
    db_session: AsyncSession,
    test_engine,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        engine_module,
        "async_session_factory",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )
    monkeypatch.setattr(settings, "pro_billing_enabled", True)
    monkeypatch.setattr(settings, "stripe_pro_monthly_price_id", "price_pro")
    monkeypatch.setattr(settings, "stripe_cloud_monthly_price_id", "")
    monkeypatch.setattr(settings, "stripe_legacy_cloud_monthly_price_id", "")
    monkeypatch.setattr(settings, "stripe_managed_cloud_overage_price_id", "price_overage")

    owner_id = uuid.uuid4()
    member_id = uuid.uuid4()
    later_member_id = uuid.uuid4()
    db_session.add_all(
        [
            User(
                id=owner_id,
                email="org-sync-owner@example.com",
                hashed_password="unused",
                is_active=True,
                is_superuser=False,
                is_verified=True,
            ),
            User(
                id=member_id,
                email="org-sync-member@example.com",
                hashed_password="unused",
                is_active=True,
                is_superuser=False,
                is_verified=True,
            ),
            User(
                id=later_member_id,
                email="org-sync-later-member@example.com",
                hashed_password="unused",
                is_active=True,
                is_superuser=False,
                is_verified=True,
            ),
        ]
    )
    organization = Organization(name="Webhook Org Sync")
    db_session.add(organization)
    await db_session.flush()
    db_session.add_all(
        [
            OrganizationMembership(
                organization_id=organization.id,
                user_id=owner_id,
                role=ORGANIZATION_ROLE_OWNER,
                status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
                joined_at=datetime.now(UTC),
            ),
            OrganizationMembership(
                organization_id=organization.id,
                user_id=member_id,
                role=ORGANIZATION_ROLE_MEMBER,
                status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
                joined_at=datetime.now(UTC),
            ),
        ]
    )
    subject = await ensure_organization_billing_subject(db_session, organization.id)
    subject.stripe_customer_id = "cus_org_sync"
    subject_id = subject.id
    organization_id = organization.id
    await db_session.commit()

    subscription_payload = {
        "id": "sub_org_sync",
        "customer": "cus_org_sync",
        "status": "active",
        "cancel_at_period_end": False,
        "canceled_at": None,
        "latest_invoice": "in_org_sync",
        "current_period_start": 1_776_586_422,
        "current_period_end": 1_779_178_422,
        "metadata": {
            "billing_subject_id": str(subject_id),
            "organization_id": str(organization_id),
            "purpose": "cloud_subscription",
        },
        "items": {
            "data": [
                {
                    "id": "si_org_sync_monthly",
                    "quantity": 1,
                    "price": {"id": "price_pro"},
                },
                {
                    "id": "si_org_sync_overage",
                    "price": {"id": "price_overage"},
                },
            ]
        },
    }
    updates: list[int] = []

    async def fake_update_subscription_item_quantity(**kwargs: object) -> None:
        assert kwargs["subscription_item_id"] == "si_org_sync_monthly"
        updates.append(int(kwargs["quantity"]))

    async def fake_retrieve_subscription(subscription_id: str) -> dict[str, object]:
        assert subscription_id == "sub_org_sync"
        return subscription_payload

    monkeypatch.setattr(
        stripe_webhooks.stripe_billing,
        "update_subscription_item_quantity",
        fake_update_subscription_item_quantity,
    )
    monkeypatch.setattr(
        stripe_webhooks.stripe_billing,
        "retrieve_subscription",
        fake_retrieve_subscription,
    )

    subscription_record = await stripe_webhooks._sync_subscription(subscription_payload)
    assert subscription_record is not None
    assert subscription_record.seat_quantity == 2

    await stripe_webhooks._sync_subscription(subscription_payload)
    db_session.expire_all()
    subscription = (
        await db_session.execute(
            select(BillingSubscription).where(
                BillingSubscription.billing_subject_id == subject_id,
                BillingSubscription.stripe_subscription_id == "sub_org_sync",
            )
        )
    ).scalar_one()
    adjustments = list(
        (
            await db_session.execute(
                select(BillingSeatAdjustment).where(
                    BillingSeatAdjustment.billing_subject_id == subject_id,
                )
            )
        )
        .scalars()
        .all()
    )
    assert updates == [2]
    assert subscription.seat_quantity == 2
    assert len(adjustments) == 1
    assert adjustments[0].source_ref == "stripe:initial-reconcile:sub_org_sync:1776586422"
    assert adjustments[0].target_quantity == 2
    assert adjustments[0].grant_quantity == 0
    assert adjustments[0].status == "succeeded"

    invoice_payload = {
        "id": "in_org_sync",
        "customer": "cus_org_sync",
        "subscription": None,
        "parent": {
            "subscription_details": {
                "subscription": "sub_org_sync",
                "metadata": {
                    "billing_subject_id": str(subject_id),
                    "organization_id": str(organization_id),
                    "purpose": "cloud_subscription",
                },
            },
            "type": "subscription_details",
        },
        "lines": {
            "data": [
                {
                    "id": "il_org_sync",
                    "pricing": {
                        "price_details": {
                            "price": "price_pro",
                            "product": "prod_pro",
                        },
                        "type": "price_details",
                    },
                    "parent": {
                        "subscription_item_details": {
                            "subscription": "sub_org_sync",
                            "subscription_item": "si_org_sync_monthly",
                        },
                        "type": "subscription_item_details",
                    },
                }
            ]
        },
    }
    await stripe_webhooks._handle_invoice_paid(invoice_payload)
    await stripe_webhooks._handle_invoice_paid(invoice_payload)
    db_session.expire_all()

    grants = list(
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
    assert updates == [2]
    assert len(grants) == 1
    assert grants[0].hours_granted == 40.0

    db_session.add(
        OrganizationMembership(
            organization_id=organization_id,
            user_id=later_member_id,
            role=ORGANIZATION_ROLE_MEMBER,
            status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            joined_at=datetime.now(UTC),
        )
    )
    await db_session.commit()

    await stripe_webhooks._handle_invoice_paid(invoice_payload)
    await stripe_webhooks._handle_invoice_paid(invoice_payload)
    db_session.expire_all()

    grants = list(
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
    subscription = (
        await db_session.execute(
            select(BillingSubscription).where(
                BillingSubscription.billing_subject_id == subject_id,
                BillingSubscription.stripe_subscription_id == "sub_org_sync",
            )
        )
    ).scalar_one()
    assert updates == [2, 3]
    assert subscription.seat_quantity == 3
    assert len(grants) == 1
    assert grants[0].hours_granted == 60.0


@pytest.mark.asyncio
async def test_subscription_sync_does_not_reenable_disabled_pro_overage(
    db_session: AsyncSession,
    test_engine,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        engine_module,
        "async_session_factory",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )
    monkeypatch.setattr(settings, "pro_billing_enabled", True)
    monkeypatch.setattr(settings, "stripe_pro_monthly_price_id", "price_pro")
    monkeypatch.setattr(settings, "stripe_cloud_monthly_price_id", "")
    monkeypatch.setattr(settings, "stripe_legacy_cloud_monthly_price_id", "")
    monkeypatch.setattr(settings, "stripe_managed_cloud_overage_price_id", "price_overage")

    user_id = uuid.uuid4()
    subject = await ensure_personal_billing_subject(db_session, user_id)
    subject.stripe_customer_id = "cus_pro_overage_toggle"
    subject.overage_enabled = False
    await db_session.commit()

    subscription_payload = {
        "id": "sub_pro_toggle",
        "customer": "cus_pro_overage_toggle",
        "status": "active",
        "cancel_at_period_end": False,
        "canceled_at": None,
        "latest_invoice": "in_pro_toggle",
        "metadata": {
            "billing_subject_id": str(subject.id),
            "purpose": "cloud_subscription",
        },
        "items": {
            "data": [
                {
                    "id": "si_pro_monthly",
                    "quantity": 1,
                    "price": {"id": "price_pro"},
                    "current_period_start": 1_776_586_422,
                    "current_period_end": 1_779_178_422,
                },
                {
                    "id": "si_pro_overage",
                    "price": {"id": "price_overage"},
                    "current_period_start": 1_776_586_422,
                    "current_period_end": 1_779_178_422,
                },
            ]
        },
    }

    await stripe_webhooks._sync_subscription(subscription_payload)
    await db_session.refresh(subject)
    assert subject.overage_enabled is True

    subject.overage_enabled = False
    await db_session.commit()

    await stripe_webhooks._sync_subscription(subscription_payload | {"cancel_at_period_end": True})
    await db_session.refresh(subject)
    assert subject.overage_enabled is False


@pytest.mark.asyncio
async def test_subscription_sync_defaults_overage_when_incomplete_pro_becomes_active(
    db_session: AsyncSession,
    test_engine,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        engine_module,
        "async_session_factory",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )
    monkeypatch.setattr(settings, "pro_billing_enabled", True)
    monkeypatch.setattr(settings, "stripe_pro_monthly_price_id", "price_pro")
    monkeypatch.setattr(settings, "stripe_cloud_monthly_price_id", "")
    monkeypatch.setattr(settings, "stripe_legacy_cloud_monthly_price_id", "")
    monkeypatch.setattr(settings, "stripe_managed_cloud_overage_price_id", "price_overage")

    user_id = uuid.uuid4()
    subject = await ensure_personal_billing_subject(db_session, user_id)
    subject.stripe_customer_id = "cus_pro_incomplete"
    subject.overage_enabled = False
    await db_session.commit()

    subscription_payload = {
        "id": "sub_pro_incomplete",
        "customer": "cus_pro_incomplete",
        "status": "incomplete",
        "cancel_at_period_end": False,
        "canceled_at": None,
        "latest_invoice": "in_pro_incomplete",
        "metadata": {
            "billing_subject_id": str(subject.id),
            "purpose": "cloud_subscription",
        },
        "items": {
            "data": [
                {
                    "id": "si_pro_monthly",
                    "quantity": 1,
                    "price": {"id": "price_pro"},
                    "current_period_start": 1_776_586_422,
                    "current_period_end": 1_779_178_422,
                },
                {
                    "id": "si_pro_overage",
                    "price": {"id": "price_overage"},
                    "current_period_start": 1_776_586_422,
                    "current_period_end": 1_779_178_422,
                },
            ]
        },
    }

    await stripe_webhooks._sync_subscription(subscription_payload)
    await db_session.refresh(subject)
    assert subject.overage_enabled is False
    assert subject.overage_preference_set_at is None

    await stripe_webhooks._sync_subscription(subscription_payload | {"status": "active"})
    await db_session.refresh(subject)
    assert subject.overage_enabled is True
    assert subject.overage_preference_set_at is not None
