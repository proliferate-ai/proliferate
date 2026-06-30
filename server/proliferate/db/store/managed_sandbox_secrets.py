"""Persistence helpers for managed sandbox secret materialization."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.secrets import ManagedSandboxSecretMaterialization
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class ManagedSandboxSecretMaterializationValue:
    id: UUID
    managed_sandbox_id: UUID
    materialization_kind: str
    cloud_secret_set_id: UUID | None
    cloud_repo_config_id: UUID | None
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


def materialization_value(
    row: ManagedSandboxSecretMaterialization,
) -> ManagedSandboxSecretMaterializationValue:
    return ManagedSandboxSecretMaterializationValue(
        id=row.id,
        managed_sandbox_id=row.managed_sandbox_id,
        materialization_kind=row.materialization_kind,
        cloud_secret_set_id=row.cloud_secret_set_id,
        cloud_repo_config_id=row.cloud_repo_config_id,
        sandbox_generation=row.sandbox_generation,
        applied_version=row.applied_version,
        applied_versions=_loads_versions(row.applied_versions_json),
        applied_manifest=_loads_json_dict(row.applied_manifest_json),
        status=row.status,
        last_error=row.last_error,
        materialized_at=row.materialized_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def load_global_secret_materialization(
    db: AsyncSession,
    *,
    managed_sandbox_id: UUID,
    lock_row: bool = False,
) -> ManagedSandboxSecretMaterializationValue | None:
    stmt = select(ManagedSandboxSecretMaterialization).where(
        ManagedSandboxSecretMaterialization.managed_sandbox_id == managed_sandbox_id,
        ManagedSandboxSecretMaterialization.materialization_kind == "global",
    )
    if lock_row:
        stmt = stmt.with_for_update()
    row = (await db.execute(stmt)).scalar_one_or_none()
    return materialization_value(row) if row is not None else None


async def load_workspace_secret_materialization(
    db: AsyncSession,
    *,
    managed_sandbox_id: UUID,
    cloud_repo_config_id: UUID,
    lock_row: bool = False,
) -> ManagedSandboxSecretMaterializationValue | None:
    stmt = select(ManagedSandboxSecretMaterialization).where(
        ManagedSandboxSecretMaterialization.managed_sandbox_id == managed_sandbox_id,
        ManagedSandboxSecretMaterialization.materialization_kind == "workspace",
        ManagedSandboxSecretMaterialization.cloud_repo_config_id == cloud_repo_config_id,
    )
    if lock_row:
        stmt = stmt.with_for_update()
    row = (await db.execute(stmt)).scalar_one_or_none()
    return materialization_value(row) if row is not None else None


async def begin_global_secret_materialization(
    db: AsyncSession,
    *,
    managed_sandbox_id: UUID,
    sandbox_generation: int,
) -> ManagedSandboxSecretMaterializationValue:
    now = utcnow()
    row = (
        await db.execute(
            pg_insert(ManagedSandboxSecretMaterialization)
            .values(
                managed_sandbox_id=managed_sandbox_id,
                materialization_kind="global",
                cloud_secret_set_id=None,
                cloud_repo_config_id=None,
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
                index_elements=[ManagedSandboxSecretMaterialization.managed_sandbox_id],
                index_where=ManagedSandboxSecretMaterialization.materialization_kind == "global",
                set_={
                    "sandbox_generation": sandbox_generation,
                    "status": "running",
                    "last_error": None,
                    "materialized_at": None,
                    "updated_at": now,
                },
            )
            .returning(ManagedSandboxSecretMaterialization)
        )
    ).scalar_one()
    return materialization_value(row)


async def begin_workspace_secret_materialization(
    db: AsyncSession,
    *,
    managed_sandbox_id: UUID,
    cloud_repo_config_id: UUID,
    cloud_secret_set_id: UUID | None,
    sandbox_generation: int,
) -> ManagedSandboxSecretMaterializationValue:
    now = utcnow()
    row = (
        await db.execute(
            pg_insert(ManagedSandboxSecretMaterialization)
            .values(
                managed_sandbox_id=managed_sandbox_id,
                materialization_kind="workspace",
                cloud_secret_set_id=cloud_secret_set_id,
                cloud_repo_config_id=cloud_repo_config_id,
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
                    ManagedSandboxSecretMaterialization.managed_sandbox_id,
                    ManagedSandboxSecretMaterialization.cloud_repo_config_id,
                ],
                index_where=ManagedSandboxSecretMaterialization.materialization_kind
                == "workspace",
                set_={
                    "cloud_secret_set_id": cloud_secret_set_id,
                    "sandbox_generation": sandbox_generation,
                    "status": "running",
                    "last_error": None,
                    "materialized_at": None,
                    "updated_at": now,
                },
            )
            .returning(ManagedSandboxSecretMaterialization)
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
) -> ManagedSandboxSecretMaterializationValue | None:
    row = await db.get(ManagedSandboxSecretMaterialization, materialization_id)
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
) -> ManagedSandboxSecretMaterializationValue | None:
    row = await db.get(ManagedSandboxSecretMaterialization, materialization_id)
    if row is None:
        return None
    row.status = "error"
    row.last_error = last_error
    row.updated_at = utcnow()
    await db.flush()
    return materialization_value(row)
