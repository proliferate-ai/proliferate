"""Authenticated API for personal workflow definitions."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.workflows.access import (
    WorkflowDefinitionDependency,
    WorkflowInvocationDependency,
)
from proliferate.server.workflows.models_v2 import (
    WorkflowDefinitionCreateRequestV2,
    WorkflowDefinitionListResponseV2,
    WorkflowDefinitionResponseV2,
    WorkflowDefinitionUpdateRequestV2,
    WorkflowInvocationCreateRequestV2,
    WorkflowInvocationResponseV2,
    workflow_definition_response_v2,
    workflow_invocation_response_v2,
)
from proliferate.server.workflows.service import (
    delete_workflow_definition,
    list_workflow_definitions,
)
from proliferate.server.workflows.service_v2 import (
    create_workflow_definition_v2,
    put_workflow_invocation_v2,
    update_workflow_definition_v2,
)

router = APIRouter(prefix="/workflows", tags=["workflows"])
invocations_router = APIRouter(prefix="/workflow-invocations", tags=["workflow-invocations"])


@router.get(
    "",
    response_model=WorkflowDefinitionListResponseV2,
    response_model_exclude_unset=True,
)
async def list_workflow_definitions_endpoint(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> WorkflowDefinitionListResponseV2:
    values = await list_workflow_definitions(db, user_id=user.id)
    return WorkflowDefinitionListResponseV2(
        workflows=[workflow_definition_response_v2(value) for value in values]
    )


@router.post(
    "",
    response_model=WorkflowDefinitionResponseV2,
    response_model_exclude_unset=True,
    status_code=status.HTTP_201_CREATED,
)
async def create_workflow_definition_endpoint(
    body: WorkflowDefinitionCreateRequestV2,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> WorkflowDefinitionResponseV2:
    return workflow_definition_response_v2(
        await create_workflow_definition_v2(db, user_id=user.id, body=body)
    )


@router.get(
    "/{workflow_definition_id}",
    response_model=WorkflowDefinitionResponseV2,
    response_model_exclude_unset=True,
)
async def get_workflow_definition_endpoint(
    definition: WorkflowDefinitionDependency,
) -> WorkflowDefinitionResponseV2:
    return workflow_definition_response_v2(definition)


@router.put(
    "/{workflow_definition_id}",
    response_model=WorkflowDefinitionResponseV2,
    response_model_exclude_unset=True,
)
async def update_workflow_definition_endpoint(
    body: WorkflowDefinitionUpdateRequestV2,
    definition: WorkflowDefinitionDependency,
    db: AsyncSession = Depends(get_async_session),
) -> WorkflowDefinitionResponseV2:
    return workflow_definition_response_v2(
        await update_workflow_definition_v2(db, current=definition, body=body)
    )


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


@invocations_router.put(
    "/{invocation_id}",
    responses={
        status.HTTP_200_OK: {"model": WorkflowInvocationResponseV2},
        status.HTTP_201_CREATED: {"model": WorkflowInvocationResponseV2},
    },
)
async def put_workflow_invocation_endpoint(
    invocation_id: str,
    body: WorkflowInvocationCreateRequestV2,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> JSONResponse:
    result = await put_workflow_invocation_v2(
        db,
        invocation_id_text=invocation_id,
        user_id=user.id,
        body=body,
    )
    response = workflow_invocation_response_v2(result.value)
    return JSONResponse(
        status_code=status.HTTP_201_CREATED if result.created else status.HTTP_200_OK,
        content=response.frozen_json(),
    )


@invocations_router.get(
    "/{invocation_id}",
    response_model=WorkflowInvocationResponseV2,
)
async def get_workflow_invocation_endpoint(
    invocation: WorkflowInvocationDependency,
) -> JSONResponse:
    frozen = workflow_invocation_response_v2(invocation)
    return JSONResponse(content=frozen.frozen_json())
