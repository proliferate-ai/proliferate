from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.runtime_config import (
    SandboxProfileRuntimeConfigCurrent,
    SandboxProfileRuntimeConfigRevision,
)
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class SandboxProfileRuntimeConfigRevisionSnapshot:
    id: UUID
    sandbox_profile_id: UUID
    sequence: int
    content_hash: str
    manifest_json: str
    warnings_json: str | None
    source: str
    generated_by_user_id: UUID | None
    created_at: datetime


@dataclass(frozen=True)
class SandboxProfileRuntimeConfigCurrentSnapshot:
    sandbox_profile_id: UUID
    current_sequence: int
    current_revision_id: UUID | None
    updated_at: datetime


def _revision_snapshot(
    row: SandboxProfileRuntimeConfigRevision,
) -> SandboxProfileRuntimeConfigRevisionSnapshot:
    return SandboxProfileRuntimeConfigRevisionSnapshot(
        id=row.id,
        sandbox_profile_id=row.sandbox_profile_id,
        sequence=row.sequence,
        content_hash=row.content_hash,
        manifest_json=row.manifest_json,
        warnings_json=row.warnings_json,
        source=row.source,
        generated_by_user_id=row.generated_by_user_id,
        created_at=row.created_at,
    )


def _current_snapshot(
    row: SandboxProfileRuntimeConfigCurrent,
) -> SandboxProfileRuntimeConfigCurrentSnapshot:
    return SandboxProfileRuntimeConfigCurrentSnapshot(
        sandbox_profile_id=row.sandbox_profile_id,
        current_sequence=row.current_sequence,
        current_revision_id=row.current_revision_id,
        updated_at=row.updated_at,
    )


async def get_revision_by_id(
    db: AsyncSession,
    revision_id: UUID,
) -> SandboxProfileRuntimeConfigRevisionSnapshot | None:
    row = await db.get(SandboxProfileRuntimeConfigRevision, revision_id)
    return _revision_snapshot(row) if row is not None else None


async def get_revision_by_hash(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    content_hash: str,
) -> SandboxProfileRuntimeConfigRevisionSnapshot | None:
    row = (
        await db.execute(
            select(SandboxProfileRuntimeConfigRevision).where(
                SandboxProfileRuntimeConfigRevision.sandbox_profile_id == sandbox_profile_id,
                SandboxProfileRuntimeConfigRevision.content_hash == content_hash,
            )
        )
    ).scalar_one_or_none()
    return _revision_snapshot(row) if row is not None else None


async def get_current(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
) -> tuple[
    SandboxProfileRuntimeConfigCurrentSnapshot | None,
    SandboxProfileRuntimeConfigRevisionSnapshot | None,
]:
    current = await db.get(SandboxProfileRuntimeConfigCurrent, sandbox_profile_id)
    if current is None:
        return None, None
    revision = (
        await db.get(SandboxProfileRuntimeConfigRevision, current.current_revision_id)
        if current.current_revision_id is not None
        else None
    )
    return _current_snapshot(current), _revision_snapshot(revision) if revision else None


async def upsert_revision_and_current(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    content_hash: str,
    manifest_json: str,
    warnings_json: str | None,
    source: str,
    generated_by_user_id: UUID | None,
) -> tuple[SandboxProfileRuntimeConfigRevisionSnapshot, bool]:
    existing = await get_revision_by_hash(
        db,
        sandbox_profile_id=sandbox_profile_id,
        content_hash=content_hash,
    )
    created = False
    if existing is None:
        next_sequence = (
            await db.scalar(
                select(
                    func.coalesce(func.max(SandboxProfileRuntimeConfigRevision.sequence), 0)
                ).where(
                    SandboxProfileRuntimeConfigRevision.sandbox_profile_id == sandbox_profile_id
                )
            )
        ) + 1
        row = SandboxProfileRuntimeConfigRevision(
            sandbox_profile_id=sandbox_profile_id,
            sequence=next_sequence,
            content_hash=content_hash,
            manifest_json=manifest_json,
            warnings_json=warnings_json,
            source=source,
            generated_by_user_id=generated_by_user_id,
            created_at=utcnow(),
        )
        db.add(row)
        await db.flush()
        await db.refresh(row)
        revision = _revision_snapshot(row)
        created = True
    else:
        revision = existing

    current = await db.get(SandboxProfileRuntimeConfigCurrent, sandbox_profile_id)
    now = utcnow()
    if current is None:
        current = SandboxProfileRuntimeConfigCurrent(
            sandbox_profile_id=sandbox_profile_id,
            current_sequence=revision.sequence,
            current_revision_id=revision.id,
            updated_at=now,
        )
        db.add(current)
    else:
        current.current_sequence = revision.sequence
        current.current_revision_id = revision.id
        current.updated_at = now
    await db.flush()
    return revision, created
