"""Request and response models for the agent gateway auth APIs.

Responses never carry key material: no secret, payload, ciphertext, or
virtual-key fields exist on any model here.
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, ConfigDict, Field

from proliferate.db.store.agent_gateway import (
    AgentApiKeyRecord,
    AgentAuthRouteSelectionRecord,
    AgentGatewayEnrollmentRecord,
    OrgMemberRouteSelectionRecord,
)

if TYPE_CHECKING:
    from proliferate.server.cloud.agent_gateway.service import OrgAgentPolicySnapshot

AgentAuthSurface = Literal["local", "cloud"]
AgentAuthRoute = Literal["native", "api_key", "gateway"]


class AgentGatewayBaseModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class AgentApiKeyResponse(AgentGatewayBaseModel):
    id: str
    provider: str
    display_name: str = Field(alias="displayName")
    redacted_hint: str = Field(alias="redactedHint")
    status: str
    last_validated_at: str | None = Field(alias="lastValidatedAt")
    created_at: str = Field(alias="createdAt")


class AgentApiKeyListResponse(AgentGatewayBaseModel):
    keys: list[AgentApiKeyResponse]


class AgentApiKeyCreateRequest(AgentGatewayBaseModel):
    provider: str
    display_name: str = Field(alias="displayName")
    secret: str


class AgentAuthRouteSelectionResponse(AgentGatewayBaseModel):
    id: str
    harness_kind: str = Field(alias="harnessKind")
    surface: AgentAuthSurface
    route: AgentAuthRoute
    api_key_id: str | None = Field(alias="apiKeyId")
    revision: int
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class AgentAuthRouteSelectionListResponse(AgentGatewayBaseModel):
    selections: list[AgentAuthRouteSelectionResponse]


class AgentAuthRouteSelectionUpsertRequest(AgentGatewayBaseModel):
    route: AgentAuthRoute
    api_key_id: str | None = Field(default=None, alias="apiKeyId")


class AgentGatewayCapabilitiesResponse(AgentGatewayBaseModel):
    gateway_enabled: bool = Field(alias="gatewayEnabled")
    public_base_url: str | None = Field(alias="publicBaseUrl")
    enrollment_status: str = Field(alias="enrollmentStatus")


class OrgAgentPolicyResponse(AgentGatewayBaseModel):
    """Flag-only policy. ``None`` lists mean "no restriction"."""

    organization_id: str = Field(alias="organizationId")
    allowed_routes: list[str] | None = Field(alias="allowedRoutes")
    allowed_harnesses: list[str] | None = Field(alias="allowedHarnesses")
    editable: bool
    updated_by_user_id: str | None = Field(alias="updatedByUserId")
    updated_at: str | None = Field(alias="updatedAt")


class OrgAgentPolicyUpdateRequest(AgentGatewayBaseModel):
    allowed_routes: list[str] | None = Field(default=None, alias="allowedRoutes")
    allowed_harnesses: list[str] | None = Field(default=None, alias="allowedHarnesses")


class OrgAgentPolicyViolation(AgentGatewayBaseModel):
    user_id: str = Field(alias="userId")
    email: str | None
    display_name: str | None = Field(alias="displayName")
    harness_kind: str = Field(alias="harnessKind")
    surface: AgentAuthSurface
    route: AgentAuthRoute


class OrgAgentPolicyViolationListResponse(AgentGatewayBaseModel):
    violations: list[OrgAgentPolicyViolation]


class AgentGatewayEnrollmentResponse(AgentGatewayBaseModel):
    id: str
    subject_kind: str = Field(alias="subjectKind")
    litellm_team_id: str | None = Field(alias="litellmTeamId")
    sync_status: str = Field(alias="syncStatus")
    last_error_code: str | None = Field(alias="lastErrorCode")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def api_key_payload(record: AgentApiKeyRecord) -> AgentApiKeyResponse:
    return AgentApiKeyResponse(
        id=str(record.id),
        provider=record.provider,
        display_name=record.display_name,
        redacted_hint=record.redacted_hint,
        status=record.status,
        last_validated_at=_iso(record.last_validated_at),
        created_at=record.created_at.isoformat(),
    )


def route_selection_payload(
    record: AgentAuthRouteSelectionRecord,
) -> AgentAuthRouteSelectionResponse:
    return AgentAuthRouteSelectionResponse(
        id=str(record.id),
        harness_kind=record.harness_kind,
        surface=record.surface,  # type: ignore[arg-type]
        route=record.route,  # type: ignore[arg-type]
        api_key_id=str(record.api_key_id) if record.api_key_id is not None else None,
        revision=record.revision,
        created_at=record.created_at.isoformat(),
        updated_at=record.updated_at.isoformat(),
    )


def org_agent_policy_payload(snapshot: OrgAgentPolicySnapshot) -> OrgAgentPolicyResponse:
    return OrgAgentPolicyResponse(
        organization_id=str(snapshot.organization_id),
        allowed_routes=(
            list(snapshot.allowed_routes) if snapshot.allowed_routes is not None else None
        ),
        allowed_harnesses=(
            list(snapshot.allowed_harnesses) if snapshot.allowed_harnesses is not None else None
        ),
        editable=snapshot.editable,
        updated_by_user_id=(
            str(snapshot.updated_by_user_id) if snapshot.updated_by_user_id is not None else None
        ),
        updated_at=_iso(snapshot.updated_at),
    )


def org_agent_policy_violation_payload(
    record: OrgMemberRouteSelectionRecord,
) -> OrgAgentPolicyViolation:
    return OrgAgentPolicyViolation(
        user_id=str(record.user_id),
        email=record.email,
        display_name=record.display_name,
        harness_kind=record.harness_kind,
        surface=record.surface,  # type: ignore[arg-type]
        route=record.route,  # type: ignore[arg-type]
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
