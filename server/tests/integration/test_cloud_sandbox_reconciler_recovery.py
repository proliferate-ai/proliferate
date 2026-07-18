"""Reconciler recovery fences at the real provider-error seam."""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from proliferate.config import settings
from proliferate.constants.billing import (
    BILLING_MODE_ENFORCE,
    USAGE_SEGMENT_CLOSED_BY_BINDING_CONVERGENCE,
    USAGE_SEGMENT_CLOSED_BY_PROVISION_FAILURE,
    USAGE_SEGMENT_CLOSED_BY_RECONCILER,
)
from proliferate.db.models.auth import User
from proliferate.db.models.billing import UsageSegment
from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.db.store.billing_subjects import ensure_personal_billing_subject
from proliferate.integrations.sandbox import (
    ProviderSandboxState,
    SandboxProviderConfigurationError,
    SandboxProviderTargetUnavailableError,
    SandboxProviderUnavailableError,
)
from proliferate.server.billing import reconciler
from proliferate.server.cloud.materialization.failures import (
    PROVIDER_SANDBOX_MISSING_RECEIPT,
)
from tests.integration.billing_accounting_helpers import patch_global_session_factory

NOW = datetime(2026, 7, 7, 12, 0, tzinfo=UTC)


async def _seed_open_provider_usage(
    db: AsyncSession,
    *,
    provider_sandbox_id: str,
    destroyed: bool = False,
    legacy_null_usage: bool = False,
) -> tuple[CloudSandbox, UsageSegment]:
    user = User(
        email=f"reconciler-recovery-{uuid4().hex}@example.com",
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
        status="destroyed" if destroyed else "ready",
        materialization_attempt=5,
        provider_observed_at=NOW,
        destroyed_at=NOW if destroyed else None,
    )
    db.add(sandbox)
    await db.flush()
    segment = UsageSegment(
        user_id=user.id,
        billing_subject_id=subject.id,
        sandbox_id=sandbox.id,
        external_sandbox_id=None if legacy_null_usage else provider_sandbox_id,
        started_at=NOW,
        ended_at=None,
        is_billable=True,
        opened_by="provision",
    )
    db.add(segment)
    await db.commit()
    return sandbox, segment


class _ObservingProvider:
    def __init__(
        self,
        error: Exception,
        *,
        events: list[str],
        lock_state: dict[str, bool],
    ) -> None:
        self.error = error
        self.events = events
        self.lock_state = lock_state
        self.paused: list[str] = []

    async def get_sandbox_state(self, _external_sandbox_id: str) -> None:
        assert self.lock_state["held"] is True
        self.events.append("get")
        raise self.error

    async def pause_sandbox(self, external_sandbox_id: str) -> None:
        self.paused.append(external_sandbox_id)


def _patch_recording_materialization_lock(
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[list[str], dict[str, bool]]:
    events: list[str] = []
    lock_state = {"held": False}

    @asynccontextmanager
    async def _locked(key: str, **_kwargs: object):
        assert key.startswith("cloud-sandbox:")
        assert lock_state["held"] is False
        lock_state["held"] = True
        events.append("enter")
        try:
            yield
        finally:
            events.append("exit")
            lock_state["held"] = False

    monkeypatch.setattr(reconciler.locks, "redis_materialization_lock", _locked)
    return events, lock_state


async def _reconcile_unknown_state(
    segment: UsageSegment,
    provider: _ObservingProvider,
) -> None:
    await reconciler._enforce_or_reconcile_segment(
        segment=segment,
        provider=provider,  # type: ignore[arg-type]
        state=None,
        billing_snapshot=SimpleNamespace(active_spend_hold=False),  # type: ignore[arg-type]
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("legacy_null_usage", [False, True], ids=["exact", "legacy-null"])
async def test_direct_target_missing_detaches_active_binding_and_closes_exact_usage(
    db_session: AsyncSession,
    test_engine: AsyncEngine,
    monkeypatch: pytest.MonkeyPatch,
    legacy_null_usage: bool,
) -> None:
    patch_global_session_factory(test_engine, monkeypatch)
    sandbox, segment = await _seed_open_provider_usage(
        db_session,
        provider_sandbox_id="provider-active-missing",
        legacy_null_usage=legacy_null_usage,
    )
    events, lock_state = _patch_recording_materialization_lock(monkeypatch)
    provider = _ObservingProvider(
        SandboxProviderTargetUnavailableError("provider target is absent"),
        events=events,
        lock_state=lock_state,
    )

    await _reconcile_unknown_state(segment, provider)

    await db_session.refresh(sandbox)
    await db_session.refresh(segment)
    assert events == ["enter", "get", "exit"]
    assert sandbox.status == "error"
    assert sandbox.provider_sandbox_id is None
    assert sandbox.materialization_attempt == 5
    assert sandbox.last_error == PROVIDER_SANDBOX_MISSING_RECEIPT
    assert segment.ended_at is not None
    assert segment.closed_by == (
        USAGE_SEGMENT_CLOSED_BY_BINDING_CONVERGENCE
        if legacy_null_usage
        else USAGE_SEGMENT_CLOSED_BY_PROVISION_FAILURE
    )


@pytest.mark.asyncio
async def test_direct_target_missing_preserves_destroyed_binding_and_closes_exact_usage(
    db_session: AsyncSession,
    test_engine: AsyncEngine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    patch_global_session_factory(test_engine, monkeypatch)
    provider_id = "provider-explicitly-destroyed"
    sandbox, segment = await _seed_open_provider_usage(
        db_session,
        provider_sandbox_id=provider_id,
        destroyed=True,
    )
    events, lock_state = _patch_recording_materialization_lock(monkeypatch)
    provider = _ObservingProvider(
        SandboxProviderTargetUnavailableError("provider target is absent"),
        events=events,
        lock_state=lock_state,
    )

    await _reconcile_unknown_state(segment, provider)

    await db_session.refresh(sandbox)
    await db_session.refresh(segment)
    assert events == ["enter", "get", "exit"]
    assert sandbox.status == "destroyed"
    assert sandbox.provider_sandbox_id == provider_id
    assert sandbox.destroyed_at == NOW
    assert segment.ended_at is not None
    assert segment.closed_by == USAGE_SEGMENT_CLOSED_BY_PROVISION_FAILURE


@pytest.mark.parametrize("provider_state", ["paused", "stopped"])
@pytest.mark.asyncio
async def test_terminal_state_closes_destroyed_binding_usage_without_changing_deletion(
    db_session: AsyncSession,
    test_engine: AsyncEngine,
    monkeypatch: pytest.MonkeyPatch,
    provider_state: str,
) -> None:
    patch_global_session_factory(test_engine, monkeypatch)
    provider_id = f"provider-destroyed-{provider_state}"
    sandbox, segment = await _seed_open_provider_usage(
        db_session,
        provider_sandbox_id=provider_id,
        destroyed=True,
    )
    terminal_at = NOW + timedelta(seconds=30)

    await reconciler._enforce_or_reconcile_segment(
        segment=segment,
        provider=_PauseProvider(),  # type: ignore[arg-type]
        state=ProviderSandboxState(
            external_sandbox_id=provider_id,
            state=provider_state,
            started_at=NOW,
            end_at=terminal_at,
            observed_at=terminal_at,
            metadata={},
        ),
        billing_snapshot=SimpleNamespace(active_spend_hold=False),  # type: ignore[arg-type]
    )

    await db_session.refresh(sandbox)
    await db_session.refresh(segment)
    assert sandbox.status == "destroyed"
    assert sandbox.provider_sandbox_id == provider_id
    assert sandbox.materialization_attempt == 5
    assert sandbox.destroyed_at == NOW
    assert sandbox.provider_observed_at == terminal_at
    assert segment.ended_at == terminal_at
    assert segment.closed_by == USAGE_SEGMENT_CLOSED_BY_RECONCILER


@pytest.mark.parametrize(
    ("expected_attempt", "observed_at"),
    [(4, NOW + timedelta(seconds=1)), (5, NOW)],
    ids=["stale-attempt", "stale-observation"],
)
@pytest.mark.asyncio
async def test_destroyed_usage_close_fallback_rejects_stale_authority(
    db_session: AsyncSession,
    test_engine: AsyncEngine,
    monkeypatch: pytest.MonkeyPatch,
    expected_attempt: int,
    observed_at: datetime,
) -> None:
    patch_global_session_factory(test_engine, monkeypatch)
    provider_id = "provider-destroyed-stale"
    sandbox, segment = await _seed_open_provider_usage(
        db_session,
        provider_sandbox_id=provider_id,
        destroyed=True,
    )

    closed = await reconciler._mark_sandbox_environment_unavailable(
        sandbox.id,
        destroyed=False,
        expected_provider_sandbox_id=provider_id,
        expected_materialization_attempt=expected_attempt,
        provider_observed_at=observed_at,
        ended_at=observed_at,
        closed_by=USAGE_SEGMENT_CLOSED_BY_RECONCILER,
    )

    await db_session.refresh(sandbox)
    await db_session.refresh(segment)
    assert closed is False
    assert sandbox.status == "destroyed"
    assert sandbox.provider_sandbox_id == provider_id
    assert sandbox.materialization_attempt == 5
    assert sandbox.provider_observed_at == NOW
    assert segment.ended_at is None
    assert segment.closed_by is None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "provider_error",
    [
        SandboxProviderUnavailableError("provider temporarily unavailable"),
        SandboxProviderConfigurationError("provider configuration unavailable"),
        RuntimeError("unexpected provider failure"),
    ],
    ids=["transient", "configuration", "generic"],
)
async def test_direct_provider_non_target_errors_leave_binding_and_usage_open(
    db_session: AsyncSession,
    test_engine: AsyncEngine,
    monkeypatch: pytest.MonkeyPatch,
    provider_error: Exception,
) -> None:
    patch_global_session_factory(test_engine, monkeypatch)
    provider_id = f"provider-{type(provider_error).__name__}"
    sandbox, segment = await _seed_open_provider_usage(
        db_session,
        provider_sandbox_id=provider_id,
    )
    events, lock_state = _patch_recording_materialization_lock(monkeypatch)
    provider = _ObservingProvider(
        provider_error,
        events=events,
        lock_state=lock_state,
    )

    await _reconcile_unknown_state(segment, provider)

    await db_session.refresh(sandbox)
    await db_session.refresh(segment)
    assert events == ["enter", "get", "exit"]
    assert sandbox.status == "ready"
    assert sandbox.provider_sandbox_id == provider_id
    assert sandbox.materialization_attempt == 5
    assert sandbox.last_error is None
    assert segment.ended_at is None
    assert segment.closed_by is None


class _PauseProvider:
    def __init__(self) -> None:
        self.paused: list[str] = []

    async def pause_sandbox(self, external_sandbox_id: str) -> None:
        self.paused.append(external_sandbox_id)


def _sandbox_value(
    sandbox_id: UUID,
    *,
    provider_id: str,
    attempt: int,
    observed_at: datetime,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=sandbox_id,
        e2b_sandbox_id=provider_id,
        status="ready",
        materialization_attempt=attempt,
        provider_observed_at=observed_at,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("replacement_kind", ["binding", "attempt"])
async def test_quota_pause_cannot_mutate_replacement_loaded_under_lock(
    monkeypatch: pytest.MonkeyPatch,
    replacement_kind: str,
) -> None:
    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_ENFORCE)
    sandbox_id = uuid4()
    segment = SimpleNamespace(sandbox_id=sandbox_id, external_sandbox_id="provider-old")
    old = _sandbox_value(
        sandbox_id,
        provider_id="provider-old",
        attempt=8,
        observed_at=NOW - timedelta(seconds=1),
    )
    replacement = _sandbox_value(
        sandbox_id,
        provider_id="provider-new" if replacement_kind == "binding" else "provider-old",
        attempt=9,
        observed_at=NOW + timedelta(seconds=1),
    )
    loads = 0

    async def _load(*_args: object, **_kwargs: object) -> SimpleNamespace:
        nonlocal loads
        loads += 1
        return old if loads == 1 else replacement

    @asynccontextmanager
    async def _locked(_key: str, **_kwargs: object):
        yield

    async def _unexpected(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("stale quota observation must not close replacement usage")

    provider = _PauseProvider()
    monkeypatch.setattr(reconciler, "load_cloud_sandbox_by_id", _load)
    monkeypatch.setattr(reconciler.locks, "redis_materialization_lock", _locked)
    monkeypatch.setattr(reconciler, "_mark_sandbox_environment_unavailable", _unexpected)

    await reconciler._enforce_or_reconcile_segment(
        segment=segment,  # type: ignore[arg-type]
        provider=provider,  # type: ignore[arg-type]
        state=ProviderSandboxState(
            external_sandbox_id="provider-old",
            state="running",
            started_at=NOW,
            end_at=None,
            observed_at=NOW,
            metadata={},
        ),
        billing_snapshot=SimpleNamespace(active_spend_hold=True),  # type: ignore[arg-type]
    )

    assert loads == 2
    assert provider.paused == []
