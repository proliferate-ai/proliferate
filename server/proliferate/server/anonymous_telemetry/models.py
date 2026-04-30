from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from proliferate.server.anonymous_telemetry.service import (
    ActivationPayload,
    AnonymousTelemetryEvent,
    UsagePayload,
    VersionPayload,
)

TelemetrySurface = Literal["desktop", "server"]
TelemetryMode = Literal["local_dev", "self_managed", "hosted_product"]
TelemetryRecordType = Literal["VERSION", "ACTIVATION", "USAGE"]
ActivationMilestone = Literal[
    "first_launch",
    "first_prompt_submitted",
    "first_local_workspace_created",
    "first_cloud_workspace_created",
    "first_credential_synced",
    "first_connector_installed",
    "first_bundled_agent_seed_hydrated",
]


class VersionPayloadRequest(BaseModel):
    app_version: str = Field(alias="appVersion", min_length=1, max_length=255)
    platform: str = Field(min_length=1, max_length=64)
    arch: str = Field(min_length=1, max_length=64)


class ActivationPayloadRequest(BaseModel):
    milestone: ActivationMilestone


class UsagePayloadRequest(BaseModel):
    sessions_started: int = Field(alias="sessionsStarted", ge=0)
    prompts_submitted: int = Field(alias="promptsSubmitted", ge=0)
    workspaces_created_local: int = Field(alias="workspacesCreatedLocal", ge=0)
    workspaces_created_cloud: int = Field(alias="workspacesCreatedCloud", ge=0)
    credentials_synced: int = Field(alias="credentialsSynced", ge=0)
    connectors_installed: int = Field(alias="connectorsInstalled", ge=0)


class AnonymousTelemetryRequest(BaseModel):
    install_uuid: UUID = Field(alias="installUuid")
    surface: TelemetrySurface
    telemetry_mode: TelemetryMode = Field(alias="telemetryMode")
    record_type: TelemetryRecordType = Field(alias="recordType")
    payload: dict[str, object]

    def to_service_event(self) -> AnonymousTelemetryEvent:
        if self.record_type == "VERSION":
            payload = VersionPayloadRequest.model_validate(self.payload)
            service_payload = VersionPayload(
                app_version=payload.app_version,
                platform=payload.platform,
                arch=payload.arch,
            )
        elif self.record_type == "ACTIVATION":
            payload = ActivationPayloadRequest.model_validate(self.payload)
            service_payload = ActivationPayload(milestone=payload.milestone)
        else:
            payload = UsagePayloadRequest.model_validate(self.payload)
            service_payload = UsagePayload(
                sessions_started=payload.sessions_started,
                prompts_submitted=payload.prompts_submitted,
                workspaces_created_local=payload.workspaces_created_local,
                workspaces_created_cloud=payload.workspaces_created_cloud,
                credentials_synced=payload.credentials_synced,
                connectors_installed=payload.connectors_installed,
            )

        return AnonymousTelemetryEvent(
            install_uuid=self.install_uuid,
            surface=self.surface,
            telemetry_mode=self.telemetry_mode,
            record_type=self.record_type,
            payload=service_payload,
        )


class AnonymousTelemetryAcceptedResponse(BaseModel):
    accepted: bool = True
