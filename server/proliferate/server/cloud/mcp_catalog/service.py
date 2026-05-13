from __future__ import annotations

from proliferate.server.cloud.mcp_catalog.availability import catalog_entry_is_configured
from proliferate.server.cloud.mcp_catalog.catalog import build_connector_catalog
from proliferate.server.cloud.mcp_catalog.models import ConnectorCatalogResponse, catalog_response
from proliferate.server.cloud.plugins.catalog.service import plugin_packages_for_catalog_entries


def get_cloud_mcp_catalog() -> ConnectorCatalogResponse:
    entries = [entry for entry in build_connector_catalog() if catalog_entry_is_configured(entry)]
    return catalog_response(
        entries,
        plugin_packages_for_catalog_entries(entries),
    )
