from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlsplit

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.models.integrations import CloudIntegrationAccount
from proliferate.db.store.integrations import accounts as accounts_store
from proliferate.db.store.integrations import authorization_attempts as attempts_store
from proliferate.db.store.integrations import definitions as definitions_store
from proliferate.db.store.integrations.definition_security_revisions import (
    ensure_current_definition_security_revision,
)
from proliferate.integrations.integration_oauth.errors import IntegrationOAuthProviderError
from proliferate.integrations.integration_oauth.models import (
    AuthorizationServerMetadata,
    ProtectedResourceMetadata,
    RegisteredOAuthClient,
    TokenResponse,
)
from proliferate.lib.infra.encryption.json import decrypt_json, encrypt_json
from proliferate.server.integration_gateway.connections import service as integrations_service
from proliferate.server.integration_gateway.connections.oauth import clients as oauth_clients
from proliferate.server.integration_gateway.connections.oauth import service as oauth_service
from proliferate.server.integration_gateway.connections.seeds import sync_seed_definitions
from tests.helpers.auth_session import create_user_and_login
from tests.helpers.github_identity import seed_linked_github_account
from tests.helpers.auth_session import AuthSession


@pytest.mark.parametrize(
    ("current", "candidate", "matches"),
    [
        ('["scope.one","scope.two"]', '["scope.two","scope.one"]', True),
        ('["scope.one"]', '["scope.one","scope.two"]', False),
        (None, "[]", False),
        ("not-json", "[]", False),
    ],
)
def test_effective_scope_authority_comparison_ignores_order(
    current: str | None,
    candidate: str | None,
    matches: bool,
) -> None:
    assert attempts_store.effective_scope_authority_matches(current, candidate) is matches


async def _authed_user(
    client: AsyncClient,
    db_session: AsyncSession,
    *,
    prefix: str,
) -> AuthSession:
    auth = await create_user_and_login(client, db_session, email_prefix=prefix)
    await seed_linked_github_account(
        db_session,
        user_id=auth.user_id,
        access_token=f"gh-{prefix}",
    )
    await sync_seed_definitions(db_session)
    await db_session.commit()
    return auth


async def _definition(db_session: AsyncSession, namespace: str):
    definition = await definitions_store.get_seed_by_namespace(db_session, namespace)
    assert definition is not None
    return definition


def _mock_sentry_oauth(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _protected(_server_url: str) -> ProtectedResourceMetadata:
        return ProtectedResourceMetadata(
            authorization_servers=("https://auth.example.com",),
            resource="https://mcp.sentry.dev/mcp",
            challenged_scope=None,
        )

    async def _metadata(issuer: str) -> AuthorizationServerMetadata:
        return AuthorizationServerMetadata(
            issuer=issuer,
            authorization_endpoint="https://auth.example.com/authorize",
            token_endpoint="https://auth.example.com/token",
            registration_endpoint="https://auth.example.com/register",
            token_endpoint_auth_methods_supported=("none",),
        )

    async def _register(
        _metadata: AuthorizationServerMetadata,
        _redirect_uri: str,
    ) -> RegisteredOAuthClient:
        return RegisteredOAuthClient(
            client_id="client-revision-1",
            client_secret=None,
            client_secret_expires_at=None,
            token_endpoint_auth_method="none",
            registration_client_uri=None,
            registration_access_token=None,
        )

    monkeypatch.setattr(oauth_service, "discover_protected_resource_metadata", _protected)
    monkeypatch.setattr(oauth_service, "discover_authorization_server_metadata", _metadata)
    monkeypatch.setattr(oauth_clients, "discover_authorization_server_metadata", _metadata)
    monkeypatch.setattr(oauth_clients, "register_client", _register)


@pytest.mark.asyncio
async def test_api_key_validation_failure_leaves_no_account_and_destroys_candidate(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    auth = await _authed_user(client, db_session, prefix="lifecycle-key-failed-first")
    definition = await _definition(db_session, "context7")

    async def _reject_candidate(**_kwargs: object) -> list[dict[str, object]]:
        raise RuntimeError("private provider failure")

    monkeypatch.setattr(integrations_service, "list_remote_tools", _reject_candidate)
    response = await client.post(
        "/v1/cloud/integrations/authentications",
        headers=auth.headers,
        json={
            "definitionId": str(definition.id),
            "authKind": "api_key",
            "apiKey": "candidate-must-be-destroyed",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "integration_credential_validation_failed"
    assert "private provider failure" not in response.text
    await db_session.rollback()
    assert (
        await accounts_store.get_account_for_user_definition(
            db_session,
            uuid.UUID(auth.user_id),
            definition.id,
        )
        is None
    )
    attempt = await attempts_store.get_latest_authorization_attempt(
        db_session,
        owner_user_id=uuid.UUID(auth.user_id),
        definition_id=definition.id,
    )
    assert attempt is not None
    assert attempt.status == "failed"
    assert attempt.failure_code == "credential_validation_failed"
    assert attempt.staged_credential_ciphertext is None
    assert attempt.staged_credential_format is None
    assert attempt.closed_at is not None


@pytest.mark.asyncio
async def test_api_key_replacement_failure_preserves_committed_account_byte_for_byte(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    auth = await _authed_user(client, db_session, prefix="lifecycle-key-replacement")
    definition = await _definition(db_session, "context7")

    async def _accept_candidate(**_kwargs: object) -> list[dict[str, object]]:
        return []

    monkeypatch.setattr(integrations_service, "list_remote_tools", _accept_candidate)
    connected = await client.post(
        "/v1/cloud/integrations/authentications",
        headers=auth.headers,
        json={
            "definitionId": str(definition.id),
            "authKind": "api_key",
            "apiKey": "working-key",
        },
    )
    assert connected.status_code == 200, connected.text
    await db_session.rollback()
    before = await accounts_store.get_account_for_user_definition(
        db_session,
        uuid.UUID(auth.user_id),
        definition.id,
    )
    assert before is not None

    async def _reject_candidate(**_kwargs: object) -> list[dict[str, object]]:
        raise RuntimeError("replacement rejected")

    monkeypatch.setattr(integrations_service, "list_remote_tools", _reject_candidate)
    rejected = await client.post(
        "/v1/cloud/integrations/authentications",
        headers=auth.headers,
        json={
            "definitionId": str(definition.id),
            "authKind": "api_key",
            "apiKey": "bad-replacement-key",
        },
    )
    assert rejected.status_code == 400
    await db_session.rollback()
    db_session.expire_all()
    after = await accounts_store.get_account_for_user_definition(
        db_session,
        uuid.UUID(auth.user_id),
        definition.id,
    )
    assert after == before
    attempt = await attempts_store.get_latest_authorization_attempt(
        db_session,
        owner_user_id=uuid.UUID(auth.user_id),
        definition_id=definition.id,
    )
    assert attempt is not None
    assert attempt.purpose == "rotate"
    assert attempt.status == "failed"
    assert attempt.staged_credential_ciphertext is None


@pytest.mark.asyncio
async def test_new_oauth_generation_cancels_old_flow_and_only_winner_commits(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    auth = await _authed_user(client, db_session, prefix="lifecycle-oauth-generation")
    definition = await _definition(db_session, "sentry")
    _mock_sentry_oauth(monkeypatch)

    first = await client.post(
        "/v1/cloud/integrations/authentications",
        headers=auth.headers,
        json={"definitionId": str(definition.id), "authKind": "oauth2"},
    )
    second = await client.post(
        "/v1/cloud/integrations/authentications",
        headers=auth.headers,
        json={"definitionId": str(definition.id), "authKind": "oauth2"},
    )
    assert first.status_code == second.status_code == 200
    first_body = first.json()
    second_body = second.json()
    assert first_body["account"] is second_body["account"] is None
    assert first_body["attemptGeneration"] == 1
    assert second_body["attemptGeneration"] == 2

    first_state = parse_qs(urlsplit(first_body["authorizationUrl"]).query)["state"][0]
    second_state = parse_qs(urlsplit(second_body["authorizationUrl"]).query)["state"][0]
    late = await client.get(
        "/v1/cloud/integrations/oauth/callback",
        params={"state": first_state, "code": "late-code"},
    )
    assert late.status_code == 200
    assert "superseded" in late.text

    async def _exchange_token(**_kwargs: object) -> TokenResponse:
        return TokenResponse(
            access_token="winning-access-token",
            refresh_token="winning-refresh-token",
            expires_at=datetime.now(UTC) + timedelta(hours=1),
            scopes=(),
        )

    monkeypatch.setattr(oauth_service, "exchange_token", _exchange_token)
    winner = await client.get(
        "/v1/cloud/integrations/oauth/callback",
        params={"state": second_state, "code": "winning-code"},
    )
    assert winner.status_code == 200

    first_flow = await client.get(
        f"/v1/cloud/integrations/oauth/flows/{first_body['oauthFlowId']}",
        headers=auth.headers,
    )
    second_flow = await client.get(
        f"/v1/cloud/integrations/oauth/flows/{second_body['oauthFlowId']}",
        headers=auth.headers,
    )
    assert first_flow.json()["status"] == "cancelled"
    assert second_flow.json()["status"] == "completed"

    await db_session.rollback()
    old_attempt = await attempts_store.get_authorization_attempt(
        db_session,
        uuid.UUID(first_body["attemptId"]),
    )
    winning_attempt = await attempts_store.get_authorization_attempt(
        db_session,
        uuid.UUID(second_body["attemptId"]),
    )
    account = await accounts_store.get_account_for_user_definition(
        db_session,
        uuid.UUID(auth.user_id),
        definition.id,
    )
    assert old_attempt is not None and old_attempt.status == "superseded"
    assert old_attempt.staged_credential_ciphertext is None
    assert winning_attempt is not None and winning_attempt.status == "succeeded"
    assert winning_attempt.staged_credential_ciphertext is None
    assert account is not None
    assert (
        account.definition_security_revision_id == winning_attempt.definition_security_revision_id
    )
    assert account.provider_client_id == winning_attempt.provider_client_id
    assert account.credential_audience == winning_attempt.credential_audience
    assert account.effective_scopes_json == winning_attempt.effective_scopes_json == "[]"
    assert account.credential_ciphertext is not None
    assert (
        decrypt_json(account.credential_ciphertext, secret=settings.cloud_secret_key)[
            "accessToken"
        ]
        == "winning-access-token"
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("token_error", "expected_failure"),
    (
        (
            IntegrationOAuthProviderError("invalid_grant", "private provider detail"),
            "invalid_grant",
        ),
        (RuntimeError("private transport detail"), "token_request_failed"),
    ),
)
async def test_oauth_replacement_failure_preserves_committed_account_byte_for_byte(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    token_error: Exception,
    expected_failure: str,
) -> None:
    auth = await _authed_user(client, db_session, prefix="lifecycle-oauth-replacement")
    definition = await _definition(db_session, "sentry")
    _mock_sentry_oauth(monkeypatch)

    async def _initial_token(**_kwargs: object) -> TokenResponse:
        return TokenResponse(
            access_token="working-access-token",
            refresh_token="working-refresh-token",
            expires_at=datetime.now(UTC) + timedelta(hours=1),
            scopes=(),
        )

    monkeypatch.setattr(oauth_service, "exchange_token", _initial_token)
    initial = await client.post(
        "/v1/cloud/integrations/authentications",
        headers=auth.headers,
        json={"definitionId": str(definition.id), "authKind": "oauth2"},
    )
    assert initial.status_code == 200, initial.text
    initial_state = parse_qs(urlsplit(initial.json()["authorizationUrl"]).query)["state"][0]
    completed = await client.get(
        "/v1/cloud/integrations/oauth/callback",
        params={"state": initial_state, "code": "working-code"},
    )
    assert completed.status_code == 200
    await db_session.rollback()
    before = await accounts_store.get_account_for_user_definition(
        db_session,
        uuid.UUID(auth.user_id),
        definition.id,
    )
    assert before is not None

    replacement = await client.post(
        "/v1/cloud/integrations/authentications",
        headers=auth.headers,
        json={"definitionId": str(definition.id), "authKind": "oauth2"},
    )
    assert replacement.status_code == 200, replacement.text
    assert replacement.json()["account"]["accountId"] == str(before.id)
    replacement_state = parse_qs(urlsplit(replacement.json()["authorizationUrl"]).query)["state"][
        0
    ]

    async def _reject_token(**_kwargs: object) -> TokenResponse:
        raise token_error

    monkeypatch.setattr(oauth_service, "exchange_token", _reject_token)
    rejected = await client.get(
        "/v1/cloud/integrations/oauth/callback",
        params={"state": replacement_state, "code": "rejected-code"},
    )
    assert rejected.status_code == 200
    assert "private provider detail" not in rejected.text
    assert "private transport detail" not in rejected.text

    await db_session.rollback()
    db_session.expire_all()
    after = await accounts_store.get_account_for_user_definition(
        db_session,
        uuid.UUID(auth.user_id),
        definition.id,
    )
    assert after == before
    attempt = await attempts_store.get_latest_authorization_attempt(
        db_session,
        owner_user_id=uuid.UUID(auth.user_id),
        definition_id=definition.id,
    )
    assert attempt is not None
    assert attempt.purpose == "reauthorize"
    assert attempt.status == "failed"
    assert attempt.failure_code == expected_failure
    assert attempt.staged_credential_ciphertext is None


@pytest.mark.asyncio
async def test_commit_rejects_starting_version_mismatch_without_swapping_candidate(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    auth = await _authed_user(client, db_session, prefix="lifecycle-version-cas")
    definition = await _definition(db_session, "context7")

    async def _accept_candidate(**_kwargs: object) -> list[dict[str, object]]:
        return []

    monkeypatch.setattr(integrations_service, "list_remote_tools", _accept_candidate)
    connected = await client.post(
        "/v1/cloud/integrations/authentications",
        headers=auth.headers,
        json={
            "definitionId": str(definition.id),
            "authKind": "api_key",
            "apiKey": "original-key",
        },
    )
    assert connected.status_code == 200, connected.text
    await db_session.rollback()
    original = await accounts_store.get_account_for_user_definition(
        db_session,
        uuid.UUID(auth.user_id),
        definition.id,
    )
    assert original is not None
    revision = await ensure_current_definition_security_revision(db_session, definition.id)
    assert revision is not None
    attempt = await attempts_store.create_authorization_attempt(
        db_session,
        owner_user_id=uuid.UUID(auth.user_id),
        definition_id=definition.id,
        account_id=original.id,
        purpose="rotate",
        method="api_key",
        starting_grant_version=original.grant_version,
        starting_credential_version=original.credential_version,
        definition_security_revision_id=revision.id,
        provider_client_id=None,
        credential_audience=original.credential_audience or "https://mcp.context7.com/mcp",
        settings_json=original.settings_json,
        requested_scopes_json="[]",
        effective_scopes_json="[]",
        staged_credential_ciphertext=encrypt_json(
            {"secretFields": {"api_key": "stale-candidate"}},
            secret=settings.cloud_secret_key,
        ),
        staged_credential_format="secret-fields-v1",
        status="validating",
        expires_at=datetime.now(UTC) + timedelta(minutes=10),
    )
    await db_session.commit()

    row = await db_session.get(CloudIntegrationAccount, original.id)
    assert row is not None
    row.credential_version += 1
    await db_session.commit()

    assert (
        await attempts_store.commit_authorization_attempt(
            db_session,
            attempt_id=attempt.id,
            token_expires_at=None,
        )
        is None
    )
    await db_session.commit()
    rejected = await attempts_store.get_authorization_attempt(db_session, attempt.id)
    current = await accounts_store.get_account(db_session, original.id)
    assert rejected is not None
    assert rejected.status == "superseded"
    assert rejected.failure_code == "stale_connection"
    assert rejected.staged_credential_ciphertext is None
    assert current is not None
    assert current.credential_ciphertext == original.credential_ciphertext
    assert current.auth_version == original.auth_version
    assert current.grant_version == original.grant_version
    assert current.credential_version == original.credential_version + 1


@pytest.mark.asyncio
async def test_replacement_advances_credential_but_only_authority_change_advances_grant(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    auth = await _authed_user(client, db_session, prefix="lifecycle-version-separation")
    definition = await _definition(db_session, "context7")

    async def _accept_candidate(**_kwargs: object) -> list[dict[str, object]]:
        return []

    monkeypatch.setattr(integrations_service, "list_remote_tools", _accept_candidate)
    connected = await client.post(
        "/v1/cloud/integrations/authentications",
        headers=auth.headers,
        json={
            "definitionId": str(definition.id),
            "authKind": "api_key",
            "apiKey": "first-key",
        },
    )
    assert connected.status_code == 200, connected.text
    await db_session.rollback()
    initial = await accounts_store.get_account_for_user_definition(
        db_session,
        uuid.UUID(auth.user_id),
        definition.id,
    )
    assert initial is not None

    rotated = await client.post(
        "/v1/cloud/integrations/authentications",
        headers=auth.headers,
        json={
            "definitionId": str(definition.id),
            "authKind": "api_key",
            "apiKey": "rotated-key",
        },
    )
    assert rotated.status_code == 200, rotated.text
    await db_session.rollback()
    credential_only = await accounts_store.get_account(db_session, initial.id)
    assert credential_only is not None
    assert credential_only.auth_version == initial.auth_version + 1
    assert credential_only.grant_version == initial.grant_version
    assert credential_only.credential_version == initial.credential_version + 1

    revision = await ensure_current_definition_security_revision(db_session, definition.id)
    assert revision is not None
    authority_attempt = await attempts_store.create_authorization_attempt(
        db_session,
        owner_user_id=uuid.UUID(auth.user_id),
        definition_id=definition.id,
        account_id=credential_only.id,
        purpose="rotate",
        method="api_key",
        starting_grant_version=credential_only.grant_version,
        starting_credential_version=credential_only.credential_version,
        definition_security_revision_id=revision.id,
        provider_client_id=None,
        credential_audience=credential_only.credential_audience or "https://mcp.context7.com/mcp",
        settings_json='{"authorityMode":"changed"}',
        requested_scopes_json="[]",
        effective_scopes_json="[]",
        staged_credential_ciphertext=encrypt_json(
            {"secretFields": {"api_key": "authority-change-key"}},
            secret=settings.cloud_secret_key,
        ),
        staged_credential_format="secret-fields-v1",
        status="validating",
        expires_at=datetime.now(UTC) + timedelta(minutes=10),
    )
    committed = await attempts_store.commit_authorization_attempt(
        db_session,
        attempt_id=authority_attempt.id,
        token_expires_at=None,
    )
    await db_session.commit()

    assert committed is not None
    assert committed.auth_version == credential_only.auth_version + 1
    assert committed.grant_version == credential_only.grant_version + 1
    assert committed.credential_version == credential_only.credential_version + 1
