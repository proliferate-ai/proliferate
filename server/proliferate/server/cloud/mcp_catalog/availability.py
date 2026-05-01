from __future__ import annotations

from proliferate.server.cloud.mcp_catalog.types import CatalogEntry
from proliferate.server.cloud.mcp_oauth.static_clients import get_static_oauth_client_config


def catalog_entry_is_configured(entry: CatalogEntry) -> bool:
    if entry.oauth_client_mode != "static":
        return True
    return get_static_oauth_client_config(entry.id) is not None
