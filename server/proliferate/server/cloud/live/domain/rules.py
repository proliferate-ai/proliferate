"""Pure rules for cloud live stream cursors."""

from __future__ import annotations


def clamp_live_cursor(value: int) -> int:
    return max(0, value)
