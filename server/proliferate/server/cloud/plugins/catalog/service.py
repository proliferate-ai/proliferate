from __future__ import annotations

from proliferate.server.cloud.mcp_catalog.domain.types import CatalogEntry
from proliferate.server.cloud.plugins.catalog.domain.types import PluginPackage
from proliferate.server.cloud.plugins.catalog.first_party import (
    first_party_package_for_catalog_entry,
)


def plugin_packages_for_catalog_entries(
    entries: list[CatalogEntry],
) -> list[PluginPackage]:
    return [
        first_party_package_for_catalog_entry(entry)
        for entry in entries
    ]

