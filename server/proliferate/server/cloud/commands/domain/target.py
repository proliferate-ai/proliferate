"""Pure target predicates for Cloud commands."""

from __future__ import annotations

from datetime import datetime
from typing import Protocol
from uuid import UUID


class CommandTarget(Protocol):
    kind: str
    sandbox_profile_id: UUID | None
    profile_target_role: str | None
    archived_at: datetime | None


def target_requires_cloud_workspace(target: CommandTarget) -> bool:
    return (
        target.kind == "managed_cloud"
        and target.sandbox_profile_id is not None
        and target.profile_target_role == "primary"
        and target.archived_at is None
    )
