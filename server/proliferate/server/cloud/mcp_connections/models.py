"""Request and response schemas for cloud-owned MCP connections."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from proliferate.db.store.cloud_mcp.types import CloudMcpConnectionRecord
from proliferate.server.cloud.mcp_custom_definitions.models import (
    CustomMcpDefinitionSummaryModel,
)

CloudMcpAuthKind = Literal["secret", "oauth", "none"]
CloudMcpAuthStatus = Literal["ready", "needs_reconnect", "error"]


class OkResponse(BaseModel):
    ok: bool = True


class CloudMcpConnectionSettings(BaseModel):
    model_config = ConfigDict(extra="allow")


class CreateCloudMcpConnectionRequest(BaseModel):
    target_kind: Literal["curated", "custom"] | None = Field(default=None, alias="targetKind")
    catalog_entry_id: str | None = Field(default=None, alias="catalogEntryId")
    custom_definition_id: str | None = Field(default=None, alias="customDefinitionId")
    settings: dict[str, object] | None = None
    enabled: bool = True


class PatchCloudMcpConnectionRequest(BaseModel):
    settings: dict[str, object] | None = None
    enabled: bool | None = None


class PutCloudMcpSecretAuthRequest(BaseModel):
    secret_fields: dict[str, str] = Field(alias="secretFields")


class SyncCloudMcpConnectionRequest(BaseModel):
    catalog_entry_id: str = Field(alias="catalogEntryId")
    secret_fields: dict[str, str] = Field(alias="secretFields")


class CloudMcpConnectionResponse(BaseModel):
    connection_id: str = Field(serialization_alias="connectionId")
    target_kind: Literal["curated", "custom"] = Field(serialization_alias="targetKind")
    catalog_entry_id: str | None = Field(default=None, serialization_alias="catalogEntryId")
    custom_definition_id: str | None = Field(
        default=None,
        serialization_alias="customDefinitionId",
    )
    custom_definition: CustomMcpDefinitionSummaryModel | None = Field(
        default=None,
        serialization_alias="customDefinition",
    )
    catalog_entry_version: int = Field(serialization_alias="catalogEntryVersion")
    server_name: str = Field(serialization_alias="serverName")
    enabled: bool
    auth_kind: CloudMcpAuthKind = Field(serialization_alias="authKind")
    auth_status: CloudMcpAuthStatus = Field(serialization_alias="authStatus")
    settings: dict[str, object] = Field(repr=False)
    config_version: int = Field(serialization_alias="configVersion")
    auth_version: int | None = Field(default=None, serialization_alias="authVersion")
    created_at: str = Field(serialization_alias="createdAt")
    updated_at: str = Field(serialization_alias="updatedAt")


class CloudMcpConnectionsResponse(BaseModel):
    connections: list[CloudMcpConnectionResponse]


class CloudMcpConnectionSyncStatus(BaseModel):
    connection_id: str = Field(serialization_alias="connectionId")
    catalog_entry_id: str = Field(serialization_alias="catalogEntryId")
    synced: bool
    last_synced_at: str | None = Field(default=None, serialization_alias="lastSyncedAt")


def _to_iso(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def cloud_mcp_connection_payload(
    record: CloudMcpConnectionRecord,
    settings: dict[str, object],
    auth_kind: CloudMcpAuthKind,
    auth_status: CloudMcpAuthStatus,
    *,
    custom_definition_id: str | None = None,
    custom_definition: CustomMcpDefinitionSummaryModel | None = None,
) -> CloudMcpConnectionResponse:
    return CloudMcpConnectionResponse(
        connection_id=record.connection_id,
        target_kind="custom" if custom_definition_id else "curated",
        catalog_entry_id=record.catalog_entry_id,
        custom_definition_id=custom_definition_id,
        custom_definition=custom_definition,
        catalog_entry_version=record.catalog_entry_version,
        server_name=record.server_name,
        enabled=record.enabled,
        auth_kind=auth_kind,
        auth_status=auth_status,
        settings=settings,
        config_version=record.config_version,
        auth_version=record.auth.auth_version if record.auth else None,
        created_at=_to_iso(record.created_at) or "",
        updated_at=_to_iso(record.updated_at) or "",
    )


def cloud_mcp_connection_status_payload(
    record: CloudMcpConnectionRecord,
) -> CloudMcpConnectionSyncStatus:
    if record.catalog_entry_id is None:
        raise ValueError("Legacy MCP connection status requires a curated catalog entry id.")
    auth = record.auth
    payload_ciphertext = record.payload_ciphertext
    synced = bool((auth is not None and auth.auth_status == "ready") or payload_ciphertext)
    return CloudMcpConnectionSyncStatus(
        connection_id=str(record.connection_id),
        catalog_entry_id=record.catalog_entry_id,
        synced=synced,
        last_synced_at=_to_iso(record.last_synced_at),
    )
