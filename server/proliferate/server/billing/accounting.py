"""Billing accounting orchestration helpers.

Database transactions, locks, cursor mutation, grant mutation, and export rows
remain owned by ``db.store.billing``. This module exists so service code can
compose accounting decisions without becoming another persistence layer.
"""

from __future__ import annotations

import math

from proliferate.constants.billing import PRO_OVERAGE_PRICE_PER_HOUR_CENTS


def overage_seconds_to_cents(seconds: float, *, fractional_cents: float) -> tuple[int, float]:
    raw_cents = max(fractional_cents, 0.0) + (
        max(seconds, 0.0) * PRO_OVERAGE_PRICE_PER_HOUR_CENTS / 3600.0
    )
    whole_cents = math.floor(raw_cents)
    return whole_cents, max(raw_cents - whole_cents, 0.0)
