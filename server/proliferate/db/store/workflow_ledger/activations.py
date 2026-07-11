"""Required-invocation activation identities (spec §7.3, WS3c).

A ``workflow_activation`` row is the runtime's durable, pre-registered identity
for one required-invocation activation — separate from (and written BEFORE) the
``workflow_gateway_receipt`` row the gateway later writes for the OUTCOME. This
module owns only the mechanical insert/read; idempotent-vs-conflicting-reuse
policy is ``server.cloud.workflows.activation_registration.register_activation``,
and gateway-time trusted-context lookup is
``server.cloud.workflows.activation_receipts``.
"""

from __future__ import annotations

from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.workflow_ledger import WorkflowActivation
from proliferate.db.store.workflow_ledger.records import ActivationRecord, record_activation
from proliferate.utils.time import utcnow


async def insert_activation(
    db: AsyncSession,
    *,
    run_id: UUID,
    plan_hash: str,
    slot_id: str,
    session_id: str,
    step_key: str,
    attempt: int,
    activation_id: str,
    capability_key: str,
    turn_id: str | None = None,
) -> ActivationRecord:
    """Insert one activation identity row. Duplicate ``activation_id`` raises
    ``IntegrityError`` — the caller (``activation_registration.register_activation``)
    owns the idempotent-vs-conflicting-reuse decision by comparing the existing
    row's identity tuple first."""

    row = WorkflowActivation(
        id=uuid4(),
        run_id=run_id,
        plan_hash=plan_hash,
        slot_id=slot_id,
        session_id=session_id,
        step_key=step_key,
        attempt=attempt,
        activation_id=activation_id,
        capability_key=capability_key,
        turn_id=turn_id,
        created_at=utcnow(),
    )
    db.add(row)
    await db.flush()
    return record_activation(row)


async def get_activation_by_id(
    db: AsyncSession, *, activation_id: str
) -> ActivationRecord | None:
    row = (
        await db.execute(
            select(WorkflowActivation).where(WorkflowActivation.activation_id == activation_id)
        )
    ).scalar_one_or_none()
    return None if row is None else record_activation(row)
