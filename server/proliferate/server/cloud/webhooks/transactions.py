"""Transaction boundaries for provider webhook orchestration."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db import session_ops


async def commit_webhook_phase(db: AsyncSession) -> None:
    """Commit one completed database phase before lock or provider I/O."""

    await session_ops.commit_session(db)
