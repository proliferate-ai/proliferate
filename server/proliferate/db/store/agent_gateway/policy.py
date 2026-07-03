"""Flag-only org agent policy persistence (PR 11 consumer)."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.organizations import ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE
from proliferate.db.models.auth import User
from proliferate.db.models.cloud.agent_gateway import AgentAuthSelection, OrgAgentPolicy
from proliferate.db.models.organizations import OrganizationMembership
from proliferate.db.store.agent_gateway.mappers import org_agent_policy_record
from proliferate.db.store.agent_gateway.records import OrgAgentPolicyRecord
from proliferate.utils.time import utcnow


@dataclass(frozen=True)
class OrgMemberRouteSelectionRecord:
    """A member's enabled auth selection joined with identity, for violation checks."""

    user_id: UUID
    email: str | None
    display_name: str | None
    harness_kind: str
    surface: str
    source_kind: str


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


async def list_org_member_route_selections(
    db: AsyncSession,
    *,
    organization_id: UUID,
) -> list[OrgMemberRouteSelectionRecord]:
    """Active members' enabled auth selections, joined live (no violations table)."""
    rows = (
        await db.execute(
            select(
                AgentAuthSelection.user_id,
                User.email,
                User.display_name,
                AgentAuthSelection.harness_kind,
                AgentAuthSelection.surface,
                AgentAuthSelection.source_kind,
            )
            .join(
                OrganizationMembership,
                OrganizationMembership.user_id == AgentAuthSelection.user_id,
            )
            .join(User, User.id == AgentAuthSelection.user_id)
            .where(
                OrganizationMembership.organization_id == organization_id,
                OrganizationMembership.status == ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
                AgentAuthSelection.enabled.is_(True),
            )
            .order_by(
                AgentAuthSelection.user_id,
                AgentAuthSelection.harness_kind,
                AgentAuthSelection.surface,
            )
        )
    ).all()
    return [
        OrgMemberRouteSelectionRecord(
            user_id=row.user_id,
            email=row.email,
            display_name=row.display_name,
            harness_kind=row.harness_kind,
            surface=row.surface,
            source_kind=row.source_kind,
        )
        for row in rows
    ]
