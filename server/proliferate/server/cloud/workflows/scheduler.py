"""Workflow schedule-trigger scheduler (spec 3.5).

Runs as a second beat beside the automations scheduler (they own different tables
and fail independently). Each tick has two phases:

**Phase 1 — fire due triggers.** Enumerate due schedule triggers, then process
each in its own transaction: lock the row (``FOR UPDATE SKIP LOCKED``), apply the
concurrency policy, create the run through the *same* ``StartRun`` every trigger
uses, and advance the RRULE cursor. A trigger is only a trigger — no interpreter.

  - ``skip``:  if the trigger already has a non-terminal run, drop this slot and
    record ``last_skipped_at`` + ``last_skip_reason``; still advance the cursor.
  - ``queue``: always create the run (``pending_delivery``); delivery is deferred
    (Phase 2) until the prior run of this trigger is terminal.

**Phase 2 — deliver eligible cloud runs.** Scan scheduled cloud runs still
``pending_delivery`` and deliver only the FIFO-first non-terminal run per trigger
via ``deliver_cloud_run`` (wake + gateway POST). That single rule expresses both
the immediate case (no prior run) and ``queue`` deferral (a prior run is still
active, so this run waits for the next tick). Deliveries are capped per tick
because each one wakes a sandbox — the house automation loop bounds itself the
same way.

Runs execute as the workflow owner (v1: no "Run as"); the scheduler constructs a
minimal owner identity to call the same owner-scoped services a request would.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.workflows import (
    WORKFLOW_CONCURRENCY_SKIP,
    WORKFLOW_RUN_STATUS_DELIVERED,
    WORKFLOW_RUN_STATUS_PENDING_DELIVERY,
    WORKFLOW_SCHEDULER_DEFAULT_BATCH_SIZE,
    WORKFLOW_SCHEDULER_MAX_DELIVERIES_PER_TICK,
    WORKFLOW_TRIGGER_KIND_SCHEDULE,
    WORKFLOW_TRIGGER_SKIP_REASON_CONCURRENCY,
    WORKFLOW_TRIGGER_SKIP_REASON_MAX_LENGTH,
)
from proliferate.db import engine as db_engine
from proliferate.db.store import cloud_workflow_triggers as trigger_store
from proliferate.db.store import cloud_workflows as store
from proliferate.integrations.sentry import capture_server_sentry_exception
from proliferate.server.automations.domain.schedule import (
    AutomationScheduleError,
    due_and_next_occurrences,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows import service
from proliferate.server.cloud.workflows.delivery import deliver_cloud_run
from proliferate.utils.time import utcnow

logger = logging.getLogger(__name__)

SchedulerSessionFactory = Callable[[], AbstractAsyncContextManager[AsyncSession]]

_FAILURE_ESCALATION_THRESHOLD = 3
_MAX_FAILURE_BACKOFF_SECONDS = 300.0


@dataclass
class _SchedulerActor:
    """Minimal owner identity — enough for the owner-scoped services StartRun and
    delivery expect (they only read ``.id``). Not frozen: ``ActorIdentity`` types
    its ``id`` as a settable attribute."""

    id: UUID


@dataclass(frozen=True)
class WorkflowSchedulerTickResult:
    created_runs: int
    delivered_runs: int


def _skip_reason(message: str) -> str:
    normalized = " ".join(message.split())
    if len(normalized) <= WORKFLOW_TRIGGER_SKIP_REASON_MAX_LENGTH:
        return normalized
    return normalized[: WORKFLOW_TRIGGER_SKIP_REASON_MAX_LENGTH - 1] + "…"


# --- Phase 1: fire due triggers ------------------------------------------------


async def _fire_one_trigger(
    session_factory: SchedulerSessionFactory, *, trigger_id: UUID, now: datetime
) -> int:
    async with session_factory() as db, db.begin():
        trigger = await trigger_store.claim_due_schedule_trigger(
            db, trigger_id=trigger_id, now=now
        )
        if trigger is None:
            return 0  # taken by another beat, disabled, or no longer due
        if trigger.workflow_archived:
            await trigger_store.disable_trigger_with_reason(
                db, trigger_id=trigger_id, now=now, reason="Workflow was archived."
            )
            return 0

        try:
            scheduled_for, next_run_at = due_and_next_occurrences(
                rrule_text=trigger.schedule_rrule,
                timezone=trigger.schedule_timezone,
                now=now,
            )
        except AutomationScheduleError as exc:
            # A stored schedule that can no longer be cursored: stop firing it
            # rather than spin. The owner can re-save a valid schedule to re-enable.
            await trigger_store.disable_trigger_with_reason(
                db, trigger_id=trigger_id, now=now, reason=_skip_reason(str(exc))
            )
            return 0

        if scheduled_for is None:
            await trigger_store.mark_trigger_skipped(
                db,
                trigger_id=trigger_id,
                now=now,
                reason="No due occurrence for this slot.",
                next_run_at=next_run_at,
            )
            return 0

        # Concurrency: skip drops the slot while a prior run is still non-terminal.
        if trigger.concurrency_policy == WORKFLOW_CONCURRENCY_SKIP and (
            await store.has_non_terminal_run_for_trigger(db, trigger_id=trigger_id)
        ):
            await trigger_store.mark_trigger_skipped(
                db,
                trigger_id=trigger_id,
                now=now,
                reason=WORKFLOW_TRIGGER_SKIP_REASON_CONCURRENCY,
                next_run_at=next_run_at,
            )
            return 0

        actor = _SchedulerActor(id=trigger.workflow_owner_user_id)
        try:
            # Savepoint: a StartRun error (e.g. workspace de-provisioned) rolls back
            # just the run insert so we can still record the skip + advance below.
            async with db.begin_nested():
                await service.start_run(
                    db,
                    actor,
                    trigger.workflow_id,
                    args=trigger.args_json,
                    target_mode=trigger.target_mode,
                    trigger_kind=WORKFLOW_TRIGGER_KIND_SCHEDULE,
                    target_workspace_id=trigger.target_workspace_id,
                    trigger_id=trigger_id,
                    scheduled_for=scheduled_for,
                )
        except CloudApiError as exc:
            await trigger_store.mark_trigger_skipped(
                db,
                trigger_id=trigger_id,
                now=now,
                reason=_skip_reason(f"{exc.code}: {exc.message}"),
                next_run_at=next_run_at,
            )
            return 0

        await trigger_store.mark_trigger_fired(
            db, trigger_id=trigger_id, scheduled_for=scheduled_for, next_run_at=next_run_at
        )
        return 1


async def _fire_due_triggers(
    session_factory: SchedulerSessionFactory, *, now: datetime, batch_size: int
) -> int:
    async with session_factory() as db:
        due_ids = await trigger_store.list_due_schedule_trigger_ids(db, now=now, limit=batch_size)
    created = 0
    for trigger_id in due_ids:
        try:
            created += await _fire_one_trigger(session_factory, trigger_id=trigger_id, now=now)
        except Exception:
            # One trigger blowing up must not stall the rest of the beat (mirrors the
            # per-run isolation in _deliver_pending_runs). The trigger keeps its slot
            # and is retried next tick.
            logger.exception("workflow scheduled trigger fire failed trigger_id=%s", trigger_id)
    return created


# --- Phase 2: deliver eligible cloud runs --------------------------------------


async def _deliver_one_run(session_factory: SchedulerSessionFactory, *, run_id: UUID) -> int:
    async with session_factory() as db, db.begin():
        run = await store.get_run(db, run_id)
        if run is None or run.status != WORKFLOW_RUN_STATUS_PENDING_DELIVERY:
            return 0
        if run.trigger_id is None or run.trigger_kind != WORKFLOW_TRIGGER_KIND_SCHEDULE:
            return 0
        # Deliver only the FIFO-first non-terminal run of this trigger. Any other
        # run defers until its predecessor is terminal (this is queue's deferral).
        earliest = await store.earliest_non_terminal_run_id_for_trigger(
            db, trigger_id=run.trigger_id
        )
        if earliest != run.id:
            return 0
        actor = _SchedulerActor(id=run.executor_user_id)
        result = await deliver_cloud_run(db, actor, run)
        # A delivery_failed run stays pending_delivery (retried next tick).
        return 1 if result.status == WORKFLOW_RUN_STATUS_DELIVERED else 0


async def _deliver_pending_runs(
    session_factory: SchedulerSessionFactory, *, max_deliveries: int
) -> int:
    async with session_factory() as db:
        candidates = await store.list_pending_scheduled_cloud_runs(
            db, limit=max(1, max_deliveries) * 4
        )
    delivered = 0
    for run in candidates:
        if delivered >= max_deliveries:
            break
        try:
            delivered += await _deliver_one_run(session_factory, run_id=run.id)
        except Exception:
            # One run's delivery blowing up must not stall the rest of the beat.
            logger.exception("workflow scheduled delivery failed run_id=%s", run.id)
    return delivered


# --- tick + loop ---------------------------------------------------------------


async def run_workflow_scheduler_tick(
    *,
    session_factory: SchedulerSessionFactory,
    batch_size: int = WORKFLOW_SCHEDULER_DEFAULT_BATCH_SIZE,
    max_deliveries: int = WORKFLOW_SCHEDULER_MAX_DELIVERIES_PER_TICK,
) -> WorkflowSchedulerTickResult:
    now = utcnow()
    created = await _fire_due_triggers(session_factory, now=now, batch_size=batch_size)
    delivered = await _deliver_pending_runs(session_factory, max_deliveries=max_deliveries)
    return WorkflowSchedulerTickResult(created_runs=created, delivered_runs=delivered)


async def run_workflow_scheduler_loop(
    *,
    interval_seconds: float,
    batch_size: int,
    stop_event: asyncio.Event,
    validate_schema: Callable[[], Awaitable[None]] | None = None,
    max_deliveries: int = WORKFLOW_SCHEDULER_MAX_DELIVERIES_PER_TICK,
) -> None:
    logger.info(
        "Workflow scheduler worker started interval_seconds=%s batch_size=%s",
        interval_seconds,
        batch_size,
    )
    schema_validated = validate_schema is None
    consecutive_failures = 0
    while not stop_event.is_set():
        try:
            if not schema_validated and validate_schema is not None:
                await validate_schema()
                schema_validated = True
            result = await run_workflow_scheduler_tick(
                session_factory=db_engine.async_session_factory,
                batch_size=batch_size,
                max_deliveries=max_deliveries,
            )
            consecutive_failures = 0
            if result.created_runs or result.delivered_runs:
                logger.info(
                    "Workflow scheduler tick created=%s delivered=%s",
                    result.created_runs,
                    result.delivered_runs,
                )
            next_delay = interval_seconds
        except Exception as exc:
            consecutive_failures += 1
            next_delay = min(
                interval_seconds * (2 ** (consecutive_failures - 1)),
                _MAX_FAILURE_BACKOFF_SECONDS,
            )
            logger.exception(
                "Workflow scheduler tick failed consecutive_failures=%s next_delay_seconds=%s",
                consecutive_failures,
                next_delay,
            )
            if consecutive_failures >= _FAILURE_ESCALATION_THRESHOLD:
                capture_server_sentry_exception(
                    exc,
                    level="error",
                    tags={"worker": "workflow_scheduler"},
                    extras={"consecutive_failures": consecutive_failures},
                    fingerprint=["workflow-scheduler", "tick-failed"],
                )
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=next_delay)
        except TimeoutError:
            continue
