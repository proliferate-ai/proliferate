from __future__ import annotations

from uuid import UUID

from proliferate.server.cloud.mcp_materialization.models import (
    MaterializeCloudMcpResponse,
    SessionMcpBindingSummaryModel,
    SessionMcpHeaderModel,
    SessionMcpHttpServerModel,
)
from proliferate.server.cloud.plugins.catalog.models import (
    PluginPackageModel,
    PluginPackageSkillModel,
    PluginSkillProvenanceModel,
    PluginSkillResourceModel,
)
from proliferate.server.cloud.target_config.runtime_config import build_target_runtime_config


def test_build_target_runtime_config_redacts_credentials_and_emits_artifacts() -> None:
    manifest, artifacts, credentials, warnings = build_target_runtime_config(
        target_id=UUID("00000000-0000-4000-8000-000000000001"),
        target_config_id=UUID("00000000-0000-4000-8000-000000000002"),
        config_version=7,
        owner_scope="personal",
        mcp=MaterializeCloudMcpResponse(
            catalog_version="test",
            mcp_servers=[
                SessionMcpHttpServerModel(
                    connection_id="conn_docs",
                    catalog_entry_id="docs",
                    server_name="docs",
                    url="https://mcp.example.com/mcp?api_key=query-secret&mode=read",
                    headers=[
                        SessionMcpHeaderModel(
                            name="Authorization",
                            value="Bearer header-secret",
                        )
                    ],
                )
            ],
            mcp_binding_summaries=[
                SessionMcpBindingSummaryModel(
                    id="conn_docs",
                    server_name="docs",
                    display_name="Docs",
                    transport="http",
                    outcome="applied",
                )
            ],
            local_stdio_candidates=[],
            plugin_packages=[
                PluginPackageModel(
                    id="docs-package",
                    catalog_entry_id="docs",
                    version="1",
                    display_name="Docs package",
                    description="Docs",
                    skills=[
                        PluginPackageSkillModel(
                            id="lookup",
                            display_name="Lookup",
                            description="Lookup docs",
                            instructions="# Lookup docs",
                            required_mcp_server_refs=["docs"],
                            requires_credential_binding=False,
                            default_enabled=True,
                            resources=[
                                PluginSkillResourceModel(
                                    resource_id="guide",
                                    display_name="Guide",
                                    content_type="text/markdown",
                                    content="guide body",
                                )
                            ],
                            provenance=PluginSkillProvenanceModel(
                                source_repo_url="https://example.com/repo",
                                source_path="skills/docs/SKILL.md",
                                source_ref="main",
                                source_sha256="source",
                                adapted_sha256="adapted",
                                source_license="MIT",
                                import_mode="adapted",
                                review_status="reviewed",
                                reviewer="test",
                                reviewed_at="2026-05-17T00:00:00Z",
                            ),
                        )
                    ],
                )
            ],
            warnings=[],
        ),
    )

    assert warnings == []
    assert manifest["revision"]["sequence"] == 7
    assert manifest["source"] == "worker"
    server = manifest["mcpServers"][0]
    assert server["launch"]["baseUrl"] == "https://mcp.example.com/mcp"
    assert server["launch"]["headers"][0]["value"]["parts"] == [
        {"kind": "literal", "value": "Bearer "},
        {"kind": "credential", "ref": "conn_docs:header:authorization:0"},
    ]
    assert server["launch"]["query"] == [
        {
            "name": "api_key",
            "value": {"parts": [{"kind": "credential", "ref": "conn_docs:query:api_key:0"}]},
        },
        {"name": "mode", "value": {"parts": [{"kind": "literal", "value": "read"}]}},
    ]
    assert "header-secret" not in str(manifest)
    assert "query-secret" not in str(manifest)
    assert {credential["value"] for credential in credentials} == {
        "header-secret",
        "query-secret",
    }
    assert len(artifacts) == 2
    assert all(artifact["contentBase64"] for artifact in artifacts)
    skill = manifest["skills"][0]
    assert skill["requiredMcpServerIds"] == ["docs"]
    assert skill["instructionArtifact"]["hash"] == artifacts[0]["hash"]
    assert skill["resources"][0]["artifact"]["hash"] == artifacts[1]["hash"]
