"""Pure budget-limit resolution + calendar-window math (no DB).

Enforcement gap (spec §4.3): compute limits are enforced only by the 15-min
reconciler pass, not at sandbox-start. ``authorize_sandbox_start`` is orphaned
(no callers on main since #823) and no clean start/resume seam exists in the
managed-sandbox stack, so we do not invent a start-side call chain here.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Protocol
from uuid import UUID

BUDGET_LIMIT_KINDS = ("compute", "llm")
BUDGET_LIMIT_WINDOWS = ("day", "month")


class _LimitLike(Protocol):
    user_id: UUID | None
    kind: str
    window: str
    cap_value: object
    enabled: bool


@dataclass(frozen=True)
class EffectiveLimit:
    """The single limit that binds a user for one kind (for display/summary)."""

    user_id: UUID | None
    kind: str
    window: str
    cap_value: float


def window_bounds(window: str, now: datetime) -> tuple[datetime, datetime]:
    """Return the ``[start, end)`` calendar bounds (UTC) covering ``now``.

    ``day`` is the UTC calendar day; ``month`` is the UTC calendar month.
    """
    at = now.astimezone(UTC) if now.tzinfo is not None else now.replace(tzinfo=UTC)
    if window == "day":
        start = at.replace(hour=0, minute=0, second=0, microsecond=0)
        return start, start + timedelta(days=1)
    if window == "month":
        start = at.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        if start.month == 12:
            end = start.replace(year=start.year + 1, month=1)
        else:
            end = start.replace(month=start.month + 1)
        return start, end
    raise ValueError(f"Unsupported budget window: {window!r}")


def resolve_effective_limit(
    limits: list[_LimitLike],
    *,
    user_id: UUID,
    kind: str,
) -> EffectiveLimit | None:
    """Pick the tightest enabled limit that applies to ``user_id`` for ``kind``.

    A per-user row applies to that user; an org-wide row (``user_id IS NULL``)
    applies to everyone. When both a per-user and an org-wide limit exist the
    per-user row wins only when it is tighter (lower cap); otherwise the
    org-wide row binds.
    """
    applicable = [
        limit
        for limit in limits
        if limit.enabled
        and limit.kind == kind
        and (limit.user_id is None or limit.user_id == user_id)
    ]
    if not applicable:
        return None

    def _tightest(rows: list[_LimitLike]) -> _LimitLike | None:
        return min(rows, key=lambda row: float(row.cap_value)) if rows else None

    user_row = _tightest([limit for limit in applicable if limit.user_id == user_id])
    org_row = _tightest([limit for limit in applicable if limit.user_id is None])

    if user_row is not None and org_row is not None:
        chosen = user_row if float(user_row.cap_value) <= float(org_row.cap_value) else org_row
    else:
        chosen = user_row or org_row

    assert chosen is not None
    return EffectiveLimit(
        user_id=chosen.user_id,
        kind=chosen.kind,
        window=chosen.window,
        cap_value=float(chosen.cap_value),
    )
