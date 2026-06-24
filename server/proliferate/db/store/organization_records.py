"""Typed organization store records."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from proliferate.db.models.organizations import (
    Organization,
    OrganizationCheckoutIntent,
    OrganizationInvitation,
    OrganizationMembership,
)


@dataclass(frozen=True)
class OrganizationRecord:
    id: UUID
    name: str
    logo_domain: str | None
    logo_image: str | None
    status: str
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
    organization_name: str | None
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
class InvitationAcceptRecord:
    organization: OrganizationRecord
    membership: MembershipRecord


@dataclass(frozen=True)
class CheckoutIntentRecord:
    id: UUID
    organization_id: UUID
    created_by_user_id: UUID
    billing_subject_id: UUID
    team_name: str
    status: str
    activation_status: str
    activation_error_code: str | None
    activation_error_message: str | None
    last_webhook_event_id: str | None
    stripe_checkout_session_id: str | None
    stripe_customer_id: str | None
    stripe_subscription_id: str | None
    idempotency_key: str
    invite_emails_json: str | None
    checkout_url: str | None
    expires_at: datetime
    completed_at: datetime | None
    failed_at: datetime | None
    cancelled_at: datetime | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class CheckoutIntentWithOrganizationRecord:
    intent: CheckoutIntentRecord
    organization: OrganizationRecord


def normalize_invitation_email(email: str) -> str:
    return email.strip().lower()


def organization_record(organization: Organization) -> OrganizationRecord:
    return OrganizationRecord(
        id=organization.id,
        name=organization.name,
        logo_domain=organization.logo_domain,
        logo_image=organization.logo_image,
        status=organization.status,
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


def invitation_record(
    invitation: OrganizationInvitation,
    organization: Organization | None = None,
) -> InvitationRecord:
    return InvitationRecord(
        id=invitation.id,
        organization_id=invitation.organization_id,
        organization_name=organization.name if organization is not None else None,
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


def checkout_intent_record(intent: OrganizationCheckoutIntent) -> CheckoutIntentRecord:
    return CheckoutIntentRecord(
        id=intent.id,
        organization_id=intent.organization_id,
        created_by_user_id=intent.created_by_user_id,
        billing_subject_id=intent.billing_subject_id,
        team_name=intent.team_name,
        status=intent.status,
        activation_status=intent.activation_status,
        activation_error_code=intent.activation_error_code,
        activation_error_message=intent.activation_error_message,
        last_webhook_event_id=intent.last_webhook_event_id,
        stripe_checkout_session_id=intent.stripe_checkout_session_id,
        stripe_customer_id=intent.stripe_customer_id,
        stripe_subscription_id=intent.stripe_subscription_id,
        idempotency_key=intent.idempotency_key,
        invite_emails_json=intent.invite_emails_json,
        checkout_url=intent.checkout_url,
        expires_at=intent.expires_at,
        completed_at=intent.completed_at,
        failed_at=intent.failed_at,
        cancelled_at=intent.cancelled_at,
        created_at=intent.created_at,
        updated_at=intent.updated_at,
    )
