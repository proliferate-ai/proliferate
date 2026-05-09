"""Pure billing grant, accounting, and usage-export planners."""

from __future__ import annotations

import math
from datetime import datetime
from enum import StrEnum
from typing import Protocol
from uuid import UUID

from proliferate.constants.billing import (
    BILLING_PRICE_CLASS_PRO,
    FREE_INCLUDED_GRANT_TYPE,
    FREE_TRIAL_V2_GRANT_TYPE,
    MONTHLY_CLOUD_GRANT_TYPE,
    PRO_OVERAGE_PRICE_PER_HOUR_CENTS,
    PRO_PERIOD_GRANT_TYPE,
    PRO_SEAT_PRORATION_GRANT_TYPE,
    REFILL_10H_GRANT_TYPE,
    STRIPE_METER_EVENT_MAX_FUTURE_SECONDS,
    STRIPE_METER_EVENT_MAX_PAST_SECONDS,
)
from proliferate.server.billing.domain.plans import coerce_utc_datetime
from proliferate.server.billing.domain.pricing import (
    BillingPriceIds,
    classify_monthly_price_id,
)


class AccountingGrantLike(Protocol):
    grant_type: str
    remaining_seconds: float
    effective_at: datetime | None
    expires_at: datetime | None
    created_at: datetime


class AccountingSubscriptionLike(Protocol):
    status: str
    cloud_monthly_price_id: str | None
    current_period_start: datetime | None
    current_period_end: datetime | None
    updated_at: datetime


class GrantKind(StrEnum):
    FREE = FREE_INCLUDED_GRANT_TYPE
    FREE_TRIAL_V2 = FREE_TRIAL_V2_GRANT_TYPE
    MONTHLY = MONTHLY_CLOUD_GRANT_TYPE
    PRO_PERIOD = PRO_PERIOD_GRANT_TYPE
    PRO_SEAT_PRORATION = PRO_SEAT_PRORATION_GRANT_TYPE
    REFILL = REFILL_10H_GRANT_TYPE


def overage_seconds_to_cents(seconds: float, *, fractional_cents: float) -> tuple[int, float]:
    raw_cents = max(fractional_cents, 0.0) + (
        max(seconds, 0.0) * PRO_OVERAGE_PRICE_PER_HOUR_CENTS / 3600.0
    )
    whole_cents = math.floor(raw_cents)
    return whole_cents, max(raw_cents - whole_cents, 0.0)


def grant_boundary_after(
    start: datetime,
    end: datetime,
    grant: AccountingGrantLike,
) -> datetime | None:
    effective_at = coerce_utc_datetime(grant.effective_at)
    expires_at = coerce_utc_datetime(grant.expires_at)
    if effective_at is not None and start < effective_at < end:
        return effective_at
    if expires_at is not None and start < expires_at < end:
        return expires_at
    return None


def next_accounting_boundary(
    start: datetime,
    end: datetime,
    grants: list[AccountingGrantLike],
    extra_boundaries: tuple[datetime, ...] = (),
) -> datetime:
    boundary = end
    for grant in grants:
        grant_boundary = grant_boundary_after(start, end, grant)
        if grant_boundary is not None and grant_boundary < boundary:
            boundary = grant_boundary
    for extra_boundary in extra_boundaries:
        if start < extra_boundary < boundary:
            boundary = extra_boundary
    return boundary


def grant_is_usable_for_accounting(grant: AccountingGrantLike, at: datetime) -> bool:
    if grant.remaining_seconds <= 0:
        return False
    effective_at = coerce_utc_datetime(grant.effective_at) or at
    expires_at = coerce_utc_datetime(grant.expires_at)
    return effective_at <= at and (expires_at is None or expires_at > at)


def ordered_accounting_grants[GrantT: AccountingGrantLike](
    grants: list[GrantT],
    *,
    pro_billing_enabled: bool,
    is_paid_cloud: bool,
    at: datetime,
) -> list[GrantT]:
    if pro_billing_enabled and is_paid_cloud:
        grant_type_order = {
            GrantKind.PRO_PERIOD: 0,
            GrantKind.PRO_SEAT_PRORATION: 1,
            GrantKind.REFILL: 2,
        }
    elif pro_billing_enabled:
        grant_type_order = {
            GrantKind.FREE_TRIAL_V2: 0,
            GrantKind.REFILL: 1,
        }
    elif is_paid_cloud:
        grant_type_order = {
            GrantKind.MONTHLY: 0,
            GrantKind.FREE: 1,
            GrantKind.REFILL: 2,
        }
    else:
        grant_type_order = {
            GrantKind.FREE: 0,
            GrantKind.REFILL: 1,
        }

    eligible = [
        grant
        for grant in grants
        if grant.grant_type in grant_type_order and grant_is_usable_for_accounting(grant, at)
    ]
    return sorted(
        eligible,
        key=lambda grant: (
            grant_type_order[GrantKind(grant.grant_type)],
            coerce_utc_datetime(grant.expires_at) or datetime.max.replace(tzinfo=at.tzinfo),
            coerce_utc_datetime(grant.effective_at) or datetime.min.replace(tzinfo=at.tzinfo),
            grant.created_at,
        ),
    )


def usage_export_idempotency_key(
    *,
    billing_subject_id: UUID,
    usage_segment_id: UUID,
    accounted_from: datetime,
    accounted_until: datetime,
) -> str:
    return (
        f"stripe:usage:{billing_subject_id}:{usage_segment_id}:"
        f"{accounted_from.isoformat()}:{accounted_until.isoformat()}"
    )


def active_pro_period_start(
    subscriptions: list[AccountingSubscriptionLike],
    *,
    now: datetime,
    price_ids: BillingPriceIds,
) -> datetime | None:
    active_periods: list[tuple[datetime, datetime, datetime]] = []
    for subscription in subscriptions:
        if (
            subscription.status not in {"active", "trialing"}
            or classify_monthly_price_id(
                subscription.cloud_monthly_price_id,
                price_ids=price_ids,
            )
            != BILLING_PRICE_CLASS_PRO
            or subscription.current_period_start is None
        ):
            continue
        period_start = coerce_utc_datetime(subscription.current_period_start)
        if period_start is None:
            continue
        period_end = coerce_utc_datetime(subscription.current_period_end) or datetime.max.replace(
            tzinfo=period_start.tzinfo,
        )
        if period_end < now:
            continue
        active_periods.append(
            (
                period_end,
                coerce_utc_datetime(subscription.updated_at)
                or datetime.min.replace(tzinfo=period_start.tzinfo),
                period_start,
            )
        )
    if not active_periods:
        return None
    return max(active_periods)[2]


def stripe_status_is_terminal(status_code: int) -> bool:
    return 400 <= status_code < 500 and status_code != 429


def terminal_meter_event_error(accounted_until: datetime, *, now: datetime) -> str | None:
    event_time = coerce_utc_datetime(accounted_until) or now
    if (now - event_time).total_seconds() > STRIPE_METER_EVENT_MAX_PAST_SECONDS:
        return "Stripe meter events cannot be created for usage older than 35 days."
    if (event_time - now).total_seconds() > STRIPE_METER_EVENT_MAX_FUTURE_SECONDS:
        return "Stripe meter events cannot be created more than 5 minutes in the future."
    return None


def usage_export_identifier(export_id: UUID) -> str:
    return f"usage_export:{export_id}"
