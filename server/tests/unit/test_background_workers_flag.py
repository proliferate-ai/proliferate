"""The ``run_background_workers`` flag gates the periodic maintenance loops.

Deterministic billing tests boot the API with the loops disabled and drive the
reconciler / accounting / gateway passes on demand out-of-process, so a
background tick never races or deadlocks with the test's own pass. Toggling the
flag off must make every loop-starter a no-op even when the feature it belongs
to (gateway, enforce billing) is otherwise enabled.
"""

from __future__ import annotations

import pytest

import proliferate.server.billing.reconciler as reconciler
from proliferate.config import settings
from proliferate.server.cloud.agent_gateway.worker import (
    start_agent_gateway_enrollment_backfill,
    start_agent_gateway_llm_topups,
    start_agent_gateway_usage_import,
)


def _enable_gateway(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    # Make top-ups otherwise-enabled so the flag is the only thing gating it.
    monkeypatch.setattr(settings, "agent_gateway_llm_topup_price_id", "price_llm_topup")
    monkeypatch.setattr(settings, "agent_gateway_topup_amount_usd", "10")


@pytest.mark.asyncio
async def test_gateway_loops_do_not_start_when_workers_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _enable_gateway(monkeypatch)
    monkeypatch.setattr(settings, "run_background_workers", False)

    assert await start_agent_gateway_enrollment_backfill() is None
    assert await start_agent_gateway_usage_import() is None
    assert await start_agent_gateway_llm_topups() is None


@pytest.mark.asyncio
async def test_gateway_loops_start_when_workers_enabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _enable_gateway(monkeypatch)
    monkeypatch.setattr(settings, "run_background_workers", True)

    tasks = [
        await start_agent_gateway_enrollment_backfill(),
        await start_agent_gateway_usage_import(),
        await start_agent_gateway_llm_topups(),
    ]
    try:
        for task in tasks:
            assert task is not None
    finally:
        for task in tasks:
            if task is not None:
                task.cancel()


def test_billing_reconciler_does_not_start_when_workers_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "run_background_workers", False)
    monkeypatch.setattr(reconciler, "_reconciler_task", None, raising=False)

    reconciler.start_billing_reconciler()

    assert reconciler._reconciler_task is None


def test_run_background_workers_defaults_true() -> None:
    # Production/default posture is unchanged: the loops auto-run with the API.
    assert settings.run_background_workers is True
