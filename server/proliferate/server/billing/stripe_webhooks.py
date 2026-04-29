"""Stripe webhook verification and local billing event intake."""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from proliferate.config import settings
from proliferate.constants.billing import (
    MONTHLY_CLOUD_GRANT_TYPE,
    REFILL_10H_GRANT_TYPE,
)
from proliferate.db.models.billing import BillingSubject
from proliferate.db.store.billing import (
    apply_payment_failed_hold,
    claim_webhook_event,
    clear_payment_failed_holds,
    ensure_billing_grant_record,
    get_billing_subject_for_stripe_reference,
    mark_webhook_event_failed_by_id,
    mark_webhook_event_processed_by_id,
    upsert_stripe_subscription_record,
)
from proliferate.integrations.billing import stripe as stripe_billing
from proliferate.server.billing.models import BillingServiceError, StripeWebhookAck

STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300
STRIPE_PROVIDER = "stripe"
PAYMENT_HOLD_SOURCE = "stripe_webhook"
LOCAL_TEST_CLOUD_PRICE_LOOKUP_KEY = "proliferate_cloud_monthly_test"


@dataclass(frozen=True)
class StripeSignature:
    timestamp: int
    signatures: tuple[str, ...]


async def handle_stripe_webhook(
    *,
    payload: bytes,
    signature_header: str | None,
) -> StripeWebhookAck:
    if not settings.stripe_webhook_secret:
        raise BillingServiceError(
            "stripe_webhook_unconfigured",
            "Stripe webhook secret is not configured.",
            status_code=503,
        )
    _verify_stripe_signature(
        payload=payload,
        signature_header=signature_header,
        secret=settings.stripe_webhook_secret,
    )
    try:
        event = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise BillingServiceError(
            "stripe_webhook_invalid_json",
            "Stripe webhook payload is not valid JSON.",
            status_code=400,
        ) from exc

    event_id = event.get("id")
    event_type = event.get("type")
    if not isinstance(event_id, str) or not isinstance(event_type, str):
        raise BillingServiceError(
            "stripe_webhook_invalid_event",
            "Stripe webhook payload is missing an event id or type.",
            status_code=400,
        )

    receipt = await claim_webhook_event(
        provider=STRIPE_PROVIDER,
        event_id=event_id,
        event_type=event_type,
    )

    if receipt is not None:
        try:
            await _dispatch_stripe_event(event)
        except Exception as exc:
            await mark_webhook_event_failed_by_id(receipt_id=receipt.id, error=str(exc))
            raise
        await mark_webhook_event_processed_by_id(receipt_id=receipt.id)

    livemode = event.get("livemode")
    return StripeWebhookAck(
        event_id=event_id,
        event_type=event_type,
        livemode=livemode if isinstance(livemode, bool) else None,
    )


async def _dispatch_stripe_event(event: dict[str, Any]) -> None:
    event_type = event.get("type")
    stripe_object = _event_object(event)
    if event_type == "checkout.session.completed":
        await _handle_checkout_session_completed(stripe_object)
    elif event_type in {"customer.subscription.created", "customer.subscription.updated"}:
        await _sync_subscription(stripe_object)
    elif event_type == "customer.subscription.deleted":
        await _sync_subscription(stripe_object)
        await _apply_payment_hold_for_subscription(stripe_object)
    elif event_type == "invoice.paid":
        await _handle_invoice_paid(stripe_object)
    elif event_type == "invoice.payment_failed":
        await _handle_invoice_payment_failed(stripe_object)


def _event_object(event: dict[str, Any]) -> dict[str, Any]:
    data = event.get("data")
    if not isinstance(data, dict):
        return {}
    stripe_object = data.get("object")
    return stripe_object if isinstance(stripe_object, dict) else {}


def _metadata(stripe_object: dict[str, Any]) -> dict[str, str]:
    metadata = stripe_object.get("metadata")
    if not isinstance(metadata, dict):
        return {}
    return {key: value for key, value in metadata.items() if isinstance(value, str)}


def _subscription_parent_metadata(stripe_object: dict[str, Any]) -> dict[str, str]:
    parent = stripe_object.get("parent")
    if not isinstance(parent, dict):
        return {}
    subscription_details = parent.get("subscription_details")
    if not isinstance(subscription_details, dict):
        return {}
    metadata = subscription_details.get("metadata")
    if not isinstance(metadata, dict):
        return {}
    return {key: value for key, value in metadata.items() if isinstance(value, str)}


def _datetime_from_timestamp(value: object) -> datetime | None:
    if not isinstance(value, int | float):
        return None
    return datetime.fromtimestamp(value, tz=UTC)


def _id_from_expandable(value: object) -> str | None:
    if isinstance(value, str):
        return value
    if isinstance(value, dict) and isinstance(value.get("id"), str):
        return value["id"]
    return None


def _price_matches(line: dict[str, Any], *, price_id: str, lookup_key: str | None = None) -> bool:
    if _line_price_id(line) == price_id:
        return True
    price = line.get("price")
    if not isinstance(price, dict):
        return False
    return bool(lookup_key and price.get("lookup_key") == lookup_key)


def _line_price_id(line: dict[str, Any]) -> str | None:
    price = line.get("price")
    if isinstance(price, dict) and isinstance(price.get("id"), str):
        return price["id"]
    pricing = line.get("pricing")
    if not isinstance(pricing, dict):
        return None
    price_details = pricing.get("price_details")
    if isinstance(price_details, dict) and isinstance(price_details.get("price"), str):
        return price_details["price"]
    return None


def _line_period(line: dict[str, Any]) -> tuple[datetime | None, datetime | None]:
    period = line.get("period")
    if not isinstance(period, dict):
        return None, None
    return (
        _datetime_from_timestamp(period.get("start")),
        _datetime_from_timestamp(period.get("end")),
    )


def _line_items_from_object(stripe_object: dict[str, Any]) -> list[dict[str, Any]]:
    lines = stripe_object.get("lines")
    if isinstance(lines, dict) and isinstance(lines.get("data"), list):
        return [line for line in lines["data"] if isinstance(line, dict)]
    return []


def _line_subscription_id(line: dict[str, Any]) -> str | None:
    parent = line.get("parent")
    if not isinstance(parent, dict):
        return None
    subscription_item_details = parent.get("subscription_item_details")
    if not isinstance(subscription_item_details, dict):
        return None
    subscription_id = subscription_item_details.get("subscription")
    return subscription_id if isinstance(subscription_id, str) else None


def _invoice_subscription_id(invoice: dict[str, Any], lines: list[dict[str, Any]]) -> str | None:
    subscription_id = _id_from_expandable(invoice.get("subscription"))
    if subscription_id is not None:
        return subscription_id
    parent = invoice.get("parent")
    if isinstance(parent, dict):
        subscription_details = parent.get("subscription_details")
        if isinstance(subscription_details, dict):
            subscription_id = _id_from_expandable(subscription_details.get("subscription"))
            if subscription_id is not None:
                return subscription_id
    for line in lines:
        subscription_id = _line_subscription_id(line)
        if subscription_id is not None:
            return subscription_id
    return None


async def _subject_from_object(stripe_object: dict[str, Any]) -> BillingSubject | None:
    metadata = _metadata(stripe_object)
    subject_id = metadata.get("billing_subject_id")
    if subject_id is None:
        subject_id = _subscription_parent_metadata(stripe_object).get("billing_subject_id")
    billing_subject_id: UUID | None = None
    if subject_id:
        try:
            billing_subject_id = UUID(subject_id)
        except ValueError:
            return None
    return await get_billing_subject_for_stripe_reference(
        billing_subject_id=billing_subject_id,
        stripe_customer_id=_id_from_expandable(stripe_object.get("customer")),
    )


async def _handle_checkout_session_completed(session: dict[str, Any]) -> None:
    if session.get("mode") != "payment" or _metadata(session).get("purpose") != "refill_10h":
        return
    session_id = session.get("id")
    if not isinstance(session_id, str):
        return
    subject = await _subject_from_object(session)
    if subject is None or subject.user_id is None:
        return
    lines = await stripe_billing.list_checkout_session_line_items(session_id)
    if not stripe_billing.line_items_include_price(lines, settings.stripe_refill_10h_price_id):
        return
    await ensure_billing_grant_record(
        user_id=subject.user_id,
        billing_subject_id=subject.id,
        grant_type=REFILL_10H_GRANT_TYPE,
        hours_granted=10.0,
        effective_at=datetime.now(UTC),
        expires_at=None,
        source_ref=f"stripe:checkout:{session_id}:refill_10h",
    )


async def _sync_subscription(subscription: dict[str, Any]) -> None:
    subscription_id = subscription.get("id")
    customer_id = _id_from_expandable(subscription.get("customer"))
    status = subscription.get("status")
    if (
        not isinstance(subscription_id, str)
        or not isinstance(customer_id, str)
        or not isinstance(status, str)
    ):
        return
    subject = await _subject_from_object(subscription)
    if subject is None:
        return
    monthly_item_id, metered_item_id = _subscription_item_ids(subscription)
    current_period_start, current_period_end = _subscription_period(
        subscription,
        monthly_item_id=monthly_item_id,
        metered_item_id=metered_item_id,
    )
    await upsert_stripe_subscription_record(
        billing_subject_id=subject.id,
        stripe_subscription_id=subscription_id,
        stripe_customer_id=customer_id,
        status=status,
        cancel_at_period_end=bool(subscription.get("cancel_at_period_end")),
        canceled_at=_datetime_from_timestamp(subscription.get("canceled_at")),
        current_period_start=current_period_start,
        current_period_end=current_period_end,
        cloud_monthly_price_id=(
            settings.stripe_cloud_monthly_price_id if monthly_item_id is not None else None
        ),
        overage_price_id=(
            settings.stripe_sandbox_overage_price_id if metered_item_id is not None else None
        ),
        monthly_subscription_item_id=monthly_item_id,
        metered_subscription_item_id=metered_item_id,
        latest_invoice_id=_id_from_expandable(subscription.get("latest_invoice")),
        latest_invoice_status=None,
        hosted_invoice_url=None,
    )


def _subscription_item_ids(subscription: dict[str, Any]) -> tuple[str | None, str | None]:
    items = subscription.get("items")
    data = items.get("data") if isinstance(items, dict) else None
    monthly_item_id: str | None = None
    metered_item_id: str | None = None
    if not isinstance(data, list):
        return monthly_item_id, metered_item_id
    for item in data:
        if not isinstance(item, dict):
            continue
        item_id = item.get("id") if isinstance(item.get("id"), str) else None
        price = item.get("price")
        if not isinstance(price, dict):
            continue
        if price.get("id") == settings.stripe_cloud_monthly_price_id:
            monthly_item_id = item_id
        if price.get("id") == settings.stripe_sandbox_overage_price_id:
            metered_item_id = item_id
    return monthly_item_id, metered_item_id


def _subscription_period(
    subscription: dict[str, Any],
    *,
    monthly_item_id: str | None,
    metered_item_id: str | None,
) -> tuple[datetime | None, datetime | None]:
    top_level_start = _datetime_from_timestamp(subscription.get("current_period_start"))
    top_level_end = _datetime_from_timestamp(subscription.get("current_period_end"))
    if top_level_start is not None and top_level_end is not None:
        return top_level_start, top_level_end

    items = subscription.get("items")
    data = items.get("data") if isinstance(items, dict) else None
    if not isinstance(data, list):
        return None, None

    preferred_item_ids = [item_id for item_id in (monthly_item_id, metered_item_id) if item_id]
    for preferred_item_id in preferred_item_ids:
        for item in data:
            if not isinstance(item, dict) or item.get("id") != preferred_item_id:
                continue
            return (
                _datetime_from_timestamp(item.get("current_period_start")),
                _datetime_from_timestamp(item.get("current_period_end")),
            )

    for item in data:
        if not isinstance(item, dict):
            continue
        return (
            _datetime_from_timestamp(item.get("current_period_start")),
            _datetime_from_timestamp(item.get("current_period_end")),
        )
    return None, None


async def _handle_invoice_paid(invoice: dict[str, Any]) -> None:
    invoice_id = invoice.get("id")
    if not isinstance(invoice_id, str):
        return
    lines = _line_items_from_object(invoice)
    if not lines:
        lines = await stripe_billing.list_invoice_lines(invoice_id)
    cloud_line = next(
        (
            line
            for line in lines
            if _price_matches(
                line,
                price_id=settings.stripe_cloud_monthly_price_id,
                lookup_key=LOCAL_TEST_CLOUD_PRICE_LOOKUP_KEY,
            )
        ),
        None,
    )
    if cloud_line is None:
        return
    subject = await _subject_from_object(invoice)
    subscription_id = _invoice_subscription_id(invoice, lines)
    if subscription_id:
        subscription = await stripe_billing.retrieve_subscription(subscription_id)
        await _sync_subscription(subscription)
        if subject is None:
            subject = await _subject_from_object(subscription)
    if subject is None or subject.user_id is None:
        return
    line_period_start, line_period_end = _line_period(cloud_line)
    period_start = (
        line_period_start
        or _datetime_from_timestamp(invoice.get("period_start"))
        or datetime.now(UTC)
    )
    period_end = line_period_end or _datetime_from_timestamp(invoice.get("period_end"))
    await ensure_billing_grant_record(
        user_id=subject.user_id,
        billing_subject_id=subject.id,
        grant_type=MONTHLY_CLOUD_GRANT_TYPE,
        hours_granted=100.0,
        effective_at=period_start,
        expires_at=period_end,
        source_ref=f"stripe:invoice:{invoice_id}:cloud_monthly",
    )
    await clear_payment_failed_holds(billing_subject_id=subject.id)


async def _handle_invoice_payment_failed(invoice: dict[str, Any]) -> None:
    subject = await _subject_from_object(invoice)
    if subject is None:
        lines = _line_items_from_object(invoice)
        if not lines:
            invoice_id = invoice.get("id")
            if isinstance(invoice_id, str):
                lines = await stripe_billing.list_invoice_lines(invoice_id)
        subscription_id = _invoice_subscription_id(invoice, lines)
        if subscription_id:
            subscription = await stripe_billing.retrieve_subscription(subscription_id)
            subject = await _subject_from_object(subscription)
    if subject is None:
        return
    await apply_payment_failed_hold(
        billing_subject_id=subject.id,
        source=PAYMENT_HOLD_SOURCE,
        source_ref=_id_from_expandable(invoice.get("id")),
    )


async def _apply_payment_hold_for_subscription(subscription: dict[str, Any]) -> None:
    subject = await _subject_from_object(subscription)
    if subject is None:
        return
    await apply_payment_failed_hold(
        billing_subject_id=subject.id,
        source=PAYMENT_HOLD_SOURCE,
        source_ref=_id_from_expandable(subscription.get("id")),
    )


def _verify_stripe_signature(
    *,
    payload: bytes,
    signature_header: str | None,
    secret: str,
    now: int | None = None,
) -> None:
    signature = _parse_signature_header(signature_header)
    current_time = int(time.time()) if now is None else now
    if abs(current_time - signature.timestamp) > STRIPE_SIGNATURE_TOLERANCE_SECONDS:
        raise BillingServiceError(
            "stripe_webhook_stale_signature",
            "Stripe webhook signature timestamp is outside the allowed tolerance.",
            status_code=401,
        )
    signed_payload = str(signature.timestamp).encode("ascii") + b"." + payload
    expected = hmac.new(secret.encode("utf-8"), signed_payload, hashlib.sha256).hexdigest()
    if not any(hmac.compare_digest(expected, candidate) for candidate in signature.signatures):
        raise BillingServiceError(
            "stripe_webhook_invalid_signature",
            "Stripe webhook signature is invalid.",
            status_code=401,
        )


def _parse_signature_header(signature_header: str | None) -> StripeSignature:
    if not signature_header:
        raise BillingServiceError(
            "stripe_webhook_missing_signature",
            "Stripe webhook signature header is missing.",
            status_code=401,
        )
    fields: dict[str, list[str]] = {}
    for item in signature_header.split(","):
        key, separator, value = item.partition("=")
        if not separator:
            continue
        fields.setdefault(key, []).append(value)
    timestamps = fields.get("t") or []
    signatures = tuple(value for value in fields.get("v1", []) if value)
    try:
        timestamp = int(timestamps[0])
    except (IndexError, ValueError) as exc:
        raise BillingServiceError(
            "stripe_webhook_invalid_signature",
            "Stripe webhook signature timestamp is invalid.",
            status_code=401,
        ) from exc
    if not signatures:
        raise BillingServiceError(
            "stripe_webhook_invalid_signature",
            "Stripe webhook signature does not include a v1 signature.",
            status_code=401,
        )
    return StripeSignature(timestamp=timestamp, signatures=signatures)
