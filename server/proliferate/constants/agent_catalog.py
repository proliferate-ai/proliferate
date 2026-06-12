from __future__ import annotations

from pathlib import Path

AGENT_CATALOG_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=86400"
AGENT_CATALOG_RELATIVE_PATH = Path("catalogs") / "agents" / "catalog.json"
AGENT_REGISTRY_RELATIVE_PATH = Path("catalogs") / "agents" / "registry.json"
AGENT_CATALOG_SCHEMA_VERSION = 2
