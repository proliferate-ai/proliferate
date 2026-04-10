from __future__ import annotations

from typing import NoReturn
from uuid import UUID

from proliferate.db.store.cloud_mcp_connections import (
    load_cloud_mcp_connections_for_user,
    persist_cloud_mcp_connection_delete,
    persist_cloud_mcp_connection_sync,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.mcp_connections.models import (
    CloudMcpConnectionSyncStatus,
    SyncCloudMcpConnectionRequest,
    cloud_mcp_connection_status_payload,
)
from proliferate.utils.crypto import encrypt_json


def _invalid_payload(message: str) -> NoReturn:
    raise CloudApiError("invalid_payload", message, status_code=400)


def _clean_secret_fields(secret_fields: dict[str, str]) -> dict[str, str]:
    cleaned: dict[str, str] = {}
    for raw_field_id, raw_value in secret_fields.items():
        field_id = raw_field_id.strip()
        value = raw_value.strip()
        if not field_id:
            _invalid_payload("Cloud connector sync requires non-empty field ids.")
        if not value:
            _invalid_payload(f"Cloud connector sync requires a value for '{field_id}'.")
        cleaned[field_id] = value
    if not cleaned:
        _invalid_payload("Cloud connector sync requires at least one secret field.")
    return cleaned


async def list_cloud_mcp_connection_statuses(
    user_id: UUID,
) -> list[CloudMcpConnectionSyncStatus]:
    records = await load_cloud_mcp_connections_for_user(user_id)
    return [cloud_mcp_connection_status_payload(record) for record in records]


async def sync_cloud_mcp_connection_for_user(
    user_id: UUID,
    connection_id: str,
    body: SyncCloudMcpConnectionRequest,
) -> None:
    cleaned_connection_id = connection_id.strip()
    cleaned_catalog_entry_id = body.catalog_entry_id.strip()
    if not cleaned_connection_id:
        _invalid_payload("Cloud connector sync requires a connection id.")
    if not cleaned_catalog_entry_id:
        _invalid_payload("Cloud connector sync requires a catalog entry id.")
    await persist_cloud_mcp_connection_sync(
        user_id=user_id,
        connection_id=cleaned_connection_id,
        catalog_entry_id=cleaned_catalog_entry_id,
        payload_ciphertext=encrypt_json(
            {
                "catalogEntryId": cleaned_catalog_entry_id,
                "secretFields": _clean_secret_fields(body.secret_fields),
            }
        ),
    )


async def delete_cloud_mcp_connection_for_user(
    user_id: UUID,
    connection_id: str,
) -> None:
    cleaned_connection_id = connection_id.strip()
    if not cleaned_connection_id:
        _invalid_payload("Cloud connector delete requires a connection id.")
    await persist_cloud_mcp_connection_delete(
        user_id=user_id,
        connection_id=cleaned_connection_id,
    )
