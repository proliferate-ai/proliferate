"""Application service for managed cloud sandbox profiles."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import User
from proliferate.db.store import cloud_sandbox_profiles as profile_store
from proliferate.db.store import cloud_sandboxes as slot_store
from proliferate.db.store import organizations as organizations_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.targets.domain.policy import require_target_admin_membership


@dataclass(frozen=True)
class SandboxProfileTargetState:
    profile: profile_store.SandboxProfileSnapshot
    target: targets_store.CloudTargetSnapshot | None
    slot: slot_store.SlotSnapshot | None
    runtime_access: targets_store.CloudTargetRuntimeAccessSnapshot | None

    @property
    def ready(self) -> bool:
        return (
            self.profile.status == "active"
            and self.target is not None
            and self.target.status == "online"
            and self.slot is not None
            and self.slot.status in {"running", "paused"}
            and self.runtime_access is not None
            and self.runtime_access.active_sandbox_id == self.slot.id
            and self.runtime_access.slot_generation == self.slot.slot_generation
            and bool(self.runtime_access.anyharness_base_url)
            and bool(self.runtime_access.runtime_token_ciphertext)
            and bool(self.runtime_access.anyharness_data_key_ciphertext)
        )


async def ensure_personal(
    db: AsyncSession,
    *,
    user: User,
) -> profile_store.SandboxProfileSnapshot:
    profile = await profile_store.ensure_personal_sandbox_profile(
        db,
        user_id=user.id,
        created_by_user_id=user.id,
    )
    target = await targets_store.ensure_primary_profile_target(
        db,
        sandbox_profile_id=profile.id,
        created_by_user_id=user.id,
    )
    refreshed = await profile_store.load_sandbox_profile_by_id(db, profile.id)
    if refreshed is None:
        raise CloudApiError(
            "sandbox_profile_not_found",
            "Sandbox profile was not created.",
            status_code=500,
        )
    return profile_store.SandboxProfileSnapshot(
        **{
            **refreshed.__dict__,
            "primary_target_id": target.id,
        }
    )


async def ensure_organization(
    db: AsyncSession,
    *,
    user: User,
    organization_id: UUID,
) -> profile_store.SandboxProfileSnapshot:
    membership = await organizations_store.get_active_membership(
        db,
        organization_id=organization_id,
        user_id=user.id,
    )
    require_target_admin_membership(membership)
    profile = await profile_store.ensure_organization_sandbox_profile(
        db,
        organization_id=organization_id,
        created_by_user_id=user.id,
    )
    target = await targets_store.ensure_primary_profile_target(
        db,
        sandbox_profile_id=profile.id,
        created_by_user_id=user.id,
    )
    refreshed = await profile_store.load_sandbox_profile_by_id(db, profile.id)
    if refreshed is None:
        raise CloudApiError(
            "sandbox_profile_not_found",
            "Sandbox profile was not created.",
            status_code=500,
        )
    return profile_store.SandboxProfileSnapshot(
        **{
            **refreshed.__dict__,
            "primary_target_id": target.id,
        }
    )


async def ensure_organization_for_activation(
    db: AsyncSession,
    *,
    created_by_user_id: UUID,
    organization_id: UUID,
) -> profile_store.SandboxProfileSnapshot:
    profile = await profile_store.ensure_organization_sandbox_profile(
        db,
        organization_id=organization_id,
        created_by_user_id=created_by_user_id,
    )
    target = await targets_store.ensure_primary_profile_target(
        db,
        sandbox_profile_id=profile.id,
        created_by_user_id=created_by_user_id,
    )
    refreshed = await profile_store.load_sandbox_profile_by_id(db, profile.id)
    if refreshed is None:
        raise CloudApiError(
            "sandbox_profile_not_found",
            "Sandbox profile was not created.",
            status_code=500,
        )
    return profile_store.SandboxProfileSnapshot(
        **{
            **refreshed.__dict__,
            "primary_target_id": target.id,
        }
    )


async def get_profile(
    db: AsyncSession,
    *,
    user: User,
    sandbox_profile_id: UUID,
) -> profile_store.SandboxProfileSnapshot:
    profile = await profile_store.load_sandbox_profile_by_id(db, sandbox_profile_id)
    if profile is None:
        raise CloudApiError(
            "sandbox_profile_not_found",
            "Sandbox profile not found.",
            status_code=404,
        )
    await _require_profile_access(db, user=user, profile=profile)
    return profile


async def enable_cloud(
    db: AsyncSession,
    *,
    user: User,
    sandbox_profile_id: UUID,
) -> SandboxProfileTargetState:
    profile = await get_profile(db, user=user, sandbox_profile_id=sandbox_profile_id)
    target = await targets_store.ensure_primary_profile_target(
        db,
        sandbox_profile_id=profile.id,
        created_by_user_id=user.id,
    )
    await slot_store.ensure_profile_slot(
        db,
        sandbox_profile_id=profile.id,
        target_id=target.id,
    )
    refreshed = await profile_store.load_sandbox_profile_by_id(db, profile.id)
    if refreshed is None:
        raise CloudApiError(
            "sandbox_profile_not_found",
            "Sandbox profile not found.",
            status_code=404,
        )
    return await get_target_state(db, user=user, sandbox_profile_id=refreshed.id)


async def get_target_state(
    db: AsyncSession,
    *,
    user: User,
    sandbox_profile_id: UUID,
) -> SandboxProfileTargetState:
    profile = await get_profile(db, user=user, sandbox_profile_id=sandbox_profile_id)
    target = (
        await targets_store.get_target_by_id(db, profile.primary_target_id)
        if profile.primary_target_id is not None
        else None
    )
    slot = None
    runtime_access = None
    if target is not None:
        slot = await slot_store.load_active_slot_for_profile_target(
            db,
            sandbox_profile_id=profile.id,
            target_id=target.id,
        )
        runtime_access = await targets_store.load_active_runtime_access_for_target(
            db,
            target_id=target.id,
        )
    return SandboxProfileTargetState(
        profile=profile,
        target=target,
        slot=slot,
        runtime_access=runtime_access,
    )


async def _require_profile_access(
    db: AsyncSession,
    *,
    user: User,
    profile: profile_store.SandboxProfileSnapshot,
) -> None:
    if profile.owner_scope == "personal":
        if profile.owner_user_id != user.id:
            raise CloudApiError(
                "sandbox_profile_not_found",
                "Sandbox profile not found.",
                status_code=404,
            )
        return
    if profile.organization_id is None:
        raise CloudApiError(
            "sandbox_profile_not_found",
            "Sandbox profile not found.",
            status_code=404,
        )
    membership = await organizations_store.get_active_membership(
        db,
        organization_id=profile.organization_id,
        user_id=user.id,
    )
    require_target_admin_membership(membership)
