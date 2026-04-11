from __future__ import annotations

import asyncio
from unittest.mock import Mock

import pytest

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
