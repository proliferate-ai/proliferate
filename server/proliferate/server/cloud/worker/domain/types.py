"""Pure worker domain types."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID


@dataclass(frozen=True)
class WorkerAuthContext:
    worker_id: UUID
    target_id: UUID
