"""Cloud workspace exposure persistence."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.exposures import CloudWorkspaceExposure
from proliferate.db.store.cloud_sync import worker_control
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class CloudWorkspaceExposureSnapshot:
    id: UUID
    target_id: UUID
    cloud_workspace_id: UUID
    anyharness_workspace_id: str | None
    owner_scope: str
    owner_user_id: UUID | None
    organization_id: UUID | None
    visibility: str
    claimed_by_user_id: UUID | None
    default_projection_level: str
    commandable: bool
    status: str
    revision: int
    last_projected_at: datetime | None
    origin: str | None
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None


def _snapshot(row: CloudWorkspaceExposure) -> CloudWorkspaceExposureSnapshot:
    return CloudWorkspaceExposureSnapshot(
        id=row.id,
        target_id=row.target_id,
        cloud_workspace_id=row.cloud_workspace_id,
        anyharness_workspace_id=row.anyharness_workspace_id,
        owner_scope=row.owner_scope,
        owner_user_id=row.owner_user_id,
        organization_id=row.organization_id,
        visibility=row.visibility,
        claimed_by_user_id=row.claimed_by_user_id,
        default_projection_level=row.default_projection_level,
        commandable=row.commandable,
        status=row.status,
        revision=row.revision,
        last_projected_at=row.last_projected_at,
        origin=row.origin,
        created_at=row.created_at,
        updated_at=row.updated_at,
        archived_at=row.archived_at,
    )


async def get_workspace_exposure_by_id(
    db: AsyncSession,
    exposure_id: UUID,
) -> CloudWorkspaceExposureSnapshot | None:
    row = await db.get(CloudWorkspaceExposure, exposure_id)
    return _snapshot(row) if row is not None else None


async def get_active_workspace_exposure(
    db: AsyncSession,
    *,
    target_id: UUID,
    cloud_workspace_id: UUID,
) -> CloudWorkspaceExposureSnapshot | None:
    row = await _load_active_workspace_exposure(
        db,
        target_id=target_id,
        cloud_workspace_id=cloud_workspace_id,
    )
    return _snapshot(row) if row is not None else None


async def list_active_workspace_exposures_for_target(
    db: AsyncSession,
    *,
    target_id: UUID,
) -> tuple[CloudWorkspaceExposureSnapshot, ...]:
    rows = (
        await db.execute(
            select(CloudWorkspaceExposure)
            .where(CloudWorkspaceExposure.target_id == target_id)
            .where(CloudWorkspaceExposure.archived_at.is_(None))
            .where(CloudWorkspaceExposure.status == "active")
            .order_by(CloudWorkspaceExposure.updated_at.desc())
        )
    ).scalars()
    return tuple(_snapshot(row) for row in rows)


async def upsert_workspace_exposure(
    db: AsyncSession,
    *,
    target_id: UUID,
    cloud_workspace_id: UUID,
    anyharness_workspace_id: str | None,
    owner_scope: str,
    owner_user_id: UUID | None,
    organization_id: UUID | None,
    visibility: str,
    claimed_by_user_id: UUID | None = None,
    default_projection_level: str = "live",
    commandable: bool = True,
    status: str = "active",
    origin: str | None = None,
) -> CloudWorkspaceExposureSnapshot:
    now = utcnow()
    row = await _load_active_workspace_exposure(
        db,
        target_id=target_id,
        cloud_workspace_id=cloud_workspace_id,
        lock=True,
    )
    if row is None:
        row = CloudWorkspaceExposure(
            target_id=target_id,
            cloud_workspace_id=cloud_workspace_id,
            anyharness_workspace_id=anyharness_workspace_id,
            owner_scope=owner_scope,
            owner_user_id=owner_user_id,
            organization_id=organization_id,
            visibility=visibility,
            claimed_by_user_id=claimed_by_user_id,
            default_projection_level=default_projection_level,
            commandable=commandable,
            status=status,
            revision=1,
            origin=origin,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
        await db.flush()
        await worker_control.bump_exposure_revision(db, target_id=target_id, now=now)
        return _snapshot(row)

    changed = False
    for attr, value in (
        ("anyharness_workspace_id", anyharness_workspace_id),
        ("owner_scope", owner_scope),
        ("owner_user_id", owner_user_id),
        ("organization_id", organization_id),
        ("visibility", visibility),
        ("claimed_by_user_id", claimed_by_user_id),
        ("default_projection_level", default_projection_level),
        ("commandable", commandable),
        ("status", status),
        ("origin", origin),
    ):
        if getattr(row, attr) != value:
            setattr(row, attr, value)
            changed = True
    if changed:
        row.revision += 1
        row.updated_at = now
    await db.flush()
    if changed:
        await worker_control.bump_exposure_revision(db, target_id=target_id, now=now)
    return _snapshot(row)


async def archive_workspace_exposure(
    db: AsyncSession,
    *,
    exposure_id: UUID,
) -> CloudWorkspaceExposureSnapshot | None:
    row = (
        await db.execute(
            select(CloudWorkspaceExposure)
            .where(CloudWorkspaceExposure.id == exposure_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    if row.archived_at is None:
        now = utcnow()
        row.visibility = "archived"
        row.status = "revoked"
        row.commandable = False
        row.revision += 1
        row.archived_at = now
        row.updated_at = now
        await db.flush()
        await worker_control.bump_exposure_revision(db, target_id=row.target_id, now=now)
    return _snapshot(row)


async def clear_workspace_exposure_materialization(
    db: AsyncSession,
    *,
    target_id: UUID,
    cloud_workspace_id: UUID,
    anyharness_workspace_id: str | None,
) -> CloudWorkspaceExposureSnapshot | None:
    row = await _load_active_workspace_exposure(
        db,
        target_id=target_id,
        cloud_workspace_id=cloud_workspace_id,
        lock=True,
    )
    if row is None:
        return None
    if (
        anyharness_workspace_id is not None
        and row.anyharness_workspace_id != anyharness_workspace_id
    ):
        return _snapshot(row)
    if row.anyharness_workspace_id is not None or row.commandable:
        now = utcnow()
        row.anyharness_workspace_id = None
        row.commandable = False
        row.revision += 1
        row.updated_at = now
        await db.flush()
        await worker_control.bump_exposure_revision(db, target_id=target_id, now=now)
    return _snapshot(row)


async def claim_workspace_exposure(
    db: AsyncSession,
    *,
    exposure_id: UUID,
    claimed_by_user_id: UUID,
) -> CloudWorkspaceExposureSnapshot | None:
    row = (
        await db.execute(
            select(CloudWorkspaceExposure)
            .where(CloudWorkspaceExposure.id == exposure_id)
            .where(CloudWorkspaceExposure.archived_at.is_(None))
            .where(CloudWorkspaceExposure.status == "active")
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None or row.visibility != "shared_unclaimed":
        return None
    now = utcnow()
    row.visibility = "claimed"
    row.claimed_by_user_id = claimed_by_user_id
    row.revision += 1
    row.updated_at = now
    await db.flush()
    await worker_control.bump_exposure_revision(db, target_id=row.target_id, now=now)
    return _snapshot(row)


async def mark_workspace_exposure_projected(
    db: AsyncSession,
    *,
    exposure_id: UUID,
    projected_at: datetime | None = None,
) -> CloudWorkspaceExposureSnapshot | None:
    row = await db.get(CloudWorkspaceExposure, exposure_id)
    if row is None:
        return None
    now = projected_at or utcnow()
    row.last_projected_at = now
    row.updated_at = now
    await db.flush()
    return _snapshot(row)


async def _load_active_workspace_exposure(
    db: AsyncSession,
    *,
    target_id: UUID,
    cloud_workspace_id: UUID,
    lock: bool = False,
) -> CloudWorkspaceExposure | None:
    query = (
        select(CloudWorkspaceExposure)
        .where(CloudWorkspaceExposure.target_id == target_id)
        .where(CloudWorkspaceExposure.cloud_workspace_id == cloud_workspace_id)
        .where(CloudWorkspaceExposure.archived_at.is_(None))
        .limit(1)
    )
    if lock:
        query = query.with_for_update()
    return (await db.execute(query)).scalar_one_or_none()
