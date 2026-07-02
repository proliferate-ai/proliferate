"""Request and response models for the agent gateway auth APIs.

Responses never carry key material: no secret, payload, ciphertext, or
virtual-key fields exist on any model here.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from proliferate.db.store.agent_gateway import (
    AgentApiKeyRecord,
    AgentAuthRouteSelectionRecord,
    AgentCatalogOverrideRecord,
    AgentCatalogSnapshotRecord,
    AgentGatewayEnrollmentRecord,
)

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
