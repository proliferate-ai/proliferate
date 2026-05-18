from __future__ import annotations

import uuid
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.cloud_agent_auth import store
from proliferate.db.models.auth import OAuthAccount, User
from proliferate.utils.crypto import encrypt_text
from tests.e2e.cloud.helpers.github import seed_linked_github_account
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


async def _create_enrolled_target(
    client: AsyncClient,
    headers: dict[str, str],
    *,
    suffix: str,
) -> tuple[str, dict[str, str]]:
    create = await client.post(
        "/v1/cloud/targets/enrollments",
        headers=headers,
        json={
            "displayName": f"Agent Auth Target {suffix}",
            "kind": "ssh",
            "ownerScope": "personal",
            "defaultWorkspaceRoot": "~/proliferate-workspaces",
        },
    )
    assert create.status_code == 200
    enrollment = create.json()
    enrolled = await client.post(
        "/v1/cloud/worker/enroll",
        json={
            "enrollmentToken": enrollment["enrollmentToken"],
            "machineFingerprint": f"agent-auth-{suffix}-{uuid.uuid4()}",
            "hostname": f"agent-auth-{suffix}",
            "workerVersion": "0.1.0",
        },
    )
    assert enrolled.status_code == 200
    return enrollment["target"]["id"], {
        "Authorization": f"Bearer {enrolled.json()['workerToken']}"
    }


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
async def test_legacy_cloud_credential_update_reconciles_existing_selection(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    tokens = await _create_user_and_get_tokens(
        client,
        db_session,
        email="agent-auth-legacy-update@example.com",
    )

    response = await client.put(
        "/v1/cloud/credentials/claude",
        headers=_headers(tokens),
        json={
            "authMode": "env",
            "envVars": {"ANTHROPIC_API_KEY": "first-key"},
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

    response = await client.get(
        f"/v1/cloud/sandbox-profiles/{profile['id']}/agent-auth-selections",
        headers=_headers(tokens),
    )
    assert response.status_code == 200
    original_selection = response.json()[0]

    response = await client.put(
        "/v1/cloud/credentials/claude",
        headers=_headers(tokens),
        json={
            "authMode": "env",
            "envVars": {"ANTHROPIC_API_KEY": "second-key"},
        },
    )
    assert response.status_code == 200
    assert response.json()["changed"] is True

    response = await client.post(
        "/v1/cloud/sandbox-profiles/personal",
        headers=_headers(tokens),
        json={},
    )
    assert response.status_code == 200
    assert response.json()["agentAuthRevision"] == 2

    response = await client.get(
        f"/v1/cloud/sandbox-profiles/{profile['id']}/agent-auth-selections",
        headers=_headers(tokens),
    )
    assert response.status_code == 200
    updated_selection = response.json()[0]
    assert updated_selection["status"] == "active"
    assert updated_selection["agentKind"] == "claude"
    assert updated_selection["credentialId"] != original_selection["credentialId"]


@pytest.mark.asyncio
async def test_legacy_cloud_credential_delete_invalidates_existing_selection(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    tokens = await _create_user_and_get_tokens(
        client,
        db_session,
        email="agent-auth-legacy-delete@example.com",
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

    response = await client.delete("/v1/cloud/credentials/claude", headers=_headers(tokens))
    assert response.status_code == 200
    assert response.json()["changed"] is True

    response = await client.get(
        f"/v1/cloud/sandbox-profiles/{profile['id']}/agent-auth-selections",
        headers=_headers(tokens),
    )
    assert response.status_code == 200
    selection = response.json()[0]
    assert selection["status"] == "invalid"
    assert selection["lastErrorCode"] == "legacy_cloud_credential_revoked"


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
async def test_managed_credits_route_uses_server_entitlement_budget(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    tokens = await _create_user_and_get_tokens(
        client,
        db_session,
        email="agent-auth-managed-credits@example.com",
    )

    organizations = await client.get("/v1/organizations", headers=_headers(tokens))
    assert organizations.status_code == 200
    organization_id = organizations.json()["organizations"][0]["id"]

    response = await client.post(
        f"/v1/cloud/organizations/{organization_id}/agent-auth/managed-credits",
        headers=_headers(tokens),
        json={"includedBudgetUsd": "999999", "agentKinds": ["claude"]},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["budgetSubject"]["includedBudgetUsd"] != "999999"
    assert body["credentials"][0]["displayName"] == "Proliferate managed credits"
    assert body["credentials"][0]["status"] == "invalid"


@pytest.mark.asyncio
async def test_agent_auth_selection_queues_secret_safe_worker_materialization(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings.agent_gateway_public_base_url",
        "https://gateway.test",
    )
    tokens = await _create_user_and_get_tokens(
        client,
        db_session,
        email="agent-auth-worker-materialization@example.com",
    )
    await seed_linked_github_account(
        db_session,
        user_id=tokens["user_id"],
        access_token="gh-agent-auth-worker-token",
        account_email="agent-auth-worker@example.com",
    )
    target_id, worker_headers = await _create_enrolled_target(
        client,
        _headers(tokens),
        suffix="materialization",
    )

    actor_user_id = UUID(tokens["user_id"])
    credential = await store.create_agent_auth_credential(
        db_session,
        owner_scope="personal",
        owner_user_id=actor_user_id,
        organization_id=None,
        created_by_user_id=actor_user_id,
        agent_kind="claude",
        credential_kind="managed_gateway",
        display_name="Ready Claude gateway",
        redacted_summary_json='{"providerKind":"anthropic_api_key"}',
        status="ready",
    )
    await store.ensure_gateway_policy(
        db_session,
        credential_id=credential.id,
        policy_kind="personal_byok",
        owner_scope="personal",
        owner_user_id=actor_user_id,
        organization_id=None,
        budget_subject_id=None,
        litellm_team_id="team-agent-auth",
        litellm_virtual_key_id="key-agent-auth",
        litellm_virtual_key_ciphertext=encrypt_text("litellm-secret-key"),
        litellm_virtual_key_ciphertext_key_id="local",
        litellm_sync_status="synced",
        litellm_sync_fingerprint="fingerprint-agent-auth",
        status="ready",
        last_error_code=None,
        last_error_message=None,
    )
    await db_session.commit()

    profile_response = await client.post(
        "/v1/cloud/sandbox-profiles/personal",
        headers=_headers(tokens),
        json={"managedTargetId": target_id},
    )
    assert profile_response.status_code == 200
    profile = profile_response.json()

    select_response = await client.put(
        f"/v1/cloud/sandbox-profiles/{profile['id']}/agent-auth-selections/claude",
        headers=_headers(tokens),
        json={"credentialId": str(credential.id), "forceRestart": True},
    )
    assert select_response.status_code == 200

    lease = await client.post(
        "/v1/cloud/worker/commands/lease",
        headers=worker_headers,
        json={"supportedKinds": ["refresh_agent_auth_config"], "leaseTimeoutSeconds": 30},
    )
    assert lease.status_code == 200
    command = lease.json()["command"]
    assert command["kind"] == "refresh_agent_auth_config"
    assert command["payload"]["sandboxProfileId"] == profile["id"]
    assert command["payload"]["revision"] == 1
    assert command["payload"]["forceRestart"] is True
    assert "litellm-secret-key" not in str(command)

    materializing = await client.post(
        f"/v1/cloud/worker/agent-auth-configs/{profile['id']}/status",
        headers=worker_headers,
        json={
            "status": "materializing",
            "commandId": command["commandId"],
            "revision": command["payload"]["revision"],
            "leaseId": command["leaseId"],
        },
    )
    assert materializing.status_code == 200
    assert materializing.json()["status"] == "materializing"

    materialization = await client.get(
        f"/v1/cloud/worker/agent-auth-configs/{profile['id']}/materialization",
        headers=worker_headers,
        params={
            "command_id": command["commandId"],
            "revision": command["payload"]["revision"],
            "lease_id": command["leaseId"],
        },
    )
    assert materialization.status_code == 200
    plan = materialization.json()
    assert plan["applied"] is True
    assert plan["sandboxProfileId"] == profile["id"]
    selection = plan["selections"][0]
    assert selection["agentKind"] == "claude"
    assert selection["gateway"]["protocolFacade"] == "anthropic"
    assert selection["gateway"]["baseUrls"]["anthropic"] == "https://gateway.test/anthropic"
    token = selection["gateway"]["runtimeGrantToken"]
    assert token
    assert selection["gateway"]["protectedEnv"]["ANTHROPIC_BASE_URL"] == (
        "https://gateway.test/anthropic"
    )
    assert selection["gateway"]["protectedEnv"]["ANTHROPIC_CUSTOM_HEADERS"] == (
        f"Authorization: Bearer {token}"
    )

    applied = await client.post(
        f"/v1/cloud/worker/agent-auth-configs/{profile['id']}/status",
        headers=worker_headers,
        json={
            "status": "applied",
            "commandId": command["commandId"],
            "revision": command["payload"]["revision"],
            "leaseId": command["leaseId"],
        },
    )
    assert applied.status_code == 200
    assert applied.json()["status"] == "applied"
    assert applied.json()["appliedRevision"] == 1

    result = await client.post(
        f"/v1/cloud/worker/commands/{command['commandId']}/result",
        headers=worker_headers,
        json={
            "status": "accepted",
            "leaseId": command["leaseId"],
            "result": {
                "applied": True,
                "runtimeGrantToken": token,
                "protectedEnv": selection["gateway"]["protectedEnv"],
            },
        },
    )
    assert result.status_code == 200
    command_status = await client.get(
        f"/v1/cloud/commands/{command['commandId']}",
        headers=_headers(tokens),
    )
    assert command_status.status_code == 200
    assert command_status.json()["result"] is None
    assert token not in str(command_status.json())

    target_states = await client.get(
        f"/v1/cloud/sandbox-profiles/{profile['id']}/agent-auth-target-states",
        headers=_headers(tokens),
    )
    assert target_states.status_code == 200
    state = target_states.json()[0]
    assert state["desiredRevision"] == 1
    assert state["appliedRevision"] == 1
    assert state["status"] == "applied"
    assert state["forceRestartRequired"] is False
