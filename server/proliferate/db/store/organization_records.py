"""Typed organization store records."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from proliferate.db.models.organizations import (
    Organization,
    OrganizationInvitation,
    OrganizationMembership,
)


@dataclass(frozen=True)
class OrganizationRecord:
    id: UUID
    name: str
    logo_domain: str | None
    logo_image: str | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class MembershipRecord:
    id: UUID
    organization_id: UUID
    user_id: UUID
    role: str
    status: str
    joined_at: datetime
    removed_at: datetime | None


@dataclass(frozen=True)
class MemberRecord:
    membership: MembershipRecord
    email: str
    display_name: str | None
    avatar_url: str | None


@dataclass(frozen=True)
class InvitationRecord:
    id: UUID
    organization_id: UUID
    email: str
    role: str
    status: str
    delivery_status: str
    delivery_error: str | None
    expires_at: datetime
    delivered_at: datetime | None
    invited_by_user_id: UUID
    accepted_by_user_id: UUID | None
    accepted_at: datetime | None
    revoked_at: datetime | None
    expired_at: datetime | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class OrganizationWithMembershipRecord:
    organization: OrganizationRecord
    membership: MembershipRecord


@dataclass(frozen=True)
class InvitationCreateRecord:
    invitation: InvitationRecord
    organization: OrganizationRecord


@dataclass(frozen=True)
class InvitationHandoffRecord:
    organization_id: UUID
    organization_name: str
    invite_email: str
    handoff_token: str


@dataclass(frozen=True)
class InvitationAcceptRecord:
    organization: OrganizationRecord
    membership: MembershipRecord


def normalize_invitation_email(email: str) -> str:
    return email.strip().lower()


def organization_record(organization: Organization) -> OrganizationRecord:
    return OrganizationRecord(
        id=organization.id,
        name=organization.name,
        logo_domain=organization.logo_domain,
        logo_image=organization.logo_image,
        created_at=organization.created_at,
        updated_at=organization.updated_at,
    )


def membership_record(membership: OrganizationMembership) -> MembershipRecord:
    return MembershipRecord(
        id=membership.id,
        organization_id=membership.organization_id,
        user_id=membership.user_id,
        role=membership.role,
        status=membership.status,
        joined_at=membership.joined_at,
        removed_at=membership.removed_at,
    )


def invitation_record(invitation: OrganizationInvitation) -> InvitationRecord:
    return InvitationRecord(
        id=invitation.id,
        organization_id=invitation.organization_id,
        email=invitation.email,
        role=invitation.role,
        status=invitation.status,
        delivery_status=invitation.delivery_status,
        delivery_error=invitation.delivery_error,
        expires_at=invitation.expires_at,
        delivered_at=invitation.delivered_at,
        invited_by_user_id=invitation.invited_by_user_id,
        accepted_by_user_id=invitation.accepted_by_user_id,
        accepted_at=invitation.accepted_at,
        revoked_at=invitation.revoked_at,
        expired_at=invitation.expired_at,
        created_at=invitation.created_at,
        updated_at=invitation.updated_at,
    )
