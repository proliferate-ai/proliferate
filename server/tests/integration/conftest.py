"""Shared fixtures for agent-gateway integration tests."""

from __future__ import annotations

import pytest

from proliferate.config import settings
from tests.integration.agent_gateway_topups_shared import StubLiteLLM, StubStripe


@pytest.fixture
def stub_litellm(monkeypatch: pytest.MonkeyPatch) -> StubLiteLLM:
    stub = StubLiteLLM()
    stub.install(monkeypatch)
    return stub


@pytest.fixture
def stub_stripe(monkeypatch: pytest.MonkeyPatch) -> StubStripe:
    stub = StubStripe()
    stub.install(monkeypatch)
    return stub


@pytest.fixture
def topup_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_llm_topup_price_id", "price_llm_topup")
    monkeypatch.setattr(settings, "agent_gateway_topup_threshold_usd", "2")
    monkeypatch.setattr(settings, "agent_gateway_topup_amount_usd", "10")
