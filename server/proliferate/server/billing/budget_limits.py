"""Pure budget-limit resolution + calendar-window math (no DB).

Compute limits are enforced in two places (spec §4.2/§4.3): the 15-min
reconciler pass (``reconciler._resolve_compute_limit_pause``) pauses open
segments, and the live start/resume gate
(``authorization.assert_cloud_sandbox_resume_allowed``, wired into
``connect_ready_sandbox``) denies waking a paused-for-billing sandbox. The
orphaned ``authorize_sandbox_start`` (dead since #823) is kept only as the
semantic reference; the resume gate is the real seam.
"""

from __future__ import annotations

from collections.abc import Sequence
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


def bucket_starts(granularity: str, start: datetime, end: datetime) -> list[datetime]:
    """Calendar bucket boundaries covering ``[start, end)``, UTC.

    Mirrors Postgres ``date_trunc(granularity, ...)`` semantics so this can
    zero-fill the buckets the store's ``date_trunc``-grouped queries return:
    ``day`` buckets at UTC midnight, ``week`` at UTC Monday midnight (ISO week,
    same as ``date_trunc('week', ...)``), ``month`` at the first of the UTC
    calendar month.
    """
    at_start = start.astimezone(UTC) if start.tzinfo is not None else start.replace(tzinfo=UTC)
    at_end = end.astimezone(UTC) if end.tzinfo is not None else end.replace(tzinfo=UTC)

    if granularity == "day":
        cursor = at_start.replace(hour=0, minute=0, second=0, microsecond=0)
        step = timedelta(days=1)
    elif granularity == "week":
        day_start = at_start.replace(hour=0, minute=0, second=0, microsecond=0)
        cursor = day_start - timedelta(days=day_start.weekday())
        step = timedelta(weeks=1)
    elif granularity == "month":
        cursor = at_start.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        step = None
    else:
        raise ValueError(f"Unsupported bucket granularity: {granularity!r}")

    buckets: list[datetime] = []
    while cursor < at_end:
        buckets.append(cursor)
        if step is not None:
            cursor = cursor + step
        elif cursor.month == 12:
            cursor = cursor.replace(year=cursor.year + 1, month=1)
        else:
            cursor = cursor.replace(month=cursor.month + 1)
    return buckets


def resolve_effective_limit(
    limits: Sequence[_LimitLike],
    *,
    user_id: UUID,
    kind: str,
) -> EffectiveLimit | None:
    """Pick the tightest enabled limit that applies to ``user_id`` for ``kind``.

    A per-user row applies to that user; an org-wide row (``user_id IS NULL``)
    applies to everyone. When both a per-user and an org-wide limit exist the
    per-user row wins only when it is tighter (lower cap); otherwise the
    org-wide row binds.

    Display-only: comparing raw ``cap_value`` across rows that may have
    different ``window`` (day vs. month) is not meaningful for enforcement —
    a lower monthly cap can still bind before a higher-valued daily cap. Do
    not use this to decide whether a subject is over cap; enforcement must
    check every applicable enabled limit independently against its own
    window's spend (see ``_enforce_org_llm_limits`` in
    ``cloud/agent_gateway/usage_import.py`` and ``_resolve_compute_limit_pause``
    in ``billing/reconciler.py``). This helper is for single-value
    summary/display surfaces only (``billing/usage.py``,
    ``organizations/usage/service.py``).
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
