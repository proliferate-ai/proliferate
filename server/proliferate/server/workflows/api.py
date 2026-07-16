"""Authenticated API for personal workflow definitions."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

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
from proliferate.server.workflows.managed import (
    cancel_managed_workflow,
    deliver_managed_workflow,
    list_managed_workflow_history,
    read_managed_workflow,
)
from proliferate.server.workflows.managed_models import (
    ManagedWorkflowHistoryResponse,
    ManagedWorkflowInvocationResponse,
    managed_workflow_invocation_payload,
    managed_workflow_invocation_response,
    workflow_history_item_response,
)
from proliferate.server.workflows.models import (
    WorkflowDefinitionCreateRequest,
    WorkflowDefinitionListResponse,
    WorkflowDefinitionResponse,
    WorkflowDefinitionUpdateRequest,
    WorkflowInvocationCreateRequest,
    WorkflowInvocationResponse,
    WorkflowRunEligibilityBlocker,
    WorkflowRunEligibilityResponse,
    workflow_definition_response,
    workflow_invocation_response,
)
from proliferate.server.workflows.service import (
    create_workflow_definition,
    delete_workflow_definition,
    list_workflow_definitions,
    put_workflow_invocation,
    update_workflow_definition,
    workflow_run_eligibility,
)

router = APIRouter(prefix="/workflows", tags=["workflows"])
invocations_router = APIRouter(prefix="/workflow-invocations", tags=["workflow-invocations"])


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
    "/{workflow_definition_id}/run-eligibility",
    response_model=WorkflowRunEligibilityResponse,
)
async def get_workflow_run_eligibility_endpoint(
    definition: WorkflowDefinitionDependency,
    db: AsyncSession = Depends(get_async_session),
) -> WorkflowRunEligibilityResponse:
    blockers = await workflow_run_eligibility(db, definition=definition)
    return WorkflowRunEligibilityResponse(
        eligible=not blockers,
        blockers=[
            WorkflowRunEligibilityBlocker(
                code=blocker.code,
                path=blocker.path,
                message=blocker.message,
            )
            for blocker in blockers
        ],
    )


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


@invocations_router.put(
    "/{invocation_id}",
    response_model=WorkflowInvocationResponse,
    response_model_exclude_none=True,
    responses={
        status.HTTP_200_OK: {"model": WorkflowInvocationResponse},
        status.HTTP_201_CREATED: {"model": WorkflowInvocationResponse},
    },
)
async def put_workflow_invocation_endpoint(
    invocation_id: str,
    body: WorkflowInvocationCreateRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> JSONResponse:
    result = await put_workflow_invocation(
        db,
        invocation_id_text=invocation_id,
        user_id=user.id,
        body=body,
    )
    response = workflow_invocation_response(result.value)
    return JSONResponse(
        status_code=status.HTTP_201_CREATED if result.created else status.HTTP_200_OK,
        content=response.model_dump(by_alias=True, mode="json", exclude_none=True),
    )


@invocations_router.get(
    "",
    response_model=ManagedWorkflowHistoryResponse,
)
async def list_workflow_invocation_history_endpoint(
    workflow_definition_id: Annotated[UUID, Query(alias="workflowDefinitionId")],
    cursor: str | None = Query(default=None),
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> ManagedWorkflowHistoryResponse:
    values, next_cursor = await list_managed_workflow_history(
        db,
        user_id=user.id,
        workflow_definition_id=workflow_definition_id,
        cursor_text=cursor,
    )
    return ManagedWorkflowHistoryResponse(
        items=[
            workflow_history_item_response(item, freshness=freshness) for item, freshness in values
        ],
        next_cursor=next_cursor,
    )


@invocations_router.get(
    "/{invocation_id}",
    response_model=ManagedWorkflowInvocationResponse,
)
async def get_workflow_invocation_endpoint(
    invocation: WorkflowInvocationDependency,
    db: AsyncSession = Depends(get_async_session),
) -> JSONResponse:
    value = await read_managed_workflow(db, invocation=invocation)
    response = managed_workflow_invocation_response(
        value.invocation,
        value.managed,
        freshness=value.freshness,
        open_target_available=value.open_target_available,
    )
    return JSONResponse(content=managed_workflow_invocation_payload(response))


@invocations_router.post(
    "/{invocation_id}/deliver",
    response_model=ManagedWorkflowInvocationResponse,
)
async def deliver_workflow_invocation_endpoint(
    invocation: WorkflowInvocationDependency,
    db: AsyncSession = Depends(get_async_session),
) -> JSONResponse:
    value = await deliver_managed_workflow(db, invocation=invocation)
    response = managed_workflow_invocation_response(
        value.invocation,
        value.managed,
        freshness=value.freshness,
        open_target_available=value.open_target_available,
    )
    return JSONResponse(content=managed_workflow_invocation_payload(response))


@invocations_router.post(
    "/{invocation_id}/cancel",
    response_model=ManagedWorkflowInvocationResponse,
)
async def cancel_workflow_invocation_endpoint(
    invocation: WorkflowInvocationDependency,
    db: AsyncSession = Depends(get_async_session),
) -> JSONResponse:
    value = await cancel_managed_workflow(db, invocation=invocation)
    response = managed_workflow_invocation_response(
        value.invocation,
        value.managed,
        freshness=value.freshness,
        open_target_available=value.open_target_available,
    )
    return JSONResponse(content=managed_workflow_invocation_payload(response))
