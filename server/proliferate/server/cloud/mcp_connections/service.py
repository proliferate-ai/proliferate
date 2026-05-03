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
from proliferate.db.store.cloud_mcp.custom_definitions import (
    get_custom_definition,
    get_custom_definition_by_db_id,
    list_custom_definitions_by_db_ids,
)
from proliferate.db.store.cloud_mcp.types import (
    CloudMcpConnectionRecord,
    CloudMcpCustomDefinitionRecord,
)
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
from proliferate.server.cloud.mcp_custom_definitions.models import (
    CustomMcpDefinitionSummaryModel,
)
from proliferate.server.cloud.mcp_custom_definitions.service import (
    custom_definition_summary,
    custom_definition_to_catalog_entry,
)
from proliferate.utils.crypto import decrypt_json, encrypt_json

_CONNECTION_ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,255}$")
_SERVER_NAME_CHARS = re.compile(r"[^a-z0-9]+")
_EDGE_UNDERSCORES = re.compile(r"^_+|_+$")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


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
    connection_id: str = "",
) -> str:
    base = _normalize_server_name_base(entry.server_name_base)
    if base not in existing_names:
        return base
    suffix = connection_id.replace("-", "")[:6]
    if suffix:
        candidate = f"{base}_{suffix}"
        if candidate not in existing_names:
            return candidate
    counter = 2
    while True:
        candidate = f"{base}_{counter}"
        if candidate not in existing_names:
            return candidate
        counter += 1


def _settings_json(settings: dict[str, object]) -> str:
    return json.dumps(settings, separators=(",", ":"), sort_keys=True)


def _parse_settings(raw: str) -> dict[str, object]:
    return catalog_parse_settings(raw)


def _validate_settings(
    entry: CatalogEntry,
    settings: dict[str, object] | None,
) -> dict[str, object]:
    try:
        cleaned = catalog_validate_settings(entry, settings)
    except CatalogConfigurationError as exc:
        _invalid_payload(str(exc))
    if entry.id == "gmail" and entry.setup_kind == "local_oauth":
        raw_email = cleaned.get("userGoogleEmail")
        if not isinstance(raw_email, str):
            _invalid_payload("Gmail requires a Google account email.")
        email = raw_email.strip().lower()
        if not _EMAIL_RE.fullmatch(email):
            _invalid_payload("Gmail requires a valid Google account email.")
        cleaned["userGoogleEmail"] = email
    return cleaned


def _reject_local_oauth_account_change(
    entry: CatalogEntry,
    old_settings: dict[str, object],
    new_settings: dict[str, object],
) -> None:
    if entry.setup_kind != "local_oauth":
        return
    old_email = str(old_settings.get("userGoogleEmail", "")).strip().lower()
    new_email = str(new_settings.get("userGoogleEmail", "")).strip().lower()
    if old_email and new_email and old_email != new_email:
        _invalid_payload("Disconnect and reconnect Gmail to change Google accounts.")


def _clean_secret_fields(entry: CatalogEntry, secret_fields: dict[str, str]) -> dict[str, str]:
    try:
        return validate_secret_fields(entry, secret_fields)
    except CatalogConfigurationError as exc:
        _invalid_payload(str(exc))


def _connection_target_kind(
    body: CreateCloudMcpConnectionRequest,
) -> tuple[str, str]:
    if body.target_kind is None:
        if body.catalog_entry_id and not body.custom_definition_id:
            return "curated", body.catalog_entry_id
        _invalid_payload("Connection target must be specified.")
    if body.target_kind == "curated":
        if body.catalog_entry_id and not body.custom_definition_id:
            return "curated", body.catalog_entry_id
        _invalid_payload("Curated MCP connections require only catalogEntryId.")
    if body.custom_definition_id and not body.catalog_entry_id:
        return "custom", body.custom_definition_id
    _invalid_payload("Custom MCP connections require only customDefinitionId.")


async def _custom_definitions_for_records(
    user_id: UUID,
    records: list[CloudMcpConnectionRecord],
) -> dict[UUID, CloudMcpCustomDefinitionRecord]:
    definition_ids = {
        record.custom_definition_db_id
        for record in records
        if record.custom_definition_db_id is not None
    }
    definitions = await list_custom_definitions_by_db_ids(user_id, definition_ids)
    return {definition.id: definition for definition in definitions}


async def _definition_for_record(
    record: CloudMcpConnectionRecord,
    custom_definitions: dict[UUID, CloudMcpCustomDefinitionRecord] | None,
) -> CloudMcpCustomDefinitionRecord | None:
    if record.custom_definition_db_id is None:
        return None
    if custom_definitions is not None:
        return custom_definitions.get(record.custom_definition_db_id)
    return await get_custom_definition_by_db_id(
        record.user_id,
        record.custom_definition_db_id,
    )


async def _entry_for_record(
    record: CloudMcpConnectionRecord,
    custom_definitions: dict[UUID, CloudMcpCustomDefinitionRecord] | None = None,
) -> CatalogEntry | None:
    if record.catalog_entry_id is not None:
        return get_catalog_entry(record.catalog_entry_id)
    definition = await _definition_for_record(record, custom_definitions)
    if definition is None:
        return None
    try:
        return custom_definition_to_catalog_entry(definition)
    except ValueError:
        return None


async def _custom_definition_payload_for_record(
    record: CloudMcpConnectionRecord,
    custom_definitions: dict[UUID, CloudMcpCustomDefinitionRecord] | None = None,
) -> CustomMcpDefinitionSummaryModel | None:
    definition = await _definition_for_record(record, custom_definitions)
    if definition is None:
        return None
    try:
        return custom_definition_summary(definition)
    except ValueError:
        return None


def _auth_state(
    record: CloudMcpConnectionRecord,
    entry: CatalogEntry | None,
) -> tuple[CloudMcpAuthKind, CloudMcpAuthStatus]:
    auth_kind: CloudMcpAuthKind = _connection_auth_kind(entry)
    if record.auth is None:
        if record.payload_ciphertext:
            return auth_kind, "needs_reconnect"
        return auth_kind, "ready" if auth_kind == "none" else "needs_reconnect"
    if auth_kind == "none":
        return auth_kind, "ready"
    if record.auth.auth_kind != auth_kind:
        return auth_kind, "needs_reconnect"
    if auth_kind == "secret":
        auth_status = _connection_auth_status(record.auth.auth_status)
        if auth_status != "ready" or entry is None:
            return auth_kind, auth_status
        if _secret_auth_matches_entry(record, entry):
            return auth_kind, "ready"
        return auth_kind, "needs_reconnect"
    return auth_kind, _connection_auth_status(record.auth.auth_status)


def _secret_auth_matches_entry(
    record: CloudMcpConnectionRecord,
    entry: CatalogEntry,
) -> bool:
    if (
        record.auth is None
        or record.auth.auth_kind != "secret"
        or record.auth.payload_format != "secret-fields-v1"
        or not record.auth.payload_ciphertext
    ):
        return False
    try:
        payload = decrypt_json(record.auth.payload_ciphertext)
    except Exception:
        return False
    secret_fields = payload.get("secretFields")
    if not isinstance(secret_fields, dict):
        return False
    try:
        validate_secret_fields(
            entry,
            {str(key): str(value) for key, value in secret_fields.items()},
        )
    except CatalogConfigurationError:
        return False
    return True


async def _connection_payload(
    record: CloudMcpConnectionRecord,
    custom_definitions: dict[UUID, CloudMcpCustomDefinitionRecord] | None = None,
) -> CloudMcpConnectionResponse:
    entry = await _entry_for_record(record, custom_definitions)
    auth_kind, auth_status = _auth_state(record, entry)
    parsed_settings = _parse_settings(record.settings_json)
    if entry is not None:
        with suppress(CatalogConfigurationError):
            parsed_settings = catalog_validate_settings(entry, parsed_settings)
    custom_definition = await _custom_definition_payload_for_record(
        record,
        custom_definitions,
    )
    return cloud_mcp_connection_payload(
        record,
        parsed_settings,
        auth_kind,
        auth_status,
        custom_definition_id=(
            custom_definition.definition_id if custom_definition is not None else None
        ),
        custom_definition=custom_definition,
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
    custom_definitions = await _custom_definitions_for_records(user_id, records)
    return CloudMcpConnectionsResponse(
        connections=[
            await _connection_payload(record, custom_definitions) for record in records
        ]
    )


async def create_cloud_mcp_connection(
    user_id: UUID,
    body: CreateCloudMcpConnectionRequest,
) -> CloudMcpConnectionResponse:
    target_kind, target_id = _connection_target_kind(body)
    if target_kind == "custom":
        definition_id = target_id.strip()
        definition = await get_custom_definition(user_id, definition_id)
        if definition is None or definition.deleted_at is not None or not definition.enabled:
            _invalid_payload("Custom MCP definition was not found.")
        try:
            entry = custom_definition_to_catalog_entry(definition)
        except ValueError as exc:
            _invalid_payload(str(exc))
        catalog_entry_id = None
        custom_definition_db_id = definition.id
    else:
        catalog_entry_id = target_id.strip()
        curated_entry = get_catalog_entry(catalog_entry_id)
        if curated_entry is None:
            _invalid_payload("Connector catalog entry was not found.")
        entry = curated_entry
        if not catalog_entry_is_configured(entry):
            _invalid_payload("Connector catalog entry is not configured for this deployment.")
        custom_definition_db_id = None
    settings = _validate_settings(entry, body.settings)
    existing = await list_user_connections(user_id)
    if catalog_entry_id is not None and any(
        record.catalog_entry_id == catalog_entry_id for record in existing
    ):
        _invalid_payload(f"{entry.name} is already connected.")
    if custom_definition_db_id is not None and any(
        record.custom_definition_db_id == custom_definition_db_id for record in existing
    ):
        _invalid_payload(f"{entry.name} is already connected.")
    connection_id = ""
    server_name = _generate_server_name(
        entry,
        {record.server_name for record in existing},
        connection_id,
    )
    record = await upsert_user_connection(
        user_id=user_id,
        catalog_entry_id=catalog_entry_id,
        custom_definition_db_id=custom_definition_db_id,
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
    return await _connection_payload(record)


async def patch_cloud_mcp_connection(
    user_id: UUID,
    connection_id: str,
    body: PatchCloudMcpConnectionRequest,
) -> CloudMcpConnectionResponse:
    cleaned_connection_id = validate_connection_id(connection_id)
    existing = await get_user_connection(user_id, cleaned_connection_id)
    if existing is None:
        _not_found()
    entry = await _entry_for_record(existing)
    if entry is None:
        _invalid_payload("MCP connector definition was not found.")
    settings_json = None
    if body.settings is not None:
        new_settings = _validate_settings(entry, body.settings)
        old_settings = _parse_settings(existing.settings_json)
        _reject_local_oauth_account_change(entry, old_settings, new_settings)
        if entry.auth_kind == "oauth" and existing.auth and existing.auth.auth_status == "ready":
            old_resource = _oauth_resource_url(entry, old_settings)
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
    return await _connection_payload(record)


async def put_cloud_mcp_connection_secret_auth(
    user_id: UUID,
    connection_id: str,
    body: PutCloudMcpSecretAuthRequest,
) -> CloudMcpConnectionResponse:
    cleaned_connection_id = validate_connection_id(connection_id)
    record = await get_user_connection(user_id, cleaned_connection_id)
    if record is None:
        _not_found()
    entry = await _entry_for_record(record)
    if entry is None:
        _invalid_payload("MCP connector definition was not found.")
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
    return await _connection_payload(updated)


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
        if record.catalog_entry_id is not None
    ]


async def sync_cloud_mcp_connection_for_user(
    user_id: UUID,
    connection_id: str,
    body: SyncCloudMcpConnectionRequest,
) -> None:
    cleaned_connection_id = validate_connection_id(connection_id)
    existing_record = await get_user_connection(user_id, cleaned_connection_id)
    if existing_record is not None and existing_record.catalog_entry_id is None:
        _invalid_payload("Legacy MCP sync does not support custom MCP definitions.")
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
