"""Resource-access dependencies for personal workflow definitions.

Route handlers depend on :func:`workflow_definition_for_user` to receive a
pre-authorized definition snapshot; services never re-run route-resource
authorization (specs/codebase/structures/server/guides/auth.md).
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.db.store import workflow_definitions as workflow_store
from proliferate.db.store.workflow_definitions import WorkflowDefinitionSnapshot
from proliferate.server.workflows.errors import WorkflowDefinitionNotFound


async def workflow_definition_for_user(
    workflow_definition_id: UUID,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> WorkflowDefinitionSnapshot:
    """Resolve the route's definition owner-scoped, without enumeration.

    Definitions owned by another user answer with the same not-found error as
    definitions that do not exist.
    """

    value = await workflow_store.get_workflow_definition(
        db,
        user_id=user.id,
        workflow_definition_id=workflow_definition_id,
    )
    if value is None:
        raise WorkflowDefinitionNotFound()
    return value


WorkflowDefinitionDependency = Annotated[
    WorkflowDefinitionSnapshot,
    Depends(workflow_definition_for_user),
]
