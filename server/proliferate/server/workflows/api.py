"""Authenticated API for personal workflow definitions."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.workflows.models import (
    WorkflowDefinitionCreateRequest,
    WorkflowDefinitionListResponse,
    WorkflowDefinitionResponse,
    WorkflowDefinitionUpdateRequest,
    WorkflowInvocationCreateRequest,
    WorkflowInvocationDetailResponse,
    WorkflowInvocationListResponse,
    WorkflowInvocationResponse,
    workflow_definition_response,
    workflow_invocation_detail_response,
    workflow_invocation_response,
)
from proliferate.server.workflows.service import (
    abandon_workflow_invocation,
    cancel_workflow_invocation,
    create_workflow_definition,
    create_workflow_invocation,
    delete_workflow_definition,
    get_workflow_definition,
    get_workflow_invocation,
    list_workflow_definitions,
    list_workflow_invocations,
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


# Invocation routes with literal segments register before the
# `/{workflow_definition_id}` routes below; Starlette matches in
# registration order, so `/workflows/invocations` must not be captured by
# the definition path parameter.


@router.get(
    "/invocations",
    response_model=WorkflowInvocationListResponse,
    response_model_exclude_unset=True,
)
async def list_workflow_invocations_endpoint(
    workflow_definition_id: Annotated[UUID | None, Query(alias="workflowDefinitionId")] = None,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> WorkflowInvocationListResponse:
    values = await list_workflow_invocations(
        db,
        user_id=user.id,
        workflow_definition_id=workflow_definition_id,
    )
    return WorkflowInvocationListResponse(
        invocations=[
            workflow_invocation_response(invocation, delivery) for invocation, delivery in values
        ]
    )


@router.get(
    "/invocations/{invocation_id}",
    response_model=WorkflowInvocationDetailResponse,
    response_model_exclude_unset=True,
)
async def get_workflow_invocation_endpoint(
    invocation_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> WorkflowInvocationDetailResponse:
    invocation, delivery = await get_workflow_invocation(
        db, user_id=user.id, invocation_id=invocation_id
    )
    return workflow_invocation_detail_response(invocation, delivery)


@router.post(
    "/invocations/{invocation_id}/cancel",
    response_model=WorkflowInvocationResponse,
    response_model_exclude_unset=True,
)
async def cancel_workflow_invocation_endpoint(
    invocation_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> WorkflowInvocationResponse:
    invocation, delivery = await cancel_workflow_invocation(
        db, user_id=user.id, invocation_id=invocation_id
    )
    return workflow_invocation_response(invocation, delivery)


@router.post(
    "/invocations/{invocation_id}/abandon-controlled-sessions",
    response_model=WorkflowInvocationResponse,
    response_model_exclude_unset=True,
    status_code=status.HTTP_202_ACCEPTED,
)
async def abandon_workflow_invocation_endpoint(
    invocation_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> WorkflowInvocationResponse:
    invocation, delivery = await abandon_workflow_invocation(
        db, user_id=user.id, invocation_id=invocation_id
    )
    return workflow_invocation_response(invocation, delivery)


@router.post(
    "/{workflow_definition_id}/invocations",
    response_model=WorkflowInvocationResponse,
    response_model_exclude_unset=True,
    status_code=status.HTTP_201_CREATED,
)
async def create_workflow_invocation_endpoint(
    workflow_definition_id: UUID,
    body: WorkflowInvocationCreateRequest,
    response: Response,
    idempotency_key: Annotated[
        str,
        Header(alias="Idempotency-Key", min_length=1, max_length=255),
    ],
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> WorkflowInvocationResponse:
    invocation, delivery, created = await create_workflow_invocation(
        db,
        user_id=user.id,
        workflow_definition_id=workflow_definition_id,
        idempotency_key=idempotency_key,
        body=body,
    )
    if not created:
        response.status_code = status.HTTP_200_OK
    return workflow_invocation_response(invocation, delivery)


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
