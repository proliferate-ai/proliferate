"""Durable workflow control commands (spec §8.3).

Control commands (cancel, ...) are durable rows with explicit delivery/ack state,
never a best-effort HTTP call. Split from the outbox substrate: this is the §8.3
command lifecycle, the generation-fenced outbox lives in ``outbox.py``.
"""

from __future__ import annotations

from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.workflow_ledger import WorkflowControlCommand
from proliferate.db.store.workflow_ledger.records import ControlCommandRecord, record_command
from proliferate.utils.time import utcnow


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
