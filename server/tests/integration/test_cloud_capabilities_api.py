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
    monkeypatch.setattr(settings, "agent_gateway_anthropic_byok_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_default_managed_budget_usd", "12.50")
    auth = await create_user_and_login(
        client,
        db_session,
        email_prefix="cloud-capabilities",
    )

    response = await client.get("/v1/cloud/capabilities", headers=auth.headers)

    assert response.status_code == 200
    agent_gateway = response.json()["agentGateway"]
    assert agent_gateway["enabled"] is True
    assert agent_gateway["managedCreditsEnabled"] is True
    assert agent_gateway["defaultManagedBudgetUsd"] == "12.50"
    assert agent_gateway["byokEnabled"] is True
    assert agent_gateway["anthropicByokEnabled"] is True
