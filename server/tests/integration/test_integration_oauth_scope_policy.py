from __future__ import annotations

import uuid
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.integrations import accounts as accounts_store
from proliferate.db.store.integrations import definitions as definitions_store
from proliferate.integrations.integration_oauth import tokens as oauth_tokens
from proliferate.integrations.integration_oauth.models import (
    AuthorizationServerMetadata,
    ProtectedResourceMetadata,
    TokenResponse,
)
from proliferate.server.integration_gateway.connections.oauth import clients as oauth_clients
from proliferate.server.integration_gateway.connections.oauth import service as oauth_service
from proliferate.server.integration_gateway.connections.seeds import sync_seed_definitions
from proliferate.config import settings
from proliferate.lib.infra.encryption.json import decrypt_json
from tests.e2e.cloud.helpers.auth import create_user_and_login
from tests.e2e.cloud.helpers.github import seed_linked_github_account
from tests.e2e.cloud.helpers.shared import AuthSession

SLACK_SCOPES = (
    "search:read.public",
    "search:read.private",
    "search:read.im",
    "search:read.mpim",
    "search:read.files",
    "search:read.users",
)


async def _start_slack_flow(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    *,
    token_endpoint: str = "https://slack.com/api/oauth.v2.user.access",
) -> tuple[AuthSession, dict[str, object], str]:
    prefix = f"oauth-scope-{uuid.uuid4().hex}"
    auth = await create_user_and_login(client, db_session, email_prefix=prefix)
    await seed_linked_github_account(
        db_session,
        user_id=auth.user_id,
        access_token=f"gh-{prefix}",
    )
    await sync_seed_definitions(db_session)
    await db_session.commit()
    definition = await definitions_store.get_seed_by_namespace(db_session, "slack")
    assert definition is not None

    monkeypatch.setattr(oauth_clients.app_settings, "cloud_mcp_slack_enabled", True)
    monkeypatch.setattr(
        oauth_clients.app_settings,
        "cloud_mcp_slack_distribution_ready",
        True,
    )
    monkeypatch.setattr(oauth_clients.app_settings, "cloud_mcp_slack_client_id", "slack-client")
    monkeypatch.setattr(
        oauth_clients.app_settings,
        "cloud_mcp_slack_client_secret",
        "slack-client-secret",
    )
    monkeypatch.setattr(
        oauth_clients.app_settings,
        "cloud_mcp_slack_token_endpoint_auth_method",
        "client_secret_post",
    )

    async def _protected(_server_url: str) -> ProtectedResourceMetadata:
        return ProtectedResourceMetadata(
            authorization_servers=("https://slack.com",),
            resource="https://mcp.slack.com/mcp",
            challenged_scope=None,
        )

    async def _auth_metadata(issuer: str) -> AuthorizationServerMetadata:
        return AuthorizationServerMetadata(
            issuer=issuer,
            authorization_endpoint="https://slack.com/oauth/v2_user/authorize",
            token_endpoint=token_endpoint,
            registration_endpoint=None,
            token_endpoint_auth_methods_supported=("client_secret_post",),
        )

    monkeypatch.setattr(oauth_service, "discover_protected_resource_metadata", _protected)
    monkeypatch.setattr(oauth_service, "discover_authorization_server_metadata", _auth_metadata)

    response = await client.post(
        "/v1/cloud/integrations/authentications",
        headers=auth.headers,
        json={"definitionId": str(definition.id), "authKind": "oauth2"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["account"] is None
    state = parse_qs(urlsplit(body["authorizationUrl"]).query)["state"][0]
    return auth, body, state


async def _slack_account(db_session: AsyncSession, auth: AuthSession):
    definition = await definitions_store.get_seed_by_namespace(db_session, "slack")
    assert definition is not None
    return await accounts_store.get_account_for_user_definition(
        db_session,
        uuid.UUID(auth.user_id),
        definition.id,
    )


@pytest.mark.asyncio
async def test_slack_http_callback_persists_only_exact_scope_grant(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    auth, started, state = await _start_slack_flow(client, db_session, monkeypatch)

    async def _exchange_token(**_kwargs: object) -> TokenResponse:
        return TokenResponse(
            access_token="access-token",
            refresh_token="refresh-token",
            expires_at=None,
            scopes=tuple(reversed(SLACK_SCOPES)),
        )

    monkeypatch.setattr(oauth_service, "exchange_token", _exchange_token)

    callback = await client.get(
        "/v1/cloud/integrations/oauth/callback",
        params={"state": state, "code": "authorization-code"},
    )
    assert callback.status_code == 200

    flow = await client.get(
        f"/v1/cloud/integrations/oauth/flows/{started['oauthFlowId']}",
        headers=auth.headers,
    )
    assert flow.status_code == 200
    assert flow.json()["status"] == "completed"

    await db_session.rollback()
    account = await _slack_account(db_session, auth)
    assert account is not None
    assert account.status == "ready"
    assert account.credential_ciphertext is not None
    assert decrypt_json(account.credential_ciphertext, secret=settings.cloud_secret_key)[
        "scopes"
    ] == list(SLACK_SCOPES)


@pytest.mark.parametrize(
    "granted_scopes",
    [None, (), SLACK_SCOPES[:-1], (*SLACK_SCOPES, "chat:write")],
)
@pytest.mark.asyncio
async def test_slack_http_callback_rejects_invalid_scope_grant(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    granted_scopes: tuple[str, ...] | None,
) -> None:
    auth, started, state = await _start_slack_flow(client, db_session, monkeypatch)

    async def _exchange_token(**_kwargs: object) -> TokenResponse:
        return TokenResponse(
            access_token="access-token",
            refresh_token="refresh-token",
            expires_at=None,
            scopes=granted_scopes,
        )

    monkeypatch.setattr(oauth_service, "exchange_token", _exchange_token)

    callback = await client.get(
        "/v1/cloud/integrations/oauth/callback",
        params={"state": state, "code": "authorization-code"},
    )
    assert callback.status_code == 200

    flow = await client.get(
        f"/v1/cloud/integrations/oauth/flows/{started['oauthFlowId']}",
        headers=auth.headers,
    )
    assert flow.status_code == 200
    assert flow.json()["status"] == "failed"
    assert flow.json()["failureCode"] == "oauth_scope_mismatch"

    await db_session.rollback()
    account = await _slack_account(db_session, auth)
    assert account is None


@pytest.mark.asyncio
async def test_slack_http_callback_translates_2xx_error_without_persisting(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    auth, started, state = await _start_slack_flow(
        client,
        db_session,
        monkeypatch,
        token_endpoint="https://slack.com/api/oauth.v3.user.access",
    )
    async_client = httpx.AsyncClient
    transport = httpx.MockTransport(
        lambda _request: httpx.Response(
            200,
            json={
                "ok": False,
                "error": "invalid_code",
                "private": "must-not-leak",
            },
        )
    )
    monkeypatch.setattr(
        oauth_tokens.httpx,
        "AsyncClient",
        lambda **kwargs: async_client(transport=transport, **kwargs),
    )

    callback = await client.get(
        "/v1/cloud/integrations/oauth/callback",
        params={"state": state, "code": "authorization-code"},
    )

    assert callback.status_code == 200
    assert "invalid_code" not in callback.text
    assert "must-not-leak" not in callback.text
    flow = await client.get(
        f"/v1/cloud/integrations/oauth/flows/{started['oauthFlowId']}",
        headers=auth.headers,
    )
    assert flow.status_code == 200
    assert flow.json()["status"] == "failed"
    assert flow.json()["failureCode"] == "invalid_grant"

    await db_session.rollback()
    account = await _slack_account(db_session, auth)
    assert account is None
