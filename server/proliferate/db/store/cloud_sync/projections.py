"""Cloud session projection metadata persistence."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.exposures import CloudWorkspaceExposure
from proliferate.db.models.cloud.sync import CloudSessionProjection
from proliferate.db.store.cloud_sync import worker_control
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class CloudSessionProjectionMetadataSnapshot:
    id: UUID
    target_id: UUID
    exposure_id: UUID | None
    cloud_workspace_id: UUID | None
    workspace_id: str | None
    session_id: str
    status: str
    projection_level: str
    commandable: bool
    gap_state_json: str | None
    last_uploaded_seq: int | None
    agent_run_config_snapshot_json: dict[str, object] | None
    updated_at: datetime


@dataclass(frozen=True)
class ActiveProjectionCursorSnapshot:
    exposure_id: UUID
    session_projection_id: UUID
    target_id: UUID
    cloud_workspace_id: UUID
    anyharness_workspace_id: str
    anyharness_session_id: str
    projection_level: str
    commandable: bool
    exposure_status: str
    exposure_revision: int
    last_uploaded_seq: int


def _snapshot(row: CloudSessionProjection) -> CloudSessionProjectionMetadataSnapshot:
    return CloudSessionProjectionMetadataSnapshot(
        id=row.id,
        target_id=row.target_id,
        exposure_id=row.exposure_id,
        cloud_workspace_id=row.cloud_workspace_id,
        workspace_id=row.workspace_id,
        session_id=row.session_id,
        status=row.status,
        projection_level=row.projection_level,
        commandable=row.commandable,
        gap_state_json=row.gap_state_json,
        last_uploaded_seq=row.last_uploaded_seq,
        agent_run_config_snapshot_json=row.agent_run_config_snapshot_json,
        updated_at=row.updated_at,
    )


async def get_session_projection_metadata(
    db: AsyncSession,
    *,
    target_id: UUID,
    session_id: str,
) -> CloudSessionProjectionMetadataSnapshot | None:
    row = await _load_session_projection(
        db,
        target_id=target_id,
        session_id=session_id,
    )
    return _snapshot(row) if row is not None else None


async def upsert_session_projection_metadata(
    db: AsyncSession,
    *,
    target_id: UUID,
    session_id: str,
    exposure_id: UUID | None,
    cloud_workspace_id: UUID | None,
    workspace_id: str | None,
    projection_level: str,
    commandable: bool,
    status: str = "running",
    agent_run_config_snapshot_json: dict[str, object] | None = None,
) -> CloudSessionProjectionMetadataSnapshot:
    now = utcnow()
    row = await _load_session_projection(
        db,
        target_id=target_id,
        session_id=session_id,
        lock=True,
    )
    changed = False
    if row is None:
        row = CloudSessionProjection(
            target_id=target_id,
            exposure_id=exposure_id,
            cloud_workspace_id=cloud_workspace_id,
            workspace_id=workspace_id,
            session_id=session_id,
            status=status,
            projection_level=projection_level,
            commandable=commandable,
            last_event_seq=0,
            last_uploaded_seq=0,
            agent_run_config_snapshot_json=agent_run_config_snapshot_json,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
        changed = True
    else:
        values = {
            "exposure_id": exposure_id if exposure_id is not None else row.exposure_id,
            "cloud_workspace_id": cloud_workspace_id or row.cloud_workspace_id,
            "workspace_id": workspace_id or row.workspace_id,
            "status": status,
            "projection_level": projection_level,
            "commandable": commandable,
        }
        for attr, value in values.items():
            if getattr(row, attr) != value:
                setattr(row, attr, value)
                changed = True
        if (
            row.agent_run_config_snapshot_json is None
            and agent_run_config_snapshot_json is not None
        ):
            row.agent_run_config_snapshot_json = agent_run_config_snapshot_json
            changed = True
    if changed:
        row.updated_at = now
    await db.flush()
    if changed:
        await worker_control.bump_exposure_revision(db, target_id=target_id, now=now)
    return _snapshot(row)


async def update_projection_last_uploaded_seq(
    db: AsyncSession,
    *,
    target_id: UUID,
    session_id: str,
    last_uploaded_seq: int,
) -> CloudSessionProjectionMetadataSnapshot | None:
    row = await _load_session_projection(
        db,
        target_id=target_id,
        session_id=session_id,
        lock=True,
    )
    if row is None:
        return None
    row.last_uploaded_seq = max(row.last_uploaded_seq or 0, last_uploaded_seq)
    row.updated_at = utcnow()
    await db.flush()
    return _snapshot(row)


async def set_projection_gap_state(
    db: AsyncSession,
    *,
    target_id: UUID,
    session_id: str,
    gap_state_json: str,
) -> CloudSessionProjectionMetadataSnapshot | None:
    row = await _load_session_projection(
        db,
        target_id=target_id,
        session_id=session_id,
        lock=True,
    )
    if row is None:
        return None
    row.gap_state_json = gap_state_json
    row.updated_at = utcnow()
    await db.flush()
    return _snapshot(row)


async def clear_projection_gap_state(
    db: AsyncSession,
    *,
    target_id: UUID,
    session_id: str,
) -> CloudSessionProjectionMetadataSnapshot | None:
    row = await _load_session_projection(
        db,
        target_id=target_id,
        session_id=session_id,
        lock=True,
    )
    if row is None:
        return None
    row.gap_state_json = None
    row.updated_at = utcnow()
    await db.flush()
    return _snapshot(row)


async def end_session_projection_by_id(
    db: AsyncSession,
    *,
    projection_id: UUID,
    ended_at: str | None = None,
) -> CloudSessionProjectionMetadataSnapshot | None:
    row = (
        await db.execute(
            select(CloudSessionProjection)
            .where(CloudSessionProjection.id == projection_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    if row.ended_at is not None and row.status == "ended" and not row.commandable:
        return _snapshot(row)
    now = utcnow()
    row.status = "ended"
    row.phase = "ended"
    row.commandable = False
    row.ended_at = ended_at or now.isoformat()
    row.updated_at = now
    await db.flush()
    await worker_control.bump_exposure_revision(db, target_id=row.target_id, now=now)
    return _snapshot(row)


async def list_active_projection_cursors_for_target(
    db: AsyncSession,
    *,
    target_id: UUID,
) -> tuple[ActiveProjectionCursorSnapshot, ...]:
    rows = (
        await db.execute(
            select(CloudSessionProjection, CloudWorkspaceExposure)
            .join(
                CloudWorkspaceExposure,
                CloudWorkspaceExposure.id == CloudSessionProjection.exposure_id,
            )
            .where(CloudWorkspaceExposure.target_id == target_id)
            .where(CloudWorkspaceExposure.archived_at.is_(None))
            .where(CloudWorkspaceExposure.status == "active")
            .where(CloudSessionProjection.target_id == target_id)
            .where(CloudSessionProjection.ended_at.is_(None))
            .where(
                or_(
                    CloudSessionProjection.workspace_id.is_not(None),
                    CloudWorkspaceExposure.anyharness_workspace_id.is_not(None),
                )
            )
            .order_by(CloudWorkspaceExposure.updated_at.desc())
        )
    ).all()
    return tuple(
        ActiveProjectionCursorSnapshot(
            exposure_id=exposure.id,
            session_projection_id=projection.id,
            target_id=projection.target_id,
            cloud_workspace_id=exposure.cloud_workspace_id,
            anyharness_workspace_id=(
                projection.workspace_id or exposure.anyharness_workspace_id or ""
            ),
            anyharness_session_id=projection.session_id,
            projection_level=projection.projection_level,
            commandable=projection.commandable,
            exposure_status=exposure.status,
            exposure_revision=exposure.revision,
            last_uploaded_seq=projection.last_uploaded_seq or 0,
        )
        for projection, exposure in rows
    )


async def _load_session_projection(
    db: AsyncSession,
    *,
    target_id: UUID,
    session_id: str,
    lock: bool = False,
) -> CloudSessionProjection | None:
    query = (
        select(CloudSessionProjection)
        .where(CloudSessionProjection.target_id == target_id)
        .where(CloudSessionProjection.session_id == session_id)
        .limit(1)
    )
    if lock:
        query = query.with_for_update()
    return (await db.execute(query)).scalar_one_or_none()
