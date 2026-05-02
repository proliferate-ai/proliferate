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
async def test_pro_subscription_checkout_session_includes_overage_item_and_seat_quantity(
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
        return {"url": "https://checkout.stripe.test/pro-session"}

    monkeypatch.setattr(stripe, "_request", _request)

    response = await stripe.create_subscription_checkout_session(
        stripe_customer_id="cus_test",
        billing_subject_id="subject-123",
        organization_id="org-123",
        created_by_user_id="user-123",
        cloud_monthly_price_id="price_pro_monthly",
        overage_price_id="price_managed_cloud_overage",
        seat_quantity=3,
        success_url="https://app.test/success",
        cancel_url="https://app.test/cancel",
        idempotency_key="pro-checkout-key",
    )

    assert response.url == "https://checkout.stripe.test/pro-session"
    assert captured["method"] == "POST"
    assert captured["path"] == "/checkout/sessions"
    assert captured["idempotency_key"] == "pro-checkout-key"

    data = dict(captured["data"])
    assert data["line_items[0][price]"] == "price_pro_monthly"
    assert data["line_items[0][quantity]"] == "3"
    assert data["line_items[1][price]"] == "price_managed_cloud_overage"
    assert data["metadata[billing_subject_id]"] == "subject-123"
    assert data["metadata[organization_id]"] == "org-123"
    assert data["metadata[created_by_user_id]"] == "user-123"
    assert data["subscription_data[metadata][billing_subject_id]"] == "subject-123"
    assert data["subscription_data[metadata][organization_id]"] == "org-123"
    assert data["subscription_data[metadata][created_by_user_id]"] == "user-123"


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
async def test_pro_price_validation_requires_overage_price_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _retrieve_price(_price_id: str) -> dict[str, Any]:
        raise AssertionError("validation should fail before retrieving prices")

    monkeypatch.setattr(settings, "stripe_pro_monthly_price_id", "price_pro_monthly")
    monkeypatch.setattr(settings, "stripe_cloud_monthly_price_id", "")
    monkeypatch.setattr(settings, "stripe_legacy_cloud_monthly_price_id", "")
    monkeypatch.setattr(settings, "stripe_managed_cloud_overage_price_id", "")
    monkeypatch.setattr(stripe, "retrieve_price", _retrieve_price)

    with pytest.raises(stripe.StripeBillingError) as exc_info:
        await stripe.validate_pro_subscription_price_configuration()

    assert exc_info.value.code == "stripe_price_unconfigured"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("pro_price", "overage_price", "meter_id", "message"),
    [
        (
            {"currency": "eur", "unit_amount": 2000, "recurring": {"interval": "month"}},
            {
                "currency": "usd",
                "unit_amount": 1,
                "recurring": {
                    "interval": "month",
                    "usage_type": "metered",
                    "meter": "meter_managed",
                },
            },
            "meter_managed",
            "Pro monthly price must be USD.",
        ),
        (
            {"currency": "usd", "unit_amount": 2000, "recurring": {"interval": "month"}},
            {
                "currency": "usd",
                "unit_amount": 1,
                "recurring": {
                    "interval": "month",
                    "usage_type": "licensed",
                    "meter": "meter_managed",
                },
            },
            "meter_managed",
            "Overage price must be a metered recurring price.",
        ),
        (
            {"currency": "usd", "unit_amount": 2000, "recurring": {"interval": "month"}},
            {
                "currency": "usd",
                "unit_amount": 1,
                "recurring": {
                    "interval": "month",
                    "usage_type": "metered",
                    "meter": "meter_other",
                },
            },
            "meter_managed",
            "Overage price must use the configured managed cloud meter.",
        ),
    ],
)
async def test_pro_price_validation_rejects_misconfigured_prices(
    monkeypatch: pytest.MonkeyPatch,
    pro_price: dict[str, Any],
    overage_price: dict[str, Any],
    meter_id: str,
    message: str,
) -> None:
    async def _retrieve_price(price_id: str) -> dict[str, Any]:
        if price_id == "price_pro_monthly":
            return pro_price
        if price_id == "price_overage":
            return overage_price
        raise AssertionError(f"unexpected price id {price_id}")

    monkeypatch.setattr(settings, "stripe_pro_monthly_price_id", "price_pro_monthly")
    monkeypatch.setattr(settings, "stripe_cloud_monthly_price_id", "")
    monkeypatch.setattr(settings, "stripe_legacy_cloud_monthly_price_id", "")
    monkeypatch.setattr(settings, "stripe_managed_cloud_overage_price_id", "price_overage")
    monkeypatch.setattr(settings, "stripe_managed_cloud_overage_meter_id", meter_id)
    monkeypatch.setattr(stripe, "retrieve_price", _retrieve_price)

    with pytest.raises(stripe.StripeBillingError) as exc_info:
        await stripe.validate_pro_subscription_price_configuration()

    assert exc_info.value.code == "stripe_price_misconfigured"
    assert exc_info.value.message == message


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
