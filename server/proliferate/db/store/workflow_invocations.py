"""Persistence for immutable, user-owned workflow invocations."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.workflows import WorkflowInvocation


@dataclass(frozen=True)
class WorkflowInvocationSnapshot:
    id: UUID
    user_id: UUID
    workflow_definition_id: UUID
    definition_revision: int
    title_snapshot: str
    description_snapshot: str
    schema_version: int
    creation_request_json: dict[str, object]
    invocation_json: dict[str, object]
    created_at: datetime
    updated_at: datetime


def _snapshot(row: WorkflowInvocation) -> WorkflowInvocationSnapshot:
    return WorkflowInvocationSnapshot(
        id=row.id,
        user_id=row.user_id,
        workflow_definition_id=row.workflow_definition_id,
        definition_revision=row.definition_revision,
        title_snapshot=row.title_snapshot,
        description_snapshot=row.description_snapshot,
        schema_version=row.schema_version,
        creation_request_json=deepcopy(row.creation_request_json),
        invocation_json=deepcopy(row.invocation_json),
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def acquire_workflow_invocation_acceptance_lock(
    db: AsyncSession,
    *,
    invocation_id: UUID,
) -> None:
    """Serialize acceptance for one caller-supplied UUID for this transaction."""

    await db.execute(
        text(
            "SELECT pg_advisory_xact_lock("
            "hashtextextended('workflow-invocation:' || CAST(:invocation_id AS text), 0))"
        ),
        {"invocation_id": str(invocation_id)},
    )


async def get_workflow_invocation_global(
    db: AsyncSession,
    *,
    invocation_id: UUID,
) -> WorkflowInvocationSnapshot | None:
    row = (
        await db.execute(select(WorkflowInvocation).where(WorkflowInvocation.id == invocation_id))
    ).scalar_one_or_none()
    return None if row is None else _snapshot(row)


async def get_workflow_invocation_for_user(
    db: AsyncSession,
    *,
    invocation_id: UUID,
    user_id: UUID,
) -> WorkflowInvocationSnapshot | None:
    row = (
        await db.execute(
            select(WorkflowInvocation).where(
                WorkflowInvocation.id == invocation_id,
                WorkflowInvocation.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    return None if row is None else _snapshot(row)


async def create_workflow_invocation(
    db: AsyncSession,
    *,
    invocation_id: UUID,
    user_id: UUID,
    workflow_definition_id: UUID,
    definition_revision: int,
    title_snapshot: str,
    description_snapshot: str,
    creation_request_json: dict[str, object],
    invocation_json: dict[str, object],
    created_at: datetime,
) -> WorkflowInvocationSnapshot:
    row = WorkflowInvocation(
        id=invocation_id,
        user_id=user_id,
        workflow_definition_id=workflow_definition_id,
        definition_revision=definition_revision,
        title_snapshot=title_snapshot,
        description_snapshot=description_snapshot,
        schema_version=1,
        creation_request_json=deepcopy(creation_request_json),
        invocation_json=deepcopy(invocation_json),
        created_at=created_at,
        updated_at=created_at,
    )
    db.add(row)
    await db.flush()
    return _snapshot(row)
