"""Billing price classification helpers.

These helpers are intentionally env-only. Stripe HTTP validation stays in the
Stripe integration adapter; billing policy only needs a stable local
classification for already-synced price ids.
"""

from __future__ import annotations

from proliferate.config import settings
from proliferate.server.billing.domain.pricing import (
    BillingPriceClass,
    BillingPriceIds,
    effective_legacy_cloud_monthly_price_id,
    effective_managed_cloud_meter_event_name,
    effective_managed_cloud_meter_id,
    effective_managed_cloud_overage_price_id,
    effective_pro_monthly_price_id,
)
from proliferate.server.billing.domain.pricing import (
    classify_monthly_price_id as classify_monthly_price_id_for_config,
)
from proliferate.server.billing.domain.pricing import (
    price_class_is_paid as price_class_is_paid_for_config,
)


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
