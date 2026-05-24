from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from tests.e2e.cloud.helpers.auth import create_user_and_login


@pytest.mark.asyncio
async def test_cloud_capabilities_requires_auth(client: AsyncClient) -> None:
    response = await client.get("/v1/cloud/capabilities")

    assert response.status_code in {401, 403}


@pytest.mark.asyncio
async def test_cloud_capabilities_response_shape(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_byok_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_litellm_topology", "enterprise_shared")
    monkeypatch.setattr(settings, "agent_gateway_litellm_customer_secret_isolation_verified", True)
    monkeypatch.setattr(settings, "agent_gateway_anthropic_byok_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_user_free_credit_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_user_free_credit_usd", "7.50")
    monkeypatch.setattr(settings, "agent_gateway_managed_budget_free_usd", "12.50")
    monkeypatch.setattr(settings, "agent_gateway_managed_budget_pro_usd", "0")
    monkeypatch.setattr(settings, "agent_gateway_managed_budget_unlimited_usd", "0")
    auth = await create_user_and_login(
        client,
        db_session,
        email_prefix="cloud-capabilities",
    )

    response = await client.get("/v1/cloud/capabilities", headers=auth.headers)

    assert response.status_code == 200
    agent_gateway = response.json()["agentGateway"]
    assert agent_gateway["enabled"] is True
    assert agent_gateway["managedCreditsPersonalEnabled"] is True
    assert agent_gateway["managedCreditsOrganizationEnabled"] is True
    assert agent_gateway["defaultManagedBudgetUsd"] == "12.50"
    assert agent_gateway["managedCreditAgentKinds"] == ["claude"]
    assert agent_gateway["routeIsolation"] == "enterprise_team_project"
    assert agent_gateway["liveProofStatus"] == "passed"
    assert agent_gateway["byokEnabled"] is True
    assert agent_gateway["byokOrganizationEnabled"] is True
    assert agent_gateway["byokProviders"]["anthropicApiKey"] is True
