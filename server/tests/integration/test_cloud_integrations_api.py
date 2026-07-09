from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_STATUS_ACTIVE,
)
from proliferate.db.models.cloud.integrations import (
    CloudIntegrationAccount,
    CloudIntegrationDefinition,
    CloudIntegrationOAuthFlow,
)
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.store.integrations import accounts as accounts_store
from proliferate.db.store.integrations import definitions as definitions_store
from proliferate.db.store.integrations.tool_cache import get_tool_cache, upsert_tool_cache
from proliferate.integrations.integration_oauth.models import (
    AuthorizationServerMetadata,
    ProtectedResourceMetadata,
    RegisteredOAuthClient,
)
from proliferate.server.cloud.integrations.oauth import clients as oauth_clients
from proliferate.server.cloud.integrations.oauth import service as oauth_service
from proliferate.server.cloud.integrations.seeds import sync_seed_definitions
from proliferate.utils.crypto import decrypt_json
from tests.e2e.cloud.helpers.auth import create_user_and_login
from tests.e2e.cloud.helpers.github import seed_linked_github_account


async def _authed_user(client: AsyncClient, db_session: AsyncSession, *, prefix: str):
    auth = await create_user_and_login(client, db_session, email_prefix=prefix)
    await seed_linked_github_account(
        db_session,
        user_id=auth.user_id,
        access_token=f"gh-{prefix}",
    )
    return auth


async def _seed_definitions(db_session: AsyncSession):
    await sync_seed_definitions(db_session)
    await db_session.commit()


async def _definition_id(db_session: AsyncSession, namespace: str) -> str:
    definition = await definitions_store.get_seed_by_namespace(db_session, namespace)
    assert definition is not None
    return str(definition.id)


async def _create_org_with_role(db_session: AsyncSession, *, user_id: str, role: str) -> str:
    now = datetime.now(UTC)
    organization = Organization(
        name="Acme",
        logo_domain="acme.dev",
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
            role=role,
            status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            joined_at=now,
            created_at=now,
            updated_at=now,
        )
    )
    await db_session.commit()
    return str(organization.id)


class TestAuthenticateIntegration:
    @pytest.mark.asyncio
    async def test_requires_auth(self, client: AsyncClient) -> None:
        response = await client.post(
            "/v1/cloud/integrations/authentications",
            json={"definitionId": str(uuid.uuid4()), "authKind": "none"},
        )
        assert response.status_code in {401, 403}

    @pytest.mark.asyncio
    async def test_authenticate_none_returns_ready_account(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        auth = await _authed_user(client, db_session, prefix="int-none")
        await _seed_definitions(db_session)
        definition_id = await _definition_id(db_session, "cloudflare_docs")

        response = await client.post(
            "/v1/cloud/integrations/authentications",
            headers=auth.headers,
            json={"definitionId": definition_id, "authKind": "none"},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["oauthFlowId"] is None
        account = body["account"]
        assert account["status"] == "ready"
        assert account["authKind"] == "none"
        assert account["namespace"] == "cloudflare_docs"

    @pytest.mark.asyncio
    async def test_authenticate_api_key_stores_credential(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        auth = await _authed_user(client, db_session, prefix="int-key")
        await _seed_definitions(db_session)
        definition_id = await _definition_id(db_session, "context7")

        response = await client.post(
            "/v1/cloud/integrations/authentications",
            headers=auth.headers,
            json={
                "definitionId": definition_id,
                "authKind": "api_key",
                "apiKey": "ctx7sk-secret-value",
            },
        )
        assert response.status_code == 200, response.text
        account = response.json()["account"]
        assert account["status"] == "ready"
        assert account["authKind"] == "api_key"

        stored = await accounts_store.get_account_for_user_definition(
            db_session,
            uuid.UUID(auth.user_id),
            uuid.UUID(definition_id),
        )
        assert stored is not None
        assert stored.credential_format == "secret-fields-v1"
        assert stored.credential_ciphertext is not None
        decoded = decrypt_json(stored.credential_ciphertext)
        assert decoded["secretFields"]["api_key"] == "ctx7sk-secret-value"

    @pytest.mark.asyncio
    async def test_authenticate_api_key_requires_key(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        auth = await _authed_user(client, db_session, prefix="int-key-missing")
        await _seed_definitions(db_session)
        definition_id = await _definition_id(db_session, "context7")

        response = await client.post(
            "/v1/cloud/integrations/authentications",
            headers=auth.headers,
            json={"definitionId": definition_id, "authKind": "api_key", "apiKey": ""},
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "invalid_payload"

    @pytest.mark.asyncio
    async def test_authenticate_mismatched_auth_kind(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        auth = await _authed_user(client, db_session, prefix="int-mismatch")
        await _seed_definitions(db_session)
        definition_id = await _definition_id(db_session, "context7")

        response = await client.post(
            "/v1/cloud/integrations/authentications",
            headers=auth.headers,
            json={"definitionId": definition_id, "authKind": "none"},
        )
        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_authenticate_oauth2_starts_flow(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        auth = await _authed_user(client, db_session, prefix="int-oauth")
        await _seed_definitions(db_session)
        definition_id = await _definition_id(db_session, "sentry")

        async def _fake_protected(server_url: str) -> ProtectedResourceMetadata:
            return ProtectedResourceMetadata(
                authorization_servers=("https://auth.example.com",),
                resource="https://mcp.sentry.dev/mcp",
                challenged_scope=None,
            )

        async def _fake_auth_metadata(issuer: str) -> AuthorizationServerMetadata:
            return AuthorizationServerMetadata(
                issuer="https://auth.example.com",
                authorization_endpoint="https://auth.example.com/authorize",
                token_endpoint="https://auth.example.com/token",
                registration_endpoint="https://auth.example.com/register",
                token_endpoint_auth_methods_supported=("none",),
            )

        async def _fake_register(metadata, redirect_uri) -> RegisteredOAuthClient:
            return RegisteredOAuthClient(
                client_id="client-abc",
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
        assert body["authorizationUrl"].startswith("https://auth.example.com/authorize")
        assert body["expiresAt"]

        # Flow status endpoint exposes the active flow with its authorization URL.
        flow_response = await client.get(
            f"/v1/cloud/integrations/oauth/flows/{body['oauthFlowId']}",
            headers=auth.headers,
        )
        assert flow_response.status_code == 200, flow_response.text
        flow = flow_response.json()
        assert flow["status"] == "active"
        assert flow["authorizationUrl"].startswith("https://auth.example.com/authorize")


class TestRemoveAccount:
    @pytest.mark.asyncio
    async def test_remove_account(self, client: AsyncClient, db_session: AsyncSession) -> None:
        auth = await _authed_user(client, db_session, prefix="int-remove")
        await _seed_definitions(db_session)
        definition_id = await _definition_id(db_session, "cloudflare_docs")

        created = await client.post(
            "/v1/cloud/integrations/authentications",
            headers=auth.headers,
            json={"definitionId": definition_id, "authKind": "none"},
        )
        account_id = created.json()["account"]["accountId"]

        removed = await client.delete(
            f"/v1/cloud/integrations/accounts/{account_id}",
            headers=auth.headers,
        )
        assert removed.status_code == 204, removed.text

        gone = await accounts_store.get_account(db_session, uuid.UUID(account_id))
        assert gone is None

    @pytest.mark.asyncio
    async def test_remove_missing_account(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        auth = await _authed_user(client, db_session, prefix="int-remove-missing")
        response = await client.delete(
            f"/v1/cloud/integrations/accounts/{uuid.uuid4()}",
            headers=auth.headers,
        )
        assert response.status_code == 404


class TestIntegrationForeignKeys:
    @pytest.mark.asyncio
    async def test_delete_definition_with_account_is_restricted(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        auth = await _authed_user(client, db_session, prefix="fk-restrict")
        await _seed_definitions(db_session)
        definition_id = uuid.UUID(await _definition_id(db_session, "context7"))
        await accounts_store.upsert_account(
            db_session,
            user_id=uuid.UUID(auth.user_id),
            definition_id=definition_id,
            auth_kind="api_key",
            status="ready",
        )
        await db_session.commit()

        with pytest.raises(IntegrityError):
            await db_session.execute(
                delete(CloudIntegrationDefinition).where(
                    CloudIntegrationDefinition.id == definition_id
                )
            )
        await db_session.rollback()

    @pytest.mark.asyncio
    async def test_delete_account_cascades_tool_cache_and_flows(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        auth = await _authed_user(client, db_session, prefix="fk-cascade")
        await _seed_definitions(db_session)
        definition_id = uuid.UUID(await _definition_id(db_session, "context7"))
        account = await accounts_store.upsert_account(
            db_session,
            user_id=uuid.UUID(auth.user_id),
            definition_id=definition_id,
            auth_kind="api_key",
            status="ready",
        )
        await upsert_tool_cache(
            db_session,
            account_id=account.id,
            auth_version=account.auth_version,
            tools_json="[]",
            content_hash=None,
            status="ready",
            fetched_at=datetime.now(UTC),
            error_code=None,
        )
        db_session.add(
            CloudIntegrationOAuthFlow(
                account_id=account.id,
                owner_user_id=uuid.UUID(auth.user_id),
                definition_id=definition_id,
                state_hash="fk-cascade-state",
                code_verifier_ciphertext="ciphertext",
                client_id="client",
                redirect_uri="https://api.example.com/cb",
                authorization_url="https://auth.example.com/authorize",
                expires_at=datetime.now(UTC) + timedelta(minutes=5),
            )
        )
        await db_session.commit()

        await db_session.execute(
            delete(CloudIntegrationAccount).where(CloudIntegrationAccount.id == account.id)
        )
        await db_session.commit()

        assert await get_tool_cache(db_session, account.id) is None
        remaining_flows = (
            (
                await db_session.execute(
                    select(CloudIntegrationOAuthFlow).where(
                        CloudIntegrationOAuthFlow.account_id == account.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert remaining_flows == []
