"""Organization persistence layer."""

from __future__ import annotations

import json
from datetime import datetime
from uuid import UUID

from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.billing import BILLING_SUBJECT_KIND_ORGANIZATION
from proliferate.constants.organizations import (
    ORGANIZATION_CHECKOUT_ACTIVATION_ACTIVATED,
    ORGANIZATION_CHECKOUT_ACTIVATION_ACTIVATING,
    ORGANIZATION_CHECKOUT_ACTIVATION_NOT_STARTED,
    ORGANIZATION_CHECKOUT_INTENT_NON_TERMINAL_STATUSES,
    ORGANIZATION_CHECKOUT_INTENT_STATUS_CANCELLED,
    ORGANIZATION_CHECKOUT_INTENT_STATUS_COMPLETED,
    ORGANIZATION_CHECKOUT_INTENT_STATUS_EXPIRED,
    ORGANIZATION_CHECKOUT_INTENT_STATUS_FAILED,
    ORGANIZATION_CHECKOUT_INTENT_STATUS_PENDING,
    ORGANIZATION_CURRENT_STATUSES,
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_MEMBERSHIP_STATUS_REMOVED,
    ORGANIZATION_ROLE_OWNER,
    ORGANIZATION_STATUS_ACTIVE,
    ORGANIZATION_STATUS_ARCHIVED,
    ORGANIZATION_STATUS_PENDING_CHECKOUT,
)
from proliferate.db.models.auth import User
from proliferate.db.models.billing import BillingSubject
from proliferate.db.models.organizations import (
    Organization,
    OrganizationCheckoutIntent,
    OrganizationMembership,
)
from proliferate.db.store.billing_subjects import ensure_organization_billing_subject
from proliferate.db.store.organization_records import (
    CheckoutIntentRecord,
    CheckoutIntentWithOrganizationRecord,
    MemberRecord,
    MembershipRecord,
    OrganizationRecord,
    OrganizationWithMembershipRecord,
    checkout_intent_record,
    membership_record,
    organization_record,
)
from proliferate.utils.time import utcnow


async def acquire_membership_activation_lock(db: AsyncSession, user_id: UUID) -> None:
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:lock_key, 0))"),
        {"lock_key": f"organization-membership-active-user:{user_id}"},
    )


async def acquire_organization_membership_lock(db: AsyncSession, organization_id: UUID) -> None:
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:lock_key, 0))"),
        {"lock_key": f"organization-membership-owner-count:{organization_id}"},
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
                Organization.status.in_(tuple(ORGANIZATION_CURRENT_STATUSES)),
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


async def list_organizations_for_user(
    db: AsyncSession,
    user_id: UUID,
) -> list[OrganizationWithMembershipRecord]:
    return await _list_organizations_for_user(db, user_id)


async def get_organization(
    db: AsyncSession,
    organization_id: UUID,
) -> OrganizationRecord | None:
    organization = (
        await db.execute(
            select(Organization).where(
                Organization.id == organization_id,
                Organization.status.in_(tuple(ORGANIZATION_CURRENT_STATUSES)),
            )
        )
    ).scalar_one_or_none()
    return organization_record(organization) if organization is not None else None


async def get_current_membership_for_user(
    db: AsyncSession,
    user_id: UUID,
) -> OrganizationWithMembershipRecord | None:
    records = await _list_organizations_for_user(db, user_id)
    return records[0] if records else None


async def ensure_default_organization_for_user(
    db: AsyncSession,
    *,
    user_id: UUID,
    name: str,
    logo_domain: str | None,
) -> list[OrganizationWithMembershipRecord]:
    now = utcnow()
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:lock_key, 0))"),
        {"lock_key": f"default-organization:{user_id}"},
    )
    records = await _list_organizations_for_user(db, user_id)
    if any(record.membership.role == ORGANIZATION_ROLE_OWNER for record in records):
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
    await db.flush()
    return await _list_organizations_for_user(db, user_id)


async def get_organization_with_membership(
    db: AsyncSession,
    *,
    organization_id: UUID,
    user_id: UUID,
) -> OrganizationWithMembershipRecord | None:
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
                Organization.status.in_(tuple(ORGANIZATION_CURRENT_STATUSES)),
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
    db: AsyncSession,
    *,
    organization_id: UUID,
    user_id: UUID,
) -> MembershipRecord | None:
    return await get_active_membership(
        db,
        organization_id=organization_id,
        user_id=user_id,
    )


async def get_active_membership(
    db: AsyncSession,
    *,
    organization_id: UUID,
    user_id: UUID,
) -> MembershipRecord | None:
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


async def create_pending_team_checkout_intent(
    db: AsyncSession,
    *,
    created_by_user_id: UUID,
    team_name: str,
    logo_domain: str | None,
    idempotency_key: str,
    invite_emails: list[str],
    expires_at: datetime,
) -> CheckoutIntentWithOrganizationRecord:
    now = utcnow()
    organization = Organization(
        name=team_name,
        logo_domain=logo_domain,
        logo_image=None,
        status=ORGANIZATION_STATUS_PENDING_CHECKOUT,
        created_at=now,
        updated_at=now,
    )
    db.add(organization)
    await db.flush()
    billing_subject = await ensure_organization_billing_subject(db, organization.id)
    intent = OrganizationCheckoutIntent(
        organization_id=organization.id,
        created_by_user_id=created_by_user_id,
        billing_subject_id=billing_subject.id,
        team_name=team_name,
        status=ORGANIZATION_CHECKOUT_INTENT_STATUS_PENDING,
        activation_status=ORGANIZATION_CHECKOUT_ACTIVATION_NOT_STARTED,
        activation_error_code=None,
        activation_error_message=None,
        last_webhook_event_id=None,
        stripe_checkout_session_id=None,
        stripe_customer_id=None,
        stripe_subscription_id=None,
        idempotency_key=idempotency_key,
        invite_emails_json=json.dumps(invite_emails),
        checkout_url=None,
        expires_at=expires_at,
        completed_at=None,
        failed_at=None,
        cancelled_at=None,
        created_at=now,
        updated_at=now,
    )
    db.add(intent)
    await db.flush()
    return CheckoutIntentWithOrganizationRecord(
        intent=checkout_intent_record(intent),
        organization=organization_record(organization),
    )


async def get_current_team_checkout_intent(
    db: AsyncSession,
    created_by_user_id: UUID,
) -> CheckoutIntentWithOrganizationRecord | None:
    row = (
        await db.execute(
            select(OrganizationCheckoutIntent, Organization)
            .join(Organization, Organization.id == OrganizationCheckoutIntent.organization_id)
            .where(
                OrganizationCheckoutIntent.created_by_user_id == created_by_user_id,
                OrganizationCheckoutIntent.status.in_(
                    tuple(ORGANIZATION_CHECKOUT_INTENT_NON_TERMINAL_STATUSES)
                ),
            )
            .order_by(OrganizationCheckoutIntent.created_at.desc())
        )
    ).first()
    if row is None:
        return None
    intent, organization = row
    now = utcnow()
    if intent.status == ORGANIZATION_CHECKOUT_INTENT_STATUS_PENDING and intent.expires_at <= now:
        intent.status = ORGANIZATION_CHECKOUT_INTENT_STATUS_EXPIRED
        intent.updated_at = now
        organization.status = ORGANIZATION_STATUS_ARCHIVED
        organization.updated_at = now
        await db.flush()
        return None
    return CheckoutIntentWithOrganizationRecord(
        intent=checkout_intent_record(intent),
        organization=organization_record(organization),
    )


async def load_team_checkout_intent_for_update(
    db: AsyncSession,
    intent_id: UUID,
) -> tuple[OrganizationCheckoutIntent, Organization] | None:
    row = (
        await db.execute(
            select(OrganizationCheckoutIntent, Organization)
            .join(Organization, Organization.id == OrganizationCheckoutIntent.organization_id)
            .where(OrganizationCheckoutIntent.id == intent_id)
            .with_for_update(of=(OrganizationCheckoutIntent, Organization))
        )
    ).one_or_none()
    if row is None:
        return None
    intent, organization = row
    return intent, organization


async def bind_team_checkout_session(
    db: AsyncSession,
    *,
    intent_id: UUID,
    stripe_checkout_session_id: str,
    stripe_customer_id: str,
    checkout_url: str,
) -> CheckoutIntentRecord | None:
    intent = await db.get(OrganizationCheckoutIntent, intent_id)
    if intent is None:
        return None
    intent.stripe_checkout_session_id = stripe_checkout_session_id
    intent.stripe_customer_id = stripe_customer_id
    intent.checkout_url = checkout_url
    intent.updated_at = utcnow()
    await db.flush()
    return checkout_intent_record(intent)


async def cancel_team_checkout_intent(
    db: AsyncSession,
    *,
    intent_id: UUID,
    created_by_user_id: UUID,
) -> CheckoutIntentWithOrganizationRecord | None:
    row = await load_team_checkout_intent_for_update(db, intent_id)
    if row is None:
        return None
    intent, organization = row
    if intent.created_by_user_id != created_by_user_id:
        return None
    if intent.status == ORGANIZATION_CHECKOUT_INTENT_STATUS_PENDING:
        now = utcnow()
        intent.status = ORGANIZATION_CHECKOUT_INTENT_STATUS_CANCELLED
        intent.cancelled_at = now
        intent.updated_at = now
        organization.status = ORGANIZATION_STATUS_ARCHIVED
        organization.updated_at = now
        await db.flush()
    return CheckoutIntentWithOrganizationRecord(
        intent=checkout_intent_record(intent),
        organization=organization_record(organization),
    )


async def mark_team_checkout_activating(
    db: AsyncSession,
    intent: OrganizationCheckoutIntent,
    *,
    stripe_subscription_id: str | None,
) -> None:
    intent.activation_status = ORGANIZATION_CHECKOUT_ACTIVATION_ACTIVATING
    if stripe_subscription_id:
        intent.stripe_subscription_id = stripe_subscription_id
    intent.updated_at = utcnow()
    await db.flush()


async def mark_team_checkout_failed(
    db: AsyncSession,
    intent: OrganizationCheckoutIntent,
    *,
    activation_status: str,
    error_code: str,
    error_message: str,
    webhook_event_id: str | None,
) -> CheckoutIntentRecord:
    now = utcnow()
    intent.status = ORGANIZATION_CHECKOUT_INTENT_STATUS_FAILED
    intent.activation_status = activation_status
    intent.activation_error_code = error_code
    intent.activation_error_message = error_message
    intent.last_webhook_event_id = webhook_event_id
    intent.failed_at = now
    intent.updated_at = now
    await db.flush()
    return checkout_intent_record(intent)


async def complete_team_checkout_activation(
    db: AsyncSession,
    *,
    intent: OrganizationCheckoutIntent,
    organization: Organization,
    stripe_subscription_id: str,
    stripe_customer_id: str,
    webhook_event_id: str | None,
) -> OrganizationWithMembershipRecord:
    now = utcnow()
    organization.status = ORGANIZATION_STATUS_ACTIVE
    organization.updated_at = now
    result = await db.execute(
        pg_insert(OrganizationMembership)
        .values(
            organization_id=organization.id,
            user_id=intent.created_by_user_id,
            role=ORGANIZATION_ROLE_OWNER,
            status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            joined_at=now,
            removed_at=None,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_update(
            constraint="uq_organization_membership_org_user",
            set_={
                "role": ORGANIZATION_ROLE_OWNER,
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
        raise RuntimeError("Organization membership disappeared after checkout activation.")
    intent.status = ORGANIZATION_CHECKOUT_INTENT_STATUS_COMPLETED
    intent.activation_status = ORGANIZATION_CHECKOUT_ACTIVATION_ACTIVATED
    intent.stripe_subscription_id = stripe_subscription_id
    intent.stripe_customer_id = stripe_customer_id
    intent.last_webhook_event_id = webhook_event_id
    intent.completed_at = now
    intent.updated_at = now
    await db.flush()
    return OrganizationWithMembershipRecord(
        organization=organization_record(organization),
        membership=membership_record(membership),
    )


async def update_organization_settings(
    db: AsyncSession,
    *,
    organization_id: UUID,
    name: str | None,
    logo_image: str | None,
    update_logo_image: bool,
) -> OrganizationRecord | None:
    organization = await _load_organization(db, organization_id)
    if organization is None:
        return None
    if name is not None:
        organization.name = name
    if update_logo_image:
        organization.logo_image = logo_image
    organization.updated_at = utcnow()
    await db.flush()
    return organization_record(organization)


async def list_organization_members(
    db: AsyncSession,
    organization_id: UUID,
) -> list[MemberRecord]:
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
    db: AsyncSession,
    *,
    organization_id: UUID,
    membership_id: UUID,
    role: str | None,
    status: str | None,
    can_modify_owner: bool,
) -> tuple[MembershipRecord | None, str | None]:
    now = utcnow()
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
    touches_owner = membership.role == ORGANIZATION_ROLE_OWNER or role == ORGANIZATION_ROLE_OWNER
    if touches_owner and not can_modify_owner:
        return None, "owner_membership_requires_owner"
    if touches_owner:
        await acquire_organization_membership_lock(db, organization_id)
    removing_owner = membership.role == ORGANIZATION_ROLE_OWNER and (
        (role is not None and role != ORGANIZATION_ROLE_OWNER)
        or status == ORGANIZATION_MEMBERSHIP_STATUS_REMOVED
    )
    if removing_owner and await _active_owner_count(db, organization_id) <= 1:
        return None, "last_owner_cannot_be_removed"
    if role is not None:
        membership.role = role
    if status is not None:
        if status == ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE:
            await acquire_membership_activation_lock(db, membership.user_id)
        membership.status = status
        membership.removed_at = now if status == ORGANIZATION_MEMBERSHIP_STATUS_REMOVED else None
        if status == ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE and membership.joined_at is None:
            membership.joined_at = now
    membership.updated_at = now
    await db.flush()
    return membership_record(membership), None


async def load_organization_by_billing_subject(
    db: AsyncSession,
    billing_subject_id: UUID,
) -> OrganizationRecord | None:
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
