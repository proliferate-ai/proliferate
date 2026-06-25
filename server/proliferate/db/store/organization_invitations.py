"""Organization invitation persistence."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

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
)
from proliferate.db.models.organizations import (
    Organization,
    OrganizationInvitation,
    OrganizationMembership,
)
from proliferate.db.store.organization_records import (
    InvitationAcceptRecord,
    InvitationCreateRecord,
    InvitationRecord,
    invitation_record,
    membership_record,
    normalize_invitation_email,
    organization_record,
)
from proliferate.db.store.organizations import (
    acquire_membership_activation_lock,
    get_organization_with_membership,
)
from proliferate.utils.time import utcnow


async def _load_organization(db: AsyncSession, organization_id: UUID) -> Organization | None:
    return await db.get(Organization, organization_id)


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


async def create_or_rotate_organization_invitation(
    db: AsyncSession,
    *,
    organization_id: UUID,
    email: str,
    role: str,
    invited_by_user_id: UUID,
    expires_at: datetime,
) -> InvitationCreateRecord | None:
    normalized_email = normalize_invitation_email(email)
    now = utcnow()
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
            index_where=(OrganizationInvitation.status == ORGANIZATION_INVITATION_STATUS_PENDING),
            set_={
                "role": role,
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
    await db.flush()
    return InvitationCreateRecord(
        invitation=invitation_record(invitation, organization),
        organization=organization_record(organization),
    )


async def list_organization_invitations(
    db: AsyncSession,
    organization_id: UUID,
) -> list[InvitationRecord]:
    now = utcnow()
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
            updated_at=now,
        )
    )
    rows = (
        await db.execute(
            select(OrganizationInvitation)
            .where(OrganizationInvitation.organization_id == organization_id)
            .order_by(OrganizationInvitation.created_at.desc())
        )
    ).scalars()
    return [invitation_record(invitation) for invitation in rows.all()]


async def list_pending_invitations_for_email(
    db: AsyncSession,
    email: str,
) -> list[InvitationRecord]:
    now = utcnow()
    normalized_email = normalize_invitation_email(email)
    await db.execute(
        update(OrganizationInvitation)
        .where(
            OrganizationInvitation.email == normalized_email,
            OrganizationInvitation.status == ORGANIZATION_INVITATION_STATUS_PENDING,
            OrganizationInvitation.expires_at <= now,
        )
        .values(
            status=ORGANIZATION_INVITATION_STATUS_EXPIRED,
            expired_at=now,
            updated_at=now,
        )
    )
    rows = (
        await db.execute(
            select(OrganizationInvitation, Organization)
            .join(
                Organization,
                Organization.id == OrganizationInvitation.organization_id,
            )
            .where(
                OrganizationInvitation.email == normalized_email,
                OrganizationInvitation.status == ORGANIZATION_INVITATION_STATUS_PENDING,
            )
            .order_by(OrganizationInvitation.created_at.desc())
        )
    ).all()
    return [invitation_record(invitation, organization) for invitation, organization in rows]


async def revoke_organization_invitation(
    db: AsyncSession,
    *,
    organization_id: UUID,
    invitation_id: UUID,
) -> InvitationRecord | None:
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
        invitation.updated_at = now
        await db.flush()
    return invitation_record(invitation)


async def rotate_organization_invitation(
    db: AsyncSession,
    *,
    organization_id: UUID,
    invitation_id: UUID,
    expires_at: datetime,
) -> InvitationCreateRecord | None:
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
    invitation.delivery_status = ORGANIZATION_INVITATION_DELIVERY_PENDING
    invitation.delivery_error = None
    invitation.delivered_at = None
    invitation.expires_at = expires_at
    invitation.updated_at = now
    await db.flush()
    return InvitationCreateRecord(
        invitation=invitation_record(invitation, organization),
        organization=organization_record(organization),
    )


async def mark_invitation_delivery(
    db: AsyncSession,
    *,
    invitation_id: UUID,
    sent: bool,
    skipped: bool,
    error: str | None = None,
) -> InvitationRecord | None:
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
    await db.flush()
    return invitation_record(invitation)


async def accept_pending_invitation_for_email(
    db: AsyncSession,
    *,
    invitation_id: UUID,
    authenticated_user_id: UUID,
    authenticated_email: str,
) -> tuple[InvitationAcceptRecord | None, str | None]:
    now = utcnow()
    normalized_email = normalize_invitation_email(authenticated_email)
    row = (
        await db.execute(
            select(OrganizationInvitation, Organization)
            .join(
                Organization,
                Organization.id == OrganizationInvitation.organization_id,
            )
            .where(
                OrganizationInvitation.id == invitation_id,
                OrganizationInvitation.email == normalized_email,
                OrganizationInvitation.status == ORGANIZATION_INVITATION_STATUS_PENDING,
            )
            .with_for_update()
        )
    ).one_or_none()
    if row is None:
        invitation_row = (
            await db.execute(
                select(OrganizationInvitation, Organization)
                .join(
                    Organization,
                    Organization.id == OrganizationInvitation.organization_id,
                )
                .where(
                    OrganizationInvitation.id == invitation_id,
                    OrganizationInvitation.email == normalized_email,
                )
            )
        ).one_or_none()
        if invitation_row is not None:
            invitation, _organization = invitation_row
            current = await get_organization_with_membership(
                db,
                organization_id=invitation.organization_id,
                user_id=authenticated_user_id,
            )
            if current is not None:
                return (
                    InvitationAcceptRecord(
                        organization=current.organization,
                        membership=current.membership,
                    ),
                    None,
                )
        return None, "invalid_invitation"
    invitation, organization = row
    return await _accept_locked_invitation(
        db,
        invitation=invitation,
        organization=organization,
        now=now,
        authenticated_user_id=authenticated_user_id,
        authenticated_email=authenticated_email,
    )


async def accept_pending_invitation_for_organization_email(
    db: AsyncSession,
    *,
    organization_id: UUID,
    authenticated_user_id: UUID,
    authenticated_email: str,
) -> tuple[InvitationAcceptRecord | None, str | None]:
    now = utcnow()
    normalized_email = normalize_invitation_email(authenticated_email)
    row = (
        await db.execute(
            select(OrganizationInvitation, Organization)
            .join(
                Organization,
                Organization.id == OrganizationInvitation.organization_id,
            )
            .where(
                OrganizationInvitation.organization_id == organization_id,
                OrganizationInvitation.email == normalized_email,
                OrganizationInvitation.status == ORGANIZATION_INVITATION_STATUS_PENDING,
            )
            .with_for_update()
        )
    ).one_or_none()
    if row is None:
        current = await get_organization_with_membership(
            db,
            organization_id=organization_id,
            user_id=authenticated_user_id,
        )
        if current is not None:
            return (
                InvitationAcceptRecord(
                    organization=current.organization,
                    membership=current.membership,
                ),
                None,
            )
        pending_for_org = (
            await db.execute(
                select(OrganizationInvitation.id).where(
                    OrganizationInvitation.organization_id == organization_id,
                    OrganizationInvitation.status == ORGANIZATION_INVITATION_STATUS_PENDING,
                )
            )
        ).first()
        return None, "invitation_email_mismatch" if pending_for_org else "invalid_invitation"
    invitation, organization = row
    return await _accept_locked_invitation(
        db,
        invitation=invitation,
        organization=organization,
        now=now,
        authenticated_user_id=authenticated_user_id,
        authenticated_email=authenticated_email,
    )


async def _accept_locked_invitation(
    db: AsyncSession,
    *,
    invitation: OrganizationInvitation,
    organization: Organization,
    now: datetime,
    authenticated_user_id: UUID,
    authenticated_email: str,
) -> tuple[InvitationAcceptRecord | None, str | None]:
    normalized_email = normalize_invitation_email(authenticated_email)
    if invitation.expires_at <= now:
        invitation.status = ORGANIZATION_INVITATION_STATUS_EXPIRED
        invitation.expired_at = now
        invitation.updated_at = now
        return None, "invitation_expired"
    if invitation.email != normalized_email:
        return None, "invitation_email_mismatch"

    await acquire_membership_activation_lock(db, authenticated_user_id)
    current = await get_organization_with_membership(
        db,
        organization_id=invitation.organization_id,
        user_id=authenticated_user_id,
    )
    if current is not None:
        membership = (
            await db.execute(
                select(OrganizationMembership).where(
                    OrganizationMembership.id == current.membership.id,
                    OrganizationMembership.status == ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
                )
            )
        ).scalar_one_or_none()
        if membership is None:
            return None, "invalid_invitation"
        invitation.status = ORGANIZATION_INVITATION_STATUS_ACCEPTED
        invitation.accepted_by_user_id = authenticated_user_id
        invitation.accepted_at = now
        invitation.updated_at = now
        return (
            InvitationAcceptRecord(
                organization=organization_record(organization),
                membership=membership_record(membership),
            ),
            None,
        )

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
    invitation.updated_at = now
    return (
        InvitationAcceptRecord(
            organization=organization_record(organization),
            membership=membership_record(membership),
        ),
        None,
    )
