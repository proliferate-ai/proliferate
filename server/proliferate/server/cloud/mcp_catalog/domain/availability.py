from __future__ import annotations

from proliferate.server.cloud.mcp_catalog.domain.types import CatalogEntry


def catalog_entry_is_available(
    entry: CatalogEntry,
    *,
    has_static_oauth_client_config: bool,
) -> bool:
    if entry.oauth_client_mode != "static":
        return True
    return has_static_oauth_client_config
