from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

from proliferate.constants.agent_catalog import AGENT_CATALOG_RELATIVE_PATH
from proliferate.server.catalogs.models import AgentCatalogResponse


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


@dataclass(frozen=True)
class _CachedCatalogVersion:
    mtime_ns: int
    version: str | None


_catalog_version_cache: dict[Path, _CachedCatalogVersion] = {}


def served_agent_catalog_version(path: Path = CATALOG_PATH) -> str | None:
    """`catalogVersion` of the catalog document this server serves.

    Generation-agnostic: whatever document sits at the catalog path, its
    top-level ``catalogVersion`` field is advertised for heartbeat
    convergence. Cached in-process against the file's mtime so the
    worker-heartbeat hot path does not reparse the document.
    """
    try:
        mtime_ns = path.stat().st_mtime_ns
    except OSError:
        return None
    cached = _catalog_version_cache.get(path)
    if cached is not None and cached.mtime_ns == mtime_ns:
        return cached.version
    version = _read_catalog_version(path)
    _catalog_version_cache[path] = _CachedCatalogVersion(mtime_ns=mtime_ns, version=version)
    return version


def _read_catalog_version(path: Path) -> str | None:
    try:
        document = json.loads(path.read_bytes())
    except (OSError, ValueError):
        return None
    version = document.get("catalogVersion") if isinstance(document, dict) else None
    return version if isinstance(version, str) else None
