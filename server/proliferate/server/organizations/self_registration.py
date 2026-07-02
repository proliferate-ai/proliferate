"""Invite-as-allowlist self-registration (single-org mode only).

In single-org mode an organization invitation doubles as an allowlist entry:
inviting an email allows that person to create their own account with a
password through ``POST /auth/password/register``. There is no separate
allowlist table; a live pending invitation for the instance organization IS
the allowlist entry, so revoking or expiring the invitation closes
registration for that email again.

Registration requires proof of the invitation, not just knowledge of an
invited email address: the request must carry the invitation token (the
invitation id, shared by the inviting admin). The invitation is looked up by
token, never by email, and any bad or unknown token gets the same uniform 403
as an uninvited email, so responses cannot be used to enumerate which emails
are invited or to squat an invited teammate's account before they register.

The flow reuses the first-run claim's account machinery
(``server.setup.accounts``), places the new identity through the membership
policy seam (which honors the invitation's role, with the ADMIN_EMAILS floor
on top), and completes the invitation automatically so it does not linger as
pending.

``ALLOWED_EMAIL_DOMAINS`` is an optional extra gate on top of the allowlist:
when set, invited emails may register only if their domain is listed. Strictly
a gate, never a grant.

Boundaries:

- Hosted mode: the route is never mounted, so hosted behavior is unchanged.
- The ``password_auth_enabled`` kill switch applies here exactly as it does to
  password login: no password account may be created while it is off.
- SSO just-in-time provisioning bypasses this allowlist entirely; SSO arrivals
  are governed by the SSO JIT policy (``auth/sso``), not by invitations.
"""

from __future__ import annotations

import hmac
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.identity.password import ensure_password_auth_enabled
from proliferate.config import settings
from proliferate.db.store import instance_organizations as instance_organization_store
from proliferate.db.store import organization_invitations as invitation_store
from proliferate.db.store.auth_passwords import get_user_by_normalized_email
from proliferate.db.store.organization_records import InvitationRecord
from proliferate.server.organizations.errors import OrganizationServiceError
from proliferate.server.organizations.membership_policy import place_new_identity
from proliferate.server.setup.accounts import (
    AccountValidationError,
    create_password_account,
    normalize_account_email,
    validate_account_password,
)


@dataclass(frozen=True)
class SelfRegistration:
    user_id: UUID
    email: str
    organization_id: UUID
    organization_name: str


class RegistrationClosedError(OrganizationServiceError):
    """Self-registration does not exist on this deployment surface."""

    def __init__(self) -> None:
        super().__init__(
            code="registration_closed",
            message="Not found.",
            status_code=404,
        )


class RegistrationNotAllowedError(OrganizationServiceError):
    """The email is not allowed to self-register on this instance."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(code=code, message=message, status_code=403)


class RegistrationConflictError(OrganizationServiceError):
    def __init__(self) -> None:
        super().__init__(
            code="account_already_exists",
            message="An account with this email already exists. Sign in instead.",
            status_code=409,
        )


class RegistrationValidationError(OrganizationServiceError):
    def __init__(self, message: str) -> None:
        super().__init__(
            code="invalid_registration",
            message=message,
            status_code=400,
        )


def _not_invited() -> RegistrationNotAllowedError:
    """The uniform 403 for every bad, unknown, or mismatched invitation.

    One response shape on purpose: unknown token, revoked or expired
    invitation, token/email mismatch, and unclaimed instance are all
    indistinguishable, so nothing here can confirm whether an email is invited.
    """
    return RegistrationNotAllowedError(
        code="registration_not_invited",
        message=(
            "Registration is invite-only and requires a valid invitation token. "
            "Ask an admin of this instance for an invitation."
        ),
    )


def is_email_domain_allowed(email: str) -> bool:
    """Apply the optional ALLOWED_EMAIL_DOMAINS gate. Empty config allows all."""
    allowed_domains = settings.allowed_email_domain_set
    if not allowed_domains:
        return True
    _, _, domain = email.rpartition("@")
    return domain.lower() in allowed_domains


async def _live_invitation_for_token(
    db: AsyncSession,
    *,
    organization_id: UUID,
    invitation_token: str,
) -> InvitationRecord | None:
    """Resolve the invitation the presented token proves, or None.

    Lookup is by token (the invitation id), never by email. The presented
    token must match the stored id exactly in canonical form; the comparison
    is constant-time as belt and braces on top of the primary-key lookup.
    """
    token = invitation_token.strip().lower()
    try:
        invitation_id = UUID(token)
    except ValueError:
        return None
    invitation = await invitation_store.get_live_pending_invitation_by_id(
        db,
        organization_id=organization_id,
        invitation_id=invitation_id,
    )
    if invitation is None:
        return None
    if not hmac.compare_digest(token, str(invitation.id)):
        return None
    return invitation


async def register_invited_account(
    db: AsyncSession,
    *,
    email: str,
    password: str,
    invitation_token: str,
) -> SelfRegistration:
    """Create an account for an invited (allowlisted) email, exactly once.

    The whole flow runs in one transaction: if anything fails after the user
    row is created (for example the invitation was revoked in a race), the
    rollback removes the account again.
    """
    if not settings.single_org_mode:
        # Defense in depth: the route is only mounted in single-org mode.
        raise RegistrationClosedError()

    # Same kill switch as password login: while password auth is disabled no
    # password account may be created either.
    ensure_password_auth_enabled()

    try:
        normalized_email = normalize_account_email(email)
        validate_account_password(password)
    except AccountValidationError as exc:
        raise RegistrationValidationError(exc.reason) from exc

    instance_organization = await instance_organization_store.get_instance_organization(db)
    if instance_organization is None:
        # Nothing exists to register into before the first-run claim; the
        # response is indistinguishable from "not invited" on purpose.
        raise _not_invited()

    if not is_email_domain_allowed(normalized_email):
        raise RegistrationNotAllowedError(
            code="registration_domain_not_allowed",
            message="This email domain is not allowed on this instance.",
        )

    invitation = await _live_invitation_for_token(
        db,
        organization_id=instance_organization.id,
        invitation_token=invitation_token,
    )
    if invitation is None or not hmac.compare_digest(invitation.email, normalized_email):
        raise _not_invited()

    if await get_user_by_normalized_email(db, normalized_email) is not None:
        raise RegistrationConflictError()

    user = await create_password_account(db, email=normalized_email, password=password)

    # The membership policy is the one seam that places new identities; in
    # single-org mode it joins the instance org honoring the invitation's role
    # (with the ADMIN_EMAILS floor on top).
    await place_new_identity(db, user)

    # Complete the invitation so it does not linger as pending. The membership
    # already exists, so this only flips the invitation to accepted.
    accepted, error = await invitation_store.accept_pending_invitation_for_organization_email(
        db,
        organization_id=instance_organization.id,
        authenticated_user_id=user.id,
        authenticated_email=normalized_email,
    )
    if accepted is None or error is not None:
        # The invitation vanished between the token check and now (revoked or
        # expired in a race). Fail the registration; the rollback removes the
        # account created above.
        raise _not_invited()

    return SelfRegistration(
        user_id=user.id,
        email=normalized_email,
        organization_id=instance_organization.id,
        organization_name=instance_organization.name,
    )
