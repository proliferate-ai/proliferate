from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path

from proliferate.server.catalogs.models import AgentCatalogResponse

AGENT_CATALOG_RELATIVE_PATH = Path("catalogs") / "agents" / "v1" / "catalog.json"


def _resolve_catalog_path() -> Path:
    service_path = Path(__file__).resolve()
    candidates = (
        service_path.parents[3] / AGENT_CATALOG_RELATIVE_PATH,
        service_path.parents[4] / AGENT_CATALOG_RELATIVE_PATH,
    )
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


CATALOG_PATH = _resolve_catalog_path()


@dataclass(frozen=True)
class AgentCatalogDocument:
    catalog: AgentCatalogResponse
    etag: str


def read_agent_catalog() -> AgentCatalogDocument:
    body = CATALOG_PATH.read_bytes()
    catalog = AgentCatalogResponse.model_validate_json(body)
    digest = hashlib.sha256(catalog.model_dump_json().encode("utf-8")).hexdigest()
    return AgentCatalogDocument(catalog=catalog, etag=f'"{digest}"')
