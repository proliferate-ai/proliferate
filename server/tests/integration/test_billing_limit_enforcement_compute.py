"""Compute budget-limit enforcement (spec §4.2/§4.3).

Layers exercised here:
* ``_resolve_compute_limit_pause`` — the decision logic (real Postgres):
  over-cap window usage yields ``user_limit_pause``/``org_limit_pause``, and it
  is enforce-mode + org-scoped only.
* ``_enforce_or_reconcile_segment`` — the ``limit_breached`` flag and an active
  spend hold both drive the quota-enforcement pause (stubbed collaborators).
* ``assert_cloud_sandbox_resume_allowed`` — the LIVE start/resume gate denies
  waking a paused-for-billing sandbox (spend hold) with a structured 402.

The reconciler was revived in this branch (ported off the removed
``CloudRuntimeEnvironment`` tables onto ``CloudSandbox``), so these tests import
it directly and run — no more ``importorskip``.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from typing import Any

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.billing import (
    BILLING_DECISION_ENFORCE_ACTIVE_SPEND,
    BILLING_HOLD_KIND_ADMIN_HOLD,
    BILLING_HOLD_STATUS_ACTIVE,
    BILLING_MODE_ENFORCE,
    BILLING_MODE_OBSERVE,
    USAGE_SEGMENT_CLOSED_BY_QUOTA_ENFORCEMENT,
)
from proliferate.db.models.auth import User
from proliferate.db.models.billing import BillingDecisionEvent, BillingHold, UsageSegment
from proliferate.db.models.organizations import Organization
from proliferate.db.store.billing import BudgetLimitInput, replace_budget_limits
from proliferate.db.store.billing_subjects import (
    ensure_organization_billing_subject,
    ensure_personal_billing_subject,
)
from proliferate.integrations.sandbox.base import ProviderSandboxState
from proliferate.server.billing import reconciler as reconciler_module
from proliferate.server.billing.authorization import (
    CloudSandboxResumeBlockedError,
    assert_cloud_sandbox_resume_allowed,
)
from tests.integration.billing_accounting_helpers import patch_global_session_factory

_enforce_or_reconcile_segment = reconciler_module._enforce_or_reconcile_segment
_resolve_compute_limit_pause = reconciler_module._resolve_compute_limit_pause

NOW = datetime(2026, 7, 7, 12, 0, tzinfo=UTC)


async def _create_user(db_session: AsyncSession) -> uuid.UUID:
    user = User(
        email=f"compute-{uuid.uuid4().hex[:10]}@example.com",
        hashed_password="unused-oauth-only",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db_session.add(user)
    await db_session.flush()
    return user.id


def _segment(*, subject_id: uuid.UUID, user_id: uuid.UUID, seconds: float) -> UsageSegment:
    started = NOW - timedelta(seconds=seconds)
    return UsageSegment(
        user_id=user_id,
        billing_subject_id=subject_id,
        workspace_id=uuid.uuid4(),
        sandbox_id=uuid.uuid4(),
        external_sandbox_id=f"sandbox-{uuid.uuid4().hex[:8]}",
        started_at=started,
        ended_at=NOW,
        is_billable=True,
        opened_by="provision",
        closed_by="manual_stop",
    )


async def _seed_org_with_usage(
    db_session: AsyncSession,
    *,
    make_limits: Callable[[uuid.UUID], list[BudgetLimitInput]],
    used_seconds: float,
) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    org = Organization(name=f"org-{uuid.uuid4().hex[:8]}", status="active")
    db_session.add(org)
    await db_session.flush()
    subject = await ensure_organization_billing_subject(db_session, org.id)
    user_id = await _create_user(db_session)
    db_session.add(_segment(subject_id=subject.id, user_id=user_id, seconds=used_seconds))
    await replace_budget_limits(db_session, organization_id=org.id, limits=make_limits(user_id))
    await db_session.commit()
    return org.id, subject.id, user_id


def _compute_limit(user_id: uuid.UUID | None, cap: float) -> BudgetLimitInput:
    return BudgetLimitInput(
        user_id=user_id,
        kind="compute",
        window="month",
        cap_value=Decimal(str(cap)),
        enabled=True,
    )


@pytest.mark.asyncio
async def test_resolve_per_user_cap_breach(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    patch_global_session_factory(test_engine, monkeypatch)
    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_ENFORCE)
    _org, subject_id, user_id = await _seed_org_with_usage(
        db_session, make_limits=lambda uid: [_compute_limit(uid, 60.0)], used_seconds=3600.0
    )
    segment = SimpleNamespace(billing_subject_id=subject_id, user_id=user_id)
    decision = await _resolve_compute_limit_pause(
        segment=segment,
        org_id_by_subject={},
        compute_limits_by_org={},
        spend_cache={},
        now=NOW,
    )
    assert decision == "user_limit_pause"


@pytest.mark.asyncio
async def test_resolve_org_wide_cap_breach(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    patch_global_session_factory(test_engine, monkeypatch)
    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_ENFORCE)
    _org, subject_id, user_id = await _seed_org_with_usage(
        db_session, make_limits=lambda _uid: [_compute_limit(None, 60.0)], used_seconds=3600.0
    )
    segment = SimpleNamespace(billing_subject_id=subject_id, user_id=user_id)
    decision = await _resolve_compute_limit_pause(
        segment=segment,
        org_id_by_subject={},
        compute_limits_by_org={},
        spend_cache={},
        now=NOW,
    )
    assert decision == "org_limit_pause"


@pytest.mark.asyncio
async def test_resolve_under_cap_returns_none(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    patch_global_session_factory(test_engine, monkeypatch)
    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_ENFORCE)
    _org, subject_id, user_id = await _seed_org_with_usage(
        db_session, make_limits=lambda uid: [_compute_limit(uid, 100000.0)], used_seconds=3600.0
    )
    segment = SimpleNamespace(billing_subject_id=subject_id, user_id=user_id)
    decision = await _resolve_compute_limit_pause(
        segment=segment,
        org_id_by_subject={},
        compute_limits_by_org={},
        spend_cache={},
        now=NOW,
    )
    assert decision is None


@pytest.mark.asyncio
async def test_resolve_skips_observe_mode(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    patch_global_session_factory(test_engine, monkeypatch)
    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_OBSERVE)
    _org, subject_id, user_id = await _seed_org_with_usage(
        db_session, make_limits=lambda uid: [_compute_limit(uid, 60.0)], used_seconds=3600.0
    )
    segment = SimpleNamespace(billing_subject_id=subject_id, user_id=user_id)
    decision = await _resolve_compute_limit_pause(
        segment=segment,
        org_id_by_subject={},
        compute_limits_by_org={},
        spend_cache={},
        now=NOW,
    )
    assert decision is None


@pytest.mark.asyncio
async def test_resolve_skips_personal_subject(
    db_session: AsyncSession,
    test_engine: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A subject with no organization (personal) never binds an org limit."""
    patch_global_session_factory(test_engine, monkeypatch)
    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_ENFORCE)
    from proliferate.db.store.billing_subjects import ensure_personal_billing_subject

    user_id = await _create_user(db_session)
    subject = await ensure_personal_billing_subject(db_session, user_id)
    db_session.add(_segment(subject_id=subject.id, user_id=user_id, seconds=3600.0))
    await db_session.commit()
    segment = SimpleNamespace(billing_subject_id=subject.id, user_id=user_id)
    decision = await _resolve_compute_limit_pause(
        segment=segment,
        org_id_by_subject={},
        compute_limits_by_org={},
        spend_cache={},
        now=NOW,
    )
    assert decision is None


class _FakeProvider:
    def __init__(self) -> None:
        self.paused: list[str] = []

    async def pause_sandbox(self, external_sandbox_id: str) -> None:
        self.paused.append(external_sandbox_id)


def _patch_enforce_collaborators(
    monkeypatch: pytest.MonkeyPatch,
    *,
    sandbox_id: uuid.UUID,
    closed: list[tuple[uuid.UUID, str]],
    fake: _FakeProvider,
) -> None:
    """Stub the reconciler's DB/provider collaborators for a single segment."""

    async def _load(_db: Any, _sandbox_id: uuid.UUID, **_kw: Any) -> Any:
        return SimpleNamespace(id=sandbox_id, e2b_sandbox_id="ext-1")

    async def _close(*, sandbox_id: uuid.UUID, ended_at: Any, closed_by: str, **_kw: Any) -> None:
        closed.append((sandbox_id, closed_by))

    async def _noop(*_a: Any, **_kw: Any) -> None:
        return None

    monkeypatch.setattr(reconciler_module, "load_cloud_sandbox_by_id", _load)
    monkeypatch.setattr(reconciler_module, "close_usage_segment_for_sandbox", _close)
    monkeypatch.setattr(reconciler_module, "_mark_sandbox_environment_unavailable", _noop)
    monkeypatch.setattr(reconciler_module, "get_configured_sandbox_provider", lambda: fake)


def _running_state() -> ProviderSandboxState:
    return ProviderSandboxState(
        external_sandbox_id="ext-1",
        state="running",
        started_at=NOW,
        end_at=None,
        observed_at=NOW,
        metadata={},
    )


def _segment_ns() -> SimpleNamespace:
    return SimpleNamespace(
        sandbox_id=uuid.uuid4(),
        billing_subject_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        workspace_id=uuid.uuid4(),
    )


@pytest.mark.asyncio
async def test_enforce_segment_pauses_on_limit_breached(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """limit_breached=True drives the quota-enforcement pause + close."""
    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_ENFORCE)
    closed: list[tuple[uuid.UUID, str]] = []
    fake = _FakeProvider()
    segment = _segment_ns()
    _patch_enforce_collaborators(
        monkeypatch, sandbox_id=segment.sandbox_id, closed=closed, fake=fake
    )
    await _enforce_or_reconcile_segment(
        segment=segment,  # type: ignore[arg-type]
        provider=fake,  # type: ignore[arg-type]
        state=_running_state(),
        billing_snapshot=SimpleNamespace(active_spend_hold=False),  # type: ignore[arg-type]
        limit_breached=True,
    )
    assert fake.paused == ["ext-1"]
    assert closed == [(segment.sandbox_id, USAGE_SEGMENT_CLOSED_BY_QUOTA_ENFORCEMENT)]


@pytest.mark.asyncio
async def test_enforce_segment_pauses_on_spend_hold(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An active spend hold pauses + closes the segment (no limit breach needed)."""
    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_ENFORCE)
    closed: list[tuple[uuid.UUID, str]] = []
    fake = _FakeProvider()
    segment = _segment_ns()
    _patch_enforce_collaborators(
        monkeypatch, sandbox_id=segment.sandbox_id, closed=closed, fake=fake
    )
    await _enforce_or_reconcile_segment(
        segment=segment,  # type: ignore[arg-type]
        provider=fake,  # type: ignore[arg-type]
        state=_running_state(),
        billing_snapshot=SimpleNamespace(active_spend_hold=True),  # type: ignore[arg-type]
        limit_breached=False,
    )
    assert fake.paused == ["ext-1"]
    assert closed == [(segment.sandbox_id, USAGE_SEGMENT_CLOSED_BY_QUOTA_ENFORCEMENT)]


@pytest.mark.asyncio
async def test_enforce_segment_no_pause_when_not_breached(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_ENFORCE)
    closed: list[tuple[uuid.UUID, str]] = []
    fake = _FakeProvider()
    segment = _segment_ns()
    _patch_enforce_collaborators(
        monkeypatch, sandbox_id=segment.sandbox_id, closed=closed, fake=fake
    )
    await _enforce_or_reconcile_segment(
        segment=segment,  # type: ignore[arg-type]
        provider=fake,  # type: ignore[arg-type]
        state=_running_state(),
        billing_snapshot=SimpleNamespace(active_spend_hold=False),  # type: ignore[arg-type]
        limit_breached=False,
    )
    assert fake.paused == []
    assert closed == []


# ── Resume-deny gate (spec §4.3) ──


async def _seed_user_with_spend_hold(db_session: AsyncSession) -> tuple[uuid.UUID, uuid.UUID]:
    user_id = await _create_user(db_session)
    subject = await ensure_personal_billing_subject(db_session, user_id)
    db_session.add(
        BillingHold(
            billing_subject_id=subject.id,
            kind=BILLING_HOLD_KIND_ADMIN_HOLD,
            status=BILLING_HOLD_STATUS_ACTIVE,
            source="test",
        )
    )
    await db_session.commit()
    return user_id, subject.id


@pytest.mark.asyncio
async def test_resume_denied_on_spend_hold(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A subject on an active spend hold cannot wake a sandbox; a decision is logged."""
    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_ENFORCE)
    user_id, subject_id = await _seed_user_with_spend_hold(db_session)
    sandbox = SimpleNamespace(owner_user_id=user_id, organization_id=None)

    with pytest.raises(CloudSandboxResumeBlockedError) as excinfo:
        await assert_cloud_sandbox_resume_allowed(db_session, sandbox)  # type: ignore[arg-type]

    assert excinfo.value.decision_type == BILLING_DECISION_ENFORCE_ACTIVE_SPEND
    assert excinfo.value.status_code == 402
    # Mirror the production caller (materialization/runner._run_with_fresh_session),
    # which rolls back its session in the exception handler. The decision event
    # must have been committed by the gate itself, so it survives this rollback.
    await db_session.rollback()
    recorded = await db_session.scalar(
        select(func.count())
        .select_from(BillingDecisionEvent)
        .where(
            BillingDecisionEvent.billing_subject_id == subject_id,
            BillingDecisionEvent.decision_type == BILLING_DECISION_ENFORCE_ACTIVE_SPEND,
        )
    )
    assert recorded == 1


@pytest.mark.asyncio
async def test_resume_allowed_without_hold(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A healthy subject wakes normally (gate is a no-op)."""
    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_ENFORCE)
    user_id = await _create_user(db_session)
    await ensure_personal_billing_subject(db_session, user_id)
    await db_session.commit()
    sandbox = SimpleNamespace(owner_user_id=user_id, organization_id=None)
    await assert_cloud_sandbox_resume_allowed(db_session, sandbox)  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_resume_gate_noop_outside_enforce_mode(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Even with a spend hold, observe mode never blocks a wake."""
    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_OBSERVE)
    user_id, _subject_id = await _seed_user_with_spend_hold(db_session)
    sandbox = SimpleNamespace(owner_user_id=user_id, organization_id=None)
    await assert_cloud_sandbox_resume_allowed(db_session, sandbox)  # type: ignore[arg-type]
