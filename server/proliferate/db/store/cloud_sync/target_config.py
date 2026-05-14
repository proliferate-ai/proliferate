"""Cloud target environment materialization persistence."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import CloudTargetConfigStatus
from proliferate.db.models.cloud.target_config import CloudTargetConfig
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class CloudTargetConfigSnapshot:
    id: UUID
    target_id: UUID
    user_id: UUID
    organization_id: UUID | None
    git_provider: str
    git_owner: str
    git_repo_name: str
    workspace_root: str
    config_version: int
    payload_ciphertext: str
    summary_json: str
    env_vars_version: int
    files_version: int
    credential_snapshot_version: int
    mcp_materialization_version: int
    materialization_status: str
    last_command_id: UUID | None
    last_materialized_at: datetime | None
    last_error_code: str | None
    last_error_message: str | None
    created_at: datetime
    updated_at: datetime


def _snapshot(row: CloudTargetConfig) -> CloudTargetConfigSnapshot:
    return CloudTargetConfigSnapshot(
        id=row.id,
        target_id=row.target_id,
        user_id=row.user_id,
        organization_id=row.organization_id,
        git_provider=row.git_provider,
        git_owner=row.git_owner,
        git_repo_name=row.git_repo_name,
        workspace_root=row.workspace_root,
        config_version=row.config_version,
        payload_ciphertext=row.payload_ciphertext,
        summary_json=row.summary_json,
        env_vars_version=row.env_vars_version,
        files_version=row.files_version,
        credential_snapshot_version=row.credential_snapshot_version,
        mcp_materialization_version=row.mcp_materialization_version,
        materialization_status=row.materialization_status,
        last_command_id=row.last_command_id,
        last_materialized_at=row.last_materialized_at,
        last_error_code=row.last_error_code,
        last_error_message=row.last_error_message,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def upsert_target_config(
    db: AsyncSession,
    *,
    target_id: UUID,
    user_id: UUID,
    organization_id: UUID | None,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
    workspace_root: str,
    payload_ciphertext: str,
    summary_json: str,
    env_vars_version: int,
    files_version: int,
    credential_snapshot_version: int,
    mcp_materialization_version: int,
) -> CloudTargetConfigSnapshot:
    now = utcnow()
    await db.execute(
        pg_insert(CloudTargetConfig)
        .values(
            target_id=target_id,
            user_id=user_id,
            organization_id=organization_id,
            git_provider=git_provider,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
            workspace_root=workspace_root,
            config_version=0,
            payload_ciphertext=payload_ciphertext,
            summary_json=summary_json,
            env_vars_version=env_vars_version,
            files_version=files_version,
            credential_snapshot_version=credential_snapshot_version,
            mcp_materialization_version=mcp_materialization_version,
            materialization_status=CloudTargetConfigStatus.pending.value,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_nothing(
            index_elements=[
                CloudTargetConfig.target_id,
                CloudTargetConfig.git_provider,
                CloudTargetConfig.git_owner,
                CloudTargetConfig.git_repo_name,
            ]
        )
    )
    row = (
        await db.execute(
            select(CloudTargetConfig)
            .where(CloudTargetConfig.target_id == target_id)
            .where(CloudTargetConfig.git_provider == git_provider)
            .where(CloudTargetConfig.git_owner == git_owner)
            .where(CloudTargetConfig.git_repo_name == git_repo_name)
            .with_for_update()
        )
    ).scalar_one()
    row.user_id = user_id
    row.organization_id = organization_id
    row.workspace_root = workspace_root
    row.config_version += 1
    row.payload_ciphertext = payload_ciphertext
    row.summary_json = summary_json
    row.env_vars_version = env_vars_version
    row.files_version = files_version
    row.credential_snapshot_version = credential_snapshot_version
    row.mcp_materialization_version = mcp_materialization_version
    row.materialization_status = CloudTargetConfigStatus.pending.value
    row.last_command_id = None
    row.last_materialized_at = None
    row.last_error_code = None
    row.last_error_message = None
    row.updated_at = now
    await db.flush()
    return _snapshot(row)


async def get_target_config_by_id(
    db: AsyncSession,
    config_id: UUID,
) -> CloudTargetConfigSnapshot | None:
    row = await db.get(CloudTargetConfig, config_id)
    return _snapshot(row) if row is not None else None


async def get_target_config_for_worker_command(
    db: AsyncSession,
    *,
    config_id: UUID,
    target_id: UUID,
    command_id: UUID,
    config_version: int,
) -> CloudTargetConfigSnapshot | None:
    row = (
        await db.execute(
            select(CloudTargetConfig)
            .where(CloudTargetConfig.id == config_id)
            .where(CloudTargetConfig.target_id == target_id)
            .where(CloudTargetConfig.last_command_id == command_id)
            .where(CloudTargetConfig.config_version == config_version)
        )
    ).scalar_one_or_none()
    return _snapshot(row) if row is not None else None


async def get_target_config_for_repo(
    db: AsyncSession,
    *,
    target_id: UUID,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
) -> CloudTargetConfigSnapshot | None:
    row = (
        await db.execute(
            select(CloudTargetConfig)
            .where(CloudTargetConfig.target_id == target_id)
            .where(CloudTargetConfig.git_provider == git_provider)
            .where(CloudTargetConfig.git_owner == git_owner)
            .where(CloudTargetConfig.git_repo_name == git_repo_name)
        )
    ).scalar_one_or_none()
    return _snapshot(row) if row is not None else None


async def list_target_configs(
    db: AsyncSession,
    *,
    target_id: UUID,
) -> tuple[CloudTargetConfigSnapshot, ...]:
    rows = list(
        (
            await db.execute(
                select(CloudTargetConfig)
                .where(CloudTargetConfig.target_id == target_id)
                .order_by(CloudTargetConfig.git_owner.asc(), CloudTargetConfig.git_repo_name.asc())
            )
        )
        .scalars()
        .all()
    )
    return tuple(_snapshot(row) for row in rows)


async def mark_target_config_queued(
    db: AsyncSession,
    *,
    config_id: UUID,
    command_id: UUID,
) -> CloudTargetConfigSnapshot | None:
    row = (
        await db.execute(
            select(CloudTargetConfig)
            .where(CloudTargetConfig.id == config_id)
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


async def update_target_config_payload(
    db: AsyncSession,
    *,
    config_id: UUID,
    payload_ciphertext: str,
    summary_json: str,
) -> CloudTargetConfigSnapshot | None:
    row = (
        await db.execute(
            select(CloudTargetConfig)
            .where(CloudTargetConfig.id == config_id)
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


async def mark_target_config_status(
    db: AsyncSession,
    *,
    config_id: UUID,
    target_id: UUID,
    command_id: UUID,
    config_version: int,
    status: str,
    error_code: str | None = None,
    error_message: str | None = None,
) -> CloudTargetConfigSnapshot | None:
    row = (
        await db.execute(
            select(CloudTargetConfig)
            .where(CloudTargetConfig.id == config_id)
            .where(CloudTargetConfig.target_id == target_id)
            .where(CloudTargetConfig.last_command_id == command_id)
            .where(CloudTargetConfig.config_version == config_version)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    now = utcnow()
    row.materialization_status = status
    if status == CloudTargetConfigStatus.applied.value:
        row.last_materialized_at = now
        row.last_error_code = None
        row.last_error_message = None
    elif status == CloudTargetConfigStatus.failed.value:
        row.last_error_code = error_code
        row.last_error_message = error_message
    row.updated_at = now
    await db.flush()
    return _snapshot(row)
