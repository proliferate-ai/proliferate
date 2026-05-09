"""Pure billing entitlement, hold, and subscription rules."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol

from proliferate.constants.billing import (
    BILLING_HOLD_KIND_ADMIN_HOLD,
    BILLING_HOLD_KIND_EXTERNAL_BILLING_HOLD,
    BILLING_HOLD_KIND_PAYMENT_FAILED,
    BILLING_MODE_OFF,
    BILLING_PERIOD_ROLLOVER_GRACE_SECONDS,
    BILLING_PRICE_CLASS_LEGACY_CLOUD,
    BILLING_PRICE_CLASS_PRO,
    FREE_INCLUDED_GRANT_TYPE,
    FREE_TRIAL_V2_GRANT_TYPE,
    MONTHLY_CLOUD_GRANT_TYPE,
    PRO_PERIOD_GRANT_TYPE,
    PRO_SEAT_PRORATION_GRANT_TYPE,
    REFILL_10H_GRANT_TYPE,
    UNLIMITED_CLOUD_ENTITLEMENT,
    WORKSPACE_ACTION_BLOCK_KIND_ADMIN_HOLD,
    WORKSPACE_ACTION_BLOCK_KIND_CAP_EXHAUSTED,
    WORKSPACE_ACTION_BLOCK_KIND_CONCURRENCY_LIMIT,
    WORKSPACE_ACTION_BLOCK_KIND_CREDITS_EXHAUSTED,
    WORKSPACE_ACTION_BLOCK_KIND_EXTERNAL_BILLING_HOLD,
    WORKSPACE_ACTION_BLOCK_KIND_OVERAGE_DISABLED,
    WORKSPACE_ACTION_BLOCK_KIND_PAYMENT_FAILED,
)
from proliferate.server.billing.domain.pricing import (
    BillingPriceIds,
    classify_monthly_price_id,
)

HEALTHY_STRIPE_SUBSCRIPTION_STATUSES: frozenset[str] = frozenset({"active", "trialing"})
ACTIVE_HOLD_REASONS: Mapping[str, str] = {
    BILLING_HOLD_KIND_PAYMENT_FAILED: WORKSPACE_ACTION_BLOCK_KIND_PAYMENT_FAILED,
    BILLING_HOLD_KIND_ADMIN_HOLD: WORKSPACE_ACTION_BLOCK_KIND_ADMIN_HOLD,
    BILLING_HOLD_KIND_EXTERNAL_BILLING_HOLD: WORKSPACE_ACTION_BLOCK_KIND_EXTERNAL_BILLING_HOLD,
}


class GrantLike(Protocol):
    grant_type: str
    effective_at: datetime | None
    expires_at: datetime | None
    hours_granted: float
    remaining_seconds: float


class EntitlementLike(Protocol):
    kind: str
    effective_at: datetime | None
    expires_at: datetime | None
    created_at: datetime


class HoldLike(Protocol):
    kind: str


class SubscriptionLike(Protocol):
    status: str
    cloud_monthly_price_id: str | None
    current_period_start: datetime | None
    current_period_end: datetime | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class BillingPlanRuleConfig:
    pro_billing_enabled: bool
    cloud_monthly_price_id: str
    price_ids: BillingPriceIds
    period_rollover_grace_seconds: int = BILLING_PERIOD_ROLLOVER_GRACE_SECONDS


@dataclass(frozen=True)
class UnlimitedCloudHoursState:
    subscription: SubscriptionLike | None
    manual_entitlement: EntitlementLike | None
    has_unlimited_cloud_hours: bool
    unlimited_window_start: datetime | None
    legacy_cloud_subscription: bool


def coerce_utc_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def grant_is_active(grant: GrantLike, now: datetime) -> bool:
    effective_at = coerce_utc_datetime(grant.effective_at) or now
    expires_at = coerce_utc_datetime(grant.expires_at)
    return effective_at <= now and (expires_at is None or expires_at > now)


def entitlement_is_active(entitlement: EntitlementLike, now: datetime) -> bool:
    effective_at = coerce_utc_datetime(entitlement.effective_at) or now
    expires_at = coerce_utc_datetime(entitlement.expires_at)
    return effective_at <= now and (expires_at is None or expires_at > now)


def active_unlimited_cloud_entitlement(
    entitlements: Sequence[EntitlementLike],
    now: datetime,
) -> EntitlementLike | None:
    active_entitlements = [
        entitlement
        for entitlement in entitlements
        if (
            entitlement.kind == UNLIMITED_CLOUD_ENTITLEMENT
            and entitlement_is_active(entitlement, now)
        )
    ]
    if not active_entitlements:
        return None
    return min(
        active_entitlements,
        key=lambda entitlement: (
            coerce_utc_datetime(entitlement.effective_at) or now,
            coerce_utc_datetime(entitlement.created_at) or now,
        ),
    )


def subscription_unlimited_window_start(
    subscription: SubscriptionLike,
    now: datetime,
) -> datetime | None:
    created_at = coerce_utc_datetime(subscription.created_at)
    if created_at is not None and created_at <= now:
        return created_at
    period_start = coerce_utc_datetime(subscription.current_period_start)
    if period_start is not None and period_start <= now:
        return period_start
    return None


def subscription_is_cloud(
    subscription: SubscriptionLike,
    *,
    config: BillingPlanRuleConfig,
) -> bool:
    if not config.pro_billing_enabled:
        configured_price_id = config.cloud_monthly_price_id
        return (
            bool(configured_price_id)
            and subscription.cloud_monthly_price_id == configured_price_id
        )
    return classify_monthly_price_id(
        subscription.cloud_monthly_price_id,
        price_ids=config.price_ids,
    ) in {
        BILLING_PRICE_CLASS_PRO,
        BILLING_PRICE_CLASS_LEGACY_CLOUD,
    }


def subscription_is_pro(
    subscription: SubscriptionLike,
    *,
    config: BillingPlanRuleConfig,
) -> bool:
    return (
        classify_monthly_price_id(
            subscription.cloud_monthly_price_id,
            price_ids=config.price_ids,
        )
        == BILLING_PRICE_CLASS_PRO
    )


def subscription_is_legacy_cloud(
    subscription: SubscriptionLike,
    *,
    config: BillingPlanRuleConfig,
) -> bool:
    if not config.pro_billing_enabled:
        return False
    return (
        classify_monthly_price_id(
            subscription.cloud_monthly_price_id,
            price_ids=config.price_ids,
        )
        == BILLING_PRICE_CLASS_LEGACY_CLOUD
    )


def subscription_is_healthy(
    subscription: SubscriptionLike,
    now: datetime,
    *,
    rollover_grace_seconds: int = BILLING_PERIOD_ROLLOVER_GRACE_SECONDS,
) -> bool:
    if subscription.status not in HEALTHY_STRIPE_SUBSCRIPTION_STATUSES:
        return False
    period_end = coerce_utc_datetime(subscription.current_period_end)
    if period_end is None:
        return True
    grace_end = period_end.timestamp() + rollover_grace_seconds
    return now.timestamp() <= grace_end


def subscription_in_rollover_grace(
    subscription: SubscriptionLike | None,
    now: datetime,
    *,
    rollover_grace_seconds: int = BILLING_PERIOD_ROLLOVER_GRACE_SECONDS,
) -> bool:
    if subscription is None or subscription.status not in HEALTHY_STRIPE_SUBSCRIPTION_STATUSES:
        return False
    period_end = coerce_utc_datetime(subscription.current_period_end)
    if period_end is None or now <= period_end:
        return False
    grace_end = period_end.timestamp() + rollover_grace_seconds
    return now.timestamp() <= grace_end


def latest_healthy_cloud_subscription(
    subscriptions: Sequence[SubscriptionLike],
    now: datetime,
    *,
    config: BillingPlanRuleConfig,
) -> SubscriptionLike | None:
    healthy = [
        subscription
        for subscription in subscriptions
        if subscription_is_cloud(subscription, config=config)
        and subscription_is_healthy(
            subscription,
            now,
            rollover_grace_seconds=config.period_rollover_grace_seconds,
        )
    ]
    if not healthy:
        return None
    return max(
        healthy,
        key=lambda subscription: (
            coerce_utc_datetime(subscription.current_period_end)
            or datetime.min.replace(tzinfo=UTC),
            coerce_utc_datetime(subscription.updated_at) or datetime.min.replace(tzinfo=UTC),
        ),
    )


def compute_unlimited_cloud_hours_state(
    *,
    subscriptions: Sequence[SubscriptionLike],
    entitlements: Sequence[EntitlementLike],
    now: datetime,
    config: BillingPlanRuleConfig,
) -> UnlimitedCloudHoursState:
    subscription = latest_healthy_cloud_subscription(subscriptions, now, config=config)
    manual_entitlement = active_unlimited_cloud_entitlement(entitlements, now)
    legacy_cloud_subscription = subscription is not None and (
        not config.pro_billing_enabled
        or subscription_is_legacy_cloud(subscription, config=config)
    )
    unlimited_boundaries = [
        boundary
        for boundary in (
            (
                subscription_unlimited_window_start(subscription, now)
                if legacy_cloud_subscription and subscription is not None
                else None
            ),
            (
                coerce_utc_datetime(manual_entitlement.effective_at)
                if manual_entitlement is not None
                else None
            ),
        )
        if boundary is not None and boundary <= now
    ]
    return UnlimitedCloudHoursState(
        subscription=subscription,
        manual_entitlement=manual_entitlement,
        has_unlimited_cloud_hours=legacy_cloud_subscription or manual_entitlement is not None,
        unlimited_window_start=min(unlimited_boundaries) if unlimited_boundaries else None,
        legacy_cloud_subscription=legacy_cloud_subscription,
    )


def active_hold_reason(
    holds: Sequence[HoldLike],
    *,
    hold_reasons: Mapping[str, str] = ACTIVE_HOLD_REASONS,
) -> str | None:
    for hold in holds:
        reason = hold_reasons.get(hold.kind)
        if reason is not None:
            return reason
    return None


def grant_applies_to_paid_state(
    grant_type: str,
    *,
    is_paid_cloud: bool,
    pro_billing_enabled: bool,
) -> bool:
    if pro_billing_enabled and is_paid_cloud:
        return grant_type in {
            PRO_PERIOD_GRANT_TYPE,
            PRO_SEAT_PRORATION_GRANT_TYPE,
            REFILL_10H_GRANT_TYPE,
        }
    if pro_billing_enabled:
        return grant_type in {FREE_TRIAL_V2_GRANT_TYPE, REFILL_10H_GRANT_TYPE}
    if is_paid_cloud:
        return grant_type in {
            MONTHLY_CLOUD_GRANT_TYPE,
            FREE_INCLUDED_GRANT_TYPE,
            REFILL_10H_GRANT_TYPE,
        }
    return grant_type in {FREE_INCLUDED_GRANT_TYPE, REFILL_10H_GRANT_TYPE}


def repo_limit_for_billing_state(
    *,
    billing_mode: str,
    pro_billing_enabled: bool,
    is_paid_cloud: bool,
    has_unlimited_cloud_hours: bool,
    repo_environment_limit: int | None,
    paid_cloud_repo_limit: int,
    free_cloud_repo_limit: int,
) -> int | None:
    if billing_mode == BILLING_MODE_OFF:
        return None
    if pro_billing_enabled:
        return repo_environment_limit
    if is_paid_cloud or has_unlimited_cloud_hours:
        return paid_cloud_repo_limit
    return free_cloud_repo_limit


def authorization_message(reason: str | None) -> str | None:
    if reason == WORKSPACE_ACTION_BLOCK_KIND_CONCURRENCY_LIMIT:
        return (
            "Sandbox limit reached. Archive or delete another cloud workspace before "
            "starting a new one."
        )
    if reason == WORKSPACE_ACTION_BLOCK_KIND_CREDITS_EXHAUSTED:
        return "Cloud usage is paused because your included sandbox hours are exhausted."
    if reason == WORKSPACE_ACTION_BLOCK_KIND_OVERAGE_DISABLED:
        return "Cloud usage is paused because included managed cloud hours are exhausted."
    if reason == WORKSPACE_ACTION_BLOCK_KIND_CAP_EXHAUSTED:
        return "Cloud usage is paused because the managed cloud overage cap is exhausted."
    if reason == WORKSPACE_ACTION_BLOCK_KIND_PAYMENT_FAILED:
        return "Cloud usage is paused because billing needs attention."
    if reason == WORKSPACE_ACTION_BLOCK_KIND_ADMIN_HOLD:
        return "Cloud usage is paused for this account."
    if reason == WORKSPACE_ACTION_BLOCK_KIND_EXTERNAL_BILLING_HOLD:
        return "Cloud usage is paused because billing needs attention."
    return None
