"""Pure billing price classification rules."""

from __future__ import annotations

from dataclasses import dataclass

from proliferate.constants.billing import (
    BILLING_PRICE_CLASS_LEGACY_CLOUD,
    BILLING_PRICE_CLASS_PRO,
    BILLING_PRICE_CLASS_UNKNOWN,
)

BillingPriceClass = str


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
