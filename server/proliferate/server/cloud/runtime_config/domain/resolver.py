from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, replace

from proliferate.server.cloud.mcp_catalog.domain.types import CatalogEntry
from proliferate.server.cloud.plugins.catalog.domain.types import PluginPackage, PluginSkill


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


def resolve_runtime_config(inputs: ResolverInput) -> ResolvedRuntimeConfigPlan:
    catalog_by_id = {entry.id: entry for entry in inputs.catalog}
    packages_by_id = {package.id: package for package in inputs.plugin_packages}
    warnings: list[ResolverWarning] = []
    blockers: list[ResolverBlocker] = []
    source_refs: list[SourceRowRef] = []

    eligible_mcps = [
        connection
        for connection in inputs.mcp_connections
        if _is_visible_to_profile(
            inputs.sandbox_profile,
            owner_scope=connection.owner_scope,
            owner_user_id=connection.owner_user_id,
            organization_id=connection.organization_id,
            public_to_org=connection.public_to_org,
            public_organization_id=connection.public_organization_id,
            public_status=connection.public_status,
            enabled=connection.enabled,
        )
    ]
    mcp_servers: list[ResolvedMcpServer] = []
    for connection in sorted(eligible_mcps, key=lambda item: (item.server_name, item.id)):
        source = SourceRowRef(
            source_kind="mcp_connection",
            source_id=connection.id,
            owner_scope=connection.owner_scope,
            owner_user_id=connection.owner_user_id,
            organization_id=connection.organization_id,
        )
        source_refs.append(source)
        entry = catalog_by_id.get(connection.catalog_entry_id)
        if entry is None:
            blockers.append(
                ResolverBlocker(
                    code="mcp_catalog_entry_missing",
                    message=f"MCP catalog entry is missing: {connection.catalog_entry_id}",
                    source=source,
                )
            )
            continue
        if connection.auth_status != "ready":
            blockers.append(
                ResolverBlocker(
                    code="mcp_auth_not_ready",
                    message=(
                        f"MCP connection '{connection.server_name}' is not ready "
                        f"({connection.auth_status or 'missing_auth'})."
                    ),
                    source=source,
                )
            )
            continue
        mcp_servers.append(
            ResolvedMcpServer(
                id=f"mcp:{connection.id}",
                connection_db_id=connection.id,
                connection_id=connection.connection_id,
                catalog_entry_id=connection.catalog_entry_id,
                catalog_entry_version=connection.catalog_entry_version,
                server_name=connection.server_name or entry.server_name_base,
                transport=entry.transport,
                catalog_entry=entry,
                settings_json=connection.settings_json,
                auth_kind=connection.auth_kind,
                auth_version=connection.auth_version,
                source=source,
            )
        )

    mcp_servers = _namespace_duplicate_server_names(mcp_servers, warnings)
    mcp_servers_by_catalog = _mcp_servers_by_catalog_entry(mcp_servers)
    bindings = tuple(
        ResolvedMcpBinding(
            server_id=server.id,
            server_name=server.server_name,
            connection_id=server.connection_id,
            catalog_entry_id=server.catalog_entry_id,
            source=server.source,
        )
        for server in mcp_servers
    )

    resolved_skills: list[ResolvedSkill] = []
    resolved_artifacts: list[ResolvedArtifactRef] = []
    seen_skill_keys: set[tuple[str, str, str]] = set()
    visible_skill_items = [
        skill
        for skill in inputs.skill_configured_items
        if _is_visible_to_profile(
            inputs.sandbox_profile,
            owner_scope=skill.owner_scope,
            owner_user_id=skill.owner_user_id,
            organization_id=skill.organization_id,
            public_to_org=skill.public_to_org,
            public_organization_id=skill.public_organization_id,
            public_status=skill.public_status,
            enabled=skill.enabled,
        )
    ]
    for skill_item in sorted(
        visible_skill_items,
        key=lambda item: (item.plugin_id, item.skill_source_kind, item.skill_id, item.id),
    ):
        key = (skill_item.skill_source_kind, skill_item.plugin_id, skill_item.skill_id)
        seen_skill_keys.add(key)
        skill = _resolve_skill_item(
            skill_item,
            packages_by_id,
            mcp_servers_by_catalog,
            blockers,
        )
        if skill is not None:
            resolved_skills.append(skill)
            resolved_artifacts.append(skill.instruction_artifact)
            resolved_artifacts.extend(skill.resources)

    visible_plugins = [
        plugin
        for plugin in inputs.plugin_configured_items
        if _is_visible_to_profile(
            inputs.sandbox_profile,
            owner_scope=plugin.owner_scope,
            owner_user_id=plugin.owner_user_id,
            organization_id=plugin.organization_id,
            public_to_org=plugin.public_to_org,
            public_organization_id=plugin.public_organization_id,
            public_status=plugin.public_status,
            enabled=plugin.enabled,
        )
    ]
    for plugin_item in sorted(visible_plugins, key=lambda item: (item.plugin_id, item.id)):
        package = packages_by_id.get(plugin_item.plugin_id)
        if package is None:
            warnings.append(
                ResolverWarning(
                    code="plugin_package_missing",
                    message=f"Plugin package is missing: {plugin_item.plugin_id}",
                    source=SourceRowRef(
                        source_kind="plugin_configured_item",
                        source_id=plugin_item.id,
                        owner_scope=plugin_item.owner_scope,
                        owner_user_id=plugin_item.owner_user_id,
                        organization_id=plugin_item.organization_id,
                    ),
                )
            )
            continue
        for plugin_skill in package.skills:
            key = ("plugin", package.id, plugin_skill.id)
            if key in seen_skill_keys or not plugin_skill.default_enabled:
                continue
            synthetic = SkillConfiguredItemSnapshot(
                id=plugin_item.id,
                owner_scope=plugin_item.owner_scope,
                owner_user_id=plugin_item.owner_user_id,
                organization_id=plugin_item.organization_id,
                skill_source_kind="plugin",
                skill_id=plugin_skill.id,
                skill_version=None,
                plugin_id=package.id,
                plugin_version=package.version,
                enabled=True,
                public_to_org=plugin_item.public_to_org,
                public_organization_id=plugin_item.public_organization_id,
                public_status=plugin_item.public_status,
                user_skill_payload_ref=None,
                source_snapshot_json=None,
                config_version=plugin_item.config_version,
            )
            skill = _resolved_plugin_skill(
                synthetic,
                package,
                plugin_skill,
                mcp_servers_by_catalog,
                blockers,
            )
            if skill is not None:
                resolved_skills.append(skill)
                resolved_artifacts.append(skill.instruction_artifact)
                resolved_artifacts.extend(skill.resources)

    artifacts = _dedupe_artifacts(resolved_artifacts)
    return ResolvedRuntimeConfigPlan(
        mcp_servers=tuple(mcp_servers),
        mcp_binding_summaries=bindings,
        skills=tuple(resolved_skills),
        artifacts=artifacts,
        warnings=tuple(warnings),
        blocking_errors=tuple(blockers),
        source_row_refs=tuple(source_refs),
    )


def _is_visible_to_profile(
    profile: SandboxProfileResolverSnapshot,
    *,
    owner_scope: str,
    owner_user_id: str | None,
    organization_id: str | None,
    public_to_org: bool,
    public_organization_id: str | None,
    public_status: str,
    enabled: bool,
) -> bool:
    if not enabled:
        return False
    if profile.owner_scope == "personal":
        return owner_scope == "personal" and owner_user_id == profile.owner_user_id
    if profile.organization_id is None:
        return False
    return (owner_scope == "organization" and organization_id == profile.organization_id) or (
        public_to_org
        and public_organization_id == profile.organization_id
        and public_status == "public"
    )


def _namespace_duplicate_server_names(
    servers: list[ResolvedMcpServer],
    warnings: list[ResolverWarning],
) -> list[ResolvedMcpServer]:
    counts = Counter(server.server_name for server in servers)
    renamed: list[ResolvedMcpServer] = []
    for server in servers:
        if counts[server.server_name] <= 1:
            renamed.append(server)
            continue
        new_name = f"{server.server_name}__{server.connection_id[:8]}"
        renamed.append(replace(server, server_name=new_name))
        warnings.append(
            ResolverWarning(
                code="mcp_server_name_collision",
                message=(
                    f"MCP server name '{server.server_name}' was renamed to "
                    f"'{new_name}' because multiple configured connections used it."
                ),
                source=server.source,
            )
        )
    return renamed


def _mcp_servers_by_catalog_entry(
    servers: list[ResolvedMcpServer],
) -> dict[str, tuple[ResolvedMcpServer, ...]]:
    grouped: dict[str, list[ResolvedMcpServer]] = {}
    for server in servers:
        grouped.setdefault(server.catalog_entry_id, []).append(server)
    return {key: tuple(value) for key, value in grouped.items()}


def _resolve_skill_item(
    skill_item: SkillConfiguredItemSnapshot,
    packages_by_id: dict[str, PluginPackage],
    mcp_servers_by_catalog: dict[str, tuple[ResolvedMcpServer, ...]],
    blockers: list[ResolverBlocker],
) -> ResolvedSkill | None:
    if skill_item.skill_source_kind != "plugin":
        blockers.append(
            ResolverBlocker(
                code="skill_source_unsupported",
                message=f"Unsupported skill source kind: {skill_item.skill_source_kind}",
                source=_skill_source(skill_item),
            )
        )
        return None
    package = packages_by_id.get(skill_item.plugin_id)
    if package is None:
        blockers.append(
            ResolverBlocker(
                code="plugin_package_missing",
                message=f"Plugin package is missing: {skill_item.plugin_id}",
                source=_skill_source(skill_item),
            )
        )
        return None
    plugin_skill = next(
        (candidate for candidate in package.skills if candidate.id == skill_item.skill_id),
        None,
    )
    if plugin_skill is None:
        blockers.append(
            ResolverBlocker(
                code="plugin_skill_missing",
                message=f"Plugin skill is missing: {skill_item.plugin_id}/{skill_item.skill_id}",
                source=_skill_source(skill_item),
            )
        )
        return None
    return _resolved_plugin_skill(
        skill_item,
        package,
        plugin_skill,
        mcp_servers_by_catalog,
        blockers,
    )


def _resolved_plugin_skill(
    skill_item: SkillConfiguredItemSnapshot,
    package: PluginPackage,
    plugin_skill: PluginSkill,
    mcp_servers_by_catalog: dict[str, tuple[ResolvedMcpServer, ...]],
    blockers: list[ResolverBlocker],
) -> ResolvedSkill | None:
    required_servers: list[str] = []
    for required_ref in plugin_skill.required_mcp_server_refs:
        matches = mcp_servers_by_catalog.get(required_ref, ())
        if not matches:
            blockers.append(
                ResolverBlocker(
                    code="skill_required_mcp_missing",
                    message=(
                        f"Skill '{plugin_skill.display_name}' requires MCP '{required_ref}', "
                        "but no ready connection is included."
                    ),
                    source=_skill_source(skill_item),
                )
            )
            return None
        required_servers.extend(server.id for server in matches)
    instruction = _skill_artifact(
        source_ref=f"plugin:{package.id}:{plugin_skill.id}:instructions",
        content_type="text/markdown",
        content=plugin_skill.instructions,
    )
    resources = tuple(
        _skill_artifact(
            source_ref=f"plugin:{package.id}:{plugin_skill.id}:resource:{resource.resource_id}",
            content_type=resource.content_type,
            content=resource.content,
        )
        for resource in plugin_skill.resources
    )
    credential_refs = tuple(
        f"mcp:{server_id}:credentials"
        for server_id in required_servers
        if plugin_skill.requires_credential_binding
    )
    return ResolvedSkill(
        id=f"plugin:{package.id}:{plugin_skill.id}",
        source_kind="plugin",
        display_name=plugin_skill.display_name,
        description=plugin_skill.description,
        instruction_artifact=instruction,
        resources=resources,
        required_mcp_server_ids=tuple(required_servers),
        credential_refs=credential_refs,
        source=_skill_source(skill_item),
        plugin_id=package.id,
    )


def _skill_source(skill_item: SkillConfiguredItemSnapshot) -> SourceRowRef:
    return SourceRowRef(
        source_kind="skill_configured_item",
        source_id=skill_item.id,
        owner_scope=skill_item.owner_scope,
        owner_user_id=skill_item.owner_user_id,
        organization_id=skill_item.organization_id,
    )


def _skill_artifact(*, source_ref: str, content_type: str, content: str) -> ResolvedArtifactRef:
    import hashlib

    raw = content.encode("utf-8")
    return ResolvedArtifactRef(
        hash=f"sha256:{hashlib.sha256(raw).hexdigest()}",
        content_type=content_type,
        byte_size=len(raw),
        source_ref=source_ref,
        content=content,
    )


def _dedupe_artifacts(
    artifacts: list[ResolvedArtifactRef],
) -> tuple[ResolvedArtifactRef, ...]:
    by_hash: dict[str, ResolvedArtifactRef] = {}
    for artifact in artifacts:
        by_hash.setdefault(artifact.hash, artifact)
    return tuple(by_hash[key] for key in sorted(by_hash))
