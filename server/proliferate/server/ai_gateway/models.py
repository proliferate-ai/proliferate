"""Response models for the agent-gateway account APIs.

The ``/agent-gateway`` wire shapes: capabilities (with the FR-3 verification
verdicts) and the governing enrollment. Responses never carry key material.
"""

from __future__ import annotations

import json
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from proliferate.db.store.agent_gateway import (
    AgentGatewayEnrollmentKeyRecord,
    AgentGatewayEnrollmentRecord,
)


class AgentGatewayBaseModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


# --------------------------------------------------------------------------- #
# Capabilities + enrollment
# --------------------------------------------------------------------------- #


# The parsed verification-delta shape (never key material): a diff verdict
# carries the missing/extra model-id lists plus the observed/expected counts, and
# the degraded fallback carries string notes. Precise rather than ``Any`` so the
# strict mypy census stays clean.
VerificationDelta = dict[str, list[str] | int | str]


class AgentGatewayVerificationVerdict(AgentGatewayBaseModel):
    """One per-harness gateway-enablement verdict (agent-auth.md FR-3).

    ``delta`` is the parsed verification-delta JSON (never key material); it is
    present only for a ``misconfigured`` verdict.
    """

    harness_kind: str = Field(alias="harnessKind")
    status: str
    delta: VerificationDelta | None = None
    verified_at: str | None = Field(default=None, alias="verifiedAt")


class AgentGatewayCapabilitiesResponse(AgentGatewayBaseModel):
    gateway_enabled: bool = Field(alias="gatewayEnabled")
    public_base_url: str | None = Field(alias="publicBaseUrl")
    enrollment_status: str = Field(alias="enrollmentStatus")
    # Additive AA-3 surface: True exactly when the state renderer is
    # withholding gateway keys for this user's paying subject (credit
    # exhausted or unfunded), so the client can say "out of credits" instead
    # of the runtime's generic selection-missing refusal. Defaulted so older
    # callers constructing the model are unaffected.
    credits_exhausted: bool = Field(default=False, alias="creditsExhausted")
    # Additive FR-3 surface: per-harness gateway-enablement verdicts for the
    # governing enrollment. Empty until the verification loop records one.
    verifications: list[AgentGatewayVerificationVerdict] = Field(
        default_factory=list,
        alias="verifications",
    )


class AgentGatewayEnrollmentResponse(AgentGatewayBaseModel):
    id: str
    subject_kind: str = Field(alias="subjectKind")
    litellm_team_id: str | None = Field(alias="litellmTeamId")
    sync_status: str = Field(alias="syncStatus")
    last_error_code: str | None = Field(alias="lastErrorCode")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


# --------------------------------------------------------------------------- #
# Payload builders
# --------------------------------------------------------------------------- #


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def verification_verdict_payload(
    record: AgentGatewayEnrollmentKeyRecord,
) -> AgentGatewayVerificationVerdict:
    delta: VerificationDelta | None = None
    if record.verification_delta is not None:
        try:
            parsed = json.loads(record.verification_delta)
        except (ValueError, TypeError):
            parsed = None
        if isinstance(parsed, dict):
            delta = parsed
    return AgentGatewayVerificationVerdict(
        harness_kind=record.harness_kind,
        status=record.verification_status or "",
        delta=delta,
        verified_at=_iso(record.verified_at),
    )


def enrollment_payload(record: AgentGatewayEnrollmentRecord) -> AgentGatewayEnrollmentResponse:
    return AgentGatewayEnrollmentResponse(
        id=str(record.id),
        subject_kind=record.subject_kind,
        litellm_team_id=record.litellm_team_id,
        sync_status=record.sync_status,
        last_error_code=record.last_error_code,
        created_at=record.created_at.isoformat(),
        updated_at=record.updated_at.isoformat(),
    )
