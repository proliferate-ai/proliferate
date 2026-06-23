"""Application service for managed cloud sandbox profiles."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import ActorIdentity
from proliferate.db.store import cloud_sandbox_profiles as profile_store
from proliferate.db.store import cloud_sandboxes as sandbox_store
from proliferate.db.store import organizations as organizations_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.targets.domain.policy import require_target_admin_membership


@dataclass(frozen=True)
class SandboxProfileTargetState:
    profile: profile_store.SandboxProfileSnapshot
    target: targets_store.CloudTargetSnapshot | None
    sandbox: sandbox_store.CloudSandboxSnapshot | None
    runtime_access: targets_store.CloudTargetRuntimeAccessSnapshot | None

    @property
    def target_ready(self) -> bool:
        return (
            self.profile.status == "active"
            and self.target is not None
            and self.target.status == "online"
        )

    @property
    def sandbox_ready(self) -> bool:
        return self.sandbox is not None and self.sandbox.status in {"running", "paused"}

    @property
    def runtime_access_ready(self) -> bool:
        return (
            self.sandbox is not None
            and self.runtime_access is not None
            and bool(self.runtime_access.anyharness_base_url)
            and bool(self.runtime_access.runtime_token_ciphertext)
            and bool(self.runtime_access.anyharness_data_key_ciphertext)
            and self.runtime_access.cloud_sandbox_id == self.sandbox.id
        )

    @property
    def ready(self) -> bool:
        return self.target_ready and self.sandbox_ready and self.runtime_access_ready


async def ensure_personal(
    db: AsyncSession,
    *,
    user: ActorIdentity,
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
    user: ActorIdentity,
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


async def get_profile(
    db: AsyncSession,
    *,
    user: ActorIdentity,
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
    user: ActorIdentity,
    sandbox_profile_id: UUID,
) -> SandboxProfileTargetState:
    profile = await get_profile(db, user=user, sandbox_profile_id=sandbox_profile_id)
    target = await targets_store.ensure_primary_profile_target(
        db,
        sandbox_profile_id=profile.id,
        created_by_user_id=user.id,
    )
    await sandbox_store.ensure_managed_sandbox_for_target(
        db,
        sandbox_profile_id=profile.id,
        target_id=target.id,
        billing_subject_id=profile.billing_subject_id,
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
    user: ActorIdentity,
    sandbox_profile_id: UUID,
) -> SandboxProfileTargetState:
    profile = await get_profile(db, user=user, sandbox_profile_id=sandbox_profile_id)
    target = (
        await targets_store.get_target_by_id(db, profile.primary_target_id)
        if profile.primary_target_id is not None
        else None
    )
    sandbox = None
    runtime_access = None
    if target is not None:
        sandbox = await sandbox_store.load_active_sandbox_for_profile_target(
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
        sandbox=sandbox,
        runtime_access=runtime_access,
    )


async def _require_profile_access(
    db: AsyncSession,
    *,
    user: ActorIdentity,
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
