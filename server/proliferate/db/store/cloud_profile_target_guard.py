"""Shared service invariants for managed sandbox profile targets."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.agent_auth import SandboxProfile
from proliferate.db.models.cloud.targets import CloudTarget


class ProfileTargetInvariantError(RuntimeError):
    """Raised when a target is not the primary managed target for a profile."""


def managed_profile_target_requires_slot(
    *,
    kind: str,
    sandbox_profile_id: UUID | None,
    profile_target_role: str,
) -> bool:
    return (
        kind == "managed_cloud"
        and sandbox_profile_id is not None
        and profile_target_role == "primary"
    )


async def require_primary_managed_profile_target(
    db: AsyncSession,
    *,
    sandbox_profile_id: UUID,
    target_id: UUID,
    lock_rows: bool = False,
) -> tuple[SandboxProfile, CloudTarget]:
    profile_stmt = select(SandboxProfile).where(
        SandboxProfile.id == sandbox_profile_id,
        SandboxProfile.archived_at.is_(None),
    )
    target_stmt = select(CloudTarget).where(
        CloudTarget.id == target_id,
        CloudTarget.archived_at.is_(None),
    )
    if lock_rows:
        profile_stmt = profile_stmt.with_for_update()
        target_stmt = target_stmt.with_for_update()
    profile = (await db.execute(profile_stmt)).scalar_one_or_none()
    target = (await db.execute(target_stmt)).scalar_one_or_none()
    if profile is None:
        raise ProfileTargetInvariantError("Sandbox profile not found.")
    if target is None:
        raise ProfileTargetInvariantError("Cloud target not found.")
    if target.sandbox_profile_id != profile.id:
        raise ProfileTargetInvariantError("Cloud target is not attached to sandbox profile.")
    if target.profile_target_role != "primary":
        raise ProfileTargetInvariantError(
            "Cloud target is not the primary sandbox profile target."
        )
    if target.kind != "managed_cloud":
        raise ProfileTargetInvariantError("Sandbox profile target must be managed_cloud.")
    if profile.owner_scope != target.owner_scope:
        raise ProfileTargetInvariantError("Sandbox profile target owner scope mismatch.")
    if profile.owner_scope == "personal":
        if (
            profile.owner_user_id is None
            or target.owner_user_id != profile.owner_user_id
            or target.organization_id is not None
        ):
            raise ProfileTargetInvariantError("Personal sandbox profile target owner mismatch.")
    elif (
        profile.organization_id is None
        or target.organization_id != profile.organization_id
        or target.owner_user_id is not None
    ):
        raise ProfileTargetInvariantError("Organization sandbox profile target owner mismatch.")
    return profile, target
