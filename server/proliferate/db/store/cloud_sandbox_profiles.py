"""Persistence helpers for managed cloud sandbox profiles."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.agent_auth import SandboxProfile
from proliferate.db.models.cloud.targets import CloudTarget
from proliferate.db.store.billing import (
    ensure_organization_billing_subject,
    ensure_personal_billing_subject,
)
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class SandboxProfileSnapshot:
    id: UUID
    owner_scope: str
    owner_user_id: UUID | None
    organization_id: UUID | None
    billing_subject_id: UUID
    created_by_user_id: UUID | None
    desired_agent_auth_revision: int
    status: str
    primary_target_id: UUID | None
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None


def _profile_snapshot(
    row: SandboxProfile,
    *,
    primary_target_id: UUID | None,
) -> SandboxProfileSnapshot:
    return SandboxProfileSnapshot(
        id=row.id,
        owner_scope=row.owner_scope,
        owner_user_id=row.owner_user_id,
        organization_id=row.organization_id,
        billing_subject_id=row.billing_subject_id,
        created_by_user_id=row.created_by_user_id,
        desired_agent_auth_revision=row.desired_agent_auth_revision,
        status=row.status,
        primary_target_id=primary_target_id,
        created_at=row.created_at,
        updated_at=row.updated_at,
        archived_at=row.archived_at,
    )


async def ensure_personal_sandbox_profile(
    db: AsyncSession,
    *,
    user_id: UUID,
    created_by_user_id: UUID | None = None,
) -> SandboxProfileSnapshot:
    billing_subject = await ensure_personal_billing_subject(db, user_id)
    now = utcnow()
    result = await db.execute(
        pg_insert(SandboxProfile)
        .values(
            owner_scope="personal",
            owner_user_id=user_id,
            organization_id=None,
            billing_subject_id=billing_subject.id,
            created_by_user_id=created_by_user_id or user_id,
            desired_agent_auth_revision=0,
            status="configuring",
            created_at=now,
            updated_at=now,
            archived_at=None,
            deleted_at=None,
        )
        .on_conflict_do_nothing(
            index_elements=[SandboxProfile.owner_user_id],
            index_where=(
                (SandboxProfile.owner_scope == "personal")
                & SandboxProfile.archived_at.is_(None)
            ),
        )
        .returning(SandboxProfile.id)
    )
    profile_id = result.scalar_one_or_none()
    if profile_id is None:
        row = (
            await db.execute(
                select(SandboxProfile)
                .where(
                    SandboxProfile.owner_scope == "personal",
                    SandboxProfile.owner_user_id == user_id,
                    SandboxProfile.archived_at.is_(None),
                )
                .with_for_update()
            )
        ).scalar_one()
    else:
        row = await db.get(SandboxProfile, profile_id)
        if row is None:
            raise RuntimeError("Sandbox profile disappeared after creation.")
    return _profile_snapshot(
        row,
        primary_target_id=await load_primary_target_id(db, row.id),
    )


async def ensure_organization_sandbox_profile(
    db: AsyncSession,
    *,
    organization_id: UUID,
    created_by_user_id: UUID | None,
) -> SandboxProfileSnapshot:
    billing_subject = await ensure_organization_billing_subject(db, organization_id)
    now = utcnow()
    result = await db.execute(
        pg_insert(SandboxProfile)
        .values(
            owner_scope="organization",
            owner_user_id=None,
            organization_id=organization_id,
            billing_subject_id=billing_subject.id,
            created_by_user_id=created_by_user_id,
            desired_agent_auth_revision=0,
            status="configuring",
            created_at=now,
            updated_at=now,
            archived_at=None,
            deleted_at=None,
        )
        .on_conflict_do_nothing(
            index_elements=[SandboxProfile.organization_id],
            index_where=(
                (SandboxProfile.owner_scope == "organization")
                & SandboxProfile.archived_at.is_(None)
            ),
        )
        .returning(SandboxProfile.id)
    )
    profile_id = result.scalar_one_or_none()
    if profile_id is None:
        row = (
            await db.execute(
                select(SandboxProfile)
                .where(
                    SandboxProfile.owner_scope == "organization",
                    SandboxProfile.organization_id == organization_id,
                    SandboxProfile.archived_at.is_(None),
                )
                .with_for_update()
            )
        ).scalar_one()
    else:
        row = await db.get(SandboxProfile, profile_id)
        if row is None:
            raise RuntimeError("Sandbox profile disappeared after creation.")
    return _profile_snapshot(
        row,
        primary_target_id=await load_primary_target_id(db, row.id),
    )


async def load_sandbox_profile_by_id(
    db: AsyncSession,
    sandbox_profile_id: UUID,
) -> SandboxProfileSnapshot | None:
    row = await db.get(SandboxProfile, sandbox_profile_id)
    if row is None or row.archived_at is not None:
        return None
    return _profile_snapshot(
        row,
        primary_target_id=await load_primary_target_id(db, row.id),
    )


async def list_active_sandbox_profiles_for_organization(
    db: AsyncSession,
    organization_id: UUID,
) -> tuple[SandboxProfileSnapshot, ...]:
    rows = (
        (
            await db.execute(
                select(SandboxProfile)
                .where(
                    SandboxProfile.owner_scope == "organization",
                    SandboxProfile.organization_id == organization_id,
                    SandboxProfile.archived_at.is_(None),
                )
                .order_by(SandboxProfile.created_at.asc())
            )
        )
        .scalars()
        .all()
    )
    snapshots: list[SandboxProfileSnapshot] = []
    for row in rows:
        snapshots.append(
            _profile_snapshot(
                row,
                primary_target_id=await load_primary_target_id(db, row.id),
            )
        )
    return tuple(snapshots)


async def update_sandbox_profile_status(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    status: str,
) -> SandboxProfileSnapshot | None:
    row = await db.get(SandboxProfile, sandbox_profile_id)
    if row is None or row.archived_at is not None:
        return None
    row.status = status
    row.updated_at = utcnow()
    await db.flush()
    return _profile_snapshot(
        row,
        primary_target_id=await load_primary_target_id(db, row.id),
    )


async def load_primary_target_id(db: AsyncSession, sandbox_profile_id: UUID) -> UUID | None:
    return await db.scalar(
        select(CloudTarget.id)
        .where(
            CloudTarget.sandbox_profile_id == sandbox_profile_id,
            CloudTarget.profile_target_role == "primary",
            CloudTarget.archived_at.is_(None),
        )
        .limit(1)
    )
