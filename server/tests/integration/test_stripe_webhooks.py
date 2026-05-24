from __future__ import annotations

import hashlib
import hmac
import json
import time
import uuid
from datetime import UTC, datetime, timedelta

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
from proliferate.db.models.billing import (
    BillingNotificationEvent,
    BillingGrant,
    BillingHold,
    BillingSeatAdjustment,
    BillingSubscription,
    WebhookEventReceipt,
)
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.store.billing import (
    ensure_organization_billing_subject,
    ensure_personal_billing_subject,
)
from proliferate.server.billing import service as billing_service
from proliferate.server.billing import stripe_webhooks
from proliferate.server import notifications as slack_notifications
from proliferate.server.billing.models import BillingServiceError


def _stripe_signature(payload: bytes, *, secret: str, timestamp: int | None = None) -> str:
    timestamp = int(time.time()) if timestamp is None else timestamp
    signed_payload = str(timestamp).encode("ascii") + b"." + payload
    digest = hmac.new(secret.encode("utf-8"), signed_payload, hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={digest}"


def _subscription_payload(
    *,
    subject_id: str,
    customer_id: str,
    subscription_id: str,
    status: str,
    cancel_at_period_end: bool = False,
    canceled_at: int | None = None,
) -> dict[str, object]:
    return {
        "id": subscription_id,
        "customer": customer_id,
        "status": status,
        "cancel_at_period_end": cancel_at_period_end,
        "canceled_at": canceled_at,
        "latest_invoice": f"in_{subscription_id}",
        "metadata": {
            "billing_subject_id": subject_id,
            "purpose": "cloud_subscription",
        },
        "items": {
            "data": [
                {
                    "id": f"si_{subscription_id}",
                    "price": {"id": "price_cloud"},
                    "current_period_start": 1_776_586_422,
                    "current_period_end": 1_779_178_422,
                }
            ]
        },
    }


async def _handle_subscription_event(
    *,
    secret: str,
    event_id: str,
    event_type: str,
    subscription: dict[str, object],
) -> None:
    payload = json.dumps(
        {
            "id": event_id,
            "type": event_type,
            "data": {"object": subscription},
        },
        separators=(",", ":"),
    ).encode("utf-8")
    await stripe_webhooks.handle_stripe_webhook(
        payload=payload,
        signature_header=_stripe_signature(payload, secret=secret),
    )


def _capture_billing_notifications(monkeypatch: pytest.MonkeyPatch) -> list[object]:
    notifications: list[object] = []

    async def fake_send_billing_slack_notification(notification: object) -> bool:
        notifications.append(notification)
        return True

    monkeypatch.setattr(
        slack_notifications,
        "send_billing_slack_notification",
        fake_send_billing_slack_notification,
    )
    return notifications


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
async def test_stripe_webhook_duplicate_processed_event_does_not_dispatch_again(
    db_session: AsyncSession,
    test_engine,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        engine_module,
        "async_session_factory",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )
    secret = "whsec_test_secret"
    monkeypatch.setattr(settings, "stripe_webhook_secret", secret)
    payload = json.dumps(
        {
            "id": "evt_duplicate",
            "livemode": False,
            "type": "invoice.payment_failed",
            "data": {"object": {"id": "in_duplicate"}},
        },
        separators=(",", ":"),
    ).encode("utf-8")
    signature = _stripe_signature(payload, secret=secret)
    dispatched: list[str] = []

    async def _dispatch(event: dict[str, object]) -> None:
        dispatched.append(str(event["id"]))

    monkeypatch.setattr(stripe_webhooks, "_dispatch_stripe_event", _dispatch)

    first = await stripe_webhooks.handle_stripe_webhook(
        payload=payload,
        signature_header=signature,
    )
    second = await stripe_webhooks.handle_stripe_webhook(
        payload=payload,
        signature_header=signature,
    )

    assert first == second
    assert dispatched == ["evt_duplicate"]
    receipt = (
        await db_session.execute(
            select(WebhookEventReceipt).where(WebhookEventReceipt.event_id == "evt_duplicate")
        )
    ).scalar_one()
    assert receipt.provider == "stripe"
    assert receipt.status == "processed"
    assert receipt.attempt_count == 1


@pytest.mark.asyncio
async def test_stripe_webhook_in_progress_duplicate_is_retryable(
    db_session: AsyncSession,
    test_engine,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        engine_module,
        "async_session_factory",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )
    secret = "whsec_test_secret"
    monkeypatch.setattr(settings, "stripe_webhook_secret", secret)
    db_session.add(
        WebhookEventReceipt(
            provider="stripe",
            event_id="evt_in_progress",
            event_type="invoice.paid",
            status="processing",
            attempt_count=1,
            processing_lease_expires_at=datetime.now(UTC) + timedelta(minutes=5),
            received_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
    )
    await db_session.commit()
    payload = json.dumps(
        {
            "id": "evt_in_progress",
            "type": "invoice.paid",
            "data": {"object": {"id": "in_progress"}},
        },
        separators=(",", ":"),
    ).encode("utf-8")

    with pytest.raises(BillingServiceError) as exc_info:
        await stripe_webhooks.handle_stripe_webhook(
            payload=payload,
            signature_header=_stripe_signature(payload, secret=secret),
        )

    assert exc_info.value.code == "stripe_webhook_in_progress"
    assert exc_info.value.status_code == 409


@pytest.mark.asyncio
async def test_stripe_webhook_failed_event_can_be_reclaimed_and_processed(
    db_session: AsyncSession,
    test_engine,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        engine_module,
        "async_session_factory",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )
    secret = "whsec_test_secret"
    monkeypatch.setattr(settings, "stripe_webhook_secret", secret)
    payload = json.dumps(
        {
            "id": "evt_retry_after_failure",
            "type": "invoice.paid",
            "data": {"object": {"id": "in_retry_after_failure"}},
        },
        separators=(",", ":"),
    ).encode("utf-8")
    signature = _stripe_signature(payload, secret=secret)
    attempts = 0

    async def _dispatch(_event: dict[str, object]) -> None:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise RuntimeError("transient webhook failure")

    monkeypatch.setattr(stripe_webhooks, "_dispatch_stripe_event", _dispatch)

    with pytest.raises(RuntimeError, match="transient webhook failure"):
        await stripe_webhooks.handle_stripe_webhook(
            payload=payload,
            signature_header=signature,
        )

    failed = (
        await db_session.execute(
            select(WebhookEventReceipt).where(
                WebhookEventReceipt.event_id == "evt_retry_after_failure"
            )
        )
    ).scalar_one()
    assert failed.status == "failed"
    assert failed.attempt_count == 1
    assert failed.last_error == "transient webhook failure"

    await stripe_webhooks.handle_stripe_webhook(
        payload=payload,
        signature_header=signature,
    )
    db_session.expire_all()
    processed = (
        await db_session.execute(
            select(WebhookEventReceipt).where(
                WebhookEventReceipt.event_id == "evt_retry_after_failure"
            )
        )
    ).scalar_one()
    assert attempts == 2
    assert processed.status == "processed"
    assert processed.attempt_count == 2
    assert processed.last_error is None


@pytest.mark.asyncio
async def test_subscription_created_schedules_positive_billing_notification_once(
    db_session: AsyncSession,
    test_engine,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        engine_module,
        "async_session_factory",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )
    secret = "whsec_test_secret"
    monkeypatch.setattr(settings, "stripe_webhook_secret", secret)
    monkeypatch.setattr(settings, "stripe_cloud_monthly_price_id", "price_cloud")
    notifications = _capture_billing_notifications(monkeypatch)

    user_id = uuid.uuid4()
    db_session.add(
        User(
            id=user_id,
            email="billing-positive@example.com",
            hashed_password="unused",
            is_active=True,
            is_superuser=False,
            is_verified=True,
            display_name="Billing Positive",
            github_login="billing-positive",
            created_at=datetime(2026, 5, 1, tzinfo=UTC),
        )
    )
    subject = await ensure_personal_billing_subject(db_session, user_id)
    subject.stripe_customer_id = "cus_billing_positive"
    await db_session.commit()

    payload = json.dumps(
        {
            "id": "evt_subscription_created_notify",
            "type": "customer.subscription.created",
            "data": {
                "object": _subscription_payload(
                    subject_id=str(subject.id),
                    customer_id="cus_billing_positive",
                    subscription_id="sub_billing_positive",
                    status="active",
                )
            },
        },
        separators=(",", ":"),
    ).encode("utf-8")
    signature = _stripe_signature(payload, secret=secret)

    await stripe_webhooks.handle_stripe_webhook(
        payload=payload,
        signature_header=signature,
    )
    await stripe_webhooks.handle_stripe_webhook(
        payload=payload,
        signature_header=signature,
    )

    assert len(notifications) == 1
    notification = notifications[0]
    assert notification.event == "subscribed"
    assert notification.name == "Billing Positive"
    assert notification.email == "billing-positive@example.com"
    assert notification.github == "billing-positive"
    assert notification.workspace_count == 0
    assert notification.organization_user_count == 1


@pytest.mark.asyncio
async def test_invoice_paid_before_subscription_created_still_schedules_positive_once(
    db_session: AsyncSession,
    test_engine,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        engine_module,
        "async_session_factory",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )
    secret = "whsec_test_secret"
    monkeypatch.setattr(settings, "stripe_webhook_secret", secret)
    monkeypatch.setattr(settings, "stripe_cloud_monthly_price_id", "price_cloud")
    notifications = _capture_billing_notifications(monkeypatch)

    user_id = uuid.uuid4()
    db_session.add(
        User(
            id=user_id,
            email="invoice-first@example.com",
            hashed_password="unused",
            is_active=True,
            is_superuser=False,
            is_verified=True,
            display_name="Invoice First",
            github_login="invoice-first",
            created_at=datetime(2026, 5, 1, tzinfo=UTC),
        )
    )
    subject = await ensure_personal_billing_subject(db_session, user_id)
    subject.stripe_customer_id = "cus_invoice_first"
    await db_session.commit()

    subscription = _subscription_payload(
        subject_id=str(subject.id),
        customer_id="cus_invoice_first",
        subscription_id="sub_invoice_first",
        status="active",
    )

    async def fake_retrieve_subscription(subscription_id: str) -> dict[str, object]:
        assert subscription_id == "sub_invoice_first"
        return subscription

    monkeypatch.setattr(
        stripe_webhooks.stripe_billing,
        "retrieve_subscription",
        fake_retrieve_subscription,
    )

    invoice_payload = json.dumps(
        {
            "id": "evt_invoice_first",
            "type": "invoice.paid",
            "data": {
                "object": {
                    "id": "in_invoice_first",
                    "customer": "cus_invoice_first",
                    "subscription": "sub_invoice_first",
                    "lines": {
                        "data": [
                            {
                                "id": "il_invoice_first",
                                "price": {"id": "price_cloud"},
                                "parent": {
                                    "subscription_item_details": {
                                        "subscription": "sub_invoice_first",
                                        "subscription_item": "si_sub_invoice_first",
                                    },
                                    "type": "subscription_item_details",
                                },
                            }
                        ]
                    },
                }
            },
        },
        separators=(",", ":"),
    ).encode("utf-8")
    await stripe_webhooks.handle_stripe_webhook(
        payload=invoice_payload,
        signature_header=_stripe_signature(invoice_payload, secret=secret),
    )
    await _handle_subscription_event(
        secret=secret,
        event_id="evt_subscription_created_after_invoice",
        event_type="customer.subscription.created",
        subscription=subscription,
    )

    assert len(notifications) == 1
    assert notifications[0].event == "subscribed"
    assert notifications[0].email == "invoice-first@example.com"


@pytest.mark.asyncio
async def test_distinct_subscription_events_share_billing_notification_claim(
    db_session: AsyncSession,
    test_engine,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        engine_module,
        "async_session_factory",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )
    secret = "whsec_test_secret"
    monkeypatch.setattr(settings, "stripe_webhook_secret", secret)
    monkeypatch.setattr(settings, "stripe_cloud_monthly_price_id", "price_cloud")
    notifications = _capture_billing_notifications(monkeypatch)

    user_id = uuid.uuid4()
    db_session.add(
        User(
            id=user_id,
            email="billing-distinct-events@example.com",
            hashed_password="unused",
            is_active=True,
            is_superuser=False,
            is_verified=True,
            display_name="Distinct Events",
            github_login="distinct-events",
        )
    )
    subject = await ensure_personal_billing_subject(db_session, user_id)
    subject.stripe_customer_id = "cus_billing_distinct_events"
    await db_session.commit()
    subscription = _subscription_payload(
        subject_id=str(subject.id),
        customer_id="cus_billing_distinct_events",
        subscription_id="sub_billing_distinct_events",
        status="active",
    )

    await _handle_subscription_event(
        secret=secret,
        event_id="evt_distinct_created",
        event_type="customer.subscription.created",
        subscription=subscription,
    )
    await _handle_subscription_event(
        secret=secret,
        event_id="evt_distinct_updated",
        event_type="customer.subscription.updated",
        subscription=subscription,
    )

    assert [notification.event for notification in notifications] == ["subscribed"]


@pytest.mark.asyncio
async def test_invoice_upcoming_records_idempotent_billing_notification_event(
    db_session: AsyncSession,
    test_engine,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        engine_module,
        "async_session_factory",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )
    secret = "whsec_invoice_upcoming"
    monkeypatch.setattr(settings, "stripe_webhook_secret", secret)
    user_id = uuid.uuid4()
    subject = await ensure_personal_billing_subject(db_session, user_id)
    subject.stripe_customer_id = "cus_invoice_upcoming"
    await db_session.commit()

    payload = json.dumps(
        {
            "id": "evt_invoice_upcoming_notification",
            "type": "invoice.upcoming",
            "created": 1_776_586_422,
            "data": {
                "object": {
                    "id": "in_upcoming_notification",
                    "customer": "cus_invoice_upcoming",
                    "subscription": "sub_invoice_upcoming",
                    "metadata": {"billing_subject_id": str(subject.id)},
                }
            },
        },
        separators=(",", ":"),
    ).encode("utf-8")

    await stripe_webhooks.handle_stripe_webhook(
        payload=payload,
        signature_header=_stripe_signature(payload, secret=secret),
    )
    await stripe_webhooks.handle_stripe_webhook(
        payload=payload,
        signature_header=_stripe_signature(payload, secret=secret),
    )

    rows = list(
        (
            await db_session.execute(
                select(BillingNotificationEvent).where(
                    BillingNotificationEvent.idempotency_key
                    == (
                        "stripe:invoice.upcoming:"
                        "cus_invoice_upcoming:sub_invoice_upcoming:unknown_start:unknown_end"
                    )
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1
    assert rows[0].kind == "invoice_upcoming"
    assert rows[0].severity == "info"
    assert rows[0].external_ref == "in_upcoming_notification"


@pytest.mark.asyncio
async def test_invoice_upcoming_without_invoice_id_uses_logical_idempotency_key(
    db_session: AsyncSession,
    test_engine,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        engine_module,
        "async_session_factory",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )
    secret = "whsec_invoice_upcoming_null"
    monkeypatch.setattr(settings, "stripe_webhook_secret", secret)
    user_id = uuid.uuid4()
    subject = await ensure_personal_billing_subject(db_session, user_id)
    subject.stripe_customer_id = "cus_invoice_upcoming_null"
    await db_session.commit()

    payload = json.dumps(
        {
            "id": "evt_invoice_upcoming_null",
            "type": "invoice.upcoming",
            "created": 1_776_586_422,
            "data": {
                "object": {
                    "id": None,
                    "customer": "cus_invoice_upcoming_null",
                    "subscription": "sub_invoice_upcoming_null",
                    "period_start": 1_776_586_422,
                    "period_end": 1_779_178_422,
                    "metadata": {"billing_subject_id": str(subject.id)},
                }
            },
        },
        separators=(",", ":"),
    ).encode("utf-8")

    await stripe_webhooks.handle_stripe_webhook(
        payload=payload,
        signature_header=_stripe_signature(payload, secret=secret),
    )
    duplicate_payload = payload.replace(
        b"evt_invoice_upcoming_null",
        b"evt_invoice_upcoming_retry",
    )
    await stripe_webhooks.handle_stripe_webhook(
        payload=duplicate_payload,
        signature_header=_stripe_signature(duplicate_payload, secret=secret),
    )

    rows = list(
        (
            await db_session.execute(
                select(BillingNotificationEvent).where(
                    BillingNotificationEvent.idempotency_key
                    == (
                        "stripe:invoice.upcoming:cus_invoice_upcoming_null:"
                        "sub_invoice_upcoming_null:1776586422:1779178422"
                    )
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1
    assert rows[0].kind == "invoice_upcoming"
    assert rows[0].external_ref is None


@pytest.mark.asyncio
async def test_payment_recovery_does_not_send_subscription_started_notification(
    db_session: AsyncSession,
    test_engine,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        engine_module,
        "async_session_factory",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )
    secret = "whsec_test_secret"
    monkeypatch.setattr(settings, "stripe_webhook_secret", secret)
    monkeypatch.setattr(settings, "stripe_cloud_monthly_price_id", "price_cloud")
    notifications = _capture_billing_notifications(monkeypatch)

    user_id = uuid.uuid4()
    db_session.add(
        User(
            id=user_id,
            email="billing-recovery@example.com",
            hashed_password="unused",
            is_active=True,
            is_superuser=False,
            is_verified=True,
            display_name="Billing Recovery",
            github_login="billing-recovery",
        )
    )
    subject = await ensure_personal_billing_subject(db_session, user_id)
    subject.stripe_customer_id = "cus_billing_recovery"
    await db_session.commit()
    subscription = _subscription_payload(
        subject_id=str(subject.id),
        customer_id="cus_billing_recovery",
        subscription_id="sub_billing_recovery",
        status="past_due",
    )
    await stripe_webhooks._sync_subscription(subscription)

    await _handle_subscription_event(
        secret=secret,
        event_id="evt_recovery_updated",
        event_type="customer.subscription.updated",
        subscription=subscription | {"status": "active"},
    )

    assert notifications == []


@pytest.mark.asyncio
async def test_subscription_cancellation_schedules_negative_notification_once(
    db_session: AsyncSession,
    test_engine,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        engine_module,
        "async_session_factory",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )
    secret = "whsec_test_secret"
    monkeypatch.setattr(settings, "stripe_webhook_secret", secret)
    monkeypatch.setattr(settings, "stripe_cloud_monthly_price_id", "price_cloud")
    notifications = _capture_billing_notifications(monkeypatch)

    user_id = uuid.uuid4()
    db_session.add(
        User(
            id=user_id,
            email="billing-negative@example.com",
            hashed_password="unused",
            is_active=True,
            is_superuser=False,
            is_verified=True,
            display_name="Billing Negative",
            github_login="billing-negative",
            created_at=datetime(2026, 5, 1, tzinfo=UTC),
        )
    )
    subject = await ensure_personal_billing_subject(db_session, user_id)
    subject.stripe_customer_id = "cus_billing_negative"
    await db_session.commit()

    await _handle_subscription_event(
        secret=secret,
        event_id="evt_subscription_created_before_cancel",
        event_type="customer.subscription.created",
        subscription=_subscription_payload(
            subject_id=str(subject.id),
            customer_id="cus_billing_negative",
            subscription_id="sub_billing_negative",
            status="active",
        ),
    )
    notifications.clear()

    await _handle_subscription_event(
        secret=secret,
        event_id="evt_subscription_cancel_scheduled",
        event_type="customer.subscription.updated",
        subscription=_subscription_payload(
            subject_id=str(subject.id),
            customer_id="cus_billing_negative",
            subscription_id="sub_billing_negative",
            status="active",
            cancel_at_period_end=True,
        ),
    )
    await _handle_subscription_event(
        secret=secret,
        event_id="evt_subscription_deleted_after_cancel",
        event_type="customer.subscription.deleted",
        subscription=_subscription_payload(
            subject_id=str(subject.id),
            customer_id="cus_billing_negative",
            subscription_id="sub_billing_negative",
            status="canceled",
            cancel_at_period_end=True,
            canceled_at=1_777_000_000,
        ),
    )

    assert len(notifications) == 1
    notification = notifications[0]
    assert notification.event == "cancelled"
    assert notification.email == "billing-negative@example.com"


@pytest.mark.asyncio
async def test_billing_notification_delivery_failure_keeps_webhook_processed(
    db_session: AsyncSession,
    test_engine,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        engine_module,
        "async_session_factory",
        async_sessionmaker(test_engine, expire_on_commit=False),
    )
    secret = "whsec_test_secret"
    monkeypatch.setattr(settings, "stripe_webhook_secret", secret)
    monkeypatch.setattr(settings, "stripe_cloud_monthly_price_id", "price_cloud")
    monkeypatch.setattr(settings, "billing_positive_slack_webhook_url", "https://positive")

    async def failed_send(_notification: object) -> bool:
        return False

    monkeypatch.setattr(
        slack_notifications,
        "send_billing_slack_notification",
        failed_send,
    )

    user_id = uuid.uuid4()
    db_session.add(
        User(
            id=user_id,
            email="billing-slack-failure@example.com",
            hashed_password="unused",
            is_active=True,
            is_superuser=False,
            is_verified=True,
            display_name="Slack Failure",
            github_login="slack-failure",
        )
    )
    subject = await ensure_personal_billing_subject(db_session, user_id)
    subject.stripe_customer_id = "cus_billing_slack_failure"
    await db_session.commit()

    await _handle_subscription_event(
        secret=secret,
        event_id="evt_subscription_schedule_failure",
        event_type="customer.subscription.created",
        subscription=_subscription_payload(
            subject_id=str(subject.id),
            customer_id="cus_billing_slack_failure",
            subscription_id="sub_billing_slack_failure",
            status="active",
        ),
    )

    receipt = (
        await db_session.execute(
            select(WebhookEventReceipt).where(
                WebhookEventReceipt.event_id == "evt_subscription_schedule_failure"
            )
        )
    ).scalar_one()
    assert receipt.status == "processed"
    notification_receipt = (
        await db_session.execute(
            select(WebhookEventReceipt).where(
                WebhookEventReceipt.provider == "billing_slack",
                WebhookEventReceipt.event_id == "sub_billing_slack_failure:subscribed",
            )
        )
    ).scalar_one()
    assert notification_receipt.status == "failed"


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
    monkeypatch.setattr(settings, "cloud_billing_mode", "observe")
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
    monkeypatch.setattr(settings, "cloud_billing_mode", "observe")
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
        billing_service.stripe_billing,
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
    assert subscription_record.seat_quantity == 1

    await stripe_webhooks._sync_subscription(subscription_payload)
    await billing_service.process_pending_seat_adjustments()
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
    await billing_service.process_pending_seat_adjustments()
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
async def test_invoice_failed_hold_blocks_until_invoice_paid_clears_it(
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
    subject.stripe_customer_id = "cus_payment_hold"
    subject_id = subject.id
    await db_session.commit()

    subscription_payload = {
        "id": "sub_payment_hold",
        "customer": "cus_payment_hold",
        "status": "active",
        "cancel_at_period_end": False,
        "canceled_at": None,
        "current_period_start": 1_776_586_422,
        "current_period_end": 1_779_178_422,
        "latest_invoice": "in_paid_after_hold",
        "metadata": {
            "billing_subject_id": str(subject_id),
            "purpose": "cloud_subscription",
        },
        "items": {
            "data": [
                {
                    "id": "si_hold_monthly",
                    "quantity": 1,
                    "price": {"id": "price_pro"},
                },
                {
                    "id": "si_hold_overage",
                    "price": {"id": "price_overage"},
                },
            ]
        },
    }

    async def _retrieve_subscription(subscription_id: str) -> dict[str, object]:
        assert subscription_id == "sub_payment_hold"
        return subscription_payload

    monkeypatch.setattr(
        stripe_webhooks.stripe_billing,
        "retrieve_subscription",
        _retrieve_subscription,
    )

    await stripe_webhooks._handle_invoice_payment_failed(
        {
            "id": "in_failed_hold",
            "customer": "cus_payment_hold",
            "subscription": "sub_payment_hold",
            "metadata": {"billing_subject_id": str(subject_id)},
        }
    )
    db_session.expire_all()
    hold = (
        await db_session.execute(
            select(BillingHold).where(BillingHold.billing_subject_id == subject_id)
        )
    ).scalar_one()
    assert hold.kind == "payment_failed"
    assert hold.status == "active"
    assert hold.source_ref == "in_failed_hold"

    await stripe_webhooks._handle_invoice_paid(
        {
            "id": "in_paid_after_hold",
            "customer": "cus_payment_hold",
            "subscription": "sub_payment_hold",
            "metadata": {"billing_subject_id": str(subject_id)},
            "lines": {
                "data": [
                    {
                        "id": "il_paid_hold",
                        "pricing": {
                            "price_details": {
                                "price": "price_pro",
                                "product": "prod_pro",
                            },
                            "type": "price_details",
                        },
                        "parent": {
                            "subscription_item_details": {
                                "subscription": "sub_payment_hold",
                                "subscription_item": "si_hold_monthly",
                            },
                            "type": "subscription_item_details",
                        },
                    }
                ]
            },
        }
    )
    db_session.expire_all()
    hold = (
        await db_session.execute(
            select(BillingHold).where(BillingHold.billing_subject_id == subject_id)
        )
    ).scalar_one()
    assert hold.status == "resolved"
    assert hold.resolved_at is not None


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
