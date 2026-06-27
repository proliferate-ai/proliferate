from __future__ import annotations

import uuid
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.integrations import CloudIntegrationDefinition
from proliferate.db.store.cloud_integrations.types import IntegrationDefinitionRecord
from proliferate.utils.time import utcnow


def _definition_record(row: CloudIntegrationDefinition) -> IntegrationDefinitionRecord:
    return IntegrationDefinitionRecord(
        id=row.id,
        key=row.key,
        source=row.source,
        organization_id=row.organization_id,
        created_by_user_id=row.created_by_user_id,
        source_version=row.source_version,
        content_hash=row.content_hash,
        display_name=row.display_name,
        namespace=row.namespace,
        provider_group=row.provider_group,
        transport=row.transport,
        implementation=row.implementation,
        config_json=row.config_json,
        enabled_by_default=row.enabled_by_default,
        archived_at=row.archived_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def upsert_seed_definition(
    db: AsyncSession,
    *,
    key: str,
    source_version: int,
    content_hash: str,
    display_name: str,
    namespace: str,
    provider_group: str | None,
    transport: str,
    implementation: str,
    config_json: str,
    enabled_by_default: bool,
) -> IntegrationDefinitionRecord:
    now = utcnow()
    insert_values = {
        "id": uuid.uuid4(),
        "key": key,
        "source": "seed",
        "organization_id": None,
        "created_by_user_id": None,
        "source_version": source_version,
        "content_hash": content_hash,
        "display_name": display_name,
        "namespace": namespace,
        "provider_group": provider_group,
        "transport": transport,
        "implementation": implementation,
        "config_json": config_json,
        "enabled_by_default": enabled_by_default,
        "archived_at": None,
        "created_at": now,
        "updated_at": now,
    }
    update_values = {
        "source_version": source_version,
        "content_hash": content_hash,
        "display_name": display_name,
        "namespace": namespace,
        "provider_group": provider_group,
        "transport": transport,
        "implementation": implementation,
        "config_json": config_json,
        "enabled_by_default": enabled_by_default,
        "archived_at": None,
        "updated_at": now,
    }
    stmt = (
        postgresql_insert(CloudIntegrationDefinition)
        .values(**insert_values)
        .on_conflict_do_update(
            index_elements=[CloudIntegrationDefinition.key],
            index_where=text("source = 'seed'"),
            set_=update_values,
        )
        .returning(CloudIntegrationDefinition.id)
    )
    row_id = (await db.execute(stmt)).scalar_one()
    row = await db.get(CloudIntegrationDefinition, row_id)
    if row is None:
        raise RuntimeError(f"Seed integration definition upsert did not return row {row_id}")
    return _definition_record(row)


async def archive_missing_seed_definitions(
    db: AsyncSession,
    *,
    active_keys: set[str],
) -> int:
    rows = (
        (
            await db.execute(
                select(CloudIntegrationDefinition).where(
                    CloudIntegrationDefinition.source == "seed",
                    CloudIntegrationDefinition.archived_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    now = utcnow()
    count = 0
    for row in rows:
        if row.key not in active_keys:
            row.archived_at = now
            row.updated_at = now
            count += 1
    await db.flush()
    return count


async def create_org_custom_definition(
    db: AsyncSession,
    *,
    organization_id: UUID,
    created_by_user_id: UUID,
    key: str,
    content_hash: str,
    display_name: str,
    namespace: str,
    config_json: str,
) -> IntegrationDefinitionRecord:
    now = utcnow()
    row = CloudIntegrationDefinition(
        key=key,
        source="org_custom",
        organization_id=organization_id,
        created_by_user_id=created_by_user_id,
        source_version=1,
        content_hash=content_hash,
        display_name=display_name,
        namespace=namespace,
        provider_group=None,
        transport="http",
        implementation="upstream_mcp",
        config_json=config_json,
        enabled_by_default=True,
        archived_at=None,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    await db.flush()
    await db.refresh(row)
    return _definition_record(row)


async def list_visible_definitions(
    db: AsyncSession,
    *,
    organization_id: UUID | None = None,
    include_archived: bool = False,
) -> tuple[IntegrationDefinitionRecord, ...]:
    query = select(CloudIntegrationDefinition).where(
        (CloudIntegrationDefinition.source == "seed")
        | (CloudIntegrationDefinition.organization_id == organization_id)
    )
    if not include_archived:
        query = query.where(CloudIntegrationDefinition.archived_at.is_(None))
    rows = (
        await db.execute(query.order_by(CloudIntegrationDefinition.display_name.asc()))
    ).scalars()
    return tuple(_definition_record(row) for row in rows.all())


async def get_definition(
    db: AsyncSession,
    definition_id: UUID,
) -> IntegrationDefinitionRecord | None:
    row = await db.get(CloudIntegrationDefinition, definition_id)
    return _definition_record(row) if row is not None else None


async def get_definition_by_key(
    db: AsyncSession,
    *,
    key: str,
    organization_id: UUID | None = None,
) -> IntegrationDefinitionRecord | None:
    query = select(CloudIntegrationDefinition).where(
        CloudIntegrationDefinition.key == key,
        CloudIntegrationDefinition.archived_at.is_(None),
    )
    if organization_id is None:
        query = query.where(CloudIntegrationDefinition.source == "seed")
    else:
        query = query.where(
            (CloudIntegrationDefinition.source == "seed")
            | (CloudIntegrationDefinition.organization_id == organization_id)
        )
    row = (
        await db.execute(query.order_by(CloudIntegrationDefinition.source.asc()))
    ).scalars().first()
    return _definition_record(row) if row is not None else None
