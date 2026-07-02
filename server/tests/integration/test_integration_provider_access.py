from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.integrations import accounts as accounts_store
from proliferate.db.store.integrations import definitions as definitions_store
from proliferate.server.cloud.integrations.access import ensure_provider_access
from proliferate.server.cloud.integrations.seeds import sync_seed_definitions
from proliferate.utils.crypto import encrypt_json


@pytest.mark.asyncio
async def test_sync_seed_definitions_is_idempotent(db_session: AsyncSession) -> None:
    first = await sync_seed_definitions(db_session)
    await db_session.commit()
    assert len(first) == 14

    second = await sync_seed_definitions(db_session)
    await db_session.commit()
    assert len(second) == 14

    seeds = await definitions_store.list_seed_definitions(db_session)
    namespaces = {d.namespace for d in seeds}
    assert {"linear", "context7", "exa", "cloudflare_docs"} <= namespaces


async def _account_for(
    db_session: AsyncSession,
    *,
    namespace: str,
    auth_kind: str,
    credential_ciphertext: str | None,
    credential_format: str,
):
    await sync_seed_definitions(db_session)
    await db_session.commit()
    definition = await definitions_store.get_seed_by_namespace(db_session, namespace)
    assert definition is not None
    account = await accounts_store.upsert_account(
        db_session,
        user_id=uuid.uuid4(),
        definition_id=definition.id,
        auth_kind=auth_kind,
        status="ready",
    )
    if credential_ciphertext is not None:
        await accounts_store.set_account_credentials(
            db_session,
            account_id=account.id,
            credential_ciphertext=credential_ciphertext,
            credential_format=credential_format,
            auth_status="ready",
            token_expires_at=None,
        )
    await db_session.commit()
    account = await accounts_store.get_account(db_session, account.id)
    return definition, account


@pytest.mark.asyncio
async def test_api_key_access_renders_bearer_header(db_session: AsyncSession) -> None:
    definition, account = await _account_for(
        db_session,
        namespace="context7",
        auth_kind="api_key",
        credential_ciphertext=encrypt_json({"secretFields": {"api_key": "ctx7sk-secret"}}),
        credential_format="secret-fields-v1",
    )
    access = await ensure_provider_access(
        db_session, account_record=account, definition_record=definition
    )
    assert access.headers.get("Authorization") == "Bearer ctx7sk-secret"


@pytest.mark.asyncio
async def test_api_key_access_renders_query_param(db_session: AsyncSession) -> None:
    definition, account = await _account_for(
        db_session,
        namespace="exa",
        auth_kind="api_key",
        credential_ciphertext=encrypt_json({"secretFields": {"api_key": "exa-secret"}}),
        credential_format="secret-fields-v1",
    )
    access = await ensure_provider_access(
        db_session, account_record=account, definition_record=definition
    )
    assert access.query.get("exaApiKey") == "exa-secret"


@pytest.mark.asyncio
async def test_none_auth_access_is_empty(db_session: AsyncSession) -> None:
    definition, account = await _account_for(
        db_session,
        namespace="cloudflare_docs",
        auth_kind="none",
        credential_ciphertext=None,
        credential_format="json-v1",
    )
    access = await ensure_provider_access(
        db_session, account_record=account, definition_record=definition
    )
    assert access.headers == {} or "Authorization" not in access.headers


@pytest.mark.asyncio
async def test_oauth_access_uses_unexpired_access_token(db_session: AsyncSession) -> None:
    bundle = {
        "issuer": "https://auth.linear.app",
        "resource": "https://mcp.linear.app/mcp",
        "clientId": "client-123",
        "accessToken": "linear-access-token",
        "refreshToken": "linear-refresh-token",
        "expiresAt": None,  # no expiry => always valid
        "scopes": [],
        "tokenEndpoint": "https://auth.linear.app/oauth/token",
        "redirectUri": "https://api.example.com/v1/cloud/integrations/oauth/callback",
    }
    definition, account = await _account_for(
        db_session,
        namespace="linear",
        auth_kind="oauth2",
        credential_ciphertext=encrypt_json(bundle),
        credential_format="oauth-bundle-v1",
    )
    access = await ensure_provider_access(
        db_session, account_record=account, definition_record=definition
    )
    assert access.headers.get("Authorization") == "Bearer linear-access-token"
