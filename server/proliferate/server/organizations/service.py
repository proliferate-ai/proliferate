"""Organization service layer."""

from __future__ import annotations

import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import timedelta
from typing import Protocol
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.billing import BILLING_SUBJECT_KIND_PERSONAL
from proliferate.constants.organizations import (
    ORGANIZATION_INVITE_EXPIRES_DAYS,
    ORGANIZATION_INVITE_HANDOFF_EXPIRES_MINUTES,
    ORGANIZATION_INVITE_HANDOFF_TOKEN_DOMAIN,
    ORGANIZATION_INVITE_TOKEN_DOMAIN,
    ORGANIZATION_MEMBERSHIP_STATUS_REMOVED,
    ORGANIZATION_ROLE_OWNER,
)
from proliferate.db.store import organization_invitations as invitation_store
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
    organization_name_issue,
    sanitize_logo_image,
)
from proliferate.server.organizations.errors import OrganizationServiceError
from proliferate.server.organizations.landing import build_landing_html
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


def _hash_token(raw_token: str, domain: str) -> str:
    return hmac.new(
        settings.cloud_secret_key.encode("utf-8"),
        f"{domain}:{raw_token}".encode(),
        hashlib.sha256,
    ).hexdigest()


def _new_token() -> str:
    return secrets.token_urlsafe(32)


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
    try:
        records = await organization_store.list_organizations_for_user(db, actor_user.id)
    except RuntimeError as exc:
        raise OrganizationServiceError(
            "multiple_active_organizations",
            "This account has multiple active teams. Contact support to repair membership state.",
            status_code=409,
        ) from exc
    if len(records) > 1:
        raise OrganizationServiceError(
            "multiple_active_organizations",
            "This account has multiple active teams. Contact support to repair membership state.",
            status_code=409,
        )
    return records


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
    return await organization_store.list_organization_members(db, org_user.organization_id)


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
    if error == "already_in_organization":
        raise OrganizationServiceError(
            error,
            "This user already belongs to another team.",
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
    token = _new_token()
    result = await invitation_delivery.create_and_send_invitation(
        organization_id=org_user.organization_id,
        email=normalized_email,
        role=_require_role(role),
        token_hash=_hash_token(token, ORGANIZATION_INVITE_TOKEN_DOMAIN),
        invited_by_user_id=org_user.actor_user_id,
        expires_at=utcnow() + timedelta(days=ORGANIZATION_INVITE_EXPIRES_DAYS),
        token=token,
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
    token = _new_token()
    result = await invitation_delivery.rotate_and_send_invitation(
        organization_id=org_user.organization_id,
        invitation_id=invitation_id,
        token_hash=_hash_token(token, ORGANIZATION_INVITE_TOKEN_DOMAIN),
        expires_at=utcnow() + timedelta(days=ORGANIZATION_INVITE_EXPIRES_DAYS),
        token=token,
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
        accept_error = await _build_invitation_accept_error(db, actor_user, error)
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


async def create_invitation_landing_handoff(db: AsyncSession, raw_token: str) -> str:
    handoff_token = _new_token()
    handoff = await invitation_store.create_invitation_handoff(
        db,
        token_hash=_hash_token(raw_token, ORGANIZATION_INVITE_TOKEN_DOMAIN),
        handoff_token_hash=_hash_token(handoff_token, ORGANIZATION_INVITE_HANDOFF_TOKEN_DOMAIN),
        handoff_token=handoff_token,
        handoff_expires_at=utcnow()
        + timedelta(minutes=ORGANIZATION_INVITE_HANDOFF_EXPIRES_MINUTES),
    )
    if handoff is None:
        raise OrganizationServiceError(
            "invitation_not_found",
            "Organization invitation not found or expired.",
            status_code=404,
        )
    return build_landing_html(handoff.organization_name, handoff.handoff_token)


async def accept_invitation(
    db: AsyncSession,
    actor_user: OrganizationActor,
    invite_handoff: str,
) -> OrganizationWithMembershipRecord:
    accepted, error = await invitation_store.accept_invitation_handoff(
        db,
        handoff_token_hash=_hash_token(invite_handoff, ORGANIZATION_INVITE_HANDOFF_TOKEN_DOMAIN),
        authenticated_user_id=actor_user.id,
        authenticated_email=actor_user.email,
    )
    if accepted is None:
        accept_error = await _build_invitation_accept_error(db, actor_user, error)
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


async def _build_invitation_accept_error(
    db: AsyncSession,
    actor_user: OrganizationActor,
    error: str | None,
) -> OrganizationServiceError:
    if error == "already_in_organization":
        current = await organization_store.get_current_membership_for_user(db, actor_user.id)
        extra_detail: dict[str, object] = {}
        if current is not None:
            extra_detail["currentOrganization"] = {
                "id": str(current.organization.id),
                "name": current.organization.name,
            }
        return OrganizationServiceError(
            "already_in_organization",
            "You already belong to a team. Leave your current team before joining this one.",
            status_code=409,
            extra_detail=extra_detail,
        )
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
