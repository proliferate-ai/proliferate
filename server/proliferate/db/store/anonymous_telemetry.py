from __future__ import annotations

from dataclasses import asdict
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db import engine as db_engine
from proliferate.db.models.anonymous_telemetry import (
    AnonymousTelemetryEventRecord,
    AnonymousTelemetryInstall,
    AnonymousTelemetryLocalInstall,
)
from proliferate.utils.time import utcnow

if TYPE_CHECKING:
    from proliferate.server.anonymous_telemetry.service import AnonymousTelemetryEvent


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


async def _record_anonymous_telemetry_event(
    db: AsyncSession,
    event: "AnonymousTelemetryEvent",
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
        install_row.last_app_version = event.payload.app_version
        install_row.last_platform = event.payload.platform
        install_row.last_arch = event.payload.arch

    db.add(
        AnonymousTelemetryEventRecord(
            id=uuid4(),
            install_uuid=event.install_uuid,
            surface=event.surface,
            telemetry_mode=event.telemetry_mode,
            record_type=event.record_type,
            payload_json=asdict(event.payload),
            received_at=now,
        )
    )
    await db.commit()


async def record_anonymous_telemetry_event(
    event: "AnonymousTelemetryEvent",
) -> None:
    async with db_engine.async_session_factory() as db:
        await _record_anonymous_telemetry_event(db, event)


async def _load_or_create_local_install_id(
    db: AsyncSession,
    *,
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
    await db.commit()
    return record.install_uuid


async def load_or_create_local_install_id(surface: str) -> UUID:
    async with db_engine.async_session_factory() as db:
        return await _load_or_create_local_install_id(db, surface=surface)
