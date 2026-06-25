"""In-memory local development handoff helpers."""

from __future__ import annotations

import asyncio
from collections import deque
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import urlparse
from uuid import uuid4

_ALLOWED_HANDOFF_SCHEMES = frozenset({"proliferate", "proliferate-local"})
_HANDOFF_TTL = timedelta(minutes=10)
_MAX_HANDOFFS = 20


@dataclass(frozen=True)
class DevDesktopHandoffRecord:
    id: str
    url: str
    created_at: datetime


_handoffs: deque[DevDesktopHandoffRecord] = deque()
_handoff_lock = asyncio.Lock()


async def enqueue_desktop_handoff(url: str) -> DevDesktopHandoffRecord:
    normalized_url = _validate_desktop_handoff_url(url)
    record = DevDesktopHandoffRecord(
        id=str(uuid4()),
        url=normalized_url,
        created_at=datetime.now(UTC),
    )
    async with _handoff_lock:
        _prune_expired_locked()
        _handoffs.append(record)
        while len(_handoffs) > _MAX_HANDOFFS:
            _handoffs.popleft()
    return record


async def take_desktop_handoff() -> DevDesktopHandoffRecord | None:
    async with _handoff_lock:
        _prune_expired_locked()
        if not _handoffs:
            return None
        return _handoffs.popleft()


def _validate_desktop_handoff_url(url: str) -> str:
    normalized = url.strip()
    parsed = urlparse(normalized)
    if parsed.scheme not in _ALLOWED_HANDOFF_SCHEMES:
        raise ValueError("Unsupported desktop handoff URL.")
    if not parsed.netloc:
        raise ValueError("Desktop handoff URL is missing a route host.")
    return normalized


def _prune_expired_locked() -> None:
    cutoff = datetime.now(UTC) - _HANDOFF_TTL
    while _handoffs and _handoffs[0].created_at <= cutoff:
        _handoffs.popleft()
