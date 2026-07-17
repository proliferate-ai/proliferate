"""Attempt-fencing and provider-custody races in cloud sandbox connect."""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

import pytest

from proliferate.server.cloud.materialization import failures
from proliferate.integrations.sandbox import SandboxProviderTargetUnavailableError
from proliferate.server.cloud.materialization.sandbox_io import connect
from proliferate.server.cloud.materialization.sandbox_io.target import (
    CloudMaterializationCommandError,
)


class _FakeDb:
    def __init__(
        self,
        events: list[str],
        *,
        fail_on_commit: int | None = None,
        apply_usage_before_failure: bool = False,
        apply_state: Callable[[], None] | None = None,
        rollback_state: Callable[[], None] | None = None,
    ) -> None:
        self.commits = 0
        self.rollbacks = 0
        self.events = events
        self.fail_on_commit = fail_on_commit
        self.apply_usage_before_failure = apply_usage_before_failure
        self.apply_state = apply_state
        self.rollback_state = rollback_state
        self.staged_usage: set[str] = set()
        self.durable_usage: set[str] = set()

    async def commit(self) -> None:
        self.commits += 1
        if self.commits == self.fail_on_commit:
            if self.apply_usage_before_failure:
                self.durable_usage.update(self.staged_usage)
                self.staged_usage.clear()
                if self.apply_state is not None:
                    self.apply_state()
                self.events.append("commit_applied_then_raised")
            else:
                self.events.append("commit_not_applied")
            raise RuntimeError("ambiguous commit")
        self.durable_usage.update(self.staged_usage)
        self.staged_usage.clear()
        if self.apply_state is not None:
            self.apply_state()
        self.events.append("commit")

    async def rollback(self) -> None:
        self.rollbacks += 1
        self.staged_usage.clear()
        if self.rollback_state is not None:
            self.rollback_state()
        self.events.append("rollback")


class _FakeProvider:
    template_version = "e2b"

    def __init__(self, events: list[str]) -> None:
        self.destroyed: list[str] = []
        self.events = events
        self.create_metadata: dict[str, str] | None = None

    async def create_sandbox(self, *, metadata: dict[str, str] | None = None) -> Any:
        self.create_metadata = metadata
        self.events.append("provider_create")
        return SimpleNamespace(sandbox_id="sbx-new")

    async def resume_sandbox(self, sandbox_id: str) -> Any:
        self.events.append(f"provider_resume:{sandbox_id}")
        return SimpleNamespace(sandbox_id=sandbox_id)

    async def destroy_sandbox(self, sandbox_id: str) -> None:
        self.destroyed.append(sandbox_id)
        self.events.append(f"provider_destroy:{sandbox_id}")


class _BlockingCreateProvider(_FakeProvider):
    def __init__(self, events: list[str]) -> None:
        super().__init__(events)
        self.create_started = asyncio.Event()
        self.release_create = asyncio.Event()

    async def create_sandbox(self, *, metadata: dict[str, str] | None = None) -> Any:
        self.create_metadata = metadata
        self.events.append("provider_create_started")
        self.create_started.set()
        await self.release_create.wait()
        self.events.append("provider_create_returned")
        return SimpleNamespace(sandbox_id="sbx-cancelled")


def _sandbox(*, provider_sandbox_id: str | None, attempt: int = 7) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        destroyed_at=None,
        status="ready" if provider_sandbox_id is not None else "creating",
        e2b_sandbox_id=provider_sandbox_id,
        e2b_template_ref="e2b",
        owner_user_id=uuid.uuid4(),
        organization_id=None,
        materialization_attempt=attempt,
        provider_observed_at=datetime(2026, 7, 17, tzinfo=UTC),
    )


def _copy_sandbox(sandbox: SimpleNamespace, **changes: object) -> SimpleNamespace:
    values = vars(sandbox).copy()
    values.update(changes)
    return SimpleNamespace(**values)


def _patch_connect_prelude(
    monkeypatch: pytest.MonkeyPatch,
    *,
    sandbox: SimpleNamespace,
    provider: _FakeProvider,
) -> None:
    async def _resume_allowed(*_args: Any, **_kwargs: Any) -> None:
        return None

    async def _begin_retry(*_args: Any, **_kwargs: Any) -> object:
        return sandbox

    async def _converge_usage(*_args: Any, **_kwargs: Any) -> None:
        return None

    monkeypatch.setattr(connect, "assert_cloud_sandbox_resume_allowed", _resume_allowed)
    monkeypatch.setattr(connect, "get_sandbox_provider", lambda _ref: provider)
    monkeypatch.setattr(
        connect.cloud_sandboxes_store,
        "begin_cloud_sandbox_materialization_retry",
        _begin_retry,
    )
    monkeypatch.setattr(connect, "converge_cloud_sandbox_provider_usage", _converge_usage)


def _patch_exact_failure_usage(
    monkeypatch: pytest.MonkeyPatch,
    *,
    db: _FakeDb,
    sandbox: SimpleNamespace,
    events: list[str],
) -> None:
    async def _mark_failure(
        _db: object,
        sandbox_id: uuid.UUID,
        *,
        expected_provider_sandbox_id: str | None,
        expected_materialization_attempt: int,
        last_error: str,
    ) -> object | None:
        events.append(f"failure_cas:{expected_provider_sandbox_id}")
        assert sandbox_id == sandbox.id
        assert expected_materialization_attempt == sandbox.materialization_attempt
        assert expected_provider_sandbox_id == sandbox.e2b_sandbox_id
        assert last_error
        return sandbox

    async def _open_from_connect(
        _db: object,
        *,
        provider_sandbox_id: str,
        **_kwargs: Any,
    ) -> None:
        events.append(f"connect_usage:{provider_sandbox_id}")
        db.staged_usage.add(provider_sandbox_id)

    async def _open_from_failure(
        _db: object,
        *,
        provider_sandbox_id: str,
        **_kwargs: Any,
    ) -> None:
        events.append(f"failure_usage:{provider_sandbox_id}")
        db.staged_usage.add(provider_sandbox_id)

    monkeypatch.setattr(failures, "mark_cloud_sandbox_materialization_error", _mark_failure)
    monkeypatch.setattr(connect, "open_cloud_sandbox_provider_usage", _open_from_connect)
    monkeypatch.setattr(failures, "open_cloud_sandbox_provider_usage", _open_from_failure)


@pytest.mark.parametrize("commit_applied", [False, True], ids=["not-applied", "applied"])
@pytest.mark.asyncio
async def test_attempt_start_commit_ambiguity_fences_terminal_receipt(
    monkeypatch: pytest.MonkeyPatch,
    *,
    commit_applied: bool,
) -> None:
    events: list[str] = []
    prior = _sandbox(provider_sandbox_id="sbx-existing", attempt=6)
    attempted = _copy_sandbox(prior, materialization_attempt=7)
    state: dict[str, Any] = {
        "durable_attempt": 6,
        "staged_attempt": 6,
        "receipt": "prior-attempt-receipt",
    }

    def _apply_state() -> None:
        state["durable_attempt"] = state["staged_attempt"]

    def _rollback_state() -> None:
        state["staged_attempt"] = state["durable_attempt"]

    provider = _FakeProvider(events)
    db = _FakeDb(
        events,
        fail_on_commit=2,
        apply_usage_before_failure=commit_applied,
        apply_state=_apply_state,
        rollback_state=_rollback_state,
    )
    _patch_connect_prelude(monkeypatch, sandbox=attempted, provider=provider)

    async def _begin_retry(*_args: Any, **_kwargs: Any) -> object:
        state["staged_attempt"] = attempted.materialization_attempt
        return attempted

    async def _mark_failure(
        _db: object,
        sandbox_id: uuid.UUID,
        *,
        expected_provider_sandbox_id: str | None,
        expected_materialization_attempt: int,
        last_error: str,
    ) -> object | None:
        assert sandbox_id == prior.id
        assert expected_provider_sandbox_id == "sbx-existing"
        if state["durable_attempt"] != expected_materialization_attempt:
            events.append("attempt_cas_miss")
            return None
        state["receipt"] = last_error
        events.append("attempt_terminal_receipt")
        return attempted

    monkeypatch.setattr(
        connect.cloud_sandboxes_store,
        "begin_cloud_sandbox_materialization_retry",
        _begin_retry,
    )
    monkeypatch.setattr(failures, "mark_cloud_sandbox_materialization_error", _mark_failure)

    with pytest.raises(RuntimeError, match="ambiguous commit"):
        await connect.connect_ready_sandbox(db, sandbox=prior)

    assert not any(event.startswith("provider_") for event in events)
    if commit_applied:
        assert state["durable_attempt"] == 7
        assert state["receipt"] != "prior-attempt-receipt"
        assert "attempt_terminal_receipt" in events
    else:
        assert state["durable_attempt"] == 6
        assert state["receipt"] == "prior-attempt-receipt"
        assert "attempt_cas_miss" in events


@pytest.mark.parametrize("commit_applied", [False, True], ids=["not-applied", "applied"])
@pytest.mark.asyncio
async def test_missing_provider_detach_commit_ambiguity_closes_exact_usage(
    monkeypatch: pytest.MonkeyPatch,
    *,
    commit_applied: bool,
) -> None:
    events: list[str] = []
    sandbox = _sandbox(provider_sandbox_id="sbx-old")
    detached = _copy_sandbox(sandbox, e2b_sandbox_id=None, status="creating")
    state: dict[str, Any] = {
        "durable_provider": "sbx-old",
        "staged_provider": "sbx-old",
        "durable_open_usage": {"sbx-old"},
        "staged_closes": set(),
        "receipt": None,
    }

    def _apply_state() -> None:
        state["durable_provider"] = state["staged_provider"]
        state["durable_open_usage"].difference_update(state["staged_closes"])
        state["staged_closes"].clear()

    def _rollback_state() -> None:
        state["staged_provider"] = state["durable_provider"]
        state["staged_closes"].clear()

    provider = _FakeProvider(events)
    db = _FakeDb(
        events,
        fail_on_commit=3,
        apply_usage_before_failure=commit_applied,
        apply_state=_apply_state,
        rollback_state=_rollback_state,
    )
    _patch_connect_prelude(monkeypatch, sandbox=sandbox, provider=provider)

    async def _missing(provider_sandbox_id: str) -> None:
        events.append(f"provider_missing:{provider_sandbox_id}")
        raise SandboxProviderTargetUnavailableError("gone")

    async def _detach(*_args: Any, **_kwargs: Any) -> object | None:
        if state["staged_provider"] != "sbx-old":
            events.append("detach_old_provider_miss")
            return None
        state["staged_provider"] = None
        events.append("detach_old_provider")
        return detached

    async def _close_usage(
        _db: object,
        *,
        provider_sandbox_id: str,
        **_kwargs: Any,
    ) -> None:
        assert provider_sandbox_id == "sbx-old"
        state["staged_closes"].add(provider_sandbox_id)
        events.append("close_old_usage")

    async def _mark_failure(
        _db: object,
        _sandbox_id: uuid.UUID,
        *,
        expected_provider_sandbox_id: str | None,
        expected_materialization_attempt: int,
        last_error: str,
    ) -> object | None:
        assert expected_materialization_attempt == sandbox.materialization_attempt
        if state["staged_provider"] != expected_provider_sandbox_id:
            return None
        state["receipt"] = last_error
        events.append(f"terminal_receipt:{expected_provider_sandbox_id}")
        return _copy_sandbox(sandbox, e2b_sandbox_id=expected_provider_sandbox_id)

    monkeypatch.setattr(provider, "resume_sandbox", _missing)

    async def _detach_and_close(*args: Any, **kwargs: Any) -> object | None:
        refreshed = await _detach(*args, **kwargs)
        if refreshed is not None:
            await _close_usage(*args, **kwargs)
        return refreshed

    monkeypatch.setattr(
        connect,
        "detach_missing_provider",
        _detach_and_close,
    )
    monkeypatch.setattr(failures, "supersede_missing_cloud_sandbox_provider", _detach)
    monkeypatch.setattr(failures, "close_cloud_sandbox_provider_usage", _close_usage)
    monkeypatch.setattr(failures, "mark_cloud_sandbox_materialization_error", _mark_failure)

    with pytest.raises(RuntimeError, match="ambiguous commit"):
        await connect.connect_ready_sandbox(db, sandbox=sandbox)

    assert state["durable_open_usage"] == set()
    assert state["receipt"] is not None
    assert state["durable_provider"] is None
    assert "terminal_receipt:None" in events
    assert events.count("provider_missing:sbx-old") == 1
    assert "provider_create" not in events
    assert provider.destroyed == []


@pytest.mark.asyncio
async def test_lease_loss_after_resume_fences_and_ensures_exact_usage(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[str] = []
    sandbox = _sandbox(provider_sandbox_id="sbx-existing")
    provider = _FakeProvider(events)
    db = _FakeDb(events)
    _patch_connect_prelude(monkeypatch, sandbox=sandbox, provider=provider)
    _patch_exact_failure_usage(monkeypatch, db=db, sandbox=sandbox, events=events)

    async def _lose_lease(*_args: Any, **_kwargs: Any) -> None:
        events.append("lease_lost")
        raise asyncio.CancelledError

    monkeypatch.setattr(
        connect.cloud_sandboxes_store,
        "lock_cloud_sandbox_materialization_attempt",
        _lose_lease,
    )

    with pytest.raises(asyncio.CancelledError):
        await connect.connect_ready_sandbox(db, sandbox=sandbox)

    assert db.durable_usage == {"sbx-existing"}
    assert "connect_usage:sbx-existing" not in events
    assert events[-3:] == [
        "failure_cas:sbx-existing",
        "failure_usage:sbx-existing",
        "commit",
    ]


@pytest.mark.parametrize("commit_applied", [False, True], ids=["not-applied", "applied"])
@pytest.mark.asyncio
async def test_ambiguous_post_resume_commit_keeps_exact_usage_billed(
    monkeypatch: pytest.MonkeyPatch,
    *,
    commit_applied: bool,
) -> None:
    events: list[str] = []
    sandbox = _sandbox(provider_sandbox_id="sbx-existing")
    provider = _FakeProvider(events)
    db = _FakeDb(
        events,
        fail_on_commit=3,
        apply_usage_before_failure=commit_applied,
    )
    _patch_connect_prelude(monkeypatch, sandbox=sandbox, provider=provider)
    _patch_exact_failure_usage(monkeypatch, db=db, sandbox=sandbox, events=events)

    async def _lock_attempt(*_args: Any, **_kwargs: Any) -> object:
        return sandbox

    monkeypatch.setattr(
        connect.cloud_sandboxes_store,
        "lock_cloud_sandbox_materialization_attempt",
        _lock_attempt,
    )

    with pytest.raises(RuntimeError, match="ambiguous commit"):
        await connect.connect_ready_sandbox(db, sandbox=sandbox)

    # If COMMIT reached PostgreSQL, the failure transaction's open is
    # idempotent. If it did not, the fenced failure transaction recreates it.
    assert db.durable_usage == {"sbx-existing"}
    assert events.count("connect_usage:sbx-existing") == 1
    assert events.count("failure_usage:sbx-existing") == 1
    assert events.count("failure_cas:sbx-existing") == 1


@pytest.mark.parametrize(
    ("commit_applied", "current_provider_id", "expected_destroyed"),
    [
        (False, None, ["sbx-new"]),
        (True, "sbx-new", []),
    ],
    ids=["unbound-newer-attempt", "bound-newer-attempt"],
)
@pytest.mark.asyncio
async def test_candidate_commit_ambiguity_resolves_custody_from_current_binding(
    monkeypatch: pytest.MonkeyPatch,
    *,
    commit_applied: bool,
    current_provider_id: str | None,
    expected_destroyed: list[str],
) -> None:
    events: list[str] = []
    sandbox = _sandbox(provider_sandbox_id=None)
    provider = _FakeProvider(events)
    db = _FakeDb(
        events,
        fail_on_commit=3,
        apply_usage_before_failure=commit_applied,
    )
    _patch_connect_prelude(monkeypatch, sandbox=sandbox, provider=provider)
    bound = _copy_sandbox(sandbox, e2b_sandbox_id="sbx-new")

    async def _record(*_args: Any, **_kwargs: Any) -> object:
        events.append("record_candidate")
        return bound

    async def _open_usage(
        _db: object,
        *,
        provider_sandbox_id: str,
        **_kwargs: Any,
    ) -> None:
        events.append(f"candidate_usage:{provider_sandbox_id}")
        db.staged_usage.add(provider_sandbox_id)

    async def _persist_failure(*_args: Any, **kwargs: Any) -> tuple[bool, None]:
        assert kwargs["expected_provider_sandbox_ids"] == ("sbx-new", None)
        assert kwargs["expected_materialization_attempt"] == sandbox.materialization_attempt
        events.append("failure_cas_miss")
        return False, None

    async def _load_current(*_args: Any, **_kwargs: Any) -> object:
        events.append("load_current")
        return _copy_sandbox(
            sandbox,
            e2b_sandbox_id=current_provider_id,
            materialization_attempt=sandbox.materialization_attempt + 1,
        )

    monkeypatch.setattr(
        connect.cloud_sandboxes_store,
        "record_cloud_sandbox_provider_sandbox",
        _record,
    )
    monkeypatch.setattr(connect, "open_cloud_sandbox_provider_usage", _open_usage)
    monkeypatch.setattr(connect, "persist_materialization_failure", _persist_failure)
    monkeypatch.setattr(
        connect.cloud_sandboxes_store,
        "load_cloud_sandbox_by_id",
        _load_current,
    )

    with pytest.raises(RuntimeError, match="ambiguous commit"):
        await connect.connect_ready_sandbox(db, sandbox=sandbox)

    assert provider.destroyed == expected_destroyed
    assert events.index("failure_cas_miss") < events.index("load_current")


@pytest.mark.asyncio
async def test_lost_record_destroys_vm_and_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    events: list[str] = []
    provider = _FakeProvider(events)
    sandbox = _sandbox(provider_sandbox_id=None)
    _patch_connect_prelude(monkeypatch, sandbox=sandbox, provider=provider)

    async def _record_none(*_args: Any, **_kwargs: Any) -> None:
        events.append("record_none")
        return None

    async def _persist_failure(*_args: Any, **_kwargs: Any) -> tuple[bool, None]:
        return False, None

    monkeypatch.setattr(
        connect.cloud_sandboxes_store,
        "record_cloud_sandbox_provider_sandbox",
        _record_none,
    )
    monkeypatch.setattr(connect, "persist_materialization_failure", _persist_failure)

    db = _FakeDb(events)
    with pytest.raises(CloudMaterializationCommandError):
        await connect.connect_ready_sandbox(db, sandbox=sandbox)

    assert provider.destroyed == ["sbx-new"]
    assert db.commits == 2
    assert events[-4:] == [
        "provider_create",
        "record_none",
        "rollback",
        "provider_destroy:sbx-new",
    ]


@pytest.mark.asyncio
async def test_cancelled_create_destroys_returned_unrecorded_candidate() -> None:
    events: list[str] = []
    provider = _BlockingCreateProvider(events)
    sandbox_id = uuid.uuid4()
    owner_user_id = uuid.uuid4()
    create = asyncio.create_task(
        connect._create_provider_sandbox(  # noqa: SLF001 - unit-level custody seam.
            provider,
            sandbox_id=sandbox_id,
            owner_user_id=owner_user_id,
        )
    )
    await provider.create_started.wait()

    create.cancel()
    provider.release_create.set()
    with pytest.raises(asyncio.CancelledError):
        await create

    assert provider.destroyed == ["sbx-cancelled"]
    assert events == [
        "provider_create_started",
        "provider_create_returned",
        "provider_destroy:sbx-cancelled",
    ]


@pytest.mark.asyncio
async def test_provider_create_metadata_emits_current_and_legacy_cloud_ids() -> None:
    events: list[str] = []
    provider = _FakeProvider(events)
    sandbox_id = uuid.uuid4()
    owner_user_id = uuid.uuid4()

    await connect._create_provider_sandbox(  # noqa: SLF001 - unit-level metadata seam.
        provider,
        sandbox_id=sandbox_id,
        owner_user_id=owner_user_id,
    )

    assert provider.create_metadata == {
        "cloud_sandbox_id": str(sandbox_id),
        "proliferate_cloud_sandbox_id": str(sandbox_id),
        "proliferate_owner_user_id": str(owner_user_id),
    }
