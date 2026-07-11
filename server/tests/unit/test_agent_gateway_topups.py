"""Fail-closed tests for the retired managed-LLM auto-top-up surface."""

from __future__ import annotations

import pytest

from proliferate.config import settings
from proliferate.server.cloud.agent_gateway.topups import run_llm_topups, topups_enabled


def test_legacy_configuration_cannot_enable_topups(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_llm_topup_price_id", "price_live_ignored")
    monkeypatch.setattr(settings, "agent_gateway_topup_threshold_usd", "1000")
    monkeypatch.setattr(settings, "agent_gateway_topup_amount_usd", "1000")

    assert topups_enabled() is False


@pytest.mark.asyncio
async def test_retired_pass_does_not_touch_its_database_argument(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_llm_topup_price_id", "price_live_ignored")
    monkeypatch.setattr(settings, "agent_gateway_topup_threshold_usd", "1000")
    monkeypatch.setattr(settings, "agent_gateway_topup_amount_usd", "1000")
    database_sentinel = object()

    result = await run_llm_topups(database_sentinel)

    assert result.scanned == 0
    assert result.eligible == 0
    assert result.topped_up == 0
    assert result.skipped == 0
