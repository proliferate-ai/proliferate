"""Persistence helpers for cloud repo environment materialization state."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.repositories import CloudRepoEnvironmentMaterialization
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class CloudRepoEnvironmentMaterializationValue:
    id: UUID
    cloud_sandbox_id: UUID
    repo_environment_id: UUID
    status: str
    applied_repo_environment_updated_at: datetime | None
    applied_manifest: dict[str, object]
    last_error: str | None
    materialized_at: datetime | None
    created_at: datetime
    updated_at: datetime


def _loads_json_dict(value: str | None) -> dict[str, object]:
    if not value:
        return {}
    decoded = json.loads(value)
    return decoded if isinstance(decoded, dict) else {}


def _dumps_json(value: dict[str, object] | None) -> str | None:
    if not value:
        return None
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def _materialization_value(
    row: CloudRepoEnvironmentMaterialization,
) -> CloudRepoEnvironmentMaterializationValue:
    return CloudRepoEnvironmentMaterializationValue(
        id=row.id,
        cloud_sandbox_id=row.cloud_sandbox_id,
        repo_environment_id=row.repo_environment_id,
        status=row.status.value if hasattr(row.status, "value") else str(row.status),
        applied_repo_environment_updated_at=row.applied_repo_environment_updated_at,
        applied_manifest=_loads_json_dict(row.applied_manifest_json),
        last_error=row.last_error,
        materialized_at=row.materialized_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def load_repo_environment_materialization(
    db: AsyncSession,
    *,
    cloud_sandbox_id: UUID,
    repo_environment_id: UUID,
    lock_row: bool = False,
) -> CloudRepoEnvironmentMaterializationValue | None:
    stmt = select(CloudRepoEnvironmentMaterialization).where(
        CloudRepoEnvironmentMaterialization.cloud_sandbox_id == cloud_sandbox_id,
        CloudRepoEnvironmentMaterialization.repo_environment_id == repo_environment_id,
    )
    if lock_row:
        stmt = stmt.with_for_update()
    row = (await db.execute(stmt)).scalar_one_or_none()
    return _materialization_value(row) if row is not None else None


async def begin_repo_environment_materialization(
    db: AsyncSession,
    *,
    cloud_sandbox_id: UUID,
    repo_environment_id: UUID,
) -> CloudRepoEnvironmentMaterializationValue:
    now = utcnow()
    row = (
        await db.execute(
            pg_insert(CloudRepoEnvironmentMaterialization)
            .values(
                cloud_sandbox_id=cloud_sandbox_id,
                repo_environment_id=repo_environment_id,
                status="running",
                applied_repo_environment_updated_at=None,
                applied_manifest_json=None,
                last_error=None,
                materialized_at=None,
                created_at=now,
                updated_at=now,
            )
            .on_conflict_do_update(
                index_elements=[
                    CloudRepoEnvironmentMaterialization.cloud_sandbox_id,
                    CloudRepoEnvironmentMaterialization.repo_environment_id,
                ],
                set_={
                    "status": "running",
                    "last_error": None,
                    "materialized_at": None,
                    "updated_at": now,
                },
            )
            .returning(CloudRepoEnvironmentMaterialization)
        )
    ).scalar_one()
    return _materialization_value(row)


async def mark_repo_environment_materialization_ready(
    db: AsyncSession,
    materialization_id: UUID,
    *,
    applied_repo_environment_updated_at: datetime,
    applied_manifest: dict[str, object],
) -> CloudRepoEnvironmentMaterializationValue | None:
    row = await db.get(CloudRepoEnvironmentMaterialization, materialization_id)
    if row is None:
        return None
    now = utcnow()
    row.status = "ready"
    row.applied_repo_environment_updated_at = applied_repo_environment_updated_at
    row.applied_manifest_json = _dumps_json(applied_manifest)
    row.last_error = None
    row.materialized_at = now
    row.updated_at = now
    await db.flush()
    return _materialization_value(row)


async def mark_repo_environment_materialization_error(
    db: AsyncSession,
    materialization_id: UUID,
    *,
    last_error: str,
) -> CloudRepoEnvironmentMaterializationValue | None:
    row = await db.get(CloudRepoEnvironmentMaterialization, materialization_id)
    if row is None:
        return None
    row.status = "error"
    row.last_error = last_error
    row.updated_at = utcnow()
    await db.flush()
    return _materialization_value(row)
