from __future__ import annotations

from base64 import b64encode
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import OAuthAccount, User
from proliferate.db.store.cloud_agent_auth import store
from tests.helpers.desktop_auth import mint_desktop_token_payload


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
    await db_session.flush()
    db_session.add(
        OAuthAccount(
            user_id=user.id,
            oauth_name="github",
            access_token="github-access-token",
            account_id=f"github-{user.id}",
            account_email=email,
        )
    )
    await db_session.commit()

    token_data = await mint_desktop_token_payload(
        client,
        user_id=user.id,
        state_prefix="agent-auth-state",
    )
    return {
        "user_id": str(user.id),
        "access_token": str(token_data["access_token"]),
    }


def _headers(tokens: dict[str, str]) -> dict[str, str]:
    return {"Authorization": f"Bearer {tokens['access_token']}"}


def _claude_file_payload(api_key: str) -> dict[str, object]:
    return {
        "authMode": "file",
        "files": [
            {
                "relativePath": ".claude.json",
                "contentBase64": b64encode(
                    f'{{"apiKey":"{api_key}"}}'.encode()
                ).decode("ascii"),
            }
        ],
    }


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
        "/v1/cloud/agent-auth/credentials/synced/claude",
        headers=_headers(tokens),
        json=_claude_file_payload("sk-ant-shared"),
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
    assert credential["status"] == "ready"
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
    profile_id = profile_response.json()["id"]

    select_response = await client.put(
        f"/v1/cloud/sandbox-profiles/{profile_id}/agent-auth-selections/claude",
        headers=_headers(tokens),
        json={"credentialId": credential["id"], "credentialShareId": share_id},
    )
    assert select_response.status_code == 200
    assert select_response.json()["credentialShareId"] == share_id

    revoke_response = await client.delete(
        f"/v1/cloud/agent-auth/credential-shares/{share_id}",
        headers=_headers(tokens),
    )
    assert revoke_response.status_code == 200

    selections_response = await client.get(
        f"/v1/cloud/sandbox-profiles/{profile_id}/agent-auth-selections",
        headers=_headers(tokens),
    )
    assert selections_response.status_code == 200
    selection = selections_response.json()[0]
    assert selection["status"] == "invalid"
    assert selection["lastErrorCode"] == "credential_share_revoked"


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
        "proliferate.server.cloud.agent_auth.service.settings.agent_gateway_byok_enabled",
        True,
    )
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings."
        "agent_gateway_anthropic_byok_enabled",
        True,
    )
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
