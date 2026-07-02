"""Cloud target registry persistence (minimal direct-runtime reintroduction).

Restores the visible-target ownership gate deleted by the #803/#809 cutover
sweep, against the minimal ``cloud_targets`` model that anchors per-target
agent-auth scoping (specs/tbd/ssh-personal-target-design.md §3.1). Enrollment
lifecycle persistence returns with the enrollment slice of the stack.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import and_, exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from proliferate.constants.organizations import ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE
from proliferate.db.models.cloud.targets import CloudTarget
from proliferate.db.models.organizations import OrganizationMembership


@dataclass(frozen=True)
class CloudTargetSnapshot:
    id: UUID
    display_name: str
    kind: str
    status: str
    owner_scope: str
    owner_user_id: UUID | None
    organization_id: UUID | None
    created_by_user_id: UUID
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime


def _target_snapshot(target: CloudTarget) -> CloudTargetSnapshot:
    return CloudTargetSnapshot(
        id=target.id,
        display_name=target.display_name,
        kind=target.kind,
        status=target.status,
        owner_scope=target.owner_scope,
        owner_user_id=target.owner_user_id,
        organization_id=target.organization_id,
        created_by_user_id=target.created_by_user_id,
        archived_at=target.archived_at,
        created_at=target.created_at,
        updated_at=target.updated_at,
    )


def _visible_target_filter(user_id: UUID) -> ColumnElement[bool]:
    active_org_membership = exists().where(
        OrganizationMembership.organization_id == CloudTarget.organization_id,
        OrganizationMembership.user_id == user_id,
        OrganizationMembership.status == ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    )
    return or_(
        and_(
            CloudTarget.owner_scope == "personal",
            or_(
                CloudTarget.owner_user_id == user_id,
                CloudTarget.created_by_user_id == user_id,
            ),
        ),
        and_(
            CloudTarget.owner_scope == "organization",
            CloudTarget.organization_id.is_not(None),
            active_org_membership,
        ),
    )


async def get_visible_target_by_id(
    db: AsyncSession,
    *,
    target_id: UUID,
    user_id: UUID,
) -> CloudTargetSnapshot | None:
    row = (
        await db.execute(
            select(CloudTarget)
            .where(CloudTarget.id == target_id)
            .where(_visible_target_filter(user_id))
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    return _target_snapshot(row)
