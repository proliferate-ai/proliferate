"""Pure billing policy helpers for the Pro billing rollout."""

from __future__ import annotations

from dataclasses import dataclass

from proliferate.config import settings
from proliferate.constants.billing import (
    PRO_ACTIVE_ENVIRONMENTS_PER_SEAT,
    PRO_DEFAULT_OVERAGE_CAP_CENTS_PER_SEAT,
    PRO_FREE_ACTIVE_ENVIRONMENT_LIMIT,
    PRO_INCLUDED_MANAGED_CLOUD_HOURS_PER_SEAT,
    PRO_OVERAGE_PRICE_PER_HOUR_CENTS,
    PRO_REPO_ENVIRONMENTS_PER_SEAT,
)


@dataclass(frozen=True)
class BillingPlanPolicy:
    pro_billing_enabled: bool
    billable_seat_count: int
    included_managed_cloud_hours: float | None
    managed_cloud_overage_cap_cents: int | None
    overage_price_per_hour_cents: int
    active_environment_limit: int | None
    repo_environment_limit: int | None
    byo_runtime_allowed: bool


def hosted_product_mode() -> bool:
    return settings.telemetry_mode == "hosted_product"


def free_v2_policy() -> BillingPlanPolicy:
    return BillingPlanPolicy(
        pro_billing_enabled=settings.pro_billing_enabled,
        billable_seat_count=0,
        included_managed_cloud_hours=None,
        managed_cloud_overage_cap_cents=0,
        overage_price_per_hour_cents=PRO_OVERAGE_PRICE_PER_HOUR_CENTS,
        active_environment_limit=PRO_FREE_ACTIVE_ENVIRONMENT_LIMIT,
        repo_environment_limit=settings.cloud_free_repo_limit,
        byo_runtime_allowed=False,
    )


def pro_policy(
    *,
    billable_seat_count: int,
    overage_cap_cents_per_seat: int | None,
    byo_runtime_allowed: bool = True,
) -> BillingPlanPolicy:
    seats = max(billable_seat_count, 1)
    cap_per_seat = (
        PRO_DEFAULT_OVERAGE_CAP_CENTS_PER_SEAT
        if overage_cap_cents_per_seat is None
        else max(int(overage_cap_cents_per_seat), 0)
    )
    return BillingPlanPolicy(
        pro_billing_enabled=settings.pro_billing_enabled,
        billable_seat_count=seats,
        included_managed_cloud_hours=PRO_INCLUDED_MANAGED_CLOUD_HOURS_PER_SEAT * seats,
        managed_cloud_overage_cap_cents=cap_per_seat * seats,
        overage_price_per_hour_cents=PRO_OVERAGE_PRICE_PER_HOUR_CENTS,
        active_environment_limit=PRO_ACTIVE_ENVIRONMENTS_PER_SEAT * seats,
        repo_environment_limit=PRO_REPO_ENVIRONMENTS_PER_SEAT * seats,
        byo_runtime_allowed=hosted_product_mode() and byo_runtime_allowed,
    )


def unlimited_numeric_policy(*, byo_runtime_allowed: bool) -> BillingPlanPolicy:
    return BillingPlanPolicy(
        pro_billing_enabled=settings.pro_billing_enabled,
        billable_seat_count=1,
        included_managed_cloud_hours=None,
        managed_cloud_overage_cap_cents=None,
        overage_price_per_hour_cents=PRO_OVERAGE_PRICE_PER_HOUR_CENTS,
        active_environment_limit=None,
        repo_environment_limit=None,
        byo_runtime_allowed=hosted_product_mode() and byo_runtime_allowed,
    )
