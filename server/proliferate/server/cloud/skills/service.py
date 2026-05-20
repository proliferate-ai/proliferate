from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import cloud_sandbox_profiles as sandbox_profile_store
from proliferate.db.store.cloud_skills.configured_items import (
    CloudSkillConfiguredItemSnapshot,
    delete_skill_item,
    get_skill_item,
    list_skills_for_user,
    patch_skill_item,
    upsert_personal_skill_item,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.skills.models import (
    CreateSkillConfiguredItemRequest,
    PatchSkillConfiguredItemRequest,
)


async def list_configured_skills(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> tuple[CloudSkillConfiguredItemSnapshot, ...]:
    return await list_skills_for_user(db, user_id)


async def create_configured_skill(
    db: AsyncSession,
    *,
    user_id: UUID,
    body: CreateSkillConfiguredItemRequest,
) -> CloudSkillConfiguredItemSnapshot:
    if body.skill_source_kind not in {"catalog", "plugin", "user"}:
        raise CloudApiError(
            "skill_source_kind_invalid",
            "Skill source kind is invalid.",
            status_code=400,
        )
    item = await upsert_personal_skill_item(
        db,
        owner_user_id=user_id,
        skill_source_kind=body.skill_source_kind,
        skill_id=body.skill_id,
        skill_version=body.skill_version,
        plugin_id=body.plugin_id,
        plugin_version=body.plugin_version,
        enabled=body.enabled,
    )
    await _refresh_personal_runtime_config(db, user_id=user_id, reason="skill_created")
    return item


async def patch_configured_skill(
    db: AsyncSession,
    *,
    user_id: UUID,
    item_id: UUID,
    body: PatchSkillConfiguredItemRequest,
) -> CloudSkillConfiguredItemSnapshot:
    existing = await get_skill_item(db, item_id=item_id)
    if existing is None or existing.owner_user_id != user_id:
        raise CloudApiError("skill_not_found", "Skill was not found.", status_code=404)
    item = await patch_skill_item(
        db,
        item_id=item_id,
        enabled=body.enabled,
        public_to_org=body.public_to_org,
        public_organization_id=(
            body.public_organization_id
            if body.public_to_org
            else None
            if body.public_to_org is False
            else existing.public_organization_id
        ),
        public_status=(
            "public"
            if body.public_to_org
            else "private"
            if body.public_to_org is not None
            else None
        ),
        public_updated_by_user_id=user_id if body.public_to_org is not None else None,
    )
    if item is None:
        raise CloudApiError("skill_not_found", "Skill was not found.", status_code=404)
    await _refresh_personal_runtime_config(db, user_id=user_id, reason="skill_updated")
    return item


async def delete_configured_skill(
    db: AsyncSession,
    *,
    user_id: UUID,
    item_id: UUID,
) -> None:
    existing = await get_skill_item(db, item_id=item_id)
    if existing is None or existing.owner_user_id != user_id:
        raise CloudApiError("skill_not_found", "Skill was not found.", status_code=404)
    await delete_skill_item(db, item_id=item_id)
    await _refresh_personal_runtime_config(db, user_id=user_id, reason="skill_deleted")


async def _refresh_personal_runtime_config(
    db: AsyncSession,
    *,
    user_id: UUID,
    reason: str,
) -> None:
    from proliferate.server.cloud.runtime_config.service import (  # noqa: PLC0415
        refresh_profile_runtime_config,
    )

    profile = await sandbox_profile_store.ensure_personal_sandbox_profile(
        db,
        user_id=user_id,
        created_by_user_id=user_id,
    )
    await refresh_profile_runtime_config(
        db,
        sandbox_profile_id=profile.id,
        actor_user_id=user_id,
        reason=reason,
    )
