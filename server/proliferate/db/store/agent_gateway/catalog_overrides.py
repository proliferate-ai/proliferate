"""Agent catalog override persistence (user/org edits layered over snapshots).

The override contract is unchanged by the snapshot re-key (model-catalog.md
§Storage): one row per (user, harness) or (org, harness), holding a
``patch_json`` applied on every layered read. Snapshot persistence lives in
``model_snapshots.py``, which now speaks auth contexts rather than routes.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.agent_gateway import AgentCatalogOverride
from proliferate.db.store.agent_gateway.mappers import catalog_override_record
from proliferate.db.store.agent_gateway.records import AgentCatalogOverrideRecord
from proliferate.lib.infra.time.wall_clock import utcnow


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


async def delete_catalog_override(
    db: AsyncSession,
    *,
    harness_kind: str,
    owner_user_id: UUID | None = None,
    organization_id: UUID | None = None,
) -> bool:
    """Delete the override for a subject. Returns True when a row was removed."""
    if (owner_user_id is None) == (organization_id is None):
        raise ValueError("A catalog override needs exactly one of owner_user_id/organization_id.")
    query = select(AgentCatalogOverride).where(AgentCatalogOverride.harness_kind == harness_kind)
    if owner_user_id is not None:
        query = query.where(AgentCatalogOverride.owner_user_id == owner_user_id)
    else:
        query = query.where(AgentCatalogOverride.organization_id == organization_id)
    row = (await db.execute(query)).scalar_one_or_none()
    if row is None:
        return False
    await db.delete(row)
    await db.flush()
    return True
