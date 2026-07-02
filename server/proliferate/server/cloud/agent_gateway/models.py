"""Request and response models for the agent gateway auth APIs.

Responses never carry key material — with one deliberate exception:
``AgentAuthStateResponse`` mirrors the AnyHarness state.json contract and
carries the caller's OWN decrypted keys, exactly as the cloud materializer
writes them into the caller's own sandbox (same trust model, different
delivery surface).
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from proliferate.constants.agent_gateway import AGENT_PROVIDER_REGISTRY
from proliferate.db.store.agent_gateway import (
    AgentApiKeyRecord,
    AgentAuthRouteSelectionRecord,
    AgentCatalogOverrideRecord,
    AgentCatalogSnapshotRecord,
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
    slot: str
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
    # Composition axis (spec §3.3): 'primary' for single-source harnesses;
    # opencode uses per-source slots. Defaults keep pre-slot callers working.
    slot: str = "primary"


class AgentAuthStateSelection(AgentGatewayBaseModel):
    """One rendered selection in the AnyHarness state.json contract shape.

    Field names are the on-disk contract (snake_case, matching the serde
    structs in ``route_auth/state.rs``) — deliberately NOT camelCased like the
    rest of this module. ``key`` is decrypted material (see module docstring).
    """

    harness: str
    route: AgentAuthRoute
    slot: str
    provider: str | None = None
    base_url: str | None = None
    key: str | None = None
    model_catalog: list[str] | None = None


class AgentAuthStateResponse(AgentGatewayBaseModel):
    """The whole state.json document (``route_auth/state.rs::AgentAuthState``).

    ``revision`` 0 with empty ``selections`` is the legacy/native marker: the
    user has no selections for the surface and the runtime may fall through.
    """

    revision: int
    user_id: str
    selections: list[AgentAuthStateSelection]


class AgentGatewayProviderInfo(AgentGatewayBaseModel):
    """One PROVIDER_REGISTRY entry; the UI never hardcodes provider metadata."""

    id: str
    label: str
    env_key: str = Field(alias="envKey")
    key_url: str = Field(alias="keyUrl")
    harnesses: list[str]
    recommended_for: list[str] = Field(alias="recommendedFor")


class AgentGatewayCapabilitiesResponse(AgentGatewayBaseModel):
    gateway_enabled: bool = Field(alias="gatewayEnabled")
    public_base_url: str | None = Field(alias="publicBaseUrl")
    enrollment_status: str = Field(alias="enrollmentStatus")
    providers: list[AgentGatewayProviderInfo] = Field(default_factory=list)


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
    # Local/native probes run on the client runtime (Desktop / AnyHarness);
    # the client uploads the probe result here. Gateway refreshes are
    # server-side and must omit it.
    models_json: str | None = Field(default=None, alias="modelsJson")


class AgentGatewayCatalogOverrideUpsertRequest(AgentGatewayBaseModel):
    patch_json: str = Field(alias="patchJson")


class AgentGatewayCatalogOverrideResponse(AgentGatewayBaseModel):
    id: str
    harness_kind: str = Field(alias="harnessKind")
    patch_json: str = Field(alias="patchJson")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


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
        slot=record.slot,
        route=record.route,  # type: ignore[arg-type]
        api_key_id=str(record.api_key_id) if record.api_key_id is not None else None,
        revision=record.revision,
        created_at=record.created_at.isoformat(),
        updated_at=record.updated_at.isoformat(),
    )


def agent_auth_state_payload(
    state: dict[str, object] | None,
    *,
    user_id: str,
) -> AgentAuthStateResponse:
    if state is None:
        return AgentAuthStateResponse(revision=0, user_id=user_id, selections=[])
    return AgentAuthStateResponse.model_validate(state)


def provider_registry_payload() -> list[AgentGatewayProviderInfo]:
    return [
        AgentGatewayProviderInfo(
            id=entry.id,
            label=entry.label,
            env_key=entry.env_key,
            key_url=entry.key_url,
            harnesses=list(entry.harnesses),
            recommended_for=list(entry.recommended_for),
        )
        for entry in AGENT_PROVIDER_REGISTRY
    ]


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
