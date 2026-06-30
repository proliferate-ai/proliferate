"""HTTP routes for the cloud sandbox AnyHarness gateway."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, WebSocket, status
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.gateway.access import (
    GatewayWebSocketAuthError,
    accepted_gateway_websocket_subprotocol,
    authenticate_product_user_for_gateway_websocket,
    product_token_from_websocket,
)
from proliferate.server.cloud.gateway.proxy import (
    proxy_http_to_anyharness,
    proxy_websocket_to_anyharness,
)
from proliferate.server.cloud.gateway.service import ensure_cloud_sandbox_gateway_access

router = APIRouter(tags=["cloud-sandbox-gateway"])


@router.api_route(
    "/cloud-sandbox/anyharness/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
    include_in_schema=False,
)
async def proxy_cloud_sandbox_anyharness_http(
    path: str,
    request: Request,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_product_user),
) -> object:
    access = await ensure_cloud_sandbox_gateway_access(db, user)
    return await proxy_http_to_anyharness(
        request,
        upstream_base_url=access.upstream_base_url,
        upstream_token=access.upstream_token,
        path=path,
    )


@router.websocket("/cloud-sandbox/anyharness/{path:path}")
async def proxy_cloud_sandbox_anyharness_websocket(
    websocket: WebSocket,
    path: str,
    db: AsyncSession = Depends(get_async_session),
) -> None:
    try:
        user = await authenticate_product_user_for_gateway_websocket(
            db,
            product_token_from_websocket(websocket),
        )
        access = await ensure_cloud_sandbox_gateway_access(db, user)
    except GatewayWebSocketAuthError:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    await proxy_websocket_to_anyharness(
        websocket,
        upstream_base_url=access.upstream_base_url,
        upstream_token=access.upstream_token,
        path=path,
        accept_subprotocol=accepted_gateway_websocket_subprotocol(websocket),
    )
