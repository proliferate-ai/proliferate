from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import cast
from uuid import UUID, uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.server.cloud.cloud_sandboxes import service as cloud_sandbox_service
from proliferate.server.cloud.gateway import service as gateway_service
from proliferate.server.cloud.materialization.failures import (
    PROVIDER_SANDBOX_MISSING_RECEIPT,
)

NOW = datetime(2026, 8, 5, 8, 0, tzinfo=UTC)


def _session() -> AsyncSession:
    return cast(AsyncSession, object())


def _expected_call(
    db: AsyncSession,
    sandbox_id: UUID,
    *,
    include_status: bool = False,
) -> dict[str, object]:
    call: dict[str, object] = {
        "db": db,
        "sandbox_id": sandbox_id,
        "expected_provider_sandbox_id": "provider-1",
        "expected_materialization_attempt": 7,
        "observed_at": NOW,
    }
    if include_status:
        call["status"] = "paused"
    return call


@pytest.mark.asyncio
async def test_running_observation_forwards_exact_authority(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = _session()
    sandbox_id = uuid4()
    expected = SimpleNamespace(id=sandbox_id)
    calls: list[dict[str, object]] = []

    async def _advance(
        actual_db: AsyncSession,
        actual_sandbox_id: UUID,
        **kwargs: object,
    ) -> object:
        calls.append({"db": actual_db, "sandbox_id": actual_sandbox_id, **kwargs})
        return expected

    monkeypatch.setattr(
        cloud_sandbox_service.sandbox_store,
        "advance_cloud_sandbox_provider_observation_floor",
        _advance,
    )

    result = await cloud_sandbox_service.observe_cloud_sandbox_provider_running(
        db,
        sandbox_id,
        expected_provider_sandbox_id="provider-1",
        expected_materialization_attempt=7,
        observed_at=NOW,
    )

    assert result is expected
    assert calls == [_expected_call(db, sandbox_id)]


@pytest.mark.asyncio
async def test_stopped_observation_returns_primary_without_destroyed_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = _session()
    sandbox_id = uuid4()
    expected = SimpleNamespace(id=sandbox_id)
    calls: list[dict[str, object]] = []

    async def _apply(
        actual_db: AsyncSession,
        actual_sandbox_id: UUID,
        **kwargs: object,
    ) -> object:
        calls.append({"db": actual_db, "sandbox_id": actual_sandbox_id, **kwargs})
        return expected

    async def _unexpected(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("primary stopped observation must not use fallback")

    monkeypatch.setattr(
        cloud_sandbox_service.sandbox_store,
        "apply_cloud_sandbox_provider_observation",
        _apply,
    )
    monkeypatch.setattr(
        cloud_sandbox_service.sandbox_store,
        "accept_destroyed_cloud_sandbox_provider_observation",
        _unexpected,
    )

    result = await cloud_sandbox_service.observe_cloud_sandbox_provider_stopped(
        db,
        sandbox_id,
        expected_provider_sandbox_id="provider-1",
        expected_materialization_attempt=7,
        observed_at=NOW,
    )

    assert result is expected
    assert calls == [_expected_call(db, sandbox_id, include_status=True)]


@pytest.mark.parametrize("fallback_succeeds", [True, False])
@pytest.mark.asyncio
async def test_stopped_observation_falls_back_only_for_destroyed_state(
    monkeypatch: pytest.MonkeyPatch,
    fallback_succeeds: bool,
) -> None:
    db = _session()
    sandbox_id = uuid4()
    expected = SimpleNamespace(id=sandbox_id) if fallback_succeeds else None
    fallback_calls: list[dict[str, object]] = []

    async def _reject(*_args: object, **_kwargs: object) -> None:
        return None

    async def _accept(
        actual_db: AsyncSession,
        actual_sandbox_id: UUID,
        **kwargs: object,
    ) -> object | None:
        fallback_calls.append({"db": actual_db, "sandbox_id": actual_sandbox_id, **kwargs})
        return expected

    monkeypatch.setattr(
        cloud_sandbox_service.sandbox_store,
        "apply_cloud_sandbox_provider_observation",
        _reject,
    )
    monkeypatch.setattr(
        cloud_sandbox_service.sandbox_store,
        "accept_destroyed_cloud_sandbox_provider_observation",
        _accept,
    )

    result = await cloud_sandbox_service.observe_cloud_sandbox_provider_stopped(
        db,
        sandbox_id,
        expected_provider_sandbox_id="provider-1",
        expected_materialization_attempt=7,
        observed_at=NOW,
    )

    assert result is expected
    assert fallback_calls == [_expected_call(db, sandbox_id)]


@pytest.mark.asyncio
async def test_missing_observation_invalidates_exact_returned_owner(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = _session()
    sandbox_id = uuid4()
    owner_user_id = uuid4()
    expected = SimpleNamespace(id=sandbox_id, owner_user_id=owner_user_id)
    missing_calls: list[dict[str, object]] = []
    invalidated: list[UUID] = []

    async def _mark_missing(
        actual_db: AsyncSession,
        actual_sandbox_id: UUID,
        **kwargs: object,
    ) -> object:
        missing_calls.append({"db": actual_db, "sandbox_id": actual_sandbox_id, **kwargs})
        return expected

    async def _unexpected(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("primary missing observation must not use fallback")

    monkeypatch.setattr(
        cloud_sandbox_service.sandbox_store,
        "mark_cloud_sandbox_provider_missing",
        _mark_missing,
    )
    monkeypatch.setattr(
        cloud_sandbox_service.sandbox_store,
        "accept_destroyed_cloud_sandbox_provider_observation",
        _unexpected,
    )
    monkeypatch.setattr(
        gateway_service,
        "invalidate_cloud_sandbox_gateway_access_for_user",
        invalidated.append,
    )

    result = await cloud_sandbox_service.observe_cloud_sandbox_provider_missing(
        db,
        sandbox_id,
        expected_provider_sandbox_id="provider-1",
        expected_materialization_attempt=7,
        observed_at=NOW,
    )

    assert result is expected
    assert missing_calls == [
        {
            **_expected_call(db, sandbox_id),
            "last_error": PROVIDER_SANDBOX_MISSING_RECEIPT,
        }
    ]
    assert invalidated == [owner_user_id]


@pytest.mark.parametrize("fallback_succeeds", [True, False])
@pytest.mark.asyncio
async def test_missing_observation_destroyed_fallback_never_invalidates_gateway(
    monkeypatch: pytest.MonkeyPatch,
    fallback_succeeds: bool,
) -> None:
    db = _session()
    sandbox_id = uuid4()
    expected = SimpleNamespace(id=sandbox_id, owner_user_id=uuid4()) if fallback_succeeds else None
    fallback_calls: list[dict[str, object]] = []

    async def _reject(*_args: object, **_kwargs: object) -> None:
        return None

    async def _accept(
        actual_db: AsyncSession,
        actual_sandbox_id: UUID,
        **kwargs: object,
    ) -> object | None:
        fallback_calls.append({"db": actual_db, "sandbox_id": actual_sandbox_id, **kwargs})
        return expected

    def _unexpected(_owner_user_id: UUID) -> None:
        raise AssertionError("destroyed fallback must not invalidate gateway access")

    monkeypatch.setattr(
        cloud_sandbox_service.sandbox_store,
        "mark_cloud_sandbox_provider_missing",
        _reject,
    )
    monkeypatch.setattr(
        cloud_sandbox_service.sandbox_store,
        "accept_destroyed_cloud_sandbox_provider_observation",
        _accept,
    )
    monkeypatch.setattr(
        gateway_service,
        "invalidate_cloud_sandbox_gateway_access_for_user",
        _unexpected,
    )

    result = await cloud_sandbox_service.observe_cloud_sandbox_provider_missing(
        db,
        sandbox_id,
        expected_provider_sandbox_id="provider-1",
        expected_materialization_attempt=7,
        observed_at=NOW,
    )

    assert result is expected
    assert fallback_calls == [_expected_call(db, sandbox_id)]
