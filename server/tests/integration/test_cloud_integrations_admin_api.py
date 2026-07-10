"""Org-admin custom integration definition management, including OAuth auto-detection."""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.organizations import (
    ORGANIZATION_ROLE_MEMBER,
    ORGANIZATION_ROLE_OWNER,
)
from proliferate.db.store.integrations import definitions as definitions_store
from proliferate.integrations.integration_oauth.errors import IntegrationOAuthProviderError
from proliferate.integrations.integration_oauth.models import (
    AuthorizationServerMetadata,
    ProtectedResourceMetadata,
    RegisteredOAuthClient,
)
from proliferate.server.cloud.integrations import service as integrations_service
from proliferate.server.cloud.integrations.config import parse_definition_config
from proliferate.server.cloud.integrations.oauth import clients as oauth_clients
from proliferate.server.cloud.integrations.oauth import service as oauth_service
from tests.integration.test_cloud_integrations_api import (
    _authed_user,
    _create_org_with_role,
    _seed_definitions,
)


class TestAdminDefinitions:
    @pytest.fixture(autouse=True)
    def _no_network_probe(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Keep the create-time OAuth probe off the network by default."""

        async def _no_oauth(server_url: str) -> ProtectedResourceMetadata:
            raise IntegrationOAuthProviderError("discovery_failed", "no metadata")

        monkeypatch.setattr(
            integrations_service, "discover_protected_resource_metadata", _no_oauth
        )

    @pytest.mark.asyncio
    async def test_admin_create_and_set_enabled(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        auth = await _authed_user(client, db_session, prefix="int-admin")
        await _seed_definitions(db_session)
        org_id = await _create_org_with_role(
            db_session, user_id=auth.user_id, role=ORGANIZATION_ROLE_OWNER
        )

        created = await client.post(
            f"/v1/cloud/integrations/admin/organizations/{org_id}/definitions",
            headers=auth.headers,
            json={
                "displayName": "Internal Tools",
                "namespace": "internal-tools",
                "mcpUrl": "https://mcp.internal.example.com/mcp",
            },
        )
        assert created.status_code == 200, created.text
        definition = created.json()
        assert definition["source"] == "org_custom"
        assert definition["authKind"] == "none"
        assert definition["authDetection"] == "none"
        assert definition["effectiveEnabled"] is True
        definition_id = definition["definitionId"]

        listed = await client.get(
            f"/v1/cloud/integrations/admin/organizations/{org_id}/definitions",
            headers=auth.headers,
        )
        assert listed.status_code == 200, listed.text
        namespaces = {d["namespace"] for d in listed.json()}
        assert "internal-tools" in namespaces
        assert "context7" in namespaces  # seed definitions are visible too

        disabled = await client.patch(
            f"/v1/cloud/integrations/admin/organizations/{org_id}"
            f"/definitions/{definition_id}/enabled",
            headers=auth.headers,
            json={"enabled": False},
        )
        assert disabled.status_code == 200, disabled.text
        assert disabled.json()["effectiveEnabled"] is False
        assert disabled.json()["policyEnabled"] is False

    @pytest.mark.asyncio
    async def test_admin_create_detects_oauth(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        auth = await _authed_user(client, db_session, prefix="int-admin-oauth")
        org_id = await _create_org_with_role(
            db_session, user_id=auth.user_id, role=ORGANIZATION_ROLE_OWNER
        )

        async def _fake_protected(server_url: str) -> ProtectedResourceMetadata:
            return ProtectedResourceMetadata(
                authorization_servers=("https://auth.internal.example.com",),
                resource=server_url,
                challenged_scope=None,
            )

        monkeypatch.setattr(
            integrations_service, "discover_protected_resource_metadata", _fake_protected
        )

        created = await client.post(
            f"/v1/cloud/integrations/admin/organizations/{org_id}/definitions",
            headers=auth.headers,
            json={
                "displayName": "Protected Tools",
                "namespace": "protected-tools",
                "mcpUrl": "https://mcp.internal.example.com/mcp",
            },
        )
        assert created.status_code == 200, created.text
        definition = created.json()
        assert definition["authKind"] == "oauth2"
        assert definition["authDetection"] == "detected"

        stored = await definitions_store.get_definition(
            db_session, uuid.UUID(definition["definitionId"])
        )
        assert stored is not None
        assert stored.auth_kind == "oauth2"
        assert stored.oauth_client_mode == "dcr"
        config = parse_definition_config(stored.config_json)
        assert any(header.name == "Authorization" for header in config.headers)

    @pytest.mark.asyncio
    async def test_admin_create_unreachable_url_creates_without_auth(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        auth = await _authed_user(client, db_session, prefix="int-admin-slow")
        org_id = await _create_org_with_role(
            db_session, user_id=auth.user_id, role=ORGANIZATION_ROLE_OWNER
        )

        async def _timeout(server_url: str) -> ProtectedResourceMetadata:
            raise TimeoutError

        monkeypatch.setattr(integrations_service, "discover_protected_resource_metadata", _timeout)

        created = await client.post(
            f"/v1/cloud/integrations/admin/organizations/{org_id}/definitions",
            headers=auth.headers,
            json={
                "displayName": "Slow Tools",
                "namespace": "slow-tools",
                "mcpUrl": "https://mcp.internal.example.com/mcp",
            },
        )
        assert created.status_code == 200, created.text
        definition = created.json()
        assert definition["authKind"] == "none"
        assert definition["authDetection"] == "unreachable"

    @pytest.mark.asyncio
    @pytest.mark.parametrize("auth_kind", ["oauth2", "none"])
    async def test_admin_create_explicit_auth_kind_skips_probe(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
        auth_kind: str,
    ) -> None:
        auth = await _authed_user(client, db_session, prefix=f"int-admin-{auth_kind}")
        org_id = await _create_org_with_role(
            db_session, user_id=auth.user_id, role=ORGANIZATION_ROLE_OWNER
        )

        probe_calls: list[str] = []

        async def _tracking(server_url: str) -> ProtectedResourceMetadata:
            probe_calls.append(server_url)
            raise IntegrationOAuthProviderError("discovery_failed", "no metadata")

        monkeypatch.setattr(
            integrations_service, "discover_protected_resource_metadata", _tracking
        )

        created = await client.post(
            f"/v1/cloud/integrations/admin/organizations/{org_id}/definitions",
            headers=auth.headers,
            json={
                "displayName": "Explicit Tools",
                "namespace": "explicit-tools",
                "mcpUrl": "https://mcp.internal.example.com/mcp",
                "authKind": auth_kind,
            },
        )
        assert created.status_code == 200, created.text
        definition = created.json()
        assert definition["authKind"] == auth_kind
        assert definition["authDetection"] == "forced"
        assert probe_calls == []

        stored = await definitions_store.get_definition(
            db_session, uuid.UUID(definition["definitionId"])
        )
        assert stored is not None
        assert stored.oauth_client_mode == ("dcr" if auth_kind == "oauth2" else None)

    @pytest.mark.asyncio
    async def test_admin_create_rejects_invalid_auth_kind(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        auth = await _authed_user(client, db_session, prefix="int-admin-badauth")
        org_id = await _create_org_with_role(
            db_session, user_id=auth.user_id, role=ORGANIZATION_ROLE_OWNER
        )

        response = await client.post(
            f"/v1/cloud/integrations/admin/organizations/{org_id}/definitions",
            headers=auth.headers,
            json={
                "displayName": "Bad Auth",
                "namespace": "bad-auth",
                "mcpUrl": "https://mcp.internal.example.com/mcp",
                "authKind": "api_key",
            },
        )
        assert response.status_code == 422, response.text

    @pytest.mark.asyncio
    async def test_user_can_start_oauth_against_org_custom_definition(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """End-to-end: the generic DCR path works for org-custom oauth2 definitions."""
        auth = await _authed_user(client, db_session, prefix="int-custom-oauth")
        org_id = await _create_org_with_role(
            db_session, user_id=auth.user_id, role=ORGANIZATION_ROLE_OWNER
        )

        created = await client.post(
            f"/v1/cloud/integrations/admin/organizations/{org_id}/definitions",
            headers=auth.headers,
            json={
                "displayName": "Custom OAuth Tools",
                "namespace": "custom-oauth-tools",
                "mcpUrl": "https://mcp.custom.example.com/mcp",
                "authKind": "oauth2",
            },
        )
        assert created.status_code == 200, created.text
        definition_id = created.json()["definitionId"]

        async def _fake_protected(server_url: str) -> ProtectedResourceMetadata:
            return ProtectedResourceMetadata(
                authorization_servers=("https://auth.custom.example.com",),
                resource="https://mcp.custom.example.com/mcp",
                challenged_scope=None,
            )

        async def _fake_auth_metadata(issuer: str) -> AuthorizationServerMetadata:
            return AuthorizationServerMetadata(
                issuer="https://auth.custom.example.com",
                authorization_endpoint="https://auth.custom.example.com/authorize",
                token_endpoint="https://auth.custom.example.com/token",
                registration_endpoint="https://auth.custom.example.com/register",
                token_endpoint_auth_methods_supported=("none",),
            )

        async def _fake_register(metadata, redirect_uri) -> RegisteredOAuthClient:
            return RegisteredOAuthClient(
                client_id="client-custom",
                client_secret=None,
                client_secret_expires_at=None,
                token_endpoint_auth_method="none",
                registration_client_uri=None,
                registration_access_token=None,
            )

        monkeypatch.setattr(oauth_service, "discover_protected_resource_metadata", _fake_protected)
        monkeypatch.setattr(
            oauth_service, "discover_authorization_server_metadata", _fake_auth_metadata
        )
        monkeypatch.setattr(
            oauth_clients, "discover_authorization_server_metadata", _fake_auth_metadata
        )
        monkeypatch.setattr(oauth_clients, "register_client", _fake_register)

        response = await client.post(
            "/v1/cloud/integrations/authentications",
            headers=auth.headers,
            json={"definitionId": definition_id, "authKind": "oauth2"},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["account"]["status"] == "setup_required"
        assert body["oauthFlowId"]
        assert body["authorizationUrl"].startswith("https://auth.custom.example.com/authorize")

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "namespace",
        ["", "Internal Tools", "-leading-dash", "UPPER", "a" * 65],
    )
    async def test_admin_create_rejects_invalid_namespace(
        self, client: AsyncClient, db_session: AsyncSession, namespace: str
    ) -> None:
        auth = await _authed_user(client, db_session, prefix="int-admin-badns")
        org_id = await _create_org_with_role(
            db_session, user_id=auth.user_id, role=ORGANIZATION_ROLE_OWNER
        )

        response = await client.post(
            f"/v1/cloud/integrations/admin/organizations/{org_id}/definitions",
            headers=auth.headers,
            json={
                "displayName": "Internal Tools",
                "namespace": namespace,
                "mcpUrl": "https://mcp.internal.example.com/mcp",
            },
        )
        assert response.status_code == 400, response.text
        assert response.json()["detail"]["code"] == "invalid_payload"

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "mcp_url",
        ["", "not-a-url", "ftp://mcp.example.com/mcp", "https://", "http:///path-only"],
    )
    async def test_admin_create_rejects_invalid_mcp_url(
        self, client: AsyncClient, db_session: AsyncSession, mcp_url: str
    ) -> None:
        auth = await _authed_user(client, db_session, prefix="int-admin-badurl")
        org_id = await _create_org_with_role(
            db_session, user_id=auth.user_id, role=ORGANIZATION_ROLE_OWNER
        )

        response = await client.post(
            f"/v1/cloud/integrations/admin/organizations/{org_id}/definitions",
            headers=auth.headers,
            json={
                "displayName": "Internal Tools",
                "namespace": "internal-tools",
                "mcpUrl": mcp_url,
            },
        )
        assert response.status_code == 400, response.text
        assert response.json()["detail"]["code"] == "invalid_payload"

    @pytest.mark.asyncio
    async def test_admin_create_requires_admin(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        auth = await _authed_user(client, db_session, prefix="int-nonadmin")
        org_id = await _create_org_with_role(
            db_session, user_id=auth.user_id, role=ORGANIZATION_ROLE_MEMBER
        )

        response = await client.post(
            f"/v1/cloud/integrations/admin/organizations/{org_id}/definitions",
            headers=auth.headers,
            json={
                "displayName": "Nope",
                "namespace": "nope",
                "mcpUrl": "https://mcp.internal.example.com/mcp",
            },
        )
        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "organization_permission_denied"

    @pytest.mark.asyncio
    async def test_admin_requires_membership(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        auth = await _authed_user(client, db_session, prefix="int-noorg")
        response = await client.get(
            f"/v1/cloud/integrations/admin/organizations/{uuid.uuid4()}/definitions",
            headers=auth.headers,
        )
        assert response.status_code == 404
