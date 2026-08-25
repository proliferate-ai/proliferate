"""Membership policy: the one place that decides where a new identity lands.

Every account-creation call site (password registration and provider identity
linking) routes through ``place_new_identity`` instead of deciding org
placement inline. That keeps the hosted-vs-single-org branch in one seam
rather than scattered across the auth surfaces.

- ``HostedPolicy`` reproduces today's hosted behavior: every new identity gets
  its own personal default organization (owner role).
- ``SingleOrgPolicy`` joins the one instance organization. The instance org is
  created exactly once by the first-run claim flow; until then this policy
  fails closed with a clear error rather than minting a personal org. The
  joining role honors, in order: a live pending invitation for the email (the
  admin's explicit choice), the caller-provided default role, and
  member otherwise; the ADMIN_EMAILS floor then raises the result to at least
  admin for listed emails. A membership an admin removed is never silently
  reactivated (403), except for ADMIN_EMAILS-listed emails, whose
  reinstatement is the documented lockout-recovery path.

Which policy applies is decided by ``settings.single_org_mode`` at call time.
"""

from __future__ import annotations

from typing import Protocol
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_ROLE_ADMIN,
    ORGANIZATION_ROLE_MEMBER,
)
from proliferate.db.store import instance_organizations as instance_organization_store
from proliferate.db.store import organization_invitations as invitation_store
from proliferate.db.store.organization_records import OrganizationRecord
from proliferate.server.organizations.admin_emails import is_admin_listed_email
from proliferate.server.organizations.domain.policy import (
    is_organization_role,
    organization_admin_roles,
)
from proliferate.server.organizations.domain.profile import (
    default_organization_name,
    derive_logo_domain_from_email,
)
from proliferate.server.organizations.errors import (
    InstanceOrganizationAccessRemoved,
    InstanceOrganizationAlreadyClaimed,
    InstanceOrganizationNotClaimed,
)
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
        instance_organization = await instance_organization_store.get_instance_organization(db)
        if instance_organization is None:
            # No instance org yet. Only the first-run claim flow may create one;
            # a normal sign-in must not, so we fail closed.
            raise InstanceOrganizationNotClaimed()
        membership = await instance_organization_store.get_membership_for_user(
            db,
            organization_id=instance_organization.id,
            user_id=user.id,
        )
        if membership is not None:
            if membership.status == ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE:
                # Idempotent: an existing active membership is left untouched.
                return
            if not is_admin_listed_email(user.email):
                # An admin removed this user from the instance org. Login and
                # read paths must never silently reactivate that membership.
                raise InstanceOrganizationAccessRemoved()
            # ADMIN_EMAILS floor: reinstating a listed email is the deliberate
            # lockout-recovery path (see the admin_emails module docstring).
            await instance_organization_store.add_active_membership(
                db,
                organization_id=instance_organization.id,
                user_id=user.id,
                role=ORGANIZATION_ROLE_ADMIN,
            )
            return
        role = await _resolve_instance_role(
            db,
            organization_id=instance_organization.id,
            user=user,
        )
        await instance_organization_store.add_active_membership(
            db,
            organization_id=instance_organization.id,
            user_id=user.id,
            role=role,
        )


async def _resolve_instance_role(
    db: AsyncSession,
    *,
    organization_id: UUID,
    user: OrganizationRegistrationUser,
) -> str:
    """Role for a brand-new instance membership.

    A live pending invitation wins: in single-org mode an invitation doubles as
    the allowlist entry, and its role is the admin's explicit choice for this
    email. Otherwise the role falls back to member. The ADMIN_EMAILS floor
    then raises listed emails to at least admin.
    """
    invitation = await invitation_store.get_live_pending_invitation_for_organization_email(
        db,
        organization_id=organization_id,
        email=user.email,
    )
    role = ORGANIZATION_ROLE_MEMBER
    if invitation is not None and is_organization_role(invitation.role):
        role = invitation.role
    if is_admin_listed_email(user.email) and role not in organization_admin_roles():
        role = ORGANIZATION_ROLE_ADMIN
    return role


async def claim_instance_organization(
    db: AsyncSession,
    owner: OrganizationRegistrationUser,
    *,
    name: str | None = None,
) -> OrganizationRecord:
    """Create the instance organization with its first owner.

    This is the single-org claim path: the only code allowed to create the
    instance org that ``SingleOrgPolicy`` places every later identity into.
    Called exactly once, by the first-run claim flow, under its advisory lock.
    ``name`` overrides the default derived from the owner's email when given.
    """
    existing = await instance_organization_store.get_instance_organization(db)
    if existing is not None:
        raise InstanceOrganizationAlreadyClaimed()
    return await instance_organization_store.create_instance_organization(
        db,
        owner_user_id=owner.id,
        name=name or default_organization_name(email=owner.email, display_name=owner.display_name),
        logo_domain=derive_logo_domain_from_email(owner.email),
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
