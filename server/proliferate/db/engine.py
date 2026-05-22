import asyncio
import logging
from collections.abc import AsyncGenerator, Awaitable, Callable
from typing import Annotated, cast

from fastapi import Depends
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import Session

from proliferate.config import settings

engine = create_async_engine(settings.database_url, echo=settings.database_echo)
async_session_factory = async_sessionmaker(engine, expire_on_commit=False)
_AFTER_COMMIT_CALLBACKS_KEY = "proliferate_after_commit_callbacks"
_AFTER_COMMIT_LISTENERS_KEY = "proliferate_after_commit_listeners"
_logger = logging.getLogger(__name__)

type AfterCommitCallback = Callable[[], Awaitable[None]]


async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


AsyncSessionDep = Annotated[AsyncSession, Depends(get_async_session)]


async def commit_session(db: AsyncSession) -> None:
    await db.commit()


async def run_after_commit(db: AsyncSession, callback: AfterCommitCallback) -> None:
    if not db.in_transaction():
        await callback()
        return
    defer_after_commit(db, callback)


def defer_after_commit(db: AsyncSession, callback: AfterCommitCallback) -> None:
    sync_session = db.sync_session
    callbacks = cast(
        list[AfterCommitCallback],
        sync_session.info.setdefault(_AFTER_COMMIT_CALLBACKS_KEY, []),
    )
    callbacks.append(callback)
    _ensure_after_commit_listeners(sync_session)


def _ensure_after_commit_listeners(sync_session: Session) -> None:
    if sync_session.info.get(_AFTER_COMMIT_LISTENERS_KEY):
        return
    sync_session.info[_AFTER_COMMIT_LISTENERS_KEY] = True

    @event.listens_for(sync_session, "after_commit")
    def _run_after_root_commit(session: Session) -> None:
        if session.in_nested_transaction():
            return
        callbacks = tuple(
            cast(
                list[AfterCommitCallback],
                session.info.pop(_AFTER_COMMIT_CALLBACKS_KEY, []),
            )
        )
        if not callbacks:
            return
        loop = asyncio.get_running_loop()
        loop.create_task(_run_after_commit_callbacks(callbacks))

    @event.listens_for(sync_session, "after_soft_rollback")
    def _discard_after_root_rollback(session: Session, previous_transaction: object) -> None:
        if getattr(previous_transaction, "parent", None) is None:
            session.info.pop(_AFTER_COMMIT_CALLBACKS_KEY, None)


async def _run_after_commit_callbacks(callbacks: tuple[AfterCommitCallback, ...]) -> None:
    for callback in callbacks:
        try:
            await callback()
        except Exception:
            _logger.exception("Deferred after-commit callback failed.")
