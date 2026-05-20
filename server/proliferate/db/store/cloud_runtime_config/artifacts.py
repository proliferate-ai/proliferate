from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.runtime_config import SandboxProfileRuntimeConfigArtifact
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class SandboxProfileRuntimeConfigArtifactSnapshot:
    revision_id: UUID
    artifact_hash: str
    content_type: str
    byte_size: int
    payload_ciphertext: str
    created_at: datetime


def _snapshot(
    row: SandboxProfileRuntimeConfigArtifact,
) -> SandboxProfileRuntimeConfigArtifactSnapshot:
    return SandboxProfileRuntimeConfigArtifactSnapshot(
        revision_id=row.revision_id,
        artifact_hash=row.artifact_hash,
        content_type=row.content_type,
        byte_size=row.byte_size,
        payload_ciphertext=row.payload_ciphertext,
        created_at=row.created_at,
    )


async def upsert_artifact(
    db: AsyncSession,
    *,
    revision_id: UUID,
    artifact_hash: str,
    content_type: str,
    byte_size: int,
    payload_ciphertext: str,
) -> SandboxProfileRuntimeConfigArtifactSnapshot:
    row = await db.get(
        SandboxProfileRuntimeConfigArtifact,
        {
            "revision_id": revision_id,
            "artifact_hash": artifact_hash,
        },
    )
    if row is None:
        row = SandboxProfileRuntimeConfigArtifact(
            revision_id=revision_id,
            artifact_hash=artifact_hash,
            content_type=content_type,
            byte_size=byte_size,
            payload_ciphertext=payload_ciphertext,
            created_at=utcnow(),
        )
        db.add(row)
    else:
        row.content_type = content_type
        row.byte_size = byte_size
        row.payload_ciphertext = payload_ciphertext
    await db.flush()
    return _snapshot(row)


async def get_artifact(
    db: AsyncSession,
    *,
    revision_id: UUID,
    artifact_hash: str,
) -> SandboxProfileRuntimeConfigArtifactSnapshot | None:
    row = await db.get(
        SandboxProfileRuntimeConfigArtifact,
        {
            "revision_id": revision_id,
            "artifact_hash": artifact_hash,
        },
    )
    return _snapshot(row) if row is not None else None


async def list_artifacts_for_revision(
    db: AsyncSession,
    *,
    revision_id: UUID,
) -> tuple[SandboxProfileRuntimeConfigArtifactSnapshot, ...]:
    rows = (
        (
            await db.execute(
                select(SandboxProfileRuntimeConfigArtifact)
                .where(SandboxProfileRuntimeConfigArtifact.revision_id == revision_id)
                .order_by(SandboxProfileRuntimeConfigArtifact.artifact_hash.asc())
            )
        )
        .scalars()
        .all()
    )
    return tuple(_snapshot(row) for row in rows)
