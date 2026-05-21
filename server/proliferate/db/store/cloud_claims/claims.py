"""Cloud workspace claim persistence."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.claims import CloudWorkspaceClaim
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class CloudWorkspaceClaimSnapshot:
    id: UUID
    cloud_workspace_id: UUID
    exposure_id: UUID
    organization_id: UUID
    target_id: UUID
    anyharness_workspace_id: str | None
    cloud_session_id: UUID | None
    anyharness_session_id: str | None
    claimed_by_user_id: UUID | None
    source_kind: str
    claimed_at: datetime
    created_at: datetime


def _snapshot(row: CloudWorkspaceClaim) -> CloudWorkspaceClaimSnapshot:
    return CloudWorkspaceClaimSnapshot(
        id=row.id,
        cloud_workspace_id=row.cloud_workspace_id,
        exposure_id=row.exposure_id,
        organization_id=row.organization_id,
        target_id=row.target_id,
        anyharness_workspace_id=row.anyharness_workspace_id,
        cloud_session_id=row.cloud_session_id,
        anyharness_session_id=row.anyharness_session_id,
        claimed_by_user_id=row.claimed_by_user_id,
        source_kind=row.source_kind,
        claimed_at=row.claimed_at,
        created_at=row.created_at,
    )


async def get_claim_for_workspace(
    db: AsyncSession,
    cloud_workspace_id: UUID,
) -> CloudWorkspaceClaimSnapshot | None:
    row = (
        await db.execute(
            select(CloudWorkspaceClaim).where(
                CloudWorkspaceClaim.cloud_workspace_id == cloud_workspace_id
            )
        )
    ).scalar_one_or_none()
    return _snapshot(row) if row is not None else None


async def get_claim_for_exposure(
    db: AsyncSession,
    exposure_id: UUID,
) -> CloudWorkspaceClaimSnapshot | None:
    row = (
        await db.execute(
            select(CloudWorkspaceClaim).where(CloudWorkspaceClaim.exposure_id == exposure_id)
        )
    ).scalar_one_or_none()
    return _snapshot(row) if row is not None else None


async def get_claim_by_id(
    db: AsyncSession,
    claim_id: UUID,
) -> CloudWorkspaceClaimSnapshot | None:
    row = await db.get(CloudWorkspaceClaim, claim_id)
    return _snapshot(row) if row is not None else None


async def insert_workspace_claim(
    db: AsyncSession,
    *,
    cloud_workspace_id: UUID,
    exposure_id: UUID,
    organization_id: UUID,
    target_id: UUID,
    anyharness_workspace_id: str | None,
    cloud_session_id: UUID | None,
    anyharness_session_id: str | None,
    claimed_by_user_id: UUID,
    source_kind: str,
    claimed_at: datetime | None = None,
) -> CloudWorkspaceClaimSnapshot | None:
    now = claimed_at or utcnow()
    inserted_id = (
        await db.execute(
            pg_insert(CloudWorkspaceClaim)
            .values(
                cloud_workspace_id=cloud_workspace_id,
                exposure_id=exposure_id,
                organization_id=organization_id,
                target_id=target_id,
                anyharness_workspace_id=anyharness_workspace_id,
                cloud_session_id=cloud_session_id,
                anyharness_session_id=anyharness_session_id,
                claimed_by_user_id=claimed_by_user_id,
                source_kind=source_kind,
                claimed_at=now,
                created_at=now,
            )
            .on_conflict_do_nothing(
                index_elements=[CloudWorkspaceClaim.cloud_workspace_id],
            )
            .returning(CloudWorkspaceClaim.id)
        )
    ).scalar_one_or_none()
    if inserted_id is None:
        return None
    row = await db.get(CloudWorkspaceClaim, inserted_id)
    if row is None:
        raise RuntimeError("Inserted cloud workspace claim disappeared before snapshot.")
    return _snapshot(row)


async def list_claims_for_user(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> tuple[CloudWorkspaceClaimSnapshot, ...]:
    rows = (
        await db.execute(
            select(CloudWorkspaceClaim)
            .where(CloudWorkspaceClaim.claimed_by_user_id == user_id)
            .order_by(CloudWorkspaceClaim.claimed_at.desc(), CloudWorkspaceClaim.id.desc())
        )
    ).scalars()
    return tuple(_snapshot(row) for row in rows)


async def list_claims_for_workspaces(
    db: AsyncSession,
    *,
    cloud_workspace_ids: list[UUID] | tuple[UUID, ...],
) -> tuple[CloudWorkspaceClaimSnapshot, ...]:
    if not cloud_workspace_ids:
        return ()
    rows = (
        await db.execute(
            select(CloudWorkspaceClaim).where(
                CloudWorkspaceClaim.cloud_workspace_id.in_(cloud_workspace_ids)
            )
        )
    ).scalars()
    return tuple(_snapshot(row) for row in rows)


async def list_orphan_claims(
    db: AsyncSession,
    *,
    limit: int = 100,
) -> tuple[CloudWorkspaceClaimSnapshot, ...]:
    rows = (
        await db.execute(
            select(CloudWorkspaceClaim)
            .where(CloudWorkspaceClaim.claimed_by_user_id.is_(None))
            .order_by(CloudWorkspaceClaim.claimed_at.asc())
            .limit(limit)
        )
    ).scalars()
    return tuple(_snapshot(row) for row in rows)
