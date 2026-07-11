"""Workflow schedule-trigger scheduler loop (legacy transition owner; spec 3.5).

WS4a moved schedule *firing* onto Celery Beat + the transactional outbox
(``background/tasks/workflows.py`` -> ``worker/schedules.py``). This asyncio loop
is the legacy transition owner: while ``settings.workflows_beat_schedules`` is
``False`` (the default) it still fires schedules — by delegating its firing half
to the same commit-free ``fire_due_schedule_triggers`` service Beat calls, so
there is one policy implementation. Flip the flag and Beat owns firing; this loop
skips its firing half. WS4c flips the default and deletes this loop.

Delivery execution still lives here until WS4c. Each tick after firing:

**Phase 2 — deliver eligible cloud runs.** Scan scheduled cloud runs still
``pending_delivery`` and deliver only the FIFO-first non-terminal run per trigger
via ``deliver_cloud_run`` (wake + gateway POST). Beat-fired runs also carry a
``cloud_delivery`` outbox row delivered by ``workflow_deliver_outbox``; both paths
call the idempotent ``deliver_cloud_run``, so the redundant delivery during the
transition never double-delivers. Deliveries are capped per tick because each one
wakes a sandbox.

**Phase 3 — refresh in-flight runs + sweep actions.**

Runs execute as the workflow owner (v1: no "Run as"); the loop constructs a
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

from proliferate.config import settings
from proliferate.constants.workflows import (
    WORKFLOW_RUN_STATUS_DELIVERED,
    WORKFLOW_RUN_STATUS_PENDING_DELIVERY,
    WORKFLOW_SCHEDULER_DEFAULT_BATCH_SIZE,
    WORKFLOW_SCHEDULER_MAX_DELIVERIES_PER_TICK,
    WORKFLOW_SERVER_DELIVERED_TRIGGER_KINDS,
)
from proliferate.db import engine as db_engine
from proliferate.db.store import cloud_workflows as store
from proliferate.db.store.cloud_workflow_triggers import _organization_id_for_owner
from proliferate.integrations.sentry import capture_server_sentry_exception
from proliferate.middleware.request_context import with_correlation_context
from proliferate.server.cloud.workflows.actions import sweep_pending_actions
from proliferate.server.cloud.workflows.delivery import deliver_cloud_run, refresh_cloud_run
from proliferate.server.cloud.workflows.worker.schedules import fire_due_schedule_triggers
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


# --- Phase 1: fire due triggers (delegated to the WS4a commit-free service) -----


async def _fire_due_triggers(
    session_factory: SchedulerSessionFactory, *, now: datetime, batch_size: int
) -> int:
    """Fire due schedule triggers in one short transaction via the shared service.

    Owns only the transaction boundary (open + commit); the policy (occurrence
    enumeration, DST, missed-run partition, concurrency, outbox writes) lives in
    ``worker/schedules.py`` so Beat and this loop share one implementation."""

    async with session_factory() as db, db.begin():
        result = await fire_due_schedule_triggers(db, now=now, batch_size=batch_size)
    return result.created_runs


# --- Phase 2: deliver eligible cloud runs --------------------------------------


async def _deliver_one_run(session_factory: SchedulerSessionFactory, *, run_id: UUID) -> int:
    async with session_factory() as db, db.begin():
        run = await store.get_run(db, run_id)
        if run is None or run.status != WORKFLOW_RUN_STATUS_PENDING_DELIVERY:
            return 0
        if (
            run.trigger_id is None
            or run.trigger_kind not in WORKFLOW_SERVER_DELIVERED_TRIGGER_KINDS
        ):
            return 0
        # Deliver only the FIFO-first non-terminal run of this trigger. Any other
        # run defers until its predecessor is terminal (this is queue's deferral).
        earliest = await store.earliest_non_terminal_run_id_for_trigger(
            db, trigger_id=run.trigger_id
        )
        if earliest != run.id:
            return 0
        actor = _SchedulerActor(id=run.executor_user_id)
        organization_id = await _organization_id_for_owner(db, owner_user_id=run.executor_user_id)
        with with_correlation_context(
            organization_id=organization_id,
            user_id=run.executor_user_id,
            worker_id="workflow_scheduler",
        ):
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


# --- Phase 3: refresh in-flight + sweep actions --------------------------------

_MAX_REFRESHES_PER_TICK = 10


async def _refresh_in_flight_runs(
    session_factory: SchedulerSessionFactory, *, tick_start: datetime
) -> int:
    """Refresh in-flight triggered cloud runs so actions fire for unattended runs.

    Only refreshes runs delivered before this tick started (skip runs we just
    delivered -- they need time to execute before a refresh is useful).
    """
    async with session_factory() as db:
        candidates = await store.list_in_flight_triggered_cloud_runs(
            db, limit=_MAX_REFRESHES_PER_TICK, delivered_before=tick_start
        )
    refreshed = 0
    for run in candidates:
        try:
            async with session_factory() as db, db.begin():
                actor = _SchedulerActor(id=run.executor_user_id)
                organization_id = await _organization_id_for_owner(
                    db, owner_user_id=run.executor_user_id
                )
                with with_correlation_context(
                    organization_id=organization_id,
                    user_id=run.executor_user_id,
                    worker_id="workflow_scheduler",
                ):
                    await refresh_cloud_run(db, actor, run)
                refreshed += 1
        except Exception:
            logger.exception("workflow scheduler refresh failed run_id=%s", run.id)
    return refreshed


async def _sweep_actions(session_factory: SchedulerSessionFactory) -> int:
    async with session_factory() as db, db.begin():
        return await sweep_pending_actions(db)


# --- tick + loop ---------------------------------------------------------------


async def run_workflow_scheduler_tick(
    *,
    session_factory: SchedulerSessionFactory,
    batch_size: int = WORKFLOW_SCHEDULER_DEFAULT_BATCH_SIZE,
    max_deliveries: int = WORKFLOW_SCHEDULER_MAX_DELIVERIES_PER_TICK,
) -> WorkflowSchedulerTickResult:
    # D-003: the launch flag gates the background plane too. Triggers created
    # while the surface was enabled must not keep firing runs (provisioning
    # sandboxes, consuming budget) on a deployment whose workflows API is dark
    # and whose /cancel would 404.
    if not settings.workflows_enabled:
        return WorkflowSchedulerTickResult(created_runs=0, delivered_runs=0)
    now = utcnow()
    # WS4a cutover: Beat owns firing once ``workflows_beat_schedules`` is set; this
    # loop then skips its firing half (delivery below still runs during the
    # transition). Default (flag off) keeps the legacy loop firing.
    if settings.workflows_beat_schedules:
        created = 0
    else:
        created = await _fire_due_triggers(session_factory, now=now, batch_size=batch_size)

    # Poll triggers (PR B) are polled by their own gathered coroutine
    # (run_workflow_poller_loop, see poller.py) rather than inline here — a slow
    # poll endpoint must not delay run delivery in this tick. Poll-spawned cloud
    # runs still ride phase-2 delivery below unchanged (they carry trigger_id).
    delivered = await _deliver_pending_runs(session_factory, max_deliveries=max_deliveries)

    # Phase 3: refresh in-flight triggered cloud runs + sweep stale actions.
    try:
        await _refresh_in_flight_runs(session_factory, tick_start=now)
    except Exception:
        logger.exception("workflow scheduler phase 3 refresh failed")
    try:
        await _sweep_actions(session_factory)
    except Exception:
        logger.exception("workflow scheduler phase 3 sweep failed")

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
