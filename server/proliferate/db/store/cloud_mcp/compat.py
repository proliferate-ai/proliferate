from __future__ import annotations

from uuid import UUID

from proliferate.db.store.cloud_mcp.auth import upsert_connection_auth
from proliferate.db.store.cloud_mcp.connections import (
    delete_user_connection,
    list_user_connections,
    upsert_user_connection,
)
from proliferate.db.store.cloud_mcp.types import CloudMcpConnectionRecord
from proliferate.server.cloud.mcp_catalog.catalog import CatalogEntry


async def legacy_upsert_secret_connection(
    *,
    user_id: UUID,
    connection_id: str,
    catalog_entry: CatalogEntry,
    server_name: str,
    settings_json: str,
    payload_ciphertext: str,
    payload_format: str = "secret-fields-v1",
) -> None:
    connection = await upsert_user_connection(
        user_id=user_id,
        connection_id=connection_id,
        catalog_entry_id=catalog_entry.id,
        catalog_entry_version=catalog_entry.version,
        server_name=server_name,
        settings_json=settings_json,
        enabled=True,
    )
    await upsert_connection_auth(
        connection_db_id=connection.id,
        auth_kind="secret",
        auth_status="ready",
        payload_ciphertext=payload_ciphertext,
        payload_format=payload_format,
    )


async def legacy_delete_connection(*, user_id: UUID, connection_id: str) -> None:
    await delete_user_connection(user_id, connection_id)


async def legacy_list_connections(user_id: UUID) -> list[CloudMcpConnectionRecord]:
    return await list_user_connections(user_id)
