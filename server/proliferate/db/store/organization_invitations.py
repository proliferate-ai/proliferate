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
from proliferate.db import engine as db_engine
from proliferate.db.models.organizations import (
    Organization,
    OrganizationInvitation,
    OrganizationMembership,
)
from proliferate.db.store.organization_records import (
    InvitationAcceptRecord,
    InvitationCreateRecord,
    InvitationHandoffRecord,
    InvitationRecord,
    invitation_record,
    membership_record,
    normalize_invitation_email,
    organization_record,
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
            invitation=invitation_record(invitation),
            organization=organization_record(organization),
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
        return [invitation_record(invitation) for invitation in rows.all()]


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
        return invitation_record(invitation)


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
            invitation=invitation_record(invitation),
            organization=organization_record(organization),
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
        return invitation_record(invitation)


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
                organization=organization_record(organization),
                membership=membership_record(membership),
            ),
            None,
        )
