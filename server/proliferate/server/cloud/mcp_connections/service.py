from __future__ import annotations

import json
import re
from contextlib import suppress
from typing import NoReturn
from uuid import UUID

from proliferate.db.store.cloud_mcp.auth import upsert_connection_auth
from proliferate.db.store.cloud_mcp.compat import (
    legacy_delete_connection,
    legacy_list_connections,
    legacy_upsert_secret_connection,
)
from proliferate.db.store.cloud_mcp.connections import (
    delete_user_connection,
    get_user_connection,
    list_user_connections,
    patch_user_connection,
    upsert_user_connection,
)
from proliferate.db.store.cloud_mcp.types import CloudMcpConnectionRecord
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.mcp_catalog.availability import catalog_entry_is_configured
from proliferate.server.cloud.mcp_catalog.catalog import (
    CatalogConfigurationError,
    CatalogEntry,
    get_catalog_entry,
    render_oauth_resource_url,
    validate_secret_fields,
)
from proliferate.server.cloud.mcp_catalog.catalog import (
    parse_settings as catalog_parse_settings,
)
from proliferate.server.cloud.mcp_catalog.catalog import (
    validate_settings as catalog_validate_settings,
)
from proliferate.server.cloud.mcp_connections.models import (
    CloudMcpAuthKind,
    CloudMcpAuthStatus,
    CloudMcpConnectionResponse,
    CloudMcpConnectionsResponse,
    CloudMcpConnectionSyncStatus,
    CreateCloudMcpConnectionRequest,
    PatchCloudMcpConnectionRequest,
    PutCloudMcpSecretAuthRequest,
    SyncCloudMcpConnectionRequest,
    cloud_mcp_connection_payload,
    cloud_mcp_connection_status_payload,
)
from proliferate.utils.crypto import encrypt_json

_CONNECTION_ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,255}$")
_SERVER_NAME_CHARS = re.compile(r"[^a-z0-9]+")
_EDGE_UNDERSCORES = re.compile(r"^_+|_+$")


def _invalid_payload(message: str) -> NoReturn:
    raise CloudApiError("invalid_payload", message, status_code=400)


def _not_found() -> NoReturn:
    raise CloudApiError("not_found", "MCP connection was not found.", status_code=404)


def validate_connection_id(connection_id: str) -> str:
    cleaned = connection_id.strip()
    if not _CONNECTION_ID_RE.fullmatch(cleaned):
        _invalid_payload("MCP connection id must be 1-255 URL-safe characters.")
    return cleaned


def _normalize_server_name_base(value: str) -> str:
    normalized = _SERVER_NAME_CHARS.sub("_", value.strip().lower())
    normalized = _EDGE_UNDERSCORES.sub("", normalized)
    return (normalized or "mcp")[:40] or "mcp"


def _generate_server_name(
    entry: CatalogEntry,
    existing_names: set[str],
    connection_id: str,
) -> str:
    base = _normalize_server_name_base(entry.server_name_base)
    if base not in existing_names:
        return base
    return f"{base}_{connection_id.replace('-', '')[:6]}"


def _settings_json(settings: dict[str, object]) -> str:
    return json.dumps(settings, separators=(",", ":"), sort_keys=True)


def _parse_settings(raw: str) -> dict[str, object]:
    return catalog_parse_settings(raw)


def _validate_settings(
    entry: CatalogEntry,
    settings: dict[str, object] | None,
) -> dict[str, object]:
    try:
        return catalog_validate_settings(entry, settings)
    except CatalogConfigurationError as exc:
        _invalid_payload(str(exc))


def _clean_secret_fields(entry: CatalogEntry, secret_fields: dict[str, str]) -> dict[str, str]:
    try:
        return validate_secret_fields(entry, secret_fields)
    except CatalogConfigurationError as exc:
        _invalid_payload(str(exc))


def _auth_state(
    record: CloudMcpConnectionRecord,
) -> tuple[CloudMcpAuthKind, CloudMcpAuthStatus]:
    entry = get_catalog_entry(record.catalog_entry_id)
    auth_kind: CloudMcpAuthKind = _connection_auth_kind(entry)
    if record.auth is None:
        if record.payload_ciphertext:
            return auth_kind, "needs_reconnect"
        return auth_kind, "ready" if auth_kind == "none" else "needs_reconnect"
    return auth_kind, _connection_auth_status(record.auth.auth_status)


def _connection_payload(record: CloudMcpConnectionRecord) -> CloudMcpConnectionResponse:
    auth_kind, auth_status = _auth_state(record)
    entry = get_catalog_entry(record.catalog_entry_id)
    parsed_settings = _parse_settings(record.settings_json)
    if entry is not None:
        with suppress(CatalogConfigurationError):
            parsed_settings = catalog_validate_settings(entry, parsed_settings)
    return cloud_mcp_connection_payload(
        record,
        parsed_settings,
        auth_kind,
        auth_status,
    )


def _connection_auth_kind(entry: CatalogEntry | None) -> CloudMcpAuthKind:
    if entry is None:
        return "none"
    if entry.auth_kind in {"secret", "oauth", "none"}:
        return entry.auth_kind
    return "none"


def _connection_auth_status(value: str) -> CloudMcpAuthStatus:
    if value in {"ready", "needs_reconnect", "error"}:
        return value  # type: ignore[return-value]
    return "error"


async def list_cloud_mcp_connections(user_id: UUID) -> CloudMcpConnectionsResponse:
    records = await list_user_connections(user_id)
    return CloudMcpConnectionsResponse(
        connections=[_connection_payload(record) for record in records]
    )


async def create_cloud_mcp_connection(
    user_id: UUID,
    body: CreateCloudMcpConnectionRequest,
) -> CloudMcpConnectionResponse:
    catalog_entry_id = body.catalog_entry_id.strip()
    entry = get_catalog_entry(catalog_entry_id)
    if entry is None:
        _invalid_payload("Connector catalog entry was not found.")
    if not catalog_entry_is_configured(entry):
        _invalid_payload("Connector catalog entry is not configured for this deployment.")
    settings = _validate_settings(entry, body.settings)
    existing = await list_user_connections(user_id)
    if any(record.catalog_entry_id == entry.id for record in existing):
        _invalid_payload(f"{entry.name} is already connected.")
    connection_id = ""
    server_name = _generate_server_name(
        entry,
        {record.server_name for record in existing},
        connection_id,
    )
    record = await upsert_user_connection(
        user_id=user_id,
        catalog_entry_id=entry.id,
        catalog_entry_version=entry.version,
        server_name=server_name,
        settings_json=_settings_json(settings),
        enabled=body.enabled,
    )
    if entry.auth_kind == "none":
        await upsert_connection_auth(
            connection_db_id=record.id,
            auth_kind="none",
            auth_status="ready",
            payload_ciphertext=None,
            payload_format="json-v1",
        )
        refreshed = await get_user_connection(user_id, record.connection_id)
        if refreshed is None:
            _not_found()
        record = refreshed
    return _connection_payload(record)


async def patch_cloud_mcp_connection(
    user_id: UUID,
    connection_id: str,
    body: PatchCloudMcpConnectionRequest,
) -> CloudMcpConnectionResponse:
    cleaned_connection_id = validate_connection_id(connection_id)
    existing = await get_user_connection(user_id, cleaned_connection_id)
    if existing is None:
        _not_found()
    entry = get_catalog_entry(existing.catalog_entry_id)
    if entry is None:
        _invalid_payload("Connector catalog entry was not found.")
    settings_json = None
    if body.settings is not None:
        new_settings = _validate_settings(entry, body.settings)
        if entry.auth_kind == "oauth" and existing.auth and existing.auth.auth_status == "ready":
            old_resource = _oauth_resource_url(entry, _parse_settings(existing.settings_json))
            new_resource = _oauth_resource_url(entry, new_settings)
            if old_resource != new_resource:
                _invalid_payload("Reconnect this MCP before changing URL-affecting settings.")
        settings_json = _settings_json(new_settings)
    record = await patch_user_connection(
        user_id=user_id,
        connection_id=cleaned_connection_id,
        enabled=body.enabled,
        settings_json=settings_json,
        catalog_entry_version=entry.version if settings_json is not None else None,
    )
    if record is None:
        _not_found()
    return _connection_payload(record)


async def put_cloud_mcp_connection_secret_auth(
    user_id: UUID,
    connection_id: str,
    body: PutCloudMcpSecretAuthRequest,
) -> CloudMcpConnectionResponse:
    cleaned_connection_id = validate_connection_id(connection_id)
    record = await get_user_connection(user_id, cleaned_connection_id)
    if record is None:
        _not_found()
    entry = get_catalog_entry(record.catalog_entry_id)
    if entry is None:
        _invalid_payload("Connector catalog entry was not found.")
    cleaned = _clean_secret_fields(entry, body.secret_fields)
    await upsert_connection_auth(
        connection_db_id=record.id,
        auth_kind="secret",
        auth_status="ready",
        payload_ciphertext=encrypt_json({"secretFields": cleaned}),
        payload_format="secret-fields-v1",
    )
    updated = await get_user_connection(user_id, cleaned_connection_id)
    if updated is None:
        _not_found()
    return _connection_payload(updated)


async def delete_cloud_mcp_connection_for_user(
    user_id: UUID,
    connection_id: str,
) -> None:
    await delete_user_connection(user_id, validate_connection_id(connection_id))


async def list_cloud_mcp_connection_statuses(
    user_id: UUID,
) -> list[CloudMcpConnectionSyncStatus]:
    return [
        cloud_mcp_connection_status_payload(record)
        for record in await legacy_list_connections(user_id)
    ]


async def sync_cloud_mcp_connection_for_user(
    user_id: UUID,
    connection_id: str,
    body: SyncCloudMcpConnectionRequest,
) -> None:
    cleaned_connection_id = validate_connection_id(connection_id)
    entry = get_catalog_entry(body.catalog_entry_id.strip())
    if entry is None:
        _invalid_payload("Connector catalog entry was not found.")
    if not entry.cloud_secret_sync:
        _invalid_payload(f"{entry.name} does not support legacy cloud secret sync.")
    cleaned = _clean_secret_fields(entry, body.secret_fields)
    existing = await list_user_connections(user_id)
    server_name = _generate_server_name(
        entry,
        {
            record.server_name
            for record in existing
            if record.connection_id != cleaned_connection_id
        },
        cleaned_connection_id,
    )
    await legacy_upsert_secret_connection(
        user_id=user_id,
        connection_id=cleaned_connection_id,
        catalog_entry=entry,
        server_name=server_name,
        settings_json="{}",
        payload_ciphertext=encrypt_json({"secretFields": cleaned}),
    )


def _oauth_resource_url(entry: CatalogEntry, settings: dict[str, object]) -> str:
    try:
        return render_oauth_resource_url(
            entry,
            settings,
        )
    except CatalogConfigurationError as exc:
        _invalid_payload(str(exc))


async def delete_legacy_cloud_mcp_connection_for_user(
    user_id: UUID,
    connection_id: str,
) -> None:
    await legacy_delete_connection(
        user_id=user_id,
        connection_id=validate_connection_id(connection_id),
    )
