"""Part C: the orphan-sandbox reaper attributes and destroys only real orphans."""

from __future__ import annotations

import uuid
from datetime import timedelta
from types import SimpleNamespace
from typing import Any

import pytest

from proliferate.integrations.sandbox import ProviderSandboxState
from proliferate.server.cloud.cloud_sandboxes import reaper
from proliferate.utils.time import utcnow

NOW = utcnow()


def _state(
    *,
    external_id: str,
    state: str = "running",
    cloud_sandbox_id: str | None = None,
    age_seconds: float = 10_000.0,
) -> ProviderSandboxState:
    metadata = {}
    if cloud_sandbox_id is not None:
        metadata["proliferate_cloud_sandbox_id"] = cloud_sandbox_id
    started_at = None if age_seconds is None else NOW - timedelta(seconds=age_seconds)
    return ProviderSandboxState(
        external_sandbox_id=external_id,
        state=state,
        started_at=started_at,
        end_at=None,
        observed_at=NOW,
        metadata=metadata,
    )


class _FakeProvider:
    def __init__(self, states: list[ProviderSandboxState]) -> None:
        self._states = states
        self.destroyed: list[str] = []

    async def list_sandbox_states(self) -> list[ProviderSandboxState]:
        return self._states

    async def destroy_sandbox(self, sandbox_id: str) -> None:
        self.destroyed.append(sandbox_id)


class _NullSession:
    async def __aenter__(self) -> _NullSession:
        return self

    async def __aexit__(self, *_a: Any) -> None:
        return None


def _patch_rows(monkeypatch: pytest.MonkeyPatch, rows: dict[uuid.UUID, Any]) -> None:
    monkeypatch.setattr(reaper.db_engine, "async_session_factory", lambda: _NullSession())

    async def _load(_db: Any, sandbox_id: uuid.UUID, **_k: Any) -> Any:
        return rows.get(sandbox_id)

    monkeypatch.setattr(reaper, "load_cloud_sandbox_by_id", _load)
    monkeypatch.setattr(reaper.settings, "cloud_sandbox_reaper_grace_seconds", 900.0)


def _row(*, e2b_sandbox_id: str | None, destroyed: bool = False) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        e2b_sandbox_id=e2b_sandbox_id,
        destroyed_at=NOW if destroyed else None,
    )


@pytest.mark.asyncio
async def test_destroyed_row_orphan_reaped(monkeypatch: pytest.MonkeyPatch) -> None:
    sid = uuid.uuid4()
    rows = {sid: _row(e2b_sandbox_id="sbx-1", destroyed=True)}
    _patch_rows(monkeypatch, rows)
    provider = _FakeProvider([_state(external_id="sbx-1", cloud_sandbox_id=str(sid))])

    await reaper._reap(provider)
    assert provider.destroyed == ["sbx-1"]


@pytest.mark.asyncio
async def test_untagged_skipped(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_rows(monkeypatch, {})
    provider = _FakeProvider([_state(external_id="sbx-x", cloud_sandbox_id=None)])

    await reaper._reap(provider)
    assert provider.destroyed == []


@pytest.mark.asyncio
async def test_unknown_row_skipped(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_rows(monkeypatch, {})  # tag parses but no such row
    provider = _FakeProvider([_state(external_id="sbx-x", cloud_sandbox_id=str(uuid.uuid4()))])

    await reaper._reap(provider)
    assert provider.destroyed == []


@pytest.mark.asyncio
async def test_mismatch_reaped_past_grace(monkeypatch: pytest.MonkeyPatch) -> None:
    sid = uuid.uuid4()
    rows = {sid: _row(e2b_sandbox_id="sbx-canonical")}
    _patch_rows(monkeypatch, rows)
    provider = _FakeProvider(
        [_state(external_id="sbx-stray", cloud_sandbox_id=str(sid), age_seconds=10_000.0)]
    )

    await reaper._reap(provider)
    assert provider.destroyed == ["sbx-stray"]


@pytest.mark.asyncio
async def test_mismatch_within_grace_skipped(monkeypatch: pytest.MonkeyPatch) -> None:
    sid = uuid.uuid4()
    rows = {sid: _row(e2b_sandbox_id="sbx-canonical")}
    _patch_rows(monkeypatch, rows)
    provider = _FakeProvider(
        [_state(external_id="sbx-stray", cloud_sandbox_id=str(sid), age_seconds=60.0)]
    )

    await reaper._reap(provider)
    assert provider.destroyed == []


@pytest.mark.asyncio
async def test_inflight_alive_row_skipped(monkeypatch: pytest.MonkeyPatch) -> None:
    sid = uuid.uuid4()
    rows = {sid: _row(e2b_sandbox_id=None)}  # in-flight create not recorded yet
    _patch_rows(monkeypatch, rows)
    provider = _FakeProvider([_state(external_id="sbx-1", cloud_sandbox_id=str(sid))])

    await reaper._reap(provider)
    assert provider.destroyed == []


@pytest.mark.asyncio
async def test_healthy_skipped(monkeypatch: pytest.MonkeyPatch) -> None:
    sid = uuid.uuid4()
    rows = {sid: _row(e2b_sandbox_id="sbx-1")}
    _patch_rows(monkeypatch, rows)
    provider = _FakeProvider([_state(external_id="sbx-1", cloud_sandbox_id=str(sid))])

    await reaper._reap(provider)
    assert provider.destroyed == []


@pytest.mark.asyncio
async def test_destroyed_row_within_grace_skipped(monkeypatch: pytest.MonkeyPatch) -> None:
    sid = uuid.uuid4()
    rows = {sid: _row(e2b_sandbox_id="sbx-1", destroyed=True)}
    _patch_rows(monkeypatch, rows)
    provider = _FakeProvider(
        [_state(external_id="sbx-1", cloud_sandbox_id=str(sid), age_seconds=60.0)]
    )

    await reaper._reap(provider)
    assert provider.destroyed == []


@pytest.mark.asyncio
async def test_paused_orphan_reaped(monkeypatch: pytest.MonkeyPatch) -> None:
    sid = uuid.uuid4()
    rows = {sid: _row(e2b_sandbox_id="sbx-1", destroyed=True)}
    _patch_rows(monkeypatch, rows)
    provider = _FakeProvider(
        [_state(external_id="sbx-1", state="paused", cloud_sandbox_id=str(sid))]
    )

    await reaper._reap(provider)
    assert provider.destroyed == ["sbx-1"]


class _LockSession:
    """Records advisory-lock acquire/release around a pass over a real session-shaped API."""

    def __init__(self, tracker: dict[str, Any], *, acquired: bool) -> None:
        self._tracker = tracker
        self._acquired = acquired

    async def __aenter__(self) -> _LockSession:
        return self

    async def __aexit__(self, *_a: Any) -> None:
        self._tracker["closed"] = True


def _patch_lock(monkeypatch: pytest.MonkeyPatch, *, acquired: bool) -> dict[str, Any]:
    tracker: dict[str, Any] = {"acquire": 0, "release": 0, "closed": False}
    monkeypatch.setattr(
        reaper.db_engine,
        "async_session_factory",
        lambda: _LockSession(tracker, acquired=acquired),
    )

    async def _try_acquire(_db: Any) -> bool:
        tracker["acquire"] += 1
        return acquired

    async def _release(_db: Any) -> None:
        tracker["release"] += 1

    monkeypatch.setattr(reaper, "try_acquire_cloud_sandbox_reaper_lock", _try_acquire)
    monkeypatch.setattr(reaper, "release_cloud_sandbox_reaper_lock", _release)
    return tracker


@pytest.mark.asyncio
async def test_pass_acquires_and_releases_lock(monkeypatch: pytest.MonkeyPatch) -> None:
    tracker = _patch_lock(monkeypatch, acquired=True)
    provider = _FakeProvider([])
    monkeypatch.setattr(reaper, "get_configured_sandbox_provider", lambda: provider)

    await reaper.run_orphan_sandbox_reap_pass()

    assert tracker["acquire"] == 1
    assert tracker["release"] == 1


@pytest.mark.asyncio
async def test_pass_skips_when_lock_not_acquired(monkeypatch: pytest.MonkeyPatch) -> None:
    tracker = _patch_lock(monkeypatch, acquired=False)
    provider_calls: list[bool] = []
    monkeypatch.setattr(
        reaper, "get_configured_sandbox_provider", lambda: provider_calls.append(True)
    )

    await reaper.run_orphan_sandbox_reap_pass()

    # Not acquired → no provider work, and (per the lock contract) no release of
    # a lock we do not hold.
    assert tracker["acquire"] == 1
    assert tracker["release"] == 0
    assert provider_calls == []


@pytest.mark.asyncio
async def test_pass_releases_lock_on_exception(monkeypatch: pytest.MonkeyPatch) -> None:
    tracker = _patch_lock(monkeypatch, acquired=True)

    class _Boom:
        async def list_sandbox_states(self) -> list[ProviderSandboxState]:
            raise RuntimeError("provider list failed")

    monkeypatch.setattr(reaper, "get_configured_sandbox_provider", lambda: _Boom())

    with pytest.raises(RuntimeError, match="provider list failed"):
        await reaper.run_orphan_sandbox_reap_pass()

    # The lock is released even when the pass raises (finally clause).
    assert tracker["acquire"] == 1
    assert tracker["release"] == 1


@pytest.mark.asyncio
async def test_dead_state_skipped(monkeypatch: pytest.MonkeyPatch) -> None:
    sid = uuid.uuid4()
    rows = {sid: _row(e2b_sandbox_id="sbx-1", destroyed=True)}
    _patch_rows(monkeypatch, rows)
    provider = _FakeProvider(
        [_state(external_id="sbx-1", state="killed", cloud_sandbox_id=str(sid))]
    )

    await reaper._reap(provider)
    assert provider.destroyed == []
