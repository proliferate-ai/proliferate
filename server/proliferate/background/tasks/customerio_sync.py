"""Nightly Customer.io engagement attribute sync."""

from __future__ import annotations

import asyncio

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from proliferate.background.celery_app import celery_app
from proliferate.background.config import CUSTOMERIO_ENGAGEMENT_SYNC_TASK
from proliferate.config import settings
from proliferate.server.product_engagement.worker.service import (
    run_customerio_engagement_sync,
)


async def _run_engagement_sync() -> None:
    engine = create_async_engine(
        settings.database_url,
        pool_pre_ping=True,
        connect_args={"statement_cache_size": 0},
    )
    try:
        session_factory = async_sessionmaker(engine, expire_on_commit=False)
        await run_customerio_engagement_sync(session_factory)
    finally:
        await engine.dispose()


@celery_app.task(name=CUSTOMERIO_ENGAGEMENT_SYNC_TASK)
def customerio_engagement_sync() -> str:
    asyncio.run(_run_engagement_sync())
    return "ok"
