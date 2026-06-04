"""Database session helpers for non-HTTP entrypoints.

Product services that call these helpers still own session or transaction boundaries; those
calls are explicit boundary-check debt until moved to API, worker, or other entrypoint code.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db import engine as db_engine

type AfterCommitCallback = Callable[[], Awaitable[None]]


@asynccontextmanager
async def open_async_session() -> AsyncIterator[AsyncSession]:
    db = db_engine.async_session_factory()
    try:
        yield db
    except BaseException:
        await db_engine.rollback_session(db)
        raise
    finally:
        await db_engine.close_session(db)


@asynccontextmanager
async def open_async_transaction() -> AsyncIterator[AsyncSession]:
    db = db_engine.async_session_factory()
    try:
        async with db.begin():
            yield db
    except BaseException:
        await db_engine.rollback_session(db)
        raise
    finally:
        await db_engine.close_session(db)


async def commit_session(db: AsyncSession) -> None:
    await db_engine.commit_session(db)


async def rollback_session(db: AsyncSession) -> None:
    await db_engine.rollback_session(db)


async def run_after_commit(
    db: AsyncSession,
    callback: AfterCommitCallback,
) -> None:
    await db_engine.run_after_commit(db, callback)


def defer_after_commit(
    db: AsyncSession,
    callback: AfterCommitCallback,
) -> None:
    db_engine.defer_after_commit(db, callback)


def is_integrity_error(error: BaseException) -> bool:
    return isinstance(error, IntegrityError)
