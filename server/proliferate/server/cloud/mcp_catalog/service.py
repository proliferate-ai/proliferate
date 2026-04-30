from __future__ import annotations

from proliferate.server.cloud.mcp_catalog.catalog import CONNECTOR_CATALOG
from proliferate.server.cloud.mcp_catalog.models import ConnectorCatalogResponse, catalog_response


async def get_cloud_mcp_catalog() -> ConnectorCatalogResponse:
    return catalog_response(list(CONNECTOR_CATALOG))
