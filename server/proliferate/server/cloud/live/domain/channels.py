"""Cloud live stream channel names."""

from __future__ import annotations

from uuid import UUID


def session_channel(*, target_id: UUID, session_id: str) -> str:
    return f"session:{target_id}:{session_id}"
