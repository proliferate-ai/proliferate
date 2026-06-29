import asyncio
import base64
from datetime import UTC, datetime, timedelta
import hashlib
import json
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.billing import BILLING_MODE_OBSERVE
from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_ROLE_MEMBER,
    ORGANIZATION_ROLE_OWNER,
    ORGANIZATION_STATUS_ACTIVE,
)
from proliferate.db.models.auth import OAuthAccount
from proliferate.db.models.cloud.integrations import (
    CloudIntegrationAccount,
    CloudIntegrationOAuthFlow,
)
from proliferate.db.models.cloud.repo_config import CloudRepoConfig
from proliferate.db.models.cloud.repositories import RepoConfig, RepoEnvironment
from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.models.cloud.worktree_policy import CloudWorktreeRetentionPolicy
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.store import github_app as github_app_store
from proliferate.db.store.cloud_mcp.auth import (
    update_connection_auth_if_version,
    upsert_connection_auth,
)
from proliferate.db.store.cloud_mcp.oauth_flows import (
    claim_active_oauth_flow_by_state_hash,
    create_oauth_flow_canceling_existing,
)
from proliferate.db.store.cloud_mcp.oauth_clients import upsert_oauth_client
from proliferate.db.store.billing_subjects import ensure_personal_billing_subject
from proliferate.integrations.github import (
    GitHubAppInstallationInfo,
    GitHubRepositoryPage,
    GitHubRepositorySummary,
    GitHubRepoBranches,
)
from proliferate.integrations.github.app_user_tokens import GitHubAppUserAuthorization
from proliferate.integrations.mcp_oauth import (
    AuthorizationServerMetadata,
    ProtectedResourceMetadata,
    RegisteredOAuthClient,
)
from proliferate.integrations.mcp_remote import McpRemoteError, McpRemoteTool
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.github_app import repo_authority
from proliferate.server.cloud.repo_config import service as repo_config_service
from proliferate.server.cloud.repos import service as repos_service
from proliferate.integrations.anyharness import CloudRuntimeReconnectError
from proliferate.server.cloud.runtime.credentials.auth_status import RuntimeAuthStateSnapshot
from proliferate.server.cloud.runtime.models import RuntimeConnectionTarget
from proliferate.server.cloud.workspaces.provisioning import preflight as provisioning_preflight
from proliferate.server.cloud.workspaces.provisioning import service as provisioning_service
from proliferate.server.cloud.workspaces.remote_access import service as remote_service
from proliferate.utils.crypto import decrypt_json, encrypt_text
from tests.helpers.desktop_auth import mint_desktop_token_payload


async def _billing_subject_for_user(db_session: AsyncSession, user_id: uuid.UUID):
    return await ensure_personal_billing_subject(db_session, user_id)


def _current_runtime_auth() -> RuntimeAuthStateSnapshot:
    return RuntimeAuthStateSnapshot(
        status="current",
        config_current=True,
        target_current=True,
        requires_restart=False,
        desired_revision=1,
        applied_revision=1,
        last_error=None,
        last_error_at=None,
        last_attempted_at=None,
        last_applied_at=None,
    )


def _claude_file_payload(api_key: str) -> dict[str, object]:
    return {
        "authMode": "file",
        "files": [
            {
                "relativePath": ".claude.json",
                "contentBase64": base64.b64encode(f'{{"apiKey":"{api_key}"}}'.encode()).decode(
                    "ascii"
                ),
            }
        ],
    }


async def _register_and_login(
    client: AsyncClient,
    email: str,
    *,
    link_github: bool = True,
) -> dict[str, str]:
    """Create a user via the user manager and obtain tokens via PKCE."""
    from proliferate.auth.models import UserCreate
    from proliferate.auth.users import UserManager
    from proliferate.db.engine import get_async_session
    from proliferate.auth.users import get_user_db

    user_id: str | None = None
    async for session in get_async_session():
        async for user_db in get_user_db(session):
            manager = UserManager(user_db)
            user = await manager.create(
                UserCreate(email=email, password="unused-oauth-only", display_name="Cloud Tester"),
            )
            if link_github:
                session.add(
                    OAuthAccount(
                        user_id=user.id,
                        oauth_name="github",
                        access_token="github-access-token",
                        account_id=f"github-{user.id}",
                        account_email=email,
                    )
                )
            await session.commit()
            user_id = str(user.id)

    assert user_id is not None

    token_data = await mint_desktop_token_payload(
        client,
        user_id=user_id,
        state_prefix="cloud-state",
    )
    return {
        "user_id": user_id,
        "access_token": str(token_data["access_token"]),
    }


async def _link_github_account(db_session: AsyncSession, user_id: str) -> None:
    existing = (
        await db_session.execute(
            select(OAuthAccount).where(
                OAuthAccount.user_id == uuid.UUID(user_id),
                OAuthAccount.oauth_name == "github",
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        existing.access_token = "github-access-token"
        existing.account_id = "12345"
        existing.account_email = "cloud@example.com"
        await db_session.commit()
        return

    account = OAuthAccount(
        user_id=uuid.UUID(user_id),
        oauth_name="github",
        access_token="github-access-token",
        account_id="12345",
        account_email="cloud@example.com",
    )
    db_session.add(account)
    await db_session.commit()


async def _seed_github_app_repo_authority(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    *,
    user_id: str,
    git_owner: str = "proliferate-ai",
) -> None:
    await github_app_store.upsert_github_app_authorization(
        db_session,
        user_id=uuid.UUID(user_id),
        authorization=GitHubAppUserAuthorization(
            access_token="github-app-user-token",
            refresh_token="github-app-refresh-token",
            expires_at=datetime.now(UTC) + timedelta(hours=8),
            refresh_token_expires_at=datetime.now(UTC) + timedelta(days=180),
            github_user_id="12345",
            github_login="cloud-tester",
            permissions={},
        ),
    )
    await github_app_store.upsert_github_app_installation(
        db_session,
        installation=GitHubAppInstallationInfo(
            github_installation_id="142900805",
            account_login=git_owner,
            account_type="Organization",
            repository_selection="all",
            permissions={"contents": "read", "pull_requests": "write"},
            suspended_at=None,
        ),
    )
    await db_session.commit()

    async def _has_access(**_kwargs) -> bool:  # type: ignore[no-untyped-def]
        return True

    monkeypatch.setattr(repo_authority, "verify_github_app_user_repo_access", _has_access)


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


async def _create_organization_for_user(db_session: AsyncSession, user_id: str) -> str:
    now = datetime.now(UTC)
    organization = Organization(
        name="Cloud Test Team",
        status=ORGANIZATION_STATUS_ACTIVE,
        created_at=now,
        updated_at=now,
    )
    db_session.add(organization)
    await db_session.flush()
    db_session.add(
        OrganizationMembership(
            organization_id=organization.id,
            user_id=uuid.UUID(user_id),
            role=ORGANIZATION_ROLE_OWNER,
            status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            joined_at=now,
            created_at=now,
            updated_at=now,
        )
    )
    await db_session.commit()
    return str(organization.id)


async def _add_organization_member(
    db_session: AsyncSession,
    *,
    organization_id: str,
    user_id: str,
    role: str = ORGANIZATION_ROLE_MEMBER,
) -> None:
    now = datetime.now(UTC)
    db_session.add(
        OrganizationMembership(
            organization_id=uuid.UUID(organization_id),
            user_id=uuid.UUID(user_id),
            role=role,
            status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            joined_at=now,
            created_at=now,
            updated_at=now,
        )
    )
    await db_session.commit()


def _quote_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


async def _create_rls_test_role(
    db_session: AsyncSession,
    role_name: str,
    *,
    table_name: str,
) -> None:
    quoted_role = _quote_identifier(role_name)
    await db_session.execute(text(f"CREATE ROLE {quoted_role} NOLOGIN"))
    await db_session.execute(text(f"GRANT USAGE ON SCHEMA public TO {quoted_role}"))
    await db_session.execute(text(f"GRANT SELECT ON {table_name} TO {quoted_role}"))
    await db_session.commit()


async def _drop_rls_test_role(db_session: AsyncSession, role_name: str) -> None:
    quoted_role = _quote_identifier(role_name)
    await db_session.rollback()
    await db_session.execute(text("RESET ROLE"))
    await db_session.execute(text(f"DROP OWNED BY {quoted_role}"))
    await db_session.execute(text(f"DROP ROLE IF EXISTS {quoted_role}"))
    await db_session.commit()


def _disable_workspace_provision(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        provisioning_service, "schedule_workspace_provision", lambda *_args, **_kwargs: None
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
    monkeypatch.setattr(
        provisioning_preflight,
        "get_github_repo_branches",
        resolver,
        raising=False,
    )
    monkeypatch.setattr(
        provisioning_service,
        "get_github_repo_branches",
        resolver,
        raising=False,
    )
    monkeypatch.setattr(repo_config_service, "get_repo_branches_for_credentials", resolver)


class TestCloudWorktreeRetentionPolicy:
    @pytest.mark.asyncio
    async def test_default_policy_does_not_create_row(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        tokens = await _register_and_login(client, f"policy-{uuid.uuid4().hex[:8]}@example.com")
        headers = {"Authorization": f"Bearer {tokens['access_token']}"}

        first = await client.get("/v1/cloud/worktree-retention-policy", headers=headers)
        second = await client.get("/v1/cloud/worktree-retention-policy", headers=headers)

        assert first.status_code == 200
        assert second.status_code == 200
        assert first.json() == {
            "maxMaterializedWorktreesPerRepo": 20,
            "updatedAt": "1970-01-01T00:00:00+00:00",
            "source": "default",
        }
        assert second.json() == first.json()
        rows = (
            (
                await db_session.execute(
                    select(CloudWorktreeRetentionPolicy).where(
                        CloudWorktreeRetentionPolicy.user_id == uuid.UUID(tokens["user_id"])
                    )
                )
            )
            .scalars()
            .all()
        )
        assert rows == []

    @pytest.mark.asyncio
    async def test_put_persists_policy(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        tokens = await _register_and_login(client, f"policy-{uuid.uuid4().hex[:8]}@example.com")
        headers = {"Authorization": f"Bearer {tokens['access_token']}"}

        response = await client.put(
            "/v1/cloud/worktree-retention-policy",
            headers=headers,
            json={"maxMaterializedWorktreesPerRepo": 50},
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["maxMaterializedWorktreesPerRepo"] == 50
        assert payload["source"] == "persisted"
        assert payload["updatedAt"] != "1970-01-01T00:00:00+00:00"
        row = (
            await db_session.execute(
                select(CloudWorktreeRetentionPolicy).where(
                    CloudWorktreeRetentionPolicy.user_id == uuid.UUID(tokens["user_id"])
                )
            )
        ).scalar_one()
        assert row.max_materialized_worktrees_per_repo == 50

    @pytest.mark.asyncio
    async def test_put_rejects_out_of_range_policy(
        self,
        client: AsyncClient,
    ) -> None:
        tokens = await _register_and_login(client, f"policy-{uuid.uuid4().hex[:8]}@example.com")
        response = await client.put(
            "/v1/cloud/worktree-retention-policy",
            headers={"Authorization": f"Bearer {tokens['access_token']}"},
            json={"maxMaterializedWorktreesPerRepo": 9},
        )

        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "invalid_worktree_retention_policy"


class TestCloudIntegrations:
    @pytest.mark.asyncio
    async def test_seed_definitions_and_api_key_account_flow(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        session = await _register_and_login(client, "cloud-integrations-api-key@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}

        definitions_response = await client.get(
            "/v1/cloud/integrations/definitions",
            headers=headers,
        )

        assert definitions_response.status_code == 200
        definitions = {definition["key"]: definition for definition in definitions_response.json()}
        assert {"linear", "context7", "posthog"} <= definitions.keys()
        assert definitions["linear"]["authModes"][0]["kind"] == "oauth2"
        assert definitions["posthog"]["settings"][0] == {
            "id": "region",
            "label": "Region",
            "default": "us",
            "options": [{"value": "us", "label": "US"}, {"value": "eu", "label": "EU"}],
        }

        created = await client.post(
            "/v1/cloud/integrations/accounts",
            headers=headers,
            json={
                "definitionId": definitions["context7"]["id"],
                "authKind": "api_key",
                "apiKey": "ctx7sk-example",
            },
        )

        assert created.status_code == 200
        assert created.json()["status"] == "ready"
        assert created.json()["authKind"] == "api_key"
        assert "ctx7sk-example" not in created.text

        row = (
            await db_session.execute(
                select(CloudIntegrationAccount).where(
                    CloudIntegrationAccount.owner_user_id == uuid.UUID(session["user_id"])
                )
            )
        ).scalar_one()
        assert row.credential_ciphertext is not None
        assert decrypt_json(row.credential_ciphertext)["apiKey"] == "ctx7sk-example"

        availability = await client.get("/v1/cloud/integrations/availability", headers=headers)

        assert availability.status_code == 200
        context7 = next(item for item in availability.json() if item["namespace"] == "context7")
        assert context7["accountId"] == created.json()["id"]
        assert context7["status"] == "ready"

    @pytest.mark.asyncio
    async def test_oauth_start_persists_web_return_target(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(settings, "frontend_base_url", "https://app.example.com")

        async def _discover_protected_resource_metadata(
            _server_url: str,
        ) -> ProtectedResourceMetadata:
            return ProtectedResourceMetadata(
                authorization_servers=("https://accounts.example.com",),
                resource="https://linear.example.com/mcp",
                challenged_scope="issues:read",
            )

        async def _discover_authorization_server_metadata(
            _issuer: str,
        ) -> AuthorizationServerMetadata:
            return AuthorizationServerMetadata(
                issuer="https://accounts.example.com",
                authorization_endpoint="https://accounts.example.com/authorize",
                token_endpoint="https://accounts.example.com/token",
                registration_endpoint="https://accounts.example.com/register",
                token_endpoint_auth_methods_supported=("none",),
                client_id_metadata_document_supported=False,
            )

        async def _register_client(*_args: object, **_kwargs: object) -> RegisteredOAuthClient:
            return RegisteredOAuthClient(
                client_id="client-id",
                client_secret=None,
                client_secret_expires_at=None,
                token_endpoint_auth_method=None,
                registration_client_uri=None,
                registration_access_token=None,
            )

        monkeypatch.setattr(
            "proliferate.server.cloud.integrations.service.discover_protected_resource_metadata",
            _discover_protected_resource_metadata,
        )
        monkeypatch.setattr(
            "proliferate.server.cloud.integrations.service.discover_authorization_server_metadata",
            _discover_authorization_server_metadata,
        )
        monkeypatch.setattr(
            "proliferate.server.cloud.integrations.service.register_client",
            _register_client,
        )

        session = await _register_and_login(client, "cloud-integrations-oauth@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        definitions = (
            await client.get("/v1/cloud/integrations/definitions", headers=headers)
        ).json()
        linear = next(definition for definition in definitions if definition["key"] == "linear")
        account = await client.post(
            "/v1/cloud/integrations/accounts",
            headers=headers,
            json={"definitionId": linear["id"], "authKind": "oauth2"},
        )
        assert account.status_code == 200

        started = await client.post(
            f"/v1/cloud/integrations/accounts/{account.json()['id']}/oauth/start",
            headers=headers,
            json={
                "callbackSurface": "web",
                "finalSurface": "desktop",
                "returnPath": "/plugins/connect/complete",
            },
        )

        assert started.status_code == 200
        assert started.json()["status"] == "active"
        assert started.json()["authorizationUrl"].startswith(
            "https://accounts.example.com/authorize?"
        )
        status_response = await client.get(
            f"/v1/cloud/integrations/oauth/flows/{started.json()['flowId']}",
            headers=headers,
        )
        assert status_response.status_code == 200
        assert status_response.json()["flowId"] == started.json()["flowId"]
        assert status_response.json()["status"] == "active"

        cancelled = await client.post(
            f"/v1/cloud/integrations/oauth/flows/{started.json()['flowId']}/cancel",
            headers=headers,
        )
        assert cancelled.status_code == 200
        assert cancelled.json()["flowId"] == started.json()["flowId"]
        assert cancelled.json()["status"] == "cancelled"

        flows = (await db_session.execute(select(CloudIntegrationOAuthFlow))).scalars().all()
        assert len(flows) == 1
        assert flows[0].callback_surface == "web"
        assert flows[0].final_surface == "desktop"
        assert flows[0].return_path == "/plugins/connect/complete"

    @pytest.mark.asyncio
    async def test_oauth_start_rejects_empty_authorization_server_metadata(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        async def _discover_protected_resource_metadata(
            _server_url: str,
        ) -> ProtectedResourceMetadata:
            return ProtectedResourceMetadata(
                authorization_servers=(),
                resource="https://linear.example.com/mcp",
                challenged_scope=None,
            )

        monkeypatch.setattr(
            "proliferate.server.cloud.integrations.service.discover_protected_resource_metadata",
            _discover_protected_resource_metadata,
        )

        session = await _register_and_login(
            client,
            "cloud-integrations-empty-auth-server@example.com",
        )
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        definitions = (
            await client.get("/v1/cloud/integrations/definitions", headers=headers)
        ).json()
        linear = next(definition for definition in definitions if definition["key"] == "linear")
        account = await client.post(
            "/v1/cloud/integrations/accounts",
            headers=headers,
            json={"definitionId": linear["id"], "authKind": "oauth2"},
        )
        assert account.status_code == 200

        started = await client.post(
            f"/v1/cloud/integrations/accounts/{account.json()['id']}/oauth/start",
            headers=headers,
        )

        assert started.status_code == 409
        assert started.json()["detail"]["code"] == "integration_oauth_unavailable"

    @pytest.mark.asyncio
    async def test_org_custom_definition_validates_admin_and_url(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        owner = await _register_and_login(client, "cloud-integrations-custom-owner@example.com")
        member = await _register_and_login(client, "cloud-integrations-custom-member@example.com")
        organization_id = await _create_organization_for_user(db_session, owner["user_id"])
        await _add_organization_member(
            db_session,
            organization_id=organization_id,
            user_id=member["user_id"],
        )
        owner_headers = {"Authorization": f"Bearer {owner['access_token']}"}
        member_headers = {"Authorization": f"Bearer {member['access_token']}"}

        invalid_url = await client.post(
            "/v1/cloud/integrations/definitions",
            headers=owner_headers,
            json={
                "organizationId": organization_id,
                "displayName": "Internal MCP",
                "namespace": "internal_mcp",
                "mcpUrl": "http://mcp.example.com/mcp",
            },
        )
        assert invalid_url.status_code == 400
        assert invalid_url.json()["detail"]["code"] == "invalid_payload"

        async def _validate_dynamic_http_mcp_definition(**kwargs: object):
            from proliferate.server.cloud.integrations.domain.dynamic_validation import (
                DynamicIntegrationValidationResult,
            )

            return DynamicIntegrationValidationResult(
                display_name=str(kwargs["display_name"]).strip(),
                namespace=str(kwargs["namespace"]).strip(),
                mcp_url=str(kwargs["mcp_url"]).strip(),
                issuer="https://accounts.example.com",
                resource=str(kwargs["mcp_url"]).strip(),
                client_strategy="dcr",
            )

        monkeypatch.setattr(
            "proliferate.server.cloud.integrations.service.validate_dynamic_http_mcp_definition",
            _validate_dynamic_http_mcp_definition,
        )

        member_create = await client.post(
            "/v1/cloud/integrations/definitions",
            headers=member_headers,
            json={
                "organizationId": organization_id,
                "displayName": "Internal MCP",
                "namespace": "internal_mcp",
                "mcpUrl": "https://mcp.example.com/mcp",
            },
        )
        assert member_create.status_code == 403

        owner_create = await client.post(
            "/v1/cloud/integrations/definitions",
            headers=owner_headers,
            json={
                "organizationId": organization_id,
                "displayName": "Internal MCP",
                "namespace": "internal_mcp",
                "mcpUrl": "https://mcp.example.com/mcp",
            },
        )
        assert owner_create.status_code == 200
        assert owner_create.json()["source"] == "org_custom"
        assert owner_create.json()["namespace"] == "internal_mcp"

        member_list = await client.get(
            "/v1/cloud/integrations/definitions",
            headers=member_headers,
            params={"organizationId": organization_id},
        )
        assert member_list.status_code == 200
        assert any(item["namespace"] == "internal_mcp" for item in member_list.json())

        outsider = await _register_and_login(
            client,
            "cloud-integrations-custom-outsider@example.com",
        )
        outsider_response = await client.get(
            "/v1/cloud/integrations/definitions",
            headers={"Authorization": f"Bearer {outsider['access_token']}"},
            params={"organizationId": organization_id},
        )
        assert outsider_response.status_code == 404
        assert outsider_response.json()["detail"]["code"] == "organization_not_found"

        outsider_availability = await client.get(
            "/v1/cloud/integrations/availability",
            headers={"Authorization": f"Bearer {outsider['access_token']}"},
            params={"organizationId": organization_id},
        )
        assert outsider_availability.status_code == 404
        assert outsider_availability.json()["detail"]["code"] == "organization_not_found"

    @pytest.mark.asyncio
    async def test_tool_metadata_skips_failing_accounts(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        async def _list_tools(
            *,
            url: str,
            headers: dict[str, str],
        ) -> tuple[McpRemoteTool, ...]:
            if "context7" in url:
                raise McpRemoteError("mcp_http_error", "Context7 is unavailable.")
            return (
                McpRemoteTool(
                    name="capture_event",
                    description="Capture an event.",
                    input_schema={},
                ),
            )

        monkeypatch.setattr(
            "proliferate.server.cloud.integrations.service.mcp_remote.list_tools",
            _list_tools,
        )

        session = await _register_and_login(client, "cloud-integrations-tools@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        definitions = {
            definition["key"]: definition
            for definition in (
                await client.get("/v1/cloud/integrations/definitions", headers=headers)
            ).json()
        }
        for key in ("context7", "posthog"):
            response = await client.post(
                "/v1/cloud/integrations/accounts",
                headers=headers,
                json={
                    "definitionId": definitions[key]["id"],
                    "authKind": "api_key",
                    "apiKey": f"{key}-token",
                },
            )
            assert response.status_code == 200

        metadata = await client.get("/v1/cloud/integrations/tool-metadata", headers=headers)

        assert metadata.status_code == 200
        assert [item["namespace"] for item in metadata.json()] == ["posthog"]
        assert metadata.json()[0]["tools"][0]["gatewayToolName"] == "posthog__capture_event"


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
        await _seed_github_app_repo_authority(
            db_session,
            monkeypatch,
            user_id=session["user_id"],
        )

        save_response = await client.put(
            "/v1/cloud/repos/proliferate-ai/proliferate/config",
            headers=headers,
            json={
                "configured": True,
                "defaultBranch": "release",
                "envVars": {"API_BASE_URL": "https://example.internal"},
                "setupScript": "pnpm install",
                "runCommand": "make dev",
                "files": [
                    {
                        "relativePath": ".env.shared",
                        "content": "API_BASE_URL=https://example.internal\nSHARED_TOKEN=dev\n",
                    },
                ],
            },
        )

        assert save_response.status_code == 200
        assert save_response.json()["defaultBranch"] == "release"
        assert save_response.json()["runCommand"] == "make dev"
        assert save_response.json()["trackedFiles"][0]["relativePath"] == ".env.shared"
        assert save_response.json()["trackedFiles"][0].get("content") is None

        get_response = await client.get(
            "/v1/cloud/repos/proliferate-ai/proliferate/config",
            headers=headers,
        )
        assert get_response.status_code == 200
        assert get_response.json()["defaultBranch"] == "release"
        assert get_response.json()["runCommand"] == "make dev"
        assert get_response.json()["trackedFiles"][0]["relativePath"] == ".env.shared"
        assert get_response.json()["trackedFiles"][0].get("content") is None

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
        assert record.run_command == "make dev"

        repositories_response = await client.get("/v1/cloud/repositories", headers=headers)
        assert repositories_response.status_code == 200
        repositories_payload = repositories_response.json()
        assert repositories_payload["repositories"] == [
            {
                "id": str(record.id),
                "ownerScope": "personal",
                "gitProvider": "github",
                "gitOwner": "proliferate-ai",
                "gitRepoName": "proliferate",
                "environments": [
                    {
                        "id": str(record.id),
                        "repoConfigId": str(record.id),
                        "kind": "cloud",
                        "desktopInstallId": None,
                        "localPath": None,
                        "configured": True,
                        "configuredAt": save_response.json()["configuredAt"],
                        "defaultBranch": "release",
                        "setupScript": "pnpm install",
                        "setupScriptVersion": 1,
                        "runCommand": "make dev",
                        "configVersion": 1,
                        "legacyCloudRepoConfigId": str(record.id),
                    }
                ],
            }
        ]

        organization_id = await _create_organization_for_user(db_session, session["user_id"])

        organization_save_response = await client.put(
            (f"/v1/cloud/organizations/{organization_id}/repos/proliferate-ai/proliferate/config"),
            headers=headers,
            json={
                "configured": True,
                "defaultBranch": "release",
                "envVars": {"API_BASE_URL": "https://example.internal"},
                "setupScript": "pnpm install",
                "runCommand": "make dev",
                "files": [
                    {
                        "relativePath": ".env.shared",
                        "content": "API_BASE_URL=https://example.internal\nSHARED_TOKEN=team\n",
                    },
                ],
            },
        )
        assert organization_save_response.status_code == 200
        assert (
            organization_save_response.json()["trackedFiles"][0]["relativePath"] == ".env.shared"
        )
        assert (
            organization_save_response.json()["trackedFiles"][0]["content"]
            == "API_BASE_URL=https://example.internal\nSHARED_TOKEN=team\n"
        )

        organization_get_response = await client.get(
            (f"/v1/cloud/organizations/{organization_id}/repos/proliferate-ai/proliferate/config"),
            headers=headers,
        )
        assert organization_get_response.status_code == 200
        assert organization_get_response.json()["trackedFiles"][0]["relativePath"] == ".env.shared"
        assert (
            organization_get_response.json()["trackedFiles"][0]["content"]
            == "API_BASE_URL=https://example.internal\nSHARED_TOKEN=team\n"
        )

        organization_preserve_response = await client.put(
            (f"/v1/cloud/organizations/{organization_id}/repos/proliferate-ai/proliferate/config"),
            headers=headers,
            json={
                "configured": True,
                "defaultBranch": "release",
                "envVars": {"API_BASE_URL": "https://example.internal"},
                "setupScript": "pnpm install",
                "runCommand": "make dev --shared",
            },
        )
        assert organization_preserve_response.status_code == 200
        assert organization_preserve_response.json()["runCommand"] == "make dev --shared"
        assert (
            organization_preserve_response.json()["trackedFiles"][0]["content"]
            == "API_BASE_URL=https://example.internal\nSHARED_TOKEN=team\n"
        )

        member_session = await _register_and_login(client, "cloud-member@example.com")
        db_session.add(
            OrganizationMembership(
                organization_id=uuid.UUID(organization_id),
                user_id=uuid.UUID(member_session["user_id"]),
                role=ORGANIZATION_ROLE_MEMBER,
                status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            )
        )
        await db_session.commit()
        member_headers = {"Authorization": f"Bearer {member_session['access_token']}"}
        member_get_response = await client.get(
            (f"/v1/cloud/organizations/{organization_id}/repos/proliferate-ai/proliferate/config"),
            headers=member_headers,
        )
        assert member_get_response.status_code == 403
        assert member_get_response.json()["detail"]["code"] == (
            "organization_repo_config_permission_denied"
        )

        outsider_session = await _register_and_login(client, "cloud-outsider@example.com")
        outsider_headers = {"Authorization": f"Bearer {outsider_session['access_token']}"}
        outsider_get_response = await client.get(
            (f"/v1/cloud/organizations/{organization_id}/repos/proliferate-ai/proliferate/config"),
            headers=outsider_headers,
        )
        assert outsider_get_response.status_code == 404
        assert (
            outsider_get_response.json()["detail"]["code"] == "organization_repo_config_not_found"
        )

    @pytest.mark.asyncio
    async def test_free_plan_repo_config_limit_blocks_second_configured_repo(
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
        monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_OBSERVE)
        monkeypatch.setattr(settings, "cloud_free_repo_limit", 1)

        session = await _register_and_login(client, "cloud-repo-config-limit@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        await _seed_github_app_repo_authority(
            db_session,
            monkeypatch,
            user_id=session["user_id"],
        )
        payload = {
            "configured": True,
            "defaultBranch": None,
            "envVars": {},
            "setupScript": "",
            "files": [],
        }

        first = await client.put(
            "/v1/cloud/repos/proliferate-ai/proliferate/config",
            headers=headers,
            json=payload,
        )
        assert first.status_code == 200

        plan = await client.get("/v1/billing/cloud-plan", headers=headers)
        assert plan.status_code == 200
        assert plan.json()["activeCloudRepoCount"] == 1
        assert plan.json()["cloudRepoLimit"] == 1

        second = await client.put(
            "/v1/cloud/repos/proliferate-ai/second-repo/config",
            headers=headers,
            json=payload,
        )
        assert second.status_code == 409
        assert second.json()["detail"]["code"] == "repo_limit_exceeded"

        unconfigured_second = await client.put(
            "/v1/cloud/repos/proliferate-ai/second-repo/config",
            headers=headers,
            json={**payload, "configured": False},
        )
        assert unconfigured_second.status_code == 200
        assert unconfigured_second.json()["configured"] is False

        disabled_first = await client.put(
            "/v1/cloud/repos/proliferate-ai/proliferate/config",
            headers=headers,
            json={**payload, "configured": False},
        )
        assert disabled_first.status_code == 200

        enabled_second = await client.put(
            "/v1/cloud/repos/proliferate-ai/second-repo/config",
            headers=headers,
            json=payload,
        )
        assert enabled_second.status_code == 200
        assert enabled_second.json()["configured"] is True

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
        await _seed_github_app_repo_authority(
            db_session,
            monkeypatch,
            user_id=session["user_id"],
        )

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
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        async def _repo_branches(*_args, **_kwargs) -> GitHubRepoBranches:
            return GitHubRepoBranches(
                default_branch="main",
                branches=["main", "release"],
            )

        _patch_repo_branches_lookup(monkeypatch, _repo_branches)

        session = await _register_and_login(client, "cloud-repo-config-race@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        await _seed_github_app_repo_authority(
            db_session,
            monkeypatch,
            user_id=session["user_id"],
        )
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
    async def test_concurrent_first_local_environment_save_returns_success(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        session = await _register_and_login(client, "local-repo-environment-race@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        payload = {
            "gitProvider": "github",
            "desktopInstallId": "desktop-dev",
            "localPath": "/Users/example/proliferate",
            "defaultBranch": "main",
            "setupScript": "pnpm install",
            "runCommand": "pnpm dev",
        }

        responses = await asyncio.gather(
            client.put(
                "/v1/cloud/repositories/proliferate-ai/proliferate/environments/local",
                headers=headers,
                json=payload,
            ),
            client.put(
                "/v1/cloud/repositories/proliferate-ai/proliferate/environments/local",
                headers=headers,
                json=payload,
            ),
        )

        assert [response.status_code for response in responses] == [200, 200]

        repo_records = (
            (
                await db_session.execute(
                    select(RepoConfig).where(
                        RepoConfig.user_id == uuid.UUID(session["user_id"]),
                        RepoConfig.git_owner == "proliferate-ai",
                        RepoConfig.git_repo_name == "proliferate",
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(repo_records) == 1
        environment_records = (
            (
                await db_session.execute(
                    select(RepoEnvironment).where(
                        RepoEnvironment.repo_config_id == repo_records[0].id,
                        RepoEnvironment.environment_kind == "local",
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(environment_records) == 1

    @pytest.mark.asyncio
    async def test_repository_environment_endpoints_bridge_to_legacy_cloud_config(
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

        session = await _register_and_login(client, "repo-environment-bridge@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        await _link_github_account(db_session, session["user_id"])
        await _seed_github_app_repo_authority(
            db_session,
            monkeypatch,
            user_id=session["user_id"],
        )

        local_response = await client.put(
            "/v1/cloud/repositories/proliferate-ai/proliferate/environments/local",
            headers=headers,
            json={
                "gitProvider": "github",
                "desktopInstallId": "desktop-dev",
                "localPath": "/Users/example/proliferate",
                "defaultBranch": "main",
                "setupScript": "pnpm install",
                "runCommand": "pnpm dev",
            },
        )
        assert local_response.status_code == 200
        assert local_response.json()["kind"] == "local"
        assert local_response.json()["localPath"] == "/Users/example/proliferate"

        cloud_response = await client.put(
            "/v1/cloud/repositories/proliferate-ai/proliferate/environments/cloud",
            headers=headers,
            json={
                "configured": True,
                "defaultBranch": "release",
                "setupScript": "uv sync",
                "runCommand": "make run",
            },
        )
        assert cloud_response.status_code == 200
        assert cloud_response.json()["kind"] == "cloud"
        assert cloud_response.json()["defaultBranch"] == "release"
        assert cloud_response.json()["setupScript"] == "uv sync"
        assert cloud_response.json()["runCommand"] == "make run"

        legacy_response = await client.get(
            "/v1/cloud/repos/proliferate-ai/proliferate/config",
            headers=headers,
        )
        assert legacy_response.status_code == 200
        assert legacy_response.json()["defaultBranch"] == "release"
        assert legacy_response.json()["setupScript"] == "uv sync"
        assert legacy_response.json()["runCommand"] == "make run"

        repo_record = (
            await db_session.execute(
                select(RepoConfig).where(
                    RepoConfig.user_id == uuid.UUID(session["user_id"]),
                    RepoConfig.git_owner == "proliferate-ai",
                    RepoConfig.git_repo_name == "proliferate",
                )
            )
        ).scalar_one()
        environment_rows = (
            (
                await db_session.execute(
                    select(RepoEnvironment)
                    .where(RepoEnvironment.repo_config_id == repo_record.id)
                    .order_by(RepoEnvironment.environment_kind.asc())
                )
            )
            .scalars()
            .all()
        )
        assert [row.environment_kind for row in environment_rows] == ["cloud", "local"]

        repositories_response = await client.get("/v1/cloud/repositories", headers=headers)
        assert repositories_response.status_code == 200
        repositories_payload = repositories_response.json()
        assert repositories_payload["repositories"][0]["gitOwner"] == "proliferate-ai"
        assert {item["kind"] for item in repositories_payload["repositories"][0]["environments"]} == {
            "cloud",
            "local",
        }

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
            "/v1/cloud/agent-auth/credentials/synced/claude",
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
            "/v1/cloud/agent-auth/credentials/synced/claude",
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
            "permission": None,
            "private": False,
            "fork": False,
            "archived": False,
            "disabled": False,
        }


class TestCloudRepoCatalog:
    @pytest.mark.asyncio
    async def test_list_cloud_repositories_marks_repo_config_state(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        async def _repo_branches(*_args, **_kwargs) -> GitHubRepoBranches:
            return GitHubRepoBranches(
                default_branch="main",
                branches=["main", "release"],
                permission="push",
                private=True,
            )

        async def _github_repositories(*_args, **_kwargs) -> GitHubRepositoryPage:
            return GitHubRepositoryPage(
                repositories=[
                    GitHubRepositorySummary(
                        owner="acme",
                        name="rocket",
                        full_name="acme/rocket",
                        default_branch="main",
                        private=True,
                        fork=False,
                        archived=False,
                        disabled=False,
                        html_url="https://github.com/acme/rocket",
                        owner_avatar_url=None,
                        pushed_at="2026-05-01T00:00:00Z",
                        updated_at="2026-05-02T00:00:00Z",
                        permission="push",
                    ),
                    GitHubRepositorySummary(
                        owner="acme",
                        name="disabled",
                        full_name="acme/disabled",
                        default_branch="main",
                        private=False,
                        fork=False,
                        archived=False,
                        disabled=False,
                        html_url=None,
                        owner_avatar_url=None,
                        pushed_at=None,
                        updated_at=None,
                        permission="admin",
                    ),
                    GitHubRepositorySummary(
                        owner="acme",
                        name="missing",
                        full_name="acme/missing",
                        default_branch="main",
                        private=False,
                        fork=False,
                        archived=False,
                        disabled=False,
                        html_url=None,
                        owner_avatar_url=None,
                        pushed_at=None,
                        updated_at=None,
                        permission="pull",
                    ),
                ],
                next_cursor="cursor-2",
            )

        _patch_repo_branches_lookup(monkeypatch, _repo_branches)
        monkeypatch.setattr(
            repos_service,
            "list_github_repositories",
            _github_repositories,
        )

        session = await _register_and_login(client, "cloud-repo-catalog@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        await _link_github_account(db_session, session["user_id"])
        await _configure_repo(client, headers, git_owner="acme", git_repo_name="rocket")
        disabled = await client.put(
            "/v1/cloud/repos/acme/disabled/config",
            headers=headers,
            json={
                "configured": False,
                "defaultBranch": None,
                "envVars": {},
                "setupScript": "",
                "runCommand": "",
            },
        )
        assert disabled.status_code == 200

        response = await client.get(
            "/v1/cloud/repos",
            headers=headers,
            params={"limit": 25},
        )

        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store, private"
        assert response.headers["vary"] == "Authorization, Cookie"
        payload = response.json()
        assert payload["nextCursor"] == "cursor-2"
        assert [
            (repo["fullName"], repo["repoConfigState"], repo["configured"])
            for repo in payload["repositories"]
        ] == [
            ("acme/rocket", "configured", True),
            ("acme/disabled", "disabled", False),
            ("acme/missing", "missing", False),
        ]


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
            "/v1/cloud/agent-auth/credentials/synced/claude",
            headers=headers,
            json=_claude_file_payload("sk-ant-test"),
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
            provisioning_preflight,
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
            "/v1/cloud/agent-auth/credentials/synced/claude",
            headers=headers,
            json=_claude_file_payload("sk-ant-test"),
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
            provisioning_preflight,
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
            "/v1/cloud/agent-auth/credentials/synced/claude",
            headers=headers,
            json=_claude_file_payload("sk-ant-test"),
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
            "/v1/cloud/agent-auth/credentials/synced/claude",
            headers=headers,
            json=_claude_file_payload("sk-ant-test"),
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

        session = await _register_and_login(
            client,
            "cloud-create-gating@example.com",
            link_github=False,
        )
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        request = {
            "gitProvider": "github",
            "gitOwner": "acme",
            "gitRepoName": "rocket",
            "baseBranch": "main",
            "branchName": "pure-drift",
            "source": "web",
        }

        no_github = await client.post("/v1/cloud/workspaces", headers=headers, json=request)
        assert no_github.status_code == 403
        assert no_github.json()["detail"]["code"] == "github_link_required"

        await _link_github_account(db_session, session["user_id"])
        await _configure_repo(client, headers, git_owner="acme", git_repo_name="rocket")

        no_creds = await client.post("/v1/cloud/workspaces", headers=headers, json=request)
        assert no_creds.status_code == 400
        assert no_creds.json()["detail"]["code"] == "missing_supported_credentials"

        sync_response = await client.put(
            "/v1/cloud/agent-auth/credentials/synced/claude",
            headers=headers,
            json=_claude_file_payload("sk-ant-test"),
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
        assert payload["allowedAgentKinds"] == ["claude", "codex", "opencode", "gemini", "grok"]
        assert payload["readyAgentKinds"] == ["claude"]
        assert payload["runtime"]["generation"] == 0
        assert payload["origin"] == {"kind": "human", "entrypoint": "web"}

        list_response = await client.get("/v1/cloud/workspaces", headers=headers)
        assert list_response.status_code == 200
        list_payload = list_response.json()
        assert list_payload[0]["origin"] == {"kind": "human", "entrypoint": "web"}

        detail_response = await client.get(
            f"/v1/cloud/workspaces/{payload['id']}",
            headers=headers,
        )
        assert detail_response.status_code == 200
        assert detail_response.json()["origin"] == {"kind": "human", "entrypoint": "web"}

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
            "/v1/cloud/agent-auth/credentials/synced/claude",
            headers=headers,
            json=_claude_file_payload("sk-ant-test"),
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
            "/v1/cloud/agent-auth/credentials/synced/claude",
            headers=headers,
            json=_claude_file_payload("sk-ant-test"),
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
            "/v1/cloud/agent-auth/credentials/synced/claude",
            headers=headers,
            json=_claude_file_payload("sk-ant-test"),
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
            "/v1/cloud/agent-auth/credentials/synced/claude",
            headers=headers,
            json=_claude_file_payload("sk-ant-test"),
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
        async def _workspace_connection(
            _db: AsyncSession,
            _workspace: CloudWorkspace,
        ) -> RuntimeConnectionTarget:
            return RuntimeConnectionTarget(
                target_id=None,
                runtime_url="https://example-runtime.invalid",
                access_token="runtime-token",
                anyharness_workspace_id="workspace-123",
                runtime_generation=2,
                ready_agent_kinds=["codex"],
                runtime_auth=_current_runtime_auth(),
            )

        monkeypatch.setattr(remote_service, "get_workspace_connection", _workspace_connection)

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

        monkeypatch.setattr(remote_service, "get_workspace_connection", _boom)

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
    async def test_start_workspace_from_error_requeues_materialization(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        scheduled: list[uuid.UUID] = []

        async def _repo_branches(*_args, **_kwargs) -> GitHubRepoBranches:
            return GitHubRepoBranches(
                default_branch="main",
                branches=["main"],
            )

        _patch_repo_branches_lookup(monkeypatch, _repo_branches)
        monkeypatch.setattr(
            provisioning_service,
            "schedule_workspace_provision",
            lambda workspace_id, **_kwargs: scheduled.append(workspace_id),
        )

        session = await _register_and_login(client, "cloud-start-reuse@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        await _link_github_account(db_session, session["user_id"])
        user_id = uuid.UUID(session["user_id"])
        billing_subject = await _billing_subject_for_user(db_session, user_id)
        await db_session.commit()

        await client.put(
            "/v1/cloud/agent-auth/credentials/synced/claude",
            headers=headers,
            json=_claude_file_payload("sk-ant-test"),
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

        async def _repo_branches(*_args, **_kwargs) -> GitHubRepoBranches:
            return GitHubRepoBranches(
                default_branch="main",
                branches=["main"],
            )

        _patch_repo_branches_lookup(monkeypatch, _repo_branches)
        monkeypatch.setattr(
            provisioning_service,
            "schedule_workspace_provision",
            lambda workspace_id, **_kwargs: scheduled.append(workspace_id),
        )

        session = await _register_and_login(client, "cloud-start-reprovision@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        await _link_github_account(db_session, session["user_id"])
        user_id = uuid.UUID(session["user_id"])
        billing_subject = await _billing_subject_for_user(db_session, user_id)
        await db_session.commit()

        await client.put(
            "/v1/cloud/agent-auth/credentials/synced/claude",
            headers=headers,
            json=_claude_file_payload("sk-ant-test"),
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
