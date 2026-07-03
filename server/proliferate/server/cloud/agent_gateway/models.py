"""Request and response models for the agent gateway auth APIs (P1 rebuild).

Responses never carry key material — with one deliberate exception:
``AgentAuthStateResponse`` mirrors the AnyHarness ``state.json`` v2 contract and
carries the caller's OWN decrypted keys, exactly as the cloud materializer writes
them into the caller's own sandbox (same trust model, different delivery
surface). That model uses the on-disk snake_case field names verbatim (matching
``route_auth/state.rs``), deliberately NOT camelCased like the rest of the module.
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from proliferate.db.store.agent_gateway import (
    AgentApiKeyRecord,
    AgentAuthSelectionRecord,
    AgentCatalogOverrideRecord,
    AgentCatalogSnapshotRecord,
    AgentGatewayEnrollmentRecord,
    DesiredAuthSource,
    OrgMemberRouteSelectionRecord,
)

if TYPE_CHECKING:
    from proliferate.server.cloud.agent_gateway.service import OrgAgentPolicySnapshot

AgentAuthSurface = Literal["local", "cloud"]
AgentAuthSourceKind = Literal["gateway", "api_key"]
# Catalog snapshots retain a route dimension (native/api_key/gateway); the auth
# selection path itself no longer speaks "route".
AgentAuthRoute = Literal["native", "api_key", "gateway"]


class AgentGatewayBaseModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


# --------------------------------------------------------------------------- #
# Key vault
# --------------------------------------------------------------------------- #


class AgentApiKeyResponse(AgentGatewayBaseModel):
    id: str
    title: str
    redacted_hint: str = Field(alias="redactedHint")
    status: str
    created_at: str = Field(alias="createdAt")


class AgentApiKeyCreateRequest(AgentGatewayBaseModel):
    title: str
    value: str


# --------------------------------------------------------------------------- #
# Auth selections
# --------------------------------------------------------------------------- #


class AgentAuthSelectionResponse(AgentGatewayBaseModel):
    id: str
    harness_kind: str = Field(alias="harnessKind")
    surface: AgentAuthSurface
    source_kind: AgentAuthSourceKind = Field(alias="sourceKind")
    api_key_id: str | None = Field(alias="apiKeyId")
    # The referenced key's title, joined for display (null for gateway rows or a
    # vanished key). ``providerHint`` is display-only and has zero wire semantics.
    key_title: str | None = Field(alias="keyTitle")
    env_var_name: str | None = Field(alias="envVarName")
    provider_hint: str | None = Field(alias="providerHint")
    enabled: bool
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class AgentAuthSourceInput(AgentGatewayBaseModel):
    """One entry of a full-desired-state PUT of a scope's selection sources."""

    source_kind: AgentAuthSourceKind = Field(alias="sourceKind")
    api_key_id: str | None = Field(default=None, alias="apiKeyId")
    env_var_name: str | None = Field(default=None, alias="envVarName")
    provider_hint: str | None = Field(default=None, alias="providerHint")
    enabled: bool = True


class AgentAuthSelectionsPutRequest(AgentGatewayBaseModel):
    sources: list[AgentAuthSourceInput]


# --------------------------------------------------------------------------- #
# state.json v2 (the AnyHarness wire contract; snake_case on the wire)
# --------------------------------------------------------------------------- #


class AgentAuthStateSource(BaseModel):
    """A single credential source (contract §3). Key material for the caller."""

    kind: AgentAuthSourceKind
    base_url: str | None = None
    key: str | None = None
    env_var_name: str | None = None
    value: str | None = None


class AgentAuthStateHarness(BaseModel):
    harness_kind: str
    sources: list[AgentAuthStateSource]


class AgentAuthStateResponse(BaseModel):
    """The whole ``state.json`` v2 document (``route_auth/state.rs``)."""

    version: int
    revision: int
    user_id: str | None = None
    harnesses: list[AgentAuthStateHarness]


# --------------------------------------------------------------------------- #
# Capabilities + enrollment
# --------------------------------------------------------------------------- #


class AgentGatewayCapabilitiesResponse(AgentGatewayBaseModel):
    gateway_enabled: bool = Field(alias="gatewayEnabled")
    public_base_url: str | None = Field(alias="publicBaseUrl")
    enrollment_status: str = Field(alias="enrollmentStatus")


class AgentGatewayEnrollmentResponse(AgentGatewayBaseModel):
    id: str
    subject_kind: str = Field(alias="subjectKind")
    litellm_team_id: str | None = Field(alias="litellmTeamId")
    sync_status: str = Field(alias="syncStatus")
    last_error_code: str | None = Field(alias="lastErrorCode")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


# --------------------------------------------------------------------------- #
# Catalog (P3 surface; auth-model-agnostic route dimension)
# --------------------------------------------------------------------------- #


class AgentGatewayCatalogResponse(AgentGatewayBaseModel):
    """Layered catalog: latest snapshot (owner else seed) + caller override."""

    harness_kind: str = Field(alias="harnessKind")
    surface: AgentAuthSurface
    route: AgentAuthRoute
    models: list[dict[str, Any]]
    snapshot_id: str | None = Field(alias="snapshotId")
    probed_at: str | None = Field(alias="probedAt")
    source: str | None
    override_applied: bool = Field(alias="overrideApplied")


class AgentGatewayCatalogRefreshRequest(AgentGatewayBaseModel):
    surface: AgentAuthSurface
    route: AgentAuthRoute
    models_json: str | None = Field(default=None, alias="modelsJson")


class AgentGatewayCatalogMirrorRequest(AgentGatewayBaseModel):
    """A runtime's push of its own resolved probe result (contract §4).

    Unlike ``.../refresh``, the caller is a signed-in client runtime (desktop
    AnyHarness today), not the product UI, and ``probed_at`` reflects when the
    runtime actually probed rather than when this request landed.
    """

    surface: AgentAuthSurface
    route: AgentAuthRoute
    models_json: str = Field(alias="modelsJson")
    probed_at: str = Field(alias="probedAt")


class AgentGatewayCatalogOverrideUpsertRequest(AgentGatewayBaseModel):
    patch_json: str = Field(alias="patchJson")


class AgentGatewayCatalogOverrideResponse(AgentGatewayBaseModel):
    id: str
    harness_kind: str = Field(alias="harnessKind")
    patch_json: str = Field(alias="patchJson")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


# --------------------------------------------------------------------------- #
# Org policy (flag-only)
# --------------------------------------------------------------------------- #


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
    source_kind: AgentAuthSourceKind = Field(alias="sourceKind")


class OrgAgentPolicyViolationListResponse(AgentGatewayBaseModel):
    violations: list[OrgAgentPolicyViolation]


# --------------------------------------------------------------------------- #
# Payload builders
# --------------------------------------------------------------------------- #


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def api_key_payload(record: AgentApiKeyRecord) -> AgentApiKeyResponse:
    return AgentApiKeyResponse(
        id=str(record.id),
        title=record.title,
        redacted_hint=record.redacted_hint,
        status=record.status,
        created_at=record.created_at.isoformat(),
    )


def auth_selection_payload(
    record: AgentAuthSelectionRecord,
    *,
    key_title: str | None,
) -> AgentAuthSelectionResponse:
    return AgentAuthSelectionResponse(
        id=str(record.id),
        harness_kind=record.harness_kind,
        surface=record.surface,  # type: ignore[arg-type]
        source_kind=record.source_kind,  # type: ignore[arg-type]
        api_key_id=str(record.api_key_id) if record.api_key_id is not None else None,
        key_title=key_title,
        env_var_name=record.env_var_name,
        provider_hint=record.provider_hint,
        enabled=record.enabled,
        created_at=record.created_at.isoformat(),
        updated_at=record.updated_at.isoformat(),
    )


def desired_source(input_source: AgentAuthSourceInput) -> DesiredAuthSource:
    """Map a request source onto the store's frozen desired-state record."""
    return DesiredAuthSource(
        source_kind=input_source.source_kind,
        api_key_id=UUID(input_source.api_key_id) if input_source.api_key_id else None,
        env_var_name=input_source.env_var_name,
        provider_hint=input_source.provider_hint,
        enabled=input_source.enabled,
    )


def agent_auth_state_payload(state: dict[str, object]) -> AgentAuthStateResponse:
    return AgentAuthStateResponse.model_validate(state)


def catalog_payload(
    *,
    harness_kind: str,
    surface: AgentAuthSurface,
    route: AgentAuthRoute,
    models: list[dict[str, Any]],
    snapshot: AgentCatalogSnapshotRecord | None,
    override: AgentCatalogOverrideRecord | None,
) -> AgentGatewayCatalogResponse:
    return AgentGatewayCatalogResponse(
        harness_kind=harness_kind,
        surface=surface,
        route=route,
        models=models,
        snapshot_id=str(snapshot.id) if snapshot is not None else None,
        probed_at=snapshot.probed_at.isoformat() if snapshot is not None else None,
        source=snapshot.source if snapshot is not None else None,
        override_applied=override is not None,
    )


def catalog_override_payload(
    record: AgentCatalogOverrideRecord,
) -> AgentGatewayCatalogOverrideResponse:
    return AgentGatewayCatalogOverrideResponse(
        id=str(record.id),
        harness_kind=record.harness_kind,
        patch_json=record.patch_json,
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
        source_kind=record.source_kind,  # type: ignore[arg-type]
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
