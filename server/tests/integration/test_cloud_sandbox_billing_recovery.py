"""Exact provider-usage fences for managed CloudSandbox recovery."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from proliferate.constants.billing import (
    USAGE_SEGMENT_CLOSED_BY_PROVISION_FAILURE,
    USAGE_SEGMENT_CLOSED_BY_QUOTA_ENFORCEMENT,
)
from proliferate.db.models.auth import User
from proliferate.db.models.billing import UsageSegment
from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.db.store.billing_subjects import ensure_personal_billing_subject
from proliferate.server.billing import reconciler
from tests.integration.billing_accounting_helpers import patch_global_session_factory

NOW = datetime(2026, 7, 7, 12, 0, tzinfo=UTC)


async def _seed_provider_usage(
    db: AsyncSession,
    *,
    provider_sandbox_id: str,
    status: str,
    usage_provider_sandbox_id: str | None = None,
) -> tuple[CloudSandbox, UsageSegment]:
    user = User(
        email=f"billing-recovery-{uuid4().hex}@example.com",
        hashed_password="unused-oauth-only",
        is_active=True,
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    subject = await ensure_personal_billing_subject(db, user.id)
    sandbox = CloudSandbox(
        owner_user_id=user.id,
        sandbox_type="e2b",
        provider_sandbox_id=provider_sandbox_id,
        status=status,
        destroyed_at=NOW if status == "destroyed" else None,
    )
    db.add(sandbox)
    await db.flush()
    segment = UsageSegment(
        user_id=user.id,
        billing_subject_id=subject.id,
        sandbox_id=sandbox.id,
        external_sandbox_id=usage_provider_sandbox_id or provider_sandbox_id,
        started_at=NOW,
        ended_at=None,
        is_billable=True,
        opened_by="provision",
    )
    db.add(segment)
    await db.commit()
    return sandbox, segment


@pytest.mark.asyncio
async def test_provider_mismatch_rolls_back_lifecycle_transition(
    db_session: AsyncSession,
    test_engine: AsyncEngine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    patch_global_session_factory(test_engine, monkeypatch)
    sandbox, segment = await _seed_provider_usage(
        db_session,
        provider_sandbox_id="provider-current",
        usage_provider_sandbox_id="provider-conflicting",
        status="ready",
    )

    with pytest.raises(RuntimeError, match="different provider sandbox"):
        await reconciler._mark_sandbox_environment_unavailable(
            sandbox.id,
            destroyed=False,
            expected_provider_sandbox_id="provider-current",
            expected_status="ready",
            ended_at=NOW,
            closed_by=USAGE_SEGMENT_CLOSED_BY_QUOTA_ENFORCEMENT,
        )

    await db_session.refresh(sandbox)
    await db_session.refresh(segment)
    assert sandbox.status == "ready"
    assert sandbox.provider_sandbox_id == "provider-current"
    assert segment.ended_at is None


@pytest.mark.asyncio
async def test_killed_observation_closes_usage_after_explicit_delete(
    db_session: AsyncSession,
    test_engine: AsyncEngine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    patch_global_session_factory(test_engine, monkeypatch)
    provider_id = "provider-destroyed-before-reconcile"
    sandbox, segment = await _seed_provider_usage(
        db_session,
        provider_sandbox_id=provider_id,
        status="destroyed",
    )

    closed = await reconciler._mark_sandbox_environment_unavailable(
        sandbox.id,
        destroyed=True,
        expected_provider_sandbox_id=provider_id,
        expected_status="ready",
        ended_at=NOW + timedelta(seconds=1),
        closed_by=USAGE_SEGMENT_CLOSED_BY_PROVISION_FAILURE,
    )

    await db_session.refresh(sandbox)
    await db_session.refresh(segment)
    assert closed is True
    assert sandbox.status == "destroyed"
    assert sandbox.provider_sandbox_id == provider_id
    assert sandbox.destroyed_at == NOW
    assert segment.ended_at == NOW + timedelta(seconds=1)
    assert segment.closed_by == USAGE_SEGMENT_CLOSED_BY_PROVISION_FAILURE
