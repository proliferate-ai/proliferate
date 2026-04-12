"""Request schemas and status payloads for cloud MCP connection replicas."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class SyncCloudMcpConnectionRequest(BaseModel):
    catalog_entry_id: str = Field(alias="catalogEntryId")
    secret_fields: dict[str, str] = Field(alias="secretFields")


class CloudMcpConnectionSyncStatus(BaseModel):
    connection_id: str = Field(serialization_alias="connectionId")
    catalog_entry_id: str = Field(serialization_alias="catalogEntryId")
    synced: bool
    last_synced_at: str | None = Field(default=None, serialization_alias="lastSyncedAt")


class OkResponse(BaseModel):
    ok: bool = True


def _to_iso(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def cloud_mcp_connection_status_payload(record: object) -> CloudMcpConnectionSyncStatus:
    return CloudMcpConnectionSyncStatus(
        connection_id=str(record.connection_id),
        catalog_entry_id=str(record.catalog_entry_id),
        synced=True,
        last_synced_at=_to_iso(getattr(record, "last_synced_at", None)),
    )
