"""Read projections for integration authorization attempts.

Mutation arrives with the stage-and-swap slice. Keeping this store read-only
here makes the additive schema observable without enabling lifecycle behavior.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.integration_authorization import (
    CloudIntegrationAuthorizationAttempt,
)


@dataclass(frozen=True)
class IntegrationAuthorizationAttemptRecord:
    id: UUID
    owner_user_id: UUID
    definition_id: UUID
    account_id: UUID | None
    purpose: str
    method: str
    generation: int
    status: str
    starting_grant_version: int | None
    starting_credential_version: int | None
    definition_security_revision_id: UUID
    provider_client_id: UUID | None
    credential_audience: str
    settings_json: str
    requested_scopes_json: str
    effective_scopes_json: str | None
    staged_credential_ciphertext: str | None
    staged_credential_format: str | None
    failure_code: str | None
    expires_at: datetime
    closed_at: datetime | None
    created_at: datetime
    updated_at: datetime


def _record(row: CloudIntegrationAuthorizationAttempt) -> IntegrationAuthorizationAttemptRecord:
    return IntegrationAuthorizationAttemptRecord(
        id=row.id,
        owner_user_id=row.owner_user_id,
        definition_id=row.definition_id,
        account_id=row.account_id,
        purpose=row.purpose,
        method=row.method,
        generation=row.generation,
        status=row.status,
        starting_grant_version=row.starting_grant_version,
        starting_credential_version=row.starting_credential_version,
        definition_security_revision_id=row.definition_security_revision_id,
        provider_client_id=row.provider_client_id,
        credential_audience=row.credential_audience,
        settings_json=row.settings_json,
        requested_scopes_json=row.requested_scopes_json,
        effective_scopes_json=row.effective_scopes_json,
        staged_credential_ciphertext=row.staged_credential_ciphertext,
        staged_credential_format=row.staged_credential_format,
        failure_code=row.failure_code,
        expires_at=row.expires_at,
        closed_at=row.closed_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def get_authorization_attempt(
    db: AsyncSession,
    attempt_id: UUID,
) -> IntegrationAuthorizationAttemptRecord | None:
    row = await db.get(CloudIntegrationAuthorizationAttempt, attempt_id)
    return _record(row) if row is not None else None


async def get_latest_authorization_attempt(
    db: AsyncSession,
    *,
    owner_user_id: UUID,
    definition_id: UUID,
) -> IntegrationAuthorizationAttemptRecord | None:
    row = await db.scalar(
        select(CloudIntegrationAuthorizationAttempt)
        .where(
            CloudIntegrationAuthorizationAttempt.owner_user_id == owner_user_id,
            CloudIntegrationAuthorizationAttempt.definition_id == definition_id,
        )
        .order_by(CloudIntegrationAuthorizationAttempt.generation.desc())
        .limit(1)
    )
    return _record(row) if row is not None else None
