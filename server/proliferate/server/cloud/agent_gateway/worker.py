"""Background enrollment backfill, usage-import, and top-up workers.

All are started from the app lifespan (mirroring the anonymous-telemetry
sender). The backfill worker retries pending/failed enrollments and enrolls
users that predate the signup hooks every
``agent_gateway_backfill_interval_seconds``. The usage-import worker pages
LiteLLM spend logs and enforces LLM-credit exhaustion every
``agent_gateway_usage_import_interval_seconds``. The top-up worker charges
overage-enabled subjects that dropped below the credit threshold every
``agent_gateway_topup_interval_seconds`` (and only when the LLM top-up price
is configured). All only run when the gateway is enabled.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import suppress

from proliferate.config import settings
from proliferate.db import session_ops as db_session
from proliferate.integrations.sentry import report_critical
from proliferate.server.cloud.agent_gateway.enrollment import backfill_enrollments
from proliferate.server.cloud.agent_gateway.topups import (
    LlmTopupRunResult,
    run_llm_topups,
    topups_enabled,
)
from proliferate.server.cloud.agent_gateway.usage_import import (
    UsageImportResult,
    run_usage_import,
)

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
        except Exception as exc:
            report_critical(
                exc,
                tags={"domain": "agent_gateway", "action": "enrollment_backfill"},
            )
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


async def run_usage_import_once() -> UsageImportResult:
    async with db_session.open_async_transaction() as db:
        return await run_usage_import(db)


async def _usage_import_loop() -> None:
    while True:
        try:
            result = await run_usage_import_once()
            if result.imported or result.exhausted_subjects:
                logger.info(
                    "Agent gateway usage import processed spend",
                    extra={
                        "imported": result.imported,
                        "exhausted_subjects": result.exhausted_subjects,
                    },
                )
        except Exception as exc:
            report_critical(
                exc,
                tags={"domain": "agent_gateway", "action": "usage_import"},
            )
        await asyncio.sleep(settings.agent_gateway_usage_import_interval_seconds)


async def start_agent_gateway_usage_import() -> asyncio.Task[None] | None:
    if not settings.agent_gateway_enabled:
        return None
    return asyncio.create_task(
        _usage_import_loop(),
        name="agent-gateway-usage-import",
    )


async def stop_agent_gateway_usage_import(
    task: asyncio.Task[None] | None,
) -> None:
    if task is None:
        return
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task


async def run_llm_topups_once() -> LlmTopupRunResult:
    async with db_session.open_async_transaction() as db:
        return await run_llm_topups(db)


async def _topup_loop() -> None:
    while True:
        try:
            result = await run_llm_topups_once()
            if result.topped_up or result.skipped:
                logger.info(
                    "Agent gateway LLM top-up tick processed subjects",
                    extra={
                        "eligible": result.eligible,
                        "topped_up": result.topped_up,
                        "skipped": result.skipped,
                    },
                )
        except Exception as exc:
            report_critical(
                exc,
                tags={"domain": "agent_gateway", "action": "llm_topup"},
            )
        await asyncio.sleep(settings.agent_gateway_topup_interval_seconds)


async def start_agent_gateway_llm_topups() -> asyncio.Task[None] | None:
    if not settings.agent_gateway_enabled or not topups_enabled():
        return None
    return asyncio.create_task(
        _topup_loop(),
        name="agent-gateway-llm-topups",
    )


async def stop_agent_gateway_llm_topups(
    task: asyncio.Task[None] | None,
) -> None:
    if task is None:
        return
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task
