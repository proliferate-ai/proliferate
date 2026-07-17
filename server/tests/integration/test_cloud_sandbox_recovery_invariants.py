"""Durable provider-attribution and freshness invariants for sandbox recovery."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from proliferate.constants.billing import (
    USAGE_SEGMENT_CLOSED_BY_BINDING_CONVERGENCE,
    USAGE_SEGMENT_CLOSED_BY_WEBHOOK_PAUSED,
)
from proliferate.db.models.auth import User
from proliferate.db.models.billing import UsageSegment
from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.db.store import cloud_sandboxes as sandbox_store
from proliferate.db.store.billing_runtime_usage import UsageProviderBindingMismatchError
from proliferate.db.store.billing_subjects import ensure_personal_billing_subject
from proliferate.integrations.sandbox import (
    ProviderSandboxState,
    SandboxProviderTargetUnavailableError,
    SandboxProviderUnavailableError,
)
from proliferate.server.billing.runtime_usage import (
    close_cloud_sandbox_provider_usage,
    converge_cloud_sandbox_provider_usage,
)
from proliferate.server.cloud.materialization.sandbox_io.target import (
    CloudMaterializationCommandError,
)
from proliferate.utils.time import utcnow
from proliferate.server.cloud.materialization.sandbox_io import connect as connect_module
from tests.integration.test_cloud_sandbox_recovery import (
    _FakeProvider,
    _install_connect_stubs,
)

NOW = datetime(2026, 7, 17, 12, 0, tzinfo=UTC)


class _AmbiguousResumeProvider(_FakeProvider):
    def __init__(self) -> None:
        super().__init__(old_provider_id="provider-current", transient=True)
        self.state_count = 0
        self.connect_count = 0

    async def get_sandbox_state(self, sandbox_id: str) -> ProviderSandboxState:
        self.state_count += 1
        return ProviderSandboxState(
            external_sandbox_id=sandbox_id,
            state="running",
            started_at=NOW,
            end_at=None,
            observed_at=NOW + timedelta(minutes=1),
            metadata={},
        )

    async def connect_running_sandbox(self, _sandbox_id: str) -> object:
        self.connect_count += 1
        raise SandboxProviderUnavailableError("ambiguous reconnect response")


async def _seed_open_usage(
    db: AsyncSession,
    *,
    provider_sandbox_id: str,
    usage_provider_sandbox_id: str | None,
    started_at: datetime = NOW,
) -> tuple[CloudSandbox, UsageSegment]:
    user = User(
        email=f"recovery-invariant-{uuid4().hex}@example.com",
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
        status="ready",
        created_at=NOW,
        updated_at=NOW,
    )
    db.add(sandbox)
    await db.flush()
    segment = UsageSegment(
        user_id=user.id,
        billing_subject_id=subject.id,
        sandbox_id=sandbox.id,
        external_sandbox_id=usage_provider_sandbox_id,
        started_at=started_at,
        ended_at=None,
        is_billable=True,
        opened_by="legacy",
    )
    db.add(segment)
    await db.commit()
    return sandbox, segment


@pytest.mark.asyncio
@pytest.mark.parametrize("provider_sandbox_id", ["provider-current", None])
async def test_legacy_null_usage_converges_without_reattribution(
    db_session: AsyncSession,
    provider_sandbox_id: str | None,
) -> None:
    started_at = NOW + timedelta(seconds=5)
    sandbox, segment = await _seed_open_usage(
        db_session,
        provider_sandbox_id=provider_sandbox_id,
        usage_provider_sandbox_id=None,
        started_at=started_at,
    )

    closed = await converge_cloud_sandbox_provider_usage(
        db_session,
        sandbox_id=sandbox.id,
        current_provider_sandbox_id=provider_sandbox_id,
        observed_at=NOW,
    )
    await db_session.commit()

    assert closed is not None
    await db_session.refresh(segment)
    assert segment.external_sandbox_id is None
    assert segment.ended_at == started_at
    assert segment.closed_by == USAGE_SEGMENT_CLOSED_BY_BINDING_CONVERGENCE

    repeated = await converge_cloud_sandbox_provider_usage(
        db_session,
        sandbox_id=sandbox.id,
        current_provider_sandbox_id=provider_sandbox_id,
        observed_at=NOW + timedelta(minutes=1),
    )
    assert repeated is None


@pytest.mark.asyncio
async def test_non_null_usage_mismatch_fails_closed_without_changing_segment(
    db_session: AsyncSession,
) -> None:
    sandbox, segment = await _seed_open_usage(
        db_session,
        provider_sandbox_id="provider-current",
        usage_provider_sandbox_id="provider-conflicting",
    )

    with pytest.raises(UsageProviderBindingMismatchError):
        await converge_cloud_sandbox_provider_usage(
            db_session,
            sandbox_id=sandbox.id,
            current_provider_sandbox_id="provider-current",
            observed_at=NOW + timedelta(seconds=1),
        )
    await db_session.rollback()

    await db_session.refresh(sandbox)
    await db_session.refresh(segment)
    assert sandbox.provider_sandbox_id == "provider-current"
    assert segment.external_sandbox_id == "provider-conflicting"
    assert segment.ended_at is None
    assert segment.closed_by is None


@pytest.mark.asyncio
async def test_connect_persists_mismatch_receipt_before_provider_io(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sandbox, legacy_segment = await _seed_open_usage(
        db_session,
        provider_sandbox_id="provider-current",
        usage_provider_sandbox_id="provider-conflicting",
    )
    provider = _FakeProvider()
    _install_connect_stubs(monkeypatch, provider)
    snapshot = await sandbox_store.load_cloud_sandbox_by_id(db_session, sandbox.id)
    assert snapshot is not None
    original_attempt = snapshot.materialization_attempt

    with pytest.raises(UsageProviderBindingMismatchError):
        await connect_module.connect_ready_sandbox(db_session, sandbox=snapshot)

    await db_session.refresh(legacy_segment)
    current = await sandbox_store.load_cloud_sandbox_by_id(db_session, sandbox.id, refresh=True)
    assert current is not None
    open_segments = list(
        (
            await db_session.execute(
                select(UsageSegment).where(
                    UsageSegment.sandbox_id == sandbox.id,
                    UsageSegment.ended_at.is_(None),
                )
            )
        ).scalars()
    )
    assert legacy_segment.external_sandbox_id == "provider-conflicting"
    assert legacy_segment.closed_by is None
    assert legacy_segment.ended_at is None
    assert len(open_segments) == 1
    assert current.status == "error"
    assert current.materialization_attempt == original_attempt + 1
    assert current.last_error == (
        "Sandbox usage attribution conflicts with its provider binding. Contact support."
    )
    assert provider.resume_count == 0
    assert provider.create_count == 0


@pytest.mark.asyncio
async def test_ambiguous_resume_observation_opens_exact_usage_without_webhook(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sandbox, prior_segment = await _seed_open_usage(
        db_session,
        provider_sandbox_id="provider-current",
        usage_provider_sandbox_id="provider-current",
    )
    sandbox.status = "paused"
    prior_segment.ended_at = NOW
    prior_segment.closed_by = "manual_stop"
    await db_session.commit()
    provider = _AmbiguousResumeProvider()
    _install_connect_stubs(monkeypatch, provider)
    snapshot = await sandbox_store.load_cloud_sandbox_by_id(db_session, sandbox.id)
    assert snapshot is not None

    with pytest.raises(SandboxProviderUnavailableError):
        await connect_module.connect_ready_sandbox(db_session, sandbox=snapshot)

    current = await sandbox_store.load_cloud_sandbox_by_id(db_session, sandbox.id, refresh=True)
    assert current is not None
    open_segment = (
        await db_session.execute(
            select(UsageSegment).where(
                UsageSegment.sandbox_id == sandbox.id,
                UsageSegment.ended_at.is_(None),
            )
        )
    ).scalar_one()
    assert current.status == "error"
    assert current.e2b_sandbox_id == "provider-current"
    assert current.last_error == "The sandbox provider is temporarily unavailable. Retry later."
    assert open_segment.external_sandbox_id == "provider-current"
    assert provider.resume_count == 1
    assert provider.state_count == 1
    assert provider.connect_count == 1
    assert provider.create_count == 0


@pytest.mark.asyncio
async def test_retry_epoch_and_observation_floor_fence_delayed_pause(
    db_session: AsyncSession,
) -> None:
    sandbox, _segment = await _seed_open_usage(
        db_session,
        provider_sandbox_id="provider-current",
        usage_provider_sandbox_id="provider-current",
    )
    original_attempt = sandbox.materialization_attempt
    original_observed_at = sandbox.provider_observed_at

    retried = await sandbox_store.begin_cloud_sandbox_materialization_retry(
        db_session,
        sandbox.id,
    )
    assert retried is not None
    await db_session.commit()
    assert retried.status == "ready"
    assert retried.materialization_attempt == original_attempt + 1

    stale_attempt = await sandbox_store.apply_cloud_sandbox_provider_observation(
        db_session,
        sandbox.id,
        status="paused",
        expected_provider_sandbox_id="provider-current",
        expected_materialization_attempt=original_attempt,
        observed_at=retried.provider_observed_at + timedelta(minutes=1),
    )
    assert stale_attempt is None

    stale_observation = await sandbox_store.apply_cloud_sandbox_provider_observation(
        db_session,
        sandbox.id,
        status="paused",
        expected_provider_sandbox_id="provider-current",
        expected_materialization_attempt=retried.materialization_attempt,
        observed_at=original_observed_at,
    )
    assert stale_observation is None

    resume_started_at = retried.provider_observed_at + timedelta(seconds=1)
    accepted = await sandbox_store.lock_cloud_sandbox_materialization_attempt(
        db_session,
        sandbox.id,
        expected_provider_sandbox_id="provider-current",
        expected_materialization_attempt=retried.materialization_attempt,
        observed_at=resume_started_at,
    )
    assert accepted is not None
    await db_session.commit()

    delayed_pause = await sandbox_store.apply_cloud_sandbox_provider_observation(
        db_session,
        sandbox.id,
        status="paused",
        expected_provider_sandbox_id="provider-current",
        expected_materialization_attempt=retried.materialization_attempt,
        observed_at=resume_started_at - timedelta(microseconds=1),
    )
    assert delayed_pause is None
    current = await sandbox_store.load_cloud_sandbox_by_id(db_session, sandbox.id, refresh=True)
    assert current is not None
    assert current.status == "ready"
    assert current.provider_observed_at == resume_started_at


@pytest.mark.asyncio
async def test_pause_during_resume_request_prevents_stale_acceptance(
    db_session: AsyncSession,
) -> None:
    sandbox, _segment = await _seed_open_usage(
        db_session,
        provider_sandbox_id="provider-current",
        usage_provider_sandbox_id="provider-current",
    )
    retried = await sandbox_store.begin_cloud_sandbox_materialization_retry(
        db_session,
        sandbox.id,
    )
    assert retried is not None
    await db_session.commit()

    resume_started_at = retried.provider_observed_at + timedelta(seconds=1)
    pause_observed_at = resume_started_at + timedelta(seconds=1)
    paused = await sandbox_store.apply_cloud_sandbox_provider_observation(
        db_session,
        sandbox.id,
        status="paused",
        expected_provider_sandbox_id="provider-current",
        expected_materialization_attempt=retried.materialization_attempt,
        observed_at=pause_observed_at,
    )
    assert paused is not None
    await db_session.commit()

    resumed = await sandbox_store.lock_cloud_sandbox_materialization_attempt(
        db_session,
        sandbox.id,
        expected_provider_sandbox_id="provider-current",
        expected_materialization_attempt=retried.materialization_attempt,
        observed_at=resume_started_at,
    )
    assert resumed is None
    current = await sandbox_store.load_cloud_sandbox_by_id(db_session, sandbox.id, refresh=True)
    assert current is not None
    assert current.status == "paused"
    assert current.provider_observed_at == pause_observed_at


@pytest.mark.asyncio
@pytest.mark.parametrize("post_resume_state", ["running", "paused", "missing", "killed"])
async def test_post_resume_state_resolves_overlapping_pause_and_usage(
    db_session: AsyncSession,
    test_engine: AsyncEngine,
    monkeypatch: pytest.MonkeyPatch,
    post_resume_state: str,
) -> None:
    sandbox, _segment = await _seed_open_usage(
        db_session,
        provider_sandbox_id="provider-current",
        usage_provider_sandbox_id="provider-current",
    )
    sandbox_id = sandbox.id
    factory = async_sessionmaker(test_engine, expire_on_commit=False)
    pause_observed_at: list[datetime] = []

    async def _pause_during_resume(_resume_count: int) -> None:
        async with factory() as webhook_db:
            current = await sandbox_store.load_cloud_sandbox_by_id(webhook_db, sandbox_id)
            assert current is not None
            observed_at = max(
                utcnow(),
                current.provider_observed_at + timedelta(microseconds=1),
            )
            pause_observed_at.append(observed_at)
            paused = await sandbox_store.apply_cloud_sandbox_provider_observation(
                webhook_db,
                sandbox_id,
                status="paused",
                expected_provider_sandbox_id="provider-current",
                expected_materialization_attempt=current.materialization_attempt,
                observed_at=observed_at,
            )
            assert paused is not None
            await close_cloud_sandbox_provider_usage(
                webhook_db,
                sandbox_id=sandbox_id,
                provider_sandbox_id="provider-current",
                ended_at=observed_at,
                closed_by=USAGE_SEGMENT_CLOSED_BY_WEBHOOK_PAUSED,
            )
            await webhook_db.commit()

    provider = _FakeProvider(observe_resume=_pause_during_resume)

    async def _post_resume_state(provider_sandbox_id: str) -> ProviderSandboxState:
        assert pause_observed_at
        if post_resume_state == "missing":
            raise SandboxProviderTargetUnavailableError("provider is gone")
        return ProviderSandboxState(
            external_sandbox_id=provider_sandbox_id,
            state=post_resume_state,
            started_at=NOW,
            end_at=None,
            observed_at=max(
                utcnow(),
                pause_observed_at[0] + timedelta(microseconds=1),
            ),
            metadata={},
        )

    monkeypatch.setattr(provider, "get_sandbox_state", _post_resume_state, raising=False)
    _install_connect_stubs(monkeypatch, provider)
    snapshot = await sandbox_store.load_cloud_sandbox_by_id(db_session, sandbox_id)
    assert snapshot is not None

    if post_resume_state == "running":
        await connect_module.connect_ready_sandbox(db_session, sandbox=snapshot)
    elif post_resume_state in {"killed", "missing"}:
        with pytest.raises(SandboxProviderTargetUnavailableError):
            await connect_module.connect_ready_sandbox(db_session, sandbox=snapshot)
    else:
        with pytest.raises(CloudMaterializationCommandError, match="remained inactive"):
            await connect_module.connect_ready_sandbox(db_session, sandbox=snapshot)

    current = await sandbox_store.load_cloud_sandbox_by_id(db_session, sandbox_id, refresh=True)
    assert current is not None
    open_segment = (
        await db_session.execute(
            select(UsageSegment).where(
                UsageSegment.sandbox_id == sandbox_id,
                UsageSegment.ended_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    expected_status = {
        "running": "ready",
        "paused": "paused",
        "missing": "error",
        "killed": "error",
    }
    assert current.status == expected_status[post_resume_state]
    if post_resume_state == "running":
        assert current.last_error is None
        assert open_segment is not None
        assert open_segment.external_sandbox_id == "provider-current"
    else:
        assert open_segment is None
        if post_resume_state == "paused":
            assert current.last_error is None
        else:
            assert current.e2b_sandbox_id is None
            assert current.last_error == (
                "The provider sandbox no longer exists. Retry to create a replacement."
            )
    assert provider.resume_count == 1
    assert provider.create_count == 0


@pytest.mark.asyncio
async def test_runtime_ready_write_does_not_advance_provider_freshness(
    db_session: AsyncSession,
) -> None:
    sandbox, _segment = await _seed_open_usage(
        db_session,
        provider_sandbox_id="provider-current",
        usage_provider_sandbox_id="provider-current",
    )
    retried = await sandbox_store.begin_cloud_sandbox_materialization_retry(
        db_session,
        sandbox.id,
    )
    assert retried is not None
    resume_started_at = retried.provider_observed_at + timedelta(seconds=1)
    accepted = await sandbox_store.lock_cloud_sandbox_materialization_attempt(
        db_session,
        sandbox.id,
        expected_provider_sandbox_id="provider-current",
        expected_materialization_attempt=retried.materialization_attempt,
        observed_at=resume_started_at,
    )
    assert accepted is not None
    ready = await sandbox_store.mark_cloud_sandbox_ready(
        db_session,
        sandbox.id,
        e2b_sandbox_id="provider-current",
        e2b_template_ref="e2b-test",
        anyharness_base_url="https://runtime.example.invalid",
        anyharness_bearer_token_ciphertext="token-ciphertext",
        anyharness_data_key_ciphertext="key-ciphertext",
        expected_materialization_attempt=retried.materialization_attempt,
    )
    assert ready is not None
    assert ready.provider_observed_at == resume_started_at
    await db_session.commit()

    paused = await sandbox_store.apply_cloud_sandbox_provider_observation(
        db_session,
        sandbox.id,
        status="paused",
        expected_provider_sandbox_id="provider-current",
        expected_materialization_attempt=retried.materialization_attempt,
        observed_at=resume_started_at + timedelta(seconds=1),
    )
    assert paused is not None
    assert paused.status == "paused"
