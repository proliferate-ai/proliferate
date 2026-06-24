"""Transaction helpers for cloud repo config side effects."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db import engine as db_engine


def defer_repo_config_after_commit(
    db: AsyncSession,
    callback: Callable[[], Awaitable[None]],
) -> None:
    db_engine.defer_after_commit(db, callback)


async def run_with_fresh_repo_config_session(
    callback: Callable[[AsyncSession], Awaitable[None]],
) -> None:
    async with db_engine.async_session_factory() as fresh_db:
        await callback(fresh_db)
        await db_engine.commit_session(fresh_db)
