"""Request transaction boundary for durable GitHub App reauthorization state."""

from __future__ import annotations

from collections.abc import AsyncIterator

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db import session_ops
from proliferate.db.engine import get_async_session
from proliferate.server.cloud.github_app.errors import GitHubAppReauthorizationRequired


async def release_github_app_transaction(db: AsyncSession) -> None:
    """End a completed GitHub App read phase before remote provider I/O."""

    await session_ops.commit_session(db)


def _reauthorization_error(error: BaseException) -> GitHubAppReauthorizationRequired | None:
    current: BaseException | None = error
    while current is not None:
        if isinstance(current, GitHubAppReauthorizationRequired):
            return current
        current = current.__cause__
    return None


async def commit_github_app_reauthorization_on_error(
    db: AsyncSession = Depends(get_async_session),
) -> AsyncIterator[None]:
    """Commit only the permanent auth transition before its structured response.

    The GitHub authorization gate runs before request-owned mutations at every
    HTTP entrypoint using this dependency. It conditionally stages
    ``needs_reauth`` for the exact authorization revision and raises
    ``GitHubAppReauthorizationRequired``.
    Committing here preserves that transition without moving transaction
    ownership into a service or store.
    """

    try:
        yield
    except Exception as error:
        if _reauthorization_error(error) is None:
            raise
        await session_ops.commit_session(db)
        raise
