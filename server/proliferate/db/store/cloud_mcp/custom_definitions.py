from __future__ import annotations

import uuid
from uuid import UUID

from sqlalchemy import select

from proliferate.db import engine as db_engine
from proliferate.db.models.cloud import CloudMcpCustomDefinition
from proliferate.db.store.cloud_mcp.types import CloudMcpCustomDefinitionRecord
from proliferate.utils.time import utcnow


def _record(definition: CloudMcpCustomDefinition) -> CloudMcpCustomDefinitionRecord:
    return CloudMcpCustomDefinitionRecord(
        id=definition.id,
        user_id=definition.user_id,
        definition_id=definition.definition_id,
        version=definition.version,
        name=definition.name,
        description=definition.description,
        transport=definition.transport,
        auth_kind=definition.auth_kind,
        availability=definition.availability,
        template_json=definition.template_json,
        enabled=definition.enabled,
        deleted_at=definition.deleted_at,
        created_at=definition.created_at,
        updated_at=definition.updated_at,
    )


async def list_custom_definitions(
    user_id: UUID,
    *,
    include_deleted: bool = True,
) -> list[CloudMcpCustomDefinitionRecord]:
    async with db_engine.async_session_factory() as db:
        query = select(CloudMcpCustomDefinition).where(
            CloudMcpCustomDefinition.user_id == user_id
        )
        if not include_deleted:
            query = query.where(CloudMcpCustomDefinition.deleted_at.is_(None))
        records = (
            (await db.execute(query.order_by(CloudMcpCustomDefinition.updated_at.desc())))
            .scalars()
            .all()
        )
        return [_record(record) for record in records]


async def get_custom_definition(
    user_id: UUID,
    definition_id: str,
) -> CloudMcpCustomDefinitionRecord | None:
    async with db_engine.async_session_factory() as db:
        record = (
            await db.execute(
                select(CloudMcpCustomDefinition).where(
                    CloudMcpCustomDefinition.user_id == user_id,
                    CloudMcpCustomDefinition.definition_id == definition_id,
                )
            )
        ).scalar_one_or_none()
        return _record(record) if record is not None else None


async def get_custom_definition_by_db_id(
    user_id: UUID,
    definition_db_id: UUID,
) -> CloudMcpCustomDefinitionRecord | None:
    async with db_engine.async_session_factory() as db:
        record = (
            await db.execute(
                select(CloudMcpCustomDefinition).where(
                    CloudMcpCustomDefinition.user_id == user_id,
                    CloudMcpCustomDefinition.id == definition_db_id,
                )
            )
        ).scalar_one_or_none()
        return _record(record) if record is not None else None


async def list_custom_definitions_by_db_ids(
    user_id: UUID,
    definition_db_ids: set[UUID],
) -> list[CloudMcpCustomDefinitionRecord]:
    if not definition_db_ids:
        return []
    async with db_engine.async_session_factory() as db:
        records = (
            (
                await db.execute(
                    select(CloudMcpCustomDefinition).where(
                        CloudMcpCustomDefinition.user_id == user_id,
                        CloudMcpCustomDefinition.id.in_(definition_db_ids),
                    )
                )
            )
            .scalars()
            .all()
        )
        return [_record(record) for record in records]


async def create_custom_definition(
    *,
    user_id: UUID,
    definition_id: str,
    name: str,
    description: str,
    transport: str,
    auth_kind: str,
    availability: str,
    template_json: str,
    enabled: bool,
) -> CloudMcpCustomDefinitionRecord:
    async with db_engine.async_session_factory() as db:
        now = utcnow()
        definition = CloudMcpCustomDefinition(
            id=uuid.uuid4(),
            user_id=user_id,
            definition_id=definition_id,
            version=1,
            name=name,
            description=description,
            transport=transport,
            auth_kind=auth_kind,
            availability=availability,
            template_json=template_json,
            enabled=enabled,
            deleted_at=None,
            created_at=now,
            updated_at=now,
        )
        db.add(definition)
        await db.commit()
        await db.refresh(definition)
        return _record(definition)


async def update_custom_definition(
    *,
    user_id: UUID,
    definition_id: str,
    name: str | None = None,
    description: str | None = None,
    transport: str | None = None,
    auth_kind: str | None = None,
    availability: str | None = None,
    template_json: str | None = None,
    enabled: bool | None = None,
) -> CloudMcpCustomDefinitionRecord | None:
    async with db_engine.async_session_factory() as db:
        definition = (
            await db.execute(
                select(CloudMcpCustomDefinition).where(
                    CloudMcpCustomDefinition.user_id == user_id,
                    CloudMcpCustomDefinition.definition_id == definition_id,
                )
            )
        ).scalar_one_or_none()
        if definition is None:
            return None
        changed = False
        for attr, value in (
            ("name", name),
            ("description", description),
            ("transport", transport),
            ("auth_kind", auth_kind),
            ("availability", availability),
            ("template_json", template_json),
            ("enabled", enabled),
        ):
            if value is not None and getattr(definition, attr) != value:
                setattr(definition, attr, value)
                changed = True
        if definition.deleted_at is not None:
            definition.deleted_at = None
            changed = True
        if changed:
            definition.version += 1
            definition.updated_at = utcnow()
        await db.commit()
        await db.refresh(definition)
        return _record(definition)


async def soft_delete_custom_definition(
    user_id: UUID,
    definition_id: str,
) -> CloudMcpCustomDefinitionRecord | None:
    async with db_engine.async_session_factory() as db:
        definition = (
            await db.execute(
                select(CloudMcpCustomDefinition).where(
                    CloudMcpCustomDefinition.user_id == user_id,
                    CloudMcpCustomDefinition.definition_id == definition_id,
                )
            )
        ).scalar_one_or_none()
        if definition is None:
            return None
        if definition.deleted_at is None:
            now = utcnow()
            definition.deleted_at = now
            definition.enabled = False
            definition.version += 1
            definition.updated_at = now
            await db.commit()
            await db.refresh(definition)
        return _record(definition)
