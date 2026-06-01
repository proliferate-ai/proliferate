"""Pure billing price classification rules."""

from __future__ import annotations

from dataclasses import dataclass

from proliferate.constants.billing import (
    BILLING_PRICE_CLASS_LEGACY_CLOUD,
    BILLING_PRICE_CLASS_PRO,
    BILLING_PRICE_CLASS_UNKNOWN,
    PRO_SEAT_MONTHLY_AMOUNT_CENTS,
)

BillingPriceClass = str
LEGACY_CLOUD_MONTHLY_AMOUNT_CENTS = 20_000
REFILL_10H_AMOUNT_CENTS = 2_000


@dataclass(frozen=True)
class BillingPriceIds:
    cloud_monthly_price_id: str = ""
    pro_monthly_price_id: str = ""
    legacy_cloud_monthly_price_id: str = ""
    sandbox_overage_price_id: str = ""
    managed_cloud_overage_price_id: str = ""
    managed_cloud_overage_meter_id: str = ""
    sandbox_meter_id: str = ""
    managed_cloud_overage_meter_event_name: str = ""


@dataclass(frozen=True)
class BillingPriceShape:
    currency: str | None = None
    unit_amount: int | None = None
    recurring_interval: str | None = None
    recurring_usage_type: str | None = None
    recurring_meter: str | None = None


def clean_price_id(price_id: str | None) -> str:
    return price_id.strip() if price_id else ""


def effective_pro_monthly_price_id(price_ids: BillingPriceIds) -> str:
    explicit = clean_price_id(price_ids.pro_monthly_price_id)
    if explicit:
        return explicit
    if clean_price_id(price_ids.legacy_cloud_monthly_price_id):
        return ""
    return clean_price_id(price_ids.cloud_monthly_price_id)


def effective_legacy_cloud_monthly_price_id(price_ids: BillingPriceIds) -> str:
    return clean_price_id(price_ids.legacy_cloud_monthly_price_id)


def effective_managed_cloud_overage_price_id(price_ids: BillingPriceIds) -> str:
    return clean_price_id(price_ids.managed_cloud_overage_price_id)


def effective_managed_cloud_meter_id(price_ids: BillingPriceIds) -> str:
    return clean_price_id(price_ids.managed_cloud_overage_meter_id) or clean_price_id(
        price_ids.sandbox_meter_id,
    )


def effective_managed_cloud_meter_event_name(price_ids: BillingPriceIds) -> str:
    return clean_price_id(price_ids.managed_cloud_overage_meter_event_name)


def monthly_subscription_price_ids(price_ids: BillingPriceIds) -> frozenset[str]:
    return frozenset(
        price_id
        for price_id in (
            clean_price_id(price_ids.cloud_monthly_price_id),
            effective_pro_monthly_price_id(price_ids),
            effective_legacy_cloud_monthly_price_id(price_ids),
        )
        if price_id
    )


def overage_subscription_price_ids(price_ids: BillingPriceIds) -> frozenset[str]:
    return frozenset(
        price_id
        for price_id in (
            clean_price_id(price_ids.sandbox_overage_price_id),
            effective_managed_cloud_overage_price_id(price_ids),
        )
        if price_id
    )


def classify_monthly_price_id(
    price_id: str | None,
    *,
    price_ids: BillingPriceIds,
) -> BillingPriceClass:
    candidate = price_id or ""
    if not candidate:
        return BILLING_PRICE_CLASS_UNKNOWN
    legacy_price_id = effective_legacy_cloud_monthly_price_id(price_ids)
    if legacy_price_id and candidate == legacy_price_id:
        return BILLING_PRICE_CLASS_LEGACY_CLOUD
    pro_price_id = effective_pro_monthly_price_id(price_ids)
    if pro_price_id and candidate == pro_price_id:
        return BILLING_PRICE_CLASS_PRO
    return BILLING_PRICE_CLASS_UNKNOWN


def price_class_is_paid(price_class: BillingPriceClass) -> bool:
    return price_class in {BILLING_PRICE_CLASS_PRO, BILLING_PRICE_CLASS_LEGACY_CLOUD}


def monthly_price_is_pro(price_id: str | None, *, price_ids: BillingPriceIds) -> bool:
    return classify_monthly_price_id(price_id, price_ids=price_ids) == BILLING_PRICE_CLASS_PRO


def monthly_price_is_paid(price_id: str | None, *, price_ids: BillingPriceIds) -> bool:
    return price_class_is_paid(classify_monthly_price_id(price_id, price_ids=price_ids))


def validate_legacy_cloud_monthly_price_shape(price: BillingPriceShape) -> str | None:
    if price.unit_amount != LEGACY_CLOUD_MONTHLY_AMOUNT_CENTS:
        return "Cloud monthly price must be $200/month."
    if price.recurring_interval != "month":
        return "Cloud monthly price must recur monthly."
    return None


def validate_pro_monthly_price_shape(price: BillingPriceShape) -> str | None:
    if price.currency != "usd":
        return "Pro monthly price must be USD."
    if price.unit_amount != PRO_SEAT_MONTHLY_AMOUNT_CENTS:
        return "Pro monthly price must be $20/month."
    if price.recurring_interval != "month":
        return "Pro price must recur monthly."
    return None


def validate_managed_cloud_overage_price_shape(
    price: BillingPriceShape,
    *,
    meter_id: str,
) -> str | None:
    if price.currency != "usd":
        return "Overage price must be USD."
    if price.unit_amount != 1:
        return "Overage price must be 1 cent per unit."
    if price.recurring_interval != "month":
        return "Overage price must recur monthly."
    if price.recurring_usage_type != "metered":
        return "Overage price must be a metered recurring price."
    if meter_id and price.recurring_meter != meter_id:
        return "Overage price must use the configured managed cloud meter."
    return None


def validate_refill_price_shape(price: BillingPriceShape) -> str | None:
    if price.unit_amount != REFILL_10H_AMOUNT_CENTS:
        return "Refill price must be $20."
    return None
