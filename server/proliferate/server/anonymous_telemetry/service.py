from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Literal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.anonymous_telemetry import (
    AnonymousTelemetryEventInsert,
    record_anonymous_telemetry_event,
)
from proliferate.db.store.anonymous_telemetry import (
    load_or_create_local_install_id as load_or_create_local_install_id_store,
)

type TelemetrySurface = Literal["desktop", "server"]
type TelemetryRecordType = Literal["VERSION", "ACTIVATION", "USAGE"]
type TelemetryMode = Literal["local_dev", "self_managed", "hosted_product"]
type ActivationMilestone = Literal[
    "first_launch",
    "first_prompt_submitted",
    "first_local_workspace_created",
    "first_cloud_workspace_created",
    "first_credential_synced",
    "first_connector_installed",
    "first_bundled_agent_seed_hydrated",
]


@dataclass(frozen=True)
class VersionPayload:
    app_version: str
    platform: str
    arch: str


@dataclass(frozen=True)
class ActivationPayload:
    milestone: ActivationMilestone


@dataclass(frozen=True)
class UsagePayload:
    sessions_started: int
    prompts_submitted: int
    workspaces_created_local: int
    workspaces_created_cloud: int
    credentials_synced: int
    connectors_installed: int


AnonymousTelemetryPayload = VersionPayload | ActivationPayload | UsagePayload


@dataclass(frozen=True)
class AnonymousTelemetryEvent:
    install_uuid: UUID
    surface: TelemetrySurface
    telemetry_mode: TelemetryMode
    record_type: TelemetryRecordType
    payload: AnonymousTelemetryPayload


async def record_anonymous_telemetry(
    db: AsyncSession,
    event: AnonymousTelemetryEvent,
) -> None:
    await record_anonymous_telemetry_event(
        db,
        AnonymousTelemetryEventInsert(
            install_uuid=event.install_uuid,
            surface=event.surface,
            telemetry_mode=event.telemetry_mode,
            record_type=event.record_type,
            payload_json=asdict(event.payload),
        ),
    )


async def load_or_create_local_install_id(surface: TelemetrySurface) -> UUID:
    return await load_or_create_local_install_id_store(surface)
