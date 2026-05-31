from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.mcp_connections.access import McpConnectionManageDependency
from proliferate.server.cloud.mcp_connections.models import (
    CloudMcpConnectionResponse,
    CloudMcpConnectionsResponse,
    CreateCloudMcpConnectionRequest,
    OkResponse,
    PatchCloudMcpConnectionRequest,
    PublicizeCloudMcpConnectionRequest,
    PutCloudMcpSecretAuthRequest,
    cloud_mcp_connection_payload,
)
from proliferate.server.cloud.mcp_connections.service import (
    CloudMcpConnectionPayload,
    create_cloud_mcp_connection,
    delete_cloud_mcp_connection_for_user,
    list_cloud_mcp_connections,
    patch_cloud_mcp_connection,
    publicize_cloud_mcp_connection,
    put_cloud_mcp_connection_secret_auth,
    unpublicize_cloud_mcp_connection,
)

router = APIRouter()


def _connection_response(
    payload: CloudMcpConnectionPayload,
) -> CloudMcpConnectionResponse:
    return cloud_mcp_connection_payload(
        payload.record,
        payload.settings,
        payload.auth_kind,
        payload.auth_status,
    )


@router.get("/mcp/connections", response_model=CloudMcpConnectionsResponse)
async def list_cloud_mcp_connections_endpoint(
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> CloudMcpConnectionsResponse:
    return CloudMcpConnectionsResponse(
        connections=[
            _connection_response(payload)
            for payload in await list_cloud_mcp_connections(db, user.id)
        ]
    )


@router.post("/mcp/connections", response_model=CloudMcpConnectionResponse)
async def create_cloud_mcp_connection_endpoint(
    body: CreateCloudMcpConnectionRequest,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> CloudMcpConnectionResponse:
    return _connection_response(await create_cloud_mcp_connection(db, user.id, body))


@router.patch("/mcp/connections/{connection_id}", response_model=CloudMcpConnectionResponse)
async def patch_cloud_mcp_connection_endpoint(
    body: PatchCloudMcpConnectionRequest,
    connection: McpConnectionManageDependency,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> CloudMcpConnectionResponse:
    return _connection_response(
        await patch_cloud_mcp_connection(
            db,
            actor_user_id=user.id,
            existing=connection,
            body=body,
        )
    )


@router.post(
    "/mcp/connections/{connection_id}/publicize",
    response_model=CloudMcpConnectionResponse,
)
async def publicize_cloud_mcp_connection_endpoint(
    body: PublicizeCloudMcpConnectionRequest,
    connection: McpConnectionManageDependency,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> CloudMcpConnectionResponse:
    return _connection_response(
        await publicize_cloud_mcp_connection(
            db,
            actor_user_id=user.id,
            existing=connection,
            body=body,
        )
    )


@router.post(
    "/mcp/connections/{connection_id}/unpublicize",
    response_model=CloudMcpConnectionResponse,
)
async def unpublicize_cloud_mcp_connection_endpoint(
    connection: McpConnectionManageDependency,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> CloudMcpConnectionResponse:
    return _connection_response(
        await unpublicize_cloud_mcp_connection(
            db,
            actor_user_id=user.id,
            existing=connection,
        )
    )


@router.delete("/mcp/connections/{connection_id}", response_model=OkResponse)
async def delete_cloud_mcp_connection_endpoint(
    connection: McpConnectionManageDependency,
    db: AsyncSession = Depends(get_async_session),
) -> OkResponse:
    await delete_cloud_mcp_connection_for_user(db, connection)
    return OkResponse()


@router.put(
    "/mcp/connections/{connection_id}/auth/secret",
    response_model=CloudMcpConnectionResponse,
)
async def put_cloud_mcp_connection_secret_auth_endpoint(
    body: PutCloudMcpSecretAuthRequest,
    connection: McpConnectionManageDependency,
    db: AsyncSession = Depends(get_async_session),
) -> CloudMcpConnectionResponse:
    return _connection_response(await put_cloud_mcp_connection_secret_auth(db, connection, body))
