"""Organization service layer."""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import timedelta
from typing import Protocol
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.sso.branding import (
    sso_brand_label_for_connection,
    sso_brand_label_from_subject,
)
from proliferate.auth.sso.deployment_config import deployment_sso_connection
from proliferate.auth.sso.types import DEPLOYMENT_SSO_CONNECTION_KEY
from proliferate.constants.billing import BILLING_SUBJECT_KIND_PERSONAL
from proliferate.constants.organizations import (
    ORGANIZATION_INVITE_EXPIRES_DAYS,
    ORGANIZATION_MEMBERSHIP_STATUS_REMOVED,
    ORGANIZATION_ROLE_OWNER,
)
from proliferate.db.models.auth import AuthIdentity, OAuthAccount, SsoConnection, SsoIdentity
from proliferate.db.store import organization_invitations as invitation_store
from proliferate.db.store import organizations as organization_store
from proliferate.db.store.organization_records import (
    InvitationRecord,
    MemberAuthMethodRecord,
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
    auth_methods = await _auth_methods_for_members(
        db,
        user_ids=[member.membership.user_id for member in members],
    )
    return [
        replace(member, auth_methods=tuple(auth_methods.get(member.membership.user_id, ())))
        for member in members
    ]


async def _auth_methods_for_members(
    db: AsyncSession,
    *,
    user_ids: list[UUID],
) -> dict[UUID, list[MemberAuthMethodRecord]]:
    if not user_ids:
        return {}
    unique_user_ids = tuple(dict.fromkeys(user_ids))
    methods: dict[UUID, list[MemberAuthMethodRecord]] = {
        user_id: [] for user_id in unique_user_ids
    }
    seen: dict[UUID, set[str]] = {user_id: set() for user_id in unique_user_ids}

    for user_id, provider in (
        await db.execute(
            select(AuthIdentity.user_id, AuthIdentity.provider)
            .where(AuthIdentity.user_id.in_(unique_user_ids))
            .order_by(
                AuthIdentity.user_id.asc(),
                AuthIdentity.provider.asc(),
                AuthIdentity.linked_at.asc(),
            )
        )
    ).all():
        _append_member_auth_method(
            methods,
            seen,
            user_id,
            MemberAuthMethodRecord(provider=provider, label=_auth_provider_label(provider)),
        )

    for user_id, provider in (
        await db.execute(
            select(OAuthAccount.user_id, OAuthAccount.oauth_name)
            .where(
                OAuthAccount.user_id.in_(unique_user_ids),
                OAuthAccount.oauth_name.in_(("github", "google")),
            )
            .order_by(OAuthAccount.user_id.asc(), OAuthAccount.oauth_name.asc())
        )
    ).all():
        _append_member_auth_method(
            methods,
            seen,
            user_id,
            MemberAuthMethodRecord(provider=provider, label=_auth_provider_label(provider)),
        )

    sso_rows = (
        await db.execute(
            select(SsoIdentity, SsoConnection)
            .outerjoin(SsoConnection, SsoConnection.id == SsoIdentity.connection_id)
            .where(SsoIdentity.user_id.in_(unique_user_ids))
            .order_by(SsoIdentity.user_id.asc(), SsoIdentity.linked_at.asc())
        )
    ).all()
    for identity, connection in sso_rows:
        connection_record = connection
        if connection_record is None and identity.connection_key == DEPLOYMENT_SSO_CONNECTION_KEY:
            connection_record = deployment_sso_connection()
        if connection_record is not None:
            display_name = connection_record.display_name
            brand_label = sso_brand_label_for_connection(
                connection_record,
                identity.provider_subject,
            )
        else:
            display_name = "SSO"
            brand_label = sso_brand_label_from_subject(identity.provider_subject)
        _append_member_auth_method(
            methods,
            seen,
            identity.user_id,
            MemberAuthMethodRecord(
                provider="sso",
                label=display_name,
                brand_label=brand_label,
            ),
            dedupe_key=f"sso:{brand_label or display_name}:{identity.connection_key}",
        )
    return methods


def _append_member_auth_method(
    methods: dict[UUID, list[MemberAuthMethodRecord]],
    seen: dict[UUID, set[str]],
    user_id: UUID,
    method: MemberAuthMethodRecord,
    *,
    dedupe_key: str | None = None,
) -> None:
    key = dedupe_key or method.provider
    if key in seen[user_id]:
        return
    seen[user_id].add(key)
    methods[user_id].append(method)


def _auth_provider_label(provider: str) -> str:
    if provider == "github":
        return "GitHub"
    if provider == "google":
        return "Google"
    if provider == "apple":
        return "Apple"
    return provider.upper()


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
