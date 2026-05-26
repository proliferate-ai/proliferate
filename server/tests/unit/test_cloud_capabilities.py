from __future__ import annotations

import pytest

from proliferate.server.cloud.capabilities import service


def test_cloud_capabilities_gate_gateway_byok(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(service.settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(service.settings, "agent_gateway_byok_enabled", True)
    monkeypatch.setattr(service.settings, "agent_gateway_litellm_topology", "enterprise_shared")
    monkeypatch.setattr(
        service.settings,
        "agent_gateway_litellm_customer_secret_isolation_verified",
        True,
    )
    monkeypatch.setattr(service.settings, "agent_gateway_anthropic_byok_enabled", True)
    monkeypatch.setattr(service.settings, "agent_gateway_openai_byok_enabled", False)
    monkeypatch.setattr(service.settings, "agent_gateway_bedrock_byok_enabled", True)
    monkeypatch.setattr(service.settings, "agent_gateway_gemini_byok_enabled", True)
    monkeypatch.setattr(service.settings, "agent_gateway_openai_compatible_byok_enabled", True)
    monkeypatch.setattr(service.settings, "agent_gateway_opencode_enabled", False)
    monkeypatch.setattr(service.settings, "agent_gateway_user_free_credit_enabled", True)
    monkeypatch.setattr(service.settings, "agent_gateway_user_free_credit_usd", "7.50")
    monkeypatch.setattr(service.settings, "agent_gateway_managed_budget_free_usd", "12.50")
    monkeypatch.setattr(service.settings, "agent_gateway_managed_budget_pro_usd", "0")
    monkeypatch.setattr(service.settings, "agent_gateway_managed_budget_unlimited_usd", "0")

    capabilities = service.cloud_capabilities()

    assert capabilities.agent_gateway.enabled is True
    assert capabilities.agent_gateway.managed_credits_personal_enabled is True
    assert capabilities.agent_gateway.managed_credits_organization_enabled is True
    assert capabilities.agent_gateway.default_managed_budget_usd == "12.50"
    assert capabilities.agent_gateway.managed_credit_agent_kinds == ["claude"]
    assert capabilities.agent_gateway.route_isolation == "enterprise_team_project"
    assert capabilities.agent_gateway.live_proof_status == "passed"
    assert capabilities.agent_gateway.byok_enabled is True
    assert capabilities.agent_gateway.byok_organization_enabled is True
    assert capabilities.agent_gateway.byok_personal_enabled is False
    assert capabilities.agent_gateway.byok_providers.anthropic_api_key is True
    assert capabilities.agent_gateway.byok_providers.openai_api_key is False
    assert capabilities.agent_gateway.byok_providers.bedrock_assume_role is True
    assert capabilities.agent_gateway.byok_providers.gemini_api_key is False
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
    assert capabilities.agent_gateway.byok_organization_enabled is False
    assert capabilities.agent_gateway.byok_providers.anthropic_api_key is False


def test_cloud_capabilities_exposes_gemini_byok_only_for_bifrost(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(service.settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(service.settings, "agent_gateway_router", "bifrost")
    monkeypatch.setattr(service.settings, "agent_gateway_byok_enabled", True)
    monkeypatch.setattr(service.settings, "agent_gateway_bifrost_isolation_verified", True)
    monkeypatch.setattr(service.settings, "agent_gateway_gemini_byok_enabled", True)

    capabilities = service.cloud_capabilities()

    assert capabilities.agent_gateway.route_isolation == "bifrost_virtual_key"
    assert capabilities.agent_gateway.live_proof_status == "passed"
    assert capabilities.agent_gateway.byok_providers.gemini_api_key is True


def test_cloud_capabilities_hide_openai_compatible_for_bifrost(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(service.settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(service.settings, "agent_gateway_router", "bifrost")
    monkeypatch.setattr(service.settings, "agent_gateway_byok_enabled", True)
    monkeypatch.setattr(service.settings, "agent_gateway_bifrost_isolation_verified", True)
    monkeypatch.setattr(service.settings, "agent_gateway_openai_compatible_byok_enabled", True)

    capabilities = service.cloud_capabilities()

    assert capabilities.agent_gateway.byok_providers.openai_compatible is False
