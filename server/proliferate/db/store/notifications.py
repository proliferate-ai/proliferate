"""Read models used by internal Slack notifications."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.billing import BILLING_SUBJECT_KIND_ORGANIZATION
from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_ROLE_OWNER,
)
from proliferate.db.models.auth import OAuthAccount, User
from proliferate.db.models.billing import BillingSubject
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.models.organizations import Organization, OrganizationMembership


@dataclass(frozen=True)
class BillingSlackNotificationContext:
    name: str
    email: str | None
    github: str | None
    user_created_at: datetime | None
    workspace_count: int
    organization_user_count: int


async def get_billing_slack_notification_context(
    db: AsyncSession,
    *,
    billing_subject_id: UUID,
) -> BillingSlackNotificationContext | None:
    subject = await db.get(BillingSubject, billing_subject_id)
    if subject is None:
        return None

    organization: Organization | None = None
    user: User | None = None
    organization_user_count = 1

    if subject.kind == BILLING_SUBJECT_KIND_ORGANIZATION and subject.organization_id is not None:
        organization = await db.get(Organization, subject.organization_id)
        user = await _load_primary_organization_user(db, subject.organization_id)
        organization_user_count = await _count_active_organization_users(
            db,
            subject.organization_id,
        )
    elif subject.user_id is not None:
        user = await db.get(User, subject.user_id)

    github = await _github_for_user(db, user.id) if user is not None else None
    workspace_count = await _count_active_cloud_workspaces(db, billing_subject_id)
    name = _display_name(user, organization)

    return BillingSlackNotificationContext(
        name=name,
        email=user.email if user is not None else None,
        github=github,
        user_created_at=user.created_at if user is not None else None,
        workspace_count=workspace_count,
        organization_user_count=organization_user_count,
    )


async def _load_primary_organization_user(
    db: AsyncSession,
    organization_id: UUID,
) -> User | None:
    owner = (
        await db.execute(
            select(User)
            .join(OrganizationMembership, OrganizationMembership.user_id == User.id)
            .where(
                OrganizationMembership.organization_id == organization_id,
                OrganizationMembership.status == ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
                OrganizationMembership.role == ORGANIZATION_ROLE_OWNER,
            )
            .order_by(User.created_at.asc(), User.email.asc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if owner is not None:
        return owner
    return (
        await db.execute(
            select(User)
            .join(OrganizationMembership, OrganizationMembership.user_id == User.id)
            .where(
                OrganizationMembership.organization_id == organization_id,
                OrganizationMembership.status == ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            )
            .order_by(User.created_at.asc(), User.email.asc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def _github_for_user(db: AsyncSession, user_id: UUID) -> str | None:
    user = await db.get(User, user_id)
    if user is None:
        return None
    if user.github_login:
        return user.github_login
    account = (
        await db.execute(
            select(OAuthAccount)
            .where(
                OAuthAccount.user_id == user_id,
                OAuthAccount.oauth_name == "github",
            )
            .order_by(OAuthAccount.id.asc())
            .limit(1)
        )
    ).scalar_one_or_none()
    return account.account_id if account is not None else None


async def _count_active_cloud_workspaces(db: AsyncSession, billing_subject_id: UUID) -> int:
    count = await db.scalar(
        select(func.count(CloudWorkspace.id)).where(
            CloudWorkspace.billing_subject_id == billing_subject_id,
            CloudWorkspace.archived_at.is_(None),
        )
    )
    return int(count or 0)


async def _count_active_organization_users(db: AsyncSession, organization_id: UUID) -> int:
    count = await db.scalar(
        select(func.count(OrganizationMembership.id)).where(
            OrganizationMembership.organization_id == organization_id,
            OrganizationMembership.status == ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
        )
    )
    return int(count or 0)


def _display_name(user: User | None, organization: Organization | None) -> str:
    if organization is not None:
        return organization.name
    if user is None:
        return "Unknown user"
    return user.display_name or user.github_login or user.email
