from __future__ import annotations

from proliferate.server.cloud.mcp_catalog.availability import catalog_entry_is_configured
from proliferate.server.cloud.mcp_catalog.catalog import build_connector_catalog
from proliferate.server.cloud.mcp_catalog.models import ConnectorCatalogResponse, catalog_response


def get_cloud_mcp_catalog() -> ConnectorCatalogResponse:
    return catalog_response(
        [entry for entry in build_connector_catalog() if catalog_entry_is_configured(entry)]
    )
