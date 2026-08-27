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
    # 'api_key' (default) or a typed provider-config kind ('aws_bedrock',
    # 'azure_openai') — agent-auth.md's vault table. Never carries the
    # decrypted payload; that stays server-internal (materialization + the
    # authenticated GET /state read only).
    kind: str = "api_key"


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
class AgentAuthDeliveryAckRecord:
    """The last acknowledged state delivery for one (user, surface).

    ``acked_sequence`` is the delivered document's sequence (spec §2:
    monotonic per surface, bumped only by content-changing renders);
    ``acked_fingerprint`` is the renderer's sha256 of that document's
    canonical ``harnesses`` array. A selection reads applied only when the
    pair equals the surface's CURRENT rendered pair.
    """

    id: UUID
    user_id: UUID
    surface: str
    acked_sequence: int
    acked_fingerprint: str
    acked_at: datetime
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class AgentAuthRenderSequenceRecord:
    """The current rendered document sequence for one (user, surface).

    ``sequence`` moves exactly when a render's ``harnesses`` content hash
    (``fingerprint``) changed — the persisted counter behind the wire
    document's ``sequence`` field (spec §2 "How delivery is governed").
    ``lineage`` is the counter's birth identity: minted when the row was
    created and never updated, so a recreated row (a rebuilt database) is a
    new lineage and the runtime can refuse a foreign-lineage push in plain
    words instead of comparing sequences across unrelated counters.
    """

    id: UUID
    user_id: UUID
    surface: str
    sequence: int
    lineage: UUID
    fingerprint: str
    rendered_at: datetime
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
class AgentGatewayEnrollmentKeyRecord:
    """One per-(enrollment, harness) LiteLLM virtual key (model-gateway.md §Account model)."""

    id: UUID
    enrollment_id: UUID
    harness_kind: str
    virtual_key_id: str | None
    sync_fingerprint: str | None
    verification_status: str | None
    verification_delta: str | None
    verified_at: datetime | None
    created_at: datetime
    updated_at: datetime
    revoked_at: datetime | None


@dataclass(frozen=True)
class SeatUsageSampleRecord:
    """One seat usage-probe observation (agent_auth spec §2, flow 5).

    Advisory only — meters and rotation hints, never a launch gate. A
    ``probe_failed`` row carries NULL in every observation field; ``util_*``
    are 0..1 fractions. Never carries any credential material.
    """

    id: int
    api_key_id: UUID
    sampled_at: datetime
    util_5h: float | None
    util_7d: float | None
    reset_5h: datetime | None
    reset_7d: datetime | None
    binding_window: str | None
    status: str


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
