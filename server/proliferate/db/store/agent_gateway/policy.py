"""Flag-only org agent policy persistence (PR 11 consumer)."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.agent_gateway import OrgAgentPolicy
from proliferate.db.store.agent_gateway.mappers import org_agent_policy_record
from proliferate.db.store.agent_gateway.records import OrgAgentPolicyRecord
from proliferate.utils.time import utcnow


async def get_org_agent_policy(
    db: AsyncSession,
    *,
    organization_id: UUID,
) -> OrgAgentPolicyRecord | None:
    row = await db.get(OrgAgentPolicy, organization_id)
    return org_agent_policy_record(row) if row is not None else None


async def set_org_agent_policy(
    db: AsyncSession,
    *,
    organization_id: UUID,
    allowed_routes_json: str | None,
    allowed_harnesses_json: str | None,
    updated_by_user_id: UUID | None,
) -> OrgAgentPolicyRecord:
    row = await db.get(OrgAgentPolicy, organization_id)
    if row is None:
        row = OrgAgentPolicy(
            organization_id=organization_id,
            allowed_routes_json=allowed_routes_json,
            allowed_harnesses_json=allowed_harnesses_json,
            updated_by_user_id=updated_by_user_id,
        )
        db.add(row)
    else:
        row.allowed_routes_json = allowed_routes_json
        row.allowed_harnesses_json = allowed_harnesses_json
        row.updated_by_user_id = updated_by_user_id
        row.updated_at = utcnow()
    await db.flush()
    return org_agent_policy_record(row)
