from __future__ import annotations

import uuid
from base64 import b64encode
from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import CLOUD_WORKER_TOKEN_DOMAIN
from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_ROLE_OWNER,
    ORGANIZATION_STATUS_ACTIVE,
)
from proliferate.db.models.auth import AuthIdentity, OAuthAccount, User
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.store.cloud_agent_auth import store
from proliferate.db.store.cloud_sandboxes import ensure_profile_slot
from proliferate.db.store.cloud_sync import worker_auth as worker_auth_store
from proliferate.integrations.bifrost import (
    BifrostLogEntry,
    BifrostLogSearchResult,
    BifrostProviderKeyResult,
    BifrostVirtualKeyResult,
)
from proliferate.server.cloud.agent_auth import service as agent_auth_service
from proliferate.server.cloud.worker import service as worker_service
from proliferate.server.cloud.worker.domain.types import WorkerAuthContext
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
    db_session.add(
        AuthIdentity(
            user_id=user.id,
            provider="github",
            provider_subject=f"github-{user.id}",
            email=email,
            email_verified=True,
            display_name="Agent Auth Tester",
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


async def _create_organization_for_user(db_session: AsyncSession, user_id: str) -> str:
    now = datetime.now(UTC)
    organization = Organization(
        name="Agent Auth Team",
        status=ORGANIZATION_STATUS_ACTIVE,
        created_at=now,
        updated_at=now,
    )
    db_session.add(organization)
    await db_session.flush()
    db_session.add(
        OrganizationMembership(
            organization_id=organization.id,
            user_id=UUID(user_id),
            role=ORGANIZATION_ROLE_OWNER,
            status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            joined_at=now,
            created_at=now,
            updated_at=now,
        )
    )
    await db_session.commit()
    return str(organization.id)


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
        "proliferate.server.cloud.agent_auth.service.settings.agent_gateway_personal_byok_enabled",
        True,
    )
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings.agent_gateway_litellm_topology",
        "enterprise_shared",
    )
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings."
        "agent_gateway_litellm_customer_secret_isolation_verified",
        True,
    )
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings."
        "agent_gateway_anthropic_byok_enabled",
        True,
    )


class _FakeBifrostAdminClient:
    def __init__(self) -> None:
        self.provider_keys: list[dict[str, object]] = []
        self.virtual_keys: list[dict[str, object]] = []
        self.updated_virtual_keys: list[dict[str, object]] = []
        self.disabled_provider_keys: list[dict[str, str]] = []
        self.disabled_virtual_keys: list[str] = []
        self.logs = BifrostLogSearchResult(logs=(), total_count=0)
        self.log_pages: dict[int, BifrostLogSearchResult] = {}
        self.log_calls: list[dict[str, object]] = []

    async def upsert_provider_key(self, **kwargs: object) -> BifrostProviderKeyResult:
        self.provider_keys.append(dict(kwargs))
        return BifrostProviderKeyResult(
            key_id=str(kwargs["key_id"]),
            provider=str(kwargs["provider"]),
            name=str(kwargs["name"]),
        )

    async def create_virtual_key(self, **kwargs: object) -> BifrostVirtualKeyResult:
        index = len(self.virtual_keys) + 1
        self.virtual_keys.append(dict(kwargs))
        return BifrostVirtualKeyResult(
            virtual_key_id=f"vk-bifrost-runtime-{index}",
            virtual_key=f"sk-bf-runtime-{index}",
            name=str(kwargs["name"]),
            is_active=True,
        )

    async def update_virtual_key(self, **kwargs: object) -> BifrostVirtualKeyResult:
        self.updated_virtual_keys.append(dict(kwargs))
        return BifrostVirtualKeyResult(
            virtual_key_id=str(kwargs["virtual_key_id"]),
            virtual_key=None,
            name=str(kwargs["name"]),
            is_active=bool(kwargs.get("is_active", True)),
        )

    async def disable_virtual_key(self, virtual_key_id: str) -> None:
        self.disabled_virtual_keys.append(virtual_key_id)

    async def disable_provider_key(self, *, provider: str, key_id: str) -> None:
        self.disabled_provider_keys.append({"provider": provider, "key_id": key_id})

    async def list_logs(self, **kwargs: object) -> BifrostLogSearchResult:
        self.log_calls.append(dict(kwargs))
        offset = int(kwargs.get("offset") or 0)
        return self.log_pages.get(offset, self.logs)


def _enable_bifrost_gateway(monkeypatch: pytest.MonkeyPatch) -> _FakeBifrostAdminClient:
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings.agent_gateway_enabled",
        True,
    )
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings.agent_gateway_router",
        "bifrost",
    )
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings.agent_gateway_bifrost_base_url",
        "https://bifrost-admin.test",
    )
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings."
        "agent_gateway_bifrost_isolation_verified",
        True,
    )
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings."
        "agent_gateway_bifrost_public_base_url",
        "https://bifrost.test",
    )
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings."
        "agent_gateway_managed_anthropic_api_key",
        "sk-ant-managed-test",
    )
    fake_bifrost = _FakeBifrostAdminClient()
    monkeypatch.setattr(agent_auth_service, "BifrostAdminClient", lambda: fake_bifrost)
    return fake_bifrost


def test_bifrost_public_url_is_explicit(monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_bifrost_gateway(monkeypatch)
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings."
        "agent_gateway_bifrost_public_base_url",
        "",
    )

    with pytest.raises(agent_auth_service.AgentAuthError) as exc:
        agent_auth_service._bifrost_public_base_url()

    assert exc.value.code == "bifrost_public_base_url_missing"


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
async def test_personal_gateway_byok_requires_explicit_personal_flag(
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
    tokens = await _create_user_and_get_tokens(
        client,
        db_session,
        email="agent-auth-personal-byok-disabled@example.com",
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
    assert response.json()["detail"]["code"] == "personal_byok_disabled"


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

    organization_id = await _create_organization_for_user(db_session, tokens["user_id"])

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

    organization_id = await _create_organization_for_user(db_session, tokens["user_id"])

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
async def test_free_managed_credits_provision_personal_budget_and_selection(
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
        "agent_gateway_user_free_credit_enabled",
        True,
    )
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings.agent_gateway_user_free_credit_usd",
        "5.00",
    )

    class _FakeLiteLLMAdminClient:
        def __init__(self) -> None:
            self.deployments: list[dict[str, object]] = []
            self.team_updates = 0
            self.keys = 0

        async def ensure_team(self, **kwargs: object) -> object:
            self.team_updates += 1
            assert kwargs["max_budget"] == "5.00"
            assert kwargs["budget_duration"] is None
            assert str(kwargs["team_alias"]).startswith("user-")
            return SimpleNamespace(team_id="team-free-credit")

        async def create_model_deployment(self, **kwargs: object) -> object:
            self.deployments.append(dict(kwargs))
            return SimpleNamespace(
                model_id="model-free-credit",
                public_model_name=kwargs["public_model_name"],
                team_id=kwargs.get("team_id"),
            )

        async def generate_key(self, **_kwargs: object) -> object:
            self.keys += 1
            return SimpleNamespace(key="litellm-free-credit-key", key_id="key-free-credit")

    fake_litellm = _FakeLiteLLMAdminClient()
    monkeypatch.setattr(agent_auth_service, "LiteLLMAdminClient", lambda: fake_litellm)

    tokens = await _create_user_and_get_tokens(
        client,
        db_session,
        email="agent-auth-free-credits@example.com",
    )
    actor_user_id = UUID(tokens["user_id"])

    response = await client.post(
        "/v1/cloud/agent-auth/free-credits/ensure",
        headers=_headers(tokens),
        json={},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ready"
    assert body["launchEnabled"] is True
    assert body["primaryAction"] == "launch"
    assert body["entitlement"]["status"] == "active"
    assert body["budgetSubject"]["ownerScope"] == "personal"
    assert body["budgetSubject"]["ownerUserId"] == str(actor_user_id)
    assert body["budgetSubject"]["organizationId"] is None
    assert body["budgetSubject"]["includedBudgetUsd"] == "5.00"
    assert body["budgetSubject"]["budgetDuration"] is None
    assert body["credentials"][0]["displayName"] == "Proliferate free credits"
    assert body["credentials"][0]["status"] == "ready"
    assert body["readyAgentModels"][0]["agentKind"] == "claude"
    assert fake_litellm.deployments
    assert "team_id" not in fake_litellm.deployments[0]

    profile = await store.get_active_personal_sandbox_profile_for_user(db_session, actor_user_id)
    assert profile is not None
    selections = await store.list_selections_for_profile(db_session, profile.id)
    assert len(selections) == 1
    assert selections[0].credential_id == UUID(body["credentials"][0]["id"])

    repeat = await client.post(
        "/v1/cloud/agent-auth/free-credits/ensure",
        headers=_headers(tokens),
        json={},
    )

    assert repeat.status_code == 200
    assert repeat.json()["status"] == "ready"
    assert fake_litellm.team_updates == 1
    assert len(fake_litellm.deployments) == 1
    assert fake_litellm.keys == 1
    unchanged_profile = await store.get_active_personal_sandbox_profile_for_user(
        db_session,
        actor_user_id,
    )
    assert unchanged_profile is not None
    assert unchanged_profile.desired_agent_auth_revision == profile.desired_agent_auth_revision

    await store.ensure_free_credit_entitlement(
        db_session,
        user_id=actor_user_id,
        source="signup_free_credit",
        period_key="registration",
        included_budget_usd="5.00",
        budget_subject_id=UUID(body["budgetSubject"]["id"]),
        status="exhausted",
        last_error_code="credits_exhausted",
        last_error_message="spent",
    )
    await db_session.commit()
    exhausted = await client.post(
        "/v1/cloud/agent-auth/free-credits/ensure",
        headers=_headers(tokens),
        json={},
    )

    assert exhausted.status_code == 200
    assert exhausted.json()["status"] == "exhausted"
    assert exhausted.json()["launchEnabled"] is False
    assert fake_litellm.team_updates == 1


@pytest.mark.asyncio
async def test_free_managed_credits_use_bifrost_provider_key_materialization(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_bifrost = _enable_bifrost_gateway(monkeypatch)
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings."
        "agent_gateway_user_free_credit_enabled",
        True,
    )
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings.agent_gateway_user_free_credit_usd",
        "5.00",
    )
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings."
        "agent_gateway_managed_credit_agent_kinds",
        "claude,gemini",
    )

    tokens = await _create_user_and_get_tokens(
        client,
        db_session,
        email="agent-auth-free-credits-bifrost@example.com",
    )

    response = await client.post(
        "/v1/cloud/agent-auth/free-credits/ensure",
        headers=_headers(tokens),
        json={},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ready"
    assert body["launchEnabled"] is True
    assert body["budgetSubject"]["litellmSyncStatus"] == "synced"
    assert body["budgetSubject"]["litellmTeamId"].startswith("proliferate-managed-")
    assert {item["agentKind"] for item in body["readyAgentModels"]} == {"claude", "gemini"}
    assert {credential["agentKind"] for credential in body["credentials"]} == {
        "claude",
        "gemini",
    }
    assert len(fake_bifrost.provider_keys) == 1
    provider_key = fake_bifrost.provider_keys[0]
    assert provider_key["provider"] == "anthropic"
    assert provider_key["key_id"] == body["budgetSubject"]["litellmTeamId"]
    assert "sk-ant-managed-test" not in str(body)

    repeat = await client.post(
        "/v1/cloud/agent-auth/free-credits/ensure",
        headers=_headers(tokens),
        json={},
    )

    assert repeat.status_code == 200
    assert repeat.json()["status"] == "ready"
    assert len(fake_bifrost.provider_keys) == 1


@pytest.mark.asyncio
async def test_bifrost_worker_materialization_uses_direct_virtual_key_env(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_bifrost = _enable_bifrost_gateway(monkeypatch)
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings."
        "agent_gateway_user_free_credit_enabled",
        True,
    )
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings.agent_gateway_user_free_credit_usd",
        "5.00",
    )
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings."
        "agent_gateway_managed_credit_agent_kinds",
        "claude,gemini",
    )

    tokens = await _create_user_and_get_tokens(
        client,
        db_session,
        email="agent-auth-worker-materialization-bifrost@example.com",
    )
    ensure = await client.post(
        "/v1/cloud/agent-auth/free-credits/ensure",
        headers=_headers(tokens),
        json={},
    )
    assert ensure.status_code == 200
    profile_response = await client.post(
        "/v1/cloud/sandbox-profiles/personal",
        headers=_headers(tokens),
        json={},
    )
    assert profile_response.status_code == 200
    profile = await store.get_active_personal_sandbox_profile_for_user(
        db_session,
        UUID(tokens["user_id"]),
    )
    assert profile is not None
    assert profile.primary_target_id is not None
    actor_user_id = UUID(tokens["user_id"])
    slot = await ensure_profile_slot(
        db_session,
        sandbox_profile_id=profile.id,
        target_id=profile.primary_target_id,
    )
    await agent_auth_service.request_agent_auth_refresh_for_profile_target(
        db_session,
        sandbox_profile_id=profile.id,
        target_id=profile.primary_target_id,
        actor_user_id=actor_user_id,
        reason="test_bifrost_worker_materialization",
        force_restart=False,
    )
    worker_token = f"agent-auth-bifrost-materialization-{uuid.uuid4()}"
    await worker_auth_store.create_worker(
        db_session,
        target_id=profile.primary_target_id,
        cloud_sandbox_id=slot.id,
        slot_generation=slot.slot_generation,
        token_hash=worker_service._hash_token(
            domain=CLOUD_WORKER_TOKEN_DOMAIN,
            token=worker_token,
        ),
        machine_fingerprint="agent-auth-bifrost-materialization",
        hostname="agent-auth-bifrost-materialization",
        worker_version="0.1.0",
        anyharness_version="0.1.0",
        supervisor_version=None,
        now=utcnow(),
    )
    await db_session.commit()
    worker_headers = {"Authorization": f"Bearer {worker_token}"}

    lease = await client.post(
        "/v1/cloud/worker/commands/lease",
        headers=worker_headers,
        json={"supportedKinds": ["refresh_agent_auth_config"], "leaseTimeoutSeconds": 30},
    )
    assert lease.status_code == 200
    command = lease.json()["command"]
    materializing = await client.post(
        f"/v1/cloud/worker/agent-auth-configs/{profile.id}/status",
        headers=worker_headers,
        json={
            "status": "materializing",
            "commandId": command["commandId"],
            "revision": command["payload"]["revision"],
            "leaseId": command["leaseId"],
        },
    )
    assert materializing.status_code == 200

    materialization = await client.get(
        f"/v1/cloud/worker/agent-auth-configs/{profile.id}/materialization",
        headers=worker_headers,
        params={
            "command_id": command["commandId"],
            "revision": command["payload"]["revision"],
            "lease_id": command["leaseId"],
        },
    )

    assert materialization.status_code == 200
    plan = materialization.json()
    selections = {item["agentKind"]: item for item in plan["selections"]}
    claude = selections["claude"]["gateway"]
    assert claude["baseUrls"]["anthropic"] == "https://bifrost.test/anthropic"
    assert claude["runtimeGrantToken"] == "sk-bf-runtime-1"
    assert claude["protectedEnv"]["ANTHROPIC_AUTH_TOKEN"] == "sk-bf-runtime-1"
    assert "ANTHROPIC_CUSTOM_HEADERS" not in claude["protectedEnv"]
    gemini = selections["gemini"]["gateway"]
    assert gemini["protocolFacade"] == "genai"
    assert gemini["baseUrls"]["genai"] == "https://bifrost.test/genai"
    assert gemini["runtimeGrantToken"] == "sk-bf-runtime-2"
    assert gemini["protectedEnv"] == {
        "GEMINI_API_KEY": "sk-bf-runtime-2",
        "GOOGLE_GEMINI_BASE_URL": "https://bifrost.test/genai",
    }
    assert len(fake_bifrost.virtual_keys) == 2
    for virtual_key in fake_bifrost.virtual_keys:
        provider_configs = virtual_key["provider_configs"]
        assert isinstance(provider_configs, list)
        assert provider_configs[0]["key_ids"] == [ensure.json()["budgetSubject"]["litellmTeamId"]]
        assert provider_configs[0]["allowed_models"] != ["*"]
        assert provider_configs[0]["budgets"][0]["max_limit"] == 5.0


@pytest.mark.asyncio
async def test_bifrost_usage_import_debits_and_disables_exhausted_managed_credit(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_bifrost = _enable_bifrost_gateway(monkeypatch)
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings."
        "agent_gateway_user_free_credit_enabled",
        True,
    )
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings.agent_gateway_user_free_credit_usd",
        "0.01",
    )

    tokens = await _create_user_and_get_tokens(
        client,
        db_session,
        email="agent-auth-bifrost-usage@example.com",
    )
    ensure = await client.post(
        "/v1/cloud/agent-auth/free-credits/ensure",
        headers=_headers(tokens),
        json={},
    )
    assert ensure.status_code == 200
    actor_user_id = UUID(tokens["user_id"])
    profile_response = await client.post(
        "/v1/cloud/sandbox-profiles/personal",
        headers=_headers(tokens),
        json={},
    )
    assert profile_response.status_code == 200
    profile = await store.get_active_personal_sandbox_profile_for_user(db_session, actor_user_id)
    assert profile is not None and profile.primary_target_id is not None
    slot = await ensure_profile_slot(
        db_session,
        sandbox_profile_id=profile.id,
        target_id=profile.primary_target_id,
    )
    selection = (await store.list_selections_for_profile(db_session, profile.id))[0]
    await agent_auth_service._issue_bifrost_runtime_virtual_key_for_selection(
        db_session,
        auth=WorkerAuthContext(
            target_id=profile.primary_target_id,
            worker_id=uuid.uuid4(),
            cloud_sandbox_id=slot.id,
            slot_generation=slot.slot_generation,
        ),
        profile=profile,
        selection=selection,
    )
    await db_session.commit()

    fake_bifrost.logs = BifrostLogSearchResult(
        logs=(
            BifrostLogEntry(
                log_id="log-bifrost-exhausted",
                timestamp=utcnow(),
                provider="anthropic",
                model="claude-sonnet-4-6",
                status="success",
                cost=Decimal("0.02"),
                selected_key_id=ensure.json()["budgetSubject"]["litellmTeamId"],
                virtual_key_id="vk-bifrost-runtime-1",
                token_usage={"prompt_tokens": 10, "completion_tokens": 2, "total_tokens": 12},
                raw={"id": "log-bifrost-exhausted"},
            ),
        ),
        total_count=1,
    )

    imported = await agent_auth_service.import_bifrost_usage_logs(db_session)
    await db_session.commit()

    assert imported == 1
    budget = await store.get_user_managed_budget_subject(db_session, actor_user_id)
    assert budget is not None
    assert budget.status == "exhausted"
    entitlement = await store.get_free_credit_entitlement(
        db_session,
        user_id=actor_user_id,
        source="signup_free_credit",
        period_key="registration",
    )
    assert entitlement is not None
    assert entitlement.status == "exhausted"
    assert fake_bifrost.disabled_virtual_keys == ["vk-bifrost-runtime-1"]
    materialization = await store.get_router_materialization_by_object_id(
        db_session,
        router_kind="bifrost",
        router_object_kind="virtual_key",
        router_object_id="vk-bifrost-runtime-1",
    )
    assert materialization is not None
    assert materialization.status == "disabled"


@pytest.mark.asyncio
async def test_bifrost_usage_import_paginates_and_flags_missing_managed_cost(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_bifrost = _enable_bifrost_gateway(monkeypatch)
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings."
        "agent_gateway_user_free_credit_enabled",
        True,
    )
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings.agent_gateway_user_free_credit_usd",
        "5.00",
    )

    tokens = await _create_user_and_get_tokens(
        client,
        db_session,
        email="agent-auth-bifrost-usage-pagination@example.com",
    )
    ensure = await client.post(
        "/v1/cloud/agent-auth/free-credits/ensure",
        headers=_headers(tokens),
        json={},
    )
    assert ensure.status_code == 200
    actor_user_id = UUID(tokens["user_id"])
    profile_response = await client.post(
        "/v1/cloud/sandbox-profiles/personal",
        headers=_headers(tokens),
        json={},
    )
    assert profile_response.status_code == 200
    profile = await store.get_active_personal_sandbox_profile_for_user(db_session, actor_user_id)
    assert profile is not None and profile.primary_target_id is not None
    slot = await ensure_profile_slot(
        db_session,
        sandbox_profile_id=profile.id,
        target_id=profile.primary_target_id,
    )
    selection = (await store.list_selections_for_profile(db_session, profile.id))[0]
    await agent_auth_service._issue_bifrost_runtime_virtual_key_for_selection(
        db_session,
        auth=WorkerAuthContext(
            target_id=profile.primary_target_id,
            worker_id=uuid.uuid4(),
            cloud_sandbox_id=slot.id,
            slot_generation=slot.slot_generation,
        ),
        profile=profile,
        selection=selection,
    )
    await db_session.commit()

    fake_bifrost.log_pages = {
        0: BifrostLogSearchResult(
            logs=(
                BifrostLogEntry(
                    log_id="log-bifrost-costed",
                    timestamp=utcnow(),
                    provider="anthropic",
                    model="claude-sonnet-4-6",
                    status="success",
                    cost=Decimal("0.001"),
                    selected_key_id=ensure.json()["budgetSubject"]["litellmTeamId"],
                    virtual_key_id="vk-bifrost-runtime-1",
                    token_usage={"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
                    raw={"id": "log-bifrost-costed"},
                ),
            ),
            total_count=2,
        ),
        1: BifrostLogSearchResult(
            logs=(
                BifrostLogEntry(
                    log_id="log-bifrost-missing-cost",
                    timestamp=utcnow(),
                    provider="anthropic",
                    model="claude-sonnet-4-6",
                    status="success",
                    cost=None,
                    selected_key_id=ensure.json()["budgetSubject"]["litellmTeamId"],
                    virtual_key_id="vk-bifrost-runtime-1",
                    token_usage={"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
                    raw={"id": "log-bifrost-missing-cost"},
                ),
            ),
            total_count=2,
        ),
    }

    imported = await agent_auth_service.import_bifrost_usage_logs(db_session, limit=1)
    await db_session.commit()

    assert imported == 2
    assert [call["offset"] for call in fake_bifrost.log_calls] == [0, 1]
    budget = await store.get_user_managed_budget_subject(db_session, actor_user_id)
    assert budget is not None
    assert budget.status == "invalid"
    assert budget.last_error_code == "managed_usage_cost_missing"
    assert fake_bifrost.disabled_virtual_keys == ["vk-bifrost-runtime-1"]


@pytest.mark.asyncio
async def test_bifrost_revoke_byok_disables_provider_key_and_runtime_virtual_key(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _enable_anthropic_gateway_byok(monkeypatch)
    fake_bifrost = _enable_bifrost_gateway(monkeypatch)
    tokens = await _create_user_and_get_tokens(
        client,
        db_session,
        email="agent-auth-bifrost-revoke-byok@example.com",
    )
    actor_user_id = UUID(tokens["user_id"])

    credential_response = await client.post(
        "/v1/cloud/agent-auth/credentials/gateway",
        headers=_headers(tokens),
        json={
            "ownerScope": "personal",
            "agentKind": "claude",
            "displayName": "Personal Anthropic Bifrost BYOK",
            "policyKind": "personal_byok",
            "providerKind": "anthropic_api_key",
            "payload": {"apiKey": "sk-ant-byok-test"},
        },
    )
    assert credential_response.status_code == 200
    credential = credential_response.json()["credential"]
    assert credential["status"] == "ready"
    provider_key_id = credential_response.json()["policy"]["litellmTeamId"]

    profile_response = await client.post(
        "/v1/cloud/sandbox-profiles/personal",
        headers=_headers(tokens),
        json={},
    )
    assert profile_response.status_code == 200
    profile = await store.get_active_personal_sandbox_profile_for_user(db_session, actor_user_id)
    assert profile is not None and profile.primary_target_id is not None
    select_response = await client.put(
        f"/v1/cloud/sandbox-profiles/{profile.id}/agent-auth-selections/claude",
        headers=_headers(tokens),
        json={"credentialId": credential["id"]},
    )
    assert select_response.status_code == 200
    selection = (await store.list_selections_for_profile(db_session, profile.id))[0]
    slot = await ensure_profile_slot(
        db_session,
        sandbox_profile_id=profile.id,
        target_id=profile.primary_target_id,
    )
    await agent_auth_service._issue_bifrost_runtime_virtual_key_for_selection(
        db_session,
        auth=WorkerAuthContext(
            target_id=profile.primary_target_id,
            worker_id=uuid.uuid4(),
            cloud_sandbox_id=slot.id,
            slot_generation=slot.slot_generation,
        ),
        profile=profile,
        selection=selection,
    )
    await db_session.commit()

    revoke_response = await client.delete(
        f"/v1/cloud/agent-auth/credentials/{credential['id']}",
        headers=_headers(tokens),
    )

    assert revoke_response.status_code == 200
    assert fake_bifrost.disabled_provider_keys == [
        {"provider": "anthropic", "key_id": provider_key_id}
    ]
    assert fake_bifrost.disabled_virtual_keys == ["vk-bifrost-runtime-1"]
    provider_materialization = await store.get_router_materialization_by_object_id(
        db_session,
        router_kind="bifrost",
        router_object_kind="provider_key",
        router_object_id=provider_key_id,
    )
    assert provider_materialization is not None
    assert provider_materialization.status == "disabled"
    virtual_materialization = await store.get_router_materialization_by_object_id(
        db_session,
        router_kind="bifrost",
        router_object_kind="virtual_key",
        router_object_id="vk-bifrost-runtime-1",
    )
    assert virtual_materialization is not None
    assert virtual_materialization.status == "disabled"


@pytest.mark.asyncio
async def test_bifrost_selection_change_disables_old_runtime_virtual_key(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _enable_anthropic_gateway_byok(monkeypatch)
    fake_bifrost = _enable_bifrost_gateway(monkeypatch)
    tokens = await _create_user_and_get_tokens(
        client,
        db_session,
        email="agent-auth-bifrost-selection-switch@example.com",
    )
    actor_user_id = UUID(tokens["user_id"])

    first_response = await client.post(
        "/v1/cloud/agent-auth/credentials/gateway",
        headers=_headers(tokens),
        json={
            "ownerScope": "personal",
            "agentKind": "claude",
            "displayName": "First Anthropic Bifrost BYOK",
            "policyKind": "personal_byok",
            "providerKind": "anthropic_api_key",
            "payload": {"apiKey": "sk-ant-byok-first"},
        },
    )
    assert first_response.status_code == 200
    second_response = await client.post(
        "/v1/cloud/agent-auth/credentials/gateway",
        headers=_headers(tokens),
        json={
            "ownerScope": "personal",
            "agentKind": "claude",
            "displayName": "Second Anthropic Bifrost BYOK",
            "policyKind": "personal_byok",
            "providerKind": "anthropic_api_key",
            "payload": {"apiKey": "sk-ant-byok-second"},
        },
    )
    assert second_response.status_code == 200
    first_credential = first_response.json()["credential"]
    second_credential = second_response.json()["credential"]

    profile_response = await client.post(
        "/v1/cloud/sandbox-profiles/personal",
        headers=_headers(tokens),
        json={},
    )
    assert profile_response.status_code == 200
    profile = await store.get_active_personal_sandbox_profile_for_user(db_session, actor_user_id)
    assert profile is not None and profile.primary_target_id is not None

    select_first = await client.put(
        f"/v1/cloud/sandbox-profiles/{profile.id}/agent-auth-selections/claude",
        headers=_headers(tokens),
        json={"credentialId": first_credential["id"]},
    )
    assert select_first.status_code == 200
    selection = (await store.list_selections_for_profile(db_session, profile.id))[0]
    slot = await ensure_profile_slot(
        db_session,
        sandbox_profile_id=profile.id,
        target_id=profile.primary_target_id,
    )
    await agent_auth_service._issue_bifrost_runtime_virtual_key_for_selection(
        db_session,
        auth=WorkerAuthContext(
            target_id=profile.primary_target_id,
            worker_id=uuid.uuid4(),
            cloud_sandbox_id=slot.id,
            slot_generation=slot.slot_generation,
        ),
        profile=profile,
        selection=selection,
    )
    await db_session.commit()

    select_second = await client.put(
        f"/v1/cloud/sandbox-profiles/{profile.id}/agent-auth-selections/claude",
        headers=_headers(tokens),
        json={"credentialId": second_credential["id"]},
    )
    assert select_second.status_code == 200
    assert fake_bifrost.disabled_virtual_keys == ["vk-bifrost-runtime-1"]

    selection = (await store.list_selections_for_profile(db_session, profile.id))[0]
    await agent_auth_service._issue_bifrost_runtime_virtual_key_for_selection(
        db_session,
        auth=WorkerAuthContext(
            target_id=profile.primary_target_id,
            worker_id=uuid.uuid4(),
            cloud_sandbox_id=slot.id,
            slot_generation=slot.slot_generation,
        ),
        profile=profile,
        selection=selection,
    )
    await db_session.commit()

    name_prefix = (
        f"proliferate-claude-{selection.id.hex[:12]}-"
        f"{slot.id.hex[:12]}-{slot.slot_generation}-"
    )
    assert all(item["name"].startswith(name_prefix) for item in fake_bifrost.virtual_keys)
    assert fake_bifrost.virtual_keys[0]["name"] != fake_bifrost.virtual_keys[1]["name"]
    assert fake_bifrost.updated_virtual_keys == []
    allowed_models = [
        item["provider_configs"][0]["allowed_models"] for item in fake_bifrost.virtual_keys
    ]
    assert allowed_models == [["claude-sonnet-4-6"], ["claude-sonnet-4-6"]]
    assert len(fake_bifrost.virtual_keys) == 2


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
