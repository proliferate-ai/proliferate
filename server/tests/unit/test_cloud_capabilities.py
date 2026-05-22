from __future__ import annotations

import pytest

from proliferate.server.cloud.capabilities import service


def test_cloud_capabilities_gate_gateway_byok(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(service.settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(service.settings, "agent_gateway_byok_enabled", True)
    monkeypatch.setattr(service.settings, "agent_gateway_anthropic_byok_enabled", True)
    monkeypatch.setattr(service.settings, "agent_gateway_openai_byok_enabled", False)
    monkeypatch.setattr(service.settings, "agent_gateway_bedrock_byok_enabled", True)
    monkeypatch.setattr(service.settings, "agent_gateway_openai_compatible_byok_enabled", True)
    monkeypatch.setattr(service.settings, "agent_gateway_opencode_enabled", False)
    monkeypatch.setattr(service.settings, "agent_gateway_default_managed_budget_usd", "12.50")

    capabilities = service.cloud_capabilities()

    assert capabilities.agent_gateway.enabled is True
    assert capabilities.agent_gateway.managed_credits_personal_enabled is True
    assert capabilities.agent_gateway.managed_credits_organization_enabled is True
    assert capabilities.agent_gateway.default_managed_budget_usd == "12.50"
    assert capabilities.agent_gateway.byok_enabled is True
    assert capabilities.agent_gateway.byok_providers.anthropic_api_key is True
    assert capabilities.agent_gateway.byok_providers.openai_api_key is False
    assert capabilities.agent_gateway.byok_providers.bedrock_assume_role is True
    assert capabilities.agent_gateway.byok_providers.openai_compatible is True
    assert capabilities.agent_gateway.opencode_gateway_enabled is False


def test_cloud_capabilities_fail_closed_when_gateway_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(service.settings, "agent_gateway_enabled", False)
    monkeypatch.setattr(service.settings, "agent_gateway_byok_enabled", True)
    monkeypatch.setattr(service.settings, "agent_gateway_anthropic_byok_enabled", True)

    capabilities = service.cloud_capabilities()

    assert capabilities.agent_gateway.enabled is False
    assert capabilities.agent_gateway.managed_credits_personal_enabled is False
    assert capabilities.agent_gateway.managed_credits_organization_enabled is False
    assert capabilities.agent_gateway.default_managed_budget_usd is None
    assert capabilities.agent_gateway.byok_enabled is False
    assert capabilities.agent_gateway.byok_providers.anthropic_api_key is False
