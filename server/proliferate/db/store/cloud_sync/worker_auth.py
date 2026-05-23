"""Proliferate Worker enrollment and auth persistence."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import (
    CloudTargetEnrollmentStatus,
    CloudWorkerStatus,
)
from proliferate.db.models.cloud.targets import CloudTargetEnrollment, CloudWorker
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class CloudTargetEnrollmentSnapshot:
    id: UUID
    target_id: UUID
    sandbox_profile_id: UUID | None
    cloud_sandbox_id: UUID | None
    slot_generation: int | None
    token_hash: str
    status: str
    created_by_user_id: UUID
    expires_at: datetime
    consumed_at: datetime | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class CloudWorkerSnapshot:
    id: UUID
    target_id: UUID
    cloud_sandbox_id: UUID | None
    slot_generation: int | None
    token_hash: str
    machine_fingerprint: str | None
    hostname: str | None
    status: str
    worker_version: str | None
    anyharness_version: str | None
    supervisor_version: str | None
    last_seen_at: datetime | None
    last_heartbeat_at: datetime | None
    created_at: datetime
    updated_at: datetime


def _enrollment_snapshot(row: CloudTargetEnrollment) -> CloudTargetEnrollmentSnapshot:
    return CloudTargetEnrollmentSnapshot(
        id=row.id,
        target_id=row.target_id,
        sandbox_profile_id=row.sandbox_profile_id,
        cloud_sandbox_id=row.cloud_sandbox_id,
        slot_generation=row.slot_generation,
        token_hash=row.token_hash,
        status=row.status,
        created_by_user_id=row.created_by_user_id,
        expires_at=row.expires_at,
        consumed_at=row.consumed_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _worker_snapshot(row: CloudWorker) -> CloudWorkerSnapshot:
    return CloudWorkerSnapshot(
        id=row.id,
        target_id=row.target_id,
        cloud_sandbox_id=row.cloud_sandbox_id,
        slot_generation=row.slot_generation,
        token_hash=row.token_hash,
        machine_fingerprint=row.machine_fingerprint,
        hostname=row.hostname,
        status=row.status,
        worker_version=row.worker_version,
        anyharness_version=row.anyharness_version,
        supervisor_version=row.supervisor_version,
        last_seen_at=row.last_seen_at,
        last_heartbeat_at=row.last_heartbeat_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def create_enrollment(
    db: AsyncSession,
    *,
    target_id: UUID,
    sandbox_profile_id: UUID | None = None,
    cloud_sandbox_id: UUID | None = None,
    slot_generation: int | None = None,
    token_hash: str,
    created_by_user_id: UUID,
    expires_at: datetime,
) -> CloudTargetEnrollmentSnapshot:
    now = utcnow()
    row = CloudTargetEnrollment(
        target_id=target_id,
        sandbox_profile_id=sandbox_profile_id,
        cloud_sandbox_id=cloud_sandbox_id,
        slot_generation=slot_generation,
        token_hash=token_hash,
        status=CloudTargetEnrollmentStatus.pending.value,
        created_by_user_id=created_by_user_id,
        expires_at=expires_at,
        consumed_at=None,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    await db.flush()
    return _enrollment_snapshot(row)


async def revoke_pending_enrollments_for_target(
    db: AsyncSession,
    *,
    target_id: UUID,
    now: datetime,
) -> None:
    await db.execute(
        update(CloudTargetEnrollment)
        .where(CloudTargetEnrollment.target_id == target_id)
        .where(CloudTargetEnrollment.status == CloudTargetEnrollmentStatus.pending.value)
        .values(status=CloudTargetEnrollmentStatus.revoked.value, updated_at=now)
    )
    await db.flush()


async def consume_pending_enrollment_by_hash(
    db: AsyncSession,
    *,
    token_hash: str,
    now: datetime,
) -> CloudTargetEnrollmentSnapshot | None:
    row = (
        await db.execute(
            select(CloudTargetEnrollment)
            .where(CloudTargetEnrollment.token_hash == token_hash)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    if row.status != CloudTargetEnrollmentStatus.pending.value:
        return None
    if row.expires_at <= now:
        row.status = CloudTargetEnrollmentStatus.expired.value
        row.updated_at = now
        await db.flush()
        return None
    row.status = CloudTargetEnrollmentStatus.consumed.value
    row.consumed_at = now
    row.updated_at = now
    await db.flush()
    return _enrollment_snapshot(row)


async def create_worker(
    db: AsyncSession,
    *,
    target_id: UUID,
    cloud_sandbox_id: UUID | None,
    slot_generation: int | None,
    token_hash: str,
    machine_fingerprint: str | None,
    hostname: str | None,
    worker_version: str | None,
    anyharness_version: str | None,
    supervisor_version: str | None,
    now: datetime,
) -> CloudWorkerSnapshot:
    row = CloudWorker(
        target_id=target_id,
        cloud_sandbox_id=cloud_sandbox_id,
        slot_generation=slot_generation,
        token_hash=token_hash,
        machine_fingerprint=machine_fingerprint,
        hostname=hostname,
        status=CloudWorkerStatus.online.value,
        worker_version=worker_version,
        anyharness_version=anyharness_version,
        supervisor_version=supervisor_version,
        last_seen_at=now,
        last_heartbeat_at=now,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    await db.flush()
    return _worker_snapshot(row)


async def get_worker_by_token_hash(
    db: AsyncSession,
    *,
    token_hash: str,
) -> CloudWorkerSnapshot | None:
    row = (
        await db.execute(select(CloudWorker).where(CloudWorker.token_hash == token_hash))
    ).scalar_one_or_none()
    return _worker_snapshot(row) if row is not None else None


async def record_worker_heartbeat(
    db: AsyncSession,
    *,
    worker_id: UUID,
    status_value: str,
    worker_version: str | None,
    anyharness_version: str | None,
    supervisor_version: str | None,
    now: datetime,
) -> CloudWorkerSnapshot | None:
    row = await db.get(CloudWorker, worker_id)
    if row is None:
        return None
    row.status = status_value
    row.worker_version = worker_version
    row.anyharness_version = anyharness_version
    row.supervisor_version = supervisor_version
    row.last_seen_at = now
    row.last_heartbeat_at = now
    row.updated_at = now
    await db.flush()
    return _worker_snapshot(row)


async def archive_workers_for_target(
    db: AsyncSession,
    *,
    target_id: UUID,
    now: datetime,
) -> None:
    await db.execute(
        update(CloudWorker)
        .where(CloudWorker.target_id == target_id)
        .where(CloudWorker.status != CloudWorkerStatus.archived.value)
        .values(status=CloudWorkerStatus.archived.value, updated_at=now)
    )
    await db.flush()
