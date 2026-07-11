"""Thin Celery task wrappers for the workflow schedule + poll planes (WS4a/WS4b,
spec §10.2/§10.3).

Four Beat-fired tasks, gated at the schedule-registry level
(``background/beat_schedule.py``) by ``settings.workflows_beat_schedules``
(schedule pair) or the sibling ``settings.workflows_beat_polls`` (poll pair):

- ``workflow_fire_due_schedules``: opens ONE short transaction, calls the
  commit-free ``fire_due_schedule_triggers`` service (which creates run intents +
  cloud-delivery outbox rows), commits. No network I/O inside.
- ``workflow_deliver_outbox``: the cloud-delivery relay — claims due
  ``cloud_delivery`` outbox rows (pending -> delivering), then per row opens a
  fresh session and hands the run to the existing ``deliver_cloud_run`` before
  finalising the row. Multi-phase so no transaction spans the sandbox wake.
- ``workflow_fire_due_polls``: per due poll trigger, runs the WS4b prepare ->
  close-DB -> HTTP -> new-DB -> apply sequence (``worker/polls.py``) for page 1.
- ``workflow_poll_next_page``: the poll continuation relay — claims due
  ``poll_next_page`` outbox rows, then per row fetches + applies page N>1 in a
  fresh session (no transaction spans the fetch here either).

These wrappers hold no business logic: transaction boundaries + failure->retry
mapping only (``specs/codebase/structures/server/guides/background.md``).
"""

from __future__ import annotations

import asyncio
import logging

from proliferate.background.celery_app import celery_app
from proliferate.background.config import (
    WORKFLOW_DELIVER_OUTBOX_TASK,
    WORKFLOW_FIRE_DUE_POLLS_TASK,
    WORKFLOW_FIRE_DUE_SCHEDULES_TASK,
    WORKFLOW_POLL_NEXT_PAGE_TASK,
)
from proliferate.constants.workflows import (
    WORKFLOW_OUTBOX_KIND_CLOUD_DELIVERY,
    WORKFLOW_OUTBOX_KIND_POLL_NEXT_PAGE,
    WORKFLOW_OUTBOX_RELAY_BATCH_SIZE,
    WORKFLOW_OUTBOX_RELAY_RETRY_DELAY_SECONDS,
    WORKFLOW_POLL_NEXT_PAGE_BATCH_SIZE,
    WORKFLOW_POLLER_DEFAULT_BATCH_SIZE,
    WORKFLOW_SCHEDULER_DEFAULT_BATCH_SIZE,
)
from proliferate.db.engine import async_session_factory
from proliferate.db.store import cloud_workflow_triggers as trigger_store
from proliferate.db.store.workflow_ledger import (
    OutboxRecord,
    claim_due_outbox_rows,
    complete_outbox_row,
)
from proliferate.server.cloud.workflows.worker import polls as worker_polls
from proliferate.server.cloud.workflows.worker.schedules import (
    deliver_cloud_delivery_outbox_row,
    fire_due_schedule_triggers,
    relay_backoff,
)
from proliferate.utils.time import utcnow

logger = logging.getLogger(__name__)


@celery_app.task(name=WORKFLOW_FIRE_DUE_SCHEDULES_TASK)
def workflow_fire_due_schedules(
    batch_size: int = WORKFLOW_SCHEDULER_DEFAULT_BATCH_SIZE,
) -> str:
    async def _run() -> int:
        now = utcnow()
        async with async_session_factory() as db, db.begin():
            result = await fire_due_schedule_triggers(db, now=now, batch_size=batch_size)
        return result.created_runs

    created = asyncio.run(_run())
    if created:
        logger.info("workflow_fire_due_schedules created=%s", created)
    return f"created={created}"


@celery_app.task(name=WORKFLOW_DELIVER_OUTBOX_TASK)
def workflow_deliver_outbox(batch_size: int = WORKFLOW_OUTBOX_RELAY_BATCH_SIZE) -> str:
    async def _run() -> tuple[int, int]:
        now = utcnow()
        # Phase 1: claim due rows (pending -> delivering) in one short transaction.
        # kind-scoped: ``poll_next_page`` rows (WS4b) live in the SAME outbox
        # table and must never be claimed by this cloud-delivery relay.
        async with async_session_factory() as db, db.begin():
            claimed = await claim_due_outbox_rows(
                db, now=now, limit=batch_size, kind=WORKFLOW_OUTBOX_KIND_CLOUD_DELIVERY
            )
        # Phase 2: deliver each claimed row in its own fresh session (the sandbox
        # wake happens here, never under a held transaction).
        delivered = 0
        for row in claimed:
            if await _deliver_one_outbox_row(row):
                delivered += 1
        return len(claimed), delivered

    n_claimed, n_delivered = asyncio.run(_run())
    if n_claimed:
        logger.info("workflow_deliver_outbox claimed=%s delivered=%s", n_claimed, n_delivered)
    return f"claimed={n_claimed} delivered={n_delivered}"


async def _deliver_one_outbox_row(row: OutboxRecord) -> bool:
    """Deliver one claimed row in a fresh session and finalise it. Returns True on
    a completed delivery. A crash between claim and finalise leaves the row
    ``delivering``; the store's lease/backoff reclaims it on a later cycle."""

    async with async_session_factory() as db, db.begin():
        outcome = await deliver_cloud_delivery_outbox_row(db, row=row)
        if outcome.status == "delivered":
            await complete_outbox_row(db, outbox_id=row.id, status="delivered")
            return True
        if outcome.status == "failed":
            await complete_outbox_row(
                db, outbox_id=row.id, status="failed", last_error=outcome.detail
            )
            return False
        # deferred (FIFO predecessor) or retry (transient delivery failure): return
        # the row to pending with a backoff so a later cycle re-claims it.
        await complete_outbox_row(
            db,
            outbox_id=row.id,
            status="pending",
            last_error=outcome.detail,
            next_attempt_at=relay_backoff(
                utcnow(), delay_seconds=WORKFLOW_OUTBOX_RELAY_RETRY_DELAY_SECONDS
            ),
        )
        return False


# --- WS4b poll plane (spec §10.3) -----------------------------------------------


@celery_app.task(name=WORKFLOW_FIRE_DUE_POLLS_TASK)
def workflow_fire_due_polls(batch_size: int = WORKFLOW_POLLER_DEFAULT_BATCH_SIZE) -> str:
    async def _run() -> int:
        now = utcnow()
        async with async_session_factory() as db:
            due_ids = await trigger_store.list_due_poll_trigger_ids(db, now=now, limit=batch_size)
        processed = 0
        for trigger_id in due_ids:
            try:
                outcome = await worker_polls.run_one_poll_attempt(
                    async_session_factory, trigger_id=trigger_id, now=now
                )
            except Exception:
                logger.exception(
                    "workflow_fire_due_polls attempt failed trigger_id=%s", trigger_id
                )
                continue
            if outcome is not None:
                processed += 1
        return processed

    processed = asyncio.run(_run())
    if processed:
        logger.info("workflow_fire_due_polls processed=%s", processed)
    return f"processed={processed}"


@celery_app.task(name=WORKFLOW_POLL_NEXT_PAGE_TASK)
def workflow_poll_next_page(batch_size: int = WORKFLOW_POLL_NEXT_PAGE_BATCH_SIZE) -> str:
    async def _run() -> tuple[int, int]:
        now = utcnow()
        # Phase 1: claim due poll_next_page rows in one short transaction.
        async with async_session_factory() as db, db.begin():
            claimed = await claim_due_outbox_rows(
                db, now=now, limit=batch_size, kind=WORKFLOW_OUTBOX_KIND_POLL_NEXT_PAGE
            )
        # Phase 2: fetch + apply each claimed page in its own fresh session (the
        # HTTP fetch happens here, never under a held transaction).
        advanced = 0
        for row in claimed:
            try:
                if await _process_poll_next_page_row(row):
                    advanced += 1
            except Exception:
                logger.exception("workflow_poll_next_page row failed outbox_id=%s", row.id)
                async with async_session_factory() as db, db.begin():
                    await complete_outbox_row(db, outbox_id=row.id, status="delivered")
        return len(claimed), advanced

    n_claimed, n_advanced = asyncio.run(_run())
    if n_claimed:
        logger.info("workflow_poll_next_page claimed=%s advanced=%s", n_claimed, n_advanced)
    return f"claimed={n_claimed} advanced={n_advanced}"


async def _process_poll_next_page_row(row: OutboxRecord) -> bool:
    """Fetch + apply the page this row names, then finalise the row.

    Always resolves ``delivered`` (this row's ONE job — fetch page N — is done
    regardless of outcome): a durable failure/contract-error/budget-exhaustion
    or a still-pending item ends the chain here, and the next scheduled
    occurrence continues from the last durably-CAS'd cursor (spec §10.3). A
    chained next page (``has_more`` + durable) got its OWN new outbox row
    written inside ``apply_poll_page``'s transaction, so nothing is lost by
    finalising this one unconditionally.
    """

    outcome = await worker_polls.run_next_page_attempt(async_session_factory, row, now=utcnow())
    async with async_session_factory() as db, db.begin():
        await complete_outbox_row(db, outbox_id=row.id, status="delivered")
    return outcome is not None and outcome.cursor_advanced
