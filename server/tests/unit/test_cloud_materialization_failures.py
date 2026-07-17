from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest

from proliferate.integrations.sandbox import (
    SandboxProviderConfigurationError,
    SandboxProviderTargetUnavailableError,
    SandboxProviderUnavailableError,
)
from proliferate.server.cloud.materialization import failures
from proliferate.server.cloud.materialization.failures import materialization_error_receipt
from proliferate.server.cloud.materialization.sandbox_io.target import (
    CloudMaterializationCommandError,
)


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (
            SandboxProviderConfigurationError("secret-config-value"),
            "Sandbox provider configuration prevents materialization. Contact support.",
        ),
        (
            SandboxProviderTargetUnavailableError("secret-provider-id"),
            "The provider sandbox no longer exists. Retry to create a replacement.",
        ),
        (
            SandboxProviderUnavailableError("secret-provider-response"),
            "The sandbox provider is temporarily unavailable. Retry later.",
        ),
        (
            CloudMaterializationCommandError("secret-command-output"),
            "The sandbox runtime did not become ready. Retry later.",
        ),
        (RuntimeError("secret-token"), "Sandbox materialization failed. Retry later."),
    ],
)
def test_materialization_error_receipt_is_stable_and_secret_safe(
    error: Exception,
    expected: str,
) -> None:
    receipt = materialization_error_receipt(error)

    assert receipt == expected
    assert "secret" not in receipt


@pytest.mark.asyncio
async def test_commit_ambiguous_candidate_is_adopted_when_binding_remains_null(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[str] = []
    state: dict[str, str | None] = {"provider_id": None}
    sandbox_id = uuid4()
    owner_user_id = uuid4()
    attempt = 4

    class _Db:
        async def rollback(self) -> None:
            events.append("rollback")

        async def commit(self) -> None:
            events.append("commit")

    async def _mark(
        _db: object,
        _sandbox_id: object,
        *,
        expected_provider_sandbox_id: str | None,
        expected_materialization_attempt: int,
        last_error: str,
    ) -> object | None:
        assert expected_materialization_attempt == attempt
        assert last_error
        events.append(f"mark:{expected_provider_sandbox_id}")
        if state["provider_id"] != expected_provider_sandbox_id:
            return None
        return SimpleNamespace(provider_sandbox_id=expected_provider_sandbox_id)

    async def _adopt(
        _db: object,
        _sandbox_id: object,
        *,
        e2b_sandbox_id: str,
        expected_materialization_attempt: int,
        **_kwargs: object,
    ) -> object | None:
        assert expected_materialization_attempt == attempt
        events.append(f"adopt:{e2b_sandbox_id}")
        if state["provider_id"] is not None:
            return None
        state["provider_id"] = e2b_sandbox_id
        return SimpleNamespace(provider_sandbox_id=e2b_sandbox_id)

    async def _open(
        _db: object,
        *,
        provider_sandbox_id: str,
        **_kwargs: object,
    ) -> None:
        events.append(f"open:{provider_sandbox_id}")

    monkeypatch.setattr(failures, "mark_cloud_sandbox_materialization_error", _mark)
    monkeypatch.setattr(failures, "record_cloud_sandbox_provider_sandbox", _adopt)
    monkeypatch.setattr(failures, "open_cloud_sandbox_provider_usage", _open)

    matched, provider_id = await failures.persist_materialization_failure(
        _Db(),  # type: ignore[arg-type]
        sandbox_id=sandbox_id,
        expected_provider_sandbox_ids=("provider-candidate", None),
        expected_materialization_attempt=attempt,
        error=RuntimeError("ambiguous commit"),
        adopt_provider_if_unbound=(
            "provider-candidate",
            "e2b-test",
            owner_user_id,
            datetime(2026, 7, 17, tzinfo=UTC),
        ),
    )

    assert matched is True
    assert provider_id == "provider-candidate"
    assert state["provider_id"] == "provider-candidate"
    assert events == [
        "rollback",
        "mark:provider-candidate",
        "adopt:provider-candidate",
        "open:provider-candidate",
        "mark:provider-candidate",
        "commit",
    ]


@pytest.mark.parametrize("detach_commit_applied", [False, True], ids=["not-applied", "applied"])
@pytest.mark.asyncio
async def test_missing_fallback_converges_paused_or_detached_commit_outcome(
    monkeypatch: pytest.MonkeyPatch,
    *,
    detach_commit_applied: bool,
) -> None:
    old_provider_id = "provider-old"
    attempt = 9
    state: dict[str, object] = {
        "provider_id": None if detach_commit_applied else old_provider_id,
        "status": "creating" if detach_commit_applied else "paused",
        "receipt": None,
    }
    events: list[str] = []

    class _Db:
        async def rollback(self) -> None:
            events.append("rollback")

        async def commit(self) -> None:
            events.append("commit")

    async def _detach(
        _db: object,
        _sandbox_id: object,
        *,
        expected_provider_sandbox_id: str,
        expected_materialization_attempt: int,
        **_kwargs: object,
    ) -> object | None:
        assert expected_materialization_attempt == attempt
        events.append("detach")
        if state["provider_id"] != expected_provider_sandbox_id or state["status"] not in {
            "creating",
            "ready",
            "paused",
        }:
            return None
        state["provider_id"] = None
        state["status"] = "creating"
        return SimpleNamespace(provider_sandbox_id=None)

    async def _mark(
        _db: object,
        _sandbox_id: object,
        *,
        expected_provider_sandbox_id: str | None,
        expected_materialization_attempt: int,
        last_error: str,
    ) -> object | None:
        assert expected_materialization_attempt == attempt
        events.append(f"mark:{expected_provider_sandbox_id}")
        if state["provider_id"] != expected_provider_sandbox_id or state["status"] not in {
            "creating",
            "ready",
            "error",
        }:
            return None
        state["status"] = "error"
        state["receipt"] = last_error
        return SimpleNamespace(provider_sandbox_id=expected_provider_sandbox_id)

    async def _close(
        _db: object,
        *,
        provider_sandbox_id: str,
        **_kwargs: object,
    ) -> None:
        assert provider_sandbox_id == old_provider_id
        events.append("close")

    monkeypatch.setattr(failures, "supersede_missing_cloud_sandbox_provider", _detach)
    monkeypatch.setattr(failures, "mark_cloud_sandbox_materialization_error", _mark)
    monkeypatch.setattr(failures, "close_cloud_sandbox_provider_usage", _close)
    observed_at = datetime(2026, 7, 17, tzinfo=UTC)

    matched, provider_id = await failures.persist_materialization_failure(
        _Db(),  # type: ignore[arg-type]
        sandbox_id=uuid4(),
        expected_provider_sandbox_ids=(None, old_provider_id),
        expected_materialization_attempt=attempt,
        error=SandboxProviderTargetUnavailableError("provider is gone"),
        detach_missing_provider=(old_provider_id, observed_at, observed_at),
    )

    assert matched is True
    assert provider_id is None
    assert state["provider_id"] is None
    assert state["status"] == "error"
    assert state["receipt"] == (
        "The provider sandbox no longer exists. Retry to create a replacement."
    )
    assert events.count("close") == (0 if detach_commit_applied else 1)


@pytest.mark.asyncio
async def test_missing_fallback_preserves_newer_bound_provider_observation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    old_provider_id = "provider-old"
    attempt = 9
    state: dict[str, object] = {
        "provider_id": old_provider_id,
        "status": "ready",
        "receipt": None,
    }
    events: list[str] = []

    class _Db:
        async def rollback(self) -> None:
            events.append("rollback")

        async def commit(self) -> None:
            events.append("commit")

    async def _detach(*_args: object, **_kwargs: object) -> None:
        events.append("detach_miss")
        return None

    async def _mark(
        _db: object,
        _sandbox_id: object,
        *,
        expected_provider_sandbox_id: str | None,
        expected_materialization_attempt: int,
        last_error: str,
    ) -> object | None:
        assert expected_materialization_attempt == attempt
        events.append(f"mark:{expected_provider_sandbox_id}")
        if state["provider_id"] != expected_provider_sandbox_id:
            return None
        state["status"] = "error"
        state["receipt"] = last_error
        return SimpleNamespace(provider_sandbox_id=expected_provider_sandbox_id)

    async def _unexpected_close(*_args: object, **_kwargs: object) -> None:
        pytest.fail("newer provider usage must remain open")

    monkeypatch.setattr(failures, "supersede_missing_cloud_sandbox_provider", _detach)
    monkeypatch.setattr(failures, "mark_cloud_sandbox_materialization_error", _mark)
    monkeypatch.setattr(
        failures,
        "close_cloud_sandbox_provider_usage",
        _unexpected_close,
    )
    observed_at = datetime(2026, 7, 17, tzinfo=UTC)

    matched, provider_id = await failures.persist_materialization_failure(
        _Db(),  # type: ignore[arg-type]
        sandbox_id=uuid4(),
        expected_provider_sandbox_ids=(None, old_provider_id),
        expected_materialization_attempt=attempt,
        error=SandboxProviderTargetUnavailableError("stale missing observation"),
        detach_missing_provider=(old_provider_id, observed_at, observed_at),
    )

    assert matched is False
    assert provider_id is None
    assert state == {
        "provider_id": old_provider_id,
        "status": "ready",
        "receipt": None,
    }
    assert events == ["rollback", "detach_miss", "mark:None", "commit"]
