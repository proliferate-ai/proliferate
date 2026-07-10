from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import User
from proliferate.db.store.integrations import accounts as accounts_store
from proliferate.db.store.integrations import definitions as definitions_store
from proliferate.server.cloud.integrations.access import ensure_provider_access
from proliferate.server.cloud.integrations.config import (
    IntegrationConfig,
    StaticUrl,
    serialize_definition_config,
)
from proliferate.server.cloud.integrations.seeds import sync_seed_definitions
from proliferate.utils.crypto import encrypt_json


@pytest.mark.asyncio
async def test_sync_seed_definitions_is_idempotent(db_session: AsyncSession) -> None:
    first = await sync_seed_definitions(db_session)
    await db_session.commit()
    assert len(first) == 13

    second = await sync_seed_definitions(db_session)
    await db_session.commit()
    assert len(second) == 13

    seeds = await definitions_store.list_seed_definitions(db_session)
    namespaces = {d.namespace for d in seeds}
    assert {"linear", "context7", "exa"} <= namespaces


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
    # Accounts carry a real owner FK, so seed a user row for the fixture.
    user = User(email=f"{uuid.uuid4().hex}@access.test", hashed_password="unused")
    db_session.add(user)
    await db_session.flush()
    account = await accounts_store.upsert_account(
        db_session,
        user_id=user.id,
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
    # Create a test definition with auth_kind="none" since no seed has that anymore.
    test_config = IntegrationConfig(
        transport="http",
        url=StaticUrl("https://test.example.com/mcp"),
        display_url="https://test.example.com/mcp",
    )
    definition = await definitions_store.upsert_seed_definition(
        db_session,
        namespace="test_none_auth",
        display_name="Test None Auth",
        description="Test provider for none auth",
        auth_kind="none",
        oauth_client_mode=None,
        config_json=serialize_definition_config(test_config),
        enabled_by_default=True,
    )
    user = User(email=f"{uuid.uuid4().hex}@access.test", hashed_password="unused")
    db_session.add(user)
    await db_session.flush()
    account = await accounts_store.upsert_account(
        db_session,
        user_id=user.id,
        definition_id=definition.id,
        auth_kind="none",
        status="ready",
    )
    await db_session.commit()
    account = await accounts_store.get_account(db_session, account.id)

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


@pytest.mark.asyncio
async def test_sync_archives_removed_seeds_and_unarchives_restored_ones(
    db_session: AsyncSession,
) -> None:
    # Insert a fake seed definition simulating a previously-shipped seed.
    test_config = IntegrationConfig(
        transport="http",
        url=StaticUrl("https://test.example.com/mcp"),
        display_url="https://test.example.com/mcp",
    )
    fake_seed = await definitions_store.upsert_seed_definition(
        db_session,
        namespace="removed_test_seed",
        display_name="Removed Test Seed",
        description="Test seed that will be removed",
        auth_kind="none",
        oauth_client_mode=None,
        config_json=serialize_definition_config(test_config),
        enabled_by_default=True,
    )
    await db_session.commit()
    assert fake_seed.archived_at is None

    # Sync the actual seeds (which don't include removed_test_seed).
    await sync_seed_definitions(db_session)
    await db_session.commit()

    # Verify the fake seed was archived.
    archived_seed = await definitions_store.get_seed_by_namespace(db_session, "removed_test_seed")
    assert archived_seed is not None
    assert archived_seed.archived_at is not None

    # Verify actual seeds remain unarchived.
    current_seeds = await definitions_store.list_seed_definitions(db_session)
    assert len(current_seeds) == 13
    for seed in current_seeds:
        assert seed.archived_at is None

    # Re-add the fake seed via upsert and verify it gets unarchived.
    restored_seed = await definitions_store.upsert_seed_definition(
        db_session,
        namespace="removed_test_seed",
        display_name="Restored Test Seed",
        description="Test seed that was restored",
        auth_kind="none",
        oauth_client_mode=None,
        config_json=serialize_definition_config(test_config),
        enabled_by_default=True,
    )
    await db_session.commit()
    assert restored_seed.archived_at is None
