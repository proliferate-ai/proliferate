"""Corridor N2: a stray provider wake of a held/over-limit subject re-pauses.

Law (billing launch-hardening, ruled 2026-07-28): a held or over-limit billing
subject cannot CONTINUE — an inbound ``sandbox.lifecycle.resumed`` webhook for
such a subject must re-pause the provider sandbox and close its usage segment as
quota enforcement, rather than leaving stray compute running until the next
15-minute reconciler pass.

Two defects this file pins closed:

* N2a — the webhook gate resolved ``ensure_personal_billing_subject`` while
  segment attribution and the resume gate resolve
  ``resolve_billing_subject_id_for_user`` (the ORG subject for an org member).
  An org-level hold therefore never re-paused an org member's stray wake.
* N2b — the webhook gate only read ``active_spend_hold`` and never evaluated
  compute budget caps, unlike ``assert_cloud_sandbox_resume_allowed_for_owner``.

N2c is the regression guard: a healthy subject's ``resumed`` webhook still runs
the normal ready/open-segment path, so the gate cannot over-block.

The whole handler runs against real Postgres; only the provider round trip, the
materialization lease, and signature verification are stubbed.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import timedelta
from decimal import Decimal
import json
from typing import Any
import uuid

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.billing import (
    BILLING_DECISION_ENFORCE_ACTIVE_SPEND,
    BILLING_DECISION_ORG_LIMIT_PAUSE,
    BILLING_HOLD_KIND_ADMIN_HOLD,
    BILLING_HOLD_STATUS_ACTIVE,
    BILLING_MODE_ENFORCE,
    FREE_INCLUDED_GRANT_TYPE,
    USAGE_SEGMENT_CLOSED_BY_QUOTA_ENFORCEMENT,
    USAGE_SEGMENT_OPENED_BY_PROVISION,
    USAGE_SEGMENT_OPENED_BY_WEBHOOK_RESUMED,
)
from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_ROLE_OWNER,
)
from proliferate.db.models.auth import User
from proliferate.db.models.billing import BillingDecisionEvent, BillingHold, UsageSegment
from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.store import cloud_sandboxes as sandbox_store
from proliferate.db.store.billing import BudgetLimitInput, replace_budget_limits
from proliferate.db.store.billing_runtime_usage import open_usage_segment_for_sandbox
from proliferate.db.store.billing_subjects import (
    ensure_billing_grant,
    ensure_organization_billing_subject,
    ensure_personal_billing_subject,
)
from proliferate.server.cloud.webhooks import service as webhook_service
from proliferate.lib.infra.time.wall_clock import utcnow
from tests.integration.billing_accounting_helpers import patch_global_session_factory


class _RecordingProvider:
    """Captures the pause the re-pause decision is supposed to trigger."""

    def __init__(self) -> None:
        self.paused: list[str] = []

    async def pause_sandbox(self, external_sandbox_id: str) -> None:
        self.paused.append(external_sandbox_id)


def _install_webhook_stubs(
    monkeypatch: pytest.MonkeyPatch,
    test_engine: Any,
) -> _RecordingProvider:
    """Stub only the provider round trip, the lease, and signature verification.

    The global session factory is repointed at the test engine so any collaborator
    that opens its own session (the pre-fix gate did) reads the test database
    rather than the real one — otherwise the pre-fix code fails with an unrelated
    "Billing subject not found" instead of the behaviour under test.
    """
    provider = _RecordingProvider()
    patch_global_session_factory(test_engine, monkeypatch)

    @asynccontextmanager
    async def _lease(key: str, **_kwargs: object):  # type: ignore[no-untyped-def]
        assert key.startswith("cloud-sandbox:")
        yield

    monkeypatch.setattr(webhook_service, "_verify_e2b_signature", lambda *_args: None)
    monkeypatch.setattr(webhook_service.locks, "redis_materialization_lock", _lease)
    monkeypatch.setattr(webhook_service, "get_sandbox_provider", lambda _name: provider)
    return provider


async def _create_user(db_session: AsyncSession) -> uuid.UUID:
    user = User(
        email=f"n2-webhook-{uuid.uuid4().hex[:10]}@example.com",
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


async def _seed_org_grant(db_session: AsyncSession, organization_id: uuid.UUID) -> None:
    """Give the ORG subject plenty of hours so it is not credits-exhausted.

    A subject with zero grants reads as ``active_spend_hold`` (credits
    exhausted), which would mask the compute-cap path N2b is about.
    """
    now = utcnow()
    subject = await ensure_organization_billing_subject(db_session, organization_id)
    await ensure_billing_grant(
        db_session,
        user_id=None,
        billing_subject_id=subject.id,
        grant_type=FREE_INCLUDED_GRANT_TYPE,
        hours_granted=1000.0,
        effective_at=now - timedelta(days=1),
        expires_at=now + timedelta(days=30),
        source_ref=f"test:n2-org-grant:{uuid.uuid4()}",
    )


async def _seed_running_sandbox(
    db_session: AsyncSession,
    *,
    owner_user_id: uuid.UUID,
    provider_sandbox_id: str,
    open_segment_seconds: float,
) -> tuple[uuid.UUID, UsageSegment]:
    """A ready sandbox with one open usage segment, opened through the real path.

    ``open_usage_segment_for_sandbox`` is the production write path, so the
    segment carries whatever subject/organization attribution the fix must match.
    """
    observed_at = utcnow() - timedelta(seconds=30)
    sandbox = CloudSandbox(
        owner_user_id=owner_user_id,
        sandbox_type="e2b",
        provider_sandbox_id=provider_sandbox_id,
        status="ready",
        materialization_attempt=4,
        provider_observed_at=observed_at,
    )
    db_session.add(sandbox)
    await db_session.flush()
    segment = await open_usage_segment_for_sandbox(
        db_session,
        sandbox_id=sandbox.id,
        external_sandbox_id=provider_sandbox_id,
        sandbox_execution_id=None,
        started_at=utcnow() - timedelta(seconds=open_segment_seconds),
        opened_by=USAGE_SEGMENT_OPENED_BY_PROVISION,
        user_id=owner_user_id,
    )
    await db_session.commit()
    return sandbox.id, segment


async def _fire_resumed_webhook(
    db_session: AsyncSession,
    *,
    sandbox_id: uuid.UUID,
    provider_sandbox_id: str,
) -> None:
    payload = json.dumps(
        {
            "id": f"n2-resumed-{uuid.uuid4().hex[:12]}",
            "type": "sandbox.lifecycle.resumed",
            "sandboxId": provider_sandbox_id,
            "timestamp": (utcnow() - timedelta(seconds=5)).isoformat(),
            "eventData": {"sandbox_metadata": {"cloud_sandbox_id": str(sandbox_id)}},
        }
    ).encode()
    await webhook_service.handle_e2b_webhook(db_session, payload=payload, signature=None)


async def _count_decisions(
    db_session: AsyncSession,
    *,
    billing_subject_id: uuid.UUID,
    decision_type: str,
) -> int:
    return int(
        await db_session.scalar(
            select(func.count())
            .select_from(BillingDecisionEvent)
            .where(
                BillingDecisionEvent.billing_subject_id == billing_subject_id,
                BillingDecisionEvent.decision_type == decision_type,
            )
        )
        or 0
    )


@pytest.mark.asyncio
async def test_org_hold_repauses_org_member_stray_wake(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """N2a: an ORG-level spend hold re-pauses an org member's ``resumed`` wake.

    Fails before the fix: the gate resolved the owner's PERSONAL subject, which
    carries no hold, so the stray wake was accepted as a healthy resume.
    """
    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_ENFORCE)
    monkeypatch.setattr(settings, "pro_billing_enabled", False)
    provider = _install_webhook_stubs(monkeypatch, test_engine)
    user_id, org_id = await _create_org_member(db_session)
    org_subject = await ensure_organization_billing_subject(db_session, org_id)
    personal_subject = await ensure_personal_billing_subject(db_session, user_id)
    # The hold sits on the ORG subject only; personal is deliberately healthy so
    # the old personal-subject resolution would see nothing to enforce.
    await _seed_org_grant(db_session, org_id)
    db_session.add(
        BillingHold(
            billing_subject_id=org_subject.id,
            kind=BILLING_HOLD_KIND_ADMIN_HOLD,
            status=BILLING_HOLD_STATUS_ACTIVE,
            source="test",
        )
    )
    provider_sandbox_id = f"provider-{uuid.uuid4().hex[:10]}"
    sandbox_id, segment = await _seed_running_sandbox(
        db_session,
        owner_user_id=user_id,
        provider_sandbox_id=provider_sandbox_id,
        open_segment_seconds=60.0,
    )
    assert segment.billing_subject_id == org_subject.id

    await _fire_resumed_webhook(
        db_session,
        sandbox_id=sandbox_id,
        provider_sandbox_id=provider_sandbox_id,
    )

    assert provider.paused == [provider_sandbox_id]
    current = await sandbox_store.load_cloud_sandbox_by_id(db_session, sandbox_id, refresh=True)
    assert current is not None
    assert current.status == "paused"
    await db_session.refresh(segment)
    assert segment.ended_at is not None
    assert segment.closed_by == USAGE_SEGMENT_CLOSED_BY_QUOTA_ENFORCEMENT
    # The audit row lands on the paying subject, with the reconciler's
    # quota-enforcement decision vocabulary.
    assert (
        await _count_decisions(
            db_session,
            billing_subject_id=org_subject.id,
            decision_type=BILLING_DECISION_ENFORCE_ACTIVE_SPEND,
        )
        == 1
    )
    assert (
        await _count_decisions(
            db_session,
            billing_subject_id=personal_subject.id,
            decision_type=BILLING_DECISION_ENFORCE_ACTIVE_SPEND,
        )
        == 0
    )


@pytest.mark.asyncio
async def test_breached_compute_cap_repauses_stray_wake(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """N2b: an over-cap subject's ``resumed`` wake re-pauses and closes.

    Fails before the fix: the webhook gate read only ``active_spend_hold`` and
    never walked compute budget caps, so an over-cap wake stood until the next
    reconciler pass.
    """
    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_ENFORCE)
    monkeypatch.setattr(settings, "pro_billing_enabled", False)
    provider = _install_webhook_stubs(monkeypatch, test_engine)
    user_id, org_id = await _create_org_member(db_session)
    org_subject = await ensure_organization_billing_subject(db_session, org_id)
    await _seed_org_grant(db_session, org_id)
    await replace_budget_limits(
        db_session,
        organization_id=org_id,
        limits=[
            BudgetLimitInput(
                user_id=None,
                kind="compute",
                window="month",
                cap_value=Decimal("60"),
                enabled=True,
            )
        ],
    )
    provider_sandbox_id = f"provider-{uuid.uuid4().hex[:10]}"
    # An hour of org compute against a 60-second org-wide cap.
    sandbox_id, segment = await _seed_running_sandbox(
        db_session,
        owner_user_id=user_id,
        provider_sandbox_id=provider_sandbox_id,
        open_segment_seconds=3600.0,
    )

    await _fire_resumed_webhook(
        db_session,
        sandbox_id=sandbox_id,
        provider_sandbox_id=provider_sandbox_id,
    )

    assert provider.paused == [provider_sandbox_id]
    current = await sandbox_store.load_cloud_sandbox_by_id(db_session, sandbox_id, refresh=True)
    assert current is not None
    assert current.status == "paused"
    await db_session.refresh(segment)
    assert segment.ended_at is not None
    assert segment.closed_by == USAGE_SEGMENT_CLOSED_BY_QUOTA_ENFORCEMENT
    assert (
        await _count_decisions(
            db_session,
            billing_subject_id=org_subject.id,
            decision_type=BILLING_DECISION_ORG_LIMIT_PAUSE,
        )
        == 1
    )


@pytest.mark.asyncio
async def test_healthy_subject_wake_is_not_blocked(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """N2c regression: no hold and no cap breach → the wake proceeds normally.

    Pins that the widened gate does not over-block: the sandbox stays ready and
    a fresh webhook-resumed segment opens instead of a quota-enforcement pause.
    """
    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_ENFORCE)
    monkeypatch.setattr(settings, "pro_billing_enabled", False)
    provider = _install_webhook_stubs(monkeypatch, test_engine)
    user_id, org_id = await _create_org_member(db_session)
    await _seed_org_grant(db_session, org_id)
    await replace_budget_limits(
        db_session,
        organization_id=org_id,
        limits=[
            BudgetLimitInput(
                user_id=None,
                kind="compute",
                window="month",
                cap_value=Decimal("100000"),
                enabled=True,
            )
        ],
    )
    provider_sandbox_id = f"provider-{uuid.uuid4().hex[:10]}"
    sandbox_id, segment = await _seed_running_sandbox(
        db_session,
        owner_user_id=user_id,
        provider_sandbox_id=provider_sandbox_id,
        open_segment_seconds=60.0,
    )
    # A resumed webhook opens a fresh segment, so retire the provisioning one
    # first — this test is about the gate's verdict, not segment interleaving.
    segment.ended_at = utcnow() - timedelta(seconds=10)
    segment.closed_by = "manual_stop"
    await db_session.commit()

    await _fire_resumed_webhook(
        db_session,
        sandbox_id=sandbox_id,
        provider_sandbox_id=provider_sandbox_id,
    )

    assert provider.paused == []
    current = await sandbox_store.load_cloud_sandbox_by_id(db_session, sandbox_id, refresh=True)
    assert current is not None
    assert current.status == "ready"
    opened = (
        (
            await db_session.execute(
                select(UsageSegment).where(
                    UsageSegment.sandbox_id == sandbox_id,
                    UsageSegment.ended_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    assert [row.opened_by for row in opened] == [USAGE_SEGMENT_OPENED_BY_WEBHOOK_RESUMED]
    assert (
        await db_session.scalar(
            select(func.count())
            .select_from(BillingDecisionEvent)
            .where(BillingDecisionEvent.decision_type != "authorize_start")
        )
        == 0
    )
