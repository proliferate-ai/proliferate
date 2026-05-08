"""Worker-side automation scheduling orchestration."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from proliferate.db.store.automation_run_claims import (
    sweep_expired_dispatching_runs,
)
from proliferate.db.store.automations import (
    AutomationScheduleAdvance,
    AutomationScheduleFields,
    create_due_scheduled_runs_batch,
)
from proliferate.server.automations.domain.schedule import due_and_next_occurrences
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class SchedulerTickResult:
    created_runs: int
    swept_dispatching_runs: int = 0


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


async def run_scheduler_tick(*, batch_size: int = 100) -> SchedulerTickResult:
    swept_dispatching_runs = await sweep_expired_dispatching_runs(now=utcnow())
    created_runs = await create_due_scheduled_runs_batch(
        now=utcnow(),
        limit=max(1, batch_size),
        schedule_advance_resolver=_resolve_due_schedule,
    )
    return SchedulerTickResult(
        created_runs=created_runs,
        swept_dispatching_runs=swept_dispatching_runs,
    )

