from __future__ import annotations

from dataclasses import dataclass

from proliferate.server.cloud.mcp_catalog.domain.types import CatalogEntry
from proliferate.server.cloud.plugins.catalog.domain.types import PluginPackage


@dataclass(frozen=True)
class SandboxProfileResolverSnapshot:
    id: str
    owner_scope: str
    owner_user_id: str | None
    organization_id: str | None


@dataclass(frozen=True)
class McpConnectionSnapshot:
    id: str
    owner_scope: str
    owner_user_id: str | None
    organization_id: str | None
    connection_id: str
    catalog_entry_id: str
    catalog_entry_version: int
    server_name: str
    enabled: bool
    public_to_org: bool
    public_organization_id: str | None
    public_status: str
    settings_json: str
    config_version: int
    auth_kind: str | None
    auth_status: str | None
    auth_version: int | None


@dataclass(frozen=True)
class SkillConfiguredItemSnapshot:
    id: str
    owner_scope: str
    owner_user_id: str | None
    organization_id: str | None
    skill_source_kind: str
    skill_id: str
    skill_version: str | None
    plugin_id: str
    plugin_version: str | None
    enabled: bool
    public_to_org: bool
    public_organization_id: str | None
    public_status: str
    user_skill_payload_ref: str | None
    source_snapshot_json: str | None
    config_version: int


@dataclass(frozen=True)
class PluginConfiguredItemSnapshot:
    id: str
    owner_scope: str
    owner_user_id: str | None
    organization_id: str | None
    plugin_id: str
    plugin_version: str | None
    enabled: bool
    public_to_org: bool
    public_organization_id: str | None
    public_status: str
    config_version: int


@dataclass(frozen=True)
class ResolverInput:
    sandbox_profile: SandboxProfileResolverSnapshot
    mcp_connections: tuple[McpConnectionSnapshot, ...]
    skill_configured_items: tuple[SkillConfiguredItemSnapshot, ...]
    plugin_configured_items: tuple[PluginConfiguredItemSnapshot, ...]
    catalog: tuple[CatalogEntry, ...]
    plugin_packages: tuple[PluginPackage, ...]


@dataclass(frozen=True)
class SourceRowRef:
    source_kind: str
    source_id: str
    owner_scope: str
    owner_user_id: str | None
    organization_id: str | None


@dataclass(frozen=True)
class ResolverWarning:
    code: str
    message: str
    source: SourceRowRef | None = None


@dataclass(frozen=True)
class ResolverBlocker:
    code: str
    message: str
    source: SourceRowRef | None = None


@dataclass(frozen=True)
class ResolvedArtifactRef:
    hash: str
    content_type: str
    byte_size: int
    source_ref: str | None
    content: str
    resource_id: str | None = None
    display_name: str | None = None


@dataclass(frozen=True)
class ResolvedMcpServer:
    id: str
    connection_db_id: str
    connection_id: str
    catalog_entry_id: str
    catalog_entry_version: int
    server_name: str
    transport: str
    catalog_entry: CatalogEntry
    settings_json: str
    auth_kind: str | None
    auth_version: int | None
    source: SourceRowRef


@dataclass(frozen=True)
class ResolvedMcpBinding:
    server_id: str
    server_name: str
    connection_id: str
    catalog_entry_id: str
    display_name: str | None
    transport: str
    source: SourceRowRef


@dataclass(frozen=True)
class ResolvedSkill:
    id: str
    source_kind: str
    display_name: str
    description: str
    instruction_artifact: ResolvedArtifactRef
    resources: tuple[ResolvedArtifactRef, ...]
    required_mcp_server_ids: tuple[str, ...]
    credential_refs: tuple[str, ...]
    source: SourceRowRef
    plugin_id: str | None = None


@dataclass(frozen=True)
class ResolvedRuntimeConfigPlan:
    mcp_servers: tuple[ResolvedMcpServer, ...]
    mcp_binding_summaries: tuple[ResolvedMcpBinding, ...]
    skills: tuple[ResolvedSkill, ...]
    artifacts: tuple[ResolvedArtifactRef, ...]
    warnings: tuple[ResolverWarning, ...]
    blocking_errors: tuple[ResolverBlocker, ...]
    source_row_refs: tuple[SourceRowRef, ...]
