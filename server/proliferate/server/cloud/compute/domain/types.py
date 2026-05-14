"""Internal types for cloud compute operational decisions."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SafeStopVerdict:
    allowed: bool
    reasons: tuple[str, ...]
