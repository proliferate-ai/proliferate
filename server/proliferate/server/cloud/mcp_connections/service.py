from __future__ import annotations

import json
import re
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
from proliferate.server.cloud.mcp_catalog.catalog import CatalogEntry, get_catalog_entry
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
    try:
        value = json.loads(raw or "{}")
    except Exception:
        return {}
    return value if isinstance(value, dict) else {}


def _validate_settings(
    entry: CatalogEntry,
    settings: dict[str, object] | None,
) -> dict[str, object]:
    cleaned = dict(settings or {})
    if entry.id != "supabase":
        if cleaned:
            _invalid_payload(f"{entry.name} does not accept connector settings.")
        return {}
    if cleaned.get("kind") != "supabase":
        _invalid_payload("Supabase requires project settings before connecting.")
    project_ref = cleaned.get("projectRef")
    read_only = cleaned.get("readOnly")
    if not isinstance(project_ref, str) or not project_ref.strip():
        _invalid_payload("Supabase requires a project ref before connecting.")
    if not isinstance(read_only, bool):
        _invalid_payload("Supabase requires a read-only setting.")
    return {
        "kind": "supabase",
        "projectRef": project_ref.strip(),
        "readOnly": read_only,
    }


def _clean_secret_fields(entry: CatalogEntry, secret_fields: dict[str, str]) -> dict[str, str]:
    if entry.auth_kind != "secret":
        _invalid_payload(f"{entry.name} does not use API-key authentication.")
    required = {field.id for field in entry.required_fields}
    cleaned: dict[str, str] = {}
    for raw_field_id, raw_value in secret_fields.items():
        field_id = raw_field_id.strip()
        value = raw_value.strip()
        if field_id not in required:
            _invalid_payload(f"'{field_id}' is not a secret field for {entry.name}.")
        if not value:
            _invalid_payload(f"Cloud connector sync requires a value for '{field_id}'.")
        cleaned[field_id] = value
    missing = sorted(required - set(cleaned))
    if missing:
        _invalid_payload(f"Cloud connector sync requires values for: {', '.join(missing)}.")
    return cleaned


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
    return cloud_mcp_connection_payload(
        record,
        _parse_settings(record.settings_json),
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
        record = await get_user_connection(user_id, record.connection_id)
        if record is None:
            _not_found()
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
        settings_json = _settings_json(_validate_settings(entry, body.settings))
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


async def delete_legacy_cloud_mcp_connection_for_user(
    user_id: UUID,
    connection_id: str,
) -> None:
    await legacy_delete_connection(
        user_id=user_id,
        connection_id=validate_connection_id(connection_id),
    )
