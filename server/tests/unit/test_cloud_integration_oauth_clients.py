from __future__ import annotations

from types import SimpleNamespace
from typing import cast
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.integrations.definitions import IntegrationDefinitionRecord
from proliferate.integrations.integration_oauth import IntegrationOAuthProviderError
from proliferate.server.api_errors import CloudApiError
from proliferate.server.integration_gateway.connections.config import serialize_definition_config
from proliferate.server.integration_gateway.connections.oauth import clients
from proliferate.server.integration_gateway.connections.oauth import service as oauth_service
from proliferate.server.integration_gateway.connections.seeds import SEED_DEFINITIONS


def _definition(*, namespace: str = "slack", mode: str = "static") -> IntegrationDefinitionRecord:
    config = next(seed.config for seed in SEED_DEFINITIONS if seed.namespace == namespace)
    return cast(
        IntegrationDefinitionRecord,
        SimpleNamespace(
            namespace=namespace,
            oauth_client_mode=mode,
            auth_kind="oauth2",
            config_json=serialize_definition_config(config),
        ),
    )


def _configure_valid_slack(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(clients.app_settings, "cloud_mcp_slack_enabled", True)
    monkeypatch.setattr(clients.app_settings, "cloud_mcp_slack_distribution_ready", True)
    monkeypatch.setattr(clients.app_settings, "cloud_mcp_slack_client_id", "slack-client")
    monkeypatch.setattr(clients.app_settings, "cloud_mcp_slack_client_secret", "slack-secret")
    monkeypatch.setattr(
        clients.app_settings,
        "cloud_mcp_slack_token_endpoint_auth_method",
        "client_secret_post",
    )


@pytest.mark.parametrize(
    ("enabled", "distribution_ready"),
    [(False, False), (False, True), (True, False)],
)
def test_slack_start_requires_enabled_and_distribution_qualification(
    monkeypatch: pytest.MonkeyPatch,
    enabled: bool,
    distribution_ready: bool,
) -> None:
    _configure_valid_slack(monkeypatch)
    monkeypatch.setattr(clients.app_settings, "cloud_mcp_slack_enabled", enabled)
    monkeypatch.setattr(
        clients.app_settings,
        "cloud_mcp_slack_distribution_ready",
        distribution_ready,
    )

    with pytest.raises(IntegrationOAuthProviderError) as exc_info:
        clients.validate_oauth_provider_start_readiness(_definition())

    assert exc_info.value.code == "integration_provider_unavailable"


def test_qualified_slack_requires_complete_static_client_config(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_valid_slack(monkeypatch)
    monkeypatch.setattr(clients.app_settings, "cloud_mcp_slack_client_secret", "")

    with pytest.raises(IntegrationOAuthProviderError) as exc_info:
        clients.validate_oauth_provider_start_readiness(_definition())

    assert exc_info.value.code == "missing_static_oauth_client"


def test_qualified_slack_with_complete_config_is_ready(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_valid_slack(monkeypatch)

    clients.validate_oauth_provider_start_readiness(_definition())


def test_non_static_provider_does_not_use_slack_distribution_gate(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(clients.app_settings, "cloud_mcp_slack_enabled", False)
    monkeypatch.setattr(clients.app_settings, "cloud_mcp_slack_distribution_ready", False)

    clients.validate_oauth_provider_start_readiness(_definition(namespace="linear", mode="dcr"))


@pytest.mark.asyncio
async def test_unqualified_slack_start_fails_before_provider_discovery(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_valid_slack(monkeypatch)
    monkeypatch.setattr(clients.app_settings, "cloud_mcp_slack_distribution_ready", False)
    discovery_called = False

    async def _unexpected_discovery(_server_url: str) -> None:
        nonlocal discovery_called
        discovery_called = True
        raise AssertionError("provider discovery must not run")

    monkeypatch.setattr(
        oauth_service,
        "discover_protected_resource_metadata",
        _unexpected_discovery,
    )

    with pytest.raises(CloudApiError) as exc_info:
        await oauth_service.start_oauth_flow(
            cast(AsyncSession, object()),
            user_id=uuid4(),
            definition=_definition(),
            account_id=None,
            settings={},
        )

    assert exc_info.value.code == "integration_provider_unavailable"
    assert discovery_called is False
