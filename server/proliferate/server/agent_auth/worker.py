"""The agent-auth background metronome: the seat usage probe loop (flow 5).

Split from the ai_gateway worker at the slice-5 code split: the seat probe is
agent_auth's own background job (it reads/writes seat_usage_sample through
``seats.py`` and carries no LiteLLM dependency), so its metronome lives with
the system that owns it. The ai_gateway worker keeps the gateway jobs
(enrollment backfill, topups, usage import, verification, zero-grant check).
Advisory only, never a launch gate — nothing here feeds the launch path.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import suppress

from proliferate.config import settings
from proliferate.db import session_ops as db_session
from proliferate.integrations.sentry import report_critical
from proliferate.server.agent_auth.seats import (
    SeatUsageProbePassResult,
    run_seat_usage_probe_pass,
)

logger = logging.getLogger(__name__)

_SEAT_USAGE_TICK_SECONDS = 60.0


async def run_seat_usage_probe_once() -> SeatUsageProbePassResult:
    async with db_session.open_async_transaction() as db:
        return await run_seat_usage_probe_pass(db)


async def _seat_usage_probe_loop() -> None:
    while True:
        try:
            result = await run_seat_usage_probe_once()
            if result.probed or result.failed:
                logger.info(
                    "Agent seat usage probe tick recorded samples",
                    extra={
                        "probed": result.probed,
                        "failed": result.failed,
                        "skipped": result.skipped,
                    },
                )
        except Exception as exc:
            report_critical(
                exc,
                tags={"domain": "agent_auth", "action": "seat_usage_probe"},
            )
        await asyncio.sleep(_SEAT_USAGE_TICK_SECONDS)


async def start_agent_seat_usage_probe() -> asyncio.Task[None] | None:
    # Deliberately NOT gated on agent_gateway_enabled: seats carry no LiteLLM
    # dependency (module docstring). The per-seat cadence lives in the pass;
    # this loop is just the metronome.
    if not settings.run_background_workers:
        return None
    return asyncio.create_task(
        _seat_usage_probe_loop(),
        name="agent-seat-usage-probe",
    )


async def stop_agent_seat_usage_probe(task: asyncio.Task[None] | None) -> None:
    if task is None:
        return
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task
