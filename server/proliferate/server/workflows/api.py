"""Authenticated API for personal workflow definitions."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
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
    get_workflow_definition,
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
    workflow_definition_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> WorkflowDefinitionResponse:
    value = await get_workflow_definition(
        db,
        user_id=user.id,
        workflow_definition_id=workflow_definition_id,
    )
    return workflow_definition_response(value)


@router.put(
    "/{workflow_definition_id}",
    response_model=WorkflowDefinitionResponse,
    response_model_exclude_unset=True,
)
async def update_workflow_definition_endpoint(
    workflow_definition_id: UUID,
    body: WorkflowDefinitionUpdateRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> WorkflowDefinitionResponse:
    value = await update_workflow_definition(
        db,
        user_id=user.id,
        workflow_definition_id=workflow_definition_id,
        body=body,
    )
    return workflow_definition_response(value)


@router.delete("/{workflow_definition_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workflow_definition_endpoint(
    workflow_definition_id: UUID,
    expected_revision: Annotated[int, Query(alias="expectedRevision", ge=1)],
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> Response:
    await delete_workflow_definition(
        db,
        user_id=user.id,
        workflow_definition_id=workflow_definition_id,
        expected_revision=expected_revision,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
