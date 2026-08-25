from __future__ import annotations

import asyncio
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.models.integrations import (
    CloudIntegrationAccount,
    CloudIntegrationDefinition,
    CloudIntegrationOAuthClient,
    CloudIntegrationToolSchemaCache,
)
from proliferate.db.models.runtime_workers import CloudRuntimeWorker
from proliferate.db.store.integrations import accounts as accounts_store
from proliferate.db.store.integrations import definitions as definitions_store
from proliferate.db.store.integrations import oauth_clients as oauth_clients_store
from proliferate.db.store.integrations.definition_security_revisions import (
    ensure_current_definition_security_revision,
)
from proliferate.lib.infra.encryption.json import encrypt_json
from proliferate.server.integration_gateway.connections.config import (
    parse_definition_config,
    render_mcp_url,
)
from proliferate.server.integration_gateway.connections.seeds import sync_seed_definitions
from proliferate.integrations.integration_oauth import normalize_resource_url
from tests.integration.test_cloud_integration_gateway_api import (
    _authed_user,
    _enroll_gateway_bearer,
    _seed_ready_account,
    _tool_call,
)


@pytest.fixture(autouse=True)
def _worker_cloud_base_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "cloud_worker_base_url", "http://cloud.test")


async def _worker(db_session: AsyncSession) -> CloudRuntimeWorker:
    worker = (await db_session.scalars(select(CloudRuntimeWorker))).first()
    assert worker is not None
    return worker


async def _seed_pinned_api_account(
    db_session: AsyncSession,
    *,
    user_id: uuid.UUID,
) -> tuple[CloudIntegrationAccount, CloudIntegrationDefinition]:
    await _seed_ready_account(
        db_session,
        user_id=str(user_id),
        namespace="context7",
    )
    definition_record = await definitions_store.get_seed_by_namespace(db_session, "context7")
    assert definition_record is not None
    revision = await ensure_current_definition_security_revision(
        db_session,
        definition_record.id,
    )
    account = await db_session.scalar(
        select(CloudIntegrationAccount).where(
            CloudIntegrationAccount.owner_user_id == user_id,
            CloudIntegrationAccount.definition_id == definition_record.id,
        )
    )
    definition = await db_session.get(CloudIntegrationDefinition, definition_record.id)
    assert account is not None and definition is not None and revision is not None
    config = parse_definition_config(definition_record.config_json)
    account.definition_security_revision_id = revision.id
    account.credential_audience = normalize_resource_url(render_mcp_url(config, {}))
    await db_session.commit()
    return account, definition


async def _assert_provider_rejected_without_io(
    client: AsyncClient,
    *,
    bearer: str,
    monkeypatch: pytest.MonkeyPatch,
    expected_message: str,
) -> None:
    calls = 0

    async def _unexpected_provider_call(**_kwargs: object) -> dict[str, object]:
        nonlocal calls
        calls += 1
        return {"content": [], "isError": False}

    monkeypatch.setattr(
        "proliferate.server.integration_gateway.gateway.service.mcp_remote.call_tool",
        _unexpected_provider_call,
    )
    result = await _tool_call(
        client,
        {"Authorization": f"Bearer {bearer}"},
        name="integrations.call_tool",
        arguments={
            "provider": "context7",
            "tool": "resolve-library-id",
            "arguments": {},
        },
    )

    assert result["isError"] is True
    assert expected_message in result["content"][0]["text"]
    assert calls == 0


@pytest.mark.asyncio
async def test_pinned_audience_mismatch_rejects_before_provider_io(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    auth = await _authed_user(client, db_session, prefix="admission-audience")
    bearer = await _enroll_gateway_bearer(client, auth, prefix="admission-audience")
    account, _definition = await _seed_pinned_api_account(
        db_session,
        user_id=uuid.UUID(auth.user_id),
    )
    account.credential_audience = "https://other.example/mcp"
    await db_session.commit()

    await _assert_provider_rejected_without_io(
        client,
        bearer=bearer,
        monkeypatch=monkeypatch,
        expected_message="audience changed",
    )


@pytest.mark.asyncio
async def test_pinned_definition_mismatch_rejects_before_provider_io(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    auth = await _authed_user(client, db_session, prefix="admission-definition")
    bearer = await _enroll_gateway_bearer(client, auth, prefix="admission-definition")
    _account, definition = await _seed_pinned_api_account(
        db_session,
        user_id=uuid.UUID(auth.user_id),
    )
    definition.config_json = f"{definition.config_json} "
    await db_session.commit()

    await _assert_provider_rejected_without_io(
        client,
        bearer=bearer,
        monkeypatch=monkeypatch,
        expected_message="definition changed",
    )


@pytest.mark.asyncio
async def test_retired_pinned_oauth_client_rejects_before_provider_io(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    auth = await _authed_user(client, db_session, prefix="admission-retired-client")
    bearer = await _enroll_gateway_bearer(
        client,
        auth,
        prefix="admission-retired-client",
    )
    await sync_seed_definitions(db_session)
    await db_session.commit()
    definition = await definitions_store.get_seed_by_namespace(db_session, "slack")
    assert definition is not None
    revision = await ensure_current_definition_security_revision(db_session, definition.id)
    provider_client = await oauth_clients_store.upsert_oauth_client(
        db_session,
        definition_id=definition.id,
        issuer="https://slack.com",
        redirect_uri="https://api.example.com/v1/cloud/integrations/oauth/callback",
        resource="https://mcp.slack.com/mcp",
        client_id="slack-client",
        client_secret_ciphertext=None,
        client_secret_expires_at=None,
        token_endpoint_auth_method="none",
        registration_client_uri=None,
        registration_access_token_ciphertext=None,
    )
    account_record = await accounts_store.upsert_account(
        db_session,
        user_id=uuid.UUID(auth.user_id),
        definition_id=definition.id,
        auth_kind="oauth2",
        status="ready",
    )
    await accounts_store.set_account_credentials(
        db_session,
        account_id=account_record.id,
        credential_ciphertext=encrypt_json(
            {
                "issuer": "https://slack.com",
                "resource": "https://mcp.slack.com/mcp",
                "clientId": "slack-client",
                "accessToken": "slack-access-token",
                "refreshToken": "slack-refresh-token",
                "expiresAt": None,
                "scopes": [],
                "tokenEndpoint": "https://slack.com/api/oauth.v2.user.access",
                "redirectUri": ("https://api.example.com/v1/cloud/integrations/oauth/callback"),
            },
            secret=settings.cloud_secret_key,
        ),
        credential_format="oauth-bundle-v1",
        auth_status="ready",
        token_expires_at=None,
    )
    account = await db_session.get(CloudIntegrationAccount, account_record.id)
    client_row = await db_session.get(CloudIntegrationOAuthClient, provider_client.id)
    assert account is not None and client_row is not None and revision is not None
    account.definition_security_revision_id = revision.id
    account.provider_client_id = provider_client.id
    account.credential_audience = "https://mcp.slack.com/mcp"
    client_row.lifecycle_state = "retired"
    await db_session.commit()

    calls = 0

    async def _unexpected_provider_call(**_kwargs: object) -> dict[str, object]:
        nonlocal calls
        calls += 1
        return {"content": [], "isError": False}

    monkeypatch.setattr(
        "proliferate.server.integration_gateway.gateway.service.mcp_remote.call_tool",
        _unexpected_provider_call,
    )
    result = await _tool_call(
        client,
        {"Authorization": f"Bearer {bearer}"},
        name="integrations.call_tool",
        arguments={
            "provider": "slack",
            "tool": "slack_search_public",
            "arguments": {"query": "release"},
        },
    )

    assert result["isError"] is True
    assert "OAuth client changed" in result["content"][0]["text"]
    assert calls == 0


@pytest.mark.asyncio
async def test_disconnect_after_admission_cannot_recreate_cache_or_future_access(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    auth = await _authed_user(client, db_session, prefix="admission-cutoff-race")
    bearer = await _enroll_gateway_bearer(client, auth, prefix="admission-cutoff-race")
    worker = await _worker(db_session)
    await _seed_ready_account(
        db_session,
        user_id=str(worker.owner_user_id),
        namespace="context7",
    )
    definition = await definitions_store.get_seed_by_namespace(db_session, "context7")
    assert definition is not None
    account = await accounts_store.get_account_for_user_definition(
        db_session,
        worker.owner_user_id,
        definition.id,
    )
    assert account is not None

    provider_started = asyncio.Event()
    provider_may_finish = asyncio.Event()
    provider_calls = 0

    async def _blocked_list_tools(**_kwargs: object) -> list[dict[str, object]]:
        nonlocal provider_calls
        provider_calls += 1
        provider_started.set()
        await provider_may_finish.wait()
        return [{"name": "resolve-library-id", "inputSchema": {"type": "object"}}]

    monkeypatch.setattr(
        "proliferate.server.integration_gateway.connections.tools.mcp_remote.list_tools",
        _blocked_list_tools,
    )
    headers = {"Authorization": f"Bearer {bearer}"}
    first_call = asyncio.create_task(
        _tool_call(
            client,
            headers,
            name="integrations.list_tools",
            arguments={"provider": "context7"},
        )
    )
    await asyncio.wait_for(provider_started.wait(), timeout=5)

    disconnected = await client.delete(
        f"/v1/cloud/integrations/accounts/{account.id}",
        headers=auth.headers,
    )
    assert disconnected.status_code == 204, disconnected.text
    provider_may_finish.set()
    first_result = await asyncio.wait_for(first_call, timeout=5)
    assert first_result["structuredContent"]["tools"][0]["name"] == "resolve-library-id"

    await db_session.rollback()
    assert await accounts_store.get_account(db_session, account.id) is None
    assert await db_session.get(CloudIntegrationToolSchemaCache, account.id) is None

    after_cutoff = await _tool_call(
        client,
        headers,
        name="integrations.list_tools",
        arguments={"provider": "context7"},
    )
    assert after_cutoff["isError"] is True
    assert provider_calls == 1
