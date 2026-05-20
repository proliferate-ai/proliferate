from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.skills import CloudSkillConfiguredItem
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class CloudSkillConfiguredItemSnapshot:
    id: UUID
    owner_scope: str
    owner_user_id: UUID | None
    organization_id: UUID | None
    skill_source_kind: str
    skill_id: str
    skill_version: str | None
    plugin_id: str
    plugin_version: str | None
    enabled: bool
    public_to_org: bool
    public_organization_id: UUID | None
    public_status: str
    public_updated_at: datetime | None
    public_updated_by_user_id: UUID | None
    user_skill_payload_ref: str | None
    source_snapshot_json: str | None
    config_version: int
    created_at: datetime
    updated_at: datetime


def _snapshot(row: CloudSkillConfiguredItem) -> CloudSkillConfiguredItemSnapshot:
    return CloudSkillConfiguredItemSnapshot(
        id=row.id,
        owner_scope=row.owner_scope,
        owner_user_id=row.owner_user_id,
        organization_id=row.organization_id,
        skill_source_kind=row.skill_source_kind,
        skill_id=row.skill_id,
        skill_version=row.skill_version,
        plugin_id=row.plugin_id,
        plugin_version=row.plugin_version,
        enabled=row.enabled,
        public_to_org=row.public_to_org,
        public_organization_id=row.public_organization_id,
        public_status=row.public_status,
        public_updated_at=row.public_updated_at,
        public_updated_by_user_id=row.public_updated_by_user_id,
        user_skill_payload_ref=row.user_skill_payload_ref,
        source_snapshot_json=row.source_snapshot_json,
        config_version=row.config_version,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def upsert_personal_skill_item(
    db: AsyncSession,
    *,
    owner_user_id: UUID,
    skill_source_kind: str,
    skill_id: str,
    plugin_id: str = "",
    skill_version: str | None = None,
    plugin_version: str | None = None,
    enabled: bool = True,
    source_snapshot_json: str | None = None,
) -> CloudSkillConfiguredItemSnapshot:
    now = utcnow()
    values = {
        "owner_scope": "personal",
        "owner_user_id": owner_user_id,
        "organization_id": None,
        "skill_source_kind": skill_source_kind,
        "skill_id": skill_id,
        "skill_version": skill_version,
        "plugin_id": plugin_id,
        "plugin_version": plugin_version,
        "enabled": enabled,
        "public_to_org": False,
        "public_organization_id": None,
        "public_status": "private",
        "source_snapshot_json": source_snapshot_json,
        "config_version": 1,
        "created_at": now,
        "updated_at": now,
    }
    await db.execute(
        pg_insert(CloudSkillConfiguredItem)
        .values(**values)
        .on_conflict_do_nothing(
            index_elements=[
                CloudSkillConfiguredItem.owner_user_id,
                CloudSkillConfiguredItem.skill_source_kind,
                CloudSkillConfiguredItem.skill_id,
                CloudSkillConfiguredItem.plugin_id,
            ],
            index_where=CloudSkillConfiguredItem.owner_scope == "personal",
        )
    )
    row = (
        await db.execute(
            select(CloudSkillConfiguredItem)
            .where(
                CloudSkillConfiguredItem.owner_scope == "personal",
                CloudSkillConfiguredItem.owner_user_id == owner_user_id,
                CloudSkillConfiguredItem.skill_source_kind == skill_source_kind,
                CloudSkillConfiguredItem.skill_id == skill_id,
                CloudSkillConfiguredItem.plugin_id == plugin_id,
            )
            .with_for_update()
        )
    ).scalar_one()
    row.skill_version = skill_version
    row.plugin_version = plugin_version
    row.enabled = enabled
    row.source_snapshot_json = source_snapshot_json
    row.config_version += 1
    row.updated_at = now
    await db.flush()
    return _snapshot(row)


async def patch_skill_item(
    db: AsyncSession,
    *,
    item_id: UUID,
    enabled: bool | None = None,
    public_to_org: bool | None = None,
    public_organization_id: UUID | None = None,
    public_status: str | None = None,
    public_updated_by_user_id: UUID | None = None,
) -> CloudSkillConfiguredItemSnapshot | None:
    row = await db.get(CloudSkillConfiguredItem, item_id)
    if row is None:
        return None
    changed = False
    if enabled is not None and row.enabled != enabled:
        row.enabled = enabled
        changed = True
    if public_to_org is not None and row.public_to_org != public_to_org:
        row.public_to_org = public_to_org
        changed = True
    if public_organization_id != row.public_organization_id:
        row.public_organization_id = public_organization_id
        changed = True
    if public_status is not None and row.public_status != public_status:
        row.public_status = public_status
        changed = True
    if public_updated_by_user_id != row.public_updated_by_user_id:
        row.public_updated_by_user_id = public_updated_by_user_id
        changed = True
    if changed:
        if public_to_org is not None or public_status is not None:
            row.public_updated_at = utcnow()
        row.config_version += 1
        row.updated_at = utcnow()
    await db.flush()
    return _snapshot(row)


async def delete_skill_item(db: AsyncSession, *, item_id: UUID) -> bool:
    row = await db.get(CloudSkillConfiguredItem, item_id)
    if row is None:
        return False
    await db.delete(row)
    await db.flush()
    return True


async def get_skill_item(
    db: AsyncSession,
    *,
    item_id: UUID,
) -> CloudSkillConfiguredItemSnapshot | None:
    row = await db.get(CloudSkillConfiguredItem, item_id)
    return _snapshot(row) if row is not None else None


async def list_skills_for_user(
    db: AsyncSession,
    user_id: UUID,
) -> tuple[CloudSkillConfiguredItemSnapshot, ...]:
    rows = (
        (
            await db.execute(
                select(CloudSkillConfiguredItem)
                .where(
                    CloudSkillConfiguredItem.owner_scope == "personal",
                    CloudSkillConfiguredItem.owner_user_id == user_id,
                )
                .order_by(CloudSkillConfiguredItem.updated_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return tuple(_snapshot(row) for row in rows)


async def list_enabled_skills_for_personal_profile(
    db: AsyncSession,
    user_id: UUID,
) -> tuple[CloudSkillConfiguredItemSnapshot, ...]:
    rows = (
        (
            await db.execute(
                select(CloudSkillConfiguredItem)
                .where(
                    CloudSkillConfiguredItem.owner_scope == "personal",
                    CloudSkillConfiguredItem.owner_user_id == user_id,
                    CloudSkillConfiguredItem.enabled.is_(True),
                )
                .order_by(CloudSkillConfiguredItem.updated_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return tuple(_snapshot(row) for row in rows)


async def list_enabled_skills_for_organization_profile(
    db: AsyncSession,
    organization_id: UUID,
) -> tuple[CloudSkillConfiguredItemSnapshot, ...]:
    rows = (
        (
            await db.execute(
                select(CloudSkillConfiguredItem)
                .where(
                    CloudSkillConfiguredItem.enabled.is_(True),
                    or_(
                        (
                            (CloudSkillConfiguredItem.owner_scope == "organization")
                            & (CloudSkillConfiguredItem.organization_id == organization_id)
                        ),
                        (
                            (CloudSkillConfiguredItem.public_to_org.is_(True))
                            & (CloudSkillConfiguredItem.public_organization_id == organization_id)
                            & (CloudSkillConfiguredItem.public_status == "public")
                        ),
                    ),
                )
                .order_by(CloudSkillConfiguredItem.updated_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return tuple(_snapshot(row) for row in rows)
