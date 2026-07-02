"""Background enrollment backfill worker.

Started from the app lifespan (mirroring the anonymous-telemetry sender):
every ``agent_gateway_backfill_interval_seconds`` it retries pending/failed
enrollments and enrolls users that predate the signup hooks. Only runs when
the gateway is enabled.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import suppress

from proliferate.config import settings
from proliferate.db import session_ops as db_session
from proliferate.server.cloud.agent_gateway.enrollment import backfill_enrollments

logger = logging.getLogger(__name__)

_BACKFILL_BATCH_LIMIT = 50


async def run_enrollment_backfill_once(*, limit: int = _BACKFILL_BATCH_LIMIT) -> int:
    async with db_session.open_async_transaction() as db:
        return await backfill_enrollments(db, limit=limit)


async def _backfill_loop() -> None:
    while True:
        try:
            processed = await run_enrollment_backfill_once()
            if processed:
                logger.info(
                    "Agent gateway enrollment backfill processed subjects",
                    extra={"processed": processed},
                )
        except Exception:
            logger.exception("Agent gateway enrollment backfill tick failed")
        await asyncio.sleep(settings.agent_gateway_backfill_interval_seconds)


async def start_agent_gateway_enrollment_backfill() -> asyncio.Task[None] | None:
    if not settings.agent_gateway_enabled:
        return None
    return asyncio.create_task(
        _backfill_loop(),
        name="agent-gateway-enrollment-backfill",
    )


async def stop_agent_gateway_enrollment_backfill(
    task: asyncio.Task[None] | None,
) -> None:
    if task is None:
        return
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task
