from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Body, Depends, Query
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.config import settings
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.mcp_connections.access import McpConnectionManageDependency
from proliferate.server.cloud.mcp_oauth.domain.flow_rules import build_oauth_web_completion_url
from proliferate.server.cloud.mcp_oauth.models import (
    CloudMcpOAuthFlowStatusResponse,
    StartCloudMcpOAuthFlowRequest,
    StartCloudMcpOAuthFlowResponse,
    oauth_flow_start_payload,
    oauth_flow_status_payload,
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
    connection: McpConnectionManageDependency,
    body: StartCloudMcpOAuthFlowRequest | None = Body(default=None),
    db: AsyncSession = Depends(get_async_session),
) -> StartCloudMcpOAuthFlowResponse:
    return oauth_flow_start_payload(
        await start_cloud_mcp_oauth_flow(
            db,
            connection=connection,
            callback_surface=body.callback_surface if body else None,
            final_surface=body.final_surface if body else None,
            return_path=body.return_path if body else None,
        )
    )


@router.get("/oauth/flows/{flow_id}", response_model=CloudMcpOAuthFlowStatusResponse)
async def get_cloud_mcp_oauth_flow_endpoint(
    flow_id: UUID,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> CloudMcpOAuthFlowStatusResponse:
    status = await get_cloud_mcp_oauth_flow_status(db, user_id=user.id, flow_id=flow_id)
    return oauth_flow_status_payload(
        status.flow,
        include_authorization_url=status.include_authorization_url,
    )


@router.post("/oauth/flows/{flow_id}/cancel", response_model=CloudMcpOAuthFlowStatusResponse)
async def cancel_cloud_mcp_oauth_flow_endpoint(
    flow_id: UUID,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> CloudMcpOAuthFlowStatusResponse:
    status = await cancel_cloud_mcp_oauth_flow(db, user_id=user.id, flow_id=flow_id)
    return oauth_flow_status_payload(
        status.flow,
        include_authorization_url=status.include_authorization_url,
    )


@router.get(
    "/oauth/callback",
    response_class=HTMLResponse,
    responses={
        303: {"description": "Redirect to web OAuth completion"},
    },
)
async def cloud_mcp_oauth_callback_endpoint(
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
    db: AsyncSession = Depends(get_async_session),
) -> Response:
    if not state:
        return make_mcp_oauth_callback_page(
            ok=False,
            status="failed",
            failure_code="invalid_state",
        )
    try:
        result = await complete_cloud_mcp_oauth_callback(
            db,
            state=state,
            code=code,
            provider_error=error,
        )
    except CloudApiError:
        return make_mcp_oauth_callback_page(
            ok=False,
            status="failed",
            failure_code="invalid_state",
        )
    if result.callback_surface == "web" and result.return_path:
        return RedirectResponse(
            build_oauth_web_completion_url(
                frontend_base_url=settings.frontend_base_url,
                return_path=result.return_path,
                flow_id=str(result.flow_id) if result.flow_id else "",
                status=result.status,
                final_surface=result.final_surface,
                failure_code=result.failure_code,
            ),
            status_code=303,
        )
    return make_mcp_oauth_callback_page(
        ok=result.ok,
        status=result.status,
        flow_id=result.flow_id,
        failure_code=result.failure_code,
    )
