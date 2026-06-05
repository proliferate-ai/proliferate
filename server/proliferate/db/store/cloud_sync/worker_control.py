"""Worker control revision persistence."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.sync import CloudWorkerTargetControlState
from proliferate.db.store.cloud_sync import worker_exposures
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class WorkerControlCursor:
    target_id: UUID
    control_revision: int
    exposure_revision: int
    revoked_jti_revision: int


@dataclass(frozen=True)
class WorkerControlStateSnapshot:
    target_id: UUID
    control_revision: int
    exposure_revision: int
    revoked_jti_revision: int
    exposure_fingerprint_hash: str
    updated_at: datetime
    exposure_updated_at: datetime | None
    revoked_jti_updated_at: datetime | None


def _snapshot(row: CloudWorkerTargetControlState) -> WorkerControlStateSnapshot:
    return WorkerControlStateSnapshot(
        target_id=row.target_id,
        control_revision=row.control_revision,
        exposure_revision=row.exposure_revision,
        revoked_jti_revision=row.revoked_jti_revision,
        exposure_fingerprint_hash=row.exposure_fingerprint_hash,
        updated_at=row.updated_at,
        exposure_updated_at=row.exposure_updated_at,
        revoked_jti_updated_at=row.revoked_jti_updated_at,
    )


async def get_or_create_control_state(
    db: AsyncSession,
    *,
    target_id: UUID,
    lock: bool = False,
) -> WorkerControlStateSnapshot:
    row = await _load_control_state(db, target_id=target_id, lock=lock)
    if row is None:
        row = await _ensure_control_state_row(db, target_id=target_id)
    return _snapshot(row)


async def bump_control_revision(
    db: AsyncSession,
    *,
    target_id: UUID,
    now: datetime | None = None,
) -> WorkerControlStateSnapshot:
    row = await _ensure_control_state_row(db, target_id=target_id)
    marked_at = now or utcnow()
    row.control_revision += 1
    row.updated_at = marked_at
    await db.flush()
    return _snapshot(row)


async def bump_exposure_revision(
    db: AsyncSession,
    *,
    target_id: UUID,
    now: datetime | None = None,
) -> WorkerControlStateSnapshot:
    exposure_snapshots = await worker_exposures.list_worker_exposure_snapshots_for_target(
        db,
        target_id=target_id,
    )
    fingerprint_hash = worker_exposures.exposure_fingerprint_hash(exposure_snapshots)
    row = await _ensure_control_state_row(db, target_id=target_id)
    if row.exposure_fingerprint_hash == fingerprint_hash:
        return _snapshot(row)
    marked_at = now or utcnow()
    row.control_revision += 1
    row.exposure_revision += 1
    row.exposure_fingerprint_hash = fingerprint_hash
    row.updated_at = marked_at
    row.exposure_updated_at = marked_at
    await db.flush()
    return _snapshot(row)


async def bump_revoked_jti_revision(
    db: AsyncSession,
    *,
    target_id: UUID,
    now: datetime | None = None,
) -> WorkerControlStateSnapshot:
    row = await _ensure_control_state_row(db, target_id=target_id)
    marked_at = now or utcnow()
    row.control_revision += 1
    row.revoked_jti_revision += 1
    row.updated_at = marked_at
    row.revoked_jti_updated_at = marked_at
    await db.flush()
    return _snapshot(row)


async def ensure_exposure_state_current(
    db: AsyncSession,
    *,
    target_id: UUID,
    snapshots: tuple[worker_exposures.WorkerExposureSnapshot, ...] | None = None,
) -> WorkerControlStateSnapshot:
    exposure_snapshots = snapshots
    if exposure_snapshots is None:
        exposure_snapshots = await worker_exposures.list_worker_exposure_snapshots_for_target(
            db,
            target_id=target_id,
        )
    fingerprint_hash = worker_exposures.exposure_fingerprint_hash(exposure_snapshots)
    row = await _ensure_control_state_row(db, target_id=target_id)
    if row.exposure_fingerprint_hash == fingerprint_hash:
        return _snapshot(row)
    now = utcnow()
    row.control_revision += 1
    row.exposure_revision += 1
    row.exposure_fingerprint_hash = fingerprint_hash
    row.updated_at = now
    row.exposure_updated_at = now
    await db.flush()
    return _snapshot(row)


def control_cursor_for_state(state: WorkerControlStateSnapshot) -> str:
    return (
        f"v2:{state.target_id}:{state.control_revision}:"
        f"{state.exposure_revision}:{state.revoked_jti_revision}"
    )


def control_cursor_for_revisions(
    *,
    target_id: UUID,
    control_revision: int,
    exposure_revision: int,
    revoked_jti_revision: int,
) -> str:
    return f"v2:{target_id}:{control_revision}:{exposure_revision}:{revoked_jti_revision}"


def parse_control_cursor(value: str | None) -> WorkerControlCursor | None:
    if value is None:
        return None
    parts = value.strip().split(":")
    if len(parts) == 4 and parts[0] == "v1":
        try:
            target_id = UUID(parts[1])
            control_revision = int(parts[2])
            exposure_revision = int(parts[3])
        except ValueError:
            return None
        revoked_jti_revision = 0
    elif len(parts) == 5 and parts[0] == "v2":
        try:
            target_id = UUID(parts[1])
            control_revision = int(parts[2])
            exposure_revision = int(parts[3])
            revoked_jti_revision = int(parts[4])
        except ValueError:
            return None
    else:
        return None
    if control_revision < 0 or exposure_revision < 0:
        return None
    if revoked_jti_revision < 0:
        return None
    return WorkerControlCursor(
        target_id=target_id,
        control_revision=control_revision,
        exposure_revision=exposure_revision,
        revoked_jti_revision=revoked_jti_revision,
    )


def cursor_needs_full_snapshot(
    cursor: WorkerControlCursor | None,
    state: WorkerControlStateSnapshot,
) -> bool:
    return (
        cursor is None
        or cursor.target_id != state.target_id
        or cursor.control_revision > state.control_revision
        or cursor.exposure_revision > state.exposure_revision
        or cursor.revoked_jti_revision > state.revoked_jti_revision
    )


def cursor_is_current(
    cursor: WorkerControlCursor | None,
    state: WorkerControlStateSnapshot,
) -> bool:
    return (
        cursor is not None
        and cursor.target_id == state.target_id
        and cursor.control_revision == state.control_revision
        and cursor.exposure_revision == state.exposure_revision
        and cursor.revoked_jti_revision == state.revoked_jti_revision
    )


def cursor_exposures_are_current(
    cursor: WorkerControlCursor | None,
    state: WorkerControlStateSnapshot,
) -> bool:
    return (
        cursor is not None
        and cursor.target_id == state.target_id
        and cursor.exposure_revision == state.exposure_revision
    )


def cursor_revoked_jtis_are_current(
    cursor: WorkerControlCursor | None,
    state: WorkerControlStateSnapshot,
) -> bool:
    return (
        cursor is not None
        and cursor.target_id == state.target_id
        and cursor.revoked_jti_revision == state.revoked_jti_revision
    )


async def _ensure_control_state_row(
    db: AsyncSession,
    *,
    target_id: UUID,
) -> CloudWorkerTargetControlState:
    now = utcnow()
    await db.execute(
        insert(CloudWorkerTargetControlState)
        .values(
            target_id=target_id,
            control_revision=0,
            exposure_revision=0,
            revoked_jti_revision=0,
            exposure_fingerprint_hash="",
            updated_at=now,
            exposure_updated_at=None,
            revoked_jti_updated_at=None,
        )
        .on_conflict_do_nothing(
            index_elements=[CloudWorkerTargetControlState.target_id],
        )
    )
    row = await _load_control_state(db, target_id=target_id, lock=True)
    if row is None:
        raise RuntimeError("Worker control state row was not created.")
    return row


async def _load_control_state(
    db: AsyncSession,
    *,
    target_id: UUID,
    lock: bool = False,
) -> CloudWorkerTargetControlState | None:
    query = select(CloudWorkerTargetControlState).where(
        CloudWorkerTargetControlState.target_id == target_id
    )
    if lock:
        query = query.with_for_update()
    return (await db.execute(query)).scalar_one_or_none()
