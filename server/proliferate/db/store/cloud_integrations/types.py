from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID


@dataclass(frozen=True)
class IntegrationDefinitionRecord:
    id: UUID
    key: str
    source: str
    organization_id: UUID | None
    created_by_user_id: UUID | None
    source_version: int
    content_hash: str
    display_name: str
    namespace: str
    provider_group: str | None
    transport: str
    implementation: str
    config_json: str
    enabled_by_default: bool
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class IntegrationAccountRecord:
    id: UUID
    owner_scope: str
    owner_user_id: UUID | None
    organization_id: UUID | None
    definition_id: UUID
    auth_kind: str
    status: str
    settings_json: str
    credential_ciphertext: str | None
    auth_version: int
    token_expires_at: datetime | None
    last_error_code: str | None
    enabled: bool
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class IntegrationAccountWithDefinitionRecord:
    account: IntegrationAccountRecord
    definition: IntegrationDefinitionRecord


@dataclass(frozen=True)
class IntegrationOAuthClientRecord:
    id: UUID
    definition_id: UUID
    issuer: str
    redirect_uri: str
    resource: str | None
    client_strategy: str
    client_id: str
    client_secret_ciphertext: str | None
    registration_metadata_json: str
    token_endpoint_auth_method: str | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class IntegrationOAuthFlowRecord:
    id: UUID
    account_id: UUID | None
    user_id: UUID
    state_hash: str
    code_verifier_ciphertext: str
    issuer: str | None
    resource: str | None
    client_id: str
    client_strategy: str
    token_endpoint: str | None
    requested_scopes: str
    redirect_uri: str
    authorization_url: str
    callback_surface: str
    final_surface: str
    return_path: str | None
    status: str
    expires_at: datetime
    used_at: datetime | None
    cancelled_at: datetime | None
    failure_code: str | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class IntegrationToolSchemaCacheRecord:
    id: UUID
    account_id: UUID
    cache_key: str
    tools_json: str
    status: str
    refreshed_at: datetime | None
    last_error_code: str | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class IntegrationPolicyRecord:
    id: UUID
    organization_id: UUID
    definition_id: UUID
    enabled: bool
    updated_by_user_id: UUID | None
    created_at: datetime
    updated_at: datetime
