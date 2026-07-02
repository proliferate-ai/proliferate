"""Store helpers for ``cloud_integration_definition`` rows.

Seed definitions (``source='seed'``) are code-defined and reconciled by
``sync_seed_definitions``; org-custom definitions (``source='org_custom'``) are
owned by a single organization. These helpers never let seed reconciliation
touch org-custom rows and vice versa.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.integrations import CloudIntegrationDefinition
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class IntegrationDefinitionRecord:
    id: UUID
    source: str
    namespace: str
    display_name: str
    description: str | None
    organization_id: UUID | None
    auth_kind: str
    oauth_client_mode: str | None
    config_json: str
    enabled_by_default: bool
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime


def _record(row: CloudIntegrationDefinition) -> IntegrationDefinitionRecord:
    return IntegrationDefinitionRecord(
        id=row.id,
        source=row.source,
        namespace=row.namespace,
        display_name=row.display_name,
        description=row.description,
        organization_id=row.organization_id,
        auth_kind=row.auth_kind,
        oauth_client_mode=row.oauth_client_mode,
        config_json=row.config_json,
        enabled_by_default=row.enabled_by_default,
        archived_at=row.archived_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def list_seed_definitions(db: AsyncSession) -> tuple[IntegrationDefinitionRecord, ...]:
    result = await db.scalars(
        select(CloudIntegrationDefinition)
        .where(
            CloudIntegrationDefinition.source == "seed",
            CloudIntegrationDefinition.archived_at.is_(None),
        )
        .order_by(CloudIntegrationDefinition.namespace)
    )
    return tuple(_record(row) for row in result.all())


async def list_definitions_visible_to_org(
    db: AsyncSession, organization_id: UUID
) -> tuple[IntegrationDefinitionRecord, ...]:
    """Seed definitions plus that org's own customs, excluding archived rows."""
    result = await db.scalars(
        select(CloudIntegrationDefinition)
        .where(
            CloudIntegrationDefinition.archived_at.is_(None),
            (CloudIntegrationDefinition.source == "seed")
            | (
                (CloudIntegrationDefinition.source == "org_custom")
                & (CloudIntegrationDefinition.organization_id == organization_id)
            ),
        )
        .order_by(CloudIntegrationDefinition.display_name)
    )
    return tuple(_record(row) for row in result.all())


async def get_definition(
    db: AsyncSession, definition_id: UUID
) -> IntegrationDefinitionRecord | None:
    row = await db.get(CloudIntegrationDefinition, definition_id)
    return _record(row) if row is not None else None


async def get_definitions_by_ids(
    db: AsyncSession, definition_ids: Iterable[UUID]
) -> dict[UUID, IntegrationDefinitionRecord]:
    ids = list(definition_ids)
    if not ids:
        return {}
    result = await db.scalars(
        select(CloudIntegrationDefinition).where(CloudIntegrationDefinition.id.in_(ids))
    )
    return {row.id: _record(row) for row in result.all()}


async def get_seed_by_namespace(
    db: AsyncSession, namespace: str
) -> IntegrationDefinitionRecord | None:
    row = await db.scalar(
        select(CloudIntegrationDefinition).where(
            CloudIntegrationDefinition.source == "seed",
            CloudIntegrationDefinition.namespace == namespace,
        )
    )
    return _record(row) if row is not None else None


async def create_org_custom_definition(
    db: AsyncSession,
    *,
    organization_id: UUID,
    namespace: str,
    display_name: str,
    description: str | None,
    auth_kind: str,
    oauth_client_mode: str | None,
    config_json: str,
    enabled_by_default: bool = True,
) -> IntegrationDefinitionRecord:
    row = CloudIntegrationDefinition(
        source="org_custom",
        organization_id=organization_id,
        namespace=namespace,
        display_name=display_name,
        description=description,
        auth_kind=auth_kind,
        oauth_client_mode=oauth_client_mode,
        config_json=config_json,
        enabled_by_default=enabled_by_default,
    )
    db.add(row)
    await db.flush()
    return _record(row)


async def set_definition_archived(
    db: AsyncSession, definition_id: UUID, *, archived: bool = True
) -> IntegrationDefinitionRecord | None:
    row = await db.get(CloudIntegrationDefinition, definition_id)
    if row is None:
        return None
    row.archived_at = utcnow() if archived else None
    await db.flush()
    return _record(row)


async def upsert_seed_definition(
    db: AsyncSession,
    *,
    namespace: str,
    display_name: str,
    description: str | None,
    auth_kind: str,
    oauth_client_mode: str | None,
    config_json: str,
    enabled_by_default: bool,
) -> IntegrationDefinitionRecord:
    """Insert or update the seed definition for ``namespace``.

    Matches on ``source='seed'`` + ``namespace``. Updates the mutable seed
    fields; never touches org-custom rows. Idempotent. Callers serialize the
    launch config; stores never touch the server-layer codec.
    """
    row = await db.scalar(
        select(CloudIntegrationDefinition).where(
            CloudIntegrationDefinition.source == "seed",
            CloudIntegrationDefinition.namespace == namespace,
        )
    )
    if row is None:
        row = CloudIntegrationDefinition(
            source="seed",
            organization_id=None,
            namespace=namespace,
            display_name=display_name,
            description=description,
            auth_kind=auth_kind,
            oauth_client_mode=oauth_client_mode,
            config_json=config_json,
            enabled_by_default=enabled_by_default,
        )
        db.add(row)
    else:
        row.display_name = display_name
        row.description = description
        row.auth_kind = auth_kind
        row.oauth_client_mode = oauth_client_mode
        row.config_json = config_json
        row.enabled_by_default = enabled_by_default
        row.archived_at = None
    await db.flush()
    return _record(row)
