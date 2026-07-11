"""Persistence boundary for materialization offers and binding acceptance."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.workflow_identity import WorkflowMaterializationOffer
from proliferate.db.models.cloud.workflows import WorkflowRun

BindingCasResult = Literal["accepted", "retry", "conflict", "legacy_partial", "not_found"]


def _same_json_value(left: object, right: object) -> bool:
    if type(left) is not type(right):
        return False
    if isinstance(left, dict):
        if not isinstance(right, dict):
            return False
        return left.keys() == right.keys() and all(
            _same_json_value(left[key], right[key]) for key in left
        )
    if isinstance(left, list):
        if not isinstance(right, list):
            return False
        return len(left) == len(right) and all(
            _same_json_value(a, b) for a, b in zip(left, right, strict=True)
        )
    return left == right


@dataclass(frozen=True)
class MaterializationOfferRecord:
    id: UUID
    workflow_run_id: UUID
    plan_hash: str
    execution_generation: int
    executor_id: str
    executor_fence: str
    workspace_id: str
    workspace_generation: int
    executor_generation: int
    audience: str
    credential_generation: int
    credential_salt: str
    credential_hash: str
    status: str
    expires_at: datetime
    consumed_at: datetime | None
    accepted_binding_hash: str | None
    created_at: datetime
    updated_at: datetime


def _record(row: WorkflowMaterializationOffer) -> MaterializationOfferRecord:
    return MaterializationOfferRecord(
        id=row.id,
        workflow_run_id=row.workflow_run_id,
        plan_hash=row.plan_hash,
        execution_generation=row.execution_generation,
        executor_id=row.executor_id,
        executor_fence=row.executor_fence,
        workspace_id=row.workspace_id,
        workspace_generation=row.workspace_generation,
        executor_generation=row.executor_generation,
        audience=row.audience,
        credential_generation=row.credential_generation,
        credential_salt=row.credential_salt,
        credential_hash=row.credential_hash,
        status=row.status,
        expires_at=row.expires_at,
        consumed_at=row.consumed_at,
        accepted_binding_hash=row.accepted_binding_hash,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def lock_pending_offer(
    db: AsyncSession,
    *,
    workflow_run_id: UUID,
) -> MaterializationOfferRecord | None:
    stmt = select(WorkflowMaterializationOffer).where(
        WorkflowMaterializationOffer.workflow_run_id == workflow_run_id,
        WorkflowMaterializationOffer.status == "pending",
    )
    row = await db.scalar(
        stmt.order_by(WorkflowMaterializationOffer.execution_generation.desc())
        .limit(1)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return None if row is None else _record(row)


async def next_offer_generation(db: AsyncSession, *, workflow_run_id: UUID) -> int:
    latest = await db.scalar(
        select(func.max(WorkflowMaterializationOffer.execution_generation)).where(
            WorkflowMaterializationOffer.workflow_run_id == workflow_run_id
        )
    )
    return int(latest or 0) + 1


async def create_offer(
    db: AsyncSession,
    *,
    offer_id: UUID,
    workflow_run_id: UUID,
    plan_hash: str,
    execution_generation: int,
    executor_id: str,
    executor_fence: str,
    workspace_id: str,
    workspace_generation: int,
    executor_generation: int,
    audience: str,
    credential_salt: str,
    credential_hash: str,
    expires_at: datetime,
    now: datetime,
) -> MaterializationOfferRecord:
    row = WorkflowMaterializationOffer(
        id=offer_id,
        workflow_run_id=workflow_run_id,
        plan_hash=plan_hash,
        execution_generation=execution_generation,
        executor_id=executor_id,
        executor_fence=executor_fence,
        workspace_id=workspace_id,
        workspace_generation=workspace_generation,
        executor_generation=executor_generation,
        audience=audience,
        credential_generation=1,
        credential_salt=credential_salt,
        credential_hash=credential_hash,
        status="pending",
        expires_at=expires_at,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    await db.flush()
    return _record(row)


async def rotate_offer_credential(
    db: AsyncSession,
    *,
    offer_id: UUID,
    credential_salt: str,
    credential_hash: str,
    expires_at: datetime,
    now: datetime,
) -> MaterializationOfferRecord:
    row = await db.get(WorkflowMaterializationOffer, offer_id)
    assert row is not None
    row.credential_generation += 1
    row.credential_salt = credential_salt
    row.credential_hash = credential_hash
    row.expires_at = expires_at
    row.updated_at = now
    await db.flush()
    return _record(row)


async def revoke_offer(
    db: AsyncSession,
    *,
    offer_id: UUID,
    now: datetime,
) -> None:
    await db.execute(
        update(WorkflowMaterializationOffer)
        .where(
            WorkflowMaterializationOffer.id == offer_id,
            WorkflowMaterializationOffer.status == "pending",
        )
        .values(status="revoked", updated_at=now)
    )
    await db.flush()


async def lock_offer_by_id(db: AsyncSession, offer_id: UUID) -> MaterializationOfferRecord | None:
    row = await db.scalar(
        select(WorkflowMaterializationOffer)
        .where(WorkflowMaterializationOffer.id == offer_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return None if row is None else _record(row)


async def get_offer_by_id(db: AsyncSession, offer_id: UUID) -> MaterializationOfferRecord | None:
    row = await db.get(WorkflowMaterializationOffer, offer_id)
    return None if row is None else _record(row)


async def get_consumed_offer_for_binding(
    db: AsyncSession,
    *,
    workflow_run_id: UUID,
    execution_generation: int,
) -> MaterializationOfferRecord | None:
    row = await db.scalar(
        select(WorkflowMaterializationOffer).where(
            WorkflowMaterializationOffer.workflow_run_id == workflow_run_id,
            WorkflowMaterializationOffer.execution_generation == execution_generation,
            WorkflowMaterializationOffer.status == "consumed",
        )
    )
    return None if row is None else _record(row)


async def mark_run_materializing(db: AsyncSession, *, run_id: UUID, now: datetime) -> None:
    await db.execute(
        update(WorkflowRun)
        .where(WorkflowRun.id == run_id)
        .values(delivery_state="materializing", updated_at=now)
    )
    await db.flush()


async def accept_binding_cas(
    db: AsyncSession,
    *,
    run_id: UUID,
    plan_hash: str,
    binding_hash: str,
    execution_generation: int,
    binding_json: dict[str, object],
    now: datetime,
) -> BindingCasResult:
    """Exactly-one immutable binding CAS.

    All-NULL is the only writable state. A partial legacy identity is parked
    and can never be completed by guessing the missing fields.
    """

    result = await db.execute(
        update(WorkflowRun)
        .where(
            WorkflowRun.id == run_id,
            WorkflowRun.plan_hash == plan_hash,
            WorkflowRun.binding_hash.is_(None),
            WorkflowRun.execution_generation.is_(None),
            WorkflowRun.execution_binding_json.is_(None),
        )
        .values(
            binding_hash=binding_hash,
            execution_generation=execution_generation,
            execution_binding_json=binding_json,
            delivery_state="materializing",
            updated_at=now,
        )
        .returning(WorkflowRun.id)
    )
    if result.scalar_one_or_none() is not None:
        return "accepted"

    row = await db.scalar(
        select(WorkflowRun)
        .where(WorkflowRun.id == run_id)
        .execution_options(populate_existing=True)
    )
    if row is None:
        return "not_found"
    fields = (row.binding_hash, row.execution_generation, row.execution_binding_json)
    if any(value is None for value in fields) and any(value is not None for value in fields):
        return "legacy_partial"
    if (
        row.plan_hash == plan_hash
        and row.binding_hash == binding_hash
        and row.execution_generation == execution_generation
        and row.execution_binding_json is not None
        and _same_json_value(row.execution_binding_json, binding_json)
    ):
        return "retry"
    return "conflict"


async def consume_offer(
    db: AsyncSession,
    *,
    offer_id: UUID,
    accepted_binding_hash: str,
    now: datetime,
) -> bool:
    result = await db.execute(
        update(WorkflowMaterializationOffer)
        .where(
            WorkflowMaterializationOffer.id == offer_id,
            WorkflowMaterializationOffer.status == "pending",
        )
        .values(
            status="consumed",
            consumed_at=now,
            accepted_binding_hash=accepted_binding_hash,
            updated_at=now,
        )
        .returning(WorkflowMaterializationOffer.id)
    )
    await db.flush()
    return result.scalar_one_or_none() is not None
