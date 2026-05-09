from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.anonymous_telemetry import (
    AnonymousTelemetryEventRecord,
    AnonymousTelemetryInstall,
    AnonymousTelemetryLocalInstall,
)
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class AnonymousTelemetryEventInsert:
    install_uuid: UUID
    surface: str
    telemetry_mode: str
    record_type: str
    payload_json: dict[str, object]


async def _load_install_row(
    db: AsyncSession,
    *,
    install_uuid: UUID,
    surface: str,
) -> AnonymousTelemetryInstall | None:
    return (
        await db.execute(
            select(AnonymousTelemetryInstall).where(
                AnonymousTelemetryInstall.install_uuid == install_uuid,
                AnonymousTelemetryInstall.surface == surface,
            )
        )
    ).scalar_one_or_none()


async def record_anonymous_telemetry_event(
    db: AsyncSession,
    event: AnonymousTelemetryEventInsert,
) -> None:
    now = utcnow()
    install_row = await _load_install_row(
        db,
        install_uuid=event.install_uuid,
        surface=event.surface,
    )

    if install_row is None:
        install_row = AnonymousTelemetryInstall(
            install_uuid=event.install_uuid,
            surface=event.surface,
            last_telemetry_mode=event.telemetry_mode,
            first_seen_at=now,
            last_seen_at=now,
        )
        db.add(install_row)
    else:
        install_row.last_telemetry_mode = event.telemetry_mode
        install_row.last_seen_at = now

    if event.record_type == "VERSION":
        install_row.last_app_version = str(event.payload_json["app_version"])
        install_row.last_platform = str(event.payload_json["platform"])
        install_row.last_arch = str(event.payload_json["arch"])

    db.add(
        AnonymousTelemetryEventRecord(
            id=uuid4(),
            install_uuid=event.install_uuid,
            surface=event.surface,
            telemetry_mode=event.telemetry_mode,
            record_type=event.record_type,
            payload_json=event.payload_json,
            received_at=now,
        )
    )


async def load_or_create_local_install_id(
    db: AsyncSession,
    surface: str,
) -> UUID:
    existing = (
        await db.execute(
            select(AnonymousTelemetryLocalInstall).where(
                AnonymousTelemetryLocalInstall.surface == surface,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing.install_uuid

    now = utcnow()
    record = AnonymousTelemetryLocalInstall(
        surface=surface,
        install_uuid=uuid4(),
        created_at=now,
        updated_at=now,
    )
    db.add(record)
    return record.install_uuid
