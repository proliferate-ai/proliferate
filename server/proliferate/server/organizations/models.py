"""Organization API schemas."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from proliferate.db.store.organization_records import (
    InvitationRecord,
    MemberRecord,
    MembershipRecord,
    OrganizationRecord,
    OrganizationWithMembershipRecord,
)

OrganizationRole = Literal["owner", "admin", "member"]
OrganizationMembershipStatus = Literal["active", "removed"]
OrganizationInvitationStatus = Literal["pending", "accepted", "revoked", "expired"]
OrganizationInvitationDeliveryStatus = Literal["pending", "sent", "failed", "skipped"]
OwnerScope = Literal["personal", "organization"]


class OrganizationBaseModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class OwnerSelectionRequest(OrganizationBaseModel):
    owner_scope: OwnerScope = Field(default="personal", alias="ownerScope")
    organization_id: str | None = Field(default=None, alias="organizationId")


class OrganizationUpdateRequest(OrganizationBaseModel):
    name: str | None = None
    logo_image: str | None = Field(default=None, alias="logoImage")


class OrganizationInviteRequest(OrganizationBaseModel):
    email: EmailStr
    role: OrganizationRole = "member"


class OrganizationMembershipUpdateRequest(OrganizationBaseModel):
    role: OrganizationRole | None = None
    status: OrganizationMembershipStatus | None = None


class OrganizationInvitationAcceptRequest(OrganizationBaseModel):
    invite_handoff: str = Field(alias="inviteHandoff")


class OrganizationMembershipResponse(OrganizationBaseModel):
    id: str
    organization_id: str = Field(alias="organizationId")
    user_id: str = Field(alias="userId")
    role: OrganizationRole
    status: OrganizationMembershipStatus
    joined_at: str = Field(alias="joinedAt")
    removed_at: str | None = Field(default=None, alias="removedAt")


class OrganizationResponse(OrganizationBaseModel):
    id: str
    name: str
    logo_domain: str | None = Field(default=None, alias="logoDomain")
    logo_image: str | None = Field(default=None, alias="logoImage")
    membership: OrganizationMembershipResponse | None = None


class OrganizationMemberResponse(OrganizationBaseModel):
    membership_id: str = Field(alias="membershipId")
    user_id: str = Field(alias="userId")
    email: str
    display_name: str | None = Field(default=None, alias="displayName")
    avatar_url: str | None = Field(default=None, alias="avatarUrl")
    role: OrganizationRole
    status: OrganizationMembershipStatus
    joined_at: str = Field(alias="joinedAt")
    removed_at: str | None = Field(default=None, alias="removedAt")


class OrganizationInvitationResponse(OrganizationBaseModel):
    id: str
    organization_id: str = Field(alias="organizationId")
    email: str
    role: OrganizationRole
    status: OrganizationInvitationStatus
    delivery_status: OrganizationInvitationDeliveryStatus = Field(alias="deliveryStatus")
    delivery_error: str | None = Field(default=None, alias="deliveryError")
    expires_at: str = Field(alias="expiresAt")
    delivered_at: str | None = Field(default=None, alias="deliveredAt")
    accepted_by_user_id: str | None = Field(default=None, alias="acceptedByUserId")
    accepted_at: str | None = Field(default=None, alias="acceptedAt")
    revoked_at: str | None = Field(default=None, alias="revokedAt")
    expired_at: str | None = Field(default=None, alias="expiredAt")
    created_at: str = Field(alias="createdAt")


class OrganizationListResponse(OrganizationBaseModel):
    organizations: list[OrganizationResponse]


class OrganizationMembersResponse(OrganizationBaseModel):
    members: list[OrganizationMemberResponse]


class OrganizationInvitationsResponse(OrganizationBaseModel):
    invitations: list[OrganizationInvitationResponse]


class OrganizationInvitationAcceptResponse(OrganizationBaseModel):
    organization: OrganizationResponse


def _iso(value: object) -> str | None:
    return value.isoformat() if hasattr(value, "isoformat") else (str(value) if value else None)


def membership_response(record: MembershipRecord) -> OrganizationMembershipResponse:
    return OrganizationMembershipResponse(
        id=str(record.id),
        organization_id=str(record.organization_id),
        user_id=str(record.user_id),
        role=record.role,  # type: ignore[arg-type]
        status=record.status,  # type: ignore[arg-type]
        joined_at=_iso(record.joined_at) or "",
        removed_at=_iso(record.removed_at),
    )


def organization_response(
    organization: OrganizationRecord,
    membership: MembershipRecord | None = None,
) -> OrganizationResponse:
    return OrganizationResponse(
        id=str(organization.id),
        name=organization.name,
        logo_domain=organization.logo_domain,
        logo_image=organization.logo_image,
        membership=membership_response(membership) if membership is not None else None,
    )


def organization_with_membership_response(
    record: OrganizationWithMembershipRecord,
) -> OrganizationResponse:
    return organization_response(record.organization, record.membership)


def member_response(record: MemberRecord) -> OrganizationMemberResponse:
    membership = record.membership
    return OrganizationMemberResponse(
        membership_id=str(membership.id),
        user_id=str(membership.user_id),
        email=record.email,
        display_name=record.display_name,
        avatar_url=record.avatar_url,
        role=membership.role,  # type: ignore[arg-type]
        status=membership.status,  # type: ignore[arg-type]
        joined_at=_iso(membership.joined_at) or "",
        removed_at=_iso(membership.removed_at),
    )


def invitation_response(record: InvitationRecord) -> OrganizationInvitationResponse:
    return OrganizationInvitationResponse(
        id=str(record.id),
        organization_id=str(record.organization_id),
        email=record.email,
        role=record.role,  # type: ignore[arg-type]
        status=record.status,  # type: ignore[arg-type]
        delivery_status=record.delivery_status,  # type: ignore[arg-type]
        delivery_error=record.delivery_error,
        expires_at=_iso(record.expires_at) or "",
        delivered_at=_iso(record.delivered_at),
        accepted_by_user_id=(
            str(record.accepted_by_user_id) if record.accepted_by_user_id is not None else None
        ),
        accepted_at=_iso(record.accepted_at),
        revoked_at=_iso(record.revoked_at),
        expired_at=_iso(record.expired_at),
        created_at=_iso(record.created_at) or "",
    )
