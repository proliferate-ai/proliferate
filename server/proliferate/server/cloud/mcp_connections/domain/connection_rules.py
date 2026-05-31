from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Literal

from proliferate.constants.cloud_mcp import (
    CLOUD_MCP_CONNECTION_ID_ERROR,
    CLOUD_MCP_CONNECTION_ID_PATTERN,
    CLOUD_MCP_SERVER_NAME_MAX_LENGTH,
)
from proliferate.server.cloud.mcp_catalog.domain.rendering import (
    parse_settings as catalog_parse_settings,
)
from proliferate.server.cloud.mcp_catalog.domain.rendering import (
    render_oauth_resource_url,
    validate_secret_fields,
)
from proliferate.server.cloud.mcp_catalog.domain.rendering import (
    validate_settings as catalog_validate_settings,
)
from proliferate.server.cloud.mcp_catalog.domain.types import (
    CatalogConfigurationError,
    CatalogEntry,
)

CloudMcpAuthKind = Literal["secret", "oauth", "none"]
CloudMcpAuthStatus = Literal["ready", "needs_reconnect", "error"]

_CONNECTION_ID_RE = re.compile(CLOUD_MCP_CONNECTION_ID_PATTERN)
_SERVER_NAME_CHARS = re.compile(r"[^a-z0-9]+")
_EDGE_UNDERSCORES = re.compile(r"^_+|_+$")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class McpConnectionRuleViolation(ValueError):
    """Raised when a pure MCP connection rule rejects input."""


@dataclass(frozen=True)
class ConnectionAuthState:
    auth_kind: CloudMcpAuthKind
    auth_status: CloudMcpAuthStatus


def validate_connection_id(connection_id: str) -> str:
    cleaned = connection_id.strip()
    if not _CONNECTION_ID_RE.fullmatch(cleaned):
        raise McpConnectionRuleViolation(CLOUD_MCP_CONNECTION_ID_ERROR)
    return cleaned


def connection_settings_json(settings: dict[str, object]) -> str:
    return json.dumps(settings, separators=(",", ":"), sort_keys=True)


def parse_connection_settings(raw: str) -> dict[str, object]:
    return catalog_parse_settings(raw)


def validate_connection_settings(
    entry: CatalogEntry,
    settings: dict[str, object] | None,
) -> dict[str, object]:
    try:
        cleaned = catalog_validate_settings(entry, settings)
    except CatalogConfigurationError as exc:
        raise McpConnectionRuleViolation(str(exc)) from exc
    if entry.id == "gmail" and entry.setup_kind == "local_oauth":
        cleaned["userGoogleEmail"] = _validate_google_account_email(cleaned.get("userGoogleEmail"))
    return cleaned


def validate_connection_secret_fields(
    entry: CatalogEntry,
    secret_fields: dict[str, str],
) -> dict[str, str]:
    try:
        return validate_secret_fields(entry, secret_fields)
    except CatalogConfigurationError as exc:
        raise McpConnectionRuleViolation(str(exc)) from exc


def reject_local_oauth_account_change(
    entry: CatalogEntry,
    old_settings: dict[str, object],
    new_settings: dict[str, object],
) -> None:
    if entry.setup_kind != "local_oauth":
        return
    old_email = str(old_settings.get("userGoogleEmail", "")).strip().lower()
    new_email = str(new_settings.get("userGoogleEmail", "")).strip().lower()
    if old_email and new_email and old_email != new_email:
        raise McpConnectionRuleViolation(
            "Disconnect and reconnect Gmail to change Google accounts."
        )


def connection_oauth_resource_url(entry: CatalogEntry, settings: dict[str, object]) -> str:
    try:
        return render_oauth_resource_url(entry, settings)
    except CatalogConfigurationError as exc:
        raise McpConnectionRuleViolation(str(exc)) from exc


def generate_server_name(
    entry: CatalogEntry,
    existing_names: set[str],
    connection_id: str,
) -> str:
    base = _normalize_server_name_base(entry.server_name_base)
    if base not in existing_names:
        return base
    return f"{base}_{connection_id.replace('-', '')[:6]}"


def resolve_connection_auth_state(
    *,
    entry_auth_kind: str | None,
    has_auth: bool,
    stored_auth_kind: str | None,
    stored_auth_status: str | None,
) -> ConnectionAuthState:
    auth_kind = _connection_auth_kind(entry_auth_kind)
    if not has_auth:
        auth_status: CloudMcpAuthStatus = "ready" if auth_kind == "none" else "needs_reconnect"
        return ConnectionAuthState(auth_kind, auth_status)
    if _connection_auth_kind(stored_auth_kind) != auth_kind:
        return ConnectionAuthState(auth_kind, "needs_reconnect")
    return ConnectionAuthState(auth_kind, _connection_auth_status(stored_auth_status))


def oauth_resource_change_requires_reconnect(
    *,
    auth_kind: str,
    auth_status: str | None,
    old_resource_url: str,
    new_resource_url: str,
) -> bool:
    return auth_kind == "oauth" and auth_status == "ready" and old_resource_url != new_resource_url


def _validate_google_account_email(value: object) -> str:
    if not isinstance(value, str):
        raise McpConnectionRuleViolation("Gmail requires a Google account email.")
    email = value.strip().lower()
    if not _EMAIL_RE.fullmatch(email):
        raise McpConnectionRuleViolation("Gmail requires a valid Google account email.")
    return email


def _normalize_server_name_base(value: str) -> str:
    normalized = _SERVER_NAME_CHARS.sub("_", value.strip().lower())
    normalized = _EDGE_UNDERSCORES.sub("", normalized)
    return (normalized or "mcp")[:CLOUD_MCP_SERVER_NAME_MAX_LENGTH] or "mcp"


def _connection_auth_kind(entry_auth_kind: str | None) -> CloudMcpAuthKind:
    if entry_auth_kind in {"secret", "oauth", "none"}:
        return entry_auth_kind
    return "none"


def _connection_auth_status(value: str | None) -> CloudMcpAuthStatus:
    if value in {"ready", "needs_reconnect", "error"}:
        return value
    return "error"
