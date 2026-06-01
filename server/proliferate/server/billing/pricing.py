"""Billing price configuration helpers."""

from __future__ import annotations

from proliferate.config import settings
from proliferate.integrations import stripe as stripe_billing
from proliferate.server.billing.domain.pricing import (
    BillingPriceClass,
    BillingPriceIds,
    BillingPriceShape,
    effective_legacy_cloud_monthly_price_id,
    effective_managed_cloud_meter_event_name,
    effective_managed_cloud_meter_id,
    effective_managed_cloud_overage_price_id,
    effective_pro_monthly_price_id,
    validate_legacy_cloud_monthly_price_shape,
    validate_managed_cloud_overage_price_shape,
    validate_pro_monthly_price_shape,
    validate_refill_price_shape,
)
from proliferate.server.billing.domain.pricing import (
    classify_monthly_price_id as classify_monthly_price_id_for_config,
)
from proliferate.server.billing.domain.pricing import (
    price_class_is_paid as price_class_is_paid_for_config,
)
from proliferate.server.billing.models import BillingServiceError


def billing_price_ids_from_settings() -> BillingPriceIds:
    return BillingPriceIds(
        cloud_monthly_price_id=settings.stripe_cloud_monthly_price_id,
        pro_monthly_price_id=settings.stripe_pro_monthly_price_id,
        legacy_cloud_monthly_price_id=settings.stripe_legacy_cloud_monthly_price_id,
        sandbox_overage_price_id=settings.stripe_sandbox_overage_price_id,
        managed_cloud_overage_price_id=settings.stripe_managed_cloud_overage_price_id,
        managed_cloud_overage_meter_id=settings.stripe_managed_cloud_overage_meter_id,
        sandbox_meter_id=settings.stripe_sandbox_meter_id,
        managed_cloud_overage_meter_event_name=(
            settings.stripe_managed_cloud_overage_meter_event_name
        ),
    )


def configured_pro_monthly_price_id() -> str:
    """Return the effective Pro base price id.

    The old ``STRIPE_CLOUD_MONTHLY_PRICE_ID`` is accepted as a Pro alias only
    when there is no explicit Pro price and no legacy $200 price configured.
    """

    return effective_pro_monthly_price_id(billing_price_ids_from_settings())


def configured_legacy_cloud_monthly_price_id() -> str:
    return effective_legacy_cloud_monthly_price_id(billing_price_ids_from_settings())


def configured_managed_cloud_overage_price_id() -> str:
    return effective_managed_cloud_overage_price_id(billing_price_ids_from_settings())


def configured_managed_cloud_meter_id() -> str:
    return effective_managed_cloud_meter_id(billing_price_ids_from_settings())


def configured_managed_cloud_meter_event_name() -> str:
    return effective_managed_cloud_meter_event_name(billing_price_ids_from_settings())


def classify_monthly_price_id(price_id: str | None) -> BillingPriceClass:
    return classify_monthly_price_id_for_config(
        price_id,
        price_ids=billing_price_ids_from_settings(),
    )


def price_class_is_paid(price_class: BillingPriceClass) -> bool:
    return price_class_is_paid_for_config(price_class)


def _map_stripe_error(error: stripe_billing.StripeBillingError) -> BillingServiceError:
    return BillingServiceError(error.code, error.message, status_code=error.status_code)


def _stripe_price_configuration_error(code: str, message: str) -> BillingServiceError:
    return BillingServiceError(code, message, status_code=503)


async def _retrieve_billing_price_shape(price_id: str) -> BillingPriceShape:
    try:
        price = await stripe_billing.retrieve_price_details(price_id)
    except stripe_billing.StripeBillingError as error:
        raise _map_stripe_error(error) from error
    return BillingPriceShape(
        currency=price.currency,
        unit_amount=price.unit_amount,
        recurring_interval=price.recurring_interval,
        recurring_usage_type=price.recurring_usage_type,
        recurring_meter=price.recurring_meter,
    )


async def validate_cloud_subscription_price_configuration() -> None:
    if not settings.stripe_cloud_monthly_price_id:
        raise _stripe_price_configuration_error(
            "stripe_price_unconfigured",
            "Stripe Cloud monthly price ID is not configured.",
        )
    cloud_price = await _retrieve_billing_price_shape(settings.stripe_cloud_monthly_price_id)
    if message := validate_legacy_cloud_monthly_price_shape(cloud_price):
        raise _stripe_price_configuration_error("stripe_price_misconfigured", message)


async def validate_pro_subscription_price_configuration() -> None:
    pro_price_id = configured_pro_monthly_price_id()
    overage_price_id = configured_managed_cloud_overage_price_id()
    if not pro_price_id:
        raise _stripe_price_configuration_error(
            "stripe_price_unconfigured",
            "Stripe Pro monthly price ID is not configured.",
        )
    if not overage_price_id:
        raise _stripe_price_configuration_error(
            "stripe_price_unconfigured",
            "Stripe managed cloud overage price ID is not configured.",
        )

    pro_price = await _retrieve_billing_price_shape(pro_price_id)
    if message := validate_pro_monthly_price_shape(pro_price):
        raise _stripe_price_configuration_error("stripe_price_misconfigured", message)

    overage_price = await _retrieve_billing_price_shape(overage_price_id)
    if message := validate_managed_cloud_overage_price_shape(
        overage_price,
        meter_id=configured_managed_cloud_meter_id(),
    ):
        raise _stripe_price_configuration_error("stripe_price_misconfigured", message)


async def validate_refill_price_configuration() -> None:
    if not settings.stripe_refill_10h_price_id:
        raise _stripe_price_configuration_error(
            "stripe_refill_price_unconfigured",
            "Stripe refill price is not configured.",
        )
    refill_price = await _retrieve_billing_price_shape(settings.stripe_refill_10h_price_id)
    if message := validate_refill_price_shape(refill_price):
        raise _stripe_price_configuration_error("stripe_price_misconfigured", message)
