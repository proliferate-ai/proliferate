"""Thin Celery task wrappers for the workflow schedule plane (WS4a, spec §10.2).

Two Beat-fired tasks, both gated by ``settings.workflows_beat_schedules`` at the
schedule-registry level (``background/beat_schedule.py``):

- ``workflow_fire_due_schedules``: opens ONE short transaction, calls the
  commit-free ``fire_due_schedule_triggers`` service (which creates run intents +
  cloud-delivery outbox rows), commits. No network I/O inside.
- ``workflow_deliver_outbox``: the cloud-delivery relay — claims due
  ``cloud_delivery`` outbox rows (pending -> delivering), then per row opens a
  fresh session and hands the run to the existing ``deliver_cloud_run`` before
  finalising the row. Multi-phase so no transaction spans the sandbox wake.

These wrappers hold no business logic: transaction boundaries + failure->retry
mapping only (``specs/codebase/structures/server/guides/background.md``).
"""

from __future__ import annotations

import asyncio
import logging

from proliferate.background.celery_app import celery_app
from proliferate.background.config import (
    WORKFLOW_DELIVER_OUTBOX_TASK,
    WORKFLOW_FIRE_DUE_SCHEDULES_TASK,
)
from proliferate.constants.workflows import (
    WORKFLOW_OUTBOX_RELAY_BATCH_SIZE,
    WORKFLOW_OUTBOX_RELAY_RETRY_DELAY_SECONDS,
    WORKFLOW_SCHEDULER_DEFAULT_BATCH_SIZE,
)
from proliferate.db.engine import async_session_factory
from proliferate.db.store.workflow_ledger import (
    OutboxRecord,
    claim_due_outbox_rows,
    complete_outbox_row,
)
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
        async with async_session_factory() as db, db.begin():
            claimed = await claim_due_outbox_rows(db, now=now, limit=batch_size)
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
