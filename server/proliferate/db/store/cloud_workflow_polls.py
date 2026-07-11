"""WS4b poll-cursor CAS + permanent-contract-error persistence (spec §10.3).

Split out of ``cloud_workflow_triggers.py`` (which owns trigger CRUD + the
claim/list poller-lane helpers) purely to stay under the store max-lines
budget; both modules persist the SAME ``workflow_trigger`` row and are used
together by ``worker/polls.py``.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.workflows import WorkflowTrigger
from proliferate.utils.time import utcnow


async def cas_advance_poll_cursor(
    db: AsyncSession,
    *,
    trigger_id: UUID,
    expected_generation: int | None,
    new_cursor: str | None,
    error: str | None = None,
) -> bool:
    """CAS-advance the poll cursor: accepts only when ``poll_cursor_generation``
    is still exactly ``expected_generation`` (frozen at claim time), then bumps
    it by one. Mirrors ``workflow_ledger.cas_observed_snapshot``'s optimistic-
    UPDATE shape.

    The caller (``worker/polls.py``) calls this only once every item on the page
    has a durable decision — a pending item means the cursor stays put for the
    next occurrence. ``error`` defaults to clearing ``last_poll_error``; pass the
    page-budget marker to record it while the cursor still advances.

    Returns ``True`` iff the CAS held (``False`` means a concurrent writer already
    moved the generation — defensive; should not happen given the claim gate).
    """

    guard = (
        WorkflowTrigger.poll_cursor_generation.is_(None)
        if expected_generation is None
        else WorkflowTrigger.poll_cursor_generation == expected_generation
    )
    next_generation = 1 if expected_generation is None else expected_generation + 1
    result = await db.execute(
        update(WorkflowTrigger)
        .where(WorkflowTrigger.id == trigger_id, guard)
        .values(
            poll_cursor=new_cursor,
            poll_cursor_generation=next_generation,
            last_poll_error=error,
            updated_at=utcnow(),
        )
        .returning(WorkflowTrigger.id)
    )
    return result.scalar_one_or_none() is not None


async def disable_poll_trigger_with_contract_error(
    db: AsyncSession, *, trigger_id: UUID, now: datetime, error: str
) -> None:
    """Disable a poll trigger on a permanent contract violation (spec §10.3):
    ``has_more=true`` with a null or unchanged cursor. Unlike a schedule
    trigger's ``disable_trigger_with_reason`` (``last_skip_reason``), a poll
    trigger's error surface is ``last_poll_error`` — one column every poll
    failure uses. Re-polling would reproduce the identical error forever (the
    endpoint's contract, not a transient fault), so this is a hard stop.
    """

    row = await db.get(WorkflowTrigger, trigger_id)
    if row is None:
        return
    row.enabled = False
    row.last_poll_at = now
    row.last_poll_error = error
    row.updated_at = now
    await db.flush()
