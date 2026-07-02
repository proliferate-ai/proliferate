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

from sqlalchemy import and_, exists, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from proliferate.constants.organizations import ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE
from proliferate.db.models.cloud.targets import CloudTarget
from proliferate.db.models.organizations import OrganizationMembership


# Deliberately excludes anyharness_bearer_token_ciphertext: snapshots feed
# list/detail payload builders, and the bearer must never ride along. Read it
# through get_target_anyharness_bearer_ciphertext instead.
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


async def list_visible_targets(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> list[CloudTargetSnapshot]:
    rows = (
        await db.execute(
            select(CloudTarget)
            .where(_visible_target_filter(user_id))
            .order_by(CloudTarget.created_at, CloudTarget.id)
        )
    ).scalars()
    return [_target_snapshot(row) for row in rows]


async def get_active_personal_target_by_kind(
    db: AsyncSession,
    *,
    owner_user_id: UUID,
    kind: str,
) -> CloudTargetSnapshot | None:
    row = (
        await db.execute(
            select(CloudTarget)
            .where(CloudTarget.owner_scope == "personal")
            .where(CloudTarget.owner_user_id == owner_user_id)
            .where(CloudTarget.kind == kind)
            .where(CloudTarget.archived_at.is_(None))
            .order_by(CloudTarget.created_at)
            .limit(1)
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    return _target_snapshot(row)


async def create_target(
    db: AsyncSession,
    *,
    display_name: str,
    kind: str,
    owner_scope: str,
    owner_user_id: UUID | None,
    organization_id: UUID | None,
    created_by_user_id: UUID,
    anyharness_bearer_token_ciphertext: str,
) -> CloudTargetSnapshot:
    target = CloudTarget(
        display_name=display_name,
        kind=kind,
        owner_scope=owner_scope,
        owner_user_id=owner_user_id,
        organization_id=organization_id,
        created_by_user_id=created_by_user_id,
        anyharness_bearer_token_ciphertext=anyharness_bearer_token_ciphertext,
    )
    db.add(target)
    await db.flush()
    return _target_snapshot(target)


async def create_single_active_personal_target(
    db: AsyncSession,
    *,
    display_name: str,
    kind: str,
    owner_user_id: UUID,
    anyharness_bearer_token_ciphertext: str,
) -> CloudTargetSnapshot | None:
    """Insert a personal target guarded by the one-active-row-per-user unique
    index (uq_cloud_targets_personal_desktop_dispatch_active); returns None
    when a concurrent enrollment already holds the slot."""
    target = CloudTarget(
        display_name=display_name,
        kind=kind,
        owner_scope="personal",
        owner_user_id=owner_user_id,
        organization_id=None,
        created_by_user_id=owner_user_id,
        anyharness_bearer_token_ciphertext=anyharness_bearer_token_ciphertext,
    )
    try:
        async with db.begin_nested():
            db.add(target)
            await db.flush()
    except IntegrityError:
        return None
    return _target_snapshot(target)


async def set_target_status(
    db: AsyncSession,
    *,
    target_id: UUID,
    status_value: str,
) -> None:
    await db.execute(
        update(CloudTarget).where(CloudTarget.id == target_id).values(status=status_value)
    )


async def set_target_anyharness_bearer_ciphertext(
    db: AsyncSession,
    *,
    target_id: UUID,
    ciphertext: str,
) -> None:
    await db.execute(
        update(CloudTarget)
        .where(CloudTarget.id == target_id)
        .values(anyharness_bearer_token_ciphertext=ciphertext)
    )


async def get_target_anyharness_bearer_ciphertext(
    db: AsyncSession,
    *,
    target_id: UUID,
) -> str | None:
    return (
        await db.execute(
            select(CloudTarget.anyharness_bearer_token_ciphertext).where(
                CloudTarget.id == target_id
            )
        )
    ).scalar_one_or_none()
