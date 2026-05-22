from __future__ import annotations

import asyncio
import logging
from contextlib import suppress
from dataclasses import dataclass

from proliferate.config import settings
from proliferate.db import engine as db_engine
from proliferate.db.store.cloud_mobility import load_due_cleanup_items
from proliferate.server.cloud.mobility.cleanup_executor import (
    SERVER_CLEANUP_ITEM_KINDS,
    execute_server_cleanup_item,
)
from proliferate.utils.time import utcnow

logger = logging.getLogger("proliferate.cloud.mobility.reconciler")
_reconciler_task: asyncio.Task[None] | None = None


@dataclass(frozen=True)
class MobilityCleanupReconcilerResult:
    attempted: int


async def reconcile_due_mobility_cleanup_items(
    *,
    limit: int = 50,
) -> MobilityCleanupReconcilerResult:
    async with db_engine.async_session_factory() as db:
        due_items = await load_due_cleanup_items(
            db,
            now=utcnow(),
            item_kinds=SERVER_CLEANUP_ITEM_KINDS,
            limit=limit,
        )

    attempted = 0
    for item in due_items:
        async with db_engine.async_session_factory() as db:
            await execute_server_cleanup_item(
                db,
                handoff_op_id=item.handoff_op_id,
                cleanup_item_id=item.id,
            )
            await db.commit()
            attempted += 1

    return MobilityCleanupReconcilerResult(attempted=attempted)


async def _mobility_cleanup_reconciler_loop() -> None:
    interval_seconds = max(settings.workspace_move_cleanup_reconciler_interval_seconds, 30)
    while True:
        try:
            result = await reconcile_due_mobility_cleanup_items()
            if result.attempted:
                logger.info(
                    "mobility cleanup reconciler attempted items",
                    extra={"attempted": result.attempted},
                )
        except Exception:
            logger.exception("mobility cleanup reconciler pass failed")
        await asyncio.sleep(interval_seconds)


def start_mobility_cleanup_reconciler() -> None:
    global _reconciler_task
    if settings.workspace_move_cleanup_reconciler_interval_seconds <= 0:
        return
    if _reconciler_task is not None and not _reconciler_task.done():
        return
    _reconciler_task = asyncio.create_task(
        _mobility_cleanup_reconciler_loop(),
        name="mobility-cleanup-reconciler",
    )


async def stop_mobility_cleanup_reconciler() -> None:
    global _reconciler_task
    if _reconciler_task is None:
        return
    _reconciler_task.cancel()
    with suppress(asyncio.CancelledError):
        await _reconciler_task
    _reconciler_task = None
