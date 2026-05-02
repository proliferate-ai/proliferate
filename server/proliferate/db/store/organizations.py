"""Organization persistence layer."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.billing import BILLING_SUBJECT_KIND_ORGANIZATION
from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_MEMBERSHIP_STATUS_REMOVED,
    ORGANIZATION_ROLE_OWNER,
)
from proliferate.db import engine as db_engine
from proliferate.db.models.auth import User
from proliferate.db.models.billing import BillingSubject
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.store.billing import (
    ensure_organization_billing_subject,
    maybe_create_org_seat_adjustment,
)
from proliferate.db.store.organization_records import (
    MemberRecord,
    MembershipRecord,
    OrganizationRecord,
    OrganizationWithMembershipRecord,
    membership_record,
    organization_record,
)
from proliferate.utils.time import utcnow


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
            organization=organization_record(organization),
            membership=membership_record(membership),
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
            organization=organization_record(organization),
            membership=membership_record(membership),
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
                organization=organization_record(organization),
                membership=membership_record(membership),
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
            organization=organization_record(organization),
            membership=membership_record(membership),
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
        return membership_record(membership) if membership is not None else None


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
        return organization_record(organization)


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
                membership=membership_record(membership),
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
        if status is not None:
            await maybe_create_org_seat_adjustment(
                db,
                organization_id=organization_id,
                membership_id=membership.id,
            )
        return membership_record(membership), None


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
        return organization_record(row) if row is not None else None
