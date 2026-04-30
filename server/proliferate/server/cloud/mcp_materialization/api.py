from __future__ import annotations

from fastapi import APIRouter, Depends

from proliferate.auth.dependencies import current_active_user
from proliferate.db.models.auth import User
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.mcp_materialization.models import (
    MaterializeCloudMcpRequest,
    MaterializeCloudMcpResponse,
)
from proliferate.server.cloud.mcp_materialization.service import materialize_cloud_mcp_servers

router = APIRouter(prefix="/mcp")


@router.post("/materialize", response_model=MaterializeCloudMcpResponse)
async def materialize_cloud_mcp_endpoint(
    body: MaterializeCloudMcpRequest,
    user: User = Depends(current_active_user),
) -> MaterializeCloudMcpResponse:
    try:
        return await materialize_cloud_mcp_servers(user_id=user.id, body=body)
    except CloudApiError as error:
        raise_cloud_error(error)
