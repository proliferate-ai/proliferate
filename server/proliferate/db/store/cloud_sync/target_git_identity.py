"""Cloud target Git identity persistence."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import CloudTargetConfigStatus
from proliferate.db.models.cloud.target_git_identity import CloudTargetGitIdentity
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class CloudTargetGitIdentitySnapshot:
    id: UUID
    target_id: UUID
    user_id: UUID
    organization_id: UUID | None
    provider: str
    config_version: int
    payload_ciphertext: str
    summary_json: str
    materialization_status: str
    last_command_id: UUID | None
    last_materialized_at: datetime | None
    last_error_code: str | None
    last_error_message: str | None
    created_at: datetime
    updated_at: datetime


def _snapshot(row: CloudTargetGitIdentity) -> CloudTargetGitIdentitySnapshot:
    return CloudTargetGitIdentitySnapshot(
        id=row.id,
        target_id=row.target_id,
        user_id=row.user_id,
        organization_id=row.organization_id,
        provider=row.provider,
        config_version=row.config_version,
        payload_ciphertext=row.payload_ciphertext,
        summary_json=row.summary_json,
        materialization_status=row.materialization_status,
        last_command_id=row.last_command_id,
        last_materialized_at=row.last_materialized_at,
        last_error_code=row.last_error_code,
        last_error_message=row.last_error_message,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def upsert_target_git_identity(
    db: AsyncSession,
    *,
    target_id: UUID,
    user_id: UUID,
    organization_id: UUID | None,
    provider: str,
    payload_ciphertext: str,
    summary_json: str,
) -> CloudTargetGitIdentitySnapshot:
    now = utcnow()
    await db.execute(
        pg_insert(CloudTargetGitIdentity)
        .values(
            target_id=target_id,
            user_id=user_id,
            organization_id=organization_id,
            provider=provider,
            config_version=0,
            payload_ciphertext=payload_ciphertext,
            summary_json=summary_json,
            materialization_status=CloudTargetConfigStatus.pending.value,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_nothing(
            index_elements=[
                CloudTargetGitIdentity.target_id,
                CloudTargetGitIdentity.provider,
            ]
        )
    )
    row = (
        await db.execute(
            select(CloudTargetGitIdentity)
            .where(CloudTargetGitIdentity.target_id == target_id)
            .where(CloudTargetGitIdentity.provider == provider)
            .with_for_update()
        )
    ).scalar_one()
    row.user_id = user_id
    row.organization_id = organization_id
    row.config_version += 1
    row.payload_ciphertext = payload_ciphertext
    row.summary_json = summary_json
    row.materialization_status = CloudTargetConfigStatus.pending.value
    row.last_command_id = None
    row.last_materialized_at = None
    row.last_error_code = None
    row.last_error_message = None
    row.updated_at = now
    await db.flush()
    return _snapshot(row)


async def get_target_git_identity_by_id(
    db: AsyncSession,
    identity_id: UUID,
) -> CloudTargetGitIdentitySnapshot | None:
    row = await db.get(CloudTargetGitIdentity, identity_id)
    return _snapshot(row) if row is not None else None


async def get_target_git_identity_for_provider(
    db: AsyncSession,
    *,
    target_id: UUID,
    provider: str,
) -> CloudTargetGitIdentitySnapshot | None:
    row = (
        await db.execute(
            select(CloudTargetGitIdentity)
            .where(CloudTargetGitIdentity.target_id == target_id)
            .where(CloudTargetGitIdentity.provider == provider)
        )
    ).scalar_one_or_none()
    return _snapshot(row) if row is not None else None


async def get_target_git_identity_for_worker_command(
    db: AsyncSession,
    *,
    identity_id: UUID,
    target_id: UUID,
    command_id: UUID,
    config_version: int,
) -> CloudTargetGitIdentitySnapshot | None:
    row = (
        await db.execute(
            select(CloudTargetGitIdentity)
            .where(CloudTargetGitIdentity.id == identity_id)
            .where(CloudTargetGitIdentity.target_id == target_id)
            .where(CloudTargetGitIdentity.last_command_id == command_id)
            .where(CloudTargetGitIdentity.config_version == config_version)
        )
    ).scalar_one_or_none()
    return _snapshot(row) if row is not None else None


async def update_target_git_identity_payload(
    db: AsyncSession,
    *,
    identity_id: UUID,
    payload_ciphertext: str,
    summary_json: str,
) -> CloudTargetGitIdentitySnapshot | None:
    row = (
        await db.execute(
            select(CloudTargetGitIdentity)
            .where(CloudTargetGitIdentity.id == identity_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    row.payload_ciphertext = payload_ciphertext
    row.summary_json = summary_json
    row.updated_at = utcnow()
    await db.flush()
    return _snapshot(row)


async def mark_target_git_identity_queued(
    db: AsyncSession,
    *,
    identity_id: UUID,
    command_id: UUID,
) -> CloudTargetGitIdentitySnapshot | None:
    row = (
        await db.execute(
            select(CloudTargetGitIdentity)
            .where(CloudTargetGitIdentity.id == identity_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    row.materialization_status = CloudTargetConfigStatus.queued.value
    row.last_command_id = command_id
    row.last_error_code = None
    row.last_error_message = None
    row.updated_at = utcnow()
    await db.flush()
    return _snapshot(row)


async def mark_target_git_identity_status(
    db: AsyncSession,
    *,
    identity_id: UUID,
    target_id: UUID,
    command_id: UUID,
    config_version: int,
    status: str,
    error_code: str | None,
    error_message: str | None,
) -> CloudTargetGitIdentitySnapshot | None:
    row = (
        await db.execute(
            select(CloudTargetGitIdentity)
            .where(CloudTargetGitIdentity.id == identity_id)
            .where(CloudTargetGitIdentity.target_id == target_id)
            .where(CloudTargetGitIdentity.last_command_id == command_id)
            .where(CloudTargetGitIdentity.config_version == config_version)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    row.materialization_status = status
    row.last_error_code = error_code
    row.last_error_message = error_message
    if status == CloudTargetConfigStatus.applied.value:
        row.last_materialized_at = utcnow()
    row.updated_at = utcnow()
    await db.flush()
    return _snapshot(row)
