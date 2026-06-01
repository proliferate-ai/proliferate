"""Background support report tracker reconciler."""

from __future__ import annotations

import asyncio
import logging
from contextlib import suppress

from proliferate.config import settings
from proliferate.server.support.tracker import run_support_tracker_reconcile_pass

logger = logging.getLogger(__name__)

_reconciler_task: asyncio.Task[None] | None = None


def start_support_tracker_reconciler() -> None:
    global _reconciler_task
    if not settings.support_tracker_enabled:
        return
    if _reconciler_task is not None and not _reconciler_task.done():
        return
    _reconciler_task = asyncio.create_task(_support_tracker_reconciler_loop())


async def stop_support_tracker_reconciler() -> None:
    global _reconciler_task
    task = _reconciler_task
    _reconciler_task = None
    if task is None:
        return
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task


async def _support_tracker_reconciler_loop() -> None:
    while True:
        try:
            await run_support_tracker_reconcile_pass()
        except Exception:
            logger.exception("Support tracker reconciler pass failed.")
        await asyncio.sleep(max(settings.support_tracker_reconciler_interval_seconds, 1.0))
