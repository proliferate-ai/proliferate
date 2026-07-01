"""Persistence helpers for cloud sandbox secret materialization."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.secrets import CloudSandboxSecretMaterialization
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class CloudSandboxSecretMaterializationValue:
    id: UUID
    cloud_sandbox_id: UUID
    materialization_kind: str
    cloud_secret_set_id: UUID | None
    repo_environment_id: UUID | None
    sandbox_generation: int
    applied_version: int
    applied_versions: dict[str, int]
    applied_manifest: dict[str, object]
    status: str
    last_error: str | None
    materialized_at: datetime | None
    created_at: datetime
    updated_at: datetime


def _loads_json_dict(value: str | None) -> dict[str, object]:
    if not value:
        return {}
    decoded = json.loads(value)
    if isinstance(decoded, dict):
        return decoded
    return {}


def _loads_versions(value: str | None) -> dict[str, int]:
    decoded = _loads_json_dict(value)
    result: dict[str, int] = {}
    for key, raw in decoded.items():
        if isinstance(raw, int):
            result[str(key)] = raw
    return result


def _dumps_json(value: dict[str, object] | dict[str, int] | None) -> str | None:
    if not value:
        return None
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def _enum_value(value: object) -> str:
    raw = getattr(value, "value", value)
    return str(raw)


def materialization_value(
    row: CloudSandboxSecretMaterialization,
) -> CloudSandboxSecretMaterializationValue:
    return CloudSandboxSecretMaterializationValue(
        id=row.id,
        cloud_sandbox_id=row.cloud_sandbox_id,
        materialization_kind=_enum_value(row.materialization_kind),
        cloud_secret_set_id=row.cloud_secret_set_id,
        repo_environment_id=row.repo_environment_id,
        sandbox_generation=row.sandbox_generation,
        applied_version=row.applied_version,
        applied_versions=_loads_versions(row.applied_versions_json),
        applied_manifest=_loads_json_dict(row.applied_manifest_json),
        status=_enum_value(row.status),
        last_error=row.last_error,
        materialized_at=row.materialized_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def load_global_secret_materialization(
    db: AsyncSession,
    *,
    cloud_sandbox_id: UUID,
    lock_row: bool = False,
) -> CloudSandboxSecretMaterializationValue | None:
    stmt = select(CloudSandboxSecretMaterialization).where(
        CloudSandboxSecretMaterialization.cloud_sandbox_id == cloud_sandbox_id,
        CloudSandboxSecretMaterialization.materialization_kind == "global",
    )
    if lock_row:
        stmt = stmt.with_for_update()
    row = (await db.execute(stmt)).scalar_one_or_none()
    return materialization_value(row) if row is not None else None


async def load_workspace_secret_materialization(
    db: AsyncSession,
    *,
    cloud_sandbox_id: UUID,
    repo_environment_id: UUID,
    lock_row: bool = False,
) -> CloudSandboxSecretMaterializationValue | None:
    stmt = select(CloudSandboxSecretMaterialization).where(
        CloudSandboxSecretMaterialization.cloud_sandbox_id == cloud_sandbox_id,
        CloudSandboxSecretMaterialization.materialization_kind == "workspace",
        CloudSandboxSecretMaterialization.repo_environment_id == repo_environment_id,
    )
    if lock_row:
        stmt = stmt.with_for_update()
    row = (await db.execute(stmt)).scalar_one_or_none()
    return materialization_value(row) if row is not None else None


async def begin_global_secret_materialization(
    db: AsyncSession,
    *,
    cloud_sandbox_id: UUID,
    sandbox_generation: int,
) -> CloudSandboxSecretMaterializationValue:
    now = utcnow()
    row = (
        await db.execute(
            pg_insert(CloudSandboxSecretMaterialization)
            .values(
                cloud_sandbox_id=cloud_sandbox_id,
                materialization_kind="global",
                cloud_secret_set_id=None,
                repo_environment_id=None,
                sandbox_generation=sandbox_generation,
                applied_version=0,
                applied_versions_json=None,
                applied_manifest_json=None,
                status="running",
                last_error=None,
                materialized_at=None,
                created_at=now,
                updated_at=now,
            )
            .on_conflict_do_update(
                index_elements=[CloudSandboxSecretMaterialization.cloud_sandbox_id],
                index_where=CloudSandboxSecretMaterialization.materialization_kind == "global",
                set_={
                    "sandbox_generation": sandbox_generation,
                    "status": "running",
                    "last_error": None,
                    "materialized_at": None,
                    "updated_at": now,
                },
            )
            .returning(CloudSandboxSecretMaterialization)
        )
    ).scalar_one()
    return materialization_value(row)


async def begin_workspace_secret_materialization(
    db: AsyncSession,
    *,
    cloud_sandbox_id: UUID,
    repo_environment_id: UUID,
    cloud_secret_set_id: UUID | None,
    sandbox_generation: int,
) -> CloudSandboxSecretMaterializationValue:
    now = utcnow()
    row = (
        await db.execute(
            pg_insert(CloudSandboxSecretMaterialization)
            .values(
                cloud_sandbox_id=cloud_sandbox_id,
                materialization_kind="workspace",
                cloud_secret_set_id=cloud_secret_set_id,
                repo_environment_id=repo_environment_id,
                sandbox_generation=sandbox_generation,
                applied_version=0,
                applied_versions_json=None,
                applied_manifest_json=None,
                status="running",
                last_error=None,
                materialized_at=None,
                created_at=now,
                updated_at=now,
            )
            .on_conflict_do_update(
                index_elements=[
                    CloudSandboxSecretMaterialization.cloud_sandbox_id,
                    CloudSandboxSecretMaterialization.repo_environment_id,
                ],
                index_where=CloudSandboxSecretMaterialization.materialization_kind == "workspace",
                set_={
                    "cloud_secret_set_id": cloud_secret_set_id,
                    "sandbox_generation": sandbox_generation,
                    "status": "running",
                    "last_error": None,
                    "materialized_at": None,
                    "updated_at": now,
                },
            )
            .returning(CloudSandboxSecretMaterialization)
        )
    ).scalar_one()
    return materialization_value(row)


async def mark_secret_materialization_ready(
    db: AsyncSession,
    materialization_id: UUID,
    *,
    applied_version: int,
    applied_versions: dict[str, int],
    applied_manifest: dict[str, object],
) -> CloudSandboxSecretMaterializationValue | None:
    row = await db.get(CloudSandboxSecretMaterialization, materialization_id)
    if row is None:
        return None
    now = utcnow()
    row.applied_version = applied_version
    row.applied_versions_json = _dumps_json(applied_versions)
    row.applied_manifest_json = _dumps_json(applied_manifest)
    row.status = "ready"
    row.last_error = None
    row.materialized_at = now
    row.updated_at = now
    await db.flush()
    return materialization_value(row)


async def mark_secret_materialization_error(
    db: AsyncSession,
    materialization_id: UUID,
    *,
    last_error: str,
) -> CloudSandboxSecretMaterializationValue | None:
    row = await db.get(CloudSandboxSecretMaterialization, materialization_id)
    if row is None:
        return None
    row.status = "error"
    row.last_error = last_error
    row.updated_at = utcnow()
    await db.flush()
    return materialization_value(row)
