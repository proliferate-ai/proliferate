"""Typed Stripe payload models exposed by the integration."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class StripeUrlResponse:
    url: str
    id: str | None = None


@dataclass(frozen=True)
class StripePriceDetails:
    currency: str | None
    unit_amount: int | None
    recurring_interval: str | None
    recurring_usage_type: str | None
    recurring_meter: str | None


@dataclass(frozen=True)
class StripeSignature:
    timestamp: int
    signatures: tuple[str, ...]


@dataclass(frozen=True)
class StripeWebhookEvent:
    event_id: str
    event_type: str
    livemode: bool | None
    payload: dict[str, Any]
    data_object: dict[str, Any]
