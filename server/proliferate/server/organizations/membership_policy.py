"""Membership policy: the one place that decides where a new identity lands.

Every account-creation call site (password registration, provider identity
linking, and SSO just-in-time provisioning) routes through
``place_new_identity`` instead of deciding org placement inline. That keeps the
hosted-vs-single-org branch in one seam rather than scattered across the auth
surfaces.

- ``HostedPolicy`` reproduces today's hosted behavior: every new identity gets
  its own personal default organization (owner role).
- ``SingleOrgPolicy`` joins the one instance organization as a member. The
  instance org is created exactly once by the first-run claim flow; until then
  this policy fails closed with a clear error rather than minting a personal
  org.

Which policy applies is decided by ``settings.single_org_mode`` at call time.
"""

from __future__ import annotations

from typing import Protocol

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.organizations import ORGANIZATION_ROLE_MEMBER
from proliferate.db.store import organizations as organization_store
from proliferate.server.organizations.errors import InstanceOrganizationNotClaimed
from proliferate.server.organizations.registration import (
    OrganizationRegistrationUser,
    ensure_default_organization_for_account,
)


class MembershipPolicy(Protocol):
    async def place_new_identity(
        self,
        db: AsyncSession,
        user: OrganizationRegistrationUser,
    ) -> None: ...


class HostedPolicy:
    """Hosted behavior: create a personal default organization per identity."""

    async def place_new_identity(
        self,
        db: AsyncSession,
        user: OrganizationRegistrationUser,
    ) -> None:
        await ensure_default_organization_for_account(db, user)


class SingleOrgPolicy:
    """Self-host behavior: join the single instance organization."""

    async def place_new_identity(
        self,
        db: AsyncSession,
        user: OrganizationRegistrationUser,
    ) -> None:
        instance_organization = await organization_store.get_instance_organization(db)
        if instance_organization is None:
            # No instance org yet. Only the first-run claim flow may create one;
            # a normal sign-in must not, so we fail closed.
            raise InstanceOrganizationNotClaimed()
        await organization_store.add_active_membership(
            db,
            organization_id=instance_organization.id,
            user_id=user.id,
            role=ORGANIZATION_ROLE_MEMBER,
        )


def select_membership_policy() -> MembershipPolicy:
    if settings.single_org_mode:
        return SingleOrgPolicy()
    return HostedPolicy()


async def place_new_identity(
    db: AsyncSession,
    user: OrganizationRegistrationUser,
) -> None:
    """Place a newly created identity into its organization per the active mode."""
    await select_membership_policy().place_new_identity(db, user)
