"""Automation scheduler worker loop."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable

from proliferate.db import engine as db_engine
from proliferate.integrations.sentry import capture_server_sentry_exception
from proliferate.server.automations.worker.service import run_scheduler_tick

logger = logging.getLogger(__name__)
FAILURE_ESCALATION_THRESHOLD = 3
MAX_FAILURE_BACKOFF_SECONDS = 300.0


async def run_scheduler_loop(
    *,
    interval_seconds: float,
    batch_size: int,
    stop_event: asyncio.Event,
    validate_schema: Callable[[], Awaitable[None]],
) -> None:
    logger.info(
        "Automation scheduler worker started interval_seconds=%s batch_size=%s",
        interval_seconds,
        batch_size,
    )
    schema_validated = False
    consecutive_failures = 0
    while not stop_event.is_set():
        try:
            if not schema_validated:
                await validate_schema()
                schema_validated = True
            result = await run_scheduler_tick(
                session_factory=db_engine.async_session_factory,
                batch_size=batch_size,
            )
            consecutive_failures = 0
            if result.created_runs:
                logger.info("Automation scheduler created runs count=%s", result.created_runs)
            if result.swept_dispatching_runs:
                logger.warning(
                    "Automation scheduler swept dispatching runs count=%s",
                    result.swept_dispatching_runs,
                )
            next_delay = interval_seconds
        except Exception as exc:
            consecutive_failures += 1
            next_delay = min(
                interval_seconds * (2 ** (consecutive_failures - 1)),
                MAX_FAILURE_BACKOFF_SECONDS,
            )
            logger.exception(
                "Automation scheduler tick failed consecutive_failures=%s next_delay_seconds=%s",
                consecutive_failures,
                next_delay,
            )
            if consecutive_failures >= FAILURE_ESCALATION_THRESHOLD:
                capture_server_sentry_exception(
                    exc,
                    level="error",
                    tags={"worker": "automation_scheduler"},
                    extras={"consecutive_failures": consecutive_failures},
                    fingerprint=["automation-scheduler", "tick-failed"],
                )
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=next_delay)
        except TimeoutError:
            continue
