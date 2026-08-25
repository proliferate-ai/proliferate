from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.store.integrations import accounts as accounts_store
from proliferate.integrations.integration_oauth.models import TokenResponse
from proliferate.lib.infra.encryption.json import decrypt_json, encrypt_json
from proliferate.server.api_errors import CloudApiError
from proliferate.server.integration_gateway.connections import access as integration_access
from proliferate.server.integration_gateway.connections.access import ensure_provider_access
from tests.integration.test_integration_provider_access import SLACK_SCOPES, _account_for


@pytest.mark.asyncio
async def test_slack_refresh_scope_narrowing_advances_grant_then_requires_readmission(
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
        credential_ciphertext=encrypt_json(bundle, secret=settings.cloud_secret_key),
        credential_format="oauth-bundle-v1",
    )
    original_auth_version = account.auth_version
    original_grant_version = account.grant_version
    original_credential_version = account.credential_version

    async def _refresh_token(**_kwargs: object) -> TokenResponse:
        return TokenResponse(
            access_token="subset-access-token",
            refresh_token=None,
            expires_at=datetime.now(UTC) + timedelta(hours=1),
            scopes=("search:read.private", "search:read.public"),
        )

    monkeypatch.setattr(integration_access, "refresh_token", _refresh_token)

    with pytest.raises(CloudApiError) as exc_info:
        await ensure_provider_access(
            db_session,
            account_record=account,
            definition_record=definition,
        )

    assert exc_info.value.code == "integration_grant_changed"
    await db_session.rollback()
    refreshed = await accounts_store.get_account(db_session, account.id)
    assert refreshed is not None
    assert refreshed.credential_ciphertext is not None
    refreshed_bundle = decrypt_json(
        refreshed.credential_ciphertext,
        secret=settings.cloud_secret_key,
    )
    assert refreshed_bundle["scopes"] == ["search:read.public", "search:read.private"]
    assert refreshed.auth_version == original_auth_version + 1
    assert refreshed.grant_version == original_grant_version + 1
    assert refreshed.credential_version == original_credential_version + 1

    retried = await ensure_provider_access(
        db_session,
        account_record=refreshed,
        definition_record=definition,
    )
    assert retried.headers.get("Authorization") == "Bearer subset-access-token"


@pytest.mark.asyncio
async def test_concurrent_oauth_refresh_loser_reuses_exact_committed_winner(
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
        credential_ciphertext=encrypt_json(bundle, secret=settings.cloud_secret_key),
        credential_format="oauth-bundle-v1",
    )
    both_refreshing = asyncio.Event()
    refresh_count = 0

    async def _refresh_token(**_kwargs: object) -> TokenResponse:
        nonlocal refresh_count
        refresh_count += 1
        sequence = refresh_count
        if refresh_count == 2:
            both_refreshing.set()
        await asyncio.wait_for(both_refreshing.wait(), timeout=5)
        return TokenResponse(
            access_token=f"candidate-access-token-{sequence}",
            refresh_token=None,
            expires_at=datetime.now(UTC) + timedelta(hours=1),
            scopes=None,
        )

    monkeypatch.setattr(integration_access, "refresh_token", _refresh_token)

    first, second = await asyncio.gather(
        ensure_provider_access(
            db_session,
            account_record=account,
            definition_record=definition,
        ),
        ensure_provider_access(
            db_session,
            account_record=account,
            definition_record=definition,
        ),
    )

    assert first.headers["Authorization"] == second.headers["Authorization"]
    assert refresh_count == 2
    await db_session.rollback()
    winner = await accounts_store.get_account(db_session, account.id)
    assert winner is not None
    assert winner.grant_version == account.grant_version
    assert winner.credential_version == account.credential_version + 1
    assert winner.credential_ciphertext is not None
    winner_token = decrypt_json(
        winner.credential_ciphertext,
        secret=settings.cloud_secret_key,
    )["accessToken"]
    assert first.headers["Authorization"] == f"Bearer {winner_token}"


@pytest.mark.asyncio
async def test_oauth_refresh_cannot_persist_after_account_cutoff(
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
        credential_ciphertext=encrypt_json(bundle, secret=settings.cloud_secret_key),
        credential_format="oauth-bundle-v1",
    )

    async def _refresh_token(**_kwargs: object) -> TokenResponse:
        from proliferate.db import session_ops

        async with session_ops.open_async_session() as cutoff_db:
            await accounts_store.delete_account(cutoff_db, account.id)
            await session_ops.commit_session(cutoff_db)
        return TokenResponse(
            access_token="must-not-persist",
            refresh_token="must-not-persist-refresh",
            expires_at=datetime.now(UTC) + timedelta(hours=1),
            scopes=None,
        )

    monkeypatch.setattr(integration_access, "refresh_token", _refresh_token)

    with pytest.raises(CloudApiError) as exc_info:
        await ensure_provider_access(
            db_session,
            account_record=account,
            definition_record=definition,
        )

    assert exc_info.value.code == "integration_reauth_required"
    await db_session.rollback()
    assert await accounts_store.get_account(db_session, account.id) is None


@pytest.mark.asyncio
async def test_provider_policy_refresh_rejects_scope_expansion_without_persisting(
    db_session: AsyncSession,
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bundle = {
        "issuer": "https://auth.linear.app",
        "resource": "https://mcp.linear.app/mcp",
        "clientId": "linear-client",
        "accessToken": "expired-access-token",
        "refreshToken": "linear-refresh-token",
        "expiresAt": (datetime.now(UTC) - timedelta(minutes=5)).isoformat(),
        "scopes": ["issues:read"],
        "tokenEndpoint": "https://auth.linear.app/oauth/token",
        "redirectUri": "https://api.example.com/v1/cloud/integrations/oauth/callback",
    }
    definition, account = await _account_for(
        db_session,
        namespace="linear",
        auth_kind="oauth2",
        credential_ciphertext=encrypt_json(bundle, secret=settings.cloud_secret_key),
        credential_format="oauth-bundle-v1",
    )

    async def _refresh_token(**_kwargs: object) -> TokenResponse:
        return TokenResponse(
            access_token="expanded-access-token",
            refresh_token="expanded-refresh-token",
            expires_at=datetime.now(UTC) + timedelta(hours=1),
            scopes=("issues:read", "issues:write"),
        )

    monkeypatch.setattr(integration_access, "refresh_token", _refresh_token)

    with pytest.raises(CloudApiError) as exc_info:
        await ensure_provider_access(
            db_session,
            account_record=account,
            definition_record=definition,
        )

    assert exc_info.value.code == "integration_reauth_required"
    await db_session.rollback()
    unchanged = await accounts_store.get_account(db_session, account.id)
    assert unchanged is not None
    assert unchanged.credential_ciphertext == account.credential_ciphertext
    assert unchanged.grant_version == account.grant_version
    assert unchanged.credential_version == account.credential_version


@pytest.mark.asyncio
async def test_provider_scope_reordering_rotates_credential_without_grant_churn(
    db_session: AsyncSession,
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bundle = {
        "issuer": "https://auth.linear.app",
        "resource": "https://mcp.linear.app/mcp",
        "clientId": "linear-client",
        "accessToken": "expired-access-token",
        "refreshToken": "linear-refresh-token",
        "expiresAt": (datetime.now(UTC) - timedelta(minutes=5)).isoformat(),
        "scopes": ["issues:read", "comments:read"],
        "tokenEndpoint": "https://auth.linear.app/oauth/token",
        "redirectUri": "https://api.example.com/v1/cloud/integrations/oauth/callback",
    }
    definition, account = await _account_for(
        db_session,
        namespace="linear",
        auth_kind="oauth2",
        credential_ciphertext=encrypt_json(bundle, secret=settings.cloud_secret_key),
        credential_format="oauth-bundle-v1",
    )

    async def _refresh_token(**_kwargs: object) -> TokenResponse:
        return TokenResponse(
            access_token="reordered-access-token",
            refresh_token=None,
            expires_at=datetime.now(UTC) + timedelta(hours=1),
            scopes=("comments:read", "issues:read"),
        )

    monkeypatch.setattr(integration_access, "refresh_token", _refresh_token)

    access = await ensure_provider_access(
        db_session,
        account_record=account,
        definition_record=definition,
    )

    assert access.headers["Authorization"] == "Bearer reordered-access-token"
    await db_session.rollback()
    refreshed = await accounts_store.get_account(db_session, account.id)
    assert refreshed is not None and refreshed.credential_ciphertext is not None
    assert refreshed.grant_version == account.grant_version
    assert refreshed.credential_version == account.credential_version + 1
    refreshed_bundle = decrypt_json(
        refreshed.credential_ciphertext,
        secret=settings.cloud_secret_key,
    )
    assert refreshed_bundle["scopes"] == ["issues:read", "comments:read"]
