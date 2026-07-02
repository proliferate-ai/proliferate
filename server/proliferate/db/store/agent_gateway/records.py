"""Frozen value records returned by the agent-gateway stores."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID


@dataclass(frozen=True)
class AgentApiKeyRecord:
    id: UUID
    user_id: UUID
    provider: str
    display_name: str
    redacted_hint: str
    status: str
    last_validated_at: datetime | None
    created_at: datetime
    updated_at: datetime
    revoked_at: datetime | None


@dataclass(frozen=True)
class AgentAuthRouteSelectionRecord:
    id: UUID
    user_id: UUID
    harness_kind: str
    surface: str
    route: str
    api_key_id: UUID | None
    revision: int
    created_at: datetime
    updated_at: datetime
    slot: str = "primary"


@dataclass(frozen=True)
class AgentGatewayEnrollmentRecord:
    id: UUID
    subject_kind: str
    user_id: UUID | None
    organization_id: UUID | None
    billing_subject_id: UUID
    litellm_team_id: str | None
    litellm_user_id: str | None
    virtual_key_id: str | None
    sync_status: str
    sync_fingerprint: str | None
    last_error_code: str | None
    last_error_message: str | None
    created_at: datetime
    updated_at: datetime
    revoked_at: datetime | None


@dataclass(frozen=True)
class AgentCatalogSnapshotRecord:
    id: UUID
    harness_kind: str
    surface: str
    route: str
    owner_user_id: UUID | None
    models_json: str
    probed_at: datetime
    source: str
    status: str


@dataclass(frozen=True)
class AgentCatalogOverrideRecord:
    id: UUID
    owner_user_id: UUID | None
    organization_id: UUID | None
    harness_kind: str
    patch_json: str
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class OrgAgentPolicyRecord:
    organization_id: UUID
    allowed_routes_json: str | None
    allowed_harnesses_json: str | None
    updated_by_user_id: UUID | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class AgentLlmUsageImportCursorRecord:
    id: str
    last_seen_occurred_at: datetime | None
    last_polled_at: datetime | None
    status: str
    last_error_code: str | None
    last_error_message: str | None
    metadata_json: str | None
    created_at: datetime
    updated_at: datetime
