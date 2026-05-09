from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_active_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.mcp_connections.access import McpConnectionManageDependency
from proliferate.server.cloud.mcp_connections.models import (
    CloudMcpConnectionResponse,
    CloudMcpConnectionsResponse,
    CloudMcpConnectionSyncStatus,
    CreateCloudMcpConnectionRequest,
    OkResponse,
    PatchCloudMcpConnectionRequest,
    PutCloudMcpSecretAuthRequest,
    SyncCloudMcpConnectionRequest,
    cloud_mcp_connection_payload,
    cloud_mcp_connection_status_payload,
)
from proliferate.server.cloud.mcp_connections.service import (
    CloudMcpConnectionPayload,
    create_cloud_mcp_connection,
    delete_cloud_mcp_connection_for_user,
    delete_legacy_cloud_mcp_connection_for_user,
    list_cloud_mcp_connection_statuses,
    list_cloud_mcp_connections,
    patch_cloud_mcp_connection,
    put_cloud_mcp_connection_secret_auth,
    sync_cloud_mcp_connection_for_user,
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
    user: User = Depends(current_active_user),
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
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> CloudMcpConnectionResponse:
    return _connection_response(await create_cloud_mcp_connection(db, user.id, body))


@router.patch("/mcp/connections/{connection_id}", response_model=CloudMcpConnectionResponse)
async def patch_cloud_mcp_connection_endpoint(
    body: PatchCloudMcpConnectionRequest,
    connection: McpConnectionManageDependency,
    db: AsyncSession = Depends(get_async_session),
) -> CloudMcpConnectionResponse:
    return _connection_response(await patch_cloud_mcp_connection(db, connection, body))


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


@router.get("/mcp-connections/statuses", response_model=list[CloudMcpConnectionSyncStatus])
async def list_cloud_mcp_connection_statuses_endpoint(
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> list[CloudMcpConnectionSyncStatus]:
    return [
        cloud_mcp_connection_status_payload(record)
        for record in await list_cloud_mcp_connection_statuses(db, user.id)
    ]


@router.put("/mcp-connections/{connection_id}", response_model=OkResponse)
async def sync_cloud_mcp_connection_endpoint(
    connection_id: str,
    body: SyncCloudMcpConnectionRequest,
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> OkResponse:
    await sync_cloud_mcp_connection_for_user(db, user.id, connection_id, body)
    return OkResponse()


@router.delete("/mcp-connections/{connection_id}", response_model=OkResponse)
async def delete_legacy_cloud_mcp_connection_endpoint(
    connection_id: str,
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> OkResponse:
    await delete_legacy_cloud_mcp_connection_for_user(db, user.id, connection_id)
    return OkResponse()
