"""Persistence helpers for immutable workflow invocation rows.

`workflow_invocation` is immutable after insert — this module exposes no
update path for it. The definition snapshot, arguments, frozen placement,
and resolved bundle are retained so later definition edits or deletions can
never redirect the run (PR2 design §7.1). Delivery-state transitions live in
`workflow_deliveries`; loss proofs in `workflow_delivery_loss`.

Digest-covered documents are stored as RFC 8785 canonical JSON text and
parsed with the canonical replay loader on read — see
`workflow_delivery_custody` for why JSONB is forbidden here.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy import text as sql_text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.workflows import WorkflowInvocation, WorkflowInvocationDelivery
from proliferate.db.store.workflow_delivery_custody import (
    WorkflowDeliverySnapshot,
    WorkflowInvocationSnapshot,
    delivery_snapshot,
    invocation_snapshot,
)
from proliferate.utils.canonical_json import canonical_json
from proliferate.utils.time import utcnow


async def acquire_invocation_idempotency_lock(
    db: AsyncSession,
    *,
    user_id: UUID,
    idempotency_key: str,
) -> None:
    """Serialize concurrent first requests for one (user, idempotency key).

    Transaction-scoped advisory lock taken before the first idempotency
    SELECT: the loser blocks until the winner's transaction commits, then
    observes the committed row and replays it instead of resolving mutable
    definition/repository state a second time. Releases on commit/rollback.
    """

    await db.execute(
        sql_text("SELECT pg_advisory_xact_lock(hashtextextended(:lock_key, 0))"),
        {"lock_key": f"workflow_invocation:{user_id}:{idempotency_key}"},
    )


async def insert_workflow_invocation(
    db: AsyncSession,
    *,
    invocation_id: UUID,
    user_id: UUID,
    workflow_definition_id: UUID | None,
    definition_revision: int,
    definition_schema_version: int,
    validated_catalog_version: str,
    title_snapshot: str,
    idempotency_key: str,
    request_hash: str,
    arguments_json: dict[str, object],
    resolved_bundle_json: dict[str, object],
    bundle_digest: str,
    target_kind: str,
    desktop_install_id: str | None,
    logical_placement_json: dict[str, object],
    resolved_placement_json: dict[str, object],
) -> WorkflowInvocationSnapshot | None:
    """Insert immutably; ``None`` means a concurrent request won the key.

    ``ON CONFLICT DO NOTHING`` on the ``(user_id, idempotency_key)`` unique
    constraint keeps the caller-owned transaction alive so the loser can
    reload the winning row and classify replay versus conflict.
    """

    inserted_id = await db.scalar(
        pg_insert(WorkflowInvocation)
        .values(
            id=invocation_id,
            user_id=user_id,
            workflow_definition_id=workflow_definition_id,
            definition_revision=definition_revision,
            definition_schema_version=definition_schema_version,
            validated_catalog_version=validated_catalog_version,
            title_snapshot=title_snapshot,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
            arguments_json=canonical_json(arguments_json),
            resolved_bundle_json=canonical_json(resolved_bundle_json),
            bundle_digest=bundle_digest,
            target_kind=target_kind,
            desktop_install_id=desktop_install_id,
            logical_placement_json=canonical_json(logical_placement_json),
            resolved_placement_json=canonical_json(resolved_placement_json),
            created_at=utcnow(),
        )
        .on_conflict_do_nothing(
            constraint="ux_workflow_invocation_user_idempotency_key",
        )
        .returning(WorkflowInvocation.id)
    )
    await db.flush()
    if inserted_id is None:
        return None
    row = (
        await db.execute(select(WorkflowInvocation).where(WorkflowInvocation.id == inserted_id))
    ).scalar_one()
    return invocation_snapshot(row)


async def get_workflow_invocation_by_idempotency_key(
    db: AsyncSession,
    *,
    user_id: UUID,
    idempotency_key: str,
) -> WorkflowInvocationSnapshot | None:
    row = (
        await db.execute(
            select(WorkflowInvocation).where(
                WorkflowInvocation.user_id == user_id,
                WorkflowInvocation.idempotency_key == idempotency_key,
            )
        )
    ).scalar_one_or_none()
    return None if row is None else invocation_snapshot(row)


async def get_workflow_invocation(
    db: AsyncSession,
    *,
    user_id: UUID,
    invocation_id: UUID,
) -> WorkflowInvocationSnapshot | None:
    row = (
        await db.execute(
            select(WorkflowInvocation).where(
                WorkflowInvocation.id == invocation_id,
                WorkflowInvocation.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    return None if row is None else invocation_snapshot(row)


async def list_workflow_invocations(
    db: AsyncSession,
    *,
    user_id: UUID,
    workflow_definition_id: UUID | None = None,
    limit: int = 50,
) -> tuple[tuple[WorkflowInvocationSnapshot, WorkflowDeliverySnapshot], ...]:
    statement = (
        select(WorkflowInvocation, WorkflowInvocationDelivery)
        .join(
            WorkflowInvocationDelivery,
            WorkflowInvocationDelivery.invocation_id == WorkflowInvocation.id,
        )
        .where(WorkflowInvocation.user_id == user_id)
        .order_by(WorkflowInvocation.created_at.desc(), WorkflowInvocation.id.desc())
        .limit(limit)
    )
    if workflow_definition_id is not None:
        statement = statement.where(
            WorkflowInvocation.workflow_definition_id == workflow_definition_id
        )
    rows = (await db.execute(statement)).all()
    return tuple(
        (invocation_snapshot(invocation), delivery_snapshot(delivery))
        for invocation, delivery in rows
    )
