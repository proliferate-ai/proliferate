from __future__ import annotations

import base64
import hashlib
import uuid
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import User
from proliferate.db.store.cloud_agent_auth import store


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
async def test_shared_personal_synced_credential_lists_active_share_for_org_selection(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    tokens = await _create_user_and_get_tokens(
        client,
        db_session,
        email="agent-auth-shared-synced@example.com",
    )

    organizations = await client.get("/v1/organizations", headers=_headers(tokens))
    assert organizations.status_code == 200
    organization_id = organizations.json()["organizations"][0]["id"]

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

    response = await client.get(
        "/v1/cloud/agent-auth/credentials",
        headers=_headers(tokens),
        params={"organizationId": organization_id, "agentKind": "claude"},
    )
    assert response.status_code == 200
    credential = next(
        record for record in response.json() if record["credentialKind"] == "synced_path"
    )
    assert credential["activeCredentialShareId"] is None

    share_response = await client.post(
        f"/v1/cloud/agent-auth/credentials/{credential['id']}/shares",
        headers=_headers(tokens),
        json={"organizationId": organization_id},
    )
    assert share_response.status_code == 200
    share_id = share_response.json()["id"]

    response = await client.get(
        "/v1/cloud/agent-auth/credentials",
        headers=_headers(tokens),
        params={"organizationId": organization_id, "agentKind": "claude"},
    )
    assert response.status_code == 200
    shared_credential = next(
        record for record in response.json() if record["id"] == credential["id"]
    )
    assert shared_credential["activeCredentialShareId"] == share_id

    profile_response = await client.post(
        f"/v1/cloud/organizations/{organization_id}/sandbox-profile",
        headers=_headers(tokens),
        json={},
    )
    assert profile_response.status_code == 200

    select_response = await client.put(
        "/v1/cloud/sandbox-profiles/"
        f"{profile_response.json()['id']}/agent-auth-selections/claude",
        headers=_headers(tokens),
        json={"credentialId": credential["id"], "credentialShareId": share_id},
    )
    assert select_response.status_code == 200
    assert select_response.json()["credentialShareId"] == share_id


@pytest.mark.asyncio
async def test_managed_credits_route_requires_server_entitlement_budget(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings."
        "agent_gateway_default_managed_budget_usd",
        "0",
    )
    tokens = await _create_user_and_get_tokens(
        client,
        db_session,
        email="agent-auth-managed-credits-not-entitled@example.com",
    )

    organizations = await client.get("/v1/organizations", headers=_headers(tokens))
    assert organizations.status_code == 200
    organization_id = organizations.json()["organizations"][0]["id"]

    response = await client.post(
        f"/v1/cloud/organizations/{organization_id}/agent-auth/managed-credits",
        headers=_headers(tokens),
        json={},
    )

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "managed_credits_not_entitled"


@pytest.mark.asyncio
async def test_managed_credits_do_not_reuse_org_byok_credential_with_same_name(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings."
        "agent_gateway_default_managed_budget_usd",
        "12.50",
    )
    tokens = await _create_user_and_get_tokens(
        client,
        db_session,
        email="agent-auth-managed-credits-display-collision@example.com",
    )

    organizations = await client.get("/v1/organizations", headers=_headers(tokens))
    assert organizations.status_code == 200
    organization_id = organizations.json()["organizations"][0]["id"]

    byok = await client.post(
        "/v1/cloud/agent-auth/credentials/gateway",
        headers=_headers(tokens),
        json={
            "ownerScope": "organization",
            "organizationId": organization_id,
            "agentKind": "claude",
            "displayName": "Proliferate managed credits",
            "policyKind": "org_byok",
            "providerKind": "anthropic_api_key",
            "payload": {"apiKey": "sk-ant-test"},
        },
    )
    assert byok.status_code == 200
    byok_credential_id = byok.json()["credential"]["id"]

    response = await client.post(
        f"/v1/cloud/organizations/{organization_id}/agent-auth/managed-credits",
        headers=_headers(tokens),
        json={},
    )
    assert response.status_code == 200
    managed_credential_id = response.json()["credentials"][0]["id"]
    assert managed_credential_id != byok_credential_id

    byok_policy = await store.get_gateway_policy_for_credential(
        db_session,
        UUID(byok_credential_id),
    )
    assert byok_policy is not None
    assert byok_policy.policy_kind == "org_byok"
