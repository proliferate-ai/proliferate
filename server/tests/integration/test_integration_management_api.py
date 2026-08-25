from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_STATUS_ACTIVE,
)
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.store.integrations import accounts as accounts_store
from proliferate.db.store.integrations import authorization_attempts as attempts_store
from proliferate.db.store.integrations import definitions as definitions_store
from proliferate.db.store.integrations import policies as policies_store
from proliferate.db.store.integrations.definition_security_revisions import (
    ensure_current_definition_security_revision,
)
from proliferate.db.store.integrations.tool_cache import upsert_tool_cache
from proliferate.integrations.integration_oauth.models import (
    AuthorizationServerMetadata,
    ProtectedResourceMetadata,
    RegisteredOAuthClient,
)
from proliferate.lib.infra.encryption.json import encrypt_json
from proliferate.server.integration_gateway.connections.oauth import clients as oauth_clients
from proliferate.server.integration_gateway.connections.oauth import service as oauth_service
from proliferate.server.integration_gateway.connections.seeds import sync_seed_definitions
from tests.e2e.cloud.helpers.auth import create_user_and_login
from tests.e2e.cloud.helpers.github import seed_linked_github_account


async def _definition(db_session: AsyncSession, namespace: str):
    definition = await definitions_store.get_seed_by_namespace(db_session, namespace)
    assert definition is not None
    return definition


async def _create_org(db_session: AsyncSession, *, user_id: uuid.UUID) -> uuid.UUID:
    now = datetime.now(UTC)
    organization = Organization(
        name="Lifecycle Test Org",
        logo_domain="lifecycle.example",
        status=ORGANIZATION_STATUS_ACTIVE,
        created_at=now,
        updated_at=now,
    )
    db_session.add(organization)
    await db_session.flush()
    db_session.add(
        OrganizationMembership(
            organization_id=organization.id,
            user_id=user_id,
            role="owner",
            status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            joined_at=now,
            created_at=now,
            updated_at=now,
        )
    )
    await db_session.flush()
    return organization.id


def _mock_sentry_start(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _protected(_server_url: str) -> ProtectedResourceMetadata:
        return ProtectedResourceMetadata(
            authorization_servers=("https://auth.example.com",),
            resource="https://mcp.sentry.dev/mcp",
            challenged_scope=None,
        )

    async def _metadata(issuer: str) -> AuthorizationServerMetadata:
        return AuthorizationServerMetadata(
            issuer=issuer,
            authorization_endpoint="https://auth.example.com/authorize",
            token_endpoint="https://auth.example.com/token",
            registration_endpoint="https://auth.example.com/register",
            token_endpoint_auth_methods_supported=("none",),
        )

    async def _register(
        _metadata: AuthorizationServerMetadata,
        _redirect_uri: str,
    ) -> RegisteredOAuthClient:
        return RegisteredOAuthClient(
            client_id="management-client",
            client_secret=None,
            client_secret_expires_at=None,
            token_endpoint_auth_method="none",
            registration_client_uri=None,
            registration_access_token=None,
        )

    monkeypatch.setattr(oauth_service, "discover_protected_resource_metadata", _protected)
    monkeypatch.setattr(oauth_service, "discover_authorization_server_metadata", _metadata)
    monkeypatch.setattr(oauth_clients, "discover_authorization_server_metadata", _metadata)
    monkeypatch.setattr(oauth_clients, "register_client", _register)


@pytest.mark.asyncio
async def test_management_projection_is_authoritative_reloadable_and_secret_free(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    auth = await create_user_and_login(
        client,
        db_session,
        email_prefix="integration-management",
    )
    user_id = uuid.UUID(auth.user_id)
    await seed_linked_github_account(
        db_session,
        user_id=auth.user_id,
        access_token="gh-integration-management",
    )
    await sync_seed_definitions(db_session)
    organization_id = await _create_org(db_session, user_id=user_id)
    context7 = await _definition(db_session, "context7")
    exa = await _definition(db_session, "exa")
    neon = await _definition(db_session, "neon")
    sentry = await _definition(db_session, "sentry")
    tavily = await _definition(db_session, "tavily")

    secret_sentinel = "management-secret-must-never-appear"
    ready = await accounts_store.upsert_account(
        db_session,
        user_id=user_id,
        definition_id=context7.id,
        auth_kind="api_key",
        status="ready",
    )
    ready = await accounts_store.set_account_credentials(
        db_session,
        account_id=ready.id,
        credential_ciphertext=encrypt_json(
            {"secretFields": {"api_key": secret_sentinel}},
            secret=settings.cloud_secret_key,
        ),
        credential_format="secret-fields-v1",
        auth_status="ready",
        token_expires_at=None,
    )
    assert ready is not None
    await upsert_tool_cache(
        db_session,
        account_id=ready.id,
        grant_version=ready.grant_version,
        tools_json=json.dumps([{"name": "one"}, {"name": "two"}, {"name": "three"}]),
        content_hash=None,
        status="ready",
        fetched_at=datetime.now(UTC),
        error_code=None,
    )
    await accounts_store.upsert_account(
        db_session,
        user_id=user_id,
        definition_id=exa.id,
        auth_kind="api_key",
        status="error",
    )
    await policies_store.upsert_policy(
        db_session,
        organization_id=organization_id,
        definition_id=neon.id,
        enabled=False,
        updated_by_user_id=user_id,
    )
    tavily_revision = await ensure_current_definition_security_revision(
        db_session,
        tavily.id,
    )
    assert tavily_revision is not None
    expired = await attempts_store.create_authorization_attempt(
        db_session,
        owner_user_id=user_id,
        definition_id=tavily.id,
        account_id=None,
        purpose="connect",
        method="api_key",
        starting_grant_version=None,
        starting_credential_version=None,
        definition_security_revision_id=tavily_revision.id,
        provider_client_id=None,
        credential_audience="https://mcp.tavily.com/mcp",
        settings_json="{}",
        requested_scopes_json="[]",
        effective_scopes_json="[]",
        staged_credential_ciphertext=encrypt_json(
            {"secretFields": {"api_key": secret_sentinel}},
            secret=settings.cloud_secret_key,
        ),
        staged_credential_format="secret-fields-v1",
        status="validating",
        expires_at=datetime.now(UTC) - timedelta(seconds=1),
    )
    await db_session.commit()

    _mock_sentry_start(monkeypatch)
    started = await client.post(
        "/v1/cloud/integrations/authentications",
        headers=auth.headers,
        json={"definitionId": str(sentry.id), "authKind": "oauth2"},
    )
    assert started.status_code == 200, started.text
    sentry_attempt_id = started.json()["attemptId"]

    monkeypatch.setattr(oauth_clients.app_settings, "cloud_mcp_slack_enabled", False)
    monkeypatch.setattr(
        oauth_clients.app_settings,
        "cloud_mcp_slack_distribution_ready",
        False,
    )
    url = f"/v1/cloud/integrations/management?organizationId={organization_id}"
    first = await client.get(url, headers=auth.headers)
    second = await client.get(url, headers=auth.headers)
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    assert secret_sentinel not in first.text
    items = {item["namespace"]: item for item in first.json()["items"]}

    assert items["context7"]["connection"]["health"] == "ready"
    assert items["context7"]["connection"]["toolCount"] == 3
    assert items["context7"]["actions"] == {
        "primary": "none",
        "secondary": ["disconnect"],
    }
    assert items["exa"]["connection"]["health"] == "error"
    assert items["exa"]["actions"] == {
        "primary": "reconnect",
        "secondary": ["disconnect"],
    }
    assert items["sentry"]["attempt"]["status"] == "active"
    assert items["sentry"]["attempt"]["authorizationUrl"].startswith(
        "https://auth.example.com/authorize"
    )
    assert items["sentry"]["actions"] == {
        "primary": "open_authorization",
        "secondary": ["cancel"],
    }
    assert items["tavily"]["attempt"]["attemptId"] == str(expired.id)
    assert items["tavily"]["attempt"]["status"] == "expired"
    assert items["tavily"]["actions"] == {"primary": "connect", "secondary": []}
    assert items["slack"]["availability"] == {
        "available": False,
        "reason": "distribution_required",
    }
    assert items["slack"]["actions"]["primary"] == "none"
    assert items["neon"]["availability"] == {
        "available": False,
        "reason": "disabled_by_org",
    }
    assert items["neon"]["actions"]["primary"] == "none"

    await db_session.rollback()
    expired_after_reload = await attempts_store.get_authorization_attempt(
        db_session,
        expired.id,
    )
    assert expired_after_reload is not None
    assert expired_after_reload.status == "expired"
    assert expired_after_reload.staged_credential_ciphertext is None

    cancelled = await client.post(
        f"/v1/cloud/integrations/authorization-attempts/{sentry_attempt_id}/cancel",
        headers=auth.headers,
    )
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["attempt"]["status"] == "cancelled"
    duplicate_cancel = await client.post(
        f"/v1/cloud/integrations/authorization-attempts/{sentry_attempt_id}/cancel",
        headers=auth.headers,
    )
    assert duplicate_cancel.status_code == 409

    reloaded = await client.get(url, headers=auth.headers)
    sentry_after_cancel = {item["namespace"]: item for item in reloaded.json()["items"]}["sentry"]
    assert sentry_after_cancel["attempt"]["status"] == "cancelled"
    assert sentry_after_cancel["attempt"]["authorizationUrl"] is None
    assert sentry_after_cancel["actions"] == {"primary": "connect", "secondary": []}
