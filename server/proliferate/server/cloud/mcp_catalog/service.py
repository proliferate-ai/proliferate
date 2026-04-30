from __future__ import annotations

from proliferate.server.cloud.mcp_catalog.availability import catalog_entry_is_configured
from proliferate.server.cloud.mcp_catalog.catalog import CONNECTOR_CATALOG
from proliferate.server.cloud.mcp_catalog.models import ConnectorCatalogResponse, catalog_response


def get_cloud_mcp_catalog() -> ConnectorCatalogResponse:
    return catalog_response(
        [entry for entry in CONNECTOR_CATALOG if catalog_entry_is_configured(entry)]
    )
