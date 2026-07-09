"""Org compute budget enforcement, driven through the real segment-open path.

Regression coverage for the "org-subject segment attribution gap": compute
``usage_segment`` rows opened by the E2B webhook / provision path used to be
attributed only to the workspace owner's *personal* billing subject, so
org-scoped compute caps never fired. The fix stamps ``organization_id`` on the
segment (owner's current membership) while leaving ``billing_subject_id`` — who
pays — unchanged.

These tests exercise the real write path
(``open_usage_segment_for_sandbox``), then assert enforcement fires:
* an org-wide compute cap crossed by that usage → the live resume gate denies;
* a per-user cap the same;
* a segment for an org-less owner is never attributed, so nothing enforces.
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from decimal import Decimal
from types import SimpleNamespace
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.billing import (
    BILLING_DECISION_ORG_LIMIT_PAUSE,
    BILLING_DECISION_USER_LIMIT_PAUSE,
    BILLING_MODE_ENFORCE,
)
from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_ROLE_OWNER,
)
from proliferate.db.models.auth import User
from proliferate.db.models.billing import UsageSegment
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.store.billing import BudgetLimitInput, replace_budget_limits
from proliferate.db.store.billing_runtime_usage import open_usage_segment_for_sandbox
from proliferate.db.store.billing_subjects import (
    ensure_free_included_grant,
    ensure_personal_billing_subject,
)
from proliferate.server.billing.authorization import (
    CloudSandboxResumeBlockedError,
    assert_cloud_sandbox_resume_allowed,
)
from proliferate.utils.time import utcnow


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
    """Give the personal subject a free grant so the gate has no spend hold.

    With PRO_BILLING_ENABLED the snapshot only auto-grants trial hours to
    GitHub-linked users; a subject with zero grants is (correctly)
    credits-exhausted, which would mask the compute-cap path under test.
    """
    await ensure_personal_billing_subject(db_session, user_id)
    await ensure_free_included_grant(db_session, user_id)


@pytest.mark.asyncio
async def test_open_segment_stamps_owner_organization(
    db_session: AsyncSession,
    test_engine: Any,
) -> None:
    """The real segment-open path records the owner's org (attribution fix)."""
    user_id, org_id = await _create_org_member(db_session)
    segment = await _open_segment_for(db_session, user_id, seconds=120.0)
    assert segment.organization_id == org_id
    # Who pays is unchanged: still the owner's personal billing subject.
    personal = await ensure_personal_billing_subject(db_session, user_id)
    assert segment.billing_subject_id == personal.id


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
async def test_org_wide_compute_cap_denies_resume(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Org-wide compute cap crossed by real usage → resume denied."""
    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_ENFORCE)
    monkeypatch.setattr(settings, "pro_billing_enabled", False)
    user_id, org_id = await _create_org_member(db_session)
    await _seed_healthy_balance(db_session, user_id)
    await _open_segment_for(db_session, user_id, seconds=3600.0)
    await replace_budget_limits(
        db_session, organization_id=org_id, limits=[_compute_limit(None, 60.0)]
    )
    await db_session.commit()

    sandbox = SimpleNamespace(owner_user_id=user_id, organization_id=None)
    with pytest.raises(CloudSandboxResumeBlockedError) as excinfo:
        await assert_cloud_sandbox_resume_allowed(db_session, sandbox)  # type: ignore[arg-type]
    assert excinfo.value.decision_type == BILLING_DECISION_ORG_LIMIT_PAUSE
    assert excinfo.value.status_code == 402
    await db_session.rollback()


@pytest.mark.asyncio
async def test_per_user_compute_cap_denies_resume(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Per-user compute cap crossed by real usage → resume denied."""
    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_ENFORCE)
    monkeypatch.setattr(settings, "pro_billing_enabled", False)
    user_id, org_id = await _create_org_member(db_session)
    await _seed_healthy_balance(db_session, user_id)
    await _open_segment_for(db_session, user_id, seconds=3600.0)
    await replace_budget_limits(
        db_session, organization_id=org_id, limits=[_compute_limit(user_id, 60.0)]
    )
    await db_session.commit()

    sandbox = SimpleNamespace(owner_user_id=user_id, organization_id=None)
    with pytest.raises(CloudSandboxResumeBlockedError) as excinfo:
        await assert_cloud_sandbox_resume_allowed(db_session, sandbox)  # type: ignore[arg-type]
    assert excinfo.value.decision_type == BILLING_DECISION_USER_LIMIT_PAUSE
    await db_session.rollback()


@pytest.mark.asyncio
async def test_under_cap_resume_allowed(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Usage below the org cap does not block a wake."""
    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_ENFORCE)
    monkeypatch.setattr(settings, "pro_billing_enabled", False)
    user_id, org_id = await _create_org_member(db_session)
    await _seed_healthy_balance(db_session, user_id)
    await _open_segment_for(db_session, user_id, seconds=60.0)
    await replace_budget_limits(
        db_session, organization_id=org_id, limits=[_compute_limit(None, 100000.0)]
    )
    await db_session.commit()

    sandbox = SimpleNamespace(owner_user_id=user_id, organization_id=None)
    await assert_cloud_sandbox_resume_allowed(db_session, sandbox)  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_personal_workspace_unaffected_by_any_org_cap(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An org-less owner is never enforced against org caps; resume allowed.

    Even with heavy real usage, a segment for a user with no membership carries
    ``organization_id=None``, so no org cap can bind — the personal path is
    unaffected by the fix.
    """
    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_ENFORCE)
    monkeypatch.setattr(settings, "pro_billing_enabled", False)
    user_id = await _create_user(db_session)
    await _seed_healthy_balance(db_session, user_id)
    segment = await _open_segment_for(db_session, user_id, seconds=3600.0)
    assert segment.organization_id is None
    await db_session.commit()

    sandbox = SimpleNamespace(owner_user_id=user_id, organization_id=None)
    await assert_cloud_sandbox_resume_allowed(db_session, sandbox)  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_org_wide_cap_sums_across_members(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Org-wide usage aggregates across members regardless of who pays.

    Two members of the same org each run a sandbox billed to their own personal
    subject; the org-wide cap sums both segments' seconds by ``organization_id``.
    """
    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_ENFORCE)
    monkeypatch.setattr(settings, "pro_billing_enabled", False)
    owner_id, org_id = await _create_org_member(db_session)
    await _seed_healthy_balance(db_session, owner_id)
    second_id = await _create_user(db_session)
    db_session.add(
        OrganizationMembership(
            organization_id=org_id,
            user_id=second_id,
            role=ORGANIZATION_ROLE_OWNER,
            status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
        )
    )
    await db_session.flush()
    # Each member uses 40s; neither alone crosses a 60s org-wide cap, together
    # they do.
    await _open_segment_for(db_session, owner_id, seconds=40.0)
    await _open_segment_for(db_session, second_id, seconds=40.0)
    await replace_budget_limits(
        db_session, organization_id=org_id, limits=[_compute_limit(None, 60.0)]
    )
    await db_session.commit()

    # Both segments are attributed to the org.
    seg_org_ids = (
        (
            await db_session.execute(
                select(UsageSegment.organization_id).where(UsageSegment.organization_id == org_id)
            )
        )
        .scalars()
        .all()
    )
    assert len(seg_org_ids) == 2

    sandbox = SimpleNamespace(owner_user_id=owner_id, organization_id=None)
    with pytest.raises(CloudSandboxResumeBlockedError) as excinfo:
        await assert_cloud_sandbox_resume_allowed(db_session, sandbox)  # type: ignore[arg-type]
    assert excinfo.value.decision_type == BILLING_DECISION_ORG_LIMIT_PAUSE
    await db_session.rollback()
