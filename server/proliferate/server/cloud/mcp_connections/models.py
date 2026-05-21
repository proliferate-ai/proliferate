"""Request and response schemas for cloud-owned MCP connections."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from proliferate.db.store.cloud_mcp.types import CloudMcpConnectionRecord

CloudMcpAuthKind = Literal["secret", "oauth", "none"]
CloudMcpAuthStatus = Literal["ready", "needs_reconnect", "error"]


class OkResponse(BaseModel):
    ok: bool = True


class CloudMcpConnectionSettings(BaseModel):
    model_config = ConfigDict(extra="allow")


class CreateCloudMcpConnectionRequest(BaseModel):
    catalog_entry_id: str = Field(alias="catalogEntryId")
    settings: dict[str, object] | None = None
    enabled: bool = True


class PatchCloudMcpConnectionRequest(BaseModel):
    settings: dict[str, object] | None = None
    enabled: bool | None = None
    public_to_org: bool | None = Field(default=None, alias="publicToOrg")
    public_organization_id: UUID | None = Field(default=None, alias="publicOrganizationId")


class PutCloudMcpSecretAuthRequest(BaseModel):
    secret_fields: dict[str, str] = Field(alias="secretFields")


class PublicizeCloudMcpConnectionRequest(BaseModel):
    organization_id: UUID = Field(alias="organizationId")


class CloudMcpConnectionResponse(BaseModel):
    connection_id: str = Field(serialization_alias="connectionId")
    owner_scope: str = Field(serialization_alias="ownerScope")
    owner_user_id: str | None = Field(default=None, serialization_alias="ownerUserId")
    organization_id: str | None = Field(default=None, serialization_alias="organizationId")
    catalog_entry_id: str = Field(serialization_alias="catalogEntryId")
    catalog_entry_version: int = Field(serialization_alias="catalogEntryVersion")
    server_name: str = Field(serialization_alias="serverName")
    enabled: bool
    public_to_org: bool = Field(serialization_alias="publicToOrg")
    public_organization_id: str | None = Field(
        default=None,
        serialization_alias="publicOrganizationId",
    )
    public_status: str = Field(serialization_alias="publicStatus")
    public_updated_at: str | None = Field(default=None, serialization_alias="publicUpdatedAt")
    public_updated_by_user_id: str | None = Field(
        default=None,
        serialization_alias="publicUpdatedByUserId",
    )
    auth_kind: CloudMcpAuthKind = Field(serialization_alias="authKind")
    auth_status: CloudMcpAuthStatus = Field(serialization_alias="authStatus")
    settings: dict[str, object] = Field(repr=False)
    config_version: int = Field(serialization_alias="configVersion")
    auth_version: int | None = Field(default=None, serialization_alias="authVersion")
    created_at: str = Field(serialization_alias="createdAt")
    updated_at: str = Field(serialization_alias="updatedAt")


class CloudMcpConnectionsResponse(BaseModel):
    connections: list[CloudMcpConnectionResponse]


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
) -> CloudMcpConnectionResponse:
    return CloudMcpConnectionResponse(
        connection_id=record.connection_id,
        owner_scope=record.owner_scope,
        owner_user_id=str(record.owner_user_id) if record.owner_user_id else None,
        organization_id=str(record.organization_id) if record.organization_id else None,
        catalog_entry_id=record.catalog_entry_id,
        catalog_entry_version=record.catalog_entry_version,
        server_name=record.server_name,
        enabled=record.enabled,
        public_to_org=record.public_to_org,
        public_organization_id=(
            str(record.public_organization_id) if record.public_organization_id else None
        ),
        public_status=record.public_status,
        public_updated_at=_to_iso(record.public_updated_at),
        public_updated_by_user_id=(
            str(record.public_updated_by_user_id) if record.public_updated_by_user_id else None
        ),
        auth_kind=auth_kind,
        auth_status=auth_status,
        settings=settings,
        config_version=record.config_version,
        auth_version=record.auth.auth_version if record.auth else None,
        created_at=_to_iso(record.created_at) or "",
        updated_at=_to_iso(record.updated_at) or "",
    )
