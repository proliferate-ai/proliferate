from __future__ import annotations

import ast

from proliferate.server.cloud.mcp_catalog.domain.types import (
    CatalogEntry,
    CatalogSecretField,
    HeaderTemplate,
    HttpLaunchTemplate,
    StaticUrl,
)
from proliferate.server.cloud.plugins.catalog.domain.types import (
    PluginPackage,
    PluginSkill,
    PluginSkillProvenance,
    PluginSkillResource,
)
from proliferate.server.cloud.runtime_config.domain.manifest import (
    _content_hash,
    compile_runtime_config_manifest,
)
from proliferate.server.cloud.runtime_config.domain.resolver import (
    McpConnectionSnapshot,
    PluginConfiguredItemSnapshot,
    ResolverInput,
    SandboxProfileResolverSnapshot,
    SkillConfiguredItemSnapshot,
    resolve_runtime_config,
)
from proliferate.server.cloud.runtime_config.models import (
    RuntimeConfigArtifactRefModel,
    RuntimeConfigMaterializationFragment,
)
from proliferate.server.cloud.runtime_config.service import _credential_value_from_payload
from proliferate.server.cloud.target_config.models import TargetConfigMaterializationPlan


def _entry(entry_id: str = "github") -> CatalogEntry:
    return CatalogEntry(
        id=entry_id,
        version=1,
        name=entry_id.title(),
        one_liner="one line",
        description="description",
        docs_url="https://example.com/docs",
        availability="universal",
        transport="http",
        auth_kind="secret",
        server_name_base=entry_id,
        icon_id=entry_id,
        capabilities=(),
        secret_fields=(
            CatalogSecretField(
                id="api_key",
                label="API key",
                placeholder="",
                helper_text="",
                get_token_instructions="",
            ),
        ),
        http=HttpLaunchTemplate(
            url=StaticUrl("https://example.com/mcp"),
            display_url="https://example.com/mcp",
            headers=(HeaderTemplate(name="Authorization", value="Bearer {secret.api_key}"),),
        ),
    )


def _plugin_package(entry_id: str = "github") -> PluginPackage:
    skill = PluginSkill(
        id="triage",
        display_name="Triage",
        description="Inspect issues.",
        instructions="Use the configured MCP carefully.",
        required_mcp_server_refs=(entry_id,),
        requires_credential_binding=True,
        resources=(
            PluginSkillResource(
                resource_id="triage-guide",
                display_name="Triage guide",
                content_type="text/markdown",
                content="Use narrow issue queries.",
            ),
        ),
        default_enabled=True,
        provenance=PluginSkillProvenance(
            source_repo_url="https://example.com/repo",
            source_path="skills/triage.md",
            source_ref="a" * 40,
            source_sha256="b" * 64,
            adapted_sha256="c" * 64,
            source_license="MIT",
            import_mode="adapted",
            review_status="reviewed",
            reviewer="test",
            reviewed_at="2026-05-20",
        ),
    )
    return PluginPackage(
        id=entry_id,
        catalog_entry_id=entry_id,
        version="1+test",
        display_name=entry_id.title(),
        description="description",
        skills=(skill,),
    )


def _profile(
    *,
    owner_scope: str = "personal",
    owner_user_id: str | None = "user-a",
    organization_id: str | None = None,
) -> SandboxProfileResolverSnapshot:
    return SandboxProfileResolverSnapshot(
        id="profile-1",
        owner_scope=owner_scope,
        owner_user_id=owner_user_id,
        organization_id=organization_id,
    )


def _mcp(
    *,
    id: str,
    owner_user_id: str = "user-a",
    public_organization_id: str | None = None,
    auth_status: str | None = "ready",
    server_name: str = "github",
    catalog_entry_id: str = "github",
    auth_kind: str = "secret",
) -> McpConnectionSnapshot:
    return McpConnectionSnapshot(
        id=id,
        owner_scope="personal",
        owner_user_id=owner_user_id,
        organization_id=None,
        connection_id=id,
        catalog_entry_id=catalog_entry_id,
        catalog_entry_version=1,
        server_name=server_name,
        enabled=True,
        public_to_org=public_organization_id is not None,
        public_organization_id=public_organization_id,
        public_status="public" if public_organization_id else "private",
        settings_json="{}",
        config_version=1,
        auth_kind=auth_kind,
        auth_status=auth_status,
        auth_version=1,
    )


def _skill(
    *,
    owner_user_id: str = "user-a",
    enabled: bool = True,
) -> SkillConfiguredItemSnapshot:
    return SkillConfiguredItemSnapshot(
        id="skill-1",
        owner_scope="personal",
        owner_user_id=owner_user_id,
        organization_id=None,
        skill_source_kind="plugin",
        skill_id="triage",
        skill_version=None,
        plugin_id="github",
        plugin_version="1+test",
        enabled=enabled,
        public_to_org=False,
        public_organization_id=None,
        public_status="private",
        user_skill_payload_ref=None,
        source_snapshot_json=None,
        config_version=1,
    )


def _plugin(
    *,
    enabled: bool = True,
    owner_user_id: str = "user-a",
) -> PluginConfiguredItemSnapshot:
    return PluginConfiguredItemSnapshot(
        id="plugin-1",
        owner_scope="personal",
        owner_user_id=owner_user_id,
        organization_id=None,
        plugin_id="github",
        plugin_version="1+test",
        enabled=enabled,
        public_to_org=False,
        public_organization_id=None,
        public_status="private",
        config_version=1,
    )


def _input(
    *,
    profile: SandboxProfileResolverSnapshot | None = None,
    mcps: tuple[McpConnectionSnapshot, ...] = (),
    skills: tuple[SkillConfiguredItemSnapshot, ...] = (),
    plugins: tuple[PluginConfiguredItemSnapshot, ...] = (),
    catalog: tuple[CatalogEntry, ...] | None = None,
    plugin_packages: tuple[PluginPackage, ...] | None = None,
) -> ResolverInput:
    return ResolverInput(
        sandbox_profile=profile or _profile(),
        mcp_connections=mcps,
        skill_configured_items=skills,
        plugin_configured_items=plugins,
        catalog=catalog if catalog is not None else (_entry(),),
        plugin_packages=plugin_packages if plugin_packages is not None else (_plugin_package(),),
    )


def test_personal_profile_excludes_public_items_from_other_users() -> None:
    plan = resolve_runtime_config(
        _input(
            mcps=(
                _mcp(id="mcp-owned", owner_user_id="user-a"),
                _mcp(
                    id="mcp-public-other",
                    owner_user_id="user-b",
                    public_organization_id="org-a",
                ),
            )
        )
    )

    assert [server.connection_db_id for server in plan.mcp_servers] == ["mcp-owned"]


def test_org_profile_includes_publicized_items_for_that_org_only() -> None:
    plan = resolve_runtime_config(
        _input(
            profile=_profile(
                owner_scope="organization",
                owner_user_id=None,
                organization_id="org-a",
            ),
            mcps=(
                _mcp(id="mcp-org-a", owner_user_id="user-a", public_organization_id="org-a"),
                _mcp(id="mcp-org-b", owner_user_id="user-b", public_organization_id="org-b"),
            ),
        )
    )

    assert [server.connection_db_id for server in plan.mcp_servers] == ["mcp-org-a"]


def test_org_profile_ignores_org_owned_rows_publicized_to_other_orgs() -> None:
    org_owned = _mcp(id="mcp-org-owned", public_organization_id="org-a")
    org_owned = McpConnectionSnapshot(
        **{
            **org_owned.__dict__,
            "owner_scope": "organization",
            "owner_user_id": None,
            "organization_id": "org-b",
        }
    )

    plan = resolve_runtime_config(
        _input(
            profile=_profile(
                owner_scope="organization",
                owner_user_id=None,
                organization_id="org-a",
            ),
            mcps=(org_owned,),
        )
    )

    assert not plan.mcp_servers


def test_duplicate_server_names_are_namespaced_with_warning() -> None:
    plan = resolve_runtime_config(
        _input(
            mcps=(
                _mcp(id="mcp-aaa11111", server_name="github"),
                _mcp(id="mcp-bbb22222", server_name="github"),
            )
        )
    )

    assert [server.server_name for server in plan.mcp_servers] == [
        "github__mcp-aaa1",
        "github__mcp-bbb2",
    ]
    assert {warning.code for warning in plan.warnings} == {"mcp_server_name_collision"}


def test_not_ready_mcp_blocks_skill_that_requires_it() -> None:
    plan = resolve_runtime_config(
        _input(
            mcps=(_mcp(id="mcp-unready", auth_status="needs_reconnect"),),
            skills=(_skill(),),
            plugins=(_plugin(),),
        )
    )

    assert not plan.mcp_servers
    assert not plan.skills
    assert {blocker.code for blocker in plan.blocking_errors} == {
        "mcp_auth_not_ready",
        "skill_required_mcp_missing",
    }
    compiled = compile_runtime_config_manifest(plan, sandbox_profile_id="profile-1")
    assert {error["code"] for error in compiled.blocking_errors} == {
        "mcp_auth_not_ready",
        "skill_required_mcp_missing",
    }
    assert compiled.manifest["blockingErrors"] == list(compiled.blocking_errors)


def test_runtime_config_hash_changes_when_blockers_clear() -> None:
    blocked = compile_runtime_config_manifest(
        resolve_runtime_config(
            _input(mcps=(_mcp(id="mcp-unready", auth_status="needs_reconnect"),))
        ),
        sandbox_profile_id="profile-1",
    )
    cleared = compile_runtime_config_manifest(
        resolve_runtime_config(_input()),
        sandbox_profile_id="profile-1",
    )

    assert blocked.blocking_errors
    assert not cleared.blocking_errors
    assert blocked.content_hash != cleared.content_hash


def test_plugin_child_skill_is_removed_when_parent_plugin_disabled_or_deleted() -> None:
    disabled_plan = resolve_runtime_config(
        _input(
            mcps=(_mcp(id="mcp-owned"),),
            skills=(_skill(),),
            plugins=(_plugin(enabled=False),),
        )
    )
    deleted_plan = resolve_runtime_config(
        _input(
            mcps=(_mcp(id="mcp-owned"),),
            skills=(_skill(),),
            plugins=(),
        )
    )

    assert not disabled_plan.skills
    assert not deleted_plan.skills


def test_disabled_plugin_child_row_suppresses_default_plugin_skill_synthesis() -> None:
    plan = resolve_runtime_config(
        _input(
            mcps=(_mcp(id="mcp-owned"),),
            skills=(_skill(enabled=False),),
            plugins=(_plugin(),),
        )
    )

    assert not plan.skills


def test_manifest_hash_is_stable_and_redacts_secret_values() -> None:
    plan = resolve_runtime_config(
        _input(mcps=(_mcp(id="mcp-owned"),), skills=(_skill(),), plugins=(_plugin(),))
    )

    first = compile_runtime_config_manifest(plan, sandbox_profile_id="profile-1")
    second = compile_runtime_config_manifest(plan, sandbox_profile_id="profile-1")
    manifest_without_hash = {
        key: value for key, value in first.manifest.items() if key != "contentHash"
    }

    assert first.content_hash == second.content_hash
    assert first.content_hash == _content_hash(manifest_without_hash)
    assert "Bearer secret" not in first.manifest_json
    assert "api_key" in first.manifest_json
    assert "Use the configured MCP carefully." not in first.manifest_json
    instruction_payload = next(
        artifact
        for artifact in first.artifact_payloads
        if artifact.source_ref == "plugin:github:triage:instructions"
    )
    assert instruction_payload.content == "Use the configured MCP carefully."
    assert first.manifest["skills"][0]["resources"] == [
        {
            "hash": first.manifest["skills"][0]["resources"][0]["hash"],
            "contentType": "text/markdown",
            "byteSize": 25,
            "sourceRef": "plugin:github:triage:resource:triage-guide",
            "resourceId": "triage-guide",
            "displayName": "Triage guide",
        }
    ]
    resource_payload = next(
        artifact for artifact in first.artifact_payloads if artifact.resource_id == "triage-guide"
    )
    assert resource_payload.display_name == "Triage guide"
    assert resource_payload.content == "Use narrow issue queries."
    assert first.manifest["mcpBindingSummaries"] == [
        {
            "id": "mcp:mcp-owned",
            "serverName": "github",
            "displayName": "Github",
            "transport": "http",
            "outcome": "applied",
            "reason": None,
        }
    ]


def test_oauth_manifest_materializes_access_token_header() -> None:
    entry = CatalogEntry(
        id="sentry",
        version=1,
        name="Sentry",
        one_liner="one line",
        description="description",
        docs_url="https://mcp.sentry.dev/",
        availability="universal",
        transport="http",
        auth_kind="oauth",
        oauth_client_mode="dcr",
        server_name_base="sentry",
        icon_id="globe",
        capabilities=(),
        http=HttpLaunchTemplate(
            url=StaticUrl("https://mcp.sentry.dev/mcp"),
            display_url="https://mcp.sentry.dev/mcp",
            headers=(
                HeaderTemplate(
                    name="Authorization",
                    value="Bearer {secret.accessToken}",
                    optional=True,
                ),
            ),
        ),
    )
    plan = resolve_runtime_config(
        _input(
            mcps=(
                _mcp(
                    id="mcp-oauth",
                    catalog_entry_id="sentry",
                    auth_kind="oauth",
                    server_name="sentry",
                ),
            ),
            catalog=(entry,),
            plugin_packages=(),
        )
    )

    compiled = compile_runtime_config_manifest(plan, sandbox_profile_id="profile-1")
    server = compiled.manifest["mcpServers"][0]

    assert server["launch"]["headers"] == [
        {
            "name": "Authorization",
            "value": {
                "kind": "template",
                "parts": [
                    {"kind": "literal", "value": "Bearer "},
                    {"kind": "credential", "credentialRef": "mcp:mcp-oauth:accessToken"},
                ],
            },
        }
    ]
    assert server["credentialRefs"] == [
        {
            "credentialRef": "mcp:mcp-oauth:accessToken",
            "usedIn": "mcp_launch_header",
            "mcpServerId": "mcp:mcp-oauth",
            "fieldName": "accessToken",
            "authKind": "oauth",
            "authVersion": 1,
        }
    ]


def test_runtime_config_materialization_fragment_alias_round_trips() -> None:
    plan = TargetConfigMaterializationPlan(
        target_config_id="config-1",
        target_id="target-1",
        config_version=3,
        workspace_root="/tmp/workspace",
        repo={"provider": "github", "owner": "proliferate-ai", "name": "proliferate"},
        env_vars={},
        tracked_files=[],
        runtime_config=RuntimeConfigMaterializationFragment(
            revision_id="revision-1",
            sandbox_profile_id="profile-1",
            target_id="target-1",
            sequence=7,
            content_hash="sha256:manifest",
            manifest={"mcpServers": [], "skills": []},
            artifact_refs=[
                RuntimeConfigArtifactRefModel(
                    hash="sha256:instructions",
                    content_type="text/markdown",
                    byte_size=13,
                    source_ref="plugin:github:triage:instructions",
                    resource_id="triage-guide",
                    display_name="Triage guide",
                )
            ],
            credential_refs=[{"credentialRef": "mcp:connection-1:api_key"}],
        ),
    )

    payload = plan.model_dump(mode="json", by_alias=True)
    assert payload["runtimeConfig"]["revisionId"] == "revision-1"

    round_tripped = TargetConfigMaterializationPlan.model_validate(payload)

    assert round_tripped.runtime_config is not None
    assert round_tripped.runtime_config.revision_id == "revision-1"
    assert round_tripped.runtime_config.artifact_refs[0].content_type == "text/markdown"
    assert round_tripped.runtime_config.artifact_refs[0].resource_id == "triage-guide"
    assert round_tripped.runtime_config.artifact_refs[0].display_name == "Triage guide"
    assert round_tripped.runtime_config.credential_refs == [
        {"credentialRef": "mcp:connection-1:api_key"}
    ]


def test_runtime_config_credential_payload_resolution() -> None:
    assert (
        _credential_value_from_payload(
            {"secretFields": {"api_key": "secret-value"}},
            "api_key",
        )
        == "secret-value"
    )
    assert (
        _credential_value_from_payload(
            {"accessToken": "oauth-token"},
            "access_token",
        )
        == "oauth-token"
    )


def test_runtime_config_domain_imports_stay_pure() -> None:
    for path in (
        "proliferate/server/cloud/runtime_config/domain/resolver.py",
        "proliferate/server/cloud/runtime_config/domain/manifest.py",
    ):
        with open(path, encoding="utf-8") as source:
            tree = ast.parse(source.read())
        imported_roots = {
            alias.name.split(".")[0]
            for node in ast.walk(tree)
            if isinstance(node, ast.Import)
            for alias in node.names
        }
        imported_roots.update(
            node.module.split(".")[0]
            for node in ast.walk(tree)
            if isinstance(node, ast.ImportFrom) and node.module
        )
        assert "sqlalchemy" not in imported_roots
        assert "fastapi" not in imported_roots
