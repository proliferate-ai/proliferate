from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest

from proliferate.integrations.sandbox import ProviderSandboxState
from proliferate.server.billing import reconciler


@pytest.mark.asyncio
async def test_billing_reconciler_loop_captures_recovered_failures(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    capture_mock = Mock()

    async def _boom() -> None:
        raise RuntimeError("billing down")

    async def _stop(_seconds: float) -> None:
        raise asyncio.CancelledError()

    monkeypatch.setattr(reconciler, "run_billing_reconcile_pass", _boom)
    monkeypatch.setattr(reconciler, "capture_server_sentry_exception", capture_mock)
    monkeypatch.setattr(reconciler.asyncio, "sleep", _stop)

    with pytest.raises(asyncio.CancelledError):
        await reconciler._billing_reconciler_loop()

    capture_mock.assert_called_once()
    assert capture_mock.call_args.args[0].args == ("billing down",)
    assert capture_mock.call_args.kwargs["tags"] == {
        "domain": "billing",
        "action": "reconcile_loop",
    }


@pytest.mark.asyncio
async def test_reconcile_segment_confirms_missing_list_state_before_marking_paused(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sandbox_id = uuid4()
    observed_at = datetime.now(UTC)
    sandbox = SimpleNamespace(
        id=sandbox_id,
        external_sandbox_id="sandbox-123",
        runtime_environment_id=uuid4(),
    )
    segment = SimpleNamespace(
        sandbox_id=sandbox_id,
        external_sandbox_id="sandbox-123",
    )
    billing_snapshot = SimpleNamespace(active_spend_hold=False)
    closed: list[object] = []
    saved: list[object] = []
    marked: list[object] = []

    class _Provider:
        async def get_sandbox_state(self, sandbox_id: str) -> ProviderSandboxState:
            return ProviderSandboxState(
                external_sandbox_id=sandbox_id,
                state="running",
                started_at=observed_at,
                end_at=None,
                observed_at=observed_at,
                metadata={},
            )

    async def _close_usage_segment_for_sandbox(*args, **kwargs) -> None:
        closed.append((args, kwargs))

    async def _save_sandbox_provider_state(*args, **kwargs) -> None:
        saved.append((args, kwargs))

    async def _mark_environment_unavailable(*args, **kwargs) -> None:
        marked.append((args, kwargs))

    async def _load_cloud_sandbox_by_id(_sandbox_id):
        return sandbox

    monkeypatch.setattr(reconciler, "load_cloud_sandbox_by_id", _load_cloud_sandbox_by_id)
    monkeypatch.setattr(
        reconciler,
        "close_usage_segment_for_sandbox",
        _close_usage_segment_for_sandbox,
    )
    monkeypatch.setattr(reconciler, "save_sandbox_provider_state", _save_sandbox_provider_state)
    monkeypatch.setattr(reconciler, "_mark_environment_unavailable", _mark_environment_unavailable)

    await reconciler._enforce_or_reconcile_segment(
        segment=segment,
        provider=_Provider(),
        state=None,
        billing_snapshot=billing_snapshot,
    )

    assert closed == []
    assert saved == []
    assert marked == []
