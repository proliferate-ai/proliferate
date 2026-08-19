"""Read projections for immutable integration-definition security revisions."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.integration_authorization import (
    CloudIntegrationDefinitionSecurityRevision,
)


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
