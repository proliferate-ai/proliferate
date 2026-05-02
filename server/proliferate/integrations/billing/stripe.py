"""Stripe billing integration.

This adapter owns raw Stripe HTTP calls. Billing policy and local accounting
stay in ``server.billing`` and ``db.store.billing``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

import httpx

from proliferate.config import settings
from proliferate.constants.billing import PRO_SEAT_MONTHLY_AMOUNT_CENTS
from proliferate.server.billing.pricing import (
    configured_managed_cloud_meter_id,
    configured_managed_cloud_overage_price_id,
    configured_pro_monthly_price_id,
)

STRIPE_API_BASE = "https://api.stripe.com/v1"
STRIPE_TIMEOUT_SECONDS = 10.0
CLOUD_MONTHLY_AMOUNT_CENTS = 20000
REFILL_10H_AMOUNT_CENTS = 2000


class StripeBillingError(RuntimeError):
    def __init__(self, code: str, message: str, *, status_code: int = 502) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


@dataclass(frozen=True)
class StripeUrlResponse:
    url: str


def _require_secret_key() -> str:
    if not settings.stripe_secret_key:
        raise StripeBillingError(
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
        raise StripeBillingError(
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
        raise StripeBillingError(
            "stripe_request_failed",
            message,
            status_code=response.status_code,
        )
    if not isinstance(payload, dict):
        raise StripeBillingError("stripe_invalid_response", "Stripe returned an invalid response.")
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
        ("metadata[purpose]", "cloud_subscription"),
        ("subscription_data[metadata][billing_subject_id]", billing_subject_id),
        ("subscription_data[metadata][purpose]", "cloud_subscription"),
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
    if overage_price_id:
        data.extend(
            [
                ("line_items[1][price]", overage_price_id),
            ]
        )
    payload = await _request(
        "POST",
        "/checkout/sessions",
        data=data,
        idempotency_key=idempotency_key,
    )
    url = payload.get("url")
    if not isinstance(url, str):
        raise StripeBillingError(
            "stripe_invalid_response",
            "Stripe did not return a checkout URL.",
        )
    return StripeUrlResponse(url=url)


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
        raise StripeBillingError("stripe_invalid_response", "Stripe did not return a refill URL.")
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
        raise StripeBillingError("stripe_invalid_response", "Stripe did not return a portal URL.")
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
        raise StripeBillingError("stripe_invalid_meter_quantity", "Meter quantity is required.")
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


def _assert_price(condition: bool, message: str) -> None:
    if not condition:
        raise StripeBillingError("stripe_price_misconfigured", message, status_code=503)


def _recurring(price: dict[str, Any]) -> dict[str, Any]:
    recurring = price.get("recurring")
    return recurring if isinstance(recurring, dict) else {}


async def validate_cloud_subscription_price_configuration() -> None:
    if not settings.stripe_cloud_monthly_price_id:
        raise StripeBillingError(
            "stripe_price_unconfigured",
            "Stripe Cloud monthly price ID is not configured.",
            status_code=503,
        )
    cloud = await retrieve_price(settings.stripe_cloud_monthly_price_id)

    _assert_price(
        cloud.get("unit_amount") == CLOUD_MONTHLY_AMOUNT_CENTS,
        "Cloud monthly price must be $200/month.",
    )
    _assert_price(
        _recurring(cloud).get("interval") == "month",
        "Cloud monthly price must recur monthly.",
    )


async def validate_pro_subscription_price_configuration() -> None:
    pro_price_id = configured_pro_monthly_price_id()
    overage_price_id = configured_managed_cloud_overage_price_id()
    if not pro_price_id:
        raise StripeBillingError(
            "stripe_price_unconfigured",
            "Stripe Pro monthly price ID is not configured.",
            status_code=503,
        )
    if not overage_price_id:
        raise StripeBillingError(
            "stripe_price_unconfigured",
            "Stripe managed cloud overage price ID is not configured.",
            status_code=503,
        )

    pro_price = await retrieve_price(pro_price_id)
    _assert_price(pro_price.get("currency") == "usd", "Pro monthly price must be USD.")
    _assert_price(
        pro_price.get("unit_amount") == PRO_SEAT_MONTHLY_AMOUNT_CENTS,
        "Pro monthly price must be $20/month.",
    )
    _assert_price(_recurring(pro_price).get("interval") == "month", "Pro price must recur monthly.")

    overage = await retrieve_price(overage_price_id)
    recurring = _recurring(overage)
    _assert_price(overage.get("currency") == "usd", "Overage price must be USD.")
    _assert_price(overage.get("unit_amount") == 1, "Overage price must be 1 cent per unit.")
    _assert_price(recurring.get("interval") == "month", "Overage price must recur monthly.")
    _assert_price(
        recurring.get("usage_type") == "metered",
        "Overage price must be a metered recurring price.",
    )
    meter_id = configured_managed_cloud_meter_id()
    if meter_id:
        _assert_price(
            recurring.get("meter") == meter_id,
            "Overage price must use the configured managed cloud meter.",
        )


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


async def validate_refill_price_configuration() -> None:
    if not settings.stripe_refill_10h_price_id:
        raise StripeBillingError(
            "stripe_refill_price_unconfigured",
            "Stripe refill price is not configured.",
            status_code=503,
        )
    refill = await retrieve_price(settings.stripe_refill_10h_price_id)
    _assert_price(
        refill.get("unit_amount") == REFILL_10H_AMOUNT_CENTS,
        "Refill price must be $20.",
    )
