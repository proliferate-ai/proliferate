from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import pytest

from proliferate.db.store.cloud_mcp.types import CloudMcpAuthRecord, CloudMcpConnectionRecord
from proliferate.server.cloud.mcp_catalog.catalog import (
    ArgTemplate,
    CatalogEntry,
    CatalogSecretField,
    CatalogSettingField,
    EnvTemplate,
    HttpLaunchTemplate,
    StaticUrl,
    get_catalog_entry,
)
from proliferate.server.cloud.mcp_materialization import service
from proliferate.server.cloud.mcp_materialization.models import (
    LocalStdioCandidateModel,
    MaterializeCloudMcpResponse,
    SessionMcpHeaderModel,
    SessionMcpHttpServerModel,
    local_stdio_static_arg_payload,
    local_stdio_static_env_payload,
)
from proliferate.utils.crypto import encrypt_json


def _connection(
    *,
    catalog_entry_id: str,
    auth: CloudMcpAuthRecord | None = None,
    settings_json: str = "{}",
) -> CloudMcpConnectionRecord:
    now = datetime.now(UTC)
    return CloudMcpConnectionRecord(
        id=uuid4(),
        user_id=uuid4(),
        org_id=None,
        connection_id=f"conn_{catalog_entry_id}",
        catalog_entry_id=catalog_entry_id,
        catalog_entry_version=1,
        server_name=catalog_entry_id,
        enabled=True,
        settings_json=settings_json,
        config_version=1,
        payload_ciphertext=None,
        payload_format="json-v1",
        created_at=now,
        updated_at=now,
        last_synced_at=now,
        auth=auth,
    )


def _auth(connection_db_id, payload: dict[str, object]) -> CloudMcpAuthRecord:
    now = datetime.now(UTC)
    return CloudMcpAuthRecord(
        id=uuid4(),
        connection_db_id=connection_db_id,
        auth_kind="secret",
        auth_status="ready",
        payload_ciphertext=encrypt_json(payload),
        payload_format="secret-fields-v1",
        auth_version=1,
        token_expires_at=None,
        last_error_code=None,
        created_at=now,
        updated_at=now,
    )


@pytest.mark.asyncio
async def test_no_auth_http_materializes_server(monkeypatch: pytest.MonkeyPatch) -> None:
    entry = CatalogEntry(
        id="no_auth_http",
        version=1,
        name="No Auth HTTP",
        one_liner="No auth",
        description="No auth",
        docs_url="https://example.com",
        availability="universal",
        transport="http",
        auth_kind="none",
        http=HttpLaunchTemplate(
            url=StaticUrl("https://example.com/mcp"),
            display_url="https://example.com/mcp",
        ),
        server_name_base="no_auth_http",
        icon_id="globe",
        capabilities=(),
    )
    monkeypatch.setattr(service, "get_catalog_entry", lambda _entry_id: entry)

    result = await service._materialize_record(
        _connection(catalog_entry_id=entry.id),
        target_location="cloud",
    )

    assert len(result.servers) == 1
    assert result.servers[0].url == "https://example.com/mcp"
    assert result.servers[0].headers == []
    assert result.summaries[0].outcome == "applied"


@pytest.mark.asyncio
async def test_cloudflare_docs_materializes_no_auth_http_server() -> None:
    result = await service._materialize_record(
        _connection(catalog_entry_id="cloudflare_docs"),
        target_location="cloud",
    )

    assert len(result.servers) == 1
    assert result.servers[0].url == "https://docs.mcp.cloudflare.com/mcp"
    assert result.servers[0].headers == []
    assert result.summaries[0].outcome == "applied"


@pytest.mark.asyncio
async def test_neon_materialization_includes_read_only_header() -> None:
    temp = _connection(catalog_entry_id="neon")
    record = _connection(
        catalog_entry_id="neon",
        auth=_auth(temp.id, {"secretFields": {"api_key": "neon-token"}}),
    )

    result = await service._materialize_record(record, target_location="cloud")

    assert len(result.servers) == 1
    headers = {header.name: header.value for header in result.servers[0].headers}
    assert result.servers[0].url == "https://mcp.neon.tech/mcp"
    assert headers == {
        "Authorization": "Bearer neon-token",
        "x-read-only": "true",
    }
    assert result.summaries[0].outcome == "applied"


@pytest.mark.asyncio
async def test_stdio_secret_and_setting_sources_resolve_to_static_launch_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    entry = CatalogEntry(
        id="stdio_secret",
        version=1,
        name="Stdio Secret",
        one_liner="Stdio",
        description="Stdio",
        docs_url="https://example.com",
        availability="local_only",
        transport="stdio",
        auth_kind="secret",
        command="stdio-secret",
        args=(ArgTemplate(kind="setting", field_id="mode"),),
        env=(EnvTemplate(name="API_KEY", kind="secret", field_id="api_key"),),
        server_name_base="stdio_secret",
        icon_id="terminal",
        secret_fields=(
            CatalogSecretField(
                id="api_key",
                label="API key",
                placeholder="key",
                helper_text="key",
                get_token_instructions="key",
            ),
        ),
        settings_fields=(
            CatalogSettingField(id="mode", label="Mode", kind="string", required=True),
        ),
        capabilities=(),
    )
    monkeypatch.setattr(service, "get_catalog_entry", lambda _entry_id: entry)
    record = _connection(catalog_entry_id=entry.id, settings_json='{"mode":"readonly"}')
    record = _connection(
        catalog_entry_id=entry.id,
        settings_json='{"mode":"readonly"}',
        auth=_auth(record.id, {"secretFields": {"api_key": "secret-token"}}),
    )

    result = await service._materialize_record(record, target_location="local")

    assert len(result.candidates) == 1
    candidate = result.candidates[0]
    assert candidate.args[0].source.kind == "static"
    assert candidate.args[0].source.value == "readonly"
    assert candidate.env[0].source.kind == "static"
    assert candidate.env[0].source.value == "secret-token"
    assert "secret-token" not in result.summaries[0].model_dump_json(by_alias=True)


@pytest.mark.asyncio
async def test_brave_v2_secret_materializes_local_stdio_candidate_without_leaking_secret() -> None:
    entry = get_catalog_entry("brave")
    assert entry is not None
    temp = _connection(catalog_entry_id=entry.id)
    record = _connection(
        catalog_entry_id=entry.id,
        auth=_auth(temp.id, {"secretFields": {"api_key": "brave-secret-token"}}),
    )

    result = await service._materialize_record(record, target_location="local")

    assert result.servers == []
    assert len(result.candidates) == 1
    candidate = result.candidates[0]
    assert candidate.catalog_entry_id == "brave"
    assert candidate.command == "npx"
    assert [arg.source.value for arg in candidate.args] == [
        "-y",
        "@brave/brave-search-mcp-server",
        "--transport",
        "stdio",
    ]
    assert [(env.name, env.source.kind, env.source.value) for env in candidate.env] == [
        ("BRAVE_API_KEY", "static", "brave-secret-token")
    ]
    assert result.summaries[0].outcome == "applied"
    assert "brave-secret-token" not in result.summaries[0].model_dump_json(by_alias=True)
    assert "brave-secret-token" not in repr(result)


@pytest.mark.asyncio
async def test_secret_http_invalid_settings_report_invalid_settings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    entry = CatalogEntry(
        id="secret_http",
        version=1,
        name="Secret HTTP",
        one_liner="Secret",
        description="Secret",
        docs_url="https://example.com",
        availability="universal",
        transport="http",
        auth_kind="secret",
        http=HttpLaunchTemplate(
            url=StaticUrl("https://example.com/mcp"),
            display_url="https://example.com/mcp",
        ),
        server_name_base="secret_http",
        icon_id="key",
        secret_fields=(
            CatalogSecretField(
                id="api_key",
                label="API key",
                placeholder="key",
                helper_text="key",
                get_token_instructions="key",
            ),
        ),
        settings_fields=(
            CatalogSettingField(id="region", label="Region", kind="string", required=True),
        ),
        capabilities=(),
    )
    monkeypatch.setattr(service, "get_catalog_entry", lambda _entry_id: entry)
    temp = _connection(catalog_entry_id=entry.id)
    record = _connection(
        catalog_entry_id=entry.id,
        auth=_auth(temp.id, {"secretFields": {"api_key": "secret-token"}}),
    )

    result = await service._materialize_record(record, target_location="cloud")

    assert result.servers == []
    assert result.summaries[0].reason == "invalid_settings"
    assert result.warnings[0].kind == "invalid_settings"


@pytest.mark.asyncio
async def test_oauth_http_invalid_settings_report_invalid_settings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    entry = CatalogEntry(
        id="oauth_http",
        version=1,
        name="OAuth HTTP",
        one_liner="OAuth",
        description="OAuth",
        docs_url="https://example.com",
        availability="universal",
        transport="http",
        auth_kind="oauth",
        http=HttpLaunchTemplate(
            url=StaticUrl("https://example.com/mcp"),
            display_url="https://example.com/mcp",
        ),
        server_name_base="oauth_http",
        icon_id="oauth",
        settings_fields=(
            CatalogSettingField(id="workspace", label="Workspace", kind="string", required=True),
        ),
        capabilities=(),
    )

    async def _ready_oauth_access_token(_record: CloudMcpConnectionRecord) -> str:
        return "access-token"

    monkeypatch.setattr(service, "get_catalog_entry", lambda _entry_id: entry)
    monkeypatch.setattr(service, "_ready_oauth_access_token", _ready_oauth_access_token)

    result = await service._materialize_record(
        _connection(catalog_entry_id=entry.id),
        target_location="cloud",
    )

    assert result.servers == []
    assert result.summaries[0].reason == "invalid_settings"
    assert result.warnings[0].kind == "invalid_settings"


@pytest.mark.asyncio
async def test_unknown_catalog_entry_materialization_is_silent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(service, "get_catalog_entry", lambda _entry_id: None)

    result = await service._materialize_record(
        _connection(catalog_entry_id="removed"),
        target_location="cloud",
    )

    assert result.servers == []
    assert result.candidates == []
    assert result.summaries == []
    assert result.warnings == []


@pytest.mark.asyncio
async def test_unconfigured_static_oauth_materialization_is_silent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    entry = CatalogEntry(
        id="slack",
        version=1,
        name="Slack",
        one_liner="Slack",
        description="Slack",
        docs_url="https://example.com",
        availability="universal",
        transport="http",
        auth_kind="oauth",
        oauth_client_mode="static",
        http=HttpLaunchTemplate(
            url=StaticUrl("https://mcp.slack.com/mcp"),
            display_url="https://mcp.slack.com/mcp",
        ),
        server_name_base="slack",
        icon_id="slack",
        capabilities=(),
    )
    monkeypatch.setattr(service, "get_catalog_entry", lambda _entry_id: entry)
    monkeypatch.setattr(service, "catalog_entry_is_configured", lambda _entry: False)

    result = await service._materialize_record(
        _connection(catalog_entry_id=entry.id),
        target_location="cloud",
    )

    assert result.servers == []
    assert result.candidates == []
    assert result.summaries == []
    assert result.warnings == []


def test_materialization_repr_redacts_launch_values() -> None:
    candidate = LocalStdioCandidateModel(
        connection_id="conn_secret_stdio",
        catalog_entry_id="secret_stdio",
        server_name="secret_stdio",
        connector_name="Secret Stdio",
        command="secret-stdio",
        args=[local_stdio_static_arg_payload("secret-arg")],
        env=[local_stdio_static_env_payload("API_KEY", "secret-token")],
    )
    response = MaterializeCloudMcpResponse(
        catalog_version="test",
        mcp_servers=[
            SessionMcpHttpServerModel(
                connection_id="conn_http",
                catalog_entry_id="http_secret",
                server_name="http_secret",
                url="https://example.com/mcp?api_key=secret-token",
                headers=[
                    SessionMcpHeaderModel(
                        name="Authorization",
                        value="Bearer secret-token",
                    )
                ],
            )
        ],
        mcp_binding_summaries=[],
        local_stdio_candidates=[candidate],
        warnings=[],
    )

    rendered = repr(response)

    assert "secret-token" not in rendered
    assert "secret-arg" not in rendered
