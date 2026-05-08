from __future__ import annotations

from pathlib import Path

AGENT_CATALOG_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=86400"
AGENT_CATALOG_RELATIVE_PATH = Path("catalogs") / "agents" / "v1" / "catalog.json"
AGENT_CATALOG_SCHEMA_VERSION = 1
