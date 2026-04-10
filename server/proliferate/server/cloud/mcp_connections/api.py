from __future__ import annotations

from fastapi import APIRouter, Depends

from proliferate.auth.dependencies import current_active_user
from proliferate.db.models.auth import User
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.mcp_connections.models import (
    CloudMcpConnectionSyncStatus,
    OkResponse,
    SyncCloudMcpConnectionRequest,
)
from proliferate.server.cloud.mcp_connections.service import (
    delete_cloud_mcp_connection_for_user,
    list_cloud_mcp_connection_statuses,
    sync_cloud_mcp_connection_for_user,
)
from proliferate.utils.telemetry import track_cloud_event

router = APIRouter()


@router.get("/mcp-connections/statuses", response_model=list[CloudMcpConnectionSyncStatus])
async def list_cloud_mcp_connection_statuses_endpoint(
    user: User = Depends(current_active_user),
) -> list[CloudMcpConnectionSyncStatus]:
    return await list_cloud_mcp_connection_statuses(user.id)


@router.put("/mcp-connections/{connection_id}", response_model=OkResponse)
async def sync_cloud_mcp_connection_endpoint(
    connection_id: str,
    body: SyncCloudMcpConnectionRequest,
    user: User = Depends(current_active_user),
) -> OkResponse:
    try:
        await sync_cloud_mcp_connection_for_user(user.id, connection_id, body)
    except CloudApiError as error:
        track_cloud_event(
            user,
            "cloud_api_mcp_connection_sync",
            {
                "outcome": "failure",
                "status_code": error.status_code,
                "error_code": error.code,
            },
        )
        raise_cloud_error(error)
    track_cloud_event(
        user,
        "cloud_api_mcp_connection_sync",
        {
            "outcome": "success",
            "catalog_entry_id": body.catalog_entry_id,
        },
    )
    return OkResponse()


@router.delete("/mcp-connections/{connection_id}", response_model=OkResponse)
async def delete_cloud_mcp_connection_endpoint(
    connection_id: str,
    user: User = Depends(current_active_user),
) -> OkResponse:
    try:
        await delete_cloud_mcp_connection_for_user(user.id, connection_id)
    except CloudApiError as error:
        track_cloud_event(
            user,
            "cloud_api_mcp_connection_delete",
            {
                "outcome": "failure",
                "status_code": error.status_code,
                "error_code": error.code,
            },
        )
        raise_cloud_error(error)
    track_cloud_event(
        user,
        "cloud_api_mcp_connection_delete",
        {
            "outcome": "success",
        },
    )
    return OkResponse()
