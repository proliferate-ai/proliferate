"""Transactional outbox + durable control commands (spec §6 WF-6, §8.3, §10.2).

The run intent and its outbox row commit in one transaction; a relay claims
``pending`` rows after commit. Control commands (cancel, ...) are durable rows
with explicit delivery/ack state — never a best-effort HTTP call.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.workflow_ledger import (
    WorkflowControlCommand,
    WorkflowRunOutbox,
)
from proliferate.db.store.workflow_ledger.records import (
    ControlCommandRecord,
    OutboxRecord,
    record_command,
    record_outbox,
)
from proliferate.utils.time import utcnow


async def enqueue_outbox(
    db: AsyncSession,
    *,
    kind: str,
    payload_json: dict[str, object],
    run_id: UUID | None = None,
    trigger_id: UUID | None = None,
    next_attempt_at: datetime | None = None,
) -> OutboxRecord:
    """Insert a pending outbox row inside the caller's transaction."""

    now = utcnow()
    row = WorkflowRunOutbox(
        id=uuid4(),
        run_id=run_id,
        trigger_id=trigger_id,
        kind=kind,
        payload_json=payload_json,
        status="pending",
        attempt_count=0,
        next_attempt_at=next_attempt_at or now,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    await db.flush()
    return record_outbox(row)


async def claim_due_outbox_rows(
    db: AsyncSession, *, now: datetime, limit: int
) -> tuple[OutboxRecord, ...]:
    """Claim due pending rows: pending -> delivering under SKIP LOCKED.

    Two concurrent relays never claim the same row: the row lock plus the
    status re-check make each pending row claimable exactly once per cycle.
    """

    rows = list(
        (
            await db.execute(
                select(WorkflowRunOutbox)
                .where(
                    WorkflowRunOutbox.status == "pending",
                    WorkflowRunOutbox.next_attempt_at <= now,
                )
                .order_by(
                    WorkflowRunOutbox.next_attempt_at.asc(),
                    WorkflowRunOutbox.created_at.asc(),
                    WorkflowRunOutbox.id.asc(),
                )
                .limit(max(1, limit))
                .with_for_update(skip_locked=True)
            )
        )
        .scalars()
        .all()
    )
    claimed: list[OutboxRecord] = []
    for row in rows:
        row.status = "delivering"
        row.attempt_count = row.attempt_count + 1
        row.updated_at = now
        claimed.append(record_outbox(row))
    await db.flush()
    return tuple(claimed)


async def complete_outbox_row(
    db: AsyncSession,
    *,
    outbox_id: UUID,
    status: Literal["delivered", "failed", "pending"],
    last_error: str | None = None,
    next_attempt_at: datetime | None = None,
) -> OutboxRecord | None:
    """Finish (or reschedule) a claimed row. Only a ``delivering`` row moves;
    completing an already-terminal row is a no-op returning the current record."""

    row = await db.get(WorkflowRunOutbox, outbox_id)
    if row is None:
        return None
    if row.status == "delivering":
        row.status = status
        row.last_error = last_error
        if next_attempt_at is not None:
            row.next_attempt_at = next_attempt_at
        row.updated_at = utcnow()
        await db.flush()
    return record_outbox(row)


async def get_outbox_row(db: AsyncSession, outbox_id: UUID) -> OutboxRecord | None:
    row = await db.get(WorkflowRunOutbox, outbox_id)
    return None if row is None else record_outbox(row)


# --- control commands (spec §8.3) --------------------------------------------------


async def enqueue_control_command(
    db: AsyncSession,
    *,
    run_id: UUID,
    kind: str = "cancel",
    reason: str | None = None,
    plan_hash: str | None = None,
    binding_hash: str | None = None,
    execution_generation: int | None = None,
) -> ControlCommandRecord:
    now = utcnow()
    row = WorkflowControlCommand(
        id=uuid4(),
        run_id=run_id,
        kind=kind,
        reason=reason,
        plan_hash=plan_hash,
        binding_hash=binding_hash,
        execution_generation=execution_generation,
        status="pending",
        issued_at=now,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    await db.flush()
    return record_command(row)


async def mark_control_command_delivered(
    db: AsyncSession, *, command_id: UUID
) -> ControlCommandRecord | None:
    row = await db.get(WorkflowControlCommand, command_id)
    if row is None:
        return None
    if row.status == "pending":
        now = utcnow()
        row.status = "delivered"
        row.delivered_at = now
        row.updated_at = now
        await db.flush()
    return record_command(row)


async def ack_control_command(
    db: AsyncSession, *, command_id: UUID, ack_outcome: str
) -> ControlCommandRecord | None:
    """Record the executor/runtime acknowledgment. Idempotent: a second ack of an
    already-acknowledged command returns the stored record unchanged."""

    row = await db.get(WorkflowControlCommand, command_id)
    if row is None:
        return None
    if row.status in ("pending", "delivered"):
        now = utcnow()
        row.status = "acknowledged"
        row.ack_outcome = ack_outcome
        row.acknowledged_at = now
        row.updated_at = now
        await db.flush()
    return record_command(row)


async def list_undelivered_control_commands(
    db: AsyncSession, *, run_id: UUID
) -> tuple[ControlCommandRecord, ...]:
    rows = (
        (
            await db.execute(
                select(WorkflowControlCommand)
                .where(
                    WorkflowControlCommand.run_id == run_id,
                    WorkflowControlCommand.status.in_(("pending", "delivered")),
                )
                .order_by(WorkflowControlCommand.created_at.asc())
            )
        )
        .scalars()
        .all()
    )
    return tuple(record_command(row) for row in rows)
