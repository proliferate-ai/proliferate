"""Beat-fired Cloud sandbox maintenance tasks."""

from __future__ import annotations

import asyncio

from proliferate.background.celery_app import celery_app
from proliferate.background.config import CLOUD_SANDBOX_ORPHAN_REAP_TASK
from proliferate.db.engine import async_session_factory
from proliferate.server.cloud.worker.service import run_orphan_sandbox_reap_pass


@celery_app.task(name=CLOUD_SANDBOX_ORPHAN_REAP_TASK)
def cloud_sandbox_orphan_reap() -> str:
    async def _run() -> None:
        async with async_session_factory() as db:
            await run_orphan_sandbox_reap_pass(db)

    asyncio.run(_run())
    return "ok"
