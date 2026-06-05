"""Cloud agent-auth profiles store operations."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.agent_auth_profiles import (
    SandboxProfile,
    SandboxProfileAgentAuthRevision,
)
from proliferate.db.models.cloud.targets import CloudTarget
from proliferate.db.store.billing_subjects import (
    ensure_organization_billing_subject,
    ensure_personal_billing_subject,
)
from proliferate.db.store.cloud_agent_auth.mappers import (
    _profile_record,
)
from proliferate.db.store.cloud_agent_auth.records import (
    SandboxProfileRecord,
)
from proliferate.utils.time import utcnow

_UNSET = object()


async def get_sandbox_profile(
    db: AsyncSession,
    sandbox_profile_id: UUID,
) -> SandboxProfileRecord | None:
    row = await db.get(SandboxProfile, sandbox_profile_id)
    if row is None or row.archived_at is not None:
        return None
    return _profile_record(
        row,
        primary_target_id=await _load_primary_target_id(db, row.id),
    )


async def get_active_personal_sandbox_profile_for_user(
    db: AsyncSession,
    user_id: UUID,
) -> SandboxProfileRecord | None:
    row = (
        await db.execute(
            select(SandboxProfile).where(
                SandboxProfile.owner_scope == "personal",
                SandboxProfile.owner_user_id == user_id,
                SandboxProfile.archived_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    return _profile_record(
        row,
        primary_target_id=await _load_primary_target_id(db, row.id),
    )


async def ensure_personal_sandbox_profile(
    db: AsyncSession,
    *,
    user_id: UUID,
    created_by_user_id: UUID | None = None,
) -> SandboxProfileRecord:
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
    ).scalar_one_or_none()
    now = utcnow()
    if row is None:
        billing_subject = await ensure_personal_billing_subject(db, user_id)
        row = SandboxProfile(
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
        db.add(row)
        await db.flush()
    return _profile_record(
        row,
        primary_target_id=await _load_primary_target_id(db, row.id),
    )


async def ensure_organization_sandbox_profile(
    db: AsyncSession,
    *,
    organization_id: UUID,
    created_by_user_id: UUID | None = None,
) -> SandboxProfileRecord:
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
    ).scalar_one_or_none()
    now = utcnow()
    if row is None:
        billing_subject = await ensure_organization_billing_subject(db, organization_id)
        row = SandboxProfile(
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
        db.add(row)
        await db.flush()
    return _profile_record(
        row,
        primary_target_id=await _load_primary_target_id(db, row.id),
    )


async def bump_sandbox_profile_agent_auth_revision(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    reason: str,
    actor_user_id: UUID | None,
    force_restart: bool,
) -> SandboxProfileRecord | None:
    row = (
        await db.execute(
            select(SandboxProfile)
            .where(
                SandboxProfile.id == sandbox_profile_id,
                SandboxProfile.archived_at.is_(None),
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    now = utcnow()
    row.desired_agent_auth_revision += 1
    row.updated_at = now
    db.add(
        SandboxProfileAgentAuthRevision(
            sandbox_profile_id=row.id,
            revision=row.desired_agent_auth_revision,
            reason=reason,
            force_restart=force_restart,
            created_by_user_id=actor_user_id,
            created_at=now,
        )
    )
    await db.flush()
    return _profile_record(
        row,
        primary_target_id=await _load_primary_target_id(db, row.id),
    )


async def _load_primary_target_id(db: AsyncSession, sandbox_profile_id: UUID) -> UUID | None:
    return await db.scalar(
        select(CloudTarget.id)
        .where(
            CloudTarget.sandbox_profile_id == sandbox_profile_id,
            CloudTarget.profile_target_role == "primary",
            CloudTarget.archived_at.is_(None),
        )
        .limit(1)
    )
