import asyncio
import logging
from collections.abc import AsyncGenerator, Awaitable, Callable
from typing import Annotated, cast

from anyio import CancelScope
from fastapi import Depends
from sqlalchemy import event, text
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import Session

from proliferate.config import settings
from proliferate.rls_context import get_rls_context

engine = create_async_engine(
    settings.database_url,
    echo=settings.database_echo,
    pool_pre_ping=True,
    # Disable asyncpg's per-connection prepared-statement cache. Cached plans are
    # bound to the OID of the objects they reference, so when an index is dropped
    # and recreated by a migration (new OID) while connections stay open, those
    # connections keep replaying plans against the dead OID and fail forever with
    # "no unique or exclusion constraint matching the ON CONFLICT specification".
    # pool_pre_ping does not help — it only runs SELECT 1, it does not re-plan.
    # Tradeoff: every query now goes through a full Parse/Bind/Execute cycle with
    # no plan reuse, which costs throughput under load (asyncpg benchmarks ~10-20%).
    # We accept that for correctness. TODO: revisit re-enabling the cache once the
    # migration divergence is cleaned up and index OIDs stop churning under live
    # connections — at which point pool_recycle below is sufficient on its own.
    connect_args={"statement_cache_size": 0},
    # Defense-in-depth: age connections out so no pooled connection lives
    # indefinitely across a schema change.
    pool_recycle=1800,
)
async_session_factory = async_sessionmaker(engine, expire_on_commit=False)
_AFTER_COMMIT_CALLBACKS_KEY = "proliferate_after_commit_callbacks"
_AFTER_COMMIT_LISTENERS_KEY = "proliferate_after_commit_listeners"
_logger = logging.getLogger(__name__)

type AfterCommitCallback = Callable[[], Awaitable[None]]

_RLS_CONTEXT_SQL = text(
    """
    SELECT
      set_config('app.actor_user_id', :actor_user_id, true),
      set_config('app.owner_scope', :owner_scope, true),
      set_config('app.organization_id', :organization_id, true)
    """
)


def _rls_context_params() -> dict[str, str]:
    actor_user_id, owner_scope, organization_id = get_rls_context()
    return {
        "actor_user_id": actor_user_id or "",
        "owner_scope": owner_scope or "",
        "organization_id": organization_id or "",
    }


@event.listens_for(Session, "after_begin")
def _apply_rls_context_after_begin(
    session: Session,
    transaction: object,
    connection: Connection,
) -> None:
    del session, transaction
    connection.execute(_RLS_CONTEXT_SQL, _rls_context_params())


async def apply_rls_context_to_session(db: AsyncSession) -> None:
    await db.execute(_RLS_CONTEXT_SQL, _rls_context_params())


async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    session = async_session_factory()
    try:
        try:
            yield session
            await session.commit()
        except BaseException:
            await rollback_session(session)
            raise
    finally:
        await close_session(session)


AsyncSessionDep = Annotated[AsyncSession, Depends(get_async_session)]


async def commit_session(db: AsyncSession) -> None:
    await db.commit()


async def rollback_session(db: AsyncSession) -> None:
    with CancelScope(shield=True):
        await db.rollback()


async def close_session(db: AsyncSession) -> None:
    with CancelScope(shield=True):
        await db.close()


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
