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

STRIPE_API_BASE = "https://api.stripe.com/v1"
STRIPE_TIMEOUT_SECONDS = 10.0
TEN_SANDBOX_HOURS_SECONDS = 36000
CLOUD_MONTHLY_AMOUNT_CENTS = 20000
OVERAGE_BLOCK_AMOUNT_CENTS = 2000
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
        raise StripeBillingError("stripe_request_failed", message)
    if not isinstance(payload, dict):
        raise StripeBillingError("stripe_invalid_response", "Stripe returned an invalid response.")
    return payload


async def create_customer(
    *,
    email: str | None,
    billing_subject_id: str,
    idempotency_key: str,
) -> dict[str, Any]:
    data = [
        ("metadata[billing_subject_id]", billing_subject_id),
        ("metadata[purpose]", "cloud_billing"),
    ]
    if email:
        data.append(("email", email))
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
    cloud_monthly_price_id: str,
    sandbox_overage_price_id: str,
    success_url: str,
    cancel_url: str,
    idempotency_key: str,
) -> StripeUrlResponse:
    data = [
        ("mode", "subscription"),
        ("customer", stripe_customer_id),
        ("success_url", success_url),
        ("cancel_url", cancel_url),
        ("line_items[0][price]", cloud_monthly_price_id),
        ("line_items[0][quantity]", "1"),
        ("line_items[1][price]", sandbox_overage_price_id),
        ("metadata[billing_subject_id]", billing_subject_id),
        ("metadata[purpose]", "cloud_subscription"),
        ("subscription_data[metadata][billing_subject_id]", billing_subject_id),
        ("subscription_data[metadata][purpose]", "cloud_subscription"),
    ]
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
    quantity_seconds: int,
    identifier: str,
    timestamp: int | None,
    idempotency_key: str,
) -> dict[str, Any]:
    data = [
        ("event_name", event_name),
        ("identifier", identifier),
        ("payload[stripe_customer_id]", stripe_customer_id),
        ("payload[value]", str(quantity_seconds)),
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


async def validate_cloud_price_configuration() -> None:
    if not (
        settings.stripe_cloud_monthly_price_id
        and settings.stripe_sandbox_overage_price_id
        and settings.stripe_refill_10h_price_id
    ):
        raise StripeBillingError(
            "stripe_price_unconfigured",
            "Stripe Cloud price IDs are not configured.",
            status_code=503,
        )
    cloud = await retrieve_price(settings.stripe_cloud_monthly_price_id)
    overage = await retrieve_price(settings.stripe_sandbox_overage_price_id)
    refill = await retrieve_price(settings.stripe_refill_10h_price_id)

    _assert_price(
        cloud.get("unit_amount") == CLOUD_MONTHLY_AMOUNT_CENTS,
        "Cloud monthly price must be $200/month.",
    )
    _assert_price(
        _recurring(cloud).get("interval") == "month",
        "Cloud monthly price must recur monthly.",
    )
    _assert_price(
        overage.get("unit_amount") == OVERAGE_BLOCK_AMOUNT_CENTS,
        "Sandbox overage price must be $20 per transformed unit.",
    )
    _assert_price(
        _recurring(overage).get("usage_type") == "metered",
        "Sandbox overage price must be metered.",
    )
    transform = overage.get("transform_quantity")
    _assert_price(
        isinstance(transform, dict) and transform.get("divide_by") == TEN_SANDBOX_HOURS_SECONDS,
        "Sandbox overage price must divide raw seconds by 36000.",
    )
    _assert_price(
        isinstance(transform, dict) and transform.get("round") == "up",
        "Sandbox overage price must round transformed usage up.",
    )
    _assert_price(
        refill.get("unit_amount") == REFILL_10H_AMOUNT_CENTS,
        "Refill price must be $20.",
    )
