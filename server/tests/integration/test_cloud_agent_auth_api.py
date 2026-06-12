from __future__ import annotations

import json
import uuid
from base64 import b64encode
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import CLOUD_WORKER_TOKEN_DOMAIN
from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_ROLE_OWNER,
    ORGANIZATION_STATUS_ACTIVE,
)
from proliferate.db.models.auth import AuthIdentity, OAuthAccount, ProviderGrant, User
from proliferate.db.models.cloud.agent_auth_profiles import SandboxProfile
from proliferate.db.models.cloud.agent_auth_gateway import AgentGatewayRuntimeGrant
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.store.cloud_agent_auth import store
from proliferate.db.store.cloud_sandboxes import ensure_managed_sandbox_for_target
from proliferate.db.store.cloud_sync import worker_auth as worker_auth_store
from proliferate.integrations.bifrost import (
    BifrostIntegrationError,
    BifrostLogEntry,
    BifrostLogSearchResult,
    BifrostProviderKeyResult,
    BifrostVirtualKeyResult,
)
from proliferate.server.cloud.agent_auth import service as agent_auth_service
from proliferate.server.cloud.agent_auth.runtime_keys import _runtime_grant_token_hash
from proliferate.server.cloud.worker import auth as worker_auth
from proliferate.server.cloud.worker.domain.types import WorkerAuthContext
from proliferate.utils.crypto import encrypt_text
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
    identity = AuthIdentity(
        user_id=user.id,
        provider="github",
        provider_subject=f"github-{user.id}",
        email=email,
        email_verified=True,
        display_name="Agent Auth Tester",
    )
    db_session.add(identity)
    await db_session.flush()
    db_session.add(
        ProviderGrant(
            user_id=user.id,
            auth_identity_id=identity.id,
            provider="github",
            access_token_ciphertext=encrypt_text("github-access-token"),
            scopes_json='["repo","user","user:email"]',
            status="ready",
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


def _codex_file_payload(api_key: str) -> dict[str, object]:
    return {
        "authMode": "file",
        "files": [
            {
                "relativePath": ".codex/auth.json",
                "contentBase64": b64encode(f'{{"OPENAI_API_KEY":"{api_key}"}}'.encode()).decode(
                    "ascii"
                ),
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
        "proliferate.server.cloud.agent_auth.service.settings."
        "agent_gateway_bifrost_isolation_verified",
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
        existing = next(
            (
                item
                for item in self.provider_keys
                if item["provider"] == kwargs["provider"] and item["key_id"] == kwargs["key_id"]
            ),
            None,
        )
        if existing is None and any(item["name"] == kwargs["name"] for item in self.provider_keys):
            raise BifrostIntegrationError(
                "Bifrost request failed with HTTP 500: API key names must be unique "
                "across providers."
            )
        if existing is None:
            self.provider_keys.append(dict(kwargs))
        else:
            existing.update(dict(kwargs))
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
async def test_synced_credential_cannot_be_selected_for_different_agent_slot(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    tokens = await _create_user_and_get_tokens(
        client,
        db_session,
        email="agent-auth-sync-cross-agent@example.com",
    )

    sync_response = await client.put(
        "/v1/cloud/agent-auth/credentials/synced/codex",
        headers=_headers(tokens),
        json=_codex_file_payload("sk-openai-test"),
    )
    assert sync_response.status_code == 200
    credential_id = sync_response.json()["credential"]["id"]

    profile_response = await client.post(
        "/v1/cloud/sandbox-profiles/personal",
        headers=_headers(tokens),
        json={},
    )
    assert profile_response.status_code == 200

    select_response = await client.put(
        f"/v1/cloud/sandbox-profiles/{profile_response.json()['id']}"
        "/agent-auth-selections/opencode/openai",
        headers=_headers(tokens),
        json={"credentialId": credential_id},
    )

    assert select_response.status_code == 400
    assert select_response.json()["detail"]["code"] == "synced_credential_agent_mismatch"


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
    profile_record = await store.get_sandbox_profile(db_session, profile_id)
    assert profile_record is not None
    await ensure_managed_sandbox_for_target(
        db_session,
        sandbox_profile_id=profile_id,
        target_id=target_id,
        billing_subject_id=profile_record.billing_subject_id,
    )
    worker_token = f"agent-auth-cleanup-{uuid.uuid4()}"
    await worker_auth_store.create_worker(
        db_session,
        target_id=target_id,
        token_hash=worker_auth.hash_token(
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
            "displayName": "Personal Anthropic gateway",
            "policyKind": "personal_byok",
            "providerKind": "anthropic_api_key",
            "payload": {"apiKey": "sk-ant-test"},
        },
    )

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "personal_byok_disabled"


@pytest.mark.asyncio
async def test_gateway_credential_provisions_bifrost_provider_key_when_byok_enabled(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _enable_anthropic_gateway_byok(monkeypatch)
    fake_bifrost = _enable_bifrost_gateway(monkeypatch)
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
            "displayName": "Personal Anthropic gateway",
            "policyKind": "personal_byok",
            "providerKind": "anthropic_api_key",
            "payload": {"apiKey": "sk-ant-test"},
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["credential"]["status"] == "ready"
    assert body["policy"]["litellmSyncStatus"] == "synced"
    assert body["policy"]["lastErrorCode"] is None
    assert body["providerCredential"]["validationStatus"] == "valid"
    assert body["providerCredential"]["redactedSummary"]["apiKey"] == "sk-a...test"
    assert len(fake_bifrost.provider_keys) == 1
    provider_key = fake_bifrost.provider_keys[0]
    assert provider_key["provider"] == "anthropic"
    assert provider_key["key_id"] == body["policy"]["litellmTeamId"]
    assert provider_key["value"] == "sk-ant-test"
    assert provider_key["models"] == ("claude-sonnet-4-6",)


@pytest.mark.asyncio
async def test_gateway_credential_rejects_mismatched_provider_id(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _enable_anthropic_gateway_byok(monkeypatch)
    tokens = await _create_user_and_get_tokens(
        client,
        db_session,
        email="agent-auth-gateway-provider-mismatch@example.com",
    )

    response = await client.post(
        "/v1/cloud/agent-auth/credentials/gateway",
        headers=_headers(tokens),
        json={
            "ownerScope": "personal",
            "credentialProviderId": "openai",
            "displayName": "Mismatched Anthropic gateway",
            "policyKind": "personal_byok",
            "providerKind": "anthropic_api_key",
            "payload": {"apiKey": "sk-ant-test"},
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "credential_provider_mismatch"


@pytest.mark.asyncio
async def test_ready_gateway_credential_can_be_selected(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _enable_anthropic_gateway_byok(monkeypatch)
    _enable_bifrost_gateway(monkeypatch)
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
            "displayName": "Ready Anthropic gateway",
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
        f"/v1/cloud/sandbox-profiles/{profile_id}/agent-auth-selections/claude/anthropic",
        headers=_headers(tokens),
        json={"credentialId": credential_id},
    )
    assert select_response.status_code == 200
    assert select_response.json()["credentialId"] == credential_id
    assert select_response.json()["authSlotId"] == "anthropic"

    legacy_select_response = await client.put(
        f"/v1/cloud/sandbox-profiles/{profile_id}/agent-auth-selections/claude",
        headers=_headers(tokens),
        json={"credentialId": credential_id},
    )
    assert legacy_select_response.status_code == 404


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
        credential_provider_id="anthropic",
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
        f"/v1/cloud/sandbox-profiles/{profile_response.json()['id']}/agent-auth-selections/claude/anthropic",
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
        credential_provider_id="anthropic",
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
        f"/v1/cloud/sandbox-profiles/{profile_response.json()['id']}/agent-auth-selections/claude/anthropic",
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
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings."
        "agent_gateway_managed_credit_agent_kinds",
        "claude",
    )
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings."
        "agent_gateway_managed_anthropic_api_key",
        "sk-ant-managed-test",
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
        "claude,codex,gemini",
    )
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings."
        "agent_gateway_managed_openai_api_key",
        "sk-openai-managed-test",
    )
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings."
        "agent_gateway_managed_gemini_api_key",
        "sk-gemini-managed-test",
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
    assert {item["agentKind"] for item in body["readyAgentModels"]} == {
        "claude",
        "codex",
        "gemini",
    }
    assert {credential["credentialProviderId"] for credential in body["credentials"]} == {
        "anthropic",
        "openai",
        "gemini",
    }
    assert len(fake_bifrost.provider_keys) == 3
    providers = {provider_key["provider"] for provider_key in fake_bifrost.provider_keys}
    assert providers == {"anthropic", "openai", "gemini"}
    provider_key_names = {str(provider_key["name"]) for provider_key in fake_bifrost.provider_keys}
    assert len(provider_key_names) == 3
    assert any("Anthropic" in name for name in provider_key_names)
    assert any("OpenAI" in name for name in provider_key_names)
    assert any("Gemini" in name for name in provider_key_names)
    assert body["budgetSubject"]["litellmTeamId"] in {
        provider_key["key_id"] for provider_key in fake_bifrost.provider_keys
    }
    assert "sk-ant-managed-test" not in str(body)

    repeat = await client.post(
        "/v1/cloud/agent-auth/free-credits/ensure",
        headers=_headers(tokens),
        json={},
    )

    assert repeat.status_code == 200
    assert repeat.json()["status"] == "ready"
    assert len(fake_bifrost.provider_keys) == 3

    profile = await store.get_active_personal_sandbox_profile_for_user(
        db_session,
        UUID(tokens["user_id"]),
    )
    assert profile is not None
    codex_credential_id = next(
        UUID(credential["id"])
        for credential in body["credentials"]
        if credential["credentialProviderId"] == "openai"
    )
    stale_credential = await store.update_credential_status(
        db_session,
        credential_id=codex_credential_id,
        status="ready",
        redacted_summary_json=json.dumps({"stale": True}, sort_keys=True),
    )
    assert stale_credential is not None
    stale_selection = next(
        selection
        for selection in await store.list_selections_for_profile(db_session, profile.id)
        if selection.agent_kind == "codex"
    )
    assert stale_selection.selected_revision != stale_credential.revision
    await db_session.commit()

    selection_refresh = await client.post(
        "/v1/cloud/agent-auth/free-credits/ensure",
        headers=_headers(tokens),
        json={},
    )

    assert selection_refresh.status_code == 200
    refreshed_credential = await store.get_credential(db_session, codex_credential_id)
    assert refreshed_credential is not None
    refreshed_selection = next(
        selection
        for selection in await store.list_selections_for_profile(db_session, profile.id)
        if selection.agent_kind == "codex"
    )
    assert refreshed_selection.selected_revision == refreshed_credential.revision


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
        "claude,codex,gemini",
    )
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings."
        "agent_gateway_managed_openai_api_key",
        "sk-openai-managed-test",
    )
    monkeypatch.setattr(
        "proliferate.server.cloud.agent_auth.service.settings."
        "agent_gateway_managed_gemini_api_key",
        "sk-gemini-managed-test",
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
    await ensure_managed_sandbox_for_target(
        db_session,
        sandbox_profile_id=profile.id,
        target_id=profile.primary_target_id,
        billing_subject_id=profile.billing_subject_id,
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
        token_hash=worker_auth.hash_token(
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
    assert claude["protectedEnv"]["ANTHROPIC_CUSTOM_HEADERS"] == "x-bf-vk: sk-bf-runtime-1"
    codex = selections["codex"]["gateway"]
    assert codex["protocolFacade"] == "openai"
    assert codex["baseUrls"]["openai"] == "https://bifrost.test/openai/v1"
    assert codex["runtimeGrantToken"] == "sk-bf-runtime-2"
    assert codex["protectedEnv"] == {
        "CODEX_API_KEY": "sk-bf-runtime-2",
        "OPENAI_API_KEY": "sk-bf-runtime-2",
        "CODEX_HOME": "/home/user/.proliferate/anyharness/agent-auth/codex",
    }
    assert codex["protectedConfig"]["codex"] == {
        "openai_base_url": "https://bifrost.test/openai/v1",
        "env_key": "CODEX_API_KEY",
        "model_provider": "proliferate",
        "model_providers": {
            "proliferate": {
                "name": "Proliferate Gateway",
                "base_url": "https://bifrost.test/openai/v1",
                "env_key": "CODEX_API_KEY",
                "wire_api": "responses",
                "requires_openai_auth": False,
            }
        },
    }
    gemini = selections["gemini"]["gateway"]
    assert gemini["protocolFacade"] == "genai"
    assert gemini["baseUrls"]["genai"] == "https://bifrost.test/genai"
    assert gemini["runtimeGrantToken"] == "sk-bf-runtime-3"
    assert gemini["protectedEnv"] == {
        "GEMINI_API_KEY": "sk-bf-runtime-3",
        "GOOGLE_GEMINI_BASE_URL": "https://bifrost.test/genai",
    }
    assert len(fake_bifrost.provider_keys) == 3
    provider_key_ids_by_provider = {
        str(provider_key["provider"]): str(provider_key["key_id"])
        for provider_key in fake_bifrost.provider_keys
    }
    assert len(fake_bifrost.virtual_keys) == 3
    for virtual_key in fake_bifrost.virtual_keys:
        provider_configs = virtual_key["provider_configs"]
        assert isinstance(provider_configs, list)
        provider = str(provider_configs[0]["provider"])
        assert provider_configs[0]["key_ids"] == [provider_key_ids_by_provider[provider]]
        assert provider_configs[0]["allowed_models"] != ["*"]
        assert provider_configs[0]["budgets"][0]["max_limit"] == 5.0


@pytest.mark.asyncio
async def test_bifrost_runtime_key_issuance_records_and_rotates_runtime_grants(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _enable_anthropic_gateway_byok(monkeypatch)
    fake_bifrost = _enable_bifrost_gateway(monkeypatch)
    tokens = await _create_user_and_get_tokens(
        client,
        db_session,
        email="agent-auth-bifrost-runtime-grant@example.com",
    )
    actor_user_id = UUID(tokens["user_id"])

    credential_response = await client.post(
        "/v1/cloud/agent-auth/credentials/gateway",
        headers=_headers(tokens),
        json={
            "ownerScope": "personal",
            "displayName": "Runtime Grant Anthropic BYOK",
            "policyKind": "personal_byok",
            "providerKind": "anthropic_api_key",
            "payload": {"apiKey": "sk-ant-runtime-grant"},
        },
    )
    assert credential_response.status_code == 200
    credential = credential_response.json()["credential"]

    profile_response = await client.post(
        "/v1/cloud/sandbox-profiles/personal",
        headers=_headers(tokens),
        json={},
    )
    assert profile_response.status_code == 200
    profile = await store.get_active_personal_sandbox_profile_for_user(db_session, actor_user_id)
    assert profile is not None and profile.primary_target_id is not None
    select_response = await client.put(
        f"/v1/cloud/sandbox-profiles/{profile.id}/agent-auth-selections/claude/anthropic",
        headers=_headers(tokens),
        json={"credentialId": credential["id"]},
    )
    assert select_response.status_code == 200
    await ensure_managed_sandbox_for_target(
        db_session,
        sandbox_profile_id=profile.id,
        target_id=profile.primary_target_id,
        billing_subject_id=profile.billing_subject_id,
    )
    selection = (await store.list_selections_for_profile(db_session, profile.id))[0]

    first = await agent_auth_service._issue_bifrost_runtime_virtual_key_for_selection(
        db_session,
        auth=WorkerAuthContext(
            target_id=profile.primary_target_id,
            worker_id=uuid.uuid4(),
        ),
        profile=profile,
        selection=selection,
    )
    first_grant = await store.get_runtime_grant_by_token_hash(
        db_session,
        _runtime_grant_token_hash(first.virtual_key),
    )
    assert first_grant is not None
    assert first_grant.selection_id == selection.id
    assert first_grant.target_id == profile.primary_target_id
    assert first.expires_at_iso == first_grant.expires_at.isoformat()

    second = await agent_auth_service._issue_bifrost_runtime_virtual_key_for_selection(
        db_session,
        auth=WorkerAuthContext(
            target_id=profile.primary_target_id,
            worker_id=uuid.uuid4(),
        ),
        profile=profile,
        selection=selection,
    )
    assert second.virtual_key == first.virtual_key
    assert len(fake_bifrost.virtual_keys) == 1

    profile_row = await db_session.get(SandboxProfile, profile.id)
    assert profile_row is not None
    profile_row.desired_agent_auth_revision = profile.agent_auth_revision + 1
    await db_session.flush()
    revised_profile = await store.get_sandbox_profile(db_session, profile.id)
    assert revised_profile is not None

    third = await agent_auth_service._issue_bifrost_runtime_virtual_key_for_selection(
        db_session,
        auth=WorkerAuthContext(
            target_id=profile.primary_target_id,
            worker_id=uuid.uuid4(),
        ),
        profile=revised_profile,
        selection=selection,
    )
    stale_revision_grant = await store.get_runtime_grant_by_token_hash(
        db_session,
        _runtime_grant_token_hash(first.virtual_key),
    )
    revised_grant = await store.get_runtime_grant_by_token_hash(
        db_session,
        _runtime_grant_token_hash(third.virtual_key),
    )
    assert third.virtual_key != first.virtual_key
    assert len(fake_bifrost.virtual_keys) == 2
    assert fake_bifrost.disabled_virtual_keys == [first.virtual_key_id]
    assert stale_revision_grant is not None
    assert stale_revision_grant.revoked_at is not None
    assert revised_grant is not None
    assert revised_grant.revoked_at is None
    assert revised_grant.issued_profile_revision == revised_profile.agent_auth_revision

    row = (
        await db_session.execute(
            select(AgentGatewayRuntimeGrant).where(AgentGatewayRuntimeGrant.id == revised_grant.id)
        )
    ).scalar_one()
    row.expires_at = utcnow() + timedelta(hours=12)
    await db_session.flush()

    fourth = await agent_auth_service._issue_bifrost_runtime_virtual_key_for_selection(
        db_session,
        auth=WorkerAuthContext(
            target_id=profile.primary_target_id,
            worker_id=uuid.uuid4(),
        ),
        profile=revised_profile,
        selection=selection,
    )
    expiring_grant = await store.get_runtime_grant_by_token_hash(
        db_session,
        _runtime_grant_token_hash(third.virtual_key),
    )
    new_grant = await store.get_runtime_grant_by_token_hash(
        db_session,
        _runtime_grant_token_hash(fourth.virtual_key),
    )
    assert fourth.virtual_key != third.virtual_key
    assert len(fake_bifrost.virtual_keys) == 3
    assert fake_bifrost.disabled_virtual_keys == [
        first.virtual_key_id,
        third.virtual_key_id,
    ]
    assert expiring_grant is not None and expiring_grant.revoked_at is not None
    assert new_grant is not None and new_grant.revoked_at is None


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
    await ensure_managed_sandbox_for_target(
        db_session,
        sandbox_profile_id=profile.id,
        target_id=profile.primary_target_id,
        billing_subject_id=profile.billing_subject_id,
    )
    selection = (await store.list_selections_for_profile(db_session, profile.id))[0]
    await agent_auth_service._issue_bifrost_runtime_virtual_key_for_selection(
        db_session,
        auth=WorkerAuthContext(
            target_id=profile.primary_target_id,
            worker_id=uuid.uuid4(),
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
    await ensure_managed_sandbox_for_target(
        db_session,
        sandbox_profile_id=profile.id,
        target_id=profile.primary_target_id,
        billing_subject_id=profile.billing_subject_id,
    )
    selection = (await store.list_selections_for_profile(db_session, profile.id))[0]
    await agent_auth_service._issue_bifrost_runtime_virtual_key_for_selection(
        db_session,
        auth=WorkerAuthContext(
            target_id=profile.primary_target_id,
            worker_id=uuid.uuid4(),
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
        f"/v1/cloud/sandbox-profiles/{profile.id}/agent-auth-selections/claude/anthropic",
        headers=_headers(tokens),
        json={"credentialId": credential["id"]},
    )
    assert select_response.status_code == 200
    selection = (await store.list_selections_for_profile(db_session, profile.id))[0]
    await ensure_managed_sandbox_for_target(
        db_session,
        sandbox_profile_id=profile.id,
        target_id=profile.primary_target_id,
        billing_subject_id=profile.billing_subject_id,
    )
    await agent_auth_service._issue_bifrost_runtime_virtual_key_for_selection(
        db_session,
        auth=WorkerAuthContext(
            target_id=profile.primary_target_id,
            worker_id=uuid.uuid4(),
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
        f"/v1/cloud/sandbox-profiles/{profile.id}/agent-auth-selections/claude/anthropic",
        headers=_headers(tokens),
        json={"credentialId": first_credential["id"]},
    )
    assert select_first.status_code == 200
    selection = (await store.list_selections_for_profile(db_session, profile.id))[0]
    await ensure_managed_sandbox_for_target(
        db_session,
        sandbox_profile_id=profile.id,
        target_id=profile.primary_target_id,
        billing_subject_id=profile.billing_subject_id,
    )
    await agent_auth_service._issue_bifrost_runtime_virtual_key_for_selection(
        db_session,
        auth=WorkerAuthContext(
            target_id=profile.primary_target_id,
            worker_id=uuid.uuid4(),
        ),
        profile=profile,
        selection=selection,
    )
    await db_session.commit()

    select_second = await client.put(
        f"/v1/cloud/sandbox-profiles/{profile.id}/agent-auth-selections/claude/anthropic",
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
        ),
        profile=profile,
        selection=selection,
    )
    await db_session.commit()

    name_prefix = (
        f"proliferate-claude-{selection.id.hex[:12]}-{profile.id.hex[:12]}-"
        f"{profile.primary_target_id.hex[:12]}-r"
    )
    assert all(item["name"].startswith(name_prefix) for item in fake_bifrost.virtual_keys)
    assert fake_bifrost.virtual_keys[0]["name"] != fake_bifrost.virtual_keys[1]["name"]
    assert fake_bifrost.updated_virtual_keys == []
    allowed_models = [
        item["provider_configs"][0]["allowed_models"] for item in fake_bifrost.virtual_keys
    ]
    assert allowed_models == [["claude-sonnet-4-6"], ["claude-sonnet-4-6"]]
    assert len(fake_bifrost.virtual_keys) == 2
