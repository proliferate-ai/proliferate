from __future__ import annotations

from proliferate.constants.agent_catalog import AGENT_CATALOG_SCHEMA_VERSION


def agent_catalog_schema_version_is_supported(schema_version: int | None) -> bool:
    return schema_version in (None, AGENT_CATALOG_SCHEMA_VERSION)
