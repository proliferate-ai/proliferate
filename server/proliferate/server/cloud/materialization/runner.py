"""In-process scheduling for cloud materialization work."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable, Mapping
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.engine import async_session_factory
from proliferate.db.engine import run_after_commit as db_run_after_commit
from proliferate.integrations.sentry import report_critical

logger = logging.getLogger("proliferate.cloud.materialization")


async def run_after_commit(
    db: AsyncSession,
    *,
    label: str,
    task: Callable[[], Awaitable[None]],
) -> None:
    async def _run() -> None:
        try:
            await task()
        except Exception as exc:
            report_critical(
                exc,
                tags={"domain": "cloud_materialization", "label": label},
            )

    async def _callback() -> None:
        asyncio.create_task(_run())

    await db_run_after_commit(db, _callback)


def spawn_materialization_task(
    fn: Callable[..., Awaitable[None]],
    **kwargs: object,
) -> None:
    asyncio.create_task(_run_with_fresh_session(fn, kwargs))


async def _run_with_fresh_session(
    fn: Callable[..., Awaitable[None]],
    kwargs: Mapping[str, Any],
) -> None:
    async with async_session_factory() as db:
        try:
            await fn(db, **kwargs)
            await db.commit()
        except Exception as exc:
            await db.rollback()
            report_critical(
                exc,
                tags={
                    "domain": "cloud_materialization",
                    "fn": getattr(fn, "__name__", repr(fn)),
                },
            )
