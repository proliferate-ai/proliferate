from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID


@dataclass(frozen=True)
class CloudMcpAuthRecord:
    id: UUID
    connection_db_id: UUID
    auth_kind: str
    auth_status: str
    payload_ciphertext: str | None
    payload_format: str
    auth_version: int
    token_expires_at: datetime | None
    last_error_code: str | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class CloudMcpConnectionRecord:
    id: UUID
    owner_scope: str
    owner_user_id: UUID | None
    organization_id: UUID | None
    connection_id: str
    catalog_entry_id: str
    catalog_entry_version: int
    server_name: str
    enabled: bool
    public_to_org: bool
    public_organization_id: UUID | None
    public_status: str
    public_updated_at: datetime | None
    public_updated_by_user_id: UUID | None
    settings_json: str
    config_version: int
    created_at: datetime
    updated_at: datetime
    last_synced_at: datetime
    auth: CloudMcpAuthRecord | None

    @property
    def user_id(self) -> UUID:
        if self.owner_user_id is None:
            raise ValueError("organization-owned MCP connection has no owner user")
        return self.owner_user_id

    @property
    def org_id(self) -> UUID | None:
        return self.organization_id


@dataclass(frozen=True)
class CloudMcpOAuthFlowRecord:
    id: UUID
    connection_db_id: UUID
    user_id: UUID
    state_hash: str
    code_verifier_ciphertext: str
    issuer: str | None
    resource: str | None
    client_id: str
    token_endpoint: str | None
    requested_scopes: str
    redirect_uri: str
    authorization_url: str
    status: str
    expires_at: datetime
    used_at: datetime | None
    cancelled_at: datetime | None
    failure_code: str | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class CloudMcpOAuthClientRecord:
    id: UUID
    issuer: str
    redirect_uri: str
    catalog_entry_id: str
    resource: str | None
    client_id: str
    client_secret_ciphertext: str | None
    client_secret_expires_at: datetime | None
    token_endpoint_auth_method: str | None
    registration_client_uri: str | None
    registration_access_token_ciphertext: str | None
    created_at: datetime
    updated_at: datetime
