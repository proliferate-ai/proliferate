from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import AuthIdentity, User
from proliferate.db.models.billing import BillingGrant, BillingSubject, FreeCloudAllocation
from proliferate.db.store.billing_subjects import (
    ensure_free_trial_v2_grant,
    ensure_personal_billing_subject,
)


async def _create_user(db_session: AsyncSession, email: str) -> User:
    user = User(
        email=email,
        hashed_password="unused",
        is_active=True,
        is_superuser=False,
        is_verified=True,
        display_name="Trial User",
    )
    db_session.add(user)
    await db_session.flush()
    return user


async def _link_github_identity(
    db_session: AsyncSession,
    *,
    user_id: uuid.UUID,
    provider_subject: str,
) -> None:
    db_session.add(
        AuthIdentity(
            user_id=user_id,
            provider="github",
            provider_subject=provider_subject,
            email=f"{provider_subject}@example.com",
            email_verified=True,
        )
    )
    await db_session.flush()


@pytest.mark.asyncio
async def test_free_trial_v2_requires_github_identity(db_session: AsyncSession) -> None:
    user = await _create_user(db_session, "free-trial-no-github@example.com")
    subject = await ensure_personal_billing_subject(db_session, user.id)

    created = await ensure_free_trial_v2_grant(db_session, subject)

    assert created is False
    grant_count = await db_session.scalar(
        select(BillingGrant).where(BillingGrant.user_id == user.id)
    )
    assert grant_count is None


@pytest.mark.asyncio
async def test_free_trial_v2_is_unique_per_github_allocation(db_session: AsyncSession) -> None:
    github_subject = "github-user-123"
    user = await _create_user(db_session, "free-trial-allocated-elsewhere@example.com")
    await _link_github_identity(db_session, user_id=user.id, provider_subject=github_subject)
    subject = await ensure_personal_billing_subject(db_session, user.id)
    other_subject = BillingSubject(kind="personal", user_id=uuid.uuid4())
    db_session.add(other_subject)
    await db_session.flush()
    db_session.add(
        FreeCloudAllocation(
            allocation_kind="personal_trial",
            github_provider_user_id=github_subject,
            billing_subject_id=other_subject.id,
            user_id=other_subject.user_id,
            period_key="trial_v2",
            status="active",
        )
    )
    await db_session.flush()

    assert await ensure_free_trial_v2_grant(db_session, subject) is False

    allocations = (
        (
            await db_session.execute(
                select(FreeCloudAllocation).where(
                    FreeCloudAllocation.github_provider_user_id == github_subject,
                )
            )
        )
        .scalars()
        .all()
    )
    grants = (
        (
            await db_session.execute(
                select(BillingGrant).where(BillingGrant.grant_type == "free_trial_v2")
            )
        )
        .scalars()
        .all()
    )

    assert len(allocations) == 1
    assert allocations[0].billing_subject_id == other_subject.id
    assert grants == []
