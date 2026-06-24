"""Transaction helpers for managed sandbox orchestration."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db import session_ops


async def commit_managed_sandbox_session(db: AsyncSession) -> None:
    await session_ops.commit_session(db)
