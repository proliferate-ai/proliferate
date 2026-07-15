from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.integrations import accounts as accounts_store
from proliferate.db.store.integrations import definitions as definitions_store
from proliferate.server.cloud.integrations.seeds import sync_seed_definitions
from proliferate.utils.crypto import encrypt_json
from tests.e2e.cloud.helpers.auth import create_user_and_login
from tests.e2e.cloud.helpers.github import seed_linked_github_account

HEALTH_URL = "/v1/cloud/integrations/health"


async def _authed(client: AsyncClient, db_session: AsyncSession, *, prefix: str):
    auth = await create_user_and_login(client, db_session, email_prefix=prefix)
    await seed_linked_github_account(db_session, user_id=auth.user_id, access_token=f"gh-{prefix}")
    await sync_seed_definitions(db_session)
    await db_session.commit()
    return auth


@pytest.mark.asyncio
async def test_health_requires_auth(client: AsyncClient) -> None:
    response = await client.get(HEALTH_URL)
    assert response.status_code in {401, 403}


@pytest.mark.asyncio
async def test_health_reports_needs_auth_for_unconnected_seeds(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    auth = await _authed(client, db_session, prefix="health-none")
    response = await client.get(HEALTH_URL, headers=auth.headers)
    assert response.status_code == 200, response.text
    items = {i["namespace"]: i for i in response.json()["items"]}
    # Every seed is visible and, with no account, needs auth.
    assert items["context7"]["health"] == "needs_auth"
    assert items["linear"]["health"] == "needs_auth"
    assert items["context7"]["accountId"] is None


@pytest.mark.asyncio
async def test_health_reports_ready_for_connected_api_key(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    auth = await _authed(client, db_session, prefix="health-ready")
    definition = await definitions_store.get_seed_by_namespace(db_session, "context7")
    account = await accounts_store.upsert_account(
        db_session,
        user_id=uuid.UUID(auth.user_id),
        definition_id=definition.id,
        auth_kind="api_key",
        status="ready",
    )
    await accounts_store.set_account_credentials(
        db_session,
        account_id=account.id,
        credential_ciphertext=encrypt_json({"secretFields": {"api_key": "secret"}}),
        credential_format="secret-fields-v1",
        auth_status="ready",
        token_expires_at=None,
    )
    await db_session.commit()

    response = await client.get(HEALTH_URL, headers=auth.headers)
    items = {i["namespace"]: i for i in response.json()["items"]}
    assert items["context7"]["health"] == "ready"
    assert items["context7"]["accountId"] is not None


@pytest.mark.asyncio
async def test_health_reports_needs_reauth_when_oauth_refresh_fails(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    auth = await _authed(client, db_session, prefix="health-reauth")
    definition = await definitions_store.get_seed_by_namespace(db_session, "linear")
    account = await accounts_store.upsert_account(
        db_session,
        user_id=uuid.UUID(auth.user_id),
        definition_id=definition.id,
        auth_kind="oauth2",
        status="ready",
    )
    # An expired bundle with no usable refresh forces the reauth path.
    await accounts_store.set_account_credentials(
        db_session,
        account_id=account.id,
        credential_ciphertext=encrypt_json(
            {
                "issuer": "https://auth.linear.app",
                "resource": "https://mcp.linear.app/mcp",
                "clientId": "c",
                "accessToken": "expired",
                "refreshToken": None,
                "expiresAt": "2000-01-01T00:00:00+00:00",
                "scopes": [],
                "tokenEndpoint": "https://auth.linear.app/oauth/token",
                "redirectUri": "https://api.example.com/cb",
            }
        ),
        credential_format="oauth-bundle-v1",
        auth_status="ready",
        token_expires_at=None,
    )
    await db_session.commit()

    response = await client.get(HEALTH_URL, headers=auth.headers)
    items = {i["namespace"]: i for i in response.json()["items"]}
    assert items["linear"]["health"] == "needs_reauth"


@pytest.mark.asyncio
async def test_health_isolates_non_cloud_probe_failure(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    # A non-CloudApiError from the probe path (e.g. a provider/network timeout
    # or a DB error on the probe session) must not 500 the whole endpoint: it
    # is isolated to that one account as a generic error while every other
    # integration still reports its health.
    auth = await _authed(client, db_session, prefix="health-probe-crash")
    definition = await definitions_store.get_seed_by_namespace(db_session, "linear")
    account = await accounts_store.upsert_account(
        db_session,
        user_id=uuid.UUID(auth.user_id),
        definition_id=definition.id,
        auth_kind="oauth2",
        status="ready",
    )
    await accounts_store.set_account_credentials(
        db_session,
        account_id=account.id,
        credential_ciphertext=encrypt_json(
            {
                "issuer": "https://auth.linear.app",
                "resource": "https://mcp.linear.app/mcp",
                "clientId": "c",
                "accessToken": "tok",
                "refreshToken": "r",
                "expiresAt": "2000-01-01T00:00:00+00:00",
                "scopes": [],
                "tokenEndpoint": "https://auth.linear.app/oauth/token",
                "redirectUri": "https://api.example.com/cb",
            }
        ),
        credential_format="oauth-bundle-v1",
        auth_status="ready",
        token_expires_at=None,
    )
    await db_session.commit()

    async def _boom(*_args: object, **_kwargs: object) -> None:
        # Not a CloudApiError — the exact failure the gather default would
        # otherwise propagate out of the whole health response.
        raise TimeoutError("provider timed out")

    monkeypatch.setattr(
        "proliferate.server.cloud.integrations.health.ensure_provider_access", _boom
    )

    response = await client.get(HEALTH_URL, headers=auth.headers)
    assert response.status_code == 200, response.text
    items = {i["namespace"]: i for i in response.json()["items"]}
    # The crashing OAuth probe is isolated to an error verdict...
    assert items["linear"]["health"] == "error"
    assert items["linear"]["lastErrorCode"] == "probe_failed"
    # ...while unrelated integrations still report normally.
    assert items["context7"]["health"] == "needs_auth"


@pytest.mark.asyncio
async def test_health_rejects_non_member_org_id(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    auth = await _authed(client, db_session, prefix="health-crosstenant")
    # A random org the user is not a member of must not be readable.
    response = await client.get(
        HEALTH_URL,
        headers=auth.headers,
        params={"organizationId": str(uuid.uuid4())},
    )
    assert response.status_code == 404
