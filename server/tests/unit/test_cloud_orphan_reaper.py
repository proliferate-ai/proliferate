"""Conservative attribution and race boundaries for the E2B orphan reaper."""

from __future__ import annotations

from datetime import timedelta
from types import SimpleNamespace
from typing import Any
from uuid import UUID, uuid4

import pytest

from proliferate.integrations.sandbox import ProviderSandboxState
from proliferate.server.cloud.worker import service
from proliferate.utils.time import utcnow

NOW = utcnow()


def _state(
    *,
    external_id: str,
    state: str = "running",
    cloud_sandbox_id: object | None = None,
    age_seconds: float | None = 10_000.0,
    metadata: dict[str, object] | None = None,
) -> ProviderSandboxState:
    provider_metadata = dict(metadata or {})
    if cloud_sandbox_id is not None:
        provider_metadata["proliferate_cloud_sandbox_id"] = cloud_sandbox_id
    started_at = None if age_seconds is None else NOW - timedelta(seconds=age_seconds)
    return ProviderSandboxState(
        external_sandbox_id=external_id,
        state=state,
        started_at=started_at,
        end_at=None,
        observed_at=NOW,
        metadata=provider_metadata,  # type: ignore[arg-type]
    )


class _FakeProvider:
    def __init__(
        self,
        states: list[ProviderSandboxState],
        *,
        fail_destroy: set[str] | None = None,
    ) -> None:
        self.states = states
        self.fail_destroy = fail_destroy or set()
        self.destroy_attempts: list[str] = []

    async def list_sandbox_states(self) -> list[ProviderSandboxState]:
        return self.states

    async def destroy_sandbox(self, sandbox_id: str) -> None:
        self.destroy_attempts.append(sandbox_id)
        if sandbox_id in self.fail_destroy:
            raise RuntimeError("provider refused destroy")


def _row(*, e2b_sandbox_id: str | None, destroyed: bool = False) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid4(),
        e2b_sandbox_id=e2b_sandbox_id,
        destroyed_at=NOW if destroyed else None,
    )


def _patch_rows(
    monkeypatch: pytest.MonkeyPatch,
    rows: dict[UUID, Any],
    *,
    grace_seconds: float = 900.0,
) -> None:
    async def _load(_db: object, sandbox_id: UUID) -> Any:
        return rows.get(sandbox_id)

    monkeypatch.setattr(service, "load_cloud_sandbox_by_id", _load)
    monkeypatch.setattr(service.settings, "cloud_sandbox_reaper_grace_seconds", grace_seconds)
    monkeypatch.setattr(service, "utcnow", lambda: NOW)


@pytest.mark.asyncio
@pytest.mark.parametrize("provider_state", ["running", "paused"])
async def test_destroyed_local_row_reaps_running_and_paused_provider(
    monkeypatch: pytest.MonkeyPatch,
    provider_state: str,
) -> None:
    sandbox_id = uuid4()
    _patch_rows(
        monkeypatch,
        {sandbox_id: _row(e2b_sandbox_id="sbx-orphan", destroyed=True)},
    )
    provider = _FakeProvider(
        [
            _state(
                external_id="sbx-orphan",
                state=provider_state,
                cloud_sandbox_id=str(sandbox_id),
            )
        ]
    )

    await service._reap(object(), provider=provider)  # type: ignore[arg-type]

    assert provider.destroy_attempts == ["sbx-orphan"]


@pytest.mark.asyncio
@pytest.mark.parametrize("provider_state", ["running", "paused"])
async def test_superseded_provider_is_reaped_only_past_grace(
    monkeypatch: pytest.MonkeyPatch,
    provider_state: str,
) -> None:
    sandbox_id = uuid4()
    _patch_rows(monkeypatch, {sandbox_id: _row(e2b_sandbox_id="sbx-current")})
    provider = _FakeProvider(
        [
            _state(
                external_id="sbx-old",
                state=provider_state,
                cloud_sandbox_id=str(sandbox_id),
                age_seconds=901.0,
            ),
            _state(
                external_id="sbx-young",
                state=provider_state,
                cloud_sandbox_id=str(sandbox_id),
                age_seconds=899.0,
            ),
            _state(
                external_id="sbx-unknown-age",
                state=provider_state,
                cloud_sandbox_id=str(sandbox_id),
                age_seconds=None,
            ),
        ]
    )

    await service._reap(object(), provider=provider)  # type: ignore[arg-type]

    assert provider.destroy_attempts == ["sbx-old"]


@pytest.mark.asyncio
async def test_attribution_failures_never_destroy_provider_objects(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    known_id = uuid4()
    unknown_id = uuid4()
    _patch_rows(monkeypatch, {known_id: _row(e2b_sandbox_id="sbx-current")})
    provider = _FakeProvider(
        [
            _state(external_id="untagged"),
            _state(
                external_id="legacy-tag-only",
                metadata={"cloud_sandbox_id": str(known_id)},
            ),
            _state(external_id="unknown-row", cloud_sandbox_id=str(unknown_id)),
            _state(external_id="malformed", cloud_sandbox_id="not-a-uuid"),
            _state(external_id="wrong-type", cloud_sandbox_id=1234),
            _state(external_id="braced", cloud_sandbox_id=f"{{{known_id}}}"),
            _state(external_id="uppercase", cloud_sandbox_id=str(known_id).upper()),
        ]
    )

    await service._reap(object(), provider=provider)  # type: ignore[arg-type]

    assert provider.destroy_attempts == []


@pytest.mark.asyncio
async def test_active_inflight_exact_and_nonlive_objects_are_never_destroyed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    inflight_id = uuid4()
    healthy_id = uuid4()
    destroyed_id = uuid4()
    _patch_rows(
        monkeypatch,
        {
            inflight_id: _row(e2b_sandbox_id=None),
            healthy_id: _row(e2b_sandbox_id="sbx-healthy"),
            destroyed_id: _row(e2b_sandbox_id="sbx-dead", destroyed=True),
        },
    )
    provider = _FakeProvider(
        [
            _state(external_id="sbx-inflight", cloud_sandbox_id=str(inflight_id)),
            _state(external_id="sbx-healthy", cloud_sandbox_id=str(healthy_id)),
            _state(
                external_id="sbx-dead",
                state="killed",
                cloud_sandbox_id=str(destroyed_id),
            ),
            _state(
                external_id="sbx-transitional",
                state="pausing",
                cloud_sandbox_id=str(destroyed_id),
            ),
        ]
    )

    await service._reap(object(), provider=provider)  # type: ignore[arg-type]

    assert provider.destroy_attempts == []


@pytest.mark.asyncio
async def test_destroyed_row_honors_known_age_and_tolerates_missing_age(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sandbox_id = uuid4()
    _patch_rows(
        monkeypatch,
        {sandbox_id: _row(e2b_sandbox_id="sbx-current", destroyed=True)},
    )
    provider = _FakeProvider(
        [
            _state(
                external_id="sbx-young",
                cloud_sandbox_id=str(sandbox_id),
                age_seconds=10.0,
            ),
            _state(
                external_id="sbx-no-age",
                cloud_sandbox_id=str(sandbox_id),
                age_seconds=None,
            ),
        ]
    )

    await service._reap(object(), provider=provider)  # type: ignore[arg-type]

    assert provider.destroy_attempts == ["sbx-no-age"]


@pytest.mark.asyncio
async def test_one_destroy_failure_does_not_expand_or_abort_the_pass(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first_id = uuid4()
    second_id = uuid4()
    _patch_rows(
        monkeypatch,
        {
            first_id: _row(e2b_sandbox_id="sbx-first", destroyed=True),
            second_id: _row(e2b_sandbox_id="sbx-second", destroyed=True),
        },
    )
    provider = _FakeProvider(
        [
            _state(external_id="sbx-first", cloud_sandbox_id=str(first_id)),
            _state(external_id="sbx-second", cloud_sandbox_id=str(second_id)),
            _state(external_id="unowned"),
        ],
        fail_destroy={"sbx-first"},
    )

    await service._reap(object(), provider=provider)  # type: ignore[arg-type]

    assert provider.destroy_attempts == ["sbx-first", "sbx-second"]


def test_future_and_naive_timestamps_remain_inside_grace() -> None:
    future = _state(external_id="future", age_seconds=-60.0)
    naive = _state(external_id="naive", age_seconds=60.0)
    assert naive.started_at is not None
    naive = ProviderSandboxState(
        external_sandbox_id=naive.external_sandbox_id,
        state=naive.state,
        started_at=naive.started_at.replace(tzinfo=None),
        end_at=naive.end_at,
        observed_at=naive.observed_at,
        metadata=naive.metadata,
    )

    assert service._within_grace(future, now=NOW, grace_seconds=900.0)
    assert service._within_grace(naive, now=NOW, grace_seconds=900.0)


class _LockDb:
    pass


def _patch_lock(monkeypatch: pytest.MonkeyPatch, *, acquired: bool) -> dict[str, int]:
    calls = {"acquire": 0, "release": 0}

    async def _acquire(_db: object) -> bool:
        calls["acquire"] += 1
        return acquired

    async def _release(_db: object) -> None:
        calls["release"] += 1

    monkeypatch.setattr(service, "try_acquire_cloud_sandbox_orphan_reaper_lock", _acquire)
    monkeypatch.setattr(service, "release_cloud_sandbox_orphan_reaper_lock", _release)
    return calls


@pytest.mark.asyncio
async def test_singleton_skip_never_constructs_or_calls_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = _patch_lock(monkeypatch, acquired=False)

    def _unexpected_provider() -> object:
        raise AssertionError("provider must not be constructed without the singleton lock")

    monkeypatch.setattr(service, "get_configured_sandbox_provider", _unexpected_provider)

    await service.run_orphan_sandbox_reap_pass(_LockDb())  # type: ignore[arg-type]

    assert calls == {"acquire": 1, "release": 0}


@pytest.mark.asyncio
async def test_singleton_lock_releases_when_provider_list_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = _patch_lock(monkeypatch, acquired=True)

    class _ListFailure(_FakeProvider):
        async def list_sandbox_states(self) -> list[ProviderSandboxState]:
            raise RuntimeError("list failed")

    with pytest.raises(RuntimeError, match="list failed"):
        await service.run_orphan_sandbox_reap_pass(  # type: ignore[arg-type]
            _LockDb(),
            provider=_ListFailure([]),
        )

    assert calls == {"acquire": 1, "release": 1}
