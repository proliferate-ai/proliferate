"""Instance-organization persistence layer (single-org mode).

Single-org-mode deployments mark exactly one organization as the instance org.
This module owns that org's store surface: the instance-org lookup and claim,
plus the membership helpers whose only consumers are the single-org paths
(the membership policy, the ADMIN_EMAILS floor, and invite self-registration).
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.organizations import (
    ORGANIZATION_CURRENT_STATUSES,
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_ROLE_OWNER,
)
from proliferate.db.models.organizations import (
    Organization,
    OrganizationMembership,
)
from proliferate.db.store.organization_records import (
    MembershipRecord,
    OrganizationRecord,
    membership_record,
    organization_record,
)
from proliferate.db.store.organizations import (
    acquire_organization_membership_lock,
    allocate_organization_slug,
)
from proliferate.utils.time import utcnow


async def get_instance_organization(db: AsyncSession) -> OrganizationRecord | None:
    """Return the single instance organization, or None when unclaimed.

    Single-org-mode deployments mark exactly one organization as the instance
    org. A partial unique index guarantees at most one, so this can never match
    more than one row.
    """
    organization = (
        await db.execute(
            select(Organization).where(
                Organization.is_instance.is_(True),
                Organization.status.in_(tuple(ORGANIZATION_CURRENT_STATUSES)),
            )
        )
    ).scalar_one_or_none()
    return organization_record(organization) if organization is not None else None


async def create_instance_organization(
    db: AsyncSession,
    *,
    owner_user_id: UUID,
    name: str,
    logo_domain: str | None,
) -> OrganizationRecord:
    """Create THE instance organization with its first owner.

    Only the first-run claim flow may call this. The partial unique index on
    ``is_instance`` makes "at most one instance org" a database invariant, so a
    duplicate claim fails loudly instead of minting a second org.
    """
    now = utcnow()
    organization = Organization(
        name=name,
        slug=await allocate_organization_slug(db, name),
        logo_domain=logo_domain,
        logo_image=None,
        is_instance=True,
        created_at=now,
        updated_at=now,
    )
    db.add(organization)
    await db.flush()
    db.add(
        OrganizationMembership(
            organization_id=organization.id,
            user_id=owner_user_id,
            role=ORGANIZATION_ROLE_OWNER,
            status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            joined_at=now,
            removed_at=None,
            created_at=now,
            updated_at=now,
        )
    )
    await db.flush()
    return organization_record(organization)


async def add_active_membership(
    db: AsyncSession,
    *,
    organization_id: UUID,
    user_id: UUID,
    role: str,
) -> MembershipRecord:
    """Add or reactivate a user's active membership in an organization.

    Idempotent: an already-active membership is returned unchanged (its role is
    left intact); a removed membership is reactivated with the requested role.
    """
    await acquire_organization_membership_lock(db, organization_id)
    now = utcnow()
    membership = (
        await db.execute(
            select(OrganizationMembership)
            .where(
                OrganizationMembership.organization_id == organization_id,
                OrganizationMembership.user_id == user_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if membership is None:
        membership = OrganizationMembership(
            organization_id=organization_id,
            user_id=user_id,
            role=role,
            status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            joined_at=now,
            removed_at=None,
            created_at=now,
            updated_at=now,
        )
        db.add(membership)
    elif membership.status != ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE:
        membership.status = ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE
        membership.role = role
        membership.removed_at = None
        if membership.joined_at is None:
            membership.joined_at = now
        membership.updated_at = now
    await db.flush()
    return membership_record(membership)


async def get_membership_for_user(
    db: AsyncSession,
    *,
    organization_id: UUID,
    user_id: UUID,
) -> MembershipRecord | None:
    """Load a user's membership in an organization regardless of status.

    Callers that must distinguish "never joined" from "removed by an admin"
    (the membership policy, login reactivation guards) need the row even when
    it is no longer active.
    """
    membership = (
        await db.execute(
            select(OrganizationMembership).where(
                OrganizationMembership.organization_id == organization_id,
                OrganizationMembership.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    return membership_record(membership) if membership is not None else None
