"""Pure provider lifecycle event classification."""

from __future__ import annotations

from datetime import datetime

from proliferate.constants.billing import PROVIDER_EVENT_KIND_PRECEDENCE


def provider_event_kind(event_type: str) -> str | None:
    suffix = event_type.removeprefix("sandbox.lifecycle.")
    if suffix in PROVIDER_EVENT_KIND_PRECEDENCE:
        return suffix
    return None


def is_stale_provider_event(
    *,
    last_event_at: datetime | None,
    last_event_kind: str | None,
    incoming_event_at: datetime,
    incoming_event_kind: str,
) -> bool:
    if last_event_at is None:
        return False
    if incoming_event_at < last_event_at:
        return True
    if incoming_event_at > last_event_at:
        return False
    return PROVIDER_EVENT_KIND_PRECEDENCE.get(
        incoming_event_kind, 0
    ) <= PROVIDER_EVENT_KIND_PRECEDENCE.get(last_event_kind or "", 0)
