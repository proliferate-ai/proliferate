from proliferate.server.cloud.mcp_catalog.catalog import (
    CONNECTOR_CATALOG,
    get_catalog_entry,
    parse_settings,
    render_http_launch,
    validate_settings,
)


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


def test_universal_catalog_does_not_use_claude_hosted_mcp_urls() -> None:
    assert all(
        entry.transport != "http" or "mcp.claude.com" not in entry.http.display_url
        for entry in CONNECTOR_CATALOG
    )
