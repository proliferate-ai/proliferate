"""HTTP routes for function-invocation CRUD (track 1b phase 3 settings surface).

``router`` (``/integrations/functions``): the owner's own person-scoped
invocations — list, create, edit, rotate headers (write-only), toggle the chat
default-access flag, and archive. Mirrors the ``/integrations`` router's
auth/session pattern; no admin gate — invocations are owned by the acting user.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.integrations.function_invocations.models import (
    CreateFunctionInvocationRequest,
    FunctionInvocationListResponse,
    FunctionInvocationResponse,
    RotateFunctionInvocationHeadersRequest,
    SetFunctionInvocationChatScopeEnabledRequest,
    UpdateFunctionInvocationRequest,
)
from proliferate.server.cloud.integrations.function_invocations.service import (
    UNSET,
    archive_function_invocation,
    create_function_invocation,
    list_function_invocations,
    rotate_function_invocation_headers,
    set_function_invocation_chat_scope_enabled,
    update_function_invocation,
)

router = APIRouter(prefix="/integrations/functions", tags=["function-invocations"])


@router.get("", response_model=FunctionInvocationListResponse)
async def list_function_invocations_endpoint(
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> FunctionInvocationListResponse:
    items = await list_function_invocations(db, owner_user_id=user.id)
    return FunctionInvocationListResponse(items=items)


@router.post("", response_model=FunctionInvocationResponse)
async def create_function_invocation_endpoint(
    body: CreateFunctionInvocationRequest,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> FunctionInvocationResponse:
    return await create_function_invocation(
        db,
        owner_user_id=user.id,
        organization_id=None,
        name=body.name,
        endpoint_url=body.endpoint_url,
        method=body.method,
        args_schema=body.args_schema,
        headers=body.headers,
        display_name=body.display_name,
        description=body.description,
    )


@router.patch("/{name}", response_model=FunctionInvocationResponse)
async def update_function_invocation_endpoint(
    name: str,
    body: UpdateFunctionInvocationRequest,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> FunctionInvocationResponse:
    fields = body.model_dump(exclude_unset=True)
    return await update_function_invocation(
        db,
        owner_user_id=user.id,
        name=name,
        display_name=fields.get("display_name", UNSET),
        description=fields.get("description", UNSET),
        endpoint_url=fields.get("endpoint_url"),
        method=fields.get("method"),
        args_schema=fields.get("args_schema"),
    )


@router.post("/{name}/headers", response_model=FunctionInvocationResponse)
async def rotate_function_invocation_headers_endpoint(
    name: str,
    body: RotateFunctionInvocationHeadersRequest,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> FunctionInvocationResponse:
    return await rotate_function_invocation_headers(
        db, owner_user_id=user.id, name=name, headers=body.headers
    )


@router.patch("/{name}/chat-scope-enabled", response_model=FunctionInvocationResponse)
async def set_function_invocation_chat_scope_enabled_endpoint(
    name: str,
    body: SetFunctionInvocationChatScopeEnabledRequest,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> FunctionInvocationResponse:
    return await set_function_invocation_chat_scope_enabled(
        db, owner_user_id=user.id, name=name, enabled=body.enabled
    )


@router.delete("/{name}", status_code=204)
async def archive_function_invocation_endpoint(
    name: str,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> Response:
    await archive_function_invocation(db, owner_user_id=user.id, name=name)
    return Response(status_code=204)
