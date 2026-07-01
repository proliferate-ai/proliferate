"""Transaction helpers for cloud sandbox orchestration."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db import session_ops


async def run_with_fresh_session(
    callback: Callable[[AsyncSession], Awaitable[None]],
) -> None:
    async with session_ops.open_async_session() as fresh_db:
        await callback(fresh_db)
        await session_ops.commit_session(fresh_db)


def defer_after_commit(
    db: AsyncSession,
    callback: Callable[[], Awaitable[None]],
) -> None:
    session_ops.defer_after_commit(db, callback)


async def commit_cloud_sandbox_session(db: AsyncSession) -> None:
    await session_ops.commit_session(db)
