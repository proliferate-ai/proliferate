from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from proliferate.constants.billing import USAGE_SEGMENT_CLOSED_BY_PROVISION_FAILURE
from proliferate.db.models.auth import User
from proliferate.db.models.billing import UsageSegment
from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.db.store import cloud_sandboxes as sandbox_store
from proliferate.db.store.billing_subjects import ensure_personal_billing_subject
from proliferate.integrations.sandbox import (
    RuntimeEndpoint,
    SandboxProviderTargetUnavailableError,
    SandboxProviderUnavailableError,
    SandboxRuntimeContext,
)
from proliferate.server.cloud.cloud_sandboxes.models import cloud_sandbox_payload
from proliferate.server.cloud.materialization import operation
from proliferate.server.cloud.materialization.sandbox_io import connect as connect_module

_RUNTIME_URL = "https://runtime.example.invalid"


class _FakeProvider:
    template_version = "e2b-test"

    def __init__(
        self,
        *,
        old_provider_id: str | None = None,
        transient: bool = False,
        create_error: Exception | None = None,
        before_create: Callable[[], Awaitable[None]] | None = None,
        observe_resume: Callable[[int], Awaitable[None]] | None = None,
    ) -> None:
        self.old_provider_id = old_provider_id
        self.transient = transient
        self.create_error = create_error
        self.before_create = before_create
        self.observe_resume = observe_resume
        self.create_count = 0
        self.resume_count = 0
        self.destroyed: list[str] = []
        self.created_metadata: list[dict[str, str]] = []

    async def create_sandbox(
        self,
        *,
        metadata: dict[str, str] | None = None,
    ) -> object:
        if self.before_create is not None:
            await self.before_create()
        if self.create_error is not None:
            raise self.create_error
        self.create_count += 1
        self.created_metadata.append(metadata or {})
        return SimpleNamespace(sandbox_id="provider-replacement")

    async def resume_sandbox(self, sandbox_id: str, **_kwargs: Any) -> object:
        self.resume_count += 1
        if self.observe_resume is not None:
            await self.observe_resume(self.resume_count)
        if sandbox_id == self.old_provider_id:
            if self.transient:
                raise SandboxProviderUnavailableError("secret transient provider response")
            raise SandboxProviderTargetUnavailableError("secret missing provider id")
        return SimpleNamespace(sandbox_id=sandbox_id)

    async def resolve_runtime_endpoint(self, _sandbox: object) -> RuntimeEndpoint:
        return RuntimeEndpoint(runtime_url=_RUNTIME_URL)

    async def resolve_runtime_context(self, _sandbox: object) -> SandboxRuntimeContext:
        return SandboxRuntimeContext(
            home_dir="/home/user",
            runtime_workdir="/home/user/work",
            runtime_binary_path="/home/user/anyharness",
            base_env={},
        )

    async def destroy_sandbox(self, sandbox_id: str) -> None:
        self.destroyed.append(sandbox_id)


async def _seed_sandbox(
    db: AsyncSession,
    *,
    status: str = "creating",
    provider_sandbox_id: str | None = None,
) -> tuple[User, CloudSandbox]:
    user = User(
        email=f"sandbox-recovery-{uuid4().hex}@example.com",
        hashed_password="unused-oauth-only",
        is_active=True,
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    sandbox = CloudSandbox(
        owner_user_id=user.id,
        sandbox_type="e2b",
        provider_sandbox_id=provider_sandbox_id,
        status=status,
    )
    db.add(sandbox)
    await db.commit()
    return user, sandbox


def _install_connect_stubs(
    monkeypatch: pytest.MonkeyPatch,
    provider: _FakeProvider,
) -> None:
    async def _allowed(*_args: object, **_kwargs: object) -> None:
        return None

    async def _healthy(*_args: object, **_kwargs: object) -> None:
        return None

    async def _launch(*_args: object, **_kwargs: object) -> None:
        return None

    monkeypatch.setattr(connect_module, "get_sandbox_provider", lambda _ref: provider)
    monkeypatch.setattr(connect_module, "assert_cloud_sandbox_resume_allowed", _allowed)
    monkeypatch.setattr(connect_module, "wait_for_runtime_health", _healthy)
    monkeypatch.setattr(connect_module, "verify_runtime_auth_enforced", _healthy)
    monkeypatch.setattr(connect_module, "_launch_anyharness_runtime", _launch)


async def _value(db: AsyncSession, sandbox_id: UUID):
    value = await sandbox_store.load_cloud_sandbox_by_id(db, sandbox_id, refresh=True)
    assert value is not None
    return value


@pytest.mark.asyncio
async def test_failure_after_provider_binding_is_durable_and_retry_clears_it(
    db_session: AsyncSession,
    test_engine: AsyncEngine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _user, row = await _seed_sandbox(db_session)
    factory = async_sessionmaker(test_engine, expire_on_commit=False)
    retry_observations: list[tuple[str, str | None]] = []

    async def _observe_resume(resume_count: int) -> None:
        if resume_count != 2:
            return
        async with factory() as check_db:
            current = await _value(check_db, row.id)
            retry_observations.append((current.status, current.last_error))

    provider = _FakeProvider(observe_resume=_observe_resume)
    _install_connect_stubs(monkeypatch, provider)

    async def _fail_launch(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("secret runtime token and command output")

    monkeypatch.setattr(connect_module, "_launch_anyharness_runtime", _fail_launch)
    initial = await _value(db_session, row.id)
    with pytest.raises(RuntimeError, match="secret runtime token"):
        await connect_module.connect_ready_sandbox(db_session, sandbox=initial)

    await db_session.rollback()
    async with factory() as read_db:
        failed = await _value(read_db, row.id)
    assert failed.status == "error"
    assert failed.e2b_sandbox_id == "provider-replacement"
    assert failed.last_error == "Sandbox materialization failed. Retry later."
    assert "secret" not in (failed.last_error or "")
    assert cloud_sandbox_payload(failed).model_dump(by_alias=True)["lastError"] == (
        failed.last_error
    )

    async def _successful_launch(*_args: object, **_kwargs: object) -> None:
        return None

    monkeypatch.setattr(connect_module, "_launch_anyharness_runtime", _successful_launch)
    await connect_module.connect_ready_sandbox(db_session, sandbox=failed)

    ready = await _value(db_session, row.id)
    assert retry_observations == [("creating", None)]
    assert ready.status == "ready"
    assert ready.last_error is None
    assert ready.e2b_sandbox_id == "provider-replacement"
    assert provider.create_count == 1


@pytest.mark.asyncio
async def test_create_failure_without_binding_is_durable_and_secret_safe(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _user, row = await _seed_sandbox(db_session)
    provider = _FakeProvider(
        create_error=SandboxProviderUnavailableError("secret create response")
    )
    _install_connect_stubs(monkeypatch, provider)

    with pytest.raises(SandboxProviderUnavailableError):
        await connect_module.connect_ready_sandbox(
            db_session,
            sandbox=await _value(db_session, row.id),
        )

    failed = await _value(db_session, row.id)
    assert failed.status == "error"
    assert failed.e2b_sandbox_id is None
    assert failed.last_error == ("The sandbox provider is temporarily unavailable. Retry later.")
    assert "secret" not in (failed.last_error or "")


@pytest.mark.asyncio
async def test_missing_provider_concurrency_creates_one_replacement_and_closes_old_usage(
    db_session: AsyncSession,
    test_engine: AsyncEngine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    old_provider_id = "provider-gone"
    user, row = await _seed_sandbox(
        db_session,
        status="ready",
        provider_sandbox_id=old_provider_id,
    )
    subject = await ensure_personal_billing_subject(db_session, user.id)
    segment = UsageSegment(
        user_id=user.id,
        billing_subject_id=subject.id,
        sandbox_id=row.id,
        external_sandbox_id=old_provider_id,
        started_at=datetime.now(UTC),
        ended_at=None,
        is_billable=True,
        opened_by="provision",
    )
    db_session.add(segment)
    await db_session.commit()

    factory = async_sessionmaker(test_engine, expire_on_commit=False)

    async def _before_create() -> None:
        async with factory() as check_db:
            current = await _value(check_db, row.id)
            old_segment = await check_db.get(UsageSegment, segment.id)
            assert current.e2b_sandbox_id is None
            assert current.status == "creating"
            assert old_segment is not None
            assert old_segment.ended_at is not None
            assert old_segment.closed_by == USAGE_SEGMENT_CLOSED_BY_PROVISION_FAILURE

    provider = _FakeProvider(
        old_provider_id=old_provider_id,
        before_create=_before_create,
    )
    _install_connect_stubs(monkeypatch, provider)

    local_lock = asyncio.Lock()

    @asynccontextmanager
    async def _locked(_key: str, **_kwargs: object):
        async with local_lock:
            yield

    async def _done(_ctx: object) -> None:
        return None

    monkeypatch.setattr(operation.locks, "redis_materialization_lock", _locked)

    async with factory() as first_db, factory() as second_db:
        first_stale = await _value(first_db, row.id)
        second_stale = await _value(second_db, row.id)
        assert first_stale.e2b_sandbox_id == second_stale.e2b_sandbox_id == old_provider_id

        await asyncio.gather(
            operation.run_cloud_sandbox_operation(
                first_db,
                sandbox=first_stale,
                operation_key="recovery-one",
                run=_done,
            ),
            operation.run_cloud_sandbox_operation(
                second_db,
                sandbox=second_stale,
                operation_key="recovery-two",
                run=_done,
            ),
        )

    async with factory() as check_db:
        recovered = await _value(check_db, row.id)
        old_segment = await check_db.get(UsageSegment, segment.id)
        segments = list(
            (await check_db.execute(select(UsageSegment).where(UsageSegment.sandbox_id == row.id)))
            .scalars()
            .all()
        )
        open_segments = [candidate for candidate in segments if candidate.ended_at is None]
        assert recovered.status == "ready"
        assert recovered.last_error is None
        assert recovered.e2b_sandbox_id == "provider-replacement"
        assert old_segment is not None and old_segment.ended_at is not None
        assert len(open_segments) == 1
        replacement_segment = open_segments[0]
        assert replacement_segment.external_sandbox_id == "provider-replacement"
        assert replacement_segment.user_id == user.id
        assert replacement_segment.billing_subject_id == subject.id

    assert provider.create_count == 1
    assert provider.created_metadata == [
        {
            "cloud_sandbox_id": str(row.id),
            "proliferate_owner_user_id": str(user.id),
        }
    ]

    async with factory() as warm_db:
        await operation.run_cloud_sandbox_operation(
            warm_db,
            sandbox=await _value(warm_db, row.id),
            operation_key="warm-idempotency",
            run=_done,
        )
    assert provider.create_count == 1


@pytest.mark.asyncio
async def test_transient_provider_error_retains_binding_and_open_usage(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    old_provider_id = "provider-transient"
    user, row = await _seed_sandbox(
        db_session,
        status="ready",
        provider_sandbox_id=old_provider_id,
    )
    subject = await ensure_personal_billing_subject(db_session, user.id)
    segment = UsageSegment(
        user_id=user.id,
        billing_subject_id=subject.id,
        sandbox_id=row.id,
        external_sandbox_id=old_provider_id,
        started_at=datetime.now(UTC),
        ended_at=None,
        is_billable=True,
        opened_by="provision",
    )
    db_session.add(segment)
    await db_session.commit()

    provider = _FakeProvider(old_provider_id=old_provider_id, transient=True)
    _install_connect_stubs(monkeypatch, provider)

    with pytest.raises(SandboxProviderUnavailableError):
        await connect_module.connect_ready_sandbox(
            db_session,
            sandbox=await _value(db_session, row.id),
        )

    failed = await _value(db_session, row.id)
    await db_session.refresh(segment)
    assert failed.status == "error"
    assert failed.e2b_sandbox_id == old_provider_id
    assert failed.last_error == ("The sandbox provider is temporarily unavailable. Retry later.")
    assert segment.ended_at is None
    assert provider.create_count == 0


@pytest.mark.asyncio
async def test_stale_failure_cannot_overwrite_replacement_binding(
    db_session: AsyncSession,
) -> None:
    _user, row = await _seed_sandbox(
        db_session,
        status="creating",
        provider_sandbox_id="provider-old",
    )
    detached = await sandbox_store.supersede_missing_cloud_sandbox_provider(
        db_session,
        row.id,
        expected_provider_sandbox_id="provider-old",
    )
    assert detached is not None
    replacement = await sandbox_store.record_cloud_sandbox_provider_sandbox(
        db_session,
        row.id,
        e2b_sandbox_id="provider-new",
        e2b_template_ref="e2b",
    )
    assert replacement is not None
    await db_session.commit()

    stale = await sandbox_store.mark_cloud_sandbox_materialization_error(
        db_session,
        row.id,
        expected_provider_sandbox_id="provider-old",
        last_error="stale attempt",
    )
    assert stale is None
    await db_session.commit()

    current = await _value(db_session, row.id)
    assert current.e2b_sandbox_id == "provider-new"
    assert current.status == "creating"
    assert current.last_error is None


@pytest.mark.asyncio
async def test_delete_winning_retry_race_cannot_resurrect_or_contact_provider(
    db_session: AsyncSession,
    test_engine: AsyncEngine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider_id = "provider-delete-race"
    _user, row = await _seed_sandbox(
        db_session,
        status="error",
        provider_sandbox_id=provider_id,
    )
    factory = async_sessionmaker(test_engine, expire_on_commit=False)
    provider = _FakeProvider()
    _install_connect_stubs(monkeypatch, provider)

    async with factory() as retry_db, factory() as delete_db:
        stale = await _value(retry_db, row.id)
        destroyed = await sandbox_store.mark_cloud_sandbox_destroyed(delete_db, row.id)
        assert destroyed is not None
        await delete_db.commit()

        with pytest.raises(
            connect_module.CloudMaterializationCommandError,
            match="destroyed while connecting",
        ):
            await connect_module.connect_ready_sandbox(retry_db, sandbox=stale)

    async with factory() as check_db:
        current = await _value(check_db, row.id)
        assert current.status == "destroyed"
        assert current.destroyed_at is not None
        assert current.e2b_sandbox_id == provider_id
    assert provider.create_count == 0
    assert provider.resume_count == 0


@pytest.mark.asyncio
async def test_late_failure_cannot_overwrite_authoritative_pause(
    db_session: AsyncSession,
) -> None:
    provider_id = "provider-paused-during-attempt"
    _user, row = await _seed_sandbox(
        db_session,
        status="creating",
        provider_sandbox_id=provider_id,
    )
    paused = await sandbox_store.mark_cloud_sandbox_provider_state(
        db_session,
        row.id,
        status="paused",
        expected_provider_sandbox_id=provider_id,
        expected_status="creating",
    )
    assert paused is not None
    await db_session.commit()

    stale_failure = await sandbox_store.mark_cloud_sandbox_materialization_error(
        db_session,
        row.id,
        expected_provider_sandbox_id=provider_id,
        last_error="stale attempt",
    )
    assert stale_failure is None
    await db_session.commit()

    current = await _value(db_session, row.id)
    assert current.status == "paused"
    assert current.last_error is None


@pytest.mark.asyncio
async def test_late_provider_ready_event_cannot_overwrite_terminal_error(
    db_session: AsyncSession,
) -> None:
    provider_id = "provider-error-before-webhook"
    _user, row = await _seed_sandbox(
        db_session,
        status="creating",
        provider_sandbox_id=provider_id,
    )
    failed = await sandbox_store.mark_cloud_sandbox_materialization_error(
        db_session,
        row.id,
        expected_provider_sandbox_id=provider_id,
        last_error="safe terminal receipt",
    )
    assert failed is not None
    await db_session.commit()

    stale_ready = await sandbox_store.mark_cloud_sandbox_provider_state(
        db_session,
        row.id,
        status="ready",
        expected_provider_sandbox_id=provider_id,
        expected_status="creating",
    )
    assert stale_ready is None
    await db_session.commit()

    current = await _value(db_session, row.id)
    assert current.status == "error"
    assert current.last_error == "safe terminal receipt"


@pytest.mark.asyncio
async def test_paused_sandbox_connects_without_webhook_and_opens_exact_usage(
    db_session: AsyncSession,
    test_engine: AsyncEngine,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider_id = "provider-paused"
    user, row = await _seed_sandbox(
        db_session,
        status="paused",
        provider_sandbox_id=provider_id,
    )
    factory = async_sessionmaker(test_engine, expire_on_commit=False)
    observed_statuses: list[str] = []

    async def _observe_resume(_resume_count: int) -> None:
        async with factory() as check_db:
            observed_statuses.append((await _value(check_db, row.id)).status)

    provider = _FakeProvider(observe_resume=_observe_resume)
    _install_connect_stubs(monkeypatch, provider)

    await connect_module.connect_ready_sandbox(
        db_session,
        sandbox=await _value(db_session, row.id),
    )

    async with factory() as check_db:
        current = await _value(check_db, row.id)
        segments = list(
            (
                await check_db.execute(
                    select(UsageSegment).where(
                        UsageSegment.sandbox_id == row.id,
                        UsageSegment.ended_at.is_(None),
                    )
                )
            )
            .scalars()
            .all()
        )
        assert current.status == "ready"
        assert current.last_error is None
        assert current.e2b_sandbox_id == provider_id
        assert len(segments) == 1
        assert segments[0].external_sandbox_id == provider_id
        assert segments[0].user_id == user.id
    assert observed_statuses == ["creating"]
    assert provider.create_count == 0
    assert provider.resume_count == 1


@pytest.mark.asyncio
async def test_post_connect_callback_failure_leaves_sandbox_ready(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _user, row = await _seed_sandbox(db_session)
    provider = _FakeProvider()
    _install_connect_stubs(monkeypatch, provider)

    @asynccontextmanager
    async def _locked(_key: str, **_kwargs: object):
        yield

    async def _fail_after_connect(_ctx: object) -> None:
        raise RuntimeError("repository callback failed")

    monkeypatch.setattr(operation.locks, "redis_materialization_lock", _locked)
    with pytest.raises(RuntimeError, match="repository callback"):
        await operation.run_cloud_sandbox_operation(
            db_session,
            sandbox=await _value(db_session, row.id),
            operation_key="post-connect-failure",
            run=_fail_after_connect,
        )
    ready = await _value(db_session, row.id)
    assert ready.status == "ready"
    assert ready.last_error is None
