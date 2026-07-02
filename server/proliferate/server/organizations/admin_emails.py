"""ADMIN_EMAILS: the operator-controlled admin floor for the instance org.

``ADMIN_EMAILS`` is a comma-separated list of emails that must always hold at
least the admin role in the instance organization. The floor is asserted at
account creation (``SingleOrgPolicy`` grants listed identities the admin role
up front) and again at every login (every login path calls
``ensure_admin_email_role``), so adding an email to the list and restarting
the server is the lockout-recovery path. A listed user who was removed from
the instance org is reinstated as admin at their next login for the same
reason: the operator's env wins.

The env is a floor, not a ceiling: removing an email from the list never
demotes anyone. In-product role management moves people up, or down within
two invariants enforced by the organization service layer:

- the instance organization must always keep at least one active admin
- a listed user cannot be demoted below admin while listed

Hosted mode: ADMIN_EMAILS is deliberately inert. Hosted deployments are
multi-org, so there is no single instance organization for the floor to apply
to, and a process-wide email list must never grant admin over arbitrary
customer organizations. ``is_admin_listed_email`` returns False whenever
``single_org_mode`` is off, which makes every consumer of this module a no-op
in hosted mode.
"""

from __future__ import annotations

import logging
from typing import Protocol
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.organizations import ORGANIZATION_ROLE_ADMIN
from proliferate.db.store import instance_organizations as instance_organization_store
from proliferate.db.store import organizations as organization_store
from proliferate.server.organizations.domain.policy import organization_admin_roles

logger = logging.getLogger(__name__)


class AdminEmailUser(Protocol):
    id: UUID
    email: str


def is_admin_listed_email(email: str | None) -> bool:
    """True when the email is on the ADMIN_EMAILS floor for this instance.

    Always False in hosted mode (see module docstring) and when the env is
    empty, so callers can invoke this unconditionally.
    """
    if not settings.single_org_mode:
        return False
    if not email:
        return False
    return email.strip().lower() in settings.admin_email_set


async def ensure_admin_email_role(db: AsyncSession, user: AdminEmailUser) -> None:
    """Assert the ADMIN_EMAILS floor for one user; no-op when it does not apply.

    Called from every login path (and safe to call anywhere a user has just
    authenticated): if the user is listed, they end up holding at least the
    admin role in the instance organization. Owners are left untouched, and
    nothing happens before the instance is claimed.
    """
    if not is_admin_listed_email(user.email):
        return
    instance_organization = await instance_organization_store.get_instance_organization(db)
    if instance_organization is None:
        return
    membership = await organization_store.get_active_membership(
        db,
        organization_id=instance_organization.id,
        user_id=user.id,
    )
    if membership is None:
        # Listed users always belong to the instance org: reinstate a removed
        # (or never-created) membership at the floor role. This is the
        # DELIBERATE lockout-recovery semantic: login paths never reactivate a
        # removed membership on their own (they 403 instead, see the membership
        # policy), but the operator's env wins for listed emails. The flip side
        # is that offboarding someone requires removing them from ADMIN_EMAILS
        # too, or they are reinstated as admin at their next login.
        await instance_organization_store.add_active_membership(
            db,
            organization_id=instance_organization.id,
            user_id=user.id,
            role=ORGANIZATION_ROLE_ADMIN,
        )
        logger.info("ADMIN_EMAILS: reinstated %s as instance org admin.", user.email)
        return
    if membership.role in organization_admin_roles():
        return
    await organization_store.update_organization_membership(
        db,
        organization_id=instance_organization.id,
        membership_id=membership.id,
        role=ORGANIZATION_ROLE_ADMIN,
        status=None,
        can_modify_owner=False,
    )
    logger.info("ADMIN_EMAILS: promoted %s to instance org admin.", user.email)
