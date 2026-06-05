"""Command wake scheduling helpers."""

from __future__ import annotations

from collections.abc import Callable
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db import session_ops as db_session

type ManagedTargetWake = Callable[[UUID, UUID | None], None]


async def schedule_managed_target_wake_after_commit(
    db: AsyncSession,
    *,
    target_id: UUID,
    command_id: UUID,
    wake: ManagedTargetWake,
) -> None:
    async def _wake_after_commit() -> None:
        wake(target_id, command_id)

    await db_session.run_after_commit(db, _wake_after_commit)
