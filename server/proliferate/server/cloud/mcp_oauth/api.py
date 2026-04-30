from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from fastapi.responses import HTMLResponse

from proliferate.auth.dependencies import current_active_user
from proliferate.db.models.auth import User
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.mcp_oauth.models import (
    CloudMcpOAuthFlowStatusResponse,
    StartCloudMcpOAuthFlowResponse,
)
from proliferate.server.cloud.mcp_oauth.pages import make_mcp_oauth_callback_page
from proliferate.server.cloud.mcp_oauth.service import (
    cancel_cloud_mcp_oauth_flow,
    complete_cloud_mcp_oauth_callback,
    get_cloud_mcp_oauth_flow_status,
    start_cloud_mcp_oauth_flow,
)

router = APIRouter(prefix="/mcp")


@router.post(
    "/connections/{connection_id}/oauth/start",
    response_model=StartCloudMcpOAuthFlowResponse,
)
async def start_cloud_mcp_oauth_flow_endpoint(
    connection_id: str,
    user: User = Depends(current_active_user),
) -> StartCloudMcpOAuthFlowResponse:
    try:
        return await start_cloud_mcp_oauth_flow(user_id=user.id, connection_id=connection_id)
    except CloudApiError as error:
        raise_cloud_error(error)


@router.get("/oauth/flows/{flow_id}", response_model=CloudMcpOAuthFlowStatusResponse)
async def get_cloud_mcp_oauth_flow_endpoint(
    flow_id: UUID,
    user: User = Depends(current_active_user),
) -> CloudMcpOAuthFlowStatusResponse:
    try:
        return await get_cloud_mcp_oauth_flow_status(user_id=user.id, flow_id=flow_id)
    except CloudApiError as error:
        raise_cloud_error(error)


@router.post("/oauth/flows/{flow_id}/cancel", response_model=CloudMcpOAuthFlowStatusResponse)
async def cancel_cloud_mcp_oauth_flow_endpoint(
    flow_id: UUID,
    user: User = Depends(current_active_user),
) -> CloudMcpOAuthFlowStatusResponse:
    try:
        return await cancel_cloud_mcp_oauth_flow(user_id=user.id, flow_id=flow_id)
    except CloudApiError as error:
        raise_cloud_error(error)


@router.get("/oauth/callback", response_class=HTMLResponse)
async def cloud_mcp_oauth_callback_endpoint(
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
) -> HTMLResponse:
    if error or not code or not state:
        return make_mcp_oauth_callback_page(ok=False)
    try:
        result = await complete_cloud_mcp_oauth_callback(state=state, code=code)
    except CloudApiError:
        return make_mcp_oauth_callback_page(ok=False)
    return make_mcp_oauth_callback_page(ok=result.ok)
