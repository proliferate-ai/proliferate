"""Cloud session projection persistence."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.exposures import CloudWorkspaceExposure
from proliferate.db.models.cloud.sync import (
    CloudPendingInteraction,
    CloudSessionProjection,
    CloudTranscriptItem,
)
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


@dataclass(frozen=True)
class CloudSessionProjectionSnapshot:
    id: UUID
    target_id: UUID
    exposure_id: UUID | None
    cloud_workspace_id: UUID | None
    workspace_id: str | None
    session_id: str
    native_session_id: str | None
    source_agent_kind: str | None
    title: str | None
    status: str
    phase: str | None
    live_config_json: str | None
    projection_level: str
    commandable: bool
    gap_state_json: str | None
    last_uploaded_seq: int | None
    agent_run_config_snapshot_json: dict[str, object] | None
    last_event_seq: int
    last_event_at: str | None
    started_at: str | None
    ended_at: str | None
    updated_at: datetime
    pending_interaction_count: int = 0
    preview: str | None = None


def _session_snapshot(
    row: CloudSessionProjection,
    *,
    pending_interaction_count: int = 0,
    preview: str | None = None,
) -> CloudSessionProjectionSnapshot:
    return CloudSessionProjectionSnapshot(
        id=row.id,
        target_id=row.target_id,
        exposure_id=row.exposure_id,
        cloud_workspace_id=row.cloud_workspace_id,
        workspace_id=row.workspace_id,
        session_id=row.session_id,
        native_session_id=row.native_session_id,
        source_agent_kind=row.source_agent_kind,
        title=row.title,
        status=row.status,
        phase=row.phase,
        live_config_json=row.live_config_json,
        projection_level=row.projection_level,
        commandable=row.commandable,
        gap_state_json=row.gap_state_json,
        last_uploaded_seq=row.last_uploaded_seq,
        agent_run_config_snapshot_json=row.agent_run_config_snapshot_json,
        last_event_seq=row.last_event_seq,
        last_event_at=row.last_event_at,
        started_at=row.started_at,
        ended_at=row.ended_at,
        updated_at=row.updated_at,
        pending_interaction_count=pending_interaction_count,
        preview=preview,
    )


async def count_active_sessions_for_target(
    db: AsyncSession,
    *,
    target_id: UUID,
) -> int:
    count_value = (
        await db.execute(
            select(func.count(CloudSessionProjection.id))
            .where(CloudSessionProjection.target_id == target_id)
            .where(CloudSessionProjection.ended_at.is_(None))
        )
    ).scalar_one()
    return int(count_value or 0)


async def upsert_session_projection(
    db: AsyncSession,
    *,
    target_id: UUID,
    cloud_workspace_id: UUID | None,
    workspace_id: str | None,
    session_id: str,
    seq: int,
    occurred_at: str | None,
    status: str | None = None,
    phase: str | None = None,
    native_session_id: str | None = None,
    source_agent_kind: str | None = None,
    title: str | None = None,
    live_config_json: str | None = None,
    started_at: str | None = None,
    ended_at: str | None = None,
) -> CloudSessionProjectionSnapshot:
    now = utcnow()
    row = (
        await db.execute(
            select(CloudSessionProjection)
            .where(CloudSessionProjection.target_id == target_id)
            .where(CloudSessionProjection.session_id == session_id)
        )
    ).scalar_one_or_none()
    if row is None:
        row = CloudSessionProjection(
            target_id=target_id,
            cloud_workspace_id=cloud_workspace_id,
            workspace_id=workspace_id,
            session_id=session_id,
            native_session_id=native_session_id,
            source_agent_kind=source_agent_kind,
            title=title,
            status=status or "running",
            phase=phase,
            live_config_json=live_config_json,
            projection_level="live",
            commandable=True,
            last_event_seq=seq,
            last_event_at=occurred_at,
            started_at=started_at,
            ended_at=ended_at,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    else:
        if seq < row.last_event_seq:
            return _session_snapshot(row)
        row.cloud_workspace_id = cloud_workspace_id or row.cloud_workspace_id
        row.workspace_id = workspace_id or row.workspace_id
        row.native_session_id = native_session_id or row.native_session_id
        row.source_agent_kind = source_agent_kind or row.source_agent_kind
        row.title = title if title is not None else row.title
        row.status = status or row.status
        row.phase = phase or row.phase
        row.live_config_json = (
            live_config_json if live_config_json is not None else row.live_config_json
        )
        row.last_event_seq = max(row.last_event_seq, seq)
        row.last_event_at = occurred_at or row.last_event_at
        row.started_at = started_at or row.started_at
        row.ended_at = ended_at or row.ended_at
        row.updated_at = now
    await db.flush()
    return _session_snapshot(row)


async def get_session_projection(
    db: AsyncSession,
    *,
    target_id: UUID,
    session_id: str,
) -> CloudSessionProjectionSnapshot | None:
    row = (
        await db.execute(
            select(CloudSessionProjection)
            .where(CloudSessionProjection.target_id == target_id)
            .where(CloudSessionProjection.session_id == session_id)
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    pending_count = await _pending_interaction_count_for_session(
        db,
        target_id=row.target_id,
        session_id=row.session_id,
    )
    return _session_snapshot(row, pending_interaction_count=pending_count)


async def get_session_projection_by_session_id(
    db: AsyncSession,
    *,
    session_id: str,
) -> CloudSessionProjectionSnapshot | None:
    row = (
        await db.execute(
            select(CloudSessionProjection)
            .where(CloudSessionProjection.session_id == session_id)
            .order_by(CloudSessionProjection.updated_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    pending_count = await _pending_interaction_count_for_session(
        db,
        target_id=row.target_id,
        session_id=row.session_id,
    )
    return _session_snapshot(row, pending_interaction_count=pending_count)


async def list_session_projections(
    db: AsyncSession,
    *,
    target_id: UUID,
    cloud_workspace_id: UUID | None = None,
    workspace_id: str | None = None,
    limit: int = 100,
) -> tuple[CloudSessionProjectionSnapshot, ...]:
    query = select(CloudSessionProjection).where(CloudSessionProjection.target_id == target_id)
    if cloud_workspace_id is not None:
        query = query.where(CloudSessionProjection.cloud_workspace_id == cloud_workspace_id)
    if workspace_id is not None:
        query = query.where(CloudSessionProjection.workspace_id == workspace_id)
    rows = tuple(
        (
            await db.execute(
                query.order_by(
                    CloudSessionProjection.updated_at.desc(),
                    CloudSessionProjection.last_event_seq.desc(),
                ).limit(limit)
            )
        ).scalars()
    )
    previews = await _latest_transcript_previews_for_sessions(db, rows)
    pending_counts = await _pending_interaction_counts_for_sessions(db, rows)
    return tuple(
        _session_snapshot(
            row,
            pending_interaction_count=pending_counts.get((row.target_id, row.session_id), 0),
            preview=previews.get((row.target_id, row.session_id)),
        )
        for row in rows
    )


async def list_session_projections_for_workspace(
    db: AsyncSession,
    *,
    cloud_workspace_id: UUID,
    target_id: UUID | None = None,
    limit: int = 100,
) -> tuple[CloudSessionProjectionSnapshot, ...]:
    query = select(CloudSessionProjection).where(
        CloudSessionProjection.cloud_workspace_id == cloud_workspace_id
    )
    if target_id is not None:
        query = query.where(CloudSessionProjection.target_id == target_id)
    rows = tuple(
        (
            await db.execute(
                query.order_by(
                    CloudSessionProjection.updated_at.desc(),
                    CloudSessionProjection.last_event_seq.desc(),
                ).limit(limit)
            )
        ).scalars()
    )
    previews = await _latest_transcript_previews_for_sessions(db, rows)
    pending_counts = await _pending_interaction_counts_for_sessions(db, rows)
    return tuple(
        _session_snapshot(
            row,
            pending_interaction_count=pending_counts.get((row.target_id, row.session_id), 0),
            preview=previews.get((row.target_id, row.session_id)),
        )
        for row in rows
    )


async def _pending_interaction_count_for_session(
    db: AsyncSession,
    *,
    target_id: UUID,
    session_id: str,
) -> int:
    count = await db.scalar(
        select(func.count(CloudPendingInteraction.id))
        .where(CloudPendingInteraction.target_id == target_id)
        .where(CloudPendingInteraction.session_id == session_id)
        .where(CloudPendingInteraction.status.in_(("pending", "failed")))
    )
    return int(count or 0)


async def _pending_interaction_counts_for_sessions(
    db: AsyncSession,
    rows: tuple[CloudSessionProjection, ...],
) -> dict[tuple[UUID, str], int]:
    session_keys = tuple({(row.target_id, row.session_id) for row in rows})
    if not session_keys:
        return {}
    conditions = [
        and_(
            CloudPendingInteraction.target_id == target_id,
            CloudPendingInteraction.session_id == session_id,
        )
        for target_id, session_id in session_keys
    ]
    count_rows = await db.execute(
        select(
            CloudPendingInteraction.target_id,
            CloudPendingInteraction.session_id,
            func.count(CloudPendingInteraction.id),
        )
        .where(or_(*conditions))
        .where(CloudPendingInteraction.status.in_(("pending", "failed")))
        .group_by(CloudPendingInteraction.target_id, CloudPendingInteraction.session_id)
    )
    return {(target_id, session_id): int(count) for target_id, session_id, count in count_rows}


async def _latest_transcript_previews_for_sessions(
    db: AsyncSession,
    rows: tuple[CloudSessionProjection, ...],
) -> dict[tuple[UUID, str], str]:
    session_keys = tuple({(row.target_id, row.session_id) for row in rows})
    if not session_keys:
        return {}
    conditions = [
        and_(
            CloudTranscriptItem.target_id == target_id,
            CloudTranscriptItem.session_id == session_id,
        )
        for target_id, session_id in session_keys
    ]
    preview_query = (
        select(CloudTranscriptItem)
        .where(or_(*conditions))
        .order_by(
            CloudTranscriptItem.target_id.asc(),
            CloudTranscriptItem.session_id.asc(),
            CloudTranscriptItem.last_seq.desc(),
            CloudTranscriptItem.updated_at.desc(),
        )
    )
    if len(session_keys) == 1:
        preview_query = preview_query.limit(50)
    transcript_rows = (await db.execute(preview_query)).scalars()
    previews: dict[tuple[UUID, str], str] = {}
    fallback_previews: dict[tuple[UUID, str], str] = {}
    for item in transcript_rows:
        key = (item.target_id, item.session_id)
        if key in previews:
            continue
        preview = _transcript_item_preview(item)
        if not preview:
            continue
        if _is_conversation_preview_kind(item.kind):
            previews[key] = preview
        elif key not in fallback_previews:
            fallback_previews[key] = preview
    return {**fallback_previews, **previews}


def _is_conversation_preview_kind(kind: str | None) -> bool:
    normalized = (kind or "").strip().lower()
    return normalized in {"assistant_message", "prompt", "user_message"}


def _transcript_item_preview(item: CloudTranscriptItem) -> str | None:
    for value in (item.text, item.title):
        preview = _compact_preview_text(value)
        if preview:
            return preview
    return None


def _compact_preview_text(value: str | None) -> str | None:
    text = " ".join((value or "").split())
    if not text:
        return None
    if text.lower() in {
        "assistant_message",
        "bash",
        "command",
        "shell",
        "terminal",
        "tool call",
        "user_message",
    }:
        return None
    if len(text) <= 280:
        return text
    return f"{text[:277].rstrip()}..."
