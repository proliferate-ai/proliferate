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

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.workflows import (
    WORKFLOW_CONCURRENCY_SKIP,
    WORKFLOW_MISSED_RUN_POLICY_REPLAY_ALL,
    WORKFLOW_MISSED_RUN_POLICY_SKIP_ALL,
    WORKFLOW_RUN_STATUS_DELIVERED,
    WORKFLOW_RUN_STATUS_PENDING_DELIVERY,
    WORKFLOW_SCHEDULER_DEFAULT_BATCH_SIZE,
    WORKFLOW_SCHEDULER_MAX_CATCH_UP_SLOTS,
    WORKFLOW_SCHEDULER_MAX_DELIVERIES_PER_TICK,
    WORKFLOW_SERVER_DELIVERED_TRIGGER_KINDS,
    WORKFLOW_TRIGGER_KIND_SCHEDULE,
    WORKFLOW_TRIGGER_SKIP_REASON_CONCURRENCY,
    WORKFLOW_TRIGGER_SKIP_REASON_MAX_LENGTH,
)
from proliferate.db import engine as db_engine
from proliferate.db.store import cloud_workflow_triggers as trigger_store
from proliferate.db.store import cloud_workflows as store
from proliferate.db.store.cloud_workflow_triggers import _organization_id_for_owner
from proliferate.integrations.sentry import capture_server_sentry_exception
from proliferate.middleware.request_context import with_correlation_context
from proliferate.server.automations.domain.schedule import (
    AutomationScheduleError,
    due_occurrences_since,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows import compiler
from proliferate.server.cloud.workflows.actions import sweep_pending_actions
from proliferate.server.cloud.workflows.delivery import deliver_cloud_run, refresh_cloud_run
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


# The partial unique index that dedupes (trigger_id, scheduled_for) — a re-tick
# over an already-fired/recorded slot conflicts here (migration b2d4f6a8c0e1).
_SLOT_DEDUP_INDEX = "uq_workflow_run_trigger_slot"


def _is_slot_dedup_conflict(exc: IntegrityError) -> bool:
    """True only when this IntegrityError is the (trigger_id, scheduled_for) dedup
    index firing — the one conflict the fire loop may safely swallow as "already
    recorded". Any other constraint (FK, a real bug) must propagate.

    We read the violated constraint/index name defensively: asyncpg populates
    ``constraint_name`` on the wrapped error (psycopg would carry it under
    ``.diag``); if none is exposed we fall back to matching the index name in the
    stringified error (asyncpg's message is ``... unique constraint "<index>"``).
    """

    orig = getattr(exc, "orig", None)
    for candidate in (orig, getattr(orig, "__cause__", None), getattr(orig, "diag", None)):
        name = getattr(candidate, "constraint_name", None)
        if name:
            return name == _SLOT_DEDUP_INDEX
    return _SLOT_DEDUP_INDEX in str(exc)


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

        # Bind tenant fields for the rest of this trigger's unit of work so every
        # log line it emits (including from compiler.start_run) is correlated
        # (observability spec §8 — background loops must not log anonymously).
        with with_correlation_context(
            organization_id=trigger.workflow_organization_id,
            user_id=trigger.workflow_owner_user_id,
            worker_id="workflow_scheduler",
        ):
            if trigger.workflow_archived:
                await trigger_store.disable_trigger_with_reason(
                    db, trigger_id=trigger_id, now=now, reason="Workflow was archived."
                )
                return 0

            # Enumerate the missed window (cursor .. now]. When the worker was
            # healthy this is a single slot; when it was down every RRULE
            # occurrence that came due meanwhile is here, and the missed-run policy
            # decides which fire vs are recorded `missed` (mental-model §4).
            since = trigger.expected_run_at or now
            try:
                occurrences, next_run_at = due_occurrences_since(
                    rrule_text=trigger.schedule_rrule,
                    timezone=trigger.schedule_timezone,
                    since=since,
                    now=now,
                )
            except AutomationScheduleError as exc:
                # A stored schedule that can no longer be cursored: stop firing it
                # rather than spin. The owner can re-save a valid schedule to
                # re-enable.
                await trigger_store.disable_trigger_with_reason(
                    db, trigger_id=trigger_id, now=now, reason=_skip_reason(str(exc))
                )
                return 0

            if not occurrences:
                # The cursor sits in the future (e.g. a just-re-enabled trigger):
                # nothing is due this tick. Record + advance to the next slot.
                await trigger_store.mark_trigger_skipped(
                    db,
                    trigger_id=trigger_id,
                    now=now,
                    reason="No due occurrence for this slot.",
                    next_run_at=next_run_at,
                )
                return 0

            # Concurrency skip: fire nothing this tick while a prior run of this
            # trigger is still non-terminal, and hold the cursor STATIONARY (do not
            # advance past the enumerated window). Advancing to the future
            # ``next_run_at`` here would silently discard every occurrence in
            # ``occurrences`` without a `missed` row. Leaving the cursor put means
            # the next tick re-enumerates the same window (cheap: a skip-tick writes
            # no rows) and, once the prior run terminates, routes the full backlog
            # through the normal missed-run policy partition below. The LOCKED
            # semantics hold: a skip-tick still fires nothing.
            if trigger.concurrency_policy == WORKFLOW_CONCURRENCY_SKIP and (
                await store.has_non_terminal_run_for_trigger(db, trigger_id=trigger_id)
            ):
                await trigger_store.mark_trigger_skipped(
                    db,
                    trigger_id=trigger_id,
                    now=now,
                    reason=WORKFLOW_TRIGGER_SKIP_REASON_CONCURRENCY,
                    next_run_at=None,  # stationary: re-enumerate this window next tick
                )
                return 0

            # Partition the FULL window per the trigger's missed-run policy FIRST,
            # then bound only the fire list. Truncating `occurrences` before the
            # partition (the old order) dropped over-cap slots under every policy —
            # they were neither fired nor recorded, a silent gap. The invariant we
            # restore: the cursor NEVER advances past a slot that is neither fired
            # nor recorded `missed`.
            if trigger.missed_run_policy == WORKFLOW_MISSED_RUN_POLICY_SKIP_ALL:
                fire_slots: list[datetime] = []
                missed_slots: list[datetime] = list(occurrences)
            elif trigger.missed_run_policy == WORKFLOW_MISSED_RUN_POLICY_REPLAY_ALL:
                fire_slots = list(occurrences)
                missed_slots = []
            else:  # run_latest (default): the newest fires; older recorded missed.
                fire_slots = [occurrences[-1]]
                missed_slots = list(occurrences[:-1])

            # Safety valve: bound the per-tick FIRE work (each fire wakes a sandbox
            # via delivery). replay_all can enumerate a huge backfill; fire the
            # OLDEST cap slots this tick and leave the remainder for later ticks.
            # `fire_overflow` (the un-fired tail) holds the cursor behind so those
            # slots replay next tick instead of vanishing. Missed-row recording is a
            # cheap ON CONFLICT DO NOTHING insert, so it is NOT truncated.
            fire_overflow: list[datetime] = []
            if len(fire_slots) > WORKFLOW_SCHEDULER_MAX_CATCH_UP_SLOTS:
                logger.warning(
                    "workflow schedule catch-up truncated "
                    "trigger_id=%s fire_due=%s fired_now=%s deferred=%s",
                    trigger_id,
                    len(fire_slots),
                    WORKFLOW_SCHEDULER_MAX_CATCH_UP_SLOTS,
                    len(fire_slots) - WORKFLOW_SCHEDULER_MAX_CATCH_UP_SLOTS,
                )
                fire_overflow = fire_slots[WORKFLOW_SCHEDULER_MAX_CATCH_UP_SLOTS:]
                fire_slots = fire_slots[:WORKFLOW_SCHEDULER_MAX_CATCH_UP_SLOTS]

            # Where the cursor lands this tick. If we deferred fire slots, it must
            # NOT jump past them: park it on the oldest un-fired slot so the next
            # tick re-enumerates from there. Otherwise advance to the next future
            # occurrence as usual.
            advance_to = fire_overflow[0] if fire_overflow else next_run_at

            # Record un-fired slots as honest terminal `missed` history rows (no
            # sandbox, no delivery), deduped by the (trigger_id, scheduled_for)
            # index. Needs the workflow's current version for the run FK.
            missed_recorded = 0
            missed_skip_reason: str | None = None
            if missed_slots:
                if trigger.workflow_current_version_id is None:
                    # Mirror the fire path, which surfaces this loudly as a
                    # workflow_no_version CloudApiError: log + carry a skip reason so
                    # the gap is not silent. (Without a current version there is no
                    # run FK to hang a `missed` row on.)
                    missed_skip_reason = _skip_reason(
                        f"workflow_no_version: {len(missed_slots)} missed slot(s) not recorded"
                    )
                    logger.warning(
                        "workflow schedule missed rows not recorded (no current version) "
                        "trigger_id=%s missed=%s",
                        trigger_id,
                        len(missed_slots),
                    )
                else:
                    for slot in missed_slots:
                        if await store.create_missed_run(
                            db,
                            workflow_id=trigger.workflow_id,
                            workflow_version_id=trigger.workflow_current_version_id,
                            executor_user_id=trigger.workflow_owner_user_id,
                            trigger_id=trigger_id,
                            scheduled_for=slot,
                            trigger_kind=WORKFLOW_TRIGGER_KIND_SCHEDULE,
                            target_mode=trigger.target_mode,
                            args_json=trigger.args_json,
                        ):
                            missed_recorded += 1

            actor = _SchedulerActor(id=trigger.workflow_owner_user_id)
            created = 0
            last_fired: datetime | None = None
            fire_error: str | None = None
            for slot in fire_slots:
                try:
                    # Savepoint per fire: a StartRun error (workspace de-provisioned)
                    # or a unique-index conflict (the slot already has a row, e.g. a
                    # re-tick) rolls back just this insert, never the whole tick.
                    async with db.begin_nested():
                        await compiler.start_run(
                            db,
                            actor,
                            trigger.workflow_id,
                            inputs=trigger.args_json,
                            target_mode=trigger.target_mode,
                            trigger_kind=WORKFLOW_TRIGGER_KIND_SCHEDULE,
                            target_workspace_id=trigger.target_workspace_id,
                            trigger_id=trigger_id,
                            scheduled_for=slot,
                        )
                    created += 1
                    last_fired = slot
                except IntegrityError as exc:
                    if not _is_slot_dedup_conflict(exc):
                        # Some OTHER constraint fired (e.g. an FK or a real data
                        # bug). Swallowing it as "already recorded" would mask a
                        # genuine failure, so let it propagate to the per-trigger
                        # isolation handler in _fire_due_triggers.
                        raise
                    # The (trigger_id, slot) row already exists — the dedup
                    # guarantee held; this slot was fired/recorded on an earlier tick.
                    logger.info(
                        "workflow schedule slot already recorded trigger_id=%s slot=%s",
                        trigger_id,
                        slot,
                    )
                except CloudApiError as exc:
                    fire_error = _skip_reason(f"{exc.code}: {exc.message}")
                    logger.warning(
                        "workflow schedule fire failed trigger_id=%s slot=%s code=%s",
                        trigger_id,
                        slot,
                        exc.code,
                    )

            if last_fired is not None:
                # Advance to `advance_to`: the next future occurrence, or — when a
                # replay backfill overflowed this tick's cap — the oldest un-fired
                # slot, so the deferred remainder replays next tick.
                await trigger_store.mark_trigger_fired(
                    db, trigger_id=trigger_id, scheduled_for=last_fired, next_run_at=advance_to
                )
            else:
                # Nothing fired (skip_all, or every fire errored / was already
                # recorded): advance the cursor (past only fired-or-recorded slots)
                # and surface why. A missed-recording gap (no current version) is
                # surfaced ahead of the generic count, mirroring the fire path.
                reason = (
                    fire_error
                    or missed_skip_reason
                    or (
                        f"{missed_recorded} occurrence(s) recorded missed."
                        if missed_recorded
                        else "No run fired this slot."
                    )
                )
                await trigger_store.mark_trigger_skipped(
                    db,
                    trigger_id=trigger_id,
                    now=now,
                    reason=_skip_reason(reason),
                    next_run_at=advance_to,
                )
            return created


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
