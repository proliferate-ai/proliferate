from __future__ import annotations

import uuid
from base64 import b64encode
from types import SimpleNamespace
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import CLOUD_WORKER_TOKEN_DOMAIN
from proliferate.db.models.auth import OAuthAccount, User
from proliferate.db.store.cloud_agent_auth import store
from proliferate.db.store.cloud_sandboxes import ensure_profile_slot
from proliferate.db.store.cloud_sync import worker_auth as worker_auth_store
from proliferate.server.cloud.agent_auth import service as agent_auth_service
from proliferate.server.cloud.worker import service as worker_service
from proliferate.utils.crypto import decrypt_text, encrypt_json, encrypt_text
from proliferate.utils.time import utcnow
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
                "contentBase64": b64encode(f'{{"apiKey":"{api_key}"}}'.encode()).decode("ascii"),
            }
        ],
    }


def _enable_anthropic_gateway_byok(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings.agent_gateway_byok_enabled",
        True,
    )
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings."
        "agent_gateway_anthropic_byok_enabled",
        True,
    )


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
async def test_synced_credential_sync_creates_personal_profile_selection(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    tokens = await _create_user_and_get_tokens(
        client,
        db_session,
        email="agent-auth-sync-profile@example.com",
    )

    response = await client.put(
        "/v1/cloud/agent-auth/credentials/synced/claude",
        headers=_headers(tokens),
        json=_claude_file_payload("sk-ant-test"),
    )
    assert response.status_code == 200
    sync_result = response.json()
    assert sync_result["changed"] is True
    assert sync_result["credential"]["credentialKind"] == "synced_path"
    assert sync_result["credential"]["status"] == "ready"
    assert sync_result["selection"]["materializationMode"] == "synced_files"

    response = await client.post(
        "/v1/cloud/sandbox-profiles/personal",
        headers=_headers(tokens),
        json={},
    )
    assert response.status_code == 200
    profile = response.json()
    assert profile["ownerScope"] == "personal"
    assert profile["desiredAgentAuthRevision"] == 1

    response = await client.get(
        f"/v1/cloud/sandbox-profiles/{profile['id']}/agent-auth-selections",
        headers=_headers(tokens),
    )
    assert response.status_code == 200
    selections = response.json()
    assert selections[0]["agentKind"] == "claude"
    assert selections[0]["materializationMode"] == "synced_files"
    assert selections[0]["status"] == "active"


@pytest.mark.asyncio
async def test_synced_claude_env_payload_is_rejected(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    tokens = await _create_user_and_get_tokens(
        client,
        db_session,
        email="agent-auth-claude-env@example.com",
    )

    response = await client.put(
        "/v1/cloud/agent-auth/credentials/synced/claude",
        headers=_headers(tokens),
        json={
            "authMode": "env",
            "envVars": {"ANTHROPIC_API_KEY": "test-anthropic-key"},
        },
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "invalid_payload"


@pytest.mark.asyncio
async def test_synced_credential_update_refreshes_existing_selection_revision(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    tokens = await _create_user_and_get_tokens(
        client,
        db_session,
        email="agent-auth-sync-update@example.com",
    )

    response = await client.put(
        "/v1/cloud/agent-auth/credentials/synced/claude",
        headers=_headers(tokens),
        json=_claude_file_payload("sk-ant-first"),
    )
    assert response.status_code == 200
    original_credential = response.json()["credential"]

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
        "/v1/cloud/agent-auth/credentials/synced/claude",
        headers=_headers(tokens),
        json=_claude_file_payload("sk-ant-second"),
    )
    assert response.status_code == 200
    updated_credential = response.json()["credential"]
    assert response.json()["changed"] is True
    assert updated_credential["id"] == original_credential["id"]
    assert updated_credential["revision"] == original_credential["revision"] + 1

    response = await client.post(
        "/v1/cloud/sandbox-profiles/personal",
        headers=_headers(tokens),
        json={},
    )
    assert response.status_code == 200
    assert response.json()["desiredAgentAuthRevision"] == 2

    response = await client.get(
        f"/v1/cloud/sandbox-profiles/{profile['id']}/agent-auth-selections",
        headers=_headers(tokens),
    )
    assert response.status_code == 200
    updated_selection = response.json()[0]
    assert updated_selection["status"] == "active"
    assert updated_selection["agentKind"] == "claude"
    assert updated_selection["credentialId"] == original_selection["credentialId"]
    assert updated_selection["selectedRevision"] == updated_credential["revision"]


@pytest.mark.asyncio
async def test_synced_credential_revoke_invalidates_existing_selection(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    tokens = await _create_user_and_get_tokens(
        client,
        db_session,
        email="agent-auth-sync-revoke@example.com",
    )

    response = await client.put(
        "/v1/cloud/agent-auth/credentials/synced/claude",
        headers=_headers(tokens),
        json=_claude_file_payload("sk-ant-test"),
    )
    assert response.status_code == 200
    credential_id = response.json()["credential"]["id"]

    response = await client.post(
        "/v1/cloud/sandbox-profiles/personal",
        headers=_headers(tokens),
        json={},
    )
    assert response.status_code == 200
    profile = response.json()

    response = await client.delete(
        f"/v1/cloud/agent-auth/credentials/{credential_id}",
        headers=_headers(tokens),
    )
    assert response.status_code == 200
    assert response.json()["changed"] is True

    response = await client.get(
        f"/v1/cloud/sandbox-profiles/{profile['id']}/agent-auth-selections",
        headers=_headers(tokens),
    )
    assert response.status_code == 200
    selection = response.json()[0]
    assert selection["status"] == "invalid"
    assert selection["lastErrorCode"] == "credential_revoked"


@pytest.mark.asyncio
async def test_revoked_synced_selection_materializes_invalid_cleanup_plan(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    tokens = await _create_user_and_get_tokens(
        client,
        db_session,
        email="agent-auth-sync-revoke-cleanup@example.com",
    )
    response = await client.put(
        "/v1/cloud/agent-auth/credentials/synced/claude",
        headers=_headers(tokens),
        json={
            "authMode": "file",
            "files": [
                {
                    "relativePath": ".claude.json",
                    "contentBase64": b64encode(b'{"apiKey":"sk-ant-test"}').decode("ascii"),
                }
            ],
        },
    )
    assert response.status_code == 200
    credential_id = response.json()["credential"]["id"]
    profile_response = await client.post(
        "/v1/cloud/sandbox-profiles/personal",
        headers=_headers(tokens),
    )
    assert profile_response.status_code == 200
    profile = profile_response.json()
    profile_id = UUID(profile["id"])
    target_id = UUID(profile["primaryTargetId"])
    slot = await ensure_profile_slot(
        db_session,
        sandbox_profile_id=profile_id,
        target_id=target_id,
    )
    worker_token = f"agent-auth-cleanup-{uuid.uuid4()}"
    await worker_auth_store.create_worker(
        db_session,
        target_id=target_id,
        cloud_sandbox_id=slot.id,
        slot_generation=slot.slot_generation,
        token_hash=worker_service._hash_token(
            domain=CLOUD_WORKER_TOKEN_DOMAIN,
            token=worker_token,
        ),
        machine_fingerprint="agent-auth-cleanup",
        hostname="agent-auth-cleanup",
        worker_version="0.1.0",
        anyharness_version="0.1.0",
        supervisor_version=None,
        now=utcnow(),
    )
    await db_session.commit()
    worker_headers = {"Authorization": f"Bearer {worker_token}"}
    initial_lease = await client.post(
        "/v1/cloud/worker/commands/lease",
        headers=worker_headers,
        json={"supportedKinds": ["refresh_agent_auth_config"], "leaseTimeoutSeconds": 30},
    )
    assert initial_lease.status_code == 200
    initial_command = initial_lease.json()["command"]
    if initial_command is not None:
        initial_result = await client.post(
            f"/v1/cloud/worker/commands/{initial_command['commandId']}/result",
            headers=worker_headers,
            json={
                "status": "accepted",
                "leaseId": initial_command["leaseId"],
                "slotGeneration": initial_command["slotGeneration"],
            },
        )
        assert initial_result.status_code == 200

    response = await client.delete(
        f"/v1/cloud/agent-auth/credentials/{credential_id}",
        headers=_headers(tokens),
    )
    assert response.status_code == 200
    lease = await client.post(
        "/v1/cloud/worker/commands/lease",
        headers=worker_headers,
        json={"supportedKinds": ["refresh_agent_auth_config"], "leaseTimeoutSeconds": 30},
    )
    assert lease.status_code == 200
    command = lease.json()["command"]
    assert command["kind"] == "refresh_agent_auth_config"

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
    selection = materialization.json()["selections"][0]
    assert selection["agentKind"] == "claude"
    assert selection["status"] == "invalid"
    assert selection["syncedFiles"]["files"] == []
    assert {cleanup["relativePath"] for cleanup in selection["syncedFiles"]["cleanup"]} == {
        ".claude.json"
    }


@pytest.mark.asyncio
async def test_gateway_byok_credential_creation_disabled_by_default(
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

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "gateway_byok_disabled"


@pytest.mark.asyncio
async def test_gateway_byok_provider_flag_must_be_enabled(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings.agent_gateway_byok_enabled",
        True,
    )
    tokens = await _create_user_and_get_tokens(
        client,
        db_session,
        email="agent-auth-provider-flag-disabled@example.com",
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

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "gateway_byok_disabled"


@pytest.mark.asyncio
async def test_gateway_credential_fails_closed_without_live_provider_validation_when_byok_enabled(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _enable_anthropic_gateway_byok(monkeypatch)
    tokens = await _create_user_and_get_tokens(
        client,
        db_session,
        email="agent-auth-gateway-enabled@example.com",
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
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _enable_anthropic_gateway_byok(monkeypatch)
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
async def test_existing_byok_gateway_credential_cannot_be_selected_when_disabled(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    tokens = await _create_user_and_get_tokens(
        client,
        db_session,
        email="agent-auth-select-byok-disabled@example.com",
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
        display_name="Dormant Claude BYOK",
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
        litellm_team_id="team-disabled-byok",
        litellm_virtual_key_id="key-disabled-byok",
        litellm_virtual_key_ciphertext=encrypt_text("litellm-disabled-byok-key"),
        litellm_virtual_key_ciphertext_key_id="cloud_secret_key:v1",
        litellm_sync_status="synced",
        litellm_sync_fingerprint="fingerprint-disabled-byok",
        status="ready",
    )
    await db_session.commit()

    profile_response = await client.post(
        "/v1/cloud/sandbox-profiles/personal",
        headers=_headers(tokens),
        json={},
    )
    assert profile_response.status_code == 200

    select_response = await client.put(
        f"/v1/cloud/sandbox-profiles/{profile_response.json()['id']}/agent-auth-selections/claude",
        headers=_headers(tokens),
        json={"credentialId": str(credential.id)},
    )

    assert select_response.status_code == 403
    assert select_response.json()["detail"]["code"] == "gateway_byok_disabled"


@pytest.mark.asyncio
async def test_existing_byok_gateway_credential_without_provider_cannot_be_selected(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _enable_anthropic_gateway_byok(monkeypatch)
    tokens = await _create_user_and_get_tokens(
        client,
        db_session,
        email="agent-auth-select-byok-missing-provider@example.com",
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
        display_name="Missing Provider Claude BYOK",
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
        litellm_team_id="team-missing-provider",
        litellm_virtual_key_id="key-missing-provider",
        litellm_virtual_key_ciphertext=encrypt_text("litellm-missing-provider-key"),
        litellm_virtual_key_ciphertext_key_id="cloud_secret_key:v1",
        litellm_sync_status="synced",
        litellm_sync_fingerprint="fingerprint-missing-provider",
        status="ready",
    )
    await db_session.commit()

    profile_response = await client.post(
        "/v1/cloud/sandbox-profiles/personal",
        headers=_headers(tokens),
        json={},
    )
    assert profile_response.status_code == 200

    select_response = await client.put(
        f"/v1/cloud/sandbox-profiles/{profile_response.json()['id']}/agent-auth-selections/claude",
        headers=_headers(tokens),
        json={"credentialId": str(credential.id)},
    )

    assert select_response.status_code == 403
    assert select_response.json()["detail"]["code"] == "provider_credential_missing"


@pytest.mark.asyncio
async def test_gateway_policy_kind_must_match_owner_scope(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _enable_anthropic_gateway_byok(monkeypatch)
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
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings."
        "agent_gateway_managed_budget_free_usd",
        "12.50",
    )
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
        json={"includedBudgetUsd": "999999", "agentKinds": ["claude", "claude", "gemini"]},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["budgetSubject"]["includedBudgetUsd"] == "12.50"
    assert len(body["credentials"]) == 1
    assert body["credentials"][0]["displayName"] == "Proliferate managed credits"
    assert body["credentials"][0]["status"] == "invalid"


@pytest.mark.asyncio
async def test_managed_credits_use_global_litellm_model_deployment(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings.agent_gateway_enabled",
        True,
    )
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings.agent_gateway_litellm_master_key",
        "sk-master-test",
    )
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings."
        "agent_gateway_managed_budget_free_usd",
        "12.50",
    )

    class _FakeLiteLLMAdminClient:
        def __init__(self) -> None:
            self.deployments: list[dict[str, object]] = []

        async def ensure_team(self, **kwargs: object) -> object:
            assert kwargs["max_budget"] == "12.50"
            assert kwargs["budget_duration"] == "30d"
            return SimpleNamespace(team_id="team-managed")

        async def create_model_deployment(self, **kwargs: object) -> object:
            self.deployments.append(dict(kwargs))
            return SimpleNamespace(
                model_id="model-managed",
                public_model_name=kwargs["public_model_name"],
                team_id=kwargs.get("team_id"),
            )

        async def generate_key(self, **_kwargs: object) -> object:
            return SimpleNamespace(key="litellm-managed-key", key_id="key-managed")

    fake_litellm = _FakeLiteLLMAdminClient()
    monkeypatch.setattr(agent_auth_service, "LiteLLMAdminClient", lambda: fake_litellm)

    tokens = await _create_user_and_get_tokens(
        client,
        db_session,
        email="agent-auth-managed-credits-litellm@example.com",
    )

    organizations = await client.get("/v1/organizations", headers=_headers(tokens))
    organization_id = organizations.json()["organizations"][0]["id"]

    response = await client.post(
        f"/v1/cloud/organizations/{organization_id}/agent-auth/managed-credits",
        headers=_headers(tokens),
        json={"agentKinds": ["claude"]},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["budgetSubject"]["status"] == "ready"
    assert body["budgetSubject"]["litellmTeamId"] == "team-managed"
    assert body["credentials"][0]["status"] == "ready"
    assert fake_litellm.deployments
    assert "team_id" not in fake_litellm.deployments[0]


@pytest.mark.asyncio
async def test_litellm_reconciler_repairs_valid_byok_policy(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _enable_anthropic_gateway_byok(monkeypatch)
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings.agent_gateway_enabled",
        True,
    )
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings.agent_gateway_litellm_master_key",
        "sk-master-test",
    )
    user = User(
        email=f"agent-auth-reconcile-{uuid.uuid4().hex[:8]}@example.com",
        hashed_password="unused",
        is_active=True,
        is_superuser=False,
        is_verified=True,
        display_name="Agent Auth Reconciler",
    )
    db_session.add(user)
    await db_session.flush()
    credential = await store.create_agent_auth_credential(
        db_session,
        owner_scope="personal",
        owner_user_id=user.id,
        organization_id=None,
        created_by_user_id=user.id,
        agent_kind="claude",
        credential_kind="managed_gateway",
        display_name="Claude BYOK",
        redacted_summary_json='{"providerKind":"anthropic_api_key"}',
        status="invalid",
    )
    policy = await store.ensure_gateway_policy(
        db_session,
        credential_id=credential.id,
        policy_kind="personal_byok",
        owner_scope="personal",
        owner_user_id=user.id,
        organization_id=None,
        budget_subject_id=None,
        litellm_team_id=None,
        litellm_virtual_key_id=None,
        litellm_virtual_key_ciphertext=None,
        litellm_virtual_key_ciphertext_key_id=None,
        litellm_sync_status="failed",
        litellm_sync_fingerprint=None,
        status="invalid",
        last_error_code="litellm_provisioning_failed",
        last_error_message="previous failure",
    )
    await store.upsert_provider_credential(
        db_session,
        policy_id=policy.id,
        provider_kind="anthropic_api_key",
        payload_ciphertext=encrypt_json({"apiKey": "sk-provider-secret"}),
        payload_ciphertext_key_id="cloud_secret_key:v1",
        redacted_summary_json='{"providerKind":"anthropic_api_key"}',
        validation_status="valid",
        validated_at=utcnow(),
        validation_error_code=None,
        validation_error_message=None,
    )

    class _FakeLiteLLMAdminClient:
        def __init__(self) -> None:
            self.deployments: list[dict[str, object]] = []

        async def ensure_team(self, **_kwargs: object) -> object:
            return SimpleNamespace(team_id="team-reconciled")

        async def generate_key(self, **_kwargs: object) -> object:
            return SimpleNamespace(key="litellm-reconciled-key", key_id="key-reconciled")

        async def create_model_deployment(self, **kwargs: object) -> object:
            self.deployments.append(dict(kwargs))
            return SimpleNamespace(
                model_id="model-reconciled",
                public_model_name=kwargs["public_model_name"],
                team_id=kwargs["team_id"],
            )

    fake_litellm = _FakeLiteLLMAdminClient()
    monkeypatch.setattr(agent_auth_service, "LiteLLMAdminClient", lambda: fake_litellm)

    result = await agent_auth_service.reconcile_agent_gateway_litellm_mirror(
        db_session,
        limit=10,
    )

    assert result.policies_checked == 1
    assert result.policies_reconciled == 1
    repaired_policy = await store.get_gateway_policy(db_session, policy.id)
    assert repaired_policy is not None
    assert repaired_policy.status == "ready"
    assert repaired_policy.litellm_sync_status == "synced"
    assert repaired_policy.litellm_team_id == "team-reconciled"
    assert repaired_policy.litellm_virtual_key_ciphertext is not None
    assert decrypt_text(repaired_policy.litellm_virtual_key_ciphertext) == "litellm-reconciled-key"
    repaired_credential = await store.get_credential(db_session, credential.id)
    assert repaired_credential is not None
    assert repaired_credential.status == "ready"
    assert fake_litellm.deployments[0]["litellm_params"] == {
        "api_key": "sk-provider-secret",
        "custom_llm_provider": "anthropic",
    }


@pytest.mark.asyncio
async def test_litellm_reconciler_does_not_launch_disabled_byok_policy(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings.agent_gateway_enabled",
        True,
    )
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings.agent_gateway_litellm_master_key",
        "sk-master-test",
    )
    user = User(
        email=f"agent-auth-reconcile-byok-disabled-{uuid.uuid4().hex[:8]}@example.com",
        hashed_password="unused",
        is_active=True,
        is_superuser=False,
        is_verified=True,
        display_name="Agent Auth Reconciler",
    )
    db_session.add(user)
    await db_session.flush()
    credential = await store.create_agent_auth_credential(
        db_session,
        owner_scope="personal",
        owner_user_id=user.id,
        organization_id=None,
        created_by_user_id=user.id,
        agent_kind="claude",
        credential_kind="managed_gateway",
        display_name="Disabled Claude BYOK",
        redacted_summary_json='{"providerKind":"anthropic_api_key"}',
        status="invalid",
    )
    policy = await store.ensure_gateway_policy(
        db_session,
        credential_id=credential.id,
        policy_kind="personal_byok",
        owner_scope="personal",
        owner_user_id=user.id,
        organization_id=None,
        budget_subject_id=None,
        litellm_team_id=None,
        litellm_virtual_key_id=None,
        litellm_virtual_key_ciphertext=None,
        litellm_virtual_key_ciphertext_key_id=None,
        litellm_sync_status="failed",
        litellm_sync_fingerprint=None,
        status="invalid",
        last_error_code="litellm_provisioning_failed",
        last_error_message="previous failure",
    )
    await store.upsert_provider_credential(
        db_session,
        policy_id=policy.id,
        provider_kind="anthropic_api_key",
        payload_ciphertext=encrypt_json({"apiKey": "sk-provider-secret"}),
        payload_ciphertext_key_id="cloud_secret_key:v1",
        redacted_summary_json='{"providerKind":"anthropic_api_key"}',
        validation_status="valid",
        validated_at=utcnow(),
        validation_error_code=None,
        validation_error_message=None,
    )

    class _UnexpectedLiteLLMAdminClient:
        async def ensure_team(self, **_kwargs: object) -> object:
            raise AssertionError("disabled BYOK policies should not provision LiteLLM")

    monkeypatch.setattr(
        agent_auth_service,
        "LiteLLMAdminClient",
        lambda: _UnexpectedLiteLLMAdminClient(),
    )

    result = await agent_auth_service.reconcile_agent_gateway_litellm_mirror(
        db_session,
        limit=10,
    )

    assert result.policies_checked == 1
    assert result.policies_failed == 1
    repaired_policy = await store.get_gateway_policy(db_session, policy.id)
    assert repaired_policy is not None
    assert repaired_policy.status == "invalid"
    assert repaired_policy.litellm_sync_status == "failed"
    assert repaired_policy.last_error_code == "gateway_byok_disabled"
    repaired_credential = await store.get_credential(db_session, credential.id)
    assert repaired_credential is not None
    assert repaired_credential.status == "invalid"


@pytest.mark.asyncio
async def test_litellm_reconciler_does_not_replay_synced_policy(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings.agent_gateway_enabled",
        True,
    )
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings.agent_gateway_litellm_master_key",
        "sk-master-test",
    )
    user = User(
        email=f"agent-auth-reconcile-synced-{uuid.uuid4().hex[:8]}@example.com",
        hashed_password="unused",
        is_active=True,
        is_superuser=False,
        is_verified=True,
        display_name="Agent Auth Reconciler",
    )
    db_session.add(user)
    await db_session.flush()
    credential = await store.create_agent_auth_credential(
        db_session,
        owner_scope="personal",
        owner_user_id=user.id,
        organization_id=None,
        created_by_user_id=user.id,
        agent_kind="claude",
        credential_kind="managed_gateway",
        display_name="Synced Claude BYOK",
        redacted_summary_json='{"providerKind":"anthropic_api_key"}',
        status="ready",
    )
    await store.ensure_gateway_policy(
        db_session,
        credential_id=credential.id,
        policy_kind="personal_byok",
        owner_scope="personal",
        owner_user_id=user.id,
        organization_id=None,
        budget_subject_id=None,
        litellm_team_id="team-synced",
        litellm_virtual_key_id="key-synced",
        litellm_virtual_key_ciphertext=encrypt_text("litellm-synced-key"),
        litellm_virtual_key_ciphertext_key_id="cloud_secret_key:v1",
        litellm_sync_status="synced",
        litellm_sync_fingerprint="fingerprint-synced",
        status="ready",
    )

    class _UnexpectedLiteLLMAdminClient:
        async def ensure_team(self, **_kwargs: object) -> object:
            raise AssertionError("synced policies should not be blindly reconciled")

    monkeypatch.setattr(
        agent_auth_service,
        "LiteLLMAdminClient",
        lambda: _UnexpectedLiteLLMAdminClient(),
    )

    result = await agent_auth_service.reconcile_agent_gateway_litellm_mirror(
        db_session,
        limit=10,
    )

    assert result.policies_checked == 0
    assert result.policies_reconciled == 0


@pytest.mark.asyncio
async def test_agent_auth_selection_queues_secret_safe_worker_materialization(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _enable_anthropic_gateway_byok(monkeypatch)
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings.agent_gateway_public_base_url",
        "https://gateway.test",
    )
    tokens = await _create_user_and_get_tokens(
        client,
        db_session,
        email="agent-auth-worker-materialization@example.com",
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
    policy = await store.ensure_gateway_policy(
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
    await store.upsert_provider_credential(
        db_session,
        policy_id=policy.id,
        provider_kind="anthropic_api_key",
        payload_ciphertext=encrypt_json({"apiKey": "sk-provider-secret"}),
        payload_ciphertext_key_id="cloud_secret_key:v1",
        redacted_summary_json='{"providerKind":"anthropic_api_key"}',
        validation_status="valid",
        validated_at=utcnow(),
        validation_error_code=None,
        validation_error_message=None,
    )
    await db_session.commit()

    profile_response = await client.post(
        "/v1/cloud/sandbox-profiles/personal",
        headers=_headers(tokens),
    )
    assert profile_response.status_code == 200
    profile = profile_response.json()
    profile_id = UUID(profile["id"])
    target_id = UUID(profile["primaryTargetId"])
    slot = await ensure_profile_slot(
        db_session,
        sandbox_profile_id=profile_id,
        target_id=target_id,
    )
    worker_token = f"agent-auth-materialization-{uuid.uuid4()}"
    await worker_auth_store.create_worker(
        db_session,
        target_id=target_id,
        cloud_sandbox_id=slot.id,
        slot_generation=slot.slot_generation,
        token_hash=worker_service._hash_token(
            domain=CLOUD_WORKER_TOKEN_DOMAIN,
            token=worker_token,
        ),
        machine_fingerprint="agent-auth-materialization",
        hostname="agent-auth-materialization",
        worker_version="0.1.0",
        anyharness_version="0.1.0",
        supervisor_version=None,
        now=utcnow(),
    )
    await db_session.commit()
    worker_headers = {"Authorization": f"Bearer {worker_token}"}

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
            "slotGeneration": command["slotGeneration"],
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
    assert command_status.json()["result"] == {"applied": True}
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
