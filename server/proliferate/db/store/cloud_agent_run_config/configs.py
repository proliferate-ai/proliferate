"""Persistence helpers for cloud agent run configurations."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import and_, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.automations import (
    CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_ORGANIZATION,
    CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_PERSONAL,
    CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_SYSTEM,
    CLOUD_AGENT_RUN_CONFIG_STATUS_ACTIVE,
    CLOUD_AGENT_RUN_CONFIG_STATUS_ARCHIVED,
)
from proliferate.db.models.cloud.agent_run_config import (
    CloudAgentRunConfig,
    CloudAgentRunConfigDefault,
)
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class CloudAgentRunConfigRecord:
    id: UUID
    owner_scope: str
    owner_user_id: UUID | None
    organization_id: UUID | None
    created_by_user_id: UUID
    name: str
    agent_kind: str
    model_id: str
    control_values_json: dict[str, object]
    usable_in_personal_sandboxes: bool
    usable_in_shared_sandboxes: bool
    seed_key: str | None
    system_default_rank: int | None
    status: str
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None


@dataclass(frozen=True)
class CloudAgentRunConfigDefaultRecord:
    id: UUID
    owner_scope: str
    owner_user_id: UUID | None
    organization_id: UUID | None
    agent_kind: str
    config_id: UUID
    created_by_user_id: UUID
    created_at: datetime
    updated_at: datetime


def _config_record(row: CloudAgentRunConfig) -> CloudAgentRunConfigRecord:
    return CloudAgentRunConfigRecord(
        id=row.id,
        owner_scope=row.owner_scope,
        owner_user_id=row.owner_user_id,
        organization_id=row.organization_id,
        created_by_user_id=row.created_by_user_id,
        name=row.name,
        agent_kind=row.agent_kind,
        model_id=row.model_id,
        control_values_json=dict(row.control_values_json or {}),
        usable_in_personal_sandboxes=row.usable_in_personal_sandboxes,
        usable_in_shared_sandboxes=row.usable_in_shared_sandboxes,
        seed_key=row.seed_key,
        system_default_rank=row.system_default_rank,
        status=row.status,
        created_at=row.created_at,
        updated_at=row.updated_at,
        archived_at=row.archived_at,
    )


def _default_record(row: CloudAgentRunConfigDefault) -> CloudAgentRunConfigDefaultRecord:
    return CloudAgentRunConfigDefaultRecord(
        id=row.id,
        owner_scope=row.owner_scope,
        owner_user_id=row.owner_user_id,
        organization_id=row.organization_id,
        agent_kind=row.agent_kind,
        config_id=row.config_id,
        created_by_user_id=row.created_by_user_id,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def create_config(
    db: AsyncSession,
    *,
    owner_scope: str,
    owner_user_id: UUID | None,
    organization_id: UUID | None,
    created_by_user_id: UUID,
    name: str,
    agent_kind: str,
    model_id: str,
    control_values_json: dict[str, object],
    usable_in_personal_sandboxes: bool,
    usable_in_shared_sandboxes: bool,
    seed_key: str | None = None,
    system_default_rank: int | None = None,
) -> CloudAgentRunConfigRecord:
    now = utcnow()
    row = CloudAgentRunConfig(
        owner_scope=owner_scope,
        owner_user_id=owner_user_id,
        organization_id=organization_id,
        created_by_user_id=created_by_user_id,
        name=name,
        agent_kind=agent_kind,
        model_id=model_id,
        control_values_json=control_values_json,
        usable_in_personal_sandboxes=usable_in_personal_sandboxes,
        usable_in_shared_sandboxes=usable_in_shared_sandboxes,
        seed_key=seed_key,
        system_default_rank=system_default_rank,
        status=CLOUD_AGENT_RUN_CONFIG_STATUS_ACTIVE,
        archived_at=None,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    await db.flush()
    return _config_record(row)


async def get_config(
    db: AsyncSession,
    config_id: UUID,
) -> CloudAgentRunConfigRecord | None:
    row = await db.get(CloudAgentRunConfig, config_id)
    return None if row is None else _config_record(row)


async def list_configs(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    organization_id: UUID | None,
    owner_scope: str | None = None,
    agent_kind: str | None = None,
    usable_in: str | None = None,
    status: str | None = CLOUD_AGENT_RUN_CONFIG_STATUS_ACTIVE,
) -> tuple[CloudAgentRunConfigRecord, ...]:
    predicates = [
        or_(
            CloudAgentRunConfig.owner_scope == CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_SYSTEM,
            and_(
                CloudAgentRunConfig.owner_scope == CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_PERSONAL,
                CloudAgentRunConfig.owner_user_id == actor_user_id,
            ),
        )
    ]
    if organization_id is not None:
        predicates[0] = or_(
            predicates[0],
            and_(
                CloudAgentRunConfig.owner_scope == CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_ORGANIZATION,
                CloudAgentRunConfig.organization_id == organization_id,
            ),
        )
    if owner_scope is not None:
        predicates.append(CloudAgentRunConfig.owner_scope == owner_scope)
    if agent_kind is not None:
        predicates.append(CloudAgentRunConfig.agent_kind == agent_kind)
    if usable_in == "personal_sandboxes":
        predicates.append(CloudAgentRunConfig.usable_in_personal_sandboxes.is_(True))
    elif usable_in == "shared_sandboxes":
        predicates.append(CloudAgentRunConfig.usable_in_shared_sandboxes.is_(True))
    if status is not None:
        predicates.append(CloudAgentRunConfig.status == status)

    rows = (
        (
            await db.execute(
                select(CloudAgentRunConfig)
                .where(*predicates)
                .order_by(
                    CloudAgentRunConfig.owner_scope.asc(),
                    CloudAgentRunConfig.agent_kind.asc(),
                    CloudAgentRunConfig.system_default_rank.asc().nullslast(),
                    CloudAgentRunConfig.name.asc(),
                    CloudAgentRunConfig.created_at.asc(),
                )
            )
        )
        .scalars()
        .all()
    )
    return tuple(_config_record(row) for row in rows)


async def update_config(
    db: AsyncSession,
    *,
    config_id: UUID,
    name: str | None = None,
    model_id: str | None = None,
    control_values_json: dict[str, object] | None = None,
    usable_in_personal_sandboxes: bool | None = None,
    usable_in_shared_sandboxes: bool | None = None,
) -> CloudAgentRunConfigRecord | None:
    row = await db.get(CloudAgentRunConfig, config_id)
    if row is None:
        return None
    if name is not None:
        row.name = name
    if model_id is not None:
        row.model_id = model_id
    if control_values_json is not None:
        row.control_values_json = control_values_json
    if usable_in_personal_sandboxes is not None:
        row.usable_in_personal_sandboxes = usable_in_personal_sandboxes
    if usable_in_shared_sandboxes is not None:
        row.usable_in_shared_sandboxes = usable_in_shared_sandboxes
    row.updated_at = utcnow()
    await db.flush()
    return _config_record(row)


async def archive_config(
    db: AsyncSession,
    config_id: UUID,
) -> CloudAgentRunConfigRecord | None:
    row = await db.get(CloudAgentRunConfig, config_id)
    if row is None:
        return None
    now = utcnow()
    row.status = CLOUD_AGENT_RUN_CONFIG_STATUS_ARCHIVED
    row.archived_at = now
    row.updated_at = now
    await db.flush()
    return _config_record(row)


async def upsert_default(
    db: AsyncSession,
    *,
    owner_scope: str,
    owner_user_id: UUID | None,
    organization_id: UUID | None,
    agent_kind: str,
    config_id: UUID,
    created_by_user_id: UUID,
) -> CloudAgentRunConfigDefaultRecord:
    now = utcnow()
    index_elements = (
        [CloudAgentRunConfigDefault.owner_user_id, CloudAgentRunConfigDefault.agent_kind]
        if owner_scope == CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_PERSONAL
        else [CloudAgentRunConfigDefault.organization_id, CloudAgentRunConfigDefault.agent_kind]
    )
    index_where = (
        CloudAgentRunConfigDefault.owner_scope == CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_PERSONAL
        if owner_scope == CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_PERSONAL
        else (
            CloudAgentRunConfigDefault.owner_scope
            == CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_ORGANIZATION
        )
    )
    result = await db.execute(
        pg_insert(CloudAgentRunConfigDefault)
        .values(
            owner_scope=owner_scope,
            owner_user_id=owner_user_id,
            organization_id=organization_id,
            agent_kind=agent_kind,
            config_id=config_id,
            created_by_user_id=created_by_user_id,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_update(
            index_elements=index_elements,
            index_where=index_where,
            set_={
                "config_id": config_id,
                "created_by_user_id": created_by_user_id,
                "updated_at": now,
            },
        )
        .returning(CloudAgentRunConfigDefault)
    )
    row = result.scalar_one()
    return _default_record(row)


async def list_defaults(
    db: AsyncSession,
    *,
    owner_scope: str,
    owner_user_id: UUID | None,
    organization_id: UUID | None,
) -> tuple[CloudAgentRunConfigDefaultRecord, ...]:
    predicates = [CloudAgentRunConfigDefault.owner_scope == owner_scope]
    if owner_scope == CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_PERSONAL:
        predicates.append(CloudAgentRunConfigDefault.owner_user_id == owner_user_id)
    else:
        predicates.append(CloudAgentRunConfigDefault.organization_id == organization_id)
    rows = (
        (
            await db.execute(
                select(CloudAgentRunConfigDefault)
                .where(*predicates)
                .order_by(CloudAgentRunConfigDefault.agent_kind.asc())
            )
        )
        .scalars()
        .all()
    )
    return tuple(_default_record(row) for row in rows)


async def get_default_config(
    db: AsyncSession,
    *,
    owner_scope: str,
    owner_user_id: UUID | None,
    organization_id: UUID | None,
    agent_kind: str,
) -> CloudAgentRunConfigRecord | None:
    predicates = [
        CloudAgentRunConfigDefault.owner_scope == owner_scope,
        CloudAgentRunConfigDefault.agent_kind == agent_kind,
    ]
    if owner_scope == CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_PERSONAL:
        predicates.append(CloudAgentRunConfigDefault.owner_user_id == owner_user_id)
        predicates.append(
            or_(
                CloudAgentRunConfig.owner_scope == CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_SYSTEM,
                and_(
                    CloudAgentRunConfig.owner_scope == CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_PERSONAL,
                    CloudAgentRunConfig.owner_user_id == owner_user_id,
                ),
            )
        )
    else:
        predicates.append(CloudAgentRunConfigDefault.organization_id == organization_id)
        predicates.append(
            or_(
                CloudAgentRunConfig.owner_scope == CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_SYSTEM,
                and_(
                    CloudAgentRunConfig.owner_scope
                    == CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_ORGANIZATION,
                    CloudAgentRunConfig.organization_id == organization_id,
                ),
            )
        )
    row = (
        await db.execute(
            select(CloudAgentRunConfig)
            .join(
                CloudAgentRunConfigDefault,
                CloudAgentRunConfigDefault.config_id == CloudAgentRunConfig.id,
            )
            .where(*predicates, CloudAgentRunConfig.status == CLOUD_AGENT_RUN_CONFIG_STATUS_ACTIVE)
        )
    ).scalar_one_or_none()
    if row is not None:
        return _config_record(row)
    return await get_system_fallback_config(db, agent_kind=agent_kind)


async def get_system_fallback_config(
    db: AsyncSession,
    *,
    agent_kind: str,
) -> CloudAgentRunConfigRecord | None:
    row = (
        await db.execute(
            select(CloudAgentRunConfig)
            .where(
                CloudAgentRunConfig.owner_scope == CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_SYSTEM,
                CloudAgentRunConfig.agent_kind == agent_kind,
                CloudAgentRunConfig.status == CLOUD_AGENT_RUN_CONFIG_STATUS_ACTIVE,
            )
            .order_by(
                CloudAgentRunConfig.system_default_rank.asc().nullslast(),
                CloudAgentRunConfig.seed_key.asc(),
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    return None if row is None else _config_record(row)
