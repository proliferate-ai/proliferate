import pytest

from proliferate.config import settings
from proliferate.server.cloud.mcp_catalog.catalog import (
    CONNECTOR_CATALOG,
    ArgTemplate,
    CatalogConfigurationError,
    CatalogEntry,
    CatalogSecretField,
    CatalogSettingField,
    EnvTemplate,
    HttpLaunchTemplate,
    SLACK_READ_ONLY_SCOPES,
    StaticUrl,
    build_connector_catalog,
    get_catalog_entry,
    parse_settings,
    render_http_launch,
    validate_settings,
)
from proliferate.server.cloud.mcp_catalog import service as catalog_service


def test_posthog_url_variant_and_optional_templates() -> None:
    entry = get_catalog_entry("posthog")
    assert entry is not None

    settings = validate_settings(
        entry,
        {
            "region": "eu",
            "features": "flags",
            "tools": "",
            "organizationId": "org_123",
        },
    )
    launch = render_http_launch(
        entry,
        settings,
        secrets={"apiKey": "phx-example"},
    )

    assert launch.url == "https://mcp-eu.posthog.com/mcp?features=flags"
    assert {header.name: header.value for header in launch.headers} == {
        "Authorization": "Bearer phx-example",
        "x-posthog-organization-id": "org_123",
    }


def test_supabase_legacy_kind_is_dropped_and_boolean_false_renders() -> None:
    entry = get_catalog_entry("supabase")
    assert entry is not None

    settings = validate_settings(
        entry,
        parse_settings('{"kind":"supabase","projectRef":"abcd1234","readOnly":false}'),
    )
    launch = render_http_launch(entry, settings)

    assert settings == {"projectRef": "abcd1234", "readOnly": False}
    assert launch.url == ("https://mcp.supabase.com/mcp?project_ref=abcd1234&read_only=false")


def test_removed_connectors_are_not_in_catalog() -> None:
    catalog_ids = {entry.id for entry in CONNECTOR_CATALOG}

    assert "google_calendar" not in catalog_ids
    assert "brave_search" not in catalog_ids
    assert "openweather" not in catalog_ids
    assert "statsig" not in catalog_ids
    assert "common_room" not in catalog_ids
    assert "vantage" not in catalog_ids
    assert not any("mcp.claude.com" in entry.display_url for entry in CONNECTOR_CATALOG)


def test_hosted_expansion_connectors_are_in_catalog() -> None:
    catalog_ids = [entry.id for entry in CONNECTOR_CATALOG]

    assert catalog_ids.count("github") == 1
    for connector_id in {
        "cloudflare_docs",
        "gitlab",
        "render",
        "neon",
        "huggingface",
        "sentry",
        "brave",
    }:
        assert connector_id in catalog_ids

    expected_icon_ids = {
        "exa": "exa",
        "posthog": "posthog",
        "cloudflare_docs": "cloudflare",
        "gitlab": "gitlab",
        "render": "render",
        "neon": "neon",
        "huggingface": "huggingface",
        "sentry": "sentry",
        "brave": "brave",
        "slack": "slack",
    }
    for connector_id, icon_id in expected_icon_ids.items():
        entry = get_catalog_entry(connector_id)
        assert entry is not None
        assert entry.icon_id == icon_id

    cloudflare_docs = get_catalog_entry("cloudflare_docs")
    assert cloudflare_docs is not None
    assert cloudflare_docs.transport == "http"
    assert cloudflare_docs.auth_kind == "none"
    assert cloudflare_docs.secret_fields == ()
    assert cloudflare_docs.display_url == "https://docs.mcp.cloudflare.com/mcp"

    for connector_id in ("gitlab", "sentry"):
        entry = get_catalog_entry(connector_id)
        assert entry is not None
        assert entry.transport == "http"
        assert entry.auth_kind == "oauth"
        assert entry.oauth_client_mode == "dcr"

    for connector_id in ("render", "neon", "huggingface"):
        entry = get_catalog_entry(connector_id)
        assert entry is not None
        assert entry.transport == "http"
        assert entry.auth_kind == "secret"
        assert entry.cloud_secret_sync is True

    neon = get_catalog_entry("neon")
    assert neon is not None
    launch = render_http_launch(neon, {}, secrets={"api_key": "neon-token"})

    assert {header.name: header.value for header in launch.headers} == {
        "Authorization": "Bearer neon-token",
        "x-read-only": "true",
    }

    sentry = get_catalog_entry("sentry")
    assert sentry is not None
    assert sentry.display_url == "https://mcp.sentry.dev/mcp"

    brave = get_catalog_entry("brave")
    assert brave is not None
    assert brave.transport == "stdio"
    assert brave.auth_kind == "secret"
    assert brave.availability == "local_only"
    assert brave.cloud_secret_sync is False
    assert brave.command == "npx"
    assert [template.value for template in brave.args] == [
        "-y",
        "@brave/brave-search-mcp-server",
        "--transport",
        "stdio",
    ]
    assert [(template.name, template.kind, template.field_id) for template in brave.env] == [
        ("BRAVE_API_KEY", "secret", "api_key")
    ]

    slack = get_catalog_entry("slack")
    assert slack is not None
    assert slack.requested_scopes == SLACK_READ_ONLY_SCOPES
    assert not any(
        forbidden in capability.lower()
        for capability in slack.capabilities
        for forbidden in ("send", "reaction", "manage")
    )


def test_vercel_catalog_entry_is_feature_gated(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "cloud_mcp_vercel_enabled", False)
    assert "vercel" not in {entry.id for entry in build_connector_catalog()}

    monkeypatch.setattr(settings, "cloud_mcp_vercel_enabled", True)
    vercel = get_catalog_entry("vercel")

    assert vercel is not None
    assert vercel.transport == "http"
    assert vercel.auth_kind == "oauth"
    assert vercel.oauth_client_mode == "dcr"
    assert vercel.display_url == "https://mcp.vercel.com"
    assert vercel.icon_id == "vercel"


def test_static_oauth_catalog_entries_are_hidden_until_enabled_and_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "cloud_mcp_slack_enabled", False)
    monkeypatch.setattr(settings, "cloud_mcp_slack_client_id", "slack-client-id")
    monkeypatch.setattr(settings, "cloud_mcp_slack_client_secret", "slack-client-secret")
    monkeypatch.setattr(
        settings,
        "cloud_mcp_slack_token_endpoint_auth_method",
        "client_secret_post",
    )

    response = catalog_service.get_cloud_mcp_catalog()

    assert "slack" not in {entry.id for entry in response.entries}

    monkeypatch.setattr(settings, "cloud_mcp_slack_enabled", True)
    monkeypatch.setattr(settings, "cloud_mcp_slack_client_secret", "")
    response = catalog_service.get_cloud_mcp_catalog()

    assert "slack" not in {entry.id for entry in response.entries}

    monkeypatch.setattr(settings, "cloud_mcp_slack_client_secret", "slack-client-secret")
    monkeypatch.setattr(settings, "cloud_mcp_slack_token_endpoint_auth_method", "none")
    response = catalog_service.get_cloud_mcp_catalog()

    assert "slack" not in {entry.id for entry in response.entries}

    monkeypatch.setattr(settings, "cloud_mcp_slack_token_endpoint_auth_method", "typo")
    response = catalog_service.get_cloud_mcp_catalog()

    assert "slack" not in {entry.id for entry in response.entries}

    monkeypatch.setattr(
        settings,
        "cloud_mcp_slack_token_endpoint_auth_method",
        "client_secret_basic",
    )
    response = catalog_service.get_cloud_mcp_catalog()

    assert "slack" in {entry.id for entry in response.entries}

    monkeypatch.setattr(
        settings,
        "cloud_mcp_slack_token_endpoint_auth_method",
        "client_secret_post",
    )
    monkeypatch.setattr(settings, "cloud_mcp_slack_client_secret", "slack-client-secret")
    response = catalog_service.get_cloud_mcp_catalog()

    slack = next(entry for entry in response.entries if entry.id == "slack")
    assert slack.auth_kind == "oauth"
    assert slack.oauth_client_mode == "static"
    assert slack.url == "https://mcp.slack.com/mcp"


def test_catalog_entry_invariants() -> None:
    for entry in CONNECTOR_CATALOG:
        if entry.transport == "stdio":
            assert entry.http is None
            assert entry.command
        if entry.transport == "http":
            assert entry.http is not None
            assert not entry.command
            assert not entry.args
            assert not entry.env
        if entry.auth_kind == "none":
            assert not entry.secret_fields
            if entry.http is not None:
                values = [template.value for template in (*entry.http.headers, *entry.http.query)]
                assert not any("{secret." in value for value in values)
        if entry.auth_kind == "oauth":
            assert entry.oauth_client_mode in {"dcr", "static"}
        else:
            assert entry.oauth_client_mode is None
        if entry.oauth_client_mode is not None:
            assert entry.auth_kind == "oauth"
        secret_field_ids = {field.id for field in entry.secret_fields}
        setting_field_ids = {field.id for field in entry.settings_fields}
        for template in entry.args:
            if template.kind == "secret":
                assert entry.auth_kind == "secret"
                assert template.field_id in secret_field_ids
            if template.kind == "setting":
                assert template.field_id in setting_field_ids
        for template in entry.env:
            if template.kind == "secret":
                assert entry.auth_kind == "secret"
                assert template.field_id in secret_field_ids
            if template.kind == "setting":
                assert template.field_id in setting_field_ids


def test_localhost_launch_urls_are_local_materialization_only() -> None:
    entry = CatalogEntry(
        id="local_http",
        version=1,
        name="Local HTTP",
        one_liner="Local test",
        description="Local test",
        docs_url="https://example.com",
        availability="local_only",
        transport="http",
        auth_kind="none",
        http=HttpLaunchTemplate(
            url=StaticUrl("http://localhost:9999/mcp"),
            display_url="http://localhost:9999/mcp",
        ),
        server_name_base="local_http",
        icon_id="globe",
        capabilities=(),
    )

    launch = render_http_launch(entry, {}, launch_context="local_materialization")

    assert launch.url == "http://localhost:9999/mcp"
    with pytest.raises(CatalogConfigurationError):
        render_http_launch(entry, {}, launch_context="cloud_materialization")
    with pytest.raises(CatalogConfigurationError):
        render_http_launch(entry, {}, launch_context="oauth_resource")


def test_stdio_templates_support_secret_and_setting_sources() -> None:
    entry = CatalogEntry(
        id="stdio_secret",
        version=1,
        name="Stdio Secret",
        one_liner="Stdio test",
        description="Stdio test",
        docs_url="https://example.com",
        availability="local_only",
        transport="stdio",
        auth_kind="secret",
        command="stdio-secret",
        args=(ArgTemplate(kind="setting", field_id="mode"),),
        env=(EnvTemplate(name="TOKEN", kind="secret", field_id="api_key"),),
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

    assert entry.args[0].kind == "setting"
    assert entry.env[0].kind == "secret"
