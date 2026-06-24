"""Persistence helpers for managed sandbox repo materialization."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import case, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.managed_sandboxes import ManagedSandboxRepoMaterialization
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class ManagedSandboxRepoMaterializationValue:
    id: UUID
    managed_sandbox_id: UUID
    cloud_repo_config_id: UUID
    sandbox_generation: int
    status: str
    repo_path: str
    anyharness_repo_root_id: str | None
    anyharness_workspace_id: str | None
    applied_files_version: int
    applied_setup_script_version: int
    applied_env_vars_version: int
    last_error: str | None
    last_attempted_at: datetime | None
    materialized_at: datetime | None
    created_at: datetime
    updated_at: datetime


def materialization_value(
    row: ManagedSandboxRepoMaterialization,
) -> ManagedSandboxRepoMaterializationValue:
    return ManagedSandboxRepoMaterializationValue(
        id=row.id,
        managed_sandbox_id=row.managed_sandbox_id,
        cloud_repo_config_id=row.cloud_repo_config_id,
        sandbox_generation=row.sandbox_generation,
        status=row.status,
        repo_path=row.repo_path,
        anyharness_repo_root_id=row.anyharness_repo_root_id,
        anyharness_workspace_id=row.anyharness_workspace_id,
        applied_files_version=row.applied_files_version,
        applied_setup_script_version=row.applied_setup_script_version,
        applied_env_vars_version=row.applied_env_vars_version,
        last_error=row.last_error,
        last_attempted_at=row.last_attempted_at,
        materialized_at=row.materialized_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def load_repo_materialization(
    db: AsyncSession,
    *,
    managed_sandbox_id: UUID,
    cloud_repo_config_id: UUID,
    lock_row: bool = False,
) -> ManagedSandboxRepoMaterializationValue | None:
    stmt = select(ManagedSandboxRepoMaterialization).where(
        ManagedSandboxRepoMaterialization.managed_sandbox_id == managed_sandbox_id,
        ManagedSandboxRepoMaterialization.cloud_repo_config_id == cloud_repo_config_id,
    )
    if lock_row:
        stmt = stmt.with_for_update()
    row = (await db.execute(stmt)).scalar_one_or_none()
    return materialization_value(row) if row is not None else None


async def list_materializations_for_sandbox(
    db: AsyncSession,
    *,
    managed_sandbox_id: UUID,
) -> tuple[ManagedSandboxRepoMaterializationValue, ...]:
    rows = (
        (
            await db.execute(
                select(ManagedSandboxRepoMaterialization)
                .where(ManagedSandboxRepoMaterialization.managed_sandbox_id == managed_sandbox_id)
                .order_by(ManagedSandboxRepoMaterialization.created_at.asc())
            )
        )
        .scalars()
        .all()
    )
    return tuple(materialization_value(row) for row in rows)


async def begin_repo_materialization(
    db: AsyncSession,
    *,
    managed_sandbox_id: UUID,
    cloud_repo_config_id: UUID,
    sandbox_generation: int,
    repo_path: str,
) -> ManagedSandboxRepoMaterializationValue:
    now = utcnow()
    generation_changed = (
        ManagedSandboxRepoMaterialization.sandbox_generation != sandbox_generation
    )
    row = (
        await db.execute(
            pg_insert(ManagedSandboxRepoMaterialization)
            .values(
                managed_sandbox_id=managed_sandbox_id,
                cloud_repo_config_id=cloud_repo_config_id,
                sandbox_generation=sandbox_generation,
                status="running",
                repo_path=repo_path,
                anyharness_repo_root_id=None,
                anyharness_workspace_id=None,
                applied_files_version=0,
                applied_setup_script_version=0,
                applied_env_vars_version=0,
                last_error=None,
                last_attempted_at=now,
                materialized_at=None,
                created_at=now,
                updated_at=now,
            )
            .on_conflict_do_update(
                index_elements=["managed_sandbox_id", "cloud_repo_config_id"],
                set_={
                    "sandbox_generation": sandbox_generation,
                    "status": "running",
                    "repo_path": repo_path,
                    "anyharness_repo_root_id": case(
                        (generation_changed, None),
                        else_=ManagedSandboxRepoMaterialization.anyharness_repo_root_id,
                    ),
                    "anyharness_workspace_id": case(
                        (generation_changed, None),
                        else_=ManagedSandboxRepoMaterialization.anyharness_workspace_id,
                    ),
                    "applied_files_version": case(
                        (generation_changed, 0),
                        else_=ManagedSandboxRepoMaterialization.applied_files_version,
                    ),
                    "applied_setup_script_version": case(
                        (generation_changed, 0),
                        else_=ManagedSandboxRepoMaterialization.applied_setup_script_version,
                    ),
                    "applied_env_vars_version": case(
                        (generation_changed, 0),
                        else_=ManagedSandboxRepoMaterialization.applied_env_vars_version,
                    ),
                    "last_error": None,
                    "last_attempted_at": now,
                    "materialized_at": None,
                    "updated_at": now,
                },
            )
            .returning(ManagedSandboxRepoMaterialization)
        )
    ).scalar_one()
    return materialization_value(row)


async def mark_repo_materialization_ready(
    db: AsyncSession,
    materialization_id: UUID,
    *,
    anyharness_repo_root_id: str | None,
    anyharness_workspace_id: str | None,
    applied_files_version: int,
    applied_setup_script_version: int,
    applied_env_vars_version: int,
) -> ManagedSandboxRepoMaterializationValue | None:
    row = await db.get(ManagedSandboxRepoMaterialization, materialization_id)
    if row is None:
        return None
    now = utcnow()
    row.status = "ready"
    row.anyharness_repo_root_id = anyharness_repo_root_id
    row.anyharness_workspace_id = anyharness_workspace_id
    row.applied_files_version = applied_files_version
    row.applied_setup_script_version = applied_setup_script_version
    row.applied_env_vars_version = applied_env_vars_version
    row.last_error = None
    row.materialized_at = now
    row.updated_at = now
    await db.flush()
    return materialization_value(row)


async def mark_repo_materialization_error(
    db: AsyncSession,
    materialization_id: UUID,
    *,
    last_error: str,
) -> ManagedSandboxRepoMaterializationValue | None:
    row = await db.get(ManagedSandboxRepoMaterialization, materialization_id)
    if row is None:
        return None
    row.status = "error"
    row.last_error = last_error
    row.updated_at = utcnow()
    await db.flush()
    return materialization_value(row)


async def mark_repo_materialization_disabled(
    db: AsyncSession,
    *,
    managed_sandbox_id: UUID,
    cloud_repo_config_id: UUID,
) -> ManagedSandboxRepoMaterializationValue | None:
    row = (
        await db.execute(
            select(ManagedSandboxRepoMaterialization).where(
                ManagedSandboxRepoMaterialization.managed_sandbox_id == managed_sandbox_id,
                ManagedSandboxRepoMaterialization.cloud_repo_config_id == cloud_repo_config_id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    row.status = "disabled"
    row.updated_at = utcnow()
    await db.flush()
    return materialization_value(row)
