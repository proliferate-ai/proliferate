import asyncio
import base64
from datetime import UTC, datetime
import hashlib
import json
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import OAuthAccount
from proliferate.db.models.cloud import (
    CloudCredential,
    CloudMcpConnection,
    CloudMcpConnectionAuth,
    CloudRepoConfig,
    CloudRuntimeEnvironment,
    CloudSandbox,
    CloudWorkspace,
)
from proliferate.db.store.cloud_mcp.auth import (
    update_connection_auth_if_version,
    upsert_connection_auth,
)
from proliferate.db.store.cloud_mcp.oauth_flows import (
    claim_active_oauth_flow_by_state_hash,
    create_oauth_flow_canceling_existing,
)
from proliferate.db.store.cloud_mcp.oauth_clients import upsert_oauth_client
from proliferate.db.store.billing import ensure_personal_billing_subject
from proliferate.integrations.github import GitHubRepoBranches
from proliferate.integrations.mcp_oauth import TokenResponse
from proliferate.integrations.sandbox.base import ProviderSandboxState
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.repo_config import service as repo_config_service
from proliferate.server.cloud.repos import service as repos_service
from proliferate.server.cloud.runtime import service as runtime_service
from proliferate.server.cloud.runtime import credential_freshness as credential_freshness_service
from proliferate.server.cloud.runtime.anyharness_api import CloudRuntimeReconnectError
from proliferate.server.cloud.runtime.credential_freshness import CredentialFreshnessSnapshot
from proliferate.server.cloud.runtime.models import RuntimeConnectionTarget
from proliferate.server.cloud.workspaces import service as cloud_service
from proliferate.utils.crypto import decrypt_json, encrypt_json, encrypt_text


async def _billing_subject_for_user(db_session: AsyncSession, user_id: uuid.UUID):
    return await ensure_personal_billing_subject(db_session, user_id)


def _current_credential_freshness() -> CredentialFreshnessSnapshot:
    return CredentialFreshnessSnapshot(
        status="current",
        files_current=True,
        process_current=True,
        requires_restart=False,
        last_error=None,
        last_error_at=None,
        files_applied_at=None,
        process_applied_at=None,
    )


async def _register_and_login(client: AsyncClient, email: str) -> dict[str, str]:
    """Create a user via the user manager and obtain tokens via PKCE."""
    from proliferate.auth.models import UserCreate
    from proliferate.auth.users import UserManager
    from proliferate.db.engine import get_async_session
    from proliferate.db.store.users import get_user_db

    user_id: str | None = None
    async for session in get_async_session():
        async for user_db in get_user_db(session):
            manager = UserManager(user_db)
            user = await manager.create(
                UserCreate(email=email, password="unused-oauth-only", display_name="Cloud Tester"),
            )
            await session.commit()
            user_id = str(user.id)

    assert user_id is not None

    verifier = "test-code-verifier-that-is-long-enough-for-pkce"
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")

    resp = await client.post(
        "/auth/desktop/authorize",
        params={"user_id": user_id},
        json={
            "state": f"cloud-state-{uuid.uuid4().hex[:8]}",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "redirect_uri": "proliferate://auth/callback",
        },
    )
    assert resp.status_code == 201
    code = resp.json()["code"]

    resp = await client.post(
        "/auth/desktop/token",
        json={
            "code": code,
            "code_verifier": verifier,
            "grant_type": "authorization_code",
        },
    )
    assert resp.status_code == 200
    token_data = resp.json()
    return {
        "user_id": user_id,
        "access_token": token_data["access_token"],
    }


async def _link_github_account(db_session: AsyncSession, user_id: str) -> None:
    account = OAuthAccount(
        user_id=uuid.UUID(user_id),
        oauth_name="github",
        access_token="github-access-token",
        account_id="12345",
        account_email="cloud@example.com",
    )
    db_session.add(account)
    await db_session.commit()


async def _link_secondary_account(db_session: AsyncSession, user_id: str) -> None:
    account = OAuthAccount(
        user_id=uuid.UUID(user_id),
        oauth_name="google",
        access_token="google-access-token",
        account_id="secondary-12345",
        account_email="cloud-secondary@example.com",
    )
    db_session.add(account)
    await db_session.commit()


async def _list_credentials(db_session: AsyncSession, user_id: str) -> list[CloudCredential]:
    return (
        (
            await db_session.execute(
                select(CloudCredential).where(CloudCredential.user_id == uuid.UUID(user_id))
            )
        )
        .scalars()
        .all()
    )


async def _list_mcp_connections(
    db_session: AsyncSession,
    user_id: str,
) -> list[CloudMcpConnection]:
    return (
        (
            await db_session.execute(
                select(CloudMcpConnection).where(CloudMcpConnection.user_id == uuid.UUID(user_id))
            )
        )
        .scalars()
        .all()
    )


async def _list_mcp_connection_auths(
    db_session: AsyncSession,
) -> list[CloudMcpConnectionAuth]:
    return (await db_session.execute(select(CloudMcpConnectionAuth))).scalars().all()


def _disable_workspace_provision(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        cloud_service,
        "schedule_workspace_provision",
        lambda _workspace_id, **_kwargs: None,
    )


async def _configure_repo(
    client: AsyncClient,
    headers: dict[str, str],
    *,
    git_owner: str,
    git_repo_name: str,
    default_branch: str | None = None,
) -> None:
    response = await client.put(
        f"/v1/cloud/repos/{git_owner}/{git_repo_name}/config",
        headers=headers,
        json={
            "configured": True,
            "defaultBranch": default_branch,
            "envVars": {},
            "setupScript": "",
            "files": [],
        },
    )
    assert response.status_code == 200


def _patch_repo_branches_lookup(
    monkeypatch: pytest.MonkeyPatch,
    resolver,
) -> None:
    monkeypatch.setattr(repos_service, "get_github_repo_branches", resolver)
    monkeypatch.setattr(cloud_service, "get_github_repo_branches", resolver)
    monkeypatch.setattr(repo_config_service, "get_repo_branches_for_user", resolver)


class TestCloudCredentials:
    @pytest.mark.asyncio
    async def test_sync_and_delete_supported_credentials(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        session = await _register_and_login(client, "cloud-creds@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}

        claude_response = await client.put(
            "/v1/cloud/credentials/claude",
            headers=headers,
            json={
                "authMode": "env",
                "envVars": {"ANTHROPIC_API_KEY": "test-anthropic-key"},
            },
        )
        assert claude_response.status_code == 200

        codex_file = base64.b64encode(
            json.dumps({"auth_mode": "chatgpt", "tokens": {"access_token": "opaque"}}).encode(
                "utf-8"
            )
        ).decode("ascii")
        codex_response = await client.put(
            "/v1/cloud/credentials/codex",
            headers=headers,
            json={
                "authMode": "file",
                "files": [
                    {
                        "relativePath": ".codex/auth.json",
                        "contentBase64": codex_file,
                    }
                ],
            },
        )
        assert codex_response.status_code == 200

        statuses_response = await client.get("/v1/cloud/credentials", headers=headers)
        assert statuses_response.status_code == 200
        statuses_payload = statuses_response.json()
        assert statuses_payload[0]["provider"] == "claude"
        assert statuses_payload[0]["authMode"] == "env"
        assert statuses_payload[0]["supported"] is True
        assert statuses_payload[0]["localDetected"] is False
        assert statuses_payload[0]["synced"] is True
        assert isinstance(statuses_payload[0]["lastSyncedAt"], str)
        assert statuses_payload[1]["provider"] == "codex"
        assert statuses_payload[1]["authMode"] == "file"
        assert statuses_payload[1]["supported"] is True
        assert statuses_payload[1]["localDetected"] is False
        assert statuses_payload[1]["synced"] is True
        assert isinstance(statuses_payload[1]["lastSyncedAt"], str)

        records = await _list_credentials(db_session, session["user_id"])
        assert len(records) == 2

        delete_response = await client.delete("/v1/cloud/credentials/codex", headers=headers)
        assert delete_response.status_code == 200

        statuses_after_delete = await client.get("/v1/cloud/credentials", headers=headers)
        assert statuses_after_delete.status_code == 200
        assert statuses_after_delete.json()[1]["synced"] is False

    @pytest.mark.asyncio
    async def test_unchanged_credential_sync_touches_active_row(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        session = await _register_and_login(client, "cloud-creds-idempotent@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        payload = {
            "authMode": "env",
            "envVars": {"ANTHROPIC_API_KEY": "test-anthropic-key"},
        }

        response = await client.put("/v1/cloud/credentials/claude", headers=headers, json=payload)
        assert response.status_code == 200
        records = await _list_credentials(db_session, session["user_id"])
        assert len(records) == 1
        record = records[0]
        assert record is not None
        record_id = record.id
        old_synced_at = datetime(2024, 1, 1, tzinfo=UTC)
        record.last_synced_at = old_synced_at
        await db_session.commit()

        response = await client.put("/v1/cloud/credentials/claude", headers=headers, json=payload)
        assert response.status_code == 200

        db_session.expire_all()
        records = await _list_credentials(db_session, session["user_id"])
        assert len(records) == 1
        assert records[0].id == record_id
        assert records[0].revoked_at is None
        assert records[0].last_synced_at > old_synced_at

    @pytest.mark.asyncio
    async def test_changed_credential_sync_versions_active_row(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        session = await _register_and_login(client, "cloud-creds-versioned@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}

        first = await client.put(
            "/v1/cloud/credentials/claude",
            headers=headers,
            json={
                "authMode": "env",
                "envVars": {"ANTHROPIC_API_KEY": "first-key"},
            },
        )
        assert first.status_code == 200
        second = await client.put(
            "/v1/cloud/credentials/claude",
            headers=headers,
            json={
                "authMode": "env",
                "envVars": {"ANTHROPIC_API_KEY": "second-key"},
            },
        )
        assert second.status_code == 200

        records = await _list_credentials(db_session, session["user_id"])
        active_records = [record for record in records if record.revoked_at is None]
        assert len(records) == 2
        assert len(active_records) == 1

    @pytest.mark.asyncio
    async def test_sync_claude_file_backed_credential(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        """Claude file-backed auth sync via .claude/.credentials.json."""
        session = await _register_and_login(client, "cloud-claude-file@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}

        cred_file = base64.b64encode(
            json.dumps(
                {
                    "claudeAiOauth": {
                        "accessToken": "test-access-token",
                        "refreshToken": "test-refresh",
                    }
                }
            ).encode("utf-8")
        ).decode("ascii")
        response = await client.put(
            "/v1/cloud/credentials/claude",
            headers=headers,
            json={
                "authMode": "file",
                "files": [
                    {
                        "relativePath": ".claude/.credentials.json",
                        "contentBase64": cred_file,
                    }
                ],
            },
        )
        assert response.status_code == 200

        statuses = await client.get("/v1/cloud/credentials", headers=headers)
        assert statuses.status_code == 200
        claude_status = statuses.json()[0]
        assert claude_status["provider"] == "claude"
        assert claude_status["authMode"] == "file"
        assert claude_status["synced"] is True

    @pytest.mark.asyncio
    async def test_sync_claude_file_backed_rejects_unapproved_path(
        self,
        client: AsyncClient,
    ) -> None:
        """Only allowlisted Claude auth files are accepted."""
        session = await _register_and_login(client, "cloud-claude-file-bad@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}

        cred_file = base64.b64encode(b'{"some":"data"}').decode("ascii")
        response = await client.put(
            "/v1/cloud/credentials/claude",
            headers=headers,
            json={
                "authMode": "file",
                "files": [
                    {
                        "relativePath": ".claude/some-random-file.json",
                        "contentBase64": cred_file,
                    }
                ],
            },
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "invalid_payload"


class TestCloudMcpConnections:
    @pytest.mark.asyncio
    async def test_catalog_connection_secret_and_materialization_flow(
        self,
        client: AsyncClient,
    ) -> None:
        session = await _register_and_login(client, "cloud-mcp-v2-secret@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}

        catalog = await client.get("/v1/cloud/mcp/catalog", headers=headers)
        assert catalog.status_code == 200
        assert catalog.json()["catalogVersion"]
        context7_entry = next(
            entry for entry in catalog.json()["entries"] if entry["id"] == "context7"
        )
        assert context7_entry["secretFields"] == context7_entry["requiredFields"]
        assert context7_entry["displayUrl"] == "https://mcp.context7.com/mcp"
        posthog_entry = next(
            entry for entry in catalog.json()["entries"] if entry["id"] == "posthog"
        )
        assert posthog_entry["settingsSchema"][0]["id"] == "region"
        assert posthog_entry["settingsSchema"][0]["defaultValue"] == "us"

        created = await client.post(
            "/v1/cloud/mcp/connections",
            headers=headers,
            json={"catalogEntryId": "context7", "enabled": True},
        )
        assert created.status_code == 200
        connection_id = created.json()["connectionId"]
        assert created.json()["authStatus"] == "needs_reconnect"

        authed = await client.put(
            f"/v1/cloud/mcp/connections/{connection_id}/auth/secret",
            headers=headers,
            json={"secretFields": {"api_key": "ctx7sk-example"}},
        )
        assert authed.status_code == 200
        assert authed.json()["authStatus"] == "ready"

        materialized = await client.post(
            "/v1/cloud/mcp/materialize",
            headers=headers,
            json={"targetLocation": "local"},
        )
        assert materialized.status_code == 200
        body = materialized.json()
        assert body["catalogVersion"]
        assert body["mcpServers"][0]["transport"] == "http"
        assert body["mcpServers"][0]["headers"][0]["name"] == "Authorization"
        assert "ctx7sk-example" not in json.dumps(body["mcpBindingSummaries"])
        assert "ctx7sk-example" not in json.dumps(body["warnings"])

    @pytest.mark.asyncio
    async def test_posthog_settings_and_secret_materialization(
        self,
        client: AsyncClient,
    ) -> None:
        session = await _register_and_login(client, "cloud-mcp-posthog@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}

        created = await client.post(
            "/v1/cloud/mcp/connections",
            headers=headers,
            json={
                "catalogEntryId": "posthog",
                "enabled": True,
                "settings": {
                    "region": "eu",
                    "organizationId": "org_123",
                    "features": "flags",
                },
            },
        )
        assert created.status_code == 200
        assert created.json()["settings"] == {
            "features": "flags",
            "organizationId": "org_123",
            "region": "eu",
        }

        authed = await client.put(
            f"/v1/cloud/mcp/connections/{created.json()['connectionId']}/auth/secret",
            headers=headers,
            json={"secretFields": {"apiKey": "phx-example"}},
        )
        assert authed.status_code == 200

        materialized = await client.post(
            "/v1/cloud/mcp/materialize",
            headers=headers,
            json={"targetLocation": "cloud"},
        )
        assert materialized.status_code == 200
        server = materialized.json()["mcpServers"][0]
        assert server["url"] == "https://mcp-eu.posthog.com/mcp?features=flags"
        headers_by_name = {header["name"]: header["value"] for header in server["headers"]}
        assert headers_by_name["Authorization"] == "Bearer phx-example"
        assert headers_by_name["x-posthog-organization-id"] == "org_123"
        assert "phx-example" not in json.dumps(materialized.json()["mcpBindingSummaries"])

    @pytest.mark.asyncio
    async def test_schema_settings_defaults_and_legacy_supabase_kind(
        self,
        client: AsyncClient,
    ) -> None:
        session = await _register_and_login(client, "cloud-mcp-settings@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}

        posthog = await client.post(
            "/v1/cloud/mcp/connections",
            headers=headers,
            json={"catalogEntryId": "posthog", "enabled": True},
        )
        assert posthog.status_code == 200
        assert posthog.json()["settings"] == {"region": "us"}

        supabase = await client.post(
            "/v1/cloud/mcp/connections",
            headers=headers,
            json={
                "catalogEntryId": "supabase",
                "enabled": True,
                "settings": {
                    "kind": "supabase",
                    "projectRef": "abcd1234",
                    "readOnly": False,
                },
            },
        )
        assert supabase.status_code == 200
        assert supabase.json()["settings"] == {
            "projectRef": "abcd1234",
            "readOnly": False,
        }

    @pytest.mark.asyncio
    async def test_local_stdio_materializes_as_candidate_without_workspace_path(
        self,
        client: AsyncClient,
    ) -> None:
        session = await _register_and_login(client, "cloud-mcp-v2-stdio@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}

        created = await client.post(
            "/v1/cloud/mcp/connections",
            headers=headers,
            json={"catalogEntryId": "filesystem", "enabled": True},
        )
        assert created.status_code == 200

        local = await client.post(
            "/v1/cloud/mcp/materialize",
            headers=headers,
            json={"targetLocation": "local"},
        )
        assert local.status_code == 200
        local_body = local.json()
        assert local_body["mcpServers"] == []
        assert local_body["localStdioCandidates"][0]["catalogEntryId"] == "filesystem"
        assert "/Users/" not in json.dumps(local_body)

        cloud = await client.post(
            "/v1/cloud/mcp/materialize",
            headers=headers,
            json={"targetLocation": "cloud"},
        )
        assert cloud.status_code == 200
        cloud_body = cloud.json()
        assert cloud_body["localStdioCandidates"] == []
        assert cloud_body["warnings"][0]["kind"] == "unsupported_target"

    @pytest.mark.asyncio
    async def test_unchanged_mcp_sync_touches_existing_row(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        session = await _register_and_login(client, "cloud-mcp-idempotent@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        payload = {
            "catalogEntryId": "context7",
            "secretFields": {"api_key": "ctx7sk-example"},
        }

        response = await client.put(
            "/v1/cloud/mcp-connections/connection-1",
            headers=headers,
            json=payload,
        )
        assert response.status_code == 200
        records = await _list_mcp_connections(db_session, session["user_id"])
        assert len(records) == 1
        record = records[0]
        assert record is not None
        record_id = record.id
        old_synced_at = datetime(2024, 1, 1, tzinfo=UTC)
        record.last_synced_at = old_synced_at
        await db_session.commit()

        response = await client.put(
            "/v1/cloud/mcp-connections/connection-1",
            headers=headers,
            json=payload,
        )
        assert response.status_code == 200
        statuses = await client.get("/v1/cloud/mcp-connections/statuses", headers=headers)
        assert statuses.status_code == 200
        status_body = statuses.json()
        assert len(status_body) == 1
        assert status_body[0]["connectionId"] == "connection-1"
        assert status_body[0]["catalogEntryId"] == "context7"
        assert status_body[0]["synced"] is True
        assert isinstance(status_body[0]["lastSyncedAt"], str)

        db_session.expire_all()
        records = await _list_mcp_connections(db_session, session["user_id"])
        assert len(records) == 1
        assert records[0].id == record_id
        assert records[0].last_synced_at > old_synced_at
        auths = await _list_mcp_connection_auths(db_session)
        assert len(auths) == 1

    @pytest.mark.asyncio
    async def test_auth_compare_and_swap_rejects_stale_refresh_write(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        session = await _register_and_login(client, "cloud-mcp-auth-version@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        created = await client.post(
            "/v1/cloud/mcp/connections",
            headers=headers,
            json={"catalogEntryId": "linear", "enabled": True},
        )
        assert created.status_code == 200
        records = await _list_mcp_connections(db_session, session["user_id"])
        assert len(records) == 1

        initial = await upsert_connection_auth(
            connection_db_id=records[0].id,
            auth_kind="oauth",
            auth_status="ready",
            payload_ciphertext=encrypt_json({"accessToken": "first"}),
            payload_format="oauth-bundle-v1",
        )
        updated = await update_connection_auth_if_version(
            connection_db_id=records[0].id,
            expected_auth_version=initial.auth_version,
            auth_kind="oauth",
            auth_status="ready",
            payload_ciphertext=encrypt_json({"accessToken": "second"}),
            payload_format="oauth-bundle-v1",
        )
        assert updated is not None
        assert updated.auth_version == initial.auth_version + 1

        stale = await update_connection_auth_if_version(
            connection_db_id=records[0].id,
            expected_auth_version=initial.auth_version,
            auth_kind="oauth",
            auth_status="ready",
            payload_ciphertext=encrypt_json({"accessToken": "stale"}),
            payload_format="oauth-bundle-v1",
        )
        assert stale is None

        db_session.expire_all()
        auths = await _list_mcp_connection_auths(db_session)
        assert len(auths) == 1
        assert auths[0].auth_version == updated.auth_version
        assert auths[0].payload_ciphertext is not None
        assert decrypt_json(auths[0].payload_ciphertext)["accessToken"] == "second"

    @pytest.mark.asyncio
    async def test_materialization_partial_resolver_error_keeps_other_connections(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        session = await _register_and_login(client, "cloud-mcp-partial-failure@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        context7 = await client.post(
            "/v1/cloud/mcp/connections",
            headers=headers,
            json={"catalogEntryId": "context7", "enabled": True},
        )
        assert context7.status_code == 200
        linear = await client.post(
            "/v1/cloud/mcp/connections",
            headers=headers,
            json={"catalogEntryId": "linear", "enabled": True},
        )
        assert linear.status_code == 200
        authed = await client.put(
            f"/v1/cloud/mcp/connections/{context7.json()['connectionId']}/auth/secret",
            headers=headers,
            json={"secretFields": {"api_key": "ctx7sk-example"}},
        )
        assert authed.status_code == 200

        db_session.expire_all()
        records = await _list_mcp_connections(db_session, session["user_id"])
        linear_record = next(
            record for record in records if record.catalog_entry_id == "linear"
        )
        await upsert_connection_auth(
            connection_db_id=linear_record.id,
            auth_kind="oauth",
            auth_status="ready",
            payload_ciphertext=encrypt_json(
                {
                    "issuer": "https://linear.example.com",
                    "resource": "https://mcp.linear.app/mcp",
                    "clientId": "client-id",
                    "accessToken": "old-access-token",
                    "refreshToken": "refresh-token",
                    "expiresAt": datetime(2024, 1, 1, tzinfo=UTC).isoformat(),
                    "scopes": [],
                    "tokenEndpoint": "https://linear.example.com/token",
                }
            ),
            payload_format="oauth-bundle-v1",
        )

        async def _raise_provider_error(**_kwargs: object) -> object:
            raise RuntimeError("provider unavailable")

        monkeypatch.setattr(
            "proliferate.server.cloud.mcp_materialization.service.refresh_token",
            _raise_provider_error,
        )

        response = await client.post(
            "/v1/cloud/mcp/materialize",
            headers=headers,
            json={"targetLocation": "cloud"},
        )

        assert response.status_code == 200
        body = response.json()
        assert [server["catalogEntryId"] for server in body["mcpServers"]] == ["context7"]
        assert any(
            warning["catalogEntryId"] == "linear"
            and warning["kind"] == "resolver_error"
            for warning in body["warnings"]
        )
        assert any(
            summary["id"] == linear.json()["connectionId"]
            and summary["outcome"] == "not_applied"
            and summary["reason"] == "resolver_error"
            for summary in body["mcpBindingSummaries"]
        )
        assert "provider unavailable" not in json.dumps(body)

    @pytest.mark.asyncio
    async def test_oauth_callback_claim_prevents_duplicate_exchange(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        session = await _register_and_login(client, "cloud-mcp-oauth-claim@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        created = await client.post(
            "/v1/cloud/mcp/connections",
            headers=headers,
            json={"catalogEntryId": "linear", "enabled": True},
        )
        assert created.status_code == 200
        records = await _list_mcp_connections(db_session, session["user_id"])
        assert len(records) == 1

        state_hash = hashlib.sha256(b"oauth-state").hexdigest()
        flow = await create_oauth_flow_canceling_existing(
            connection_db_id=records[0].id,
            user_id=uuid.UUID(session["user_id"]),
            state_hash=state_hash,
            code_verifier_ciphertext=encrypt_text("verifier"),
            issuer="https://linear.example.com",
            resource="https://mcp.linear.app/mcp",
            client_id="client-id",
            token_endpoint="https://linear.example.com/token",
            requested_scopes="[]",
            redirect_uri="https://api.example.com/v1/cloud/mcp/oauth/callback",
            authorization_url="https://linear.example.com/authorize",
            expires_at=datetime(2099, 1, 1, tzinfo=UTC),
        )

        claimed = await claim_active_oauth_flow_by_state_hash(state_hash)
        assert claimed is not None
        assert claimed.id == flow.id
        assert claimed.status == "exchanging"
        assert await claim_active_oauth_flow_by_state_hash(state_hash) is None

    @pytest.mark.asyncio
    async def test_oauth_callback_uses_cached_dcr_client_secret(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        session = await _register_and_login(client, "cloud-mcp-oauth-secret@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        created = await client.post(
            "/v1/cloud/mcp/connections",
            headers=headers,
            json={
                "catalogEntryId": "supabase",
                "enabled": True,
                "settings": {"projectRef": "abc"},
            },
        )
        assert created.status_code == 200
        records = await _list_mcp_connections(db_session, session["user_id"])
        assert len(records) == 1

        redirect_uri = "https://api.example.com/v1/cloud/mcp/oauth/callback"
        await upsert_oauth_client(
            issuer="https://api.supabase.com",
            redirect_uri=redirect_uri,
            catalog_entry_id="supabase",
            resource="https://mcp.supabase.com/mcp?project_ref=abc&read_only=true",
            client_id="client-id",
            client_secret_ciphertext=encrypt_text("client-secret"),
            client_secret_expires_at=None,
            token_endpoint_auth_method=None,
            registration_client_uri=None,
            registration_access_token_ciphertext=None,
        )
        state = "oauth-state-with-secret"
        flow = await create_oauth_flow_canceling_existing(
            connection_db_id=records[0].id,
            user_id=uuid.UUID(session["user_id"]),
            state_hash=hashlib.sha256(state.encode("utf-8")).hexdigest(),
            code_verifier_ciphertext=encrypt_text("verifier"),
            issuer="https://api.supabase.com",
            resource="https://mcp.supabase.com/mcp?project_ref=abc&read_only=true",
            client_id="client-id",
            token_endpoint="https://api.supabase.com/v1/oauth/token",
            requested_scopes="[]",
            redirect_uri=redirect_uri,
            authorization_url="https://api.supabase.com/v1/oauth/authorize",
            expires_at=datetime(2099, 1, 1, tzinfo=UTC),
        )
        captured: dict[str, object] = {}

        async def _exchange_token(**kwargs: object) -> TokenResponse:
            captured.update(kwargs)
            return TokenResponse(
                access_token="access-token",
                refresh_token="refresh-token",
                expires_at=datetime(2099, 1, 1, tzinfo=UTC),
                scopes=(),
            )

        monkeypatch.setattr(
            "proliferate.server.cloud.mcp_oauth.service.exchange_token",
            _exchange_token,
        )

        response = await client.get(
            "/v1/cloud/mcp/oauth/callback",
            params={"state": state, "code": "auth-code"},
        )

        assert response.status_code == 200
        assert "Authorization complete" in response.text
        assert "Open Proliferate" in response.text
        assert (
            "proliferate://powers?source=mcp_oauth_callback&amp;status=completed" in response.text
        )
        assert "access-token" not in response.text
        assert "refresh-token" not in response.text
        assert captured["client_secret"] == "client-secret"
        assert captured["token_endpoint_auth_method"] is None

        db_session.expire_all()
        stored = await claim_active_oauth_flow_by_state_hash(flow.state_hash)
        assert stored is None
        auths = await _list_mcp_connection_auths(db_session)
        assert len(auths) == 1
        assert auths[0].payload_ciphertext is not None
        payload = decrypt_json(auths[0].payload_ciphertext)
        assert payload["redirectUri"] == redirect_uri

    @pytest.mark.asyncio
    async def test_oauth_callback_failure_uses_safe_handoff_page(
        self,
        client: AsyncClient,
    ) -> None:
        response = await client.get(
            "/v1/cloud/mcp/oauth/callback",
            params={"error": "access_denied", "state": "stale-state"},
        )

        assert response.status_code == 200
        assert "Authorization failed" in response.text
        assert "Open Proliferate" in response.text
        assert "access_denied" not in response.text
        assert "proliferate://powers?source=mcp_oauth_callback&amp;status=failed" in response.text

    @pytest.mark.asyncio
    async def test_changed_mcp_sync_rewrites_existing_row(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        session = await _register_and_login(client, "cloud-mcp-changed@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}

        first = await client.put(
            "/v1/cloud/mcp-connections/connection-1",
            headers=headers,
            json={
                "catalogEntryId": "context7",
                "secretFields": {"api_key": "ctx7sk-example"},
            },
        )
        assert first.status_code == 200
        records = await _list_mcp_connections(db_session, session["user_id"])
        assert len(records) == 1
        auths = await _list_mcp_connection_auths(db_session)
        assert len(auths) == 1
        old_ciphertext = auths[0].payload_ciphertext

        second = await client.put(
            "/v1/cloud/mcp-connections/connection-1",
            headers=headers,
            json={
                "catalogEntryId": "context7",
                "secretFields": {"api_key": "ctx7sk-updated"},
            },
        )
        assert second.status_code == 200

        db_session.expire_all()
        auths = await _list_mcp_connection_auths(db_session)
        assert len(auths) == 1
        assert auths[0].payload_ciphertext != old_ciphertext


class TestCloudRepoConfig:
    @pytest.mark.asyncio
    async def test_save_and_get_repo_config_persists_default_branch(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        async def _repo_branches(*_args, **_kwargs) -> GitHubRepoBranches:
            return GitHubRepoBranches(
                default_branch="main",
                branches=["main", "release"],
            )

        _patch_repo_branches_lookup(monkeypatch, _repo_branches)

        session = await _register_and_login(client, "cloud-repo-default-branch@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        await _link_github_account(db_session, session["user_id"])

        save_response = await client.put(
            "/v1/cloud/repos/proliferate-ai/proliferate/config",
            headers=headers,
            json={
                "configured": True,
                "defaultBranch": "release",
                "envVars": {"API_BASE_URL": "https://example.internal"},
                "setupScript": "pnpm install",
                "files": [],
            },
        )

        assert save_response.status_code == 200
        assert save_response.json()["defaultBranch"] == "release"

        get_response = await client.get(
            "/v1/cloud/repos/proliferate-ai/proliferate/config",
            headers=headers,
        )
        assert get_response.status_code == 200
        assert get_response.json()["defaultBranch"] == "release"

        record = (
            await db_session.execute(
                select(CloudRepoConfig).where(
                    CloudRepoConfig.user_id == uuid.UUID(session["user_id"]),
                    CloudRepoConfig.git_owner == "proliferate-ai",
                    CloudRepoConfig.git_repo_name == "proliferate",
                )
            )
        ).scalar_one()
        assert record.default_branch == "release"

    @pytest.mark.asyncio
    async def test_save_repo_config_rejects_unknown_default_branch(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        async def _repo_branches(*_args, **_kwargs) -> GitHubRepoBranches:
            return GitHubRepoBranches(
                default_branch="main",
                branches=["main", "release"],
            )

        _patch_repo_branches_lookup(monkeypatch, _repo_branches)

        session = await _register_and_login(
            client, "cloud-repo-invalid-default-branch@example.com"
        )
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        await _link_github_account(db_session, session["user_id"])

        save_response = await client.put(
            "/v1/cloud/repos/proliferate-ai/proliferate/config",
            headers=headers,
            json={
                "configured": True,
                "defaultBranch": "definitely-not-a-branch",
                "envVars": {},
                "setupScript": "",
                "files": [],
            },
        )

        assert save_response.status_code == 400
        assert save_response.json()["detail"]["code"] == "github_branch_not_found"

    @pytest.mark.asyncio
    async def test_concurrent_first_save_returns_success(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        session = await _register_and_login(client, "cloud-repo-config-race@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        payload = {
            "configured": True,
            "envVars": {"API_BASE_URL": "https://example.internal"},
            "setupScript": "pnpm install",
            "files": [],
        }

        responses = await asyncio.gather(
            client.put(
                "/v1/cloud/repos/proliferate-ai/proliferate/config",
                headers=headers,
                json=payload,
            ),
            client.put(
                "/v1/cloud/repos/proliferate-ai/proliferate/config",
                headers=headers,
                json=payload,
            ),
        )

        assert [response.status_code for response in responses] == [200, 200]

        records = (
            (
                await db_session.execute(
                    select(CloudRepoConfig).where(
                        CloudRepoConfig.user_id == uuid.UUID(session["user_id"]),
                        CloudRepoConfig.git_owner == "proliferate-ai",
                        CloudRepoConfig.git_repo_name == "proliferate",
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(records) == 1

    @pytest.mark.asyncio
    async def test_sync_claude_main_config_rejects_nonportable_oauth_metadata(
        self,
        client: AsyncClient,
    ) -> None:
        session = await _register_and_login(client, "cloud-claude-main-config@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}

        nonportable = base64.b64encode(
            json.dumps(
                {
                    "oauthAccount": {
                        "accountUuid": "account-123",
                        "organizationUuid": "org-123",
                        "emailAddress": "user@example.com",
                    }
                }
            ).encode("utf-8")
        ).decode("ascii")
        response = await client.put(
            "/v1/cloud/credentials/claude",
            headers=headers,
            json={
                "authMode": "file",
                "files": [
                    {
                        "relativePath": ".claude.json",
                        "contentBase64": nonportable,
                    }
                ],
            },
        )

        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "invalid_payload"

    @pytest.mark.asyncio
    async def test_sync_claude_file_backed_rejects_invalid_base64_json(
        self,
        client: AsyncClient,
    ) -> None:
        """File content must be valid base64-encoded JSON."""
        session = await _register_and_login(client, "cloud-claude-file-nojson@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}

        bad_b64 = base64.b64encode(b"not json {{{").decode("ascii")
        response = await client.put(
            "/v1/cloud/credentials/claude",
            headers=headers,
            json={
                "authMode": "file",
                "files": [
                    {
                        "relativePath": ".claude/.credentials.json",
                        "contentBase64": bad_b64,
                    }
                ],
            },
        )
        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_sync_claude_env_still_works(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        """The existing env-var path continues to work."""
        session = await _register_and_login(client, "cloud-claude-env-still@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}

        response = await client.put(
            "/v1/cloud/credentials/claude",
            headers=headers,
            json={
                "authMode": "env",
                "envVars": {"ANTHROPIC_API_KEY": "sk-ant-test-key"},
            },
        )
        assert response.status_code == 200

        statuses = await client.get("/v1/cloud/credentials", headers=headers)
        claude_status = statuses.json()[0]
        assert claude_status["authMode"] == "env"
        assert claude_status["synced"] is True

    @pytest.mark.asyncio
    async def test_sync_claude_file_replaces_previous_env_credential(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        """Syncing file-backed auth replaces a previously synced env credential."""
        session = await _register_and_login(client, "cloud-claude-replace@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}

        # First sync env
        await client.put(
            "/v1/cloud/credentials/claude",
            headers=headers,
            json={
                "authMode": "env",
                "envVars": {"ANTHROPIC_API_KEY": "sk-ant-old"},
            },
        )

        # Then sync file
        cred_file = base64.b64encode(
            json.dumps({"claudeAiOauth": {"accessToken": "new-access"}}).encode("utf-8")
        ).decode("ascii")
        response = await client.put(
            "/v1/cloud/credentials/claude",
            headers=headers,
            json={
                "authMode": "file",
                "files": [
                    {
                        "relativePath": ".claude/.credentials.json",
                        "contentBase64": cred_file,
                    }
                ],
            },
        )
        assert response.status_code == 200

        statuses = await client.get("/v1/cloud/credentials", headers=headers)
        claude_status = statuses.json()[0]
        assert claude_status["authMode"] == "file"
        assert claude_status["synced"] is True

        # Only one active (non-revoked) Claude credential should exist
        records = await _list_credentials(db_session, session["user_id"])
        active_claude = [r for r in records if r.provider == "claude" and r.revoked_at is None]
        assert len(active_claude) == 1
        assert active_claude[0].auth_mode == "file"


class TestCloudRepoBranches:
    @pytest.mark.asyncio
    async def test_branch_endpoint_returns_default_branch_and_list(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        async def _repo_branches(*_args, **_kwargs) -> GitHubRepoBranches:
            return GitHubRepoBranches(
                default_branch="main",
                branches=["main", "release", "stable"],
            )

        _patch_repo_branches_lookup(monkeypatch, _repo_branches)

        session = await _register_and_login(client, "cloud-branches@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        await _link_github_account(db_session, session["user_id"])

        response = await client.get(
            "/v1/cloud/repos/acme/rocket/branches",
            headers=headers,
        )

        assert response.status_code == 200
        assert response.json() == {
            "defaultBranch": "main",
            "branches": ["main", "release", "stable"],
        }


class TestCloudWorkspaces:
    @pytest.mark.asyncio
    async def test_create_workspace_uses_saved_cloud_default_branch_when_base_missing(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        _disable_workspace_provision(monkeypatch)

        async def _repo_branches(*_args, **_kwargs) -> GitHubRepoBranches:
            return GitHubRepoBranches(
                default_branch="main",
                branches=["main", "release"],
            )

        _patch_repo_branches_lookup(monkeypatch, _repo_branches)

        session = await _register_and_login(client, "cloud-create-saved-default@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        await _link_github_account(db_session, session["user_id"])
        await _configure_repo(
            client,
            headers,
            git_owner="acme",
            git_repo_name="rocket",
            default_branch="release",
        )

        sync_response = await client.put(
            "/v1/cloud/credentials/claude",
            headers=headers,
            json={
                "authMode": "env",
                "envVars": {"ANTHROPIC_API_KEY": "test-anthropic-key"},
            },
        )
        assert sync_response.status_code == 200

        create_response = await client.post(
            "/v1/cloud/workspaces",
            headers=headers,
            json={
                "gitProvider": "github",
                "gitOwner": "acme",
                "gitRepoName": "rocket",
                "branchName": "pure-drift",
            },
        )

        assert create_response.status_code == 200
        assert create_response.json()["repo"]["baseBranch"] == "release"

    @pytest.mark.asyncio
    async def test_create_workspace_uses_github_default_when_saved_cloud_default_is_null(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        _disable_workspace_provision(monkeypatch)
        logged_events: list[tuple[str, dict[str, object]]] = []

        async def _repo_branches(*_args, **_kwargs) -> GitHubRepoBranches:
            return GitHubRepoBranches(
                default_branch="main",
                branches=["main", "release"],
            )

        _patch_repo_branches_lookup(monkeypatch, _repo_branches)
        monkeypatch.setattr(
            cloud_service,
            "log_cloud_event",
            lambda message, **kwargs: logged_events.append((message, kwargs)),
        )

        session = await _register_and_login(client, "cloud-create-null-default@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        await _link_github_account(db_session, session["user_id"])
        await _configure_repo(
            client,
            headers,
            git_owner="acme",
            git_repo_name="rocket",
            default_branch=None,
        )

        sync_response = await client.put(
            "/v1/cloud/credentials/claude",
            headers=headers,
            json={
                "authMode": "env",
                "envVars": {"ANTHROPIC_API_KEY": "test-anthropic-key"},
            },
        )
        assert sync_response.status_code == 200

        create_response = await client.post(
            "/v1/cloud/workspaces",
            headers=headers,
            json={
                "gitProvider": "github",
                "gitOwner": "acme",
                "gitRepoName": "rocket",
                "branchName": "pure-drift",
            },
        )

        assert create_response.status_code == 200
        assert create_response.json()["repo"]["baseBranch"] == "main"
        assert all(
            message != "cloud repo default branch missing on github; falling back"
            for message, _kwargs in logged_events
        )

    @pytest.mark.asyncio
    async def test_create_workspace_falls_back_to_github_default_when_saved_default_is_stale(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        _disable_workspace_provision(monkeypatch)
        logged_events: list[tuple[str, dict[str, object]]] = []

        async def _initial_repo_branches(*_args, **_kwargs) -> GitHubRepoBranches:
            return GitHubRepoBranches(
                default_branch="main",
                branches=["main", "release", "legacy-release"],
            )

        _patch_repo_branches_lookup(monkeypatch, _initial_repo_branches)
        monkeypatch.setattr(
            cloud_service,
            "log_cloud_event",
            lambda message, **kwargs: logged_events.append((message, kwargs)),
        )

        session = await _register_and_login(client, "cloud-create-stale-default@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        await _link_github_account(db_session, session["user_id"])
        await _configure_repo(
            client,
            headers,
            git_owner="acme",
            git_repo_name="rocket",
            default_branch="legacy-release",
        )

        async def _stale_repo_branches(*_args, **_kwargs) -> GitHubRepoBranches:
            return GitHubRepoBranches(
                default_branch="main",
                branches=["main", "release"],
            )

        _patch_repo_branches_lookup(monkeypatch, _stale_repo_branches)

        sync_response = await client.put(
            "/v1/cloud/credentials/claude",
            headers=headers,
            json={
                "authMode": "env",
                "envVars": {"ANTHROPIC_API_KEY": "test-anthropic-key"},
            },
        )
        assert sync_response.status_code == 200

        create_response = await client.post(
            "/v1/cloud/workspaces",
            headers=headers,
            json={
                "gitProvider": "github",
                "gitOwner": "acme",
                "gitRepoName": "rocket",
                "branchName": "pure-drift",
            },
        )

        assert create_response.status_code == 200
        assert create_response.json()["repo"]["baseBranch"] == "main"
        assert (
            "cloud repo default branch missing on github; falling back",
            {
                "user_id": uuid.UUID(session["user_id"]),
                "repo": "acme/rocket",
                "saved_default_branch": "legacy-release",
                "github_default_branch": "main",
            },
        ) in logged_events

    @pytest.mark.asyncio
    async def test_create_workspace_explicit_base_branch_overrides_saved_cloud_default(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        _disable_workspace_provision(monkeypatch)

        async def _repo_branches(*_args, **_kwargs) -> GitHubRepoBranches:
            return GitHubRepoBranches(
                default_branch="main",
                branches=["main", "release"],
            )

        _patch_repo_branches_lookup(monkeypatch, _repo_branches)

        session = await _register_and_login(client, "cloud-create-explicit-base@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        await _link_github_account(db_session, session["user_id"])
        await _configure_repo(
            client,
            headers,
            git_owner="acme",
            git_repo_name="rocket",
            default_branch="release",
        )

        sync_response = await client.put(
            "/v1/cloud/credentials/claude",
            headers=headers,
            json={
                "authMode": "env",
                "envVars": {"ANTHROPIC_API_KEY": "test-anthropic-key"},
            },
        )
        assert sync_response.status_code == 200

        create_response = await client.post(
            "/v1/cloud/workspaces",
            headers=headers,
            json={
                "gitProvider": "github",
                "gitOwner": "acme",
                "gitRepoName": "rocket",
                "baseBranch": "main",
                "branchName": "pure-drift",
            },
        )

        assert create_response.status_code == 200
        assert create_response.json()["repo"]["baseBranch"] == "main"

    @pytest.mark.asyncio
    async def test_create_workspace_requires_linked_github_and_synced_credentials(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        _disable_workspace_provision(monkeypatch)

        async def _repo_branches(*_args, **_kwargs) -> GitHubRepoBranches:
            return GitHubRepoBranches(
                default_branch="main",
                branches=["main", "release"],
            )

        _patch_repo_branches_lookup(monkeypatch, _repo_branches)

        session = await _register_and_login(client, "cloud-create-gating@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        request = {
            "gitProvider": "github",
            "gitOwner": "acme",
            "gitRepoName": "rocket",
            "baseBranch": "main",
            "branchName": "pure-drift",
            "origin": {"kind": "system", "entrypoint": "local_runtime"},
        }

        no_github = await client.post("/v1/cloud/workspaces", headers=headers, json=request)
        assert no_github.status_code == 400
        assert no_github.json()["detail"]["code"] == "github_link_required"

        await _link_github_account(db_session, session["user_id"])
        await _configure_repo(client, headers, git_owner="acme", git_repo_name="rocket")

        no_creds = await client.post("/v1/cloud/workspaces", headers=headers, json=request)
        assert no_creds.status_code == 400
        assert no_creds.json()["detail"]["code"] == "missing_supported_credentials"

        sync_response = await client.put(
            "/v1/cloud/credentials/claude",
            headers=headers,
            json={
                "authMode": "env",
                "envVars": {"ANTHROPIC_API_KEY": "test-anthropic-key"},
            },
        )
        assert sync_response.status_code == 200

        create_response = await client.post("/v1/cloud/workspaces", headers=headers, json=request)
        assert create_response.status_code == 200
        payload = create_response.json()
        assert payload["repo"] == {
            "provider": "github",
            "owner": "acme",
            "name": "rocket",
            "branch": "pure-drift",
            "baseBranch": "main",
        }
        assert payload["workspaceStatus"] == "pending"
        assert payload["allowedAgentKinds"] == ["claude", "codex", "gemini"]
        assert payload["readyAgentKinds"] == ["claude"]
        assert payload["runtime"]["generation"] == 0
        assert payload["origin"] == {"kind": "human", "entrypoint": "cloud"}

        list_response = await client.get("/v1/cloud/workspaces", headers=headers)
        assert list_response.status_code == 200
        list_payload = list_response.json()
        assert list_payload[0]["origin"] == {"kind": "human", "entrypoint": "cloud"}

        detail_response = await client.get(
            f"/v1/cloud/workspaces/{payload['id']}",
            headers=headers,
        )
        assert detail_response.status_code == 200
        assert detail_response.json()["origin"] == {"kind": "human", "entrypoint": "cloud"}

    @pytest.mark.asyncio
    async def test_create_workspace_requires_github_repo_access(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        _disable_workspace_provision(monkeypatch)

        async def _repo_branches(*_args, **_kwargs) -> GitHubRepoBranches:
            return GitHubRepoBranches(
                default_branch="main",
                branches=["main", "release"],
            )

        async def _deny_repo_access(*_args, **_kwargs) -> GitHubRepoBranches:
            raise CloudApiError(
                "github_repo_access_required",
                "Reconnect GitHub and grant repository access before creating a cloud workspace.",
                status_code=400,
            )

        _patch_repo_branches_lookup(monkeypatch, _repo_branches)

        session = await _register_and_login(client, "cloud-create-repo-access@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        await _link_github_account(db_session, session["user_id"])
        await _configure_repo(client, headers, git_owner="acme", git_repo_name="rocket")

        sync_response = await client.put(
            "/v1/cloud/credentials/claude",
            headers=headers,
            json={
                "authMode": "env",
                "envVars": {"ANTHROPIC_API_KEY": "test-anthropic-key"},
            },
        )
        assert sync_response.status_code == 200

        _patch_repo_branches_lookup(monkeypatch, _deny_repo_access)

        create_response = await client.post(
            "/v1/cloud/workspaces",
            headers=headers,
            json={
                "gitProvider": "github",
                "gitOwner": "acme",
                "gitRepoName": "rocket",
                "baseBranch": "main",
                "branchName": "pure-drift",
            },
        )
        assert create_response.status_code == 400
        assert create_response.json()["detail"]["code"] == "github_repo_access_required"

    @pytest.mark.asyncio
    async def test_create_workspace_rejects_existing_cloud_branch_name(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        _disable_workspace_provision(monkeypatch)

        async def _repo_branches(*_args, **_kwargs) -> GitHubRepoBranches:
            return GitHubRepoBranches(
                default_branch="main",
                branches=["main", "release"],
            )

        _patch_repo_branches_lookup(monkeypatch, _repo_branches)

        session = await _register_and_login(client, "cloud-create-duplicate-branch@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        await _link_github_account(db_session, session["user_id"])
        await _configure_repo(client, headers, git_owner="acme", git_repo_name="rocket")

        await client.put(
            "/v1/cloud/credentials/claude",
            headers=headers,
            json={
                "authMode": "env",
                "envVars": {"ANTHROPIC_API_KEY": "test-anthropic-key"},
            },
        )

        request = {
            "gitProvider": "github",
            "gitOwner": "acme",
            "gitRepoName": "rocket",
            "baseBranch": "main",
            "branchName": "pure-drift",
        }

        first_response = await client.post("/v1/cloud/workspaces", headers=headers, json=request)
        assert first_response.status_code == 200

        second_response = await client.post("/v1/cloud/workspaces", headers=headers, json=request)
        assert second_response.status_code == 400
        assert second_response.json()["detail"]["code"] == "cloud_branch_already_exists"

    @pytest.mark.asyncio
    async def test_create_workspace_rejects_missing_base_branch(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        _disable_workspace_provision(monkeypatch)

        async def _repo_branches(*_args, **_kwargs) -> GitHubRepoBranches:
            return GitHubRepoBranches(
                default_branch="main",
                branches=["main", "release"],
            )

        _patch_repo_branches_lookup(monkeypatch, _repo_branches)

        session = await _register_and_login(client, "cloud-create-missing-base@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        await _link_github_account(db_session, session["user_id"])
        await _configure_repo(client, headers, git_owner="acme", git_repo_name="rocket")

        await client.put(
            "/v1/cloud/credentials/claude",
            headers=headers,
            json={
                "authMode": "env",
                "envVars": {"ANTHROPIC_API_KEY": "test-anthropic-key"},
            },
        )

        response = await client.post(
            "/v1/cloud/workspaces",
            headers=headers,
            json={
                "gitProvider": "github",
                "gitOwner": "acme",
                "gitRepoName": "rocket",
                "baseBranch": "pure-drift",
                "branchName": "cloud-branch",
            },
        )

        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "github_branch_not_found"

    @pytest.mark.asyncio
    async def test_create_workspace_rejects_existing_remote_branch_name(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        _disable_workspace_provision(monkeypatch)

        async def _repo_branches(*_args, **_kwargs) -> GitHubRepoBranches:
            return GitHubRepoBranches(
                default_branch="main",
                branches=["main", "pure-drift"],
            )

        _patch_repo_branches_lookup(monkeypatch, _repo_branches)

        session = await _register_and_login(client, "cloud-create-existing-branch@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        await _link_github_account(db_session, session["user_id"])
        await _configure_repo(client, headers, git_owner="acme", git_repo_name="rocket")

        await client.put(
            "/v1/cloud/credentials/claude",
            headers=headers,
            json={
                "authMode": "env",
                "envVars": {"ANTHROPIC_API_KEY": "test-anthropic-key"},
            },
        )

        response = await client.post(
            "/v1/cloud/workspaces",
            headers=headers,
            json={
                "gitProvider": "github",
                "gitOwner": "acme",
                "gitRepoName": "rocket",
                "baseBranch": "main",
                "branchName": "pure-drift",
            },
        )

        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "github_branch_already_exists"

    @pytest.mark.asyncio
    async def test_connection_returns_runtime_ready_agents(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        async def _workspace_connection(_workspace: CloudWorkspace) -> RuntimeConnectionTarget:
            return RuntimeConnectionTarget(
                runtime_url="https://example-runtime.invalid",
                access_token="runtime-token",
                anyharness_workspace_id="workspace-123",
                runtime_generation=2,
                ready_agent_kinds=["codex"],
                credential_freshness=_current_credential_freshness(),
            )

        monkeypatch.setattr(cloud_service, "get_workspace_connection", _workspace_connection)

        session = await _register_and_login(client, "cloud-connection-ready@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        user_id = uuid.UUID(session["user_id"])
        billing_subject = await _billing_subject_for_user(db_session, user_id)

        workspace = CloudWorkspace(
            user_id=user_id,
            billing_subject_id=billing_subject.id,
            display_name="acme/rocket",
            git_provider="github",
            git_owner="acme",
            git_repo_name="rocket",
            git_branch="cloud-branch",
            git_base_branch="main",
            status="ready",
            status_detail="Ready",
            last_error=None,
            template_version="v1",
            runtime_generation=2,
            runtime_url="https://example-runtime.invalid",
            runtime_token_ciphertext=encrypt_text("runtime-token"),
            anyharness_workspace_id="workspace-123",
        )
        db_session.add(workspace)
        await db_session.commit()
        await db_session.refresh(workspace)

        sandbox = CloudSandbox(
            cloud_workspace_id=workspace.id,
            provider="e2b",
            external_sandbox_id=f"sandbox-{uuid.uuid4()}",
            status="paused",
            template_version="v1",
        )
        db_session.add(sandbox)
        await db_session.commit()
        workspace.active_sandbox_id = sandbox.id
        await db_session.commit()

        response = await client.get(
            f"/v1/cloud/workspaces/{workspace.id}/connection",
            headers=headers,
        )

        assert response.status_code == 200
        assert response.json()["readyAgentKinds"] == ["codex"]

    @pytest.mark.asyncio
    async def test_connection_returns_not_ready_when_runtime_probe_fails(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        async def _boom(*_args, **_kwargs) -> RuntimeConnectionTarget:
            raise CloudRuntimeReconnectError("runtime down")

        monkeypatch.setattr(cloud_service, "get_workspace_connection", _boom)

        session = await _register_and_login(client, "cloud-connection-not-ready@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        user_id = uuid.UUID(session["user_id"])
        billing_subject = await _billing_subject_for_user(db_session, user_id)

        workspace = CloudWorkspace(
            user_id=user_id,
            billing_subject_id=billing_subject.id,
            display_name="acme/rocket",
            git_provider="github",
            git_owner="acme",
            git_repo_name="rocket",
            git_branch="cloud-branch",
            git_base_branch="main",
            status="ready",
            status_detail="Ready",
            last_error=None,
            template_version="v1",
            runtime_generation=1,
            runtime_url="https://example-runtime.invalid",
            runtime_token_ciphertext=encrypt_text("runtime-token"),
            anyharness_workspace_id="workspace-123",
        )
        db_session.add(workspace)
        await db_session.commit()
        await db_session.refresh(workspace)

        sandbox = CloudSandbox(
            cloud_workspace_id=workspace.id,
            provider="e2b",
            external_sandbox_id=f"sandbox-{uuid.uuid4()}",
            status="paused",
            template_version="v1",
        )
        db_session.add(sandbox)
        await db_session.commit()
        workspace.active_sandbox_id = sandbox.id
        await db_session.commit()

        response = await client.get(
            f"/v1/cloud/workspaces/{workspace.id}/connection",
            headers=headers,
        )

        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "workspace_not_ready"

    @pytest.mark.asyncio
    async def test_sync_credentials_succeeds_when_agent_reconcile_fails(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        class _FakeProvider:
            async def connect_running_sandbox(self, _sandbox_id: str) -> object:
                return object()

            async def get_sandbox_state(self, sandbox_id: str) -> ProviderSandboxState:
                return ProviderSandboxState(
                    external_sandbox_id=sandbox_id,
                    state="running",
                    started_at=None,
                    end_at=None,
                    observed_at=datetime.now(UTC),
                    metadata={},
                )

            async def resolve_runtime_context(self, _sandbox: object) -> object:
                return object()

        async def _write_files(*_args, **_kwargs) -> None:
            return None

        async def _boom(*_args, **_kwargs) -> None:
            raise RuntimeError("codex install failed")

        monkeypatch.setattr(
            cloud_service,
            "sync_workspace_credentials",
            runtime_service.sync_workspace_credentials,
        )
        monkeypatch.setattr(
            credential_freshness_service,
            "get_sandbox_provider",
            lambda _kind: _FakeProvider(),
        )
        monkeypatch.setattr(credential_freshness_service, "write_credential_files", _write_files)
        monkeypatch.setattr(credential_freshness_service, "reconcile_remote_agents", _boom)

        session = await _register_and_login(client, "cloud-sync-credentials@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        user_id = uuid.UUID(session["user_id"])
        billing_subject = await _billing_subject_for_user(db_session, user_id)
        environment = CloudRuntimeEnvironment(
            user_id=user_id,
            organization_id=None,
            created_by_user_id=user_id,
            billing_subject_id=billing_subject.id,
            git_provider="github",
            git_owner="acme",
            git_repo_name="rocket",
            git_owner_norm="acme",
            git_repo_name_norm="rocket",
            isolation_policy="repo_shared",
            status="running",
            runtime_url="https://example-runtime.invalid",
            runtime_token_ciphertext=encrypt_text("runtime-token"),
            anyharness_data_key_ciphertext=encrypt_text("runtime-data-key"),
            runtime_generation=2,
            credential_process_applied_revision="credential-process:v1:empty",
        )
        db_session.add(environment)
        await db_session.commit()
        await db_session.refresh(environment)

        credential = CloudCredential(
            user_id=user_id,
            provider="codex",
            auth_mode="file",
            payload_ciphertext=encrypt_json(
                {
                    "authMode": "file",
                    "files": {".codex/auth.json": '{"access_token":"opaque"}'},
                }
            ),
            payload_format="json-v1",
        )
        db_session.add(credential)
        await db_session.commit()

        workspace = CloudWorkspace(
            user_id=user_id,
            billing_subject_id=billing_subject.id,
            runtime_environment_id=environment.id,
            display_name="acme/rocket",
            git_provider="github",
            git_owner="acme",
            git_repo_name="rocket",
            git_branch="cloud-branch",
            git_base_branch="main",
            status="ready",
            status_detail="Ready",
            last_error=None,
            template_version="v1",
            runtime_generation=2,
            runtime_url="https://example-runtime.invalid",
            runtime_token_ciphertext=encrypt_text("runtime-token"),
            anyharness_workspace_id="workspace-123",
        )
        db_session.add(workspace)
        await db_session.commit()
        await db_session.refresh(workspace)

        sandbox = CloudSandbox(
            runtime_environment_id=environment.id,
            cloud_workspace_id=workspace.id,
            provider="e2b",
            external_sandbox_id=f"sandbox-{uuid.uuid4()}",
            status="running",
            template_version="v1",
        )
        db_session.add(sandbox)
        await db_session.commit()
        environment.active_sandbox_id = sandbox.id
        workspace.active_sandbox_id = sandbox.id
        await db_session.commit()

        response = await client.post(
            f"/v1/cloud/workspaces/{workspace.id}/sync-credentials",
            headers=headers,
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["workspaceStatus"] == "ready"
        assert payload["runtime"]["generation"] == 2

    @pytest.mark.asyncio
    async def test_start_workspace_from_error_requeues_materialization(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        scheduled: list[uuid.UUID] = []

        class _FakeProvider:
            async def get_sandbox_state(self, sandbox_id: str) -> ProviderSandboxState:
                return ProviderSandboxState(
                    external_sandbox_id=sandbox_id,
                    state="paused",
                    started_at=None,
                    end_at=None,
                    observed_at=datetime.now(UTC),
                    metadata={},
                )

            async def resume_sandbox(self, _sandbox_id: str) -> None:
                return None

        async def _repo_branches(*_args, **_kwargs) -> GitHubRepoBranches:
            return GitHubRepoBranches(
                default_branch="main",
                branches=["main"],
            )

        _patch_repo_branches_lookup(monkeypatch, _repo_branches)
        monkeypatch.setattr(
            cloud_service,
            "schedule_workspace_provision",
            lambda workspace_id, **_kwargs: scheduled.append(workspace_id),
        )
        monkeypatch.setattr(cloud_service, "get_sandbox_provider", lambda _kind: _FakeProvider())

        session = await _register_and_login(client, "cloud-start-reuse@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        await _link_github_account(db_session, session["user_id"])
        user_id = uuid.UUID(session["user_id"])
        billing_subject = await _billing_subject_for_user(db_session, user_id)

        await client.put(
            "/v1/cloud/credentials/claude",
            headers=headers,
            json={
                "authMode": "env",
                "envVars": {"ANTHROPIC_API_KEY": "test-anthropic-key"},
            },
        )

        workspace = CloudWorkspace(
            user_id=user_id,
            billing_subject_id=billing_subject.id,
            display_name="acme/rocket",
            git_provider="github",
            git_owner="acme",
            git_repo_name="rocket",
            git_branch="cloud-branch",
            git_base_branch="main",
            status="error",
            status_detail="Reconnect failed",
            last_error="runtime down",
            template_version="v1",
            runtime_generation=3,
            runtime_url="https://example-runtime.invalid",
            runtime_token_ciphertext=encrypt_text("runtime-token"),
            anyharness_workspace_id="workspace-123",
        )
        db_session.add(workspace)
        await db_session.commit()
        await db_session.refresh(workspace)

        sandbox = CloudSandbox(
            cloud_workspace_id=workspace.id,
            provider="e2b",
            external_sandbox_id=f"sandbox-{uuid.uuid4()}",
            status="paused",
            template_version="v1",
        )
        db_session.add(sandbox)
        await db_session.commit()
        workspace.active_sandbox_id = sandbox.id
        await db_session.commit()

        response = await client.post(
            f"/v1/cloud/workspaces/{workspace.id}/start",
            headers=headers,
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["workspaceStatus"] == "materializing"
        assert payload["runtime"]["generation"] == 3
        assert scheduled == [workspace.id]

    @pytest.mark.asyncio
    async def test_start_workspace_from_error_requeues_materialization_with_error_sandbox(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        scheduled: list[uuid.UUID] = []

        class _FakeProvider:
            async def get_sandbox_state(self, sandbox_id: str) -> ProviderSandboxState:
                return ProviderSandboxState(
                    external_sandbox_id=sandbox_id,
                    state="running",
                    started_at=None,
                    end_at=None,
                    observed_at=datetime.now(UTC),
                    metadata={},
                )

        async def _repo_branches(*_args, **_kwargs) -> GitHubRepoBranches:
            return GitHubRepoBranches(
                default_branch="main",
                branches=["main"],
            )

        _patch_repo_branches_lookup(monkeypatch, _repo_branches)
        monkeypatch.setattr(
            cloud_service,
            "schedule_workspace_provision",
            lambda workspace_id, **_kwargs: scheduled.append(workspace_id),
        )
        monkeypatch.setattr(cloud_service, "get_sandbox_provider", lambda _kind: _FakeProvider())

        session = await _register_and_login(client, "cloud-start-reprovision@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        await _link_github_account(db_session, session["user_id"])
        user_id = uuid.UUID(session["user_id"])
        billing_subject = await _billing_subject_for_user(db_session, user_id)

        await client.put(
            "/v1/cloud/credentials/claude",
            headers=headers,
            json={
                "authMode": "env",
                "envVars": {"ANTHROPIC_API_KEY": "test-anthropic-key"},
            },
        )

        workspace = CloudWorkspace(
            user_id=user_id,
            billing_subject_id=billing_subject.id,
            display_name="acme/rocket",
            git_provider="github",
            git_owner="acme",
            git_repo_name="rocket",
            git_branch="cloud-branch",
            git_base_branch="main",
            status="error",
            status_detail="Reconnect failed",
            last_error="runtime down",
            template_version="v1",
            runtime_generation=3,
            runtime_url="https://example-runtime.invalid",
            runtime_token_ciphertext=encrypt_text("runtime-token"),
            anyharness_workspace_id="workspace-123",
        )
        db_session.add(workspace)
        await db_session.commit()
        await db_session.refresh(workspace)

        sandbox = CloudSandbox(
            cloud_workspace_id=workspace.id,
            provider="e2b",
            external_sandbox_id=f"sandbox-{uuid.uuid4()}",
            status="error",
            template_version="v1",
        )
        db_session.add(sandbox)
        await db_session.commit()
        workspace.active_sandbox_id = sandbox.id
        await db_session.commit()

        response = await client.post(
            f"/v1/cloud/workspaces/{workspace.id}/start",
            headers=headers,
        )

        assert response.status_code == 200
        assert response.json()["workspaceStatus"] == "materializing"
        assert scheduled == [workspace.id]

    @pytest.mark.asyncio
    async def test_update_display_name_persists_and_clears(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        session = await _register_and_login(client, "cloud-display-name-set@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        user_id = uuid.UUID(session["user_id"])
        billing_subject = await _billing_subject_for_user(db_session, user_id)

        workspace = CloudWorkspace(
            user_id=user_id,
            billing_subject_id=billing_subject.id,
            display_name=None,
            git_provider="github",
            git_owner="acme",
            git_repo_name="rocket",
            git_branch="cloud-branch",
            git_base_branch="main",
            status="ready",
            status_detail="Ready",
            last_error=None,
            template_version="v1",
            runtime_generation=1,
        )
        db_session.add(workspace)
        await db_session.commit()
        await db_session.refresh(workspace)

        # Set with surrounding whitespace — server should trim and persist.
        set_response = await client.patch(
            f"/v1/cloud/workspaces/{workspace.id}/display-name",
            headers=headers,
            json={"displayName": "  My Custom Cloud Name  "},
        )
        assert set_response.status_code == 200
        assert set_response.json()["displayName"] == "My Custom Cloud Name"

        await db_session.refresh(workspace)
        assert workspace.display_name == "My Custom Cloud Name"

        # Empty string clears the override.
        clear_via_empty = await client.patch(
            f"/v1/cloud/workspaces/{workspace.id}/display-name",
            headers=headers,
            json={"displayName": "   "},
        )
        assert clear_via_empty.status_code == 200
        assert clear_via_empty.json()["displayName"] is None

        # Set again, then clear via null.
        await client.patch(
            f"/v1/cloud/workspaces/{workspace.id}/display-name",
            headers=headers,
            json={"displayName": "Pinned again"},
        )
        clear_via_null = await client.patch(
            f"/v1/cloud/workspaces/{workspace.id}/display-name",
            headers=headers,
            json={"displayName": None},
        )
        assert clear_via_null.status_code == 200
        assert clear_via_null.json()["displayName"] is None

        await db_session.refresh(workspace)
        assert workspace.display_name is None

    @pytest.mark.asyncio
    async def test_update_display_name_rejects_too_long(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        session = await _register_and_login(client, "cloud-display-name-too-long@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        user_id = uuid.UUID(session["user_id"])
        billing_subject = await _billing_subject_for_user(db_session, user_id)

        workspace = CloudWorkspace(
            user_id=user_id,
            billing_subject_id=billing_subject.id,
            display_name=None,
            git_provider="github",
            git_owner="acme",
            git_repo_name="rocket",
            git_branch="cloud-branch",
            git_base_branch="main",
            status="ready",
            status_detail="Ready",
            last_error=None,
            template_version="v1",
            runtime_generation=1,
        )
        db_session.add(workspace)
        await db_session.commit()
        await db_session.refresh(workspace)

        response = await client.patch(
            f"/v1/cloud/workspaces/{workspace.id}/display-name",
            headers=headers,
            json={"displayName": "x" * 161},
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "invalid_display_name"

    @pytest.mark.asyncio
    async def test_update_display_name_returns_404_for_unknown_workspace(
        self,
        client: AsyncClient,
    ) -> None:
        session = await _register_and_login(client, "cloud-display-name-404@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}

        response = await client.patch(
            f"/v1/cloud/workspaces/{uuid.uuid4()}/display-name",
            headers=headers,
            json={"displayName": "anything"},
        )
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "workspace_not_found"
