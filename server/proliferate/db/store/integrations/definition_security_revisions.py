"""Read projections for immutable integration-definition security revisions."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.integration_authorization import (
    CloudIntegrationDefinitionSecurityRevision,
)
from proliferate.db.models.integrations import CloudIntegrationDefinition


@dataclass(frozen=True)
class IntegrationDefinitionSecurityRevisionRecord:
    id: UUID
    definition_id: UUID
    revision: int
    auth_kind: str
    oauth_client_mode: str | None
    config_json: str
    created_at: datetime


def _record(
    row: CloudIntegrationDefinitionSecurityRevision,
) -> IntegrationDefinitionSecurityRevisionRecord:
    return IntegrationDefinitionSecurityRevisionRecord(
        id=row.id,
        definition_id=row.definition_id,
        revision=row.revision,
        auth_kind=row.auth_kind,
        oauth_client_mode=row.oauth_client_mode,
        config_json=row.config_json,
        created_at=row.created_at,
    )


async def get_definition_security_revision(
    db: AsyncSession,
    *,
    definition_id: UUID,
    revision: int,
) -> IntegrationDefinitionSecurityRevisionRecord | None:
    row = await db.scalar(
        select(CloudIntegrationDefinitionSecurityRevision).where(
            CloudIntegrationDefinitionSecurityRevision.definition_id == definition_id,
            CloudIntegrationDefinitionSecurityRevision.revision == revision,
        )
    )
    return _record(row) if row is not None else None


async def get_definition_security_revision_by_id(
    db: AsyncSession,
    revision_id: UUID,
) -> IntegrationDefinitionSecurityRevisionRecord | None:
    row = await db.get(CloudIntegrationDefinitionSecurityRevision, revision_id)
    return _record(row) if row is not None else None


async def get_latest_definition_security_revision(
    db: AsyncSession,
    definition_id: UUID,
) -> IntegrationDefinitionSecurityRevisionRecord | None:
    row = await db.scalar(
        select(CloudIntegrationDefinitionSecurityRevision)
        .where(CloudIntegrationDefinitionSecurityRevision.definition_id == definition_id)
        .order_by(CloudIntegrationDefinitionSecurityRevision.revision.desc())
        .limit(1)
    )
    return _record(row) if row is not None else None


async def ensure_current_definition_security_revision(
    db: AsyncSession,
    definition_id: UUID,
) -> IntegrationDefinitionSecurityRevisionRecord | None:
    """Return an immutable snapshot matching the definition's current security shape."""

    definition = await db.scalar(
        select(CloudIntegrationDefinition)
        .where(CloudIntegrationDefinition.id == definition_id)
        .with_for_update()
    )
    if definition is None:
        return None
    latest = await db.scalar(
        select(CloudIntegrationDefinitionSecurityRevision)
        .where(CloudIntegrationDefinitionSecurityRevision.definition_id == definition_id)
        .order_by(CloudIntegrationDefinitionSecurityRevision.revision.desc())
        .limit(1)
        .with_for_update()
    )
    if latest is not None and (
        latest.auth_kind == definition.auth_kind
        and latest.oauth_client_mode == definition.oauth_client_mode
        and latest.config_json == definition.config_json
    ):
        return _record(latest)
    created = CloudIntegrationDefinitionSecurityRevision(
        definition_id=definition_id,
        revision=(latest.revision + 1 if latest is not None else 1),
        auth_kind=definition.auth_kind,
        oauth_client_mode=definition.oauth_client_mode,
        config_json=definition.config_json,
    )
    db.add(created)
    await db.flush()
    await db.refresh(created)
    return _record(created)
