"""Pure Stripe webhook payload extraction helpers."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from proliferate.constants.billing import (
    BILLING_PRICE_CLASS_LEGACY_CLOUD,
    BILLING_PRICE_CLASS_PRO,
)
from proliferate.server.billing.domain.pricing import (
    BillingPriceIds,
    classify_monthly_price_id,
)

LOCAL_TEST_CLOUD_PRICE_LOOKUP_KEY = "proliferate_pro_monthly_test"


@dataclass(frozen=True)
class SubscriptionItemDetails:
    monthly_item_id: str | None
    metered_item_id: str | None
    monthly_price_id: str | None
    overage_price_id: str | None
    seat_quantity: int | None


def event_object(event: dict[str, Any]) -> dict[str, Any]:
    data = event.get("data")
    if not isinstance(data, dict):
        return {}
    stripe_object = data.get("object")
    return stripe_object if isinstance(stripe_object, dict) else {}


def metadata(stripe_object: dict[str, Any]) -> dict[str, str]:
    raw_metadata = stripe_object.get("metadata")
    if not isinstance(raw_metadata, dict):
        return {}
    return {key: value for key, value in raw_metadata.items() if isinstance(value, str)}


def subscription_parent_metadata(stripe_object: dict[str, Any]) -> dict[str, str]:
    parent = stripe_object.get("parent")
    if not isinstance(parent, dict):
        return {}
    subscription_details = parent.get("subscription_details")
    if not isinstance(subscription_details, dict):
        return {}
    raw_metadata = subscription_details.get("metadata")
    if not isinstance(raw_metadata, dict):
        return {}
    return {key: value for key, value in raw_metadata.items() if isinstance(value, str)}


def datetime_from_timestamp(value: object) -> datetime | None:
    if not isinstance(value, int | float):
        return None
    return datetime.fromtimestamp(value, tz=UTC)


def id_from_expandable(value: object) -> str | None:
    if isinstance(value, str):
        return value
    if isinstance(value, dict) and isinstance(value.get("id"), str):
        return value["id"]
    return None


def line_price_id(line: dict[str, Any]) -> str | None:
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


def price_matches(line: dict[str, Any], *, price_id: str, lookup_key: str | None = None) -> bool:
    if line_price_id(line) == price_id:
        return True
    price = line.get("price")
    if not isinstance(price, dict):
        return False
    return bool(lookup_key and price.get("lookup_key") == lookup_key)


def line_items_from_object(stripe_object: dict[str, Any]) -> list[dict[str, Any]]:
    lines = stripe_object.get("lines")
    if isinstance(lines, dict) and isinstance(lines.get("data"), list):
        return [line for line in lines["data"] if isinstance(line, dict)]
    return []


def line_subscription_id(line: dict[str, Any]) -> str | None:
    parent = line.get("parent")
    if not isinstance(parent, dict):
        return None
    subscription_item_details = parent.get("subscription_item_details")
    if not isinstance(subscription_item_details, dict):
        return None
    subscription_id = subscription_item_details.get("subscription")
    return subscription_id if isinstance(subscription_id, str) else None


def invoice_subscription_id(invoice: dict[str, Any], lines: list[dict[str, Any]]) -> str | None:
    subscription_id = id_from_expandable(invoice.get("subscription"))
    if subscription_id is not None:
        return subscription_id
    parent = invoice.get("parent")
    if isinstance(parent, dict):
        subscription_details = parent.get("subscription_details")
        if isinstance(subscription_details, dict):
            subscription_id = id_from_expandable(subscription_details.get("subscription"))
            if subscription_id is not None:
                return subscription_id
    for line in lines:
        subscription_id = line_subscription_id(line)
        if subscription_id is not None:
            return subscription_id
    return None


def line_is_cloud_subscription(
    line: dict[str, Any],
    *,
    pro_billing_enabled: bool,
    cloud_monthly_price_id: str,
    price_ids: BillingPriceIds,
    local_test_lookup_key: str = LOCAL_TEST_CLOUD_PRICE_LOOKUP_KEY,
) -> bool:
    price_id = line_price_id(line)
    if pro_billing_enabled:
        return classify_monthly_price_id(price_id, price_ids=price_ids) in {
            BILLING_PRICE_CLASS_PRO,
            BILLING_PRICE_CLASS_LEGACY_CLOUD,
        }
    return price_matches(
        line,
        price_id=cloud_monthly_price_id,
        lookup_key=local_test_lookup_key,
    )


def subscription_item_details(
    subscription: dict[str, Any],
    *,
    monthly_price_ids: frozenset[str],
    overage_price_ids: frozenset[str],
) -> SubscriptionItemDetails:
    items = subscription.get("items")
    data = items.get("data") if isinstance(items, dict) else None
    monthly_item_id: str | None = None
    metered_item_id: str | None = None
    monthly_price_id: str | None = None
    overage_price_id: str | None = None
    seat_quantity: int | None = None
    if not isinstance(data, list):
        return SubscriptionItemDetails(
            monthly_item_id=monthly_item_id,
            metered_item_id=metered_item_id,
            monthly_price_id=monthly_price_id,
            overage_price_id=overage_price_id,
            seat_quantity=seat_quantity,
        )
    for item in data:
        if not isinstance(item, dict):
            continue
        item_id = item.get("id") if isinstance(item.get("id"), str) else None
        price = item.get("price")
        if not isinstance(price, dict):
            continue
        price_id = price.get("id") if isinstance(price.get("id"), str) else None
        if price_id in monthly_price_ids:
            monthly_item_id = item_id
            monthly_price_id = price_id
            quantity = item.get("quantity")
            seat_quantity = int(quantity) if isinstance(quantity, int | float) else None
        if price_id in overage_price_ids:
            metered_item_id = item_id
            overage_price_id = price_id
    return SubscriptionItemDetails(
        monthly_item_id=monthly_item_id,
        metered_item_id=metered_item_id,
        monthly_price_id=monthly_price_id,
        overage_price_id=overage_price_id,
        seat_quantity=seat_quantity,
    )


def subscription_period(
    subscription: dict[str, Any],
    *,
    monthly_item_id: str | None,
    metered_item_id: str | None,
) -> tuple[datetime | None, datetime | None]:
    top_level_start = datetime_from_timestamp(subscription.get("current_period_start"))
    top_level_end = datetime_from_timestamp(subscription.get("current_period_end"))
    if top_level_start is not None and top_level_end is not None:
        return top_level_start, top_level_end

    items = subscription.get("items")
    data = items.get("data") if isinstance(items, dict) else None
    if not isinstance(data, list):
        return None, None

    preferred_item_ids = [item_id for item_id in (monthly_item_id, metered_item_id) if item_id]
    for preferred_item_id in preferred_item_ids:
        for item in data:
            if not isinstance(item, dict) or item.get("id") != preferred_item_id:
                continue
            return (
                datetime_from_timestamp(item.get("current_period_start")),
                datetime_from_timestamp(item.get("current_period_end")),
            )

    for item in data:
        if not isinstance(item, dict):
            continue
        return (
            datetime_from_timestamp(item.get("current_period_start")),
            datetime_from_timestamp(item.get("current_period_end")),
        )
    return None, None
