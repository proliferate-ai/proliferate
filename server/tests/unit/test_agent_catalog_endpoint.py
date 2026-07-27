from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from proliferate.server.catalogs.api import router
from proliferate.server.catalogs.domain.schema import agent_catalog_schema_version_is_supported
from proliferate.server.catalogs.service import (
    CATALOG_PATH,
    read_agent_catalog,
    supported_provider_config_kinds,
)


def test_agent_catalog_endpoint_returns_typed_catalog_with_etag() -> None:
    app = FastAPI()
    app.include_router(router, prefix="/v1")
    client = TestClient(app)

    response = client.get("/v1/catalogs/agents")

    assert response.status_code == 200
    assert response.headers["etag"]
    payload = response.json()
    assert payload["schemaVersion"] == 2
    assert payload["catalogVersion"] == read_agent_catalog().catalog.catalogVersion
    assert payload["agents"]
    sessions_by_kind = {agent["kind"]: agent["session"] for agent in payload["agents"]}
    assert sessions_by_kind["claude"]["unattendedModeId"] == "bypassPermissions"
    assert sessions_by_kind["codex"]["unattendedModeId"] == "full-access"
    assert sessions_by_kind["cursor"]["unattendedModeId"] is None

    not_modified = client.get(
        "/v1/catalogs/agents",
        headers={"If-None-Match": response.headers["etag"]},
    )
    assert not_modified.status_code == 304


def test_agent_catalog_rejects_unsupported_schema_version() -> None:
    app = FastAPI()
    app.include_router(router, prefix="/v1")
    client = TestClient(app)

    response = client.get("/v1/catalogs/agents?schemaVersion=1")

    assert response.status_code == 400


def test_agent_catalog_accepts_explicit_schema_version_two() -> None:
    app = FastAPI()
    app.include_router(router, prefix="/v1")
    client = TestClient(app)

    response = client.get("/v1/catalogs/agents?schemaVersion=2")

    assert response.status_code == 200
    assert response.json()["schemaVersion"] == 2


def test_agent_catalog_schema_version_policy() -> None:
    assert agent_catalog_schema_version_is_supported(None)
    assert agent_catalog_schema_version_is_supported(2)
    assert not agent_catalog_schema_version_is_supported(1)
    assert not agent_catalog_schema_version_is_supported(3)


def test_agent_catalog_file_is_available_from_source_checkout() -> None:
    assert CATALOG_PATH.is_file()


def test_catalogs_service_exposes_no_heartbeat_version_advertiser() -> None:
    """The binary is the only catalog transport (agent-distribution.md,
    "Convergence"), so the server has no served-catalog-version to advertise on
    the worker heartbeat. Only the full-document read (the live agent picker's
    source) remains.
    """
    import proliferate.server.catalogs.service as catalogs_service

    assert not hasattr(catalogs_service, "served_agent_catalog_version")


def test_supported_provider_config_kinds_matches_track_d_scope() -> None:
    # R9's full scope: claude/codex/opencode x {aws_bedrock, azure_openai};
    # cursor/grok excluded (structural — no gateway recipe / no BYOK-cloud path).
    # Two azure_openai cells are declared but `pending` and therefore excluded
    # from "usable today" (agent-auth.md's Current-gaps):
    # - codex x azure_openai: only reachable via config.toml model_providers
    #   injection, live-unverified;
    # - claude x azure_openai (Foundry, R5/R11): the renderer's Foundry
    #   translation is an unverified judgment call awaiting its Gate 4 live
    #   run, so the write gate stays closed for it — this assertion is the
    #   pin for that exclusion.
    assert supported_provider_config_kinds("claude") == ("aws_bedrock",)
    assert supported_provider_config_kinds("codex") == ("aws_bedrock",)
    assert supported_provider_config_kinds("opencode") == ("aws_bedrock", "azure_openai")
    assert supported_provider_config_kinds("cursor") == ()
    assert supported_provider_config_kinds("grok") == ()
    assert supported_provider_config_kinds("not-a-real-harness") == ()


def test_supported_provider_config_kinds_is_order_insensitive(tmp_path: Path) -> None:
    reordered = tmp_path / "registry-reordered.json"
    reordered.write_text(
        '{"agents": [{"kind": "claude", "providerConfig": '
        '[{"kind": "azure_openai", "label": "Azure OpenAI", "envVars": ["A"]}, '
        '{"kind": "aws_bedrock", "label": "AWS Bedrock", "envVars": ["B"]}]}]}',
        encoding="utf-8",
    )
    assert supported_provider_config_kinds("claude", path=reordered) == (
        "aws_bedrock",
        "azure_openai",
    )


def test_supported_provider_config_kinds_excludes_pending_entries(tmp_path: Path) -> None:
    with_pending = tmp_path / "registry-with-pending.json"
    with_pending.write_text(
        '{"agents": [{"kind": "codex", "providerConfig": '
        '[{"kind": "aws_bedrock", "label": "AWS Bedrock", "envVars": ["A"]}, '
        '{"kind": "azure_openai", "label": "Azure OpenAI", "envVars": ["B"], '
        '"pending": true, "pendingReason": "awaiting A5"}]}]}',
        encoding="utf-8",
    )
    assert supported_provider_config_kinds("codex", path=with_pending) == ("aws_bedrock",)


def test_supported_provider_config_kinds_handles_missing_or_invalid_document(
    tmp_path: Path,
) -> None:
    assert supported_provider_config_kinds("claude", path=tmp_path / "absent.json") == ()

    broken = tmp_path / "broken.json"
    broken.write_text("not json", encoding="utf-8")
    assert supported_provider_config_kinds("claude", path=broken) == ()

    no_provider_config = tmp_path / "registry.json"
    no_provider_config.write_text(
        '{"agents": [{"kind": "claude"}]}',
        encoding="utf-8",
    )
    assert supported_provider_config_kinds("claude", path=no_provider_config) == ()

    with_provider_config = tmp_path / "registry-with-provider-config.json"
    with_provider_config.write_text(
        '{"agents": [{"kind": "claude", "providerConfig": '
        '[{"kind": "aws_bedrock", "label": "AWS Bedrock", "envVars": []}]}]}',
        encoding="utf-8",
    )
    assert supported_provider_config_kinds("claude", path=with_provider_config) == ("aws_bedrock",)


def test_server_dockerfile_packages_agent_catalog() -> None:
    dockerfile = Path(__file__).resolve().parents[2] / "Dockerfile"

    assert "COPY catalogs/ catalogs/" in dockerfile.read_text(encoding="utf-8")
