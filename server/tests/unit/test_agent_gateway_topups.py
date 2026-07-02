"""Pure-logic tests for the LLM top-up worker (thresholds, gating, settings)."""

from __future__ import annotations

from decimal import Decimal

import pytest

from proliferate.config import settings
from proliferate.server.cloud.agent_gateway.topups import (
    run_llm_topups,
    topup_amount_usd,
    topup_threshold_usd,
    topups_enabled,
)


class TestTopupSettings:
    def test_disabled_when_price_id_empty(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "agent_gateway_llm_topup_price_id", "")
        assert topups_enabled() is False

    def test_enabled_when_price_id_set(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "agent_gateway_llm_topup_price_id", "price_llm_topup")
        monkeypatch.setattr(settings, "agent_gateway_topup_amount_usd", "10")
        assert topups_enabled() is True

    def test_disabled_when_amount_nonpositive(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # A price is set but the amount is 0 — top-ups can't fund anyone, so the
        # feature must read as disabled (importer keeps enforcing, fail safe).
        monkeypatch.setattr(settings, "agent_gateway_llm_topup_price_id", "price_llm_topup")
        monkeypatch.setattr(settings, "agent_gateway_topup_amount_usd", "0")
        assert topups_enabled() is False

    def test_disabled_when_amount_unparsable(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "agent_gateway_llm_topup_price_id", "price_llm_topup")
        monkeypatch.setattr(settings, "agent_gateway_topup_amount_usd", "not-a-number")
        assert topups_enabled() is False

    def test_threshold_parses_decimal(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "agent_gateway_topup_threshold_usd", "2.50")
        assert topup_threshold_usd() == Decimal("2.50")

    def test_threshold_garbage_falls_back_to_zero(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "agent_gateway_topup_threshold_usd", "not-a-number")
        assert topup_threshold_usd() == Decimal("0")

    def test_amount_parses_decimal(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "agent_gateway_topup_amount_usd", "10")
        assert topup_amount_usd() == Decimal("10")

    def test_amount_garbage_falls_back_to_zero(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "agent_gateway_topup_amount_usd", "")
        assert topup_amount_usd() == Decimal("0")


class TestRunGating:
    """run_llm_topups returns an empty result before touching the database
    when the feature is off, so a sentinel that explodes on use proves the
    early exits."""

    @pytest.mark.asyncio
    async def test_noop_when_gateway_disabled(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "agent_gateway_enabled", False)
        monkeypatch.setattr(settings, "agent_gateway_llm_topup_price_id", "price_x")
        result = await run_llm_topups(object())  # type: ignore[arg-type]
        assert result.scanned == 0
        assert result.topped_up == 0

    @pytest.mark.asyncio
    async def test_noop_when_price_id_missing(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "agent_gateway_enabled", True)
        monkeypatch.setattr(settings, "agent_gateway_llm_topup_price_id", "")
        result = await run_llm_topups(object())  # type: ignore[arg-type]
        assert result.scanned == 0
        assert result.topped_up == 0

    @pytest.mark.asyncio
    async def test_noop_when_amount_nonpositive(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "agent_gateway_enabled", True)
        monkeypatch.setattr(settings, "agent_gateway_llm_topup_price_id", "price_x")
        monkeypatch.setattr(settings, "agent_gateway_topup_amount_usd", "0")
        result = await run_llm_topups(object())  # type: ignore[arg-type]
        assert result.scanned == 0
        assert result.topped_up == 0
