"""Worker-facing schedule firing + cloud-delivery outbox service (WS4a, spec §10.2).

Commit-free orchestration the Beat tasks (``background/tasks/workflows.py``) and
the legacy scheduler loop's firing half call. Every function here takes an open
``db`` and never commits — the task owns the transaction boundary
(``specs/codebase/structures/server/guides/background.md``).

Two responsibilities:

**Firing** (``fire_due_schedule_triggers``): for each due schedule trigger, lock
the row (``FOR UPDATE SKIP LOCKED``), enumerate the due window with the
DST-correct occurrence rules, partition it per the missed-run policy, create an
idempotent run intent per fired slot through the same ``compiler.start_run`` every
trigger uses, and — for a cloud target — write a ``cloud_delivery`` outbox row in
the same transaction. The schedule cursor advances only past durably-represented
occurrences: a transient ``start_run`` failure parks the cursor on that slot so
the next tick retries it and writes no outbox row for it.

**Delivery relay** (``deliver_cloud_delivery_outbox_row``): resolve a claimed
``cloud_delivery`` outbox row to its run and hand it to the existing
``delivery.deliver_cloud_run`` (idempotent). This is the delivery source of truth
for Beat-fired runs; the caller finalises the outbox row from the returned
outcome. WS4c replaces the direct call with the full cloud-delivery task.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal
from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.workflows import (
    WORKFLOW_CONCURRENCY_SKIP,
    WORKFLOW_OUTBOX_KIND_CLOUD_DELIVERY,
    WORKFLOW_RUN_STATUS_DELIVERED,
    WORKFLOW_RUN_STATUS_PENDING_DELIVERY,
    WORKFLOW_SCHEDULER_MAX_CATCH_UP_SLOTS,
    WORKFLOW_TARGET_MODE_PERSONAL_CLOUD,
    WORKFLOW_TRIGGER_KIND_SCHEDULE,
    WORKFLOW_TRIGGER_SKIP_REASON_CONCURRENCY,
    WORKFLOW_TRIGGER_SKIP_REASON_MAX_LENGTH,
)
from proliferate.db.store import cloud_workflow_triggers as trigger_store
from proliferate.db.store import cloud_workflows as store
from proliferate.db.store.cloud_workflow_triggers import _organization_id_for_owner
from proliferate.db.store.workflow_ledger import OutboxRecord, enqueue_outbox
from proliferate.middleware.request_context import with_correlation_context
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows import compiler
from proliferate.server.cloud.workflows.delivery import deliver_cloud_run
from proliferate.server.cloud.workflows.domain.run_status import is_terminal
from proliferate.server.cloud.workflows.domain.schedule import (
    due_schedule_occurrences,
    partition_missed_run_window,
)

logger = logging.getLogger(__name__)

# The partial unique index that dedupes (trigger_id, scheduled_for). A re-tick over
# an already-recorded slot conflicts here; that conflict alone is safe to swallow.
_SLOT_DEDUP_INDEX = "uq_workflow_run_trigger_slot"


@dataclass
class _ScheduleActor:
    """Minimal owner identity for the owner-scoped services StartRun and delivery
    expect (they only read ``.id``). Runs execute as the workflow owner (v1)."""

    id: UUID


@dataclass(frozen=True)
class ScheduleFireResult:
    created_runs: int


def _skip_reason(message: str) -> str:
    normalized = " ".join(message.split())
    if len(normalized) <= WORKFLOW_TRIGGER_SKIP_REASON_MAX_LENGTH:
        return normalized
    return normalized[: WORKFLOW_TRIGGER_SKIP_REASON_MAX_LENGTH - 1] + "…"


def _is_slot_dedup_conflict(exc: IntegrityError) -> bool:
    """True only when this IntegrityError is the (trigger_id, scheduled_for) dedup
    index firing — the one conflict the fire loop may swallow as "already recorded".
    Any other constraint (FK, a real bug) must propagate."""

    orig = getattr(exc, "orig", None)
    for candidate in (orig, getattr(orig, "__cause__", None), getattr(orig, "diag", None)):
        name = getattr(candidate, "constraint_name", None)
        if name:
            return name == _SLOT_DEDUP_INDEX
    return _SLOT_DEDUP_INDEX in str(exc)


# --- firing --------------------------------------------------------------------


async def fire_one_trigger(db: AsyncSession, *, trigger_id: UUID, now: datetime) -> int:
    """Fire one due schedule trigger's slots inside the caller's transaction.

    Commit-free: uses per-fire savepoints (``begin_nested``) so a single
    ``start_run`` failure or slot-dedup conflict rolls back only that insert. The
    cursor advances only past durably-represented occurrences. Returns the number
    of run intents created this call.
    """

    trigger = await trigger_store.claim_due_schedule_trigger(db, trigger_id=trigger_id, now=now)
    if trigger is None:
        return 0  # taken by another worker, disabled, or no longer due

    with with_correlation_context(
        organization_id=trigger.workflow_organization_id,
        user_id=trigger.workflow_owner_user_id,
        worker_id="workflow_schedules",
    ):
        if trigger.workflow_archived:
            await trigger_store.disable_trigger_with_reason(
                db, trigger_id=trigger_id, now=now, reason="Workflow was archived."
            )
            return 0

        since = trigger.expected_run_at or now
        try:
            occurrences, next_run_at = due_schedule_occurrences(
                rrule_text=trigger.schedule_rrule,
                timezone=trigger.schedule_timezone,
                since=since,
                now=now,
            )
        except Exception as exc:  # AutomationScheduleError: a schedule we can't cursor
            await trigger_store.disable_trigger_with_reason(
                db, trigger_id=trigger_id, now=now, reason=_skip_reason(str(exc))
            )
            return 0

        if not occurrences:
            # The cursor sits in the future (e.g. a just-re-enabled trigger).
            await trigger_store.mark_trigger_skipped(
                db,
                trigger_id=trigger_id,
                now=now,
                reason="No due occurrence for this slot.",
                next_run_at=next_run_at,
            )
            return 0

        # Concurrency skip: fire nothing while a prior run is non-terminal and hold
        # the cursor STATIONARY (next_run_at=None) so the whole window re-enumerates
        # next tick and routes through the missed-run policy once the prior ends.
        if trigger.concurrency_policy == WORKFLOW_CONCURRENCY_SKIP and (
            await store.has_non_terminal_run_for_trigger(db, trigger_id=trigger_id)
        ):
            await trigger_store.mark_trigger_skipped(
                db,
                trigger_id=trigger_id,
                now=now,
                reason=WORKFLOW_TRIGGER_SKIP_REASON_CONCURRENCY,
                next_run_at=None,
            )
            return 0

        partition = partition_missed_run_window(
            occurrences=occurrences,
            missed_run_policy=trigger.missed_run_policy,
            next_run_at=next_run_at,
        )
        fire_slots = partition.fire_slots

        # Safety valve: bound the per-tick FIRE work (each fire will wake a sandbox
        # once delivered). The un-fired tail parks the cursor so it replays later.
        fire_overflow: list[datetime] = []
        if len(fire_slots) > WORKFLOW_SCHEDULER_MAX_CATCH_UP_SLOTS:
            logger.warning(
                "workflow schedule catch-up truncated trigger_id=%s fire_due=%s "
                "fired_now=%s deferred=%s",
                trigger_id,
                len(fire_slots),
                WORKFLOW_SCHEDULER_MAX_CATCH_UP_SLOTS,
                len(fire_slots) - WORKFLOW_SCHEDULER_MAX_CATCH_UP_SLOTS,
            )
            fire_overflow = fire_slots[WORKFLOW_SCHEDULER_MAX_CATCH_UP_SLOTS:]
            fire_slots = fire_slots[:WORKFLOW_SCHEDULER_MAX_CATCH_UP_SLOTS]

        missed_recorded, missed_skip_reason = await _record_missed_slots(
            db, trigger=trigger, trigger_id=trigger_id, missed_slots=partition.missed_slots
        )

        created, last_fired, fire_error, park_slot = await _fire_slots(
            db, trigger=trigger, trigger_id=trigger_id, fire_slots=fire_slots
        )

        # Advance only past durably-represented slots. A transient failure parks the
        # cursor ON that slot (stationary for it); otherwise the un-fired overflow
        # tail parks it; otherwise advance to the next future occurrence.
        advance_to = park_slot or (fire_overflow[0] if fire_overflow else next_run_at)

        if last_fired is not None:
            await trigger_store.mark_trigger_fired(
                db, trigger_id=trigger_id, scheduled_for=last_fired, next_run_at=advance_to
            )
        else:
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


async def _record_missed_slots(
    db: AsyncSession,
    *,
    trigger: trigger_store.DueScheduleTrigger,
    trigger_id: UUID,
    missed_slots: list[datetime],
) -> tuple[int, str | None]:
    """Record un-fired slots as terminal ``missed`` history rows (deduped). Returns
    ``(recorded_count, skip_reason_if_uncrecordable)``."""

    if not missed_slots:
        return 0, None
    if trigger.workflow_current_version_id is None:
        # No current version -> no run FK to hang a `missed` row on. Surface it
        # loudly rather than leave a silent gap (mirrors the fire path).
        logger.warning(
            "workflow schedule missed rows not recorded (no current version) "
            "trigger_id=%s missed=%s",
            trigger_id,
            len(missed_slots),
        )
        return 0, _skip_reason(
            f"workflow_no_version: {len(missed_slots)} missed slot(s) not recorded"
        )
    recorded = 0
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
            recorded += 1
    return recorded, None


async def _fire_slots(
    db: AsyncSession,
    *,
    trigger: trigger_store.DueScheduleTrigger,
    trigger_id: UUID,
    fire_slots: list[datetime],
) -> tuple[int, datetime | None, str | None, datetime | None]:
    """Create a run intent per slot (savepoint each) and, for cloud targets, a
    ``cloud_delivery`` outbox row in the same savepoint. Returns
    ``(created, last_fired, fire_error, park_slot)`` where ``park_slot`` is the
    oldest slot a transient failure left non-durable (cursor must not pass it)."""

    actor = _ScheduleActor(id=trigger.workflow_owner_user_id)
    created = 0
    last_fired: datetime | None = None
    fire_error: str | None = None
    for slot in fire_slots:
        try:
            async with db.begin_nested():
                run = await compiler.start_run(
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
                # Cloud runs need durable delivery follow-up: the outbox row commits
                # atomically with the run intent (§10.2). A local-ready run is
                # claimable over its HTTP API and needs no outbox.
                if run.target_mode == WORKFLOW_TARGET_MODE_PERSONAL_CLOUD:
                    await enqueue_outbox(
                        db,
                        kind=WORKFLOW_OUTBOX_KIND_CLOUD_DELIVERY,
                        payload_json={"reason": "schedule"},
                        run_id=run.id,
                        trigger_id=trigger_id,
                    )
            created += 1
            last_fired = slot
        except IntegrityError as exc:
            if not _is_slot_dedup_conflict(exc):
                raise
            # This (trigger_id, slot) row already exists — durable on an earlier
            # tick. The dedupe guarantee held; do not double-create or re-outbox.
            logger.info(
                "workflow schedule slot already recorded trigger_id=%s slot=%s", trigger_id, slot
            )
        except CloudApiError as exc:
            # Transient run-creation failure: this slot is NOT durable (savepoint
            # rolled back, no run, no outbox). Park the cursor here so the next tick
            # retries it; do not attempt later slots this tick.
            fire_error = _skip_reason(f"{exc.code}: {exc.message}")
            logger.warning(
                "workflow schedule fire failed trigger_id=%s slot=%s code=%s",
                trigger_id,
                slot,
                exc.code,
            )
            return created, last_fired, fire_error, slot
    return created, last_fired, fire_error, None


async def fire_due_schedule_triggers(
    db: AsyncSession, *, now: datetime, batch_size: int
) -> ScheduleFireResult:
    """Fire every due schedule trigger in the caller's single transaction.

    Each trigger runs inside its own savepoint so one trigger blowing up rolls
    back only its work and never stalls the rest of the batch; the trigger keeps
    its slot and is retried next tick. Commit-free — the task commits."""

    due_ids = await trigger_store.list_due_schedule_trigger_ids(db, now=now, limit=batch_size)
    created = 0
    for trigger_id in due_ids:
        try:
            async with db.begin_nested():
                created += await fire_one_trigger(db, trigger_id=trigger_id, now=now)
        except Exception:
            logger.exception("workflow scheduled trigger fire failed trigger_id=%s", trigger_id)
    return ScheduleFireResult(created_runs=created)


# --- cloud-delivery outbox relay ----------------------------------------------


@dataclass(frozen=True)
class OutboxDeliveryOutcome:
    """How the relay resolved a claimed ``cloud_delivery`` outbox row.

    ``delivered``: nothing more to do (delivered now, already delivered, run gone,
    or run reached a terminal state such as budget_blocked).
    ``deferred``: the run waits behind its FIFO predecessor (``queue`` policy).
    ``retry``: a transient delivery failure; reschedule the row with backoff.
    ``failed``: a permanently malformed row (no run_id)."""

    status: Literal["delivered", "deferred", "retry", "failed"]
    detail: str | None = None


async def deliver_cloud_delivery_outbox_row(
    db: AsyncSession, *, row: OutboxRecord
) -> OutboxDeliveryOutcome:
    """Deliver one claimed ``cloud_delivery`` outbox row's run (commit-free).

    Idempotent: a second attempt on an already-delivered/terminal run is a no-op
    that resolves ``delivered`` (retry cannot double-deliver). Honors the FIFO
    ``queue`` deferral by only delivering the trigger's earliest non-terminal run.
    """

    if row.run_id is None:
        return OutboxDeliveryOutcome("failed", "cloud_delivery outbox row has no run_id")

    run = await store.get_run(db, row.run_id)
    if run is None:
        return OutboxDeliveryOutcome("delivered", "run no longer exists")
    if run.status != WORKFLOW_RUN_STATUS_PENDING_DELIVERY:
        # Already delivered by an earlier relay/tick, or reached a terminal state.
        return OutboxDeliveryOutcome("delivered", f"run status is {run.status}")

    if run.trigger_id is not None:
        earliest = await store.earliest_non_terminal_run_id_for_trigger(
            db, trigger_id=run.trigger_id
        )
        if earliest is not None and earliest != run.id:
            return OutboxDeliveryOutcome("deferred", "waiting behind FIFO predecessor")

    actor = _ScheduleActor(id=run.executor_user_id)
    organization_id = await _organization_id_for_owner(db, owner_user_id=run.executor_user_id)
    with with_correlation_context(
        organization_id=organization_id,
        user_id=run.executor_user_id,
        worker_id="workflow_outbox_relay",
    ):
        try:
            result = await deliver_cloud_run(db, actor, run)
        except CloudApiError as exc:
            # e.g. target_workspace_not_ready — transient; retry with backoff.
            return OutboxDeliveryOutcome("retry", f"{exc.code}: {exc.message}")

    if result.status == WORKFLOW_RUN_STATUS_DELIVERED or is_terminal(result.status):
        return OutboxDeliveryOutcome("delivered")
    # Still pending_delivery: a wake/transport failure was recorded; retry later.
    return OutboxDeliveryOutcome("retry", "delivery_failed")


def relay_backoff(now: datetime, *, delay_seconds: float) -> datetime:
    return now + timedelta(seconds=delay_seconds)
