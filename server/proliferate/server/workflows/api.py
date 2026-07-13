"""Authenticated API for personal workflow definitions."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.workflows.access import WorkflowDefinitionDependency
from proliferate.server.workflows.models import (
    WorkflowDefinitionCreateRequest,
    WorkflowDefinitionListResponse,
    WorkflowDefinitionResponse,
    WorkflowDefinitionUpdateRequest,
    workflow_definition_response,
)
from proliferate.server.workflows.service import (
    create_workflow_definition,
    delete_workflow_definition,
    list_workflow_definitions,
    update_workflow_definition,
)

router = APIRouter(prefix="/workflows", tags=["workflows"])


@router.get(
    "",
    response_model=WorkflowDefinitionListResponse,
    response_model_exclude_unset=True,
)
async def list_workflow_definitions_endpoint(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> WorkflowDefinitionListResponse:
    values = await list_workflow_definitions(db, user_id=user.id)
    return WorkflowDefinitionListResponse(
        workflows=[workflow_definition_response(value) for value in values]
    )


@router.post(
    "",
    response_model=WorkflowDefinitionResponse,
    response_model_exclude_unset=True,
    status_code=status.HTTP_201_CREATED,
)
async def create_workflow_definition_endpoint(
    body: WorkflowDefinitionCreateRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> WorkflowDefinitionResponse:
    value = await create_workflow_definition(db, user_id=user.id, body=body)
    return workflow_definition_response(value)


@router.get(
    "/{workflow_definition_id}",
    response_model=WorkflowDefinitionResponse,
    response_model_exclude_unset=True,
)
async def get_workflow_definition_endpoint(
    definition: WorkflowDefinitionDependency,
) -> WorkflowDefinitionResponse:
    return workflow_definition_response(definition)


@router.put(
    "/{workflow_definition_id}",
    response_model=WorkflowDefinitionResponse,
    response_model_exclude_unset=True,
)
async def update_workflow_definition_endpoint(
    body: WorkflowDefinitionUpdateRequest,
    definition: WorkflowDefinitionDependency,
    db: AsyncSession = Depends(get_async_session),
) -> WorkflowDefinitionResponse:
    value = await update_workflow_definition(db, current=definition, body=body)
    return workflow_definition_response(value)


@router.delete("/{workflow_definition_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workflow_definition_endpoint(
    expected_revision: Annotated[int, Query(alias="expectedRevision", ge=1)],
    definition: WorkflowDefinitionDependency,
    db: AsyncSession = Depends(get_async_session),
) -> Response:
    await delete_workflow_definition(
        db,
        current=definition,
        expected_revision=expected_revision,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
