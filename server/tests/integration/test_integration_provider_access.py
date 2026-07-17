from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import User
from proliferate.db.store.integrations import accounts as accounts_store
from proliferate.db.store.integrations import definitions as definitions_store
from proliferate.integrations.integration_oauth import tokens as oauth_tokens
from proliferate.integrations.integration_oauth.errors import IntegrationOAuthProviderError
from proliferate.integrations.integration_oauth.models import TokenResponse
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.integrations import access as integration_access
from proliferate.server.cloud.integrations.access import ensure_provider_access
from proliferate.server.cloud.integrations.config import (
    IntegrationConfig,
    StaticUrl,
    serialize_definition_config,
)
from proliferate.server.cloud.integrations.seeds import sync_seed_definitions
from proliferate.utils.crypto import decrypt_json, encrypt_json

SLACK_SCOPES = (
    "search:read.public",
    "search:read.private",
    "search:read.im",
    "search:read.mpim",
    "search:read.files",
    "search:read.users",
)


@pytest.mark.asyncio
async def test_sync_seed_definitions_is_idempotent(db_session: AsyncSession) -> None:
    first = await sync_seed_definitions(db_session)
    await db_session.commit()
    assert len(first) == 13

    second = await sync_seed_definitions(db_session)
    await db_session.commit()
    assert len(second) == 13

    seeds = await definitions_store.list_seed_definitions(db_session)
    namespaces = {d.namespace for d in seeds}
    assert {"linear", "context7", "exa"} <= namespaces


async def _account_for(
    db_session: AsyncSession,
    *,
    namespace: str,
    auth_kind: str,
    credential_ciphertext: str | None,
    credential_format: str,
):
    await sync_seed_definitions(db_session)
    await db_session.commit()
    definition = await definitions_store.get_seed_by_namespace(db_session, namespace)
    assert definition is not None
    # Accounts carry a real owner FK, so seed a user row for the fixture.
    user = User(email=f"{uuid.uuid4().hex}@access.test", hashed_password="unused")
    db_session.add(user)
    await db_session.flush()
    account = await accounts_store.upsert_account(
        db_session,
        user_id=user.id,
        definition_id=definition.id,
        auth_kind=auth_kind,
        status="ready",
    )
    if credential_ciphertext is not None:
        await accounts_store.set_account_credentials(
            db_session,
            account_id=account.id,
            credential_ciphertext=credential_ciphertext,
            credential_format=credential_format,
            auth_status="ready",
            token_expires_at=None,
        )
    await db_session.commit()
    account = await accounts_store.get_account(db_session, account.id)
    return definition, account


@pytest.mark.asyncio
async def test_api_key_access_renders_bearer_header(db_session: AsyncSession) -> None:
    definition, account = await _account_for(
        db_session,
        namespace="context7",
        auth_kind="api_key",
        credential_ciphertext=encrypt_json({"secretFields": {"api_key": "ctx7sk-secret"}}),
        credential_format="secret-fields-v1",
    )
    access = await ensure_provider_access(
        db_session, account_record=account, definition_record=definition
    )
    assert access.headers.get("Authorization") == "Bearer ctx7sk-secret"


@pytest.mark.asyncio
async def test_api_key_access_renders_query_param(db_session: AsyncSession) -> None:
    definition, account = await _account_for(
        db_session,
        namespace="exa",
        auth_kind="api_key",
        credential_ciphertext=encrypt_json({"secretFields": {"api_key": "exa-secret"}}),
        credential_format="secret-fields-v1",
    )
    access = await ensure_provider_access(
        db_session, account_record=account, definition_record=definition
    )
    assert access.query.get("exaApiKey") == "exa-secret"


@pytest.mark.asyncio
async def test_none_auth_access_is_empty(db_session: AsyncSession) -> None:
    # Create a test definition with auth_kind="none" since no seed has that anymore.
    test_config = IntegrationConfig(
        transport="http",
        url=StaticUrl("https://test.example.com/mcp"),
        display_url="https://test.example.com/mcp",
    )
    definition = await definitions_store.upsert_seed_definition(
        db_session,
        namespace="test_none_auth",
        display_name="Test None Auth",
        description="Test provider for none auth",
        auth_kind="none",
        oauth_client_mode=None,
        config_json=serialize_definition_config(test_config),
        enabled_by_default=True,
    )
    user = User(email=f"{uuid.uuid4().hex}@access.test", hashed_password="unused")
    db_session.add(user)
    await db_session.flush()
    account = await accounts_store.upsert_account(
        db_session,
        user_id=user.id,
        definition_id=definition.id,
        auth_kind="none",
        status="ready",
    )
    await db_session.commit()
    account = await accounts_store.get_account(db_session, account.id)

    access = await ensure_provider_access(
        db_session, account_record=account, definition_record=definition
    )
    assert access.headers == {} or "Authorization" not in access.headers


@pytest.mark.asyncio
async def test_oauth_access_uses_unexpired_access_token(db_session: AsyncSession) -> None:
    bundle = {
        "issuer": "https://auth.linear.app",
        "resource": "https://mcp.linear.app/mcp",
        "clientId": "client-123",
        "accessToken": "linear-access-token",
        "refreshToken": "linear-refresh-token",
        "expiresAt": None,  # no expiry => always valid
        "scopes": [],
        "tokenEndpoint": "https://auth.linear.app/oauth/token",
        "redirectUri": "https://api.example.com/v1/cloud/integrations/oauth/callback",
    }
    definition, account = await _account_for(
        db_session,
        namespace="linear",
        auth_kind="oauth2",
        credential_ciphertext=encrypt_json(bundle),
        credential_format="oauth-bundle-v1",
    )
    access = await ensure_provider_access(
        db_session, account_record=account, definition_record=definition
    )
    assert access.headers.get("Authorization") == "Bearer linear-access-token"


@pytest.mark.asyncio
async def test_slack_access_keeps_legacy_empty_scope_metadata_usable(
    db_session: AsyncSession,
) -> None:
    bundle = {
        "issuer": "https://slack.com",
        "resource": "https://mcp.slack.com/mcp",
        "clientId": "slack-client",
        "accessToken": "slack-access-token",
        "refreshToken": "slack-refresh-token",
        "expiresAt": None,
        "scopes": [],
        "tokenEndpoint": "https://slack.com/api/oauth.v2.user.access",
        "redirectUri": "https://api.example.com/v1/cloud/integrations/oauth/callback",
    }
    definition, account = await _account_for(
        db_session,
        namespace="slack",
        auth_kind="oauth2",
        credential_ciphertext=encrypt_json(bundle),
        credential_format="oauth-bundle-v1",
    )

    access = await ensure_provider_access(
        db_session, account_record=account, definition_record=definition
    )

    assert access.headers.get("Authorization") == "Bearer slack-access-token"


@pytest.mark.asyncio
async def test_slack_refresh_preserves_scopes_when_provider_omits_them(
    db_session: AsyncSession,
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bundle = {
        "issuer": "https://slack.com",
        "resource": "https://mcp.slack.com/mcp",
        "clientId": "slack-client",
        "accessToken": "expired-access-token",
        "refreshToken": "slack-refresh-token",
        "expiresAt": (datetime.now(UTC) - timedelta(minutes=5)).isoformat(),
        "scopes": list(SLACK_SCOPES),
        "tokenEndpoint": "https://slack.com/api/oauth.v2.user.access",
        "redirectUri": "https://api.example.com/v1/cloud/integrations/oauth/callback",
    }
    definition, account = await _account_for(
        db_session,
        namespace="slack",
        auth_kind="oauth2",
        credential_ciphertext=encrypt_json(bundle),
        credential_format="oauth-bundle-v1",
    )

    async def _refresh_token(**_kwargs: object) -> TokenResponse:
        return TokenResponse(
            access_token="replacement-access-token",
            refresh_token=None,
            expires_at=datetime.now(UTC) + timedelta(hours=1),
            scopes=None,
        )

    monkeypatch.setattr(integration_access, "refresh_token", _refresh_token)

    access = await ensure_provider_access(
        db_session, account_record=account, definition_record=definition
    )

    assert access.headers.get("Authorization") == "Bearer replacement-access-token"
    await db_session.rollback()
    refreshed = await accounts_store.get_account(db_session, account.id)
    assert refreshed is not None
    assert refreshed.credential_ciphertext is not None
    refreshed_bundle = decrypt_json(refreshed.credential_ciphertext)
    assert refreshed_bundle["scopes"] == list(SLACK_SCOPES)
    assert refreshed_bundle["accessToken"] == "replacement-access-token"


@pytest.mark.asyncio
async def test_slack_refresh_accepts_nonempty_scope_subset_below_ceiling(
    db_session: AsyncSession,
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bundle = {
        "issuer": "https://slack.com",
        "resource": "https://mcp.slack.com/mcp",
        "clientId": "slack-client",
        "accessToken": "expired-access-token",
        "refreshToken": "slack-refresh-token",
        "expiresAt": (datetime.now(UTC) - timedelta(minutes=5)).isoformat(),
        "scopes": list(SLACK_SCOPES),
        "tokenEndpoint": "https://slack.com/api/oauth.v2.user.access",
        "redirectUri": "https://api.example.com/v1/cloud/integrations/oauth/callback",
    }
    definition, account = await _account_for(
        db_session,
        namespace="slack",
        auth_kind="oauth2",
        credential_ciphertext=encrypt_json(bundle),
        credential_format="oauth-bundle-v1",
    )

    async def _refresh_token(**_kwargs: object) -> TokenResponse:
        return TokenResponse(
            access_token="subset-access-token",
            refresh_token=None,
            expires_at=datetime.now(UTC) + timedelta(hours=1),
            scopes=("search:read.private", "search:read.public"),
        )

    monkeypatch.setattr(integration_access, "refresh_token", _refresh_token)

    access = await ensure_provider_access(
        db_session, account_record=account, definition_record=definition
    )

    assert access.headers.get("Authorization") == "Bearer subset-access-token"
    await db_session.rollback()
    refreshed = await accounts_store.get_account(db_session, account.id)
    assert refreshed is not None
    assert refreshed.credential_ciphertext is not None
    refreshed_bundle = decrypt_json(refreshed.credential_ciphertext)
    assert refreshed_bundle["scopes"] == ["search:read.public", "search:read.private"]


@pytest.mark.asyncio
async def test_slack_refresh_rejects_reported_scope_above_ceiling_without_persisting(
    db_session: AsyncSession,
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bundle = {
        "issuer": "https://slack.com",
        "resource": "https://mcp.slack.com/mcp",
        "clientId": "slack-client",
        "accessToken": "expired-access-token",
        "refreshToken": "slack-refresh-token",
        "expiresAt": (datetime.now(UTC) - timedelta(minutes=5)).isoformat(),
        "scopes": list(SLACK_SCOPES),
        "tokenEndpoint": "https://slack.com/api/oauth.v2.user.access",
        "redirectUri": "https://api.example.com/v1/cloud/integrations/oauth/callback",
    }
    definition, account = await _account_for(
        db_session,
        namespace="slack",
        auth_kind="oauth2",
        credential_ciphertext=encrypt_json(bundle),
        credential_format="oauth-bundle-v1",
    )
    original_ciphertext = account.credential_ciphertext
    original_auth_version = account.auth_version

    async def _refresh_token(**_kwargs: object) -> TokenResponse:
        return TokenResponse(
            access_token="over-scoped-access-token",
            refresh_token="rotated-refresh-token",
            expires_at=datetime.now(UTC) + timedelta(hours=1),
            scopes=(*SLACK_SCOPES, "chat:write"),
        )

    monkeypatch.setattr(integration_access, "refresh_token", _refresh_token)

    with pytest.raises(CloudApiError) as exc_info:
        await ensure_provider_access(
            db_session, account_record=account, definition_record=definition
        )

    assert exc_info.value.code == "integration_reauth_required"
    await db_session.rollback()
    unchanged = await accounts_store.get_account(db_session, account.id)
    assert unchanged is not None
    assert unchanged.credential_ciphertext == original_ciphertext
    assert unchanged.auth_version == original_auth_version


@pytest.mark.asyncio
async def test_slack_refresh_translates_2xx_error_without_persisting(
    db_session: AsyncSession,
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bundle = {
        "issuer": "https://slack.com",
        "resource": "https://mcp.slack.com/mcp",
        "clientId": "slack-client",
        "accessToken": "expired-access-token",
        "refreshToken": "slack-refresh-token",
        "expiresAt": (datetime.now(UTC) - timedelta(minutes=5)).isoformat(),
        "scopes": list(SLACK_SCOPES),
        "tokenEndpoint": "https://slack.com/api/oauth.v2.user.access",
        "redirectUri": "https://api.example.com/v1/cloud/integrations/oauth/callback",
    }
    definition, account = await _account_for(
        db_session,
        namespace="slack",
        auth_kind="oauth2",
        credential_ciphertext=encrypt_json(bundle),
        credential_format="oauth-bundle-v1",
    )
    original_ciphertext = account.credential_ciphertext
    original_auth_version = account.auth_version
    async_client = httpx.AsyncClient
    transport = httpx.MockTransport(
        lambda _request: httpx.Response(
            200,
            json={
                "ok": False,
                "error": "invalid_refresh_token",
                "private": "must-not-leak",
            },
        )
    )
    monkeypatch.setattr(
        oauth_tokens.httpx,
        "AsyncClient",
        lambda **kwargs: async_client(transport=transport, **kwargs),
    )

    with pytest.raises(CloudApiError) as exc_info:
        await ensure_provider_access(
            db_session, account_record=account, definition_record=definition
        )

    assert exc_info.value.code == "integration_reauth_required"
    assert str(exc_info.value) == "Integration requires re-authentication."
    provider_error = exc_info.value.__cause__
    assert isinstance(provider_error, IntegrationOAuthProviderError)
    assert provider_error.code == "invalid_grant"
    assert "invalid_refresh_token" not in str(provider_error)
    assert "must-not-leak" not in str(provider_error)
    await db_session.rollback()
    unchanged = await accounts_store.get_account(db_session, account.id)
    assert unchanged is not None
    assert unchanged.credential_ciphertext == original_ciphertext
    assert unchanged.auth_version == original_auth_version


@pytest.mark.asyncio
async def test_slack_access_rejects_known_stored_scope_above_ceiling(
    db_session: AsyncSession,
) -> None:
    bundle = {
        "issuer": "https://slack.com",
        "resource": "https://mcp.slack.com/mcp",
        "clientId": "slack-client",
        "accessToken": "over-scoped-access-token",
        "refreshToken": "slack-refresh-token",
        "expiresAt": None,
        "scopes": [*SLACK_SCOPES, "chat:write"],
        "tokenEndpoint": "https://slack.com/api/oauth.v2.user.access",
        "redirectUri": "https://api.example.com/v1/cloud/integrations/oauth/callback",
    }
    definition, account = await _account_for(
        db_session,
        namespace="slack",
        auth_kind="oauth2",
        credential_ciphertext=encrypt_json(bundle),
        credential_format="oauth-bundle-v1",
    )

    with pytest.raises(CloudApiError) as exc_info:
        await ensure_provider_access(
            db_session, account_record=account, definition_record=definition
        )

    assert exc_info.value.code == "integration_reauth_required"


@pytest.mark.asyncio
async def test_sync_archives_removed_seeds_and_unarchives_restored_ones(
    db_session: AsyncSession,
) -> None:
    # Insert a fake seed definition simulating a previously-shipped seed.
    test_config = IntegrationConfig(
        transport="http",
        url=StaticUrl("https://test.example.com/mcp"),
        display_url="https://test.example.com/mcp",
    )
    fake_seed = await definitions_store.upsert_seed_definition(
        db_session,
        namespace="removed_test_seed",
        display_name="Removed Test Seed",
        description="Test seed that will be removed",
        auth_kind="none",
        oauth_client_mode=None,
        config_json=serialize_definition_config(test_config),
        enabled_by_default=True,
    )
    await db_session.commit()
    assert fake_seed.archived_at is None

    # Sync the actual seeds (which don't include removed_test_seed).
    await sync_seed_definitions(db_session)
    await db_session.commit()

    # Verify the fake seed was archived.
    archived_seed = await definitions_store.get_seed_by_namespace(db_session, "removed_test_seed")
    assert archived_seed is not None
    assert archived_seed.archived_at is not None

    # Verify actual seeds remain unarchived.
    current_seeds = await definitions_store.list_seed_definitions(db_session)
    assert len(current_seeds) == 13
    for seed in current_seeds:
        assert seed.archived_at is None

    # Re-add the fake seed via upsert and verify it gets unarchived.
    restored_seed = await definitions_store.upsert_seed_definition(
        db_session,
        namespace="removed_test_seed",
        display_name="Restored Test Seed",
        description="Test seed that was restored",
        auth_kind="none",
        oauth_client_mode=None,
        config_json=serialize_definition_config(test_config),
        enabled_by_default=True,
    )
    await db_session.commit()
    assert restored_seed.archived_at is None
