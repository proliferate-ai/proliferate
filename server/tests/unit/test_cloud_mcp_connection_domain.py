from __future__ import annotations

import pytest

from proliferate.server.cloud.mcp_catalog.domain.types import (
    CatalogEntry,
    CatalogSettingField,
    HttpLaunchTemplate,
    StaticUrl,
)
from proliferate.server.cloud.mcp_connections.domain.connection_rules import (
    ConnectionAuthState,
    McpConnectionRuleViolation,
    generate_server_name,
    oauth_resource_change_requires_reconnect,
    reject_local_oauth_account_change,
    resolve_connection_auth_state,
    validate_connection_id,
    validate_connection_settings,
)


def _entry(
    *,
    entry_id: str = "linear",
    auth_kind: str = "oauth",
    setup_kind: str = "none",
    server_name_base: str = "Linear MCP",
    settings_fields: tuple[CatalogSettingField, ...] = (),
) -> CatalogEntry:
    return CatalogEntry(
        id=entry_id,
        version=1,
        name="Linear",
        one_liner="Linear",
        description="Linear",
        docs_url="https://example.com",
        availability="universal",
        transport="http",
        auth_kind=auth_kind,  # type: ignore[arg-type]
        http=HttpLaunchTemplate(url=StaticUrl("https://example.com/mcp"), display_url=""),
        server_name_base=server_name_base,
        icon_id="linear",
        capabilities=(),
        setup_kind=setup_kind,  # type: ignore[arg-type]
        settings_fields=settings_fields,
    )


def test_validate_connection_id_strips_valid_ids() -> None:
    assert validate_connection_id(" connection-1 ") == "connection-1"


def test_validate_connection_id_rejects_unsafe_ids() -> None:
    with pytest.raises(McpConnectionRuleViolation, match="URL-safe"):
        validate_connection_id("connection/1")


def test_generate_server_name_normalizes_and_disambiguates() -> None:
    entry = _entry(server_name_base="Linear MCP!")

    assert generate_server_name(entry, set(), "abc-123") == "linear_mcp"
    assert generate_server_name(entry, {"linear_mcp"}, "abc-123") == "linear_mcp_abc123"


def test_local_oauth_google_email_is_normalized_and_locked() -> None:
    entry = _entry(
        entry_id="gmail",
        setup_kind="local_oauth",
        settings_fields=(
            CatalogSettingField(
                id="userGoogleEmail",
                label="Google account",
                kind="string",
                required=True,
            ),
        ),
    )

    settings = validate_connection_settings(
        entry,
        {"userGoogleEmail": " User@Example.COM "},
    )

    assert settings["userGoogleEmail"] == "user@example.com"
    reject_local_oauth_account_change(
        entry,
        {"userGoogleEmail": "user@example.com"},
        {"userGoogleEmail": "USER@example.com"},
    )
    with pytest.raises(McpConnectionRuleViolation, match="Disconnect and reconnect"):
        reject_local_oauth_account_change(
            entry,
            {"userGoogleEmail": "user@example.com"},
            {"userGoogleEmail": "other@example.com"},
        )


def test_auth_state_resolves_missing_auth_and_unknown_statuses() -> None:
    assert resolve_connection_auth_state(
        entry_auth_kind="none",
        has_auth=False,
        stored_auth_kind=None,
        stored_auth_status=None,
    ) == ConnectionAuthState(auth_kind="none", auth_status="ready")
    assert resolve_connection_auth_state(
        entry_auth_kind="oauth",
        has_auth=False,
        stored_auth_kind=None,
        stored_auth_status=None,
    ) == ConnectionAuthState(auth_kind="oauth", auth_status="needs_reconnect")
    assert resolve_connection_auth_state(
        entry_auth_kind="oauth",
        has_auth=True,
        stored_auth_kind="oauth",
        stored_auth_status="unexpected",
    ) == ConnectionAuthState(auth_kind="oauth", auth_status="error")
    assert resolve_connection_auth_state(
        entry_auth_kind="oauth",
        has_auth=True,
        stored_auth_kind="secret",
        stored_auth_status="ready",
    ) == ConnectionAuthState(auth_kind="oauth", auth_status="needs_reconnect")


def test_oauth_resource_change_policy_only_blocks_ready_oauth() -> None:
    assert oauth_resource_change_requires_reconnect(
        auth_kind="oauth",
        auth_status="ready",
        old_resource_url="https://old.example.com/mcp",
        new_resource_url="https://new.example.com/mcp",
    )
    assert not oauth_resource_change_requires_reconnect(
        auth_kind="secret",
        auth_status="ready",
        old_resource_url="https://old.example.com/mcp",
        new_resource_url="https://new.example.com/mcp",
    )
    assert not oauth_resource_change_requires_reconnect(
        auth_kind="oauth",
        auth_status="needs_reconnect",
        old_resource_url="https://old.example.com/mcp",
        new_resource_url="https://new.example.com/mcp",
    )
