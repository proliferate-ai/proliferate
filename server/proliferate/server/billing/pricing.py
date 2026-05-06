"""Billing price classification helpers.

These helpers are intentionally env-only. Stripe HTTP validation stays in the
Stripe integration adapter; billing policy only needs a stable local
classification for already-synced price ids.
"""

from __future__ import annotations

from proliferate.config import settings
from proliferate.constants.billing import (
    BILLING_PRICE_CLASS_LEGACY_CLOUD,
    BILLING_PRICE_CLASS_PRO,
    BILLING_PRICE_CLASS_UNKNOWN,
)

BillingPriceClass = str


def configured_pro_monthly_price_id() -> str:
    """Return the effective Pro base price id.

    The old ``STRIPE_CLOUD_MONTHLY_PRICE_ID`` is accepted as a Pro alias only
    when there is no explicit Pro price and no legacy $200 price configured.
    """

    explicit = settings.stripe_pro_monthly_price_id.strip()
    if explicit:
        return explicit
    legacy = settings.stripe_legacy_cloud_monthly_price_id.strip()
    if legacy:
        return ""
    return settings.stripe_cloud_monthly_price_id.strip()


def configured_legacy_cloud_monthly_price_id() -> str:
    return settings.stripe_legacy_cloud_monthly_price_id.strip()


def configured_managed_cloud_overage_price_id() -> str:
    return settings.stripe_managed_cloud_overage_price_id.strip()


def configured_managed_cloud_meter_id() -> str:
    return (
        settings.stripe_managed_cloud_overage_meter_id.strip()
        or settings.stripe_sandbox_meter_id.strip()
    )


def configured_managed_cloud_meter_event_name() -> str:
    return settings.stripe_managed_cloud_overage_meter_event_name.strip()


def classify_monthly_price_id(price_id: str | None) -> BillingPriceClass:
    if not price_id:
        return BILLING_PRICE_CLASS_UNKNOWN
    legacy_price_id = configured_legacy_cloud_monthly_price_id()
    if legacy_price_id and price_id == legacy_price_id:
        return BILLING_PRICE_CLASS_LEGACY_CLOUD
    pro_price_id = configured_pro_monthly_price_id()
    if pro_price_id and price_id == pro_price_id:
        return BILLING_PRICE_CLASS_PRO
    return BILLING_PRICE_CLASS_UNKNOWN


def price_class_is_paid(price_class: BillingPriceClass) -> bool:
    return price_class in {BILLING_PRICE_CLASS_PRO, BILLING_PRICE_CLASS_LEGACY_CLOUD}
