"""Request transaction boundaries for integration provider operations."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db import session_ops


async def release_integration_transaction(db: AsyncSession) -> None:
    """Commit a durable lifecycle phase and release its connection before provider I/O."""

    await session_ops.commit_session(db)
