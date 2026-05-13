from __future__ import annotations

import re

from proliferate.server.cloud.mcp_catalog.domain.types import CatalogEntry
from proliferate.server.cloud.plugins.catalog.domain.types import PluginPackage
from proliferate.server.cloud.plugins.catalog.first_party import (
    first_party_package_for_catalog_entry,
)

_SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
_GIT_SHA_RE = re.compile(r"^[a-f0-9]{40}$")


def plugin_packages_for_catalog_entries(
    entries: list[CatalogEntry],
) -> list[PluginPackage]:
    packages = [first_party_package_for_catalog_entry(entry) for entry in entries]
    for package in packages:
        _validate_package_for_exposure(package)
    return packages


def _validate_package_for_exposure(package: PluginPackage) -> None:
    for skill in package.skills:
        provenance = skill.provenance
        if provenance.review_status != "reviewed":
            raise ValueError(f"plugin skill is not reviewed: {package.id}/{skill.id}")
        if not _GIT_SHA_RE.fullmatch(provenance.source_ref):
            raise ValueError(f"plugin skill source ref is not pinned: {package.id}/{skill.id}")
        if not _SHA256_RE.fullmatch(provenance.source_sha256):
            raise ValueError(f"plugin skill source hash is invalid: {package.id}/{skill.id}")
        if not _SHA256_RE.fullmatch(provenance.adapted_sha256):
            raise ValueError(f"plugin skill adapted hash is invalid: {package.id}/{skill.id}")
        if not provenance.source_license.strip():
            raise ValueError(f"plugin skill license is required: {package.id}/{skill.id}")
        if not skill.required_mcp_server_refs:
            raise ValueError(f"plugin skill requires an MCP server ref: {package.id}/{skill.id}")
