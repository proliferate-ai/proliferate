"""Agent catalog snapshot and override persistence (minimal CRUD for PR 7)."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.agent_gateway import AgentCatalogOverride, AgentCatalogSnapshot
from proliferate.db.store.agent_gateway.mappers import (
    catalog_override_record,
    catalog_snapshot_record,
)
from proliferate.db.store.agent_gateway.records import (
    AgentCatalogOverrideRecord,
    AgentCatalogSnapshotRecord,
)
from proliferate.utils.time import utcnow


async def create_catalog_snapshot(
    db: AsyncSession,
    *,
    harness_kind: str,
    surface: str,
    route: str,
    owner_user_id: UUID | None,
    models_json: str,
    source: str = "probe",
) -> AgentCatalogSnapshotRecord:
    row = AgentCatalogSnapshot(
        harness_kind=harness_kind,
        surface=surface,
        route=route,
        owner_user_id=owner_user_id,
        models_json=models_json,
        source=source,
        status="active",
    )
    db.add(row)
    await db.flush()
    return catalog_snapshot_record(row)


async def get_latest_catalog_snapshot(
    db: AsyncSession,
    *,
    harness_kind: str,
    surface: str,
    route: str,
    owner_user_id: UUID | None,
) -> AgentCatalogSnapshotRecord | None:
    query = (
        select(AgentCatalogSnapshot)
        .where(
            AgentCatalogSnapshot.harness_kind == harness_kind,
            AgentCatalogSnapshot.surface == surface,
            AgentCatalogSnapshot.route == route,
            AgentCatalogSnapshot.status == "active",
        )
        .order_by(AgentCatalogSnapshot.probed_at.desc())
        .limit(1)
    )
    if owner_user_id is None:
        query = query.where(AgentCatalogSnapshot.owner_user_id.is_(None))
    else:
        query = query.where(AgentCatalogSnapshot.owner_user_id == owner_user_id)
    row = (await db.execute(query)).scalar_one_or_none()
    return catalog_snapshot_record(row) if row is not None else None


async def upsert_catalog_override(
    db: AsyncSession,
    *,
    harness_kind: str,
    patch_json: str,
    owner_user_id: UUID | None = None,
    organization_id: UUID | None = None,
) -> AgentCatalogOverrideRecord:
    if (owner_user_id is None) == (organization_id is None):
        raise ValueError("A catalog override needs exactly one of owner_user_id/organization_id.")
    query = select(AgentCatalogOverride).where(AgentCatalogOverride.harness_kind == harness_kind)
    if owner_user_id is not None:
        query = query.where(AgentCatalogOverride.owner_user_id == owner_user_id)
    else:
        query = query.where(AgentCatalogOverride.organization_id == organization_id)
    row = (await db.execute(query)).scalar_one_or_none()
    if row is None:
        row = AgentCatalogOverride(
            owner_user_id=owner_user_id,
            organization_id=organization_id,
            harness_kind=harness_kind,
            patch_json=patch_json,
        )
        db.add(row)
    else:
        row.patch_json = patch_json
        row.updated_at = utcnow()
    await db.flush()
    return catalog_override_record(row)


async def get_catalog_override(
    db: AsyncSession,
    *,
    harness_kind: str,
    owner_user_id: UUID | None = None,
    organization_id: UUID | None = None,
) -> AgentCatalogOverrideRecord | None:
    if (owner_user_id is None) == (organization_id is None):
        raise ValueError("A catalog override needs exactly one of owner_user_id/organization_id.")
    query = select(AgentCatalogOverride).where(AgentCatalogOverride.harness_kind == harness_kind)
    if owner_user_id is not None:
        query = query.where(AgentCatalogOverride.owner_user_id == owner_user_id)
    else:
        query = query.where(AgentCatalogOverride.organization_id == organization_id)
    row = (await db.execute(query)).scalar_one_or_none()
    return catalog_override_record(row) if row is not None else None
