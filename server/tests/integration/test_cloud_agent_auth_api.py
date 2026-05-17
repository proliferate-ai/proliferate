from __future__ import annotations

import base64
import hashlib
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import User


async def _create_user_and_get_tokens(
    client: AsyncClient,
    db_session: AsyncSession,
    *,
    email: str,
) -> dict[str, str]:
    user = User(
        email=email,
        hashed_password="unused-oauth-only",
        is_active=True,
        is_superuser=False,
        is_verified=True,
        display_name="Agent Auth Tester",
    )
    db_session.add(user)
    await db_session.commit()

    verifier = "test-code-verifier-that-is-long-enough-for-pkce"
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")

    response = await client.post(
        "/auth/desktop/authorize",
        params={"user_id": str(user.id)},
        json={
            "state": f"agent-auth-state-{uuid.uuid4().hex[:8]}",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "redirect_uri": "proliferate://auth/callback",
        },
    )
    assert response.status_code == 201

    response = await client.post(
        "/auth/desktop/token",
        json={
            "code": response.json()["code"],
            "code_verifier": verifier,
            "grant_type": "authorization_code",
        },
    )
    assert response.status_code == 200
    token_data = response.json()
    return {
        "user_id": str(user.id),
        "access_token": token_data["access_token"],
    }


def _headers(tokens: dict[str, str]) -> dict[str, str]:
    return {"Authorization": f"Bearer {tokens['access_token']}"}


@pytest.mark.asyncio
async def test_personal_profile_backfills_legacy_cloud_credentials(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    tokens = await _create_user_and_get_tokens(
        client,
        db_session,
        email="agent-auth-backfill@example.com",
    )

    response = await client.put(
        "/v1/cloud/credentials/claude",
        headers=_headers(tokens),
        json={
            "authMode": "env",
            "envVars": {"ANTHROPIC_API_KEY": "test-anthropic-key"},
        },
    )
    assert response.status_code == 200

    response = await client.post(
        "/v1/cloud/sandbox-profiles/personal",
        headers=_headers(tokens),
        json={},
    )
    assert response.status_code == 200
    profile = response.json()
    assert profile["ownerScope"] == "personal"
    assert profile["agentAuthRevision"] == 1

    response = await client.get(
        f"/v1/cloud/sandbox-profiles/{profile['id']}/agent-auth-selections",
        headers=_headers(tokens),
    )
    assert response.status_code == 200
    selections = response.json()
    assert selections[0]["agentKind"] == "claude"
    assert selections[0]["materializationMode"] == "synced_files"


@pytest.mark.asyncio
async def test_gateway_credential_fails_closed_without_live_provider_validation(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    tokens = await _create_user_and_get_tokens(
        client,
        db_session,
        email="agent-auth-gateway@example.com",
    )

    response = await client.post(
        "/v1/cloud/agent-auth/credentials/gateway",
        headers=_headers(tokens),
        json={
            "ownerScope": "personal",
            "agentKind": "claude",
            "displayName": "Personal Anthropic gateway",
            "policyKind": "personal_byok",
            "providerKind": "anthropic_api_key",
            "payload": {"apiKey": "sk-ant-test"},
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["credential"]["status"] == "invalid"
    assert body["policy"]["litellmSyncStatus"] == "failed"
    assert body["policy"]["lastErrorCode"] == "provider_live_validation_deferred"
    assert body["providerCredential"]["validationStatus"] == "unvalidated"
    assert body["providerCredential"]["redactedSummary"]["apiKey"] == "sk-a...test"


@pytest.mark.asyncio
async def test_invalid_gateway_credential_cannot_be_selected(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    tokens = await _create_user_and_get_tokens(
        client,
        db_session,
        email="agent-auth-select-invalid@example.com",
    )

    credential_response = await client.post(
        "/v1/cloud/agent-auth/credentials/gateway",
        headers=_headers(tokens),
        json={
            "ownerScope": "personal",
            "agentKind": "claude",
            "displayName": "Invalid Anthropic gateway",
            "policyKind": "personal_byok",
            "providerKind": "anthropic_api_key",
            "payload": {"apiKey": "sk-ant-test"},
        },
    )
    assert credential_response.status_code == 200
    credential_id = credential_response.json()["credential"]["id"]

    profile_response = await client.post(
        "/v1/cloud/sandbox-profiles/personal",
        headers=_headers(tokens),
        json={},
    )
    assert profile_response.status_code == 200
    profile_id = profile_response.json()["id"]

    select_response = await client.put(
        f"/v1/cloud/sandbox-profiles/{profile_id}/agent-auth-selections/claude",
        headers=_headers(tokens),
        json={"credentialId": credential_id},
    )
    assert select_response.status_code == 409
    assert select_response.json()["detail"]["code"] == "credential_not_ready"


@pytest.mark.asyncio
async def test_gateway_policy_kind_must_match_owner_scope(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    tokens = await _create_user_and_get_tokens(
        client,
        db_session,
        email="agent-auth-policy-scope@example.com",
    )

    response = await client.post(
        "/v1/cloud/agent-auth/credentials/gateway",
        headers=_headers(tokens),
        json={
            "ownerScope": "personal",
            "agentKind": "claude",
            "displayName": "Wrong policy scope",
            "policyKind": "org_byok",
            "providerKind": "anthropic_api_key",
            "payload": {"apiKey": "sk-ant-test"},
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "policy_owner_scope_mismatch"


@pytest.mark.asyncio
async def test_managed_credits_route_is_not_customer_accessible(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    tokens = await _create_user_and_get_tokens(
        client,
        db_session,
        email="agent-auth-managed-credits@example.com",
    )

    response = await client.post(
        f"/v1/cloud/agent-auth/managed-credits/organizations/{uuid.uuid4()}",
        headers=_headers(tokens),
        json={"includedBudgetUsd": "999999"},
    )

    assert response.status_code == 404
