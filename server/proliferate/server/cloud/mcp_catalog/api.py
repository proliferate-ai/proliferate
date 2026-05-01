from __future__ import annotations

from fastapi import APIRouter, Depends

from proliferate.auth.dependencies import current_active_user
from proliferate.db.models.auth import User
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.mcp_catalog.models import ConnectorCatalogResponse
from proliferate.server.cloud.mcp_catalog.service import get_cloud_mcp_catalog

router = APIRouter(prefix="/mcp")


@router.get("/catalog", response_model=ConnectorCatalogResponse)
async def get_cloud_mcp_catalog_endpoint(
    _user: User = Depends(current_active_user),
) -> ConnectorCatalogResponse:
    try:
        return get_cloud_mcp_catalog()
    except CloudApiError as error:
        raise_cloud_error(error)
