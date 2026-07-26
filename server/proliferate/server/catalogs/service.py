from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

from proliferate.constants.agent_catalog import (
    AGENT_CATALOG_RELATIVE_PATH,
    AGENT_REGISTRY_RELATIVE_PATH,
)
from proliferate.server.catalogs.models import AgentCatalogResponse


def _resolve_relative_path(relative_path: Path) -> Path:
    service_path = Path(__file__).resolve()
    candidates = (
        service_path.parents[3] / relative_path,
        service_path.parents[4] / relative_path,
    )
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


def _resolve_catalog_path() -> Path:
    return _resolve_relative_path(AGENT_CATALOG_RELATIVE_PATH)


def _resolve_registry_path() -> Path:
    return _resolve_relative_path(AGENT_REGISTRY_RELATIVE_PATH)


CATALOG_PATH = _resolve_catalog_path()
REGISTRY_PATH = _resolve_registry_path()


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


@dataclass(frozen=True)
class _CachedRegistryDocument:
    mtime_ns: int
    document: dict[str, object]


_registry_cache: dict[Path, _CachedRegistryDocument] = {}


def _read_registry_document(path: Path = REGISTRY_PATH) -> dict[str, object]:
    try:
        mtime_ns = path.stat().st_mtime_ns
    except OSError:
        return {}
    cached = _registry_cache.get(path)
    if cached is not None and cached.mtime_ns == mtime_ns:
        return cached.document
    try:
        parsed = json.loads(path.read_bytes())
    except (OSError, ValueError):
        parsed = {}
    document: dict[str, object] = parsed if isinstance(parsed, dict) else {}
    _registry_cache[path] = _CachedRegistryDocument(mtime_ns=mtime_ns, document=document)
    return document


def supported_provider_config_kinds(
    harness_kind: str,
    *,
    path: Path = REGISTRY_PATH,
) -> tuple[str, ...]:
    """The typed vault `kind`s ``harness_kind``'s registry entry declares.

    agent-distribution.md's "two documents": registry.json is the hand-written
    method document naming, among other vocabulary, which typed provider-config
    kinds (agent-auth.md's vault table: ``aws_bedrock``, ``azure_openai``) a
    harness supports. Read the same way ``read_agent_catalog`` reads the
    catalog — cached against the file's mtime, no network round trip.

    A declaration marked ``pending`` (agent-auth.md's Current-gaps: codex's
    ``azure_openai`` entry names envVars the pinned binary cannot yet consume
    without A5's config.toml injection mechanism) is excluded here — this
    function answers "usable today", not "named in the registry". Sorted so
    the API output is deterministic regardless of registry declaration order.

    Empty for a harness with no ``providerConfig`` block or an unknown
    harness — never raises, mirroring ``served_agent_catalog_version``'s
    read-only tolerance. Nothing in the product wires this into a response
    yet (the client's ``getSupportedProviderConfigKinds`` still hardcodes
    ``[]`` until D3's cutover); this is the server-side half of that seam.
    """
    document = _read_registry_document(path)
    agents = document.get("agents") if isinstance(document, dict) else None
    if not isinstance(agents, list):
        return ()
    for agent in agents:
        if not isinstance(agent, dict) or agent.get("kind") != harness_kind:
            continue
        provider_config = agent.get("providerConfig")
        if not isinstance(provider_config, list):
            return ()
        return tuple(
            sorted(
                entry["kind"]
                for entry in provider_config
                if isinstance(entry, dict)
                and isinstance(entry.get("kind"), str)
                and not entry.get("pending", False)
            )
        )
    return ()
