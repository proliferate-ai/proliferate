"""Application service for personal workflow definitions.

Owns the schema-version-independent definition operations (list, soft
delete) and the invocation PUT result shape. The gen-2 create/update and
invocation-freeze services live in ``service_v2``.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import workflow_definitions as workflow_store
from proliferate.db.store.workflow_definitions import WorkflowDefinitionSnapshot
from proliferate.db.store.workflow_invocations import WorkflowInvocationSnapshot
from proliferate.server.workflows.errors import (
    WorkflowDefinitionRevisionConflict,
)


@dataclass(frozen=True)
class WorkflowInvocationPutResult:
    value: WorkflowInvocationSnapshot
    created: bool


async def list_workflow_definitions(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> tuple[WorkflowDefinitionSnapshot, ...]:
    return await workflow_store.list_workflow_definitions(db, user_id=user_id)


async def delete_workflow_definition(
    db: AsyncSession,
    *,
    current: WorkflowDefinitionSnapshot,
    expected_revision: int,
) -> None:
    deleted = await workflow_store.soft_delete_workflow_definition_if_revision(
        db,
        user_id=current.user_id,
        workflow_definition_id=current.id,
        expected_revision=expected_revision,
    )
    if deleted is not None:
        return
    latest = await workflow_store.get_workflow_definition(
        db,
        user_id=current.user_id,
        workflow_definition_id=current.id,
    )
    raise WorkflowDefinitionRevisionConflict(
        expected_revision=expected_revision,
        current_revision=None if latest is None else latest.revision,
    )
