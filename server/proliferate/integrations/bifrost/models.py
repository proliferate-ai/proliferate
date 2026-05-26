"""Typed Bifrost integration payloads."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any


@dataclass(frozen=True)
class BifrostProviderKeyResult:
    key_id: str
    provider: str
    name: str | None


@dataclass(frozen=True)
class BifrostVirtualKeyResult:
    virtual_key_id: str
    virtual_key: str | None
    name: str | None
    is_active: bool


@dataclass(frozen=True)
class BifrostLogEntry:
    log_id: str
    timestamp: datetime | None
    provider: str | None
    model: str | None
    status: str | None
    cost: Decimal | None
    selected_key_id: str | None
    virtual_key_id: str | None
    token_usage: dict[str, Any]
    raw: dict[str, Any]


@dataclass(frozen=True)
class BifrostLogSearchResult:
    logs: tuple[BifrostLogEntry, ...]
    total_count: int | None
