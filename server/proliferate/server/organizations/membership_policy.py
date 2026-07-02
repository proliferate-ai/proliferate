"""Membership policy: the one place that decides where a new identity lands.

Every account-creation call site (password registration, provider identity
linking, and SSO just-in-time provisioning) routes through
``place_new_identity`` instead of deciding org placement inline. That keeps the
hosted-vs-single-org branch in one seam rather than scattered across the auth
surfaces.

- ``HostedPolicy`` reproduces today's hosted behavior: every new identity gets
  its own personal default organization (owner role).
- ``SingleOrgPolicy`` joins the one instance organization. The instance org is
  created exactly once by the first-run claim flow; until then this policy
  fails closed with a clear error rather than minting a personal org. The
  joining role honors, in order: a live pending invitation for the email (the
  admin's explicit choice), the caller-provided default role (SSO JIT), and
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
from proliferate.db.store import organization_invitations as invitation_store
from proliferate.db.store import organizations as organization_store
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
        *,
        default_role: str | None = None,
    ) -> None: ...


class HostedPolicy:
    """Hosted behavior: create a personal default organization per identity.

    ``default_role`` is deliberately ignored: hosted identities always own
    their personal organization, exactly as before the seam existed.
    """

    async def place_new_identity(
        self,
        db: AsyncSession,
        user: OrganizationRegistrationUser,
        *,
        default_role: str | None = None,
    ) -> None:
        await ensure_default_organization_for_account(db, user)


class SingleOrgPolicy:
    """Self-host behavior: join the single instance organization."""

    async def place_new_identity(
        self,
        db: AsyncSession,
        user: OrganizationRegistrationUser,
        *,
        default_role: str | None = None,
    ) -> None:
        instance_organization = await organization_store.get_instance_organization(db)
        if instance_organization is None:
            # No instance org yet. Only the first-run claim flow may create one;
            # a normal sign-in must not, so we fail closed.
            raise InstanceOrganizationNotClaimed()
        membership = await organization_store.get_membership_for_user(
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
            await organization_store.add_active_membership(
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
            default_role=default_role,
        )
        await organization_store.add_active_membership(
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
    default_role: str | None,
) -> str:
    """Role for a brand-new instance membership.

    A live pending invitation wins: in single-org mode an invitation doubles as
    the allowlist entry, and its role is the admin's explicit choice for this
    email. Otherwise the caller-provided default role applies (the SSO JIT path
    passes the connection's ``default_role``), falling back to member. The
    ADMIN_EMAILS floor then raises listed emails to at least admin.
    """
    invitation = await invitation_store.get_live_pending_invitation_for_organization_email(
        db,
        organization_id=organization_id,
        email=user.email,
    )
    role = ORGANIZATION_ROLE_MEMBER
    if invitation is not None and is_organization_role(invitation.role):
        role = invitation.role
    elif default_role is not None and is_organization_role(default_role):
        role = default_role
    if is_admin_listed_email(user.email) and role not in organization_admin_roles():
        role = ORGANIZATION_ROLE_ADMIN
    return role


async def ensure_instance_membership_not_removed(
    db: AsyncSession,
    *,
    organization_id: UUID,
    user_id: UUID,
    email: str | None,
) -> None:
    """Fail closed instead of reactivating an admin-removed instance membership.

    Login paths must never silently restore access that an admin revoked. The
    one exception is the ADMIN_EMAILS floor: reinstating a listed email is the
    documented lockout-recovery path (see the admin_emails module docstring).
    No-op in hosted mode and for organizations other than THE instance org, so
    hosted behavior is untouched.
    """
    if not settings.single_org_mode:
        return
    instance_organization = await organization_store.get_instance_organization(db)
    if instance_organization is None or instance_organization.id != organization_id:
        return
    membership = await organization_store.get_membership_for_user(
        db,
        organization_id=organization_id,
        user_id=user_id,
    )
    if membership is None or membership.status == ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE:
        return
    if is_admin_listed_email(email):
        return
    raise InstanceOrganizationAccessRemoved()


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
    existing = await organization_store.get_instance_organization(db)
    if existing is not None:
        raise InstanceOrganizationAlreadyClaimed()
    return await organization_store.create_instance_organization(
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
    *,
    default_role: str | None = None,
) -> None:
    """Place a newly created identity into its organization per the active mode."""
    await select_membership_policy().place_new_identity(db, user, default_role=default_role)
