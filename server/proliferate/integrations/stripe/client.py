"""Stripe HTTP client helpers."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlencode

import httpx

from proliferate.config import settings
from proliferate.integrations.stripe.errors import StripeIntegrationError
from proliferate.integrations.stripe.models import StripePriceDetails, StripeUrlResponse

STRIPE_API_BASE = "https://api.stripe.com/v1"
STRIPE_TIMEOUT_SECONDS = 10.0


def _require_secret_key() -> str:
    if not settings.stripe_secret_key:
        raise StripeIntegrationError(
            "stripe_unconfigured",
            "Stripe secret key is not configured.",
            status_code=503,
        )
    return settings.stripe_secret_key


def _headers(*, idempotency_key: str | None = None) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {_require_secret_key()}"}
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key
    return headers


async def _request(
    method: str,
    path: str,
    *,
    data: list[tuple[str, str]] | None = None,
    params: list[tuple[str, str]] | None = None,
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    headers = _headers(idempotency_key=idempotency_key)
    content: bytes | None = None
    if data is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
        content = urlencode(data).encode("utf-8")

    try:
        async with httpx.AsyncClient(timeout=STRIPE_TIMEOUT_SECONDS) as client:
            response = await client.request(
                method,
                f"{STRIPE_API_BASE}{path}",
                headers=headers,
                params=params,
                content=content,
            )
    except httpx.HTTPError as exc:
        raise StripeIntegrationError(
            "stripe_request_failed",
            "Could not reach Stripe. Check the local Stripe configuration and network.",
        ) from exc
    try:
        payload = response.json()
    except ValueError:
        payload = {}
    if response.status_code >= 400:
        message = "Stripe request failed."
        if isinstance(payload, dict):
            error = payload.get("error")
            if isinstance(error, dict) and isinstance(error.get("message"), str):
                message = error["message"]
        raise StripeIntegrationError(
            "stripe_request_failed",
            message,
            status_code=response.status_code,
        )
    if not isinstance(payload, dict):
        raise StripeIntegrationError(
            "stripe_invalid_response", "Stripe returned an invalid response."
        )
    return payload


async def create_customer(
    *,
    email: str | None,
    name: str | None = None,
    billing_subject_id: str,
    organization_id: str | None = None,
    created_by_user_id: str | None = None,
    idempotency_key: str,
) -> dict[str, Any]:
    data = [
        ("metadata[billing_subject_id]", billing_subject_id),
        ("metadata[purpose]", "cloud_billing"),
    ]
    if email:
        data.append(("email", email))
    if name:
        data.append(("name", name))
    if organization_id:
        data.append(("metadata[organization_id]", organization_id))
    if created_by_user_id:
        data.append(("metadata[created_by_user_id]", created_by_user_id))
    return await _request(
        "POST",
        "/customers",
        data=data,
        idempotency_key=idempotency_key,
    )


async def create_subscription_checkout_session(
    *,
    stripe_customer_id: str,
    billing_subject_id: str,
    organization_id: str | None = None,
    created_by_user_id: str | None = None,
    cloud_monthly_price_id: str,
    overage_price_id: str | None = None,
    seat_quantity: int = 1,
    success_url: str,
    cancel_url: str,
    idempotency_key: str,
    purpose: str = "cloud_subscription",
    checkout_intent_id: str | None = None,
) -> StripeUrlResponse:
    data = [
        ("mode", "subscription"),
        ("customer", stripe_customer_id),
        ("success_url", success_url),
        ("cancel_url", cancel_url),
        ("allow_promotion_codes", "true"),
        ("payment_method_collection", "always"),
        ("line_items[0][price]", cloud_monthly_price_id),
        ("line_items[0][quantity]", str(max(seat_quantity, 1))),
        ("metadata[billing_subject_id]", billing_subject_id),
        ("metadata[purpose]", purpose),
        ("subscription_data[metadata][billing_subject_id]", billing_subject_id),
        ("subscription_data[metadata][purpose]", purpose),
    ]
    if organization_id:
        data.extend(
            [
                ("metadata[organization_id]", organization_id),
                ("subscription_data[metadata][organization_id]", organization_id),
            ]
        )
    if created_by_user_id:
        data.extend(
            [
                ("metadata[created_by_user_id]", created_by_user_id),
                ("subscription_data[metadata][created_by_user_id]", created_by_user_id),
            ]
        )
    if checkout_intent_id:
        data.extend(
            [
                ("metadata[organization_checkout_intent_id]", checkout_intent_id),
                (
                    "subscription_data[metadata][organization_checkout_intent_id]",
                    checkout_intent_id,
                ),
            ]
        )
    if overage_price_id:
        data.append(("line_items[1][price]", overage_price_id))
    payload = await _request(
        "POST",
        "/checkout/sessions",
        data=data,
        idempotency_key=idempotency_key,
    )
    url = payload.get("url")
    if not isinstance(url, str):
        raise StripeIntegrationError(
            "stripe_invalid_response",
            "Stripe did not return a checkout URL.",
        )
    session_id = payload.get("id")
    return StripeUrlResponse(url=url, id=session_id if isinstance(session_id, str) else None)


async def create_refill_checkout_session(
    *,
    stripe_customer_id: str,
    billing_subject_id: str,
    refill_price_id: str,
    success_url: str,
    cancel_url: str,
    idempotency_key: str,
) -> StripeUrlResponse:
    payload = await _request(
        "POST",
        "/checkout/sessions",
        data=[
            ("mode", "payment"),
            ("customer", stripe_customer_id),
            ("success_url", success_url),
            ("cancel_url", cancel_url),
            ("line_items[0][price]", refill_price_id),
            ("line_items[0][quantity]", "1"),
            ("metadata[billing_subject_id]", billing_subject_id),
            ("metadata[purpose]", "refill_10h"),
            ("payment_intent_data[metadata][billing_subject_id]", billing_subject_id),
            ("payment_intent_data[metadata][purpose]", "refill_10h"),
        ],
        idempotency_key=idempotency_key,
    )
    url = payload.get("url")
    if not isinstance(url, str):
        raise StripeIntegrationError(
            "stripe_invalid_response", "Stripe did not return a refill URL."
        )
    return StripeUrlResponse(url=url)


async def create_customer_portal_session(
    *,
    stripe_customer_id: str,
    return_url: str,
    idempotency_key: str,
) -> StripeUrlResponse:
    payload = await _request(
        "POST",
        "/billing_portal/sessions",
        data=[("customer", stripe_customer_id), ("return_url", return_url)],
        idempotency_key=idempotency_key,
    )
    url = payload.get("url")
    if not isinstance(url, str):
        raise StripeIntegrationError(
            "stripe_invalid_response", "Stripe did not return a portal URL."
        )
    return StripeUrlResponse(url=url)


async def list_checkout_session_line_items(session_id: str) -> list[dict[str, Any]]:
    payload = await _request(
        "GET",
        f"/checkout/sessions/{session_id}/line_items",
        params=[("limit", "100")],
    )
    data = payload.get("data")
    return [item for item in data if isinstance(item, dict)] if isinstance(data, list) else []


async def list_invoice_lines(invoice_id: str) -> list[dict[str, Any]]:
    payload = await _request(
        "GET",
        f"/invoices/{invoice_id}/lines",
        params=[("limit", "100")],
    )
    data = payload.get("data")
    return [item for item in data if isinstance(item, dict)] if isinstance(data, list) else []


async def retrieve_subscription(subscription_id: str) -> dict[str, Any]:
    return await _request("GET", f"/subscriptions/{subscription_id}")


async def retrieve_invoice(invoice_id: str) -> dict[str, Any]:
    return await _request("GET", f"/invoices/{invoice_id}")


async def retrieve_price(price_id: str) -> dict[str, Any]:
    return await _request("GET", f"/prices/{price_id}")


async def retrieve_price_details(price_id: str) -> StripePriceDetails:
    payload = await retrieve_price(price_id)
    recurring = payload.get("recurring")
    recurring_payload = recurring if isinstance(recurring, dict) else {}
    currency = payload.get("currency")
    unit_amount = payload.get("unit_amount")
    interval = recurring_payload.get("interval")
    usage_type = recurring_payload.get("usage_type")
    meter = recurring_payload.get("meter")
    return StripePriceDetails(
        currency=currency if isinstance(currency, str) else None,
        unit_amount=unit_amount if isinstance(unit_amount, int) else None,
        recurring_interval=interval if isinstance(interval, str) else None,
        recurring_usage_type=usage_type if isinstance(usage_type, str) else None,
        recurring_meter=meter if isinstance(meter, str) else None,
    )


async def create_meter_event(
    *,
    event_name: str,
    stripe_customer_id: str,
    quantity: int | None = None,
    quantity_seconds: int | None = None,
    identifier: str,
    timestamp: int | None,
    idempotency_key: str,
) -> dict[str, Any]:
    meter_quantity = quantity if quantity is not None else quantity_seconds
    if meter_quantity is None:
        raise StripeIntegrationError(
            "stripe_invalid_meter_quantity", "Meter quantity is required."
        )
    data = [
        ("event_name", event_name),
        ("identifier", identifier),
        ("payload[stripe_customer_id]", stripe_customer_id),
        ("payload[value]", str(meter_quantity)),
    ]
    if timestamp is not None:
        data.append(("timestamp", str(timestamp)))
    return await _request(
        "POST",
        "/billing/meter_events",
        data=data,
        idempotency_key=idempotency_key,
    )


async def create_invoice(
    *,
    stripe_customer_id: str,
    billing_subject_id: str,
    purpose: str,
    idempotency_key: str,
) -> dict[str, Any]:
    """Create a draft invoice that charges the customer's default payment method.

    ``pending_invoice_items_behavior=exclude`` keeps unrelated pending invoice
    items off the invoice — line items are attached explicitly via
    :func:`create_invoice_item`.
    """
    return await _request(
        "POST",
        "/invoices",
        data=[
            ("customer", stripe_customer_id),
            ("collection_method", "charge_automatically"),
            ("auto_advance", "true"),
            ("pending_invoice_items_behavior", "exclude"),
            ("metadata[billing_subject_id]", billing_subject_id),
            ("metadata[purpose]", purpose),
        ],
        idempotency_key=idempotency_key,
    )


async def create_invoice_item(
    *,
    stripe_customer_id: str,
    invoice_id: str,
    price_id: str,
    billing_subject_id: str,
    purpose: str,
    idempotency_key: str,
) -> dict[str, Any]:
    """Attach a priced line item to a draft invoice."""
    return await _request(
        "POST",
        "/invoiceitems",
        data=[
            ("customer", stripe_customer_id),
            ("invoice", invoice_id),
            ("pricing[price]", price_id),
            ("metadata[billing_subject_id]", billing_subject_id),
            ("metadata[purpose]", purpose),
        ],
        idempotency_key=idempotency_key,
    )


async def finalize_invoice(
    *,
    invoice_id: str,
    idempotency_key: str,
) -> dict[str, Any]:
    """Finalize a draft invoice; charge_automatically invoices then collect."""
    return await _request(
        "POST",
        f"/invoices/{invoice_id}/finalize",
        data=[("auto_advance", "true")],
        idempotency_key=idempotency_key,
    )


def _price_id(line: dict[str, Any]) -> str | None:
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


def line_items_include_price(lines: list[dict[str, Any]], price_id: str) -> bool:
    return any(_price_id(line) == price_id for line in lines)


async def update_subscription_item_quantity(
    *,
    subscription_item_id: str,
    quantity: int,
    idempotency_key: str,
) -> dict[str, Any]:
    return await _request(
        "POST",
        f"/subscription_items/{subscription_item_id}",
        data=[
            ("quantity", str(max(quantity, 1))),
            ("proration_behavior", "always_invoice"),
        ],
        idempotency_key=idempotency_key,
    )
