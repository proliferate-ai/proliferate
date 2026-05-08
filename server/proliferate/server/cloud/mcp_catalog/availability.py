from __future__ import annotations

from proliferate.server.cloud.mcp_catalog.domain.availability import catalog_entry_is_available
from proliferate.server.cloud.mcp_catalog.domain.types import CatalogEntry
from proliferate.server.cloud.mcp_oauth.static_clients import get_static_oauth_client_config


def catalog_entry_is_configured(entry: CatalogEntry) -> bool:
    return catalog_entry_is_available(
        entry,
        has_static_oauth_client_config=get_static_oauth_client_config(entry.id) is not None,
    )
