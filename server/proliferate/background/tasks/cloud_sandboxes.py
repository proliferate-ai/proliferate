"""Beat-fired Cloud sandbox maintenance tasks."""

from __future__ import annotations

import asyncio

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from proliferate.background.celery_app import celery_app
from proliferate.background.config import CLOUD_SANDBOX_ORPHAN_REAP_TASK
from proliferate.config import settings
from proliferate.server.cloud.worker.service import run_orphan_sandbox_reap_pass


async def _run_orphan_reap() -> None:
    # Celery fires this sync task through a fresh ``asyncio.run`` loop each time.
    # A task-local engine prevents pooled asyncpg connections from leaking across
    # those short-lived loops; the recurring relay/workflow tasks use the same
    # ownership pattern.
    engine = create_async_engine(
        settings.database_url,
        pool_pre_ping=True,
        connect_args={"statement_cache_size": 0},
    )
    try:
        session_factory = async_sessionmaker(engine, expire_on_commit=False)
        async with session_factory() as db:
            await run_orphan_sandbox_reap_pass(db)
    finally:
        await engine.dispose()


@celery_app.task(name=CLOUD_SANDBOX_ORPHAN_REAP_TASK)
def cloud_sandbox_orphan_reap() -> str:
    asyncio.run(_run_orphan_reap())
    return "ok"
