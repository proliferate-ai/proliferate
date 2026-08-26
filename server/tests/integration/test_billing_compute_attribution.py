"""Org compute attribution + budget enforcement, via the real segment-open path.

Compute ``usage_segment`` rows opened by the E2B webhook / provision path used
to be attributed only to the workspace owner's *personal* billing subject:
org-scoped compute caps never fired (#1028 fixed enforcement by stamping
``organization_id``), and org compute drained the member's personal credits
while org compute budgets watched a pool that never moved.

Per the 2026-07-09 ruling, compute run under an org now bills the org billing
subject (org Stripe customer, org grant pool), matching the LLM track. Both the
paying subject and ``organization_id`` derive from the owner's current
membership, so they can never disagree. An org-less user is unaffected — still
billed personal.

These tests exercise the real write path (``open_usage_segment_for_sandbox``),
then assert: an org member's segment bills the org subject and drains org grants
(personal untouched); an org-less user bills personal; the org-admin
usage-by-user display shows org compute; and enforcement (org-wide + per-user
caps) still fires against the now-correct pool.
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.billing import (
    BILLING_MODE_OBSERVE,
    FREE_INCLUDED_GRANT_TYPE,
)
from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_ROLE_OWNER,
)
from proliferate.db.models.auth import User
from proliferate.db.models.billing import BillingGrant, UsageSegment
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.store.billing import BudgetLimitInput
from proliferate.db.store.billing_runtime_usage import (
    open_usage_segment_for_sandbox,
    resolve_organization_id_for_user,
)
from proliferate.db.store.billing_subjects import (
    ensure_billing_grant,
    ensure_organization_billing_subject,
    ensure_personal_billing_subject,
)
from proliferate.server.billing import accounting as billing_accounting_service
from proliferate.server.organizations.usage.service import get_usage_by_user
from proliferate.lib.infra.time.wall_clock import utcnow
from tests.integration.billing_accounting_helpers import patch_global_session_factory


async def _create_user(db_session: AsyncSession) -> uuid.UUID:
    user = User(
        email=f"attrib-{uuid.uuid4().hex[:10]}@example.com",
        hashed_password="unused-oauth-only",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db_session.add(user)
    await db_session.flush()
    return user.id


async def _create_org_member(db_session: AsyncSession) -> tuple[uuid.UUID, uuid.UUID]:
    """A user with an active membership in a fresh org. Returns (user_id, org_id)."""
    user_id = await _create_user(db_session)
    org = Organization(name=f"org-{uuid.uuid4().hex[:8]}", status="active")
    db_session.add(org)
    await db_session.flush()
    db_session.add(
        OrganizationMembership(
            organization_id=org.id,
            user_id=user_id,
            role=ORGANIZATION_ROLE_OWNER,
            status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
        )
    )
    await db_session.flush()
    return user_id, org.id


async def _open_segment_for(
    db_session: AsyncSession, user_id: uuid.UUID, *, seconds: float
) -> UsageSegment:
    """Open a real usage segment for a user's sandbox, started ``seconds`` ago."""
    started_at = utcnow() - timedelta(seconds=seconds)
    return await open_usage_segment_for_sandbox(
        db_session,
        sandbox_id=uuid.uuid4(),
        external_sandbox_id=f"ext-{uuid.uuid4().hex[:8]}",
        sandbox_execution_id=None,
        started_at=started_at,
        opened_by="provision",
        user_id=user_id,
    )


def _compute_limit(user_id: uuid.UUID | None, cap: float) -> BudgetLimitInput:
    return BudgetLimitInput(
        user_id=user_id,
        kind="compute",
        window="month",
        cap_value=Decimal(str(cap)),
        enabled=True,
    )


async def _seed_healthy_balance(db_session: AsyncSession, user_id: uuid.UUID) -> None:
    """Give the paying subject a large grant so the gate has no spend hold.

    The paying subject follows segment attribution: an org member's compute bills
    the org subject, so the grant must sit on the org subject (otherwise the
    resume gate reads the org subject as credits-exhausted and the active-spend
    hold masks the compute-cap path under test). A subject with zero grants is
    (correctly) credits-exhausted.
    """
    now = utcnow()
    organization_id = await resolve_organization_id_for_user(db_session, user_id)
    if organization_id is not None:
        subject = await ensure_organization_billing_subject(db_session, organization_id)
        grant_user_id: uuid.UUID | None = None
    else:
        subject = await ensure_personal_billing_subject(db_session, user_id)
        grant_user_id = user_id
    await ensure_billing_grant(
        db_session,
        user_id=grant_user_id,
        billing_subject_id=subject.id,
        grant_type=FREE_INCLUDED_GRANT_TYPE,
        hours_granted=1000.0,
        effective_at=now - timedelta(days=1),
        expires_at=now + timedelta(days=30),
        source_ref=f"test:healthy-balance:{uuid.uuid4()}",
    )


@pytest.mark.asyncio
async def test_open_segment_stamps_owner_organization(
    db_session: AsyncSession,
    test_engine: Any,
) -> None:
    """The real segment-open path records the owner's org and bills the org."""
    user_id, org_id = await _create_org_member(db_session)
    segment = await _open_segment_for(db_session, user_id, seconds=120.0)
    assert segment.organization_id == org_id
    # Who pays is now the org billing subject (2026-07-09 ruling), derived from
    # the same membership lookup as ``organization_id``.
    org_subject = await ensure_organization_billing_subject(db_session, org_id)
    assert segment.billing_subject_id == org_subject.id
    personal = await ensure_personal_billing_subject(db_session, user_id)
    assert segment.billing_subject_id != personal.id


@pytest.mark.asyncio
async def test_org_less_owner_segment_has_no_organization(
    db_session: AsyncSession,
    test_engine: Any,
) -> None:
    """A user with no membership yields an unattributed segment."""
    user_id = await _create_user(db_session)
    segment = await _open_segment_for(db_session, user_id, seconds=120.0)
    assert segment.organization_id is None


@pytest.mark.asyncio
async def test_org_member_segment_bills_org_subject_and_drains_org_grants(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An org member's compute drains the org grant pool, not personal credits."""
    patch_global_session_factory(test_engine, monkeypatch)
    monkeypatch.setattr(settings, "pro_billing_enabled", False)
    user_id, org_id = await _create_org_member(db_session)
    org_subject = await ensure_organization_billing_subject(db_session, org_id)
    personal_subject = await ensure_personal_billing_subject(db_session, user_id)
    now = utcnow()
    org_grant = await ensure_billing_grant(
        db_session,
        user_id=None,
        billing_subject_id=org_subject.id,
        grant_type=FREE_INCLUDED_GRANT_TYPE,
        hours_granted=10.0,
        effective_at=now - timedelta(days=1),
        expires_at=now + timedelta(days=30),
        source_ref=f"test:org-grant:{uuid.uuid4()}",
    )
    personal_grant = await ensure_billing_grant(
        db_session,
        user_id=user_id,
        billing_subject_id=personal_subject.id,
        grant_type=FREE_INCLUDED_GRANT_TYPE,
        hours_granted=10.0,
        effective_at=now - timedelta(days=1),
        expires_at=now + timedelta(days=30),
        source_ref=f"test:personal-grant:{uuid.uuid4()}",
    )

    org_grant_id = org_grant.id
    personal_grant_id = personal_grant.id

    # One real hour of org compute, opened through the production write path.
    segment = await _open_segment_for(db_session, user_id, seconds=3600.0)
    segment.ended_at = utcnow()
    await db_session.flush()
    assert segment.billing_subject_id == org_subject.id
    scan_until = segment.ended_at
    await db_session.commit()

    result = await billing_accounting_service.account_usage_for_billing_subject(
        billing_subject_id=org_subject.id,
        is_paid_cloud=False,
        billing_subscription_id=None,
        period_start=None,
        period_end=None,
        overage_enabled=False,
        billing_mode=BILLING_MODE_OBSERVE,
        scan_until=scan_until,
    )
    assert result.consumed_seconds == pytest.approx(3600.0, abs=5.0)

    db_session.expire_all()
    org_grant_after = await db_session.get(BillingGrant, org_grant_id)
    personal_grant_after = await db_session.get(BillingGrant, personal_grant_id)
    assert org_grant_after is not None and personal_grant_after is not None
    # Org pool drained by the hour of compute; personal pool untouched.
    assert org_grant_after.remaining_seconds == pytest.approx(10 * 3600.0 - 3600.0, abs=5.0)
    assert personal_grant_after.remaining_seconds == pytest.approx(10 * 3600.0)


@pytest.mark.asyncio
async def test_org_less_owner_bills_personal_subject(
    db_session: AsyncSession,
    test_engine: Any,
) -> None:
    """A user with no membership still bills their personal subject."""
    user_id = await _create_user(db_session)
    segment = await _open_segment_for(db_session, user_id, seconds=120.0)
    personal = await ensure_personal_billing_subject(db_session, user_id)
    assert segment.organization_id is None
    assert segment.billing_subject_id == personal.id


@pytest.mark.asyncio
async def test_usage_by_user_display_shows_org_compute(
    db_session: AsyncSession,
    test_engine: Any,
) -> None:
    """The org-admin usage-by-user view reports each member's org compute.

    Scopes compute by ``organization_id`` (not the org billing subject), so it
    surfaces the member's segment even though the segment predates nothing — the
    point is the display no longer reads an empty org-subject compute pool.
    """
    user_id, org_id = await _create_org_member(db_session)
    await _open_segment_for(db_session, user_id, seconds=300.0)
    await db_session.commit()

    response = await get_usage_by_user(db_session, org_id, days=30)
    row = next(row for row in response.users if row.user_id == user_id)
    # Open segment: seconds accrue against ``now``, so allow a little skew.
    assert row.compute_seconds == pytest.approx(300.0, abs=5.0)
