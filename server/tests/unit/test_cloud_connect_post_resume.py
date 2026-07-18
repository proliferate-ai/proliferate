"""Commit custody for post-resume provider observations."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any

import pytest

from proliferate.integrations.sandbox import ProviderSandboxState
from proliferate.server.cloud.materialization.sandbox_io import connect
from proliferate.server.cloud.materialization.sandbox_io.resume_acceptance import (
    ProviderInactiveAfterResume,
    ProviderMissingAfterResume,
    accept_resumed_provider,
)
from tests.unit.test_cloud_connect_race import (
    _FakeDb,
    _FakeProvider,
    _copy_sandbox,
    _patch_connect_prelude,
    _sandbox,
)

NOW = datetime(2026, 7, 17, 12, 0, tzinfo=UTC)


@pytest.mark.asyncio
async def test_inactive_commit_ambiguity_clears_resume_open_and_owns_exact_close(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[str] = []
    sandbox = _sandbox(provider_sandbox_id="sbx-existing")
    provider = _FakeProvider(events)
    db = _FakeDb(events)
    _patch_connect_prelude(monkeypatch, sandbox=sandbox, provider=provider)
    commit_error = RuntimeError("ambiguous inactive commit")
    captured: dict[str, Any] = {}

    async def _inactive(*_args: Any, **_kwargs: Any) -> object:
        raise ProviderInactiveAfterResume(commit_error=commit_error)

    async def _persist(*_args: Any, **kwargs: Any) -> tuple[bool, str]:
        captured.update(kwargs)
        return True, "sbx-existing"

    monkeypatch.setattr(connect, "accept_resumed_provider", _inactive)
    monkeypatch.setattr(connect, "persist_materialization_failure", _persist)

    with pytest.raises(RuntimeError, match="ambiguous inactive commit"):
        await connect.connect_ready_sandbox(db, sandbox=sandbox)

    assert captured["ensure_usage_if_provider_matches"] is None
    assert captured["close_usage_if_provider_matches"] == "sbx-existing"
    assert captured["expected_provider_sandbox_ids"] == ("sbx-existing",)
    assert captured["detach_missing_provider"] is None
    assert captured["error"] is commit_error


@pytest.mark.parametrize("commit_applied", [False, True], ids=["not-applied", "applied"])
@pytest.mark.asyncio
async def test_missing_commit_ambiguity_keeps_detach_and_close_fallbacks(
    monkeypatch: pytest.MonkeyPatch,
    *,
    commit_applied: bool,
) -> None:
    events: list[str] = []
    sandbox = _sandbox(provider_sandbox_id="sbx-existing")
    detached = _copy_sandbox(sandbox, e2b_sandbox_id=None, status="creating")
    provider = _FakeProvider(events)
    db = _FakeDb(
        events,
        fail_on_commit=3,
        apply_usage_before_failure=commit_applied,
    )
    _patch_connect_prelude(monkeypatch, sandbox=sandbox, provider=provider)
    missing = ProviderMissingAfterResume(
        observation_started_at=NOW + timedelta(seconds=2),
        ended_at=NOW + timedelta(seconds=1),
    )
    captured: dict[str, Any] = {}

    async def _missing(*_args: Any, **_kwargs: Any) -> object:
        raise missing

    async def _detach(
        *_args: Any,
        observation_started_at: datetime,
        ended_at: datetime,
        **_kwargs: Any,
    ) -> object:
        assert observation_started_at == missing.observation_started_at
        assert ended_at == missing.ended_at
        events.append("detach")
        events.append("close")
        return detached

    async def _persist(*_args: Any, **kwargs: Any) -> tuple[bool, str]:
        captured.update(kwargs)
        return True, "sbx-existing"

    monkeypatch.setattr(connect, "accept_resumed_provider", _missing)
    monkeypatch.setattr(
        connect,
        "detach_missing_provider",
        _detach,
    )
    monkeypatch.setattr(connect, "persist_materialization_failure", _persist)

    with pytest.raises(RuntimeError, match="ambiguous commit"):
        await connect.connect_ready_sandbox(db, sandbox=sandbox)

    assert captured["expected_provider_sandbox_ids"] == (None, "sbx-existing")
    assert captured["ensure_usage_if_provider_matches"] is None
    assert captured["close_usage_if_provider_matches"] == "sbx-existing"
    assert captured["detach_missing_provider"] == (
        "sbx-existing",
        missing.observation_started_at,
        missing.ended_at,
    )
    assert captured["error"] is missing
    assert events.count("detach") == 1
    assert events.count("close") == 1


@pytest.mark.asyncio
async def test_inactive_observation_uses_provider_end_and_surfaces_commit_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[str] = []
    sandbox = _sandbox(provider_sandbox_id="sbx-existing")
    end_at = NOW + timedelta(seconds=3)
    state = ProviderSandboxState(
        external_sandbox_id="sbx-existing",
        state="paused",
        started_at=NOW,
        end_at=end_at,
        observed_at=NOW + timedelta(seconds=5),
        metadata={},
    )

    class _Db:
        def __init__(self) -> None:
            self.commits = 0

        async def rollback(self) -> None:
            events.append("rollback")

        async def commit(self) -> None:
            self.commits += 1
            events.append(f"commit:{self.commits}")
            if self.commits == 2:
                raise RuntimeError("inactive commit uncertain")

    class _Provider:
        async def get_sandbox_state(self, _sandbox_id: str) -> ProviderSandboxState:
            return state

    async def _reject_start(*_args: Any, **_kwargs: Any) -> None:
        return None

    async def _load(*_args: Any, **_kwargs: Any) -> object:
        return sandbox

    async def _pause(*_args: Any, **_kwargs: Any) -> object:
        events.append("pause")
        return SimpleNamespace(status="paused")

    async def _close(*_args: Any, ended_at: datetime, **_kwargs: Any) -> None:
        assert ended_at == end_at
        events.append("close")

    monkeypatch.setattr(
        "proliferate.server.cloud.materialization.sandbox_io.resume_acceptance."
        "cloud_sandboxes_store.lock_cloud_sandbox_materialization_attempt",
        _reject_start,
    )
    monkeypatch.setattr(
        "proliferate.server.cloud.materialization.sandbox_io.resume_acceptance."
        "cloud_sandboxes_store.load_cloud_sandbox_by_id",
        _load,
    )
    monkeypatch.setattr(
        "proliferate.server.cloud.materialization.sandbox_io.resume_acceptance."
        "cloud_sandboxes_store.apply_cloud_sandbox_provider_observation",
        _pause,
    )
    monkeypatch.setattr(
        "proliferate.server.cloud.materialization.sandbox_io.resume_acceptance."
        "close_cloud_sandbox_provider_usage",
        _close,
    )

    with pytest.raises(ProviderInactiveAfterResume) as raised:
        await accept_resumed_provider(
            _Db(),  # type: ignore[arg-type]
            provider=_Provider(),  # type: ignore[arg-type]
            sandbox_id=sandbox.id,
            provider_sandbox_id="sbx-existing",
            materialization_attempt=sandbox.materialization_attempt,
            resume_started_at=NOW,
        )

    assert isinstance(raised.value.commit_error, RuntimeError)
    assert events == ["rollback", "commit:1", "pause", "close", "commit:2"]
