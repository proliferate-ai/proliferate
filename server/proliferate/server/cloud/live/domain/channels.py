"""Cloud live stream channel names."""

from __future__ import annotations

from uuid import UUID


def session_channel(*, target_id: UUID, session_id: str) -> str:
    return f"session:{target_id}:{session_id}"


def workspace_channel(*, workspace_id: UUID) -> str:
    return f"workspace:{workspace_id}"


def target_channel(*, target_id: UUID) -> str:
    return f"target:{target_id}"


def worker_control_channel(*, target_id: UUID) -> str:
    return f"worker-control:{target_id}"
