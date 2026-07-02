"""Organization service layer."""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import timedelta
from typing import Protocol
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.billing import BILLING_SUBJECT_KIND_PERSONAL
from proliferate.constants.organizations import (
    ORGANIZATION_INVITE_EXPIRES_DAYS,
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_MEMBERSHIP_STATUS_REMOVED,
    ORGANIZATION_ROLE_OWNER,
)
from proliferate.db.store import organization_invitations as invitation_store
from proliferate.db.store import organization_member_auth_methods as member_auth_method_store
from proliferate.db.store import organizations as organization_store
from proliferate.db.store.organization_records import (
    InvitationRecord,
    MemberRecord,
    MembershipRecord,
    OrganizationWithMembershipRecord,
    normalize_invitation_email,
)
from proliferate.permissions import (
    CurrentOrgUser,
    OwnerContext,
    OwnerSelection,
)
from proliferate.server.billing.seat_reconciliation import (
    maybe_create_organization_seat_adjustment,
)
from proliferate.server.billing.subjects import (
    ensure_organization_billing_subject_state,
    ensure_personal_billing_subject_state,
)
from proliferate.server.organizations import invitation_delivery
from proliferate.server.organizations.admin_emails import is_admin_listed_email
from proliferate.server.organizations.domain.policy import (
    is_membership_update_status,
    is_organization_role,
    organization_admin_roles,
    required_roles_for_invitation_role,
)
from proliferate.server.organizations.domain.profile import (
    OrganizationProfileIssue,
    clean_organization_name,
    default_organization_name,
    derive_logo_domain_from_email,
    organization_name_issue,
    sanitize_logo_image,
)
from proliferate.server.organizations.errors import OrganizationServiceError
from proliferate.server.organizations.join_links import organization_join_url
from proliferate.server.organizations.landing import build_join_landing_html
from proliferate.utils.time import utcnow

OrganizationMembershipRecords = list[OrganizationWithMembershipRecord]


@dataclass(frozen=True)
class OrganizationInvitationEmailResult:
    invitation: InvitationRecord
    delivery_attempted: bool


class OrganizationActor(Protocol):
    id: UUID
    email: str
    display_name: str | None


def _default_organization_name(actor_user: OrganizationActor) -> str:
    return default_organization_name(
        email=actor_user.email,
        display_name=actor_user.display_name,
    )


def _raise_organization_issue(issue: OrganizationProfileIssue | None) -> None:
    if issue is not None:
        raise OrganizationServiceError(
            issue.code,
            issue.message,
            status_code=issue.status_code,
        )


def _require_current_org_role(org_user: CurrentOrgUser, roles: frozenset[str]) -> None:
    if org_user.role not in roles:
        raise OrganizationServiceError(
            "organization_permission_denied",
            "You do not have permission to manage this organization.",
            status_code=403,
        )


def _clean_organization_name(name: str) -> str:
    _raise_organization_issue(organization_name_issue(name))
    return clean_organization_name(name)


def _sanitize_logo_image(value: str | None) -> str | None:
    result = sanitize_logo_image(value)
    _raise_organization_issue(result.issue)
    return result.logo_image


def _require_role(role: str) -> str:
    if not is_organization_role(role):
        raise OrganizationServiceError(
            "invalid_role",
            "Invalid organization role.",
            status_code=400,
        )
    return role


def _require_uuid(value: str | UUID | None, *, field: str) -> UUID:
    if isinstance(value, UUID):
        return value
    if not value:
        raise OrganizationServiceError(
            "missing_organization_id",
            f"{field} is required for organization scope.",
            status_code=400,
        )
    try:
        return UUID(value)
    except ValueError as exc:
        raise OrganizationServiceError(
            "invalid_organization_id",
            f"{field} must be a valid UUID.",
            status_code=400,
        ) from exc


def _org_not_found() -> OrganizationServiceError:
    return OrganizationServiceError(
        "organization_not_found",
        "Organization not found.",
        status_code=404,
    )


async def resolve_owner_context(
    actor_user: OrganizationActor,
    owner_selection: OwnerSelection | None = None,
    *,
    db: AsyncSession,
) -> OwnerContext:
    selection = owner_selection or OwnerSelection()
    if selection.owner_scope == "personal":
        if selection.organization_id is not None:
            raise OrganizationServiceError(
                "invalid_owner_selection",
                "organizationId is not valid for personal scope.",
                status_code=400,
            )
        state = await ensure_personal_billing_subject_state(db, actor_user.id)
        if state.kind != BILLING_SUBJECT_KIND_PERSONAL:
            raise OrganizationServiceError(
                "invalid_owner_selection",
                "Personal billing subject could not be resolved.",
                status_code=500,
            )
        return OwnerContext(
            owner_scope="personal",
            actor_user_id=actor_user.id,
            owner_user_id=actor_user.id,
            organization_id=None,
            membership_id=None,
            membership_role=None,
            billing_subject_id=state.billing_subject_id,
        )

    organization_id = _require_uuid(selection.organization_id, field="organizationId")
    record = await organization_store.get_organization_with_membership(
        db,
        organization_id=organization_id,
        user_id=actor_user.id,
    )
    if record is None:
        raise _org_not_found()
    subject = await ensure_organization_billing_subject_state(db, organization_id)
    membership = record.membership
    billing_subject_id = subject.billing_subject_id
    return OwnerContext(
        owner_scope="organization",
        actor_user_id=actor_user.id,
        owner_user_id=None,
        organization_id=organization_id,
        membership_id=membership.id,
        membership_role=membership.role,
        billing_subject_id=billing_subject_id,
    )


async def list_organizations(
    db: AsyncSession,
    actor_user: OrganizationActor,
) -> OrganizationMembershipRecords:
    return await organization_store.ensure_default_organization_for_user(
        db,
        user_id=actor_user.id,
        name=_default_organization_name(actor_user),
        logo_domain=derive_logo_domain_from_email(actor_user.email),
    )


async def get_organization(
    db: AsyncSession,
    org_user: CurrentOrgUser,
) -> OrganizationWithMembershipRecord:
    record = await organization_store.get_organization_with_membership(
        db,
        organization_id=org_user.organization_id,
        user_id=org_user.actor_user_id,
    )
    if record is None:
        raise _org_not_found()
    return record


async def update_organization(
    db: AsyncSession,
    org_user: CurrentOrgUser,
    *,
    name: str | None,
    logo_image: str | None,
    update_logo_image: bool,
) -> OrganizationWithMembershipRecord:
    _require_current_org_role(org_user, organization_admin_roles())
    updated = await organization_store.update_organization_settings(
        db,
        organization_id=org_user.organization_id,
        name=_clean_organization_name(name) if name is not None else None,
        logo_image=_sanitize_logo_image(logo_image) if update_logo_image else None,
        update_logo_image=update_logo_image,
    )
    if updated is None:
        raise _org_not_found()
    return OrganizationWithMembershipRecord(
        organization=updated,
        membership=(await get_organization(db, org_user)).membership,
    )


async def list_members(
    db: AsyncSession,
    org_user: CurrentOrgUser,
) -> list[MemberRecord]:
    members = await organization_store.list_organization_members(db, org_user.organization_id)
    auth_methods = await member_auth_method_store.list_member_auth_methods(
        db,
        organization_id=org_user.organization_id,
        user_ids=[member.membership.user_id for member in members],
    )
    return [
        replace(member, auth_methods=tuple(auth_methods.get(member.membership.user_id, ())))
        for member in members
    ]


async def update_membership(
    db: AsyncSession,
    org_user: CurrentOrgUser,
    membership_id: UUID,
    *,
    role: str | None,
    status: str | None,
) -> MembershipRecord:
    _require_current_org_role(org_user, organization_admin_roles())
    if org_user.membership_id == membership_id:
        raise OrganizationServiceError(
            "cannot_modify_own_membership",
            "You cannot modify your own organization membership.",
            status_code=403,
        )
    can_modify_owner = org_user.role == ORGANIZATION_ROLE_OWNER
    if role is not None:
        _require_role(role)
    if status is not None and not is_membership_update_status(status):
        raise OrganizationServiceError(
            "invalid_membership_status",
            "Invalid membership status.",
            status_code=400,
        )
    await _enforce_instance_admin_invariants(
        db,
        org_user=org_user,
        membership_id=membership_id,
        role=role,
        status=status,
    )
    membership, error = await organization_store.update_organization_membership(
        db,
        organization_id=org_user.organization_id,
        membership_id=membership_id,
        role=role,
        status=status,
        can_modify_owner=can_modify_owner,
    )
    if error == "owner_membership_requires_owner":
        raise OrganizationServiceError(
            error,
            "Only organization owners can modify owners.",
            status_code=403,
        )
    if error == "last_owner_cannot_be_removed":
        raise OrganizationServiceError(
            error,
            "The last organization owner cannot be removed or downgraded.",
            status_code=409,
        )
    if membership is None:
        raise _org_not_found()
    if status is not None:
        await maybe_create_organization_seat_adjustment(
            db,
            organization_id=org_user.organization_id,
            membership_id=membership.id,
        )
    return membership


async def _enforce_instance_admin_invariants(
    db: AsyncSession,
    *,
    org_user: CurrentOrgUser,
    membership_id: UUID,
    role: str | None,
    status: str | None,
) -> None:
    """Admin invariants for the instance organization (single-org mode).

    Two rules, both scoped to THE instance org so hosted-mode organizations
    are untouched:

    - a user listed in ADMIN_EMAILS cannot be given a role below admin
      (the env is a floor; see ``admin_emails`` module docstring)
    - the instance org must always keep at least one active admin, so the
      last admin cannot be demoted or removed
    """
    demotes_below_admin = role is not None and role not in organization_admin_roles()
    removes_membership = status == ORGANIZATION_MEMBERSHIP_STATUS_REMOVED
    if not demotes_below_admin and not removes_membership:
        return
    instance_organization = await organization_store.get_instance_organization(db)
    if instance_organization is None or instance_organization.id != org_user.organization_id:
        return
    member = await organization_store.get_organization_member(
        db,
        organization_id=org_user.organization_id,
        membership_id=membership_id,
    )
    if member is None or member.membership.status != ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE:
        return
    if demotes_below_admin and is_admin_listed_email(member.email):
        raise OrganizationServiceError(
            "admin_email_role_floor",
            "This user is listed in ADMIN_EMAILS and must keep at least the admin role.",
            status_code=409,
        )
    if member.membership.role not in organization_admin_roles():
        return
    # Serialize with concurrent membership updates so two demotions cannot
    # both observe a safe admin count and drop the org to zero admins.
    await organization_store.acquire_organization_membership_lock(db, org_user.organization_id)
    if await organization_store.count_active_admin_memberships(db, org_user.organization_id) <= 1:
        raise OrganizationServiceError(
            "last_admin_cannot_be_removed",
            "The last admin of this instance cannot be demoted or removed.",
            status_code=409,
        )


async def remove_membership(
    db: AsyncSession,
    org_user: CurrentOrgUser,
    membership_id: UUID,
) -> MembershipRecord:
    return await update_membership(
        db,
        org_user,
        membership_id,
        role=None,
        status=ORGANIZATION_MEMBERSHIP_STATUS_REMOVED,
    )


async def create_invitation(
    db: AsyncSession,
    org_user: CurrentOrgUser,
    *,
    inviter_email: str,
    email: str,
    role: str,
) -> OrganizationInvitationEmailResult:
    _require_current_org_role(org_user, required_roles_for_invitation_role(role))
    normalized_email = normalize_invitation_email(email)
    result = await invitation_delivery.create_and_send_invitation(
        organization_id=org_user.organization_id,
        email=normalized_email,
        role=_require_role(role),
        invited_by_user_id=org_user.actor_user_id,
        expires_at=utcnow() + timedelta(days=ORGANIZATION_INVITE_EXPIRES_DAYS),
        inviter_email=inviter_email,
    )
    if result is None:
        raise _org_not_found()
    return OrganizationInvitationEmailResult(
        invitation=result.invitation,
        delivery_attempted=result.delivery_attempted,
    )


async def resend_invitation(
    db: AsyncSession,
    org_user: CurrentOrgUser,
    invitation_id: UUID,
    *,
    inviter_email: str,
) -> OrganizationInvitationEmailResult:
    _require_current_org_role(org_user, organization_admin_roles())
    result = await invitation_delivery.rotate_and_send_invitation(
        organization_id=org_user.organization_id,
        invitation_id=invitation_id,
        expires_at=utcnow() + timedelta(days=ORGANIZATION_INVITE_EXPIRES_DAYS),
        inviter_email=inviter_email,
    )
    if result is None:
        raise OrganizationServiceError(
            "invitation_not_found",
            "Organization invitation not found.",
            status_code=404,
        )
    return OrganizationInvitationEmailResult(
        invitation=result.invitation,
        delivery_attempted=result.delivery_attempted,
    )


async def list_invitations(
    db: AsyncSession,
    org_user: CurrentOrgUser,
) -> list[InvitationRecord]:
    return await invitation_store.list_organization_invitations(db, org_user.organization_id)


async def list_current_user_invitations(
    db: AsyncSession,
    actor_user: OrganizationActor,
) -> list[InvitationRecord]:
    return await invitation_store.list_pending_invitations_for_email(db, actor_user.email)


async def accept_current_user_invitation(
    db: AsyncSession,
    actor_user: OrganizationActor,
    invitation_id: UUID,
) -> OrganizationWithMembershipRecord:
    accepted, error = await invitation_store.accept_pending_invitation_for_email(
        db,
        invitation_id=invitation_id,
        authenticated_user_id=actor_user.id,
        authenticated_email=actor_user.email,
    )
    if accepted is None:
        accept_error = _build_invitation_accept_error(error)
        raise accept_error
    await maybe_create_organization_seat_adjustment(
        db,
        organization_id=accepted.organization.id,
        membership_id=accepted.membership.id,
    )
    return OrganizationWithMembershipRecord(
        organization=accepted.organization,
        membership=accepted.membership,
    )


async def revoke_invitation(
    db: AsyncSession,
    org_user: CurrentOrgUser,
    invitation_id: UUID,
) -> InvitationRecord:
    _require_current_org_role(org_user, organization_admin_roles())
    invitation = await invitation_store.revoke_organization_invitation(
        db,
        organization_id=org_user.organization_id,
        invitation_id=invitation_id,
    )
    if invitation is None:
        raise OrganizationServiceError(
            "invitation_not_found",
            "Organization invitation not found.",
            status_code=404,
        )
    return invitation


def get_organization_join_link(organization_id: UUID) -> str:
    return organization_join_url(organization_id)


async def create_organization_join_landing(
    db: AsyncSession,
    organization_id: UUID,
) -> str:
    organization = await organization_store.get_organization(db, organization_id)
    if organization is None:
        raise _org_not_found()
    return build_join_landing_html(organization.name, organization.id)


async def accept_invitation(
    db: AsyncSession,
    actor_user: OrganizationActor,
    *,
    organization_id: UUID,
) -> OrganizationWithMembershipRecord:
    accepted, error = await invitation_store.accept_pending_invitation_for_organization_email(
        db,
        organization_id=organization_id,
        authenticated_user_id=actor_user.id,
        authenticated_email=actor_user.email,
    )
    if accepted is None:
        accept_error = _build_invitation_accept_error(error)
        raise accept_error
    await maybe_create_organization_seat_adjustment(
        db,
        organization_id=accepted.organization.id,
        membership_id=accepted.membership.id,
    )
    return OrganizationWithMembershipRecord(
        organization=accepted.organization,
        membership=accepted.membership,
    )


def _build_invitation_accept_error(
    error: str | None,
) -> OrganizationServiceError:
    status_code = 403 if error == "invitation_email_mismatch" else 404
    message = (
        "This invitation was sent to a different email address."
        if error == "invitation_email_mismatch"
        else "Organization invitation not found or expired."
    )
    return OrganizationServiceError(
        error or "invalid_invitation",
        message,
        status_code=status_code,
    )
