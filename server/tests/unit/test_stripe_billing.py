from __future__ import annotations

from typing import Any

import pytest

from proliferate.config import settings
from proliferate.integrations.billing import stripe


@pytest.mark.asyncio
async def test_subscription_checkout_session_is_flat_monthly_with_promotion_codes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    async def _request(
        method: str,
        path: str,
        *,
        data: list[tuple[str, str]] | None = None,
        params: list[tuple[str, str]] | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        captured.update(
            {
                "method": method,
                "path": path,
                "data": data,
                "params": params,
                "idempotency_key": idempotency_key,
            }
        )
        return {"url": "https://checkout.stripe.test/session"}

    monkeypatch.setattr(stripe, "_request", _request)

    response = await stripe.create_subscription_checkout_session(
        stripe_customer_id="cus_test",
        billing_subject_id="subject-123",
        cloud_monthly_price_id="price_cloud_monthly",
        success_url="https://app.test/success",
        cancel_url="https://app.test/cancel",
        idempotency_key="checkout-key",
    )

    assert response.url == "https://checkout.stripe.test/session"
    assert captured["method"] == "POST"
    assert captured["path"] == "/checkout/sessions"
    assert captured["idempotency_key"] == "checkout-key"

    data = dict(captured["data"])
    assert data["mode"] == "subscription"
    assert data["customer"] == "cus_test"
    assert data["allow_promotion_codes"] == "true"
    assert data["payment_method_collection"] == "always"
    assert data["line_items[0][price]"] == "price_cloud_monthly"
    assert data["line_items[0][quantity]"] == "1"
    assert "line_items[1][price]" not in data


@pytest.mark.asyncio
async def test_cloud_subscription_price_validation_only_requires_monthly_price(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requested_price_ids: list[str] = []

    async def _retrieve_price(price_id: str) -> dict[str, Any]:
        requested_price_ids.append(price_id)
        return {"unit_amount": 20000, "recurring": {"interval": "month"}}

    monkeypatch.setattr(settings, "stripe_cloud_monthly_price_id", "price_cloud_monthly")
    monkeypatch.setattr(settings, "stripe_sandbox_overage_price_id", "")
    monkeypatch.setattr(stripe, "retrieve_price", _retrieve_price)

    await stripe.validate_cloud_subscription_price_configuration()

    assert requested_price_ids == ["price_cloud_monthly"]


@pytest.mark.asyncio
async def test_refill_price_validation_is_separate_from_subscription_validation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _retrieve_price(_price_id: str) -> dict[str, Any]:
        raise AssertionError("refill validation should fail before calling Stripe")

    monkeypatch.setattr(settings, "stripe_refill_10h_price_id", "")
    monkeypatch.setattr(stripe, "retrieve_price", _retrieve_price)

    with pytest.raises(stripe.StripeBillingError) as exc_info:
        await stripe.validate_refill_price_configuration()

    assert exc_info.value.code == "stripe_refill_price_unconfigured"
