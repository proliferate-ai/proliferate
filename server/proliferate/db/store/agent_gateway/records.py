"""Frozen value records returned by the agent-gateway stores."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from uuid import UUID


@dataclass(frozen=True)
class AgentApiKeyRecord:
    id: UUID
    user_id: UUID
    title: str
    redacted_hint: str
    status: str
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class AgentAuthSelectionRecord:
    id: UUID
    user_id: UUID
    harness_kind: str
    surface: str
    source_kind: str
    api_key_id: UUID | None
    env_var_name: str | None
    provider_hint: str | None
    enabled: bool
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class DesiredAuthSource:
    """One entry of a full-desired-state PUT of a scope's selection sources.

    ``source_kind='gateway'`` carries no key/env; ``source_kind='api_key'``
    carries an ``api_key_id`` + ``env_var_name``. ``provider_hint`` is
    display-only. The store diffs a list of these against the stored rows.
    """

    source_kind: str
    api_key_id: UUID | None = None
    env_var_name: str | None = None
    provider_hint: str | None = None
    enabled: bool = True


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
    budget_status: str
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
class LlmCreditGrantRecord:
    id: UUID
    billing_subject_id: UUID
    user_id: UUID | None
    source: str
    amount_usd: Decimal
    created_at: datetime
    expires_at: datetime | None
    source_ref: str | None


@dataclass(frozen=True)
class LlmCreditBalanceRecord:
    """Snapshot of a subject's LLM credit state at a point in time."""

    billing_subject_id: UUID
    granted_usd: Decimal
    used_usd: Decimal
    remaining_usd: Decimal


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
