"""Organization persistence layer."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import func, select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.billing import BILLING_SUBJECT_KIND_ORGANIZATION
from proliferate.constants.organizations import (
    ORGANIZATION_INVITATION_DELIVERY_FAILED,
    ORGANIZATION_INVITATION_DELIVERY_PENDING,
    ORGANIZATION_INVITATION_DELIVERY_SENT,
    ORGANIZATION_INVITATION_DELIVERY_SKIPPED,
    ORGANIZATION_INVITATION_STATUS_ACCEPTED,
    ORGANIZATION_INVITATION_STATUS_EXPIRED,
    ORGANIZATION_INVITATION_STATUS_PENDING,
    ORGANIZATION_INVITATION_STATUS_REVOKED,
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_MEMBERSHIP_STATUS_REMOVED,
    ORGANIZATION_ROLE_OWNER,
)
from proliferate.db import engine as db_engine
from proliferate.db.models.auth import User
from proliferate.db.models.billing import BillingSubject
from proliferate.db.models.organizations import (
    Organization,
    OrganizationInvitation,
    OrganizationMembership,
)
from proliferate.db.store.billing import ensure_organization_billing_subject
from proliferate.utils.time import utcnow


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


def _organization_record(organization: Organization) -> OrganizationRecord:
    return OrganizationRecord(
        id=organization.id,
        name=organization.name,
        logo_domain=organization.logo_domain,
        logo_image=organization.logo_image,
        created_at=organization.created_at,
        updated_at=organization.updated_at,
    )


def _membership_record(membership: OrganizationMembership) -> MembershipRecord:
    return MembershipRecord(
        id=membership.id,
        organization_id=membership.organization_id,
        user_id=membership.user_id,
        role=membership.role,
        status=membership.status,
        joined_at=membership.joined_at,
        removed_at=membership.removed_at,
    )


def _invitation_record(invitation: OrganizationInvitation) -> InvitationRecord:
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


async def _active_owner_count(db: AsyncSession, organization_id: UUID) -> int:
    return int(
        await db.scalar(
            select(func.count(OrganizationMembership.id)).where(
                OrganizationMembership.organization_id == organization_id,
                OrganizationMembership.role == ORGANIZATION_ROLE_OWNER,
                OrganizationMembership.status == ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            )
        )
        or 0
    )


async def _lock_invitation_email(
    db: AsyncSession,
    *,
    organization_id: UUID,
    email: str,
) -> None:
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:lock_key, 0))"),
        {"lock_key": f"organization-invite:{organization_id}:{email}"},
    )


async def _load_organization(db: AsyncSession, organization_id: UUID) -> Organization | None:
    return await db.get(Organization, organization_id)


async def _list_organizations_for_user(
    db: AsyncSession,
    user_id: UUID,
) -> list[OrganizationWithMembershipRecord]:
    rows = (
        await db.execute(
            select(Organization, OrganizationMembership)
            .join(
                OrganizationMembership,
                OrganizationMembership.organization_id == Organization.id,
            )
            .where(
                OrganizationMembership.user_id == user_id,
                OrganizationMembership.status == ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            )
            .order_by(Organization.name.asc())
        )
    ).all()
    return [
        OrganizationWithMembershipRecord(
            organization=_organization_record(organization),
            membership=_membership_record(membership),
        )
        for organization, membership in rows
    ]


async def create_organization_with_creator(
    *,
    name: str,
    logo_domain: str | None,
    creator_user_id: UUID,
) -> OrganizationWithMembershipRecord:
    now = utcnow()
    async with db_engine.async_session_factory() as db:
        async with db.begin():
            organization = Organization(
                name=name,
                logo_domain=logo_domain,
                logo_image=None,
                created_at=now,
                updated_at=now,
            )
            db.add(organization)
            await db.flush()
            membership = OrganizationMembership(
                organization_id=organization.id,
                user_id=creator_user_id,
                role=ORGANIZATION_ROLE_OWNER,
                status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
                joined_at=now,
                removed_at=None,
                created_at=now,
                updated_at=now,
            )
            db.add(membership)
            await ensure_organization_billing_subject(db, organization.id)
            await db.flush()
        return OrganizationWithMembershipRecord(
            organization=_organization_record(organization),
            membership=_membership_record(membership),
        )


async def list_organizations_for_user(user_id: UUID) -> list[OrganizationWithMembershipRecord]:
    async with db_engine.async_session_factory() as db:
        return await _list_organizations_for_user(db, user_id)


async def ensure_default_organization_for_user(
    *,
    user_id: UUID,
    name: str,
    logo_domain: str | None,
) -> list[OrganizationWithMembershipRecord]:
    now = utcnow()
    async with db_engine.async_session_factory() as db, db.begin():
        await db.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:lock_key, 0))"),
            {"lock_key": f"default-organization:{user_id}"},
        )
        records = await _list_organizations_for_user(db, user_id)
        if records:
            return records

        organization = Organization(
            name=name,
            logo_domain=logo_domain,
            logo_image=None,
            created_at=now,
            updated_at=now,
        )
        db.add(organization)
        await db.flush()
        membership = OrganizationMembership(
            organization_id=organization.id,
            user_id=user_id,
            role=ORGANIZATION_ROLE_OWNER,
            status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            joined_at=now,
            removed_at=None,
            created_at=now,
            updated_at=now,
        )
        db.add(membership)
        await ensure_organization_billing_subject(db, organization.id)
        await db.flush()
        return [
            OrganizationWithMembershipRecord(
                organization=_organization_record(organization),
                membership=_membership_record(membership),
            )
        ]


async def load_organization_with_membership(
    *,
    organization_id: UUID,
    user_id: UUID,
) -> OrganizationWithMembershipRecord | None:
    async with db_engine.async_session_factory() as db:
        row = (
            await db.execute(
                select(Organization, OrganizationMembership)
                .join(
                    OrganizationMembership,
                    OrganizationMembership.organization_id == Organization.id,
                )
                .where(
                    Organization.id == organization_id,
                    OrganizationMembership.user_id == user_id,
                    OrganizationMembership.status == ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
                )
            )
        ).one_or_none()
        if row is None:
            return None
        organization, membership = row
        return OrganizationWithMembershipRecord(
            organization=_organization_record(organization),
            membership=_membership_record(membership),
        )


async def load_active_membership(
    *,
    organization_id: UUID,
    user_id: UUID,
) -> MembershipRecord | None:
    async with db_engine.async_session_factory() as db:
        membership = (
            await db.execute(
                select(OrganizationMembership).where(
                    OrganizationMembership.organization_id == organization_id,
                    OrganizationMembership.user_id == user_id,
                    OrganizationMembership.status == ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
                )
            )
        ).scalar_one_or_none()
        return _membership_record(membership) if membership is not None else None


async def update_organization_settings(
    *,
    organization_id: UUID,
    name: str | None,
    logo_image: str | None,
    update_logo_image: bool,
) -> OrganizationRecord | None:
    async with db_engine.async_session_factory() as db:
        organization = await _load_organization(db, organization_id)
        if organization is None:
            return None
        if name is not None:
            organization.name = name
        if update_logo_image:
            organization.logo_image = logo_image
        organization.updated_at = utcnow()
        await db.commit()
        await db.refresh(organization)
        return _organization_record(organization)


async def list_organization_members(organization_id: UUID) -> list[MemberRecord]:
    async with db_engine.async_session_factory() as db:
        rows = (
            await db.execute(
                select(OrganizationMembership, User)
                .join(User, User.id == OrganizationMembership.user_id)
                .where(OrganizationMembership.organization_id == organization_id)
                .order_by(
                    OrganizationMembership.status.asc(),
                    OrganizationMembership.role.asc(),
                    User.email.asc(),
                )
            )
        ).all()
        return [
            MemberRecord(
                membership=_membership_record(membership),
                email=user.email,
                display_name=user.display_name,
                avatar_url=user.avatar_url,
            )
            for membership, user in rows
        ]


async def update_organization_membership(
    *,
    organization_id: UUID,
    membership_id: UUID,
    role: str | None,
    status: str | None,
    can_modify_owner: bool,
) -> tuple[MembershipRecord | None, str | None]:
    now = utcnow()
    async with db_engine.async_session_factory() as db, db.begin():
        membership = (
            await db.execute(
                select(OrganizationMembership)
                .where(
                    OrganizationMembership.id == membership_id,
                    OrganizationMembership.organization_id == organization_id,
                )
                .with_for_update()
            )
        ).scalar_one_or_none()
        if membership is None:
            return None, None
        touches_owner = (
            membership.role == ORGANIZATION_ROLE_OWNER or role == ORGANIZATION_ROLE_OWNER
        )
        if touches_owner and not can_modify_owner:
            return None, "owner_membership_requires_owner"
        removing_owner = membership.role == ORGANIZATION_ROLE_OWNER and (
            (role is not None and role != ORGANIZATION_ROLE_OWNER)
            or status == ORGANIZATION_MEMBERSHIP_STATUS_REMOVED
        )
        if removing_owner and await _active_owner_count(db, organization_id) <= 1:
            return None, "last_owner_cannot_be_removed"
        if role is not None:
            membership.role = role
        if status is not None:
            membership.status = status
            membership.removed_at = (
                now if status == ORGANIZATION_MEMBERSHIP_STATUS_REMOVED else None
            )
            if status == ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE and membership.joined_at is None:
                membership.joined_at = now
        membership.updated_at = now
        await db.flush()
        return _membership_record(membership), None


async def create_or_rotate_organization_invitation(
    *,
    organization_id: UUID,
    email: str,
    role: str,
    token_hash: str,
    invited_by_user_id: UUID,
    expires_at: datetime,
) -> InvitationCreateRecord | None:
    normalized_email = normalize_invitation_email(email)
    now = utcnow()
    async with db_engine.async_session_factory() as db, db.begin():
        organization = await _load_organization(db, organization_id)
        if organization is None:
            return None
        await _lock_invitation_email(
            db,
            organization_id=organization_id,
            email=normalized_email,
        )
        await db.execute(
            update(OrganizationInvitation)
            .where(
                OrganizationInvitation.organization_id == organization_id,
                OrganizationInvitation.email == normalized_email,
                OrganizationInvitation.status == ORGANIZATION_INVITATION_STATUS_PENDING,
            )
            .values(
                status=ORGANIZATION_INVITATION_STATUS_EXPIRED,
                expired_at=now,
                handoff_token_hash=None,
                handoff_expires_at=None,
                updated_at=now,
            )
        )
        result = await db.execute(
            pg_insert(OrganizationInvitation)
            .values(
                organization_id=organization_id,
                email=normalized_email,
                role=role,
                status=ORGANIZATION_INVITATION_STATUS_PENDING,
                token_hash=token_hash,
                handoff_token_hash=None,
                handoff_expires_at=None,
                delivery_status=ORGANIZATION_INVITATION_DELIVERY_PENDING,
                delivery_error=None,
                delivered_at=None,
                invited_by_user_id=invited_by_user_id,
                accepted_by_user_id=None,
                expires_at=expires_at,
                accepted_at=None,
                revoked_at=None,
                expired_at=None,
                created_at=now,
                updated_at=now,
            )
            .on_conflict_do_update(
                index_elements=[
                    OrganizationInvitation.organization_id,
                    OrganizationInvitation.email,
                ],
                index_where=(
                    OrganizationInvitation.status == ORGANIZATION_INVITATION_STATUS_PENDING
                ),
                set_={
                    "role": role,
                    "token_hash": token_hash,
                    "handoff_token_hash": None,
                    "handoff_expires_at": None,
                    "delivery_status": ORGANIZATION_INVITATION_DELIVERY_PENDING,
                    "delivery_error": None,
                    "delivered_at": None,
                    "invited_by_user_id": invited_by_user_id,
                    "expires_at": expires_at,
                    "updated_at": now,
                },
            )
            .returning(OrganizationInvitation.id)
        )
        invitation_id = result.scalar_one()
        invitation = await db.get(OrganizationInvitation, invitation_id)
        if invitation is None:
            raise RuntimeError("Organization invitation disappeared after creation.")
        return InvitationCreateRecord(
            invitation=_invitation_record(invitation),
            organization=_organization_record(organization),
        )


async def list_organization_invitations(organization_id: UUID) -> list[InvitationRecord]:
    now = utcnow()
    async with db_engine.async_session_factory() as db:
        await db.execute(
            update(OrganizationInvitation)
            .where(
                OrganizationInvitation.organization_id == organization_id,
                OrganizationInvitation.status == ORGANIZATION_INVITATION_STATUS_PENDING,
                OrganizationInvitation.expires_at <= now,
            )
            .values(
                status=ORGANIZATION_INVITATION_STATUS_EXPIRED,
                expired_at=now,
                handoff_token_hash=None,
                handoff_expires_at=None,
                updated_at=now,
            )
        )
        await db.commit()
        rows = (
            await db.execute(
                select(OrganizationInvitation)
                .where(OrganizationInvitation.organization_id == organization_id)
                .order_by(OrganizationInvitation.created_at.desc())
            )
        ).scalars()
        return [_invitation_record(invitation) for invitation in rows.all()]


async def revoke_organization_invitation(
    *,
    organization_id: UUID,
    invitation_id: UUID,
) -> InvitationRecord | None:
    async with db_engine.async_session_factory() as db:
        invitation = (
            await db.execute(
                select(OrganizationInvitation).where(
                    OrganizationInvitation.id == invitation_id,
                    OrganizationInvitation.organization_id == organization_id,
                )
            )
        ).scalar_one_or_none()
        if invitation is None:
            return None
        now = utcnow()
        if invitation.status == ORGANIZATION_INVITATION_STATUS_PENDING:
            invitation.status = ORGANIZATION_INVITATION_STATUS_REVOKED
            invitation.revoked_at = now
            invitation.handoff_token_hash = None
            invitation.handoff_expires_at = None
            invitation.updated_at = now
            await db.commit()
            await db.refresh(invitation)
        return _invitation_record(invitation)


async def rotate_organization_invitation(
    *,
    organization_id: UUID,
    invitation_id: UUID,
    token_hash: str,
    expires_at: datetime,
) -> InvitationCreateRecord | None:
    async with db_engine.async_session_factory() as db, db.begin():
        invitation = (
            await db.execute(
                select(OrganizationInvitation)
                .where(
                    OrganizationInvitation.id == invitation_id,
                    OrganizationInvitation.organization_id == organization_id,
                )
                .with_for_update()
            )
        ).scalar_one_or_none()
        organization = await _load_organization(db, organization_id)
        if invitation is None or organization is None:
            return None
        if invitation.status != ORGANIZATION_INVITATION_STATUS_PENDING:
            return None
        now = utcnow()
        invitation.token_hash = token_hash
        invitation.handoff_token_hash = None
        invitation.handoff_expires_at = None
        invitation.delivery_status = ORGANIZATION_INVITATION_DELIVERY_PENDING
        invitation.delivery_error = None
        invitation.delivered_at = None
        invitation.expires_at = expires_at
        invitation.updated_at = now
        await db.flush()
        return InvitationCreateRecord(
            invitation=_invitation_record(invitation),
            organization=_organization_record(organization),
        )


async def mark_invitation_delivery(
    *,
    invitation_id: UUID,
    sent: bool,
    skipped: bool,
    error: str | None = None,
) -> InvitationRecord | None:
    async with db_engine.async_session_factory() as db:
        invitation = await db.get(OrganizationInvitation, invitation_id)
        if invitation is None:
            return None
        now = utcnow()
        if sent:
            invitation.delivery_status = ORGANIZATION_INVITATION_DELIVERY_SENT
            invitation.delivery_error = None
            invitation.delivered_at = now
        elif skipped:
            invitation.delivery_status = ORGANIZATION_INVITATION_DELIVERY_SKIPPED
            invitation.delivery_error = None
            invitation.delivered_at = None
        else:
            invitation.delivery_status = ORGANIZATION_INVITATION_DELIVERY_FAILED
            invitation.delivery_error = error[:1000] if error else "Invitation delivery failed."
            invitation.delivered_at = None
        invitation.updated_at = now
        await db.commit()
        await db.refresh(invitation)
        return _invitation_record(invitation)


async def create_invitation_handoff(
    *,
    token_hash: str,
    handoff_token_hash: str,
    handoff_token: str,
    handoff_expires_at: datetime,
) -> InvitationHandoffRecord | None:
    now = utcnow()
    async with db_engine.async_session_factory() as db, db.begin():
        row = (
            await db.execute(
                select(OrganizationInvitation, Organization)
                .join(
                    Organization,
                    Organization.id == OrganizationInvitation.organization_id,
                )
                .where(
                    OrganizationInvitation.token_hash == token_hash,
                    OrganizationInvitation.status == ORGANIZATION_INVITATION_STATUS_PENDING,
                )
                .with_for_update()
            )
        ).one_or_none()
        if row is None:
            return None
        invitation, organization = row
        if invitation.expires_at <= now:
            invitation.status = ORGANIZATION_INVITATION_STATUS_EXPIRED
            invitation.expired_at = now
            invitation.updated_at = now
            return None
        invitation.handoff_token_hash = handoff_token_hash
        invitation.handoff_expires_at = handoff_expires_at
        invitation.updated_at = now
        return InvitationHandoffRecord(
            organization_id=organization.id,
            organization_name=organization.name,
            invite_email=invitation.email,
            handoff_token=handoff_token,
        )


async def accept_invitation_handoff(
    *,
    handoff_token_hash: str,
    authenticated_user_id: UUID,
    authenticated_email: str,
) -> tuple[InvitationAcceptRecord | None, str | None]:
    now = utcnow()
    normalized_email = normalize_invitation_email(authenticated_email)
    async with db_engine.async_session_factory() as db, db.begin():
        row = (
            await db.execute(
                select(OrganizationInvitation, Organization)
                .join(
                    Organization,
                    Organization.id == OrganizationInvitation.organization_id,
                )
                .where(
                    OrganizationInvitation.handoff_token_hash == handoff_token_hash,
                    OrganizationInvitation.status == ORGANIZATION_INVITATION_STATUS_PENDING,
                )
                .with_for_update()
            )
        ).one_or_none()
        if row is None:
            return None, "invalid_invitation"
        invitation, organization = row
        if invitation.expires_at <= now:
            invitation.status = ORGANIZATION_INVITATION_STATUS_EXPIRED
            invitation.expired_at = now
            invitation.handoff_token_hash = None
            invitation.handoff_expires_at = None
            invitation.updated_at = now
            return None, "invitation_expired"
        if invitation.handoff_expires_at is None or invitation.handoff_expires_at <= now:
            invitation.handoff_token_hash = None
            invitation.handoff_expires_at = None
            invitation.updated_at = now
            return None, "invitation_handoff_expired"
        if invitation.email != normalized_email:
            return None, "invitation_email_mismatch"

        result = await db.execute(
            pg_insert(OrganizationMembership)
            .values(
                organization_id=invitation.organization_id,
                user_id=authenticated_user_id,
                role=invitation.role,
                status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
                joined_at=now,
                removed_at=None,
                created_at=now,
                updated_at=now,
            )
            .on_conflict_do_update(
                constraint="uq_organization_membership_org_user",
                set_={
                    "role": invitation.role,
                    "status": ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
                    "removed_at": None,
                    "updated_at": now,
                },
            )
            .returning(OrganizationMembership.id)
        )
        membership_id = result.scalar_one()
        membership = await db.get(OrganizationMembership, membership_id)
        if membership is None:
            raise RuntimeError("Organization membership disappeared after invitation accept.")

        invitation.status = ORGANIZATION_INVITATION_STATUS_ACCEPTED
        invitation.accepted_by_user_id = authenticated_user_id
        invitation.accepted_at = now
        invitation.handoff_token_hash = None
        invitation.handoff_expires_at = None
        invitation.updated_at = now
        return (
            InvitationAcceptRecord(
                organization=_organization_record(organization),
                membership=_membership_record(membership),
            ),
            None,
        )


async def ensure_organization_billing_subject_id(organization_id: UUID) -> UUID:
    async with db_engine.async_session_factory() as db:
        subject = await ensure_organization_billing_subject(db, organization_id)
        await db.commit()
        return subject.id


async def load_organization_by_billing_subject(
    billing_subject_id: UUID,
) -> OrganizationRecord | None:
    async with db_engine.async_session_factory() as db:
        row = (
            await db.execute(
                select(Organization)
                .join(BillingSubject, BillingSubject.organization_id == Organization.id)
                .where(
                    BillingSubject.id == billing_subject_id,
                    BillingSubject.kind == BILLING_SUBJECT_KIND_ORGANIZATION,
                )
            )
        ).scalar_one_or_none()
        return _organization_record(row) if row is not None else None


def invitation_expiry_from_now() -> datetime:
    return utcnow() + timedelta(days=14)
