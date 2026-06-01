"""Worker-side automation scheduling orchestration."""

from __future__ import annotations

from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.automation_run_claims import (
    sweep_expired_dispatching_runs,
)
from proliferate.db.store.automations import (
    AutomationScheduleAdvance,
    AutomationScheduleFields,
    create_due_scheduled_runs_batch,
)
from proliferate.server.automations.domain.claim_lifecycle import (
    AUTOMATION_RUN_STATUS_DISPATCHING,
    dispatch_uncertain_failure,
)
from proliferate.server.automations.domain.schedule import due_and_next_occurrences
from proliferate.server.cloud.agent_run_config.service import (
    snapshot_json as agent_run_config_snapshot_json,
)
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class SchedulerTickResult:
    created_runs: int
    swept_dispatching_runs: int = 0


SchedulerSessionFactory = Callable[[], AbstractAsyncContextManager[AsyncSession]]


def _resolve_due_schedule(
    fields: AutomationScheduleFields,
    now: datetime,
) -> AutomationScheduleAdvance:
    """Create the latest due slot at or before now, then advance to the first future slot."""
    scheduled_for, next_run_at = due_and_next_occurrences(
        rrule_text=fields.schedule_rrule,
        timezone=fields.schedule_timezone,
        now=now,
    )
    return AutomationScheduleAdvance(scheduled_for=scheduled_for, next_run_at=next_run_at)


async def _sweep_expired_dispatching_runs(
    session_factory: SchedulerSessionFactory,
) -> int:
    async with session_factory() as db, db.begin():
        return await sweep_expired_dispatching_runs(
            db,
            now=utcnow(),
            dispatching_status=AUTOMATION_RUN_STATUS_DISPATCHING,
            dispatch_uncertain_failure=dispatch_uncertain_failure(),
        )


async def _create_due_scheduled_runs_batch(
    session_factory: SchedulerSessionFactory,
    *,
    batch_size: int,
) -> int:
    async with session_factory() as db, db.begin():
        return await create_due_scheduled_runs_batch(
            db,
            now=utcnow(),
            limit=max(1, batch_size),
            schedule_advance_resolver=_resolve_due_schedule,
            agent_run_config_snapshot_builder=agent_run_config_snapshot_json,
        )


async def run_scheduler_tick(
    *,
    session_factory: SchedulerSessionFactory,
    batch_size: int = 100,
) -> SchedulerTickResult:
    swept_dispatching_runs = await _sweep_expired_dispatching_runs(session_factory)
    created_runs = await _create_due_scheduled_runs_batch(
        session_factory,
        batch_size=batch_size,
    )
    return SchedulerTickResult(
        created_runs=created_runs,
        swept_dispatching_runs=swept_dispatching_runs,
    )
