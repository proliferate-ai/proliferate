"""Organization service layer."""

from __future__ import annotations

import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import timedelta
from typing import Protocol
from urllib.parse import urlencode
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import (
    OwnerContext,
    OwnerSelection,
    PolicyDenied,
    PolicyVerdict,
    require_org_role,
)
from proliferate.config import settings
from proliferate.constants.billing import BILLING_SUBJECT_KIND_PERSONAL
from proliferate.constants.organizations import (
    ORGANIZATION_INVITE_EXPIRES_DAYS,
    ORGANIZATION_INVITE_HANDOFF_EXPIRES_MINUTES,
    ORGANIZATION_INVITE_HANDOFF_TOKEN_DOMAIN,
    ORGANIZATION_INVITE_TOKEN_DOMAIN,
    ORGANIZATION_MEMBERSHIP_STATUS_REMOVED,
)
from proliferate.db.store import organization_invitations as invitation_store
from proliferate.db.store import organizations as organization_store
from proliferate.db.store.billing import get_or_create_stripe_customer_state_for_user
from proliferate.db.store.organization_records import (
    InvitationCreateRecord,
    InvitationRecord,
    MemberRecord,
    MembershipRecord,
    OrganizationWithMembershipRecord,
    normalize_invitation_email,
)
from proliferate.integrations import resend
from proliferate.server.organizations.domain.policy import (
    can_modify_membership,
    can_modify_owner_memberships,
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
from proliferate.server.organizations.landing import build_landing_html
from proliferate.utils.time import utcnow

OrganizationMembershipRecords = list[OrganizationWithMembershipRecord]


@dataclass(frozen=True)
class OrganizationInvitationEmailResult:
    invitation: InvitationRecord
    delivery_attempted: bool


@dataclass(frozen=True)
class InvitationDeliveryResult:
    sent: bool
    skipped: bool


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


def _raise_if_denied(verdict: PolicyVerdict) -> None:
    if isinstance(verdict, PolicyDenied):
        raise OrganizationServiceError(
            verdict.code,
            verdict.message,
            status_code=verdict.status_code,
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
) -> OwnerContext:
    selection = owner_selection or OwnerSelection()
    if selection.owner_scope == "personal":
        if selection.organization_id is not None:
            raise OrganizationServiceError(
                "invalid_owner_selection",
                "organizationId is not valid for personal scope.",
                status_code=400,
            )
        state = await get_or_create_stripe_customer_state_for_user(actor_user.id)
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
    record = await organization_store.load_organization_with_membership(
        organization_id=organization_id,
        user_id=actor_user.id,
    )
    if record is None:
        raise _org_not_found()
    billing_subject_id = await organization_store.ensure_organization_billing_subject_id(
        organization_id,
    )
    return OwnerContext(
        owner_scope="organization",
        actor_user_id=actor_user.id,
        owner_user_id=None,
        organization_id=organization_id,
        membership_id=record.membership.id,
        membership_role=record.membership.role,
        billing_subject_id=billing_subject_id,
    )


async def list_organizations(
    db: AsyncSession,
    actor_user: OrganizationActor,
) -> OrganizationMembershipRecords:
    records = await organization_store.list_organizations_for_user(db, actor_user.id)
    if records:
        return records
    return await organization_store.ensure_default_organization_for_user(
        db,
        user_id=actor_user.id,
        name=_default_organization_name(actor_user),
        logo_domain=derive_logo_domain_from_email(actor_user.email),
    )


async def get_organization(
    db: AsyncSession,
    actor_user: OrganizationActor,
    organization_id: UUID,
) -> OrganizationWithMembershipRecord:
    record = await organization_store.get_organization_with_membership(
        db,
        organization_id=organization_id,
        user_id=actor_user.id,
    )
    if record is None:
        raise _org_not_found()
    return record


async def update_organization(
    db: AsyncSession,
    actor_user: OrganizationActor,
    organization_id: UUID,
    *,
    name: str | None,
    logo_image: str | None,
    update_logo_image: bool,
) -> OrganizationWithMembershipRecord:
    context = await resolve_owner_context(
        actor_user,
        OwnerSelection(owner_scope="organization", organization_id=organization_id),
    )
    require_org_role(context, organization_admin_roles())
    updated = await organization_store.update_organization_settings(
        organization_id=organization_id,
        name=_clean_organization_name(name) if name is not None else None,
        logo_image=_sanitize_logo_image(logo_image) if update_logo_image else None,
        update_logo_image=update_logo_image,
    )
    if updated is None:
        raise _org_not_found()
    return OrganizationWithMembershipRecord(
        organization=updated,
        membership=(await get_organization(db, actor_user, organization_id)).membership,
    )


async def list_members(
    actor_user: OrganizationActor,
    organization_id: UUID,
) -> list[MemberRecord]:
    await resolve_owner_context(
        actor_user,
        OwnerSelection(owner_scope="organization", organization_id=organization_id),
    )
    return await organization_store.list_organization_members(organization_id)


async def update_membership(
    actor_user: OrganizationActor,
    organization_id: UUID,
    membership_id: UUID,
    *,
    role: str | None,
    status: str | None,
) -> MembershipRecord:
    context = await resolve_owner_context(
        actor_user,
        OwnerSelection(owner_scope="organization", organization_id=organization_id),
    )
    require_org_role(context, organization_admin_roles())
    _raise_if_denied(can_modify_membership(context, membership_id))
    can_modify_owner = can_modify_owner_memberships(context)
    if role is not None:
        _require_role(role)
    if status is not None and not is_membership_update_status(status):
        raise OrganizationServiceError(
            "invalid_membership_status",
            "Invalid membership status.",
            status_code=400,
        )
    membership, error = await organization_store.update_organization_membership(
        organization_id=organization_id,
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
    return membership


async def remove_membership(
    actor_user: OrganizationActor,
    organization_id: UUID,
    membership_id: UUID,
) -> MembershipRecord:
    return await update_membership(
        actor_user,
        organization_id,
        membership_id,
        role=None,
        status=ORGANIZATION_MEMBERSHIP_STATUS_REMOVED,
    )


async def create_invitation(
    actor_user: OrganizationActor,
    organization_id: UUID,
    *,
    email: str,
    role: str,
) -> OrganizationInvitationEmailResult:
    context = await resolve_owner_context(
        actor_user,
        OwnerSelection(owner_scope="organization", organization_id=organization_id),
    )
    require_org_role(context, required_roles_for_invitation_role(role))
    normalized_email = normalize_invitation_email(email)
    token = _new_token()
    record = await invitation_store.create_or_rotate_organization_invitation(
        organization_id=organization_id,
        email=normalized_email,
        role=_require_role(role),
        token_hash=_hash_token(token, ORGANIZATION_INVITE_TOKEN_DOMAIN),
        invited_by_user_id=actor_user.id,
        expires_at=utcnow() + timedelta(days=ORGANIZATION_INVITE_EXPIRES_DAYS),
    )
    if record is None:
        raise _org_not_found()
    delivery = await _send_invitation_email(record, token, actor_user)
    invitation = record.invitation
    if delivery.sent or delivery.skipped:
        invitation = (
            await invitation_store.mark_invitation_delivery(
                invitation_id=record.invitation.id,
                sent=delivery.sent,
                skipped=delivery.skipped,
            )
            or record.invitation
        )
    return OrganizationInvitationEmailResult(
        invitation=invitation,
        delivery_attempted=delivery.sent,
    )


async def resend_invitation(
    actor_user: OrganizationActor,
    organization_id: UUID,
    invitation_id: UUID,
) -> OrganizationInvitationEmailResult:
    context = await resolve_owner_context(
        actor_user,
        OwnerSelection(owner_scope="organization", organization_id=organization_id),
    )
    require_org_role(context, organization_admin_roles())
    token = _new_token()
    record = await invitation_store.rotate_organization_invitation(
        organization_id=organization_id,
        invitation_id=invitation_id,
        token_hash=_hash_token(token, ORGANIZATION_INVITE_TOKEN_DOMAIN),
        expires_at=utcnow() + timedelta(days=ORGANIZATION_INVITE_EXPIRES_DAYS),
    )
    if record is None:
        raise OrganizationServiceError(
            "invitation_not_found",
            "Organization invitation not found.",
            status_code=404,
        )
    delivery = await _send_invitation_email(record, token, actor_user)
    invitation = record.invitation
    if delivery.sent or delivery.skipped:
        invitation = (
            await invitation_store.mark_invitation_delivery(
                invitation_id=record.invitation.id,
                sent=delivery.sent,
                skipped=delivery.skipped,
            )
            or record.invitation
        )
    return OrganizationInvitationEmailResult(
        invitation=invitation,
        delivery_attempted=delivery.sent,
    )


async def _send_invitation_email(
    record: InvitationCreateRecord,
    token: str,
    actor_user: OrganizationActor,
) -> InvitationDeliveryResult:
    invite_url = _invitation_landing_url(token)
    try:
        result = await resend.send_organization_invitation_email(
            to_email=record.invitation.email,
            organization_name=record.organization.name,
            inviter_email=actor_user.email,
            invite_url=invite_url,
        )
    except resend.ResendEmailError as error:
        await invitation_store.mark_invitation_delivery(
            invitation_id=record.invitation.id,
            sent=False,
            skipped=False,
            error=error.message,
        )
        return InvitationDeliveryResult(sent=False, skipped=False)
    return InvitationDeliveryResult(sent=not result.skipped, skipped=result.skipped)


def _invitation_landing_url(token: str) -> str:
    path = "/v1/organizations/invitations/landing"
    query = urlencode({"token": token})
    base_url = (settings.api_base_url or settings.frontend_base_url).rstrip("/")
    if not base_url:
        return f"{path}?{query}"
    return f"{base_url}{path}?{query}"


async def list_invitations(
    actor_user: OrganizationActor,
    organization_id: UUID,
) -> list[InvitationRecord]:
    await resolve_owner_context(
        actor_user,
        OwnerSelection(owner_scope="organization", organization_id=organization_id),
    )
    return await invitation_store.list_organization_invitations(organization_id)


async def revoke_invitation(
    actor_user: OrganizationActor,
    organization_id: UUID,
    invitation_id: UUID,
) -> InvitationRecord:
    context = await resolve_owner_context(
        actor_user,
        OwnerSelection(owner_scope="organization", organization_id=organization_id),
    )
    require_org_role(context, organization_admin_roles())
    invitation = await invitation_store.revoke_organization_invitation(
        organization_id=organization_id,
        invitation_id=invitation_id,
    )
    if invitation is None:
        raise OrganizationServiceError(
            "invitation_not_found",
            "Organization invitation not found.",
            status_code=404,
        )
    return invitation


async def create_invitation_landing_handoff(raw_token: str) -> str:
    handoff_token = _new_token()
    handoff = await invitation_store.create_invitation_handoff(
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
    actor_user: OrganizationActor,
    invite_handoff: str,
) -> OrganizationWithMembershipRecord:
    accepted, error = await invitation_store.accept_invitation_handoff(
        handoff_token_hash=_hash_token(invite_handoff, ORGANIZATION_INVITE_HANDOFF_TOKEN_DOMAIN),
        authenticated_user_id=actor_user.id,
        authenticated_email=actor_user.email,
    )
    if accepted is None:
        status_code = 403 if error == "invitation_email_mismatch" else 404
        message = (
            "This invitation was sent to a different email address."
            if error == "invitation_email_mismatch"
            else "Organization invitation not found or expired."
        )
        raise OrganizationServiceError(
            error or "invalid_invitation",
            message,
            status_code=status_code,
        )
    return OrganizationWithMembershipRecord(
        organization=accepted.organization,
        membership=accepted.membership,
    )
