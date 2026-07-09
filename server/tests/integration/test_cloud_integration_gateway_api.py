from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_MEMBERSHIP_STATUS_REMOVED,
    ORGANIZATION_ROLE_MEMBER,
    ORGANIZATION_STATUS_ACTIVE,
)
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.store.integrations import accounts as accounts_store
from proliferate.db.store.integrations import definitions as definitions_store
from proliferate.server.cloud.integrations.seeds import sync_seed_definitions
from proliferate.utils.crypto import encrypt_json
from proliferate.config import settings
from tests.e2e.cloud.helpers.auth import create_user_and_login
from tests.e2e.cloud.helpers.github import seed_linked_github_account

GATEWAY_URL = "/v1/cloud/integration-gateway/mcp"


@pytest.fixture(autouse=True)
def _worker_cloud_base_url(monkeypatch: pytest.MonkeyPatch) -> None:
    # Worker enrollment mints the integration-gateway URL from the configured
    # base; CI has no .env, so provide one the way production config would.
    monkeypatch.setattr(settings, "cloud_worker_base_url", "http://cloud.test")


async def _authed_user(client: AsyncClient, db_session: AsyncSession, *, prefix: str):
    auth = await create_user_and_login(client, db_session, email_prefix=prefix)
    await seed_linked_github_account(db_session, user_id=auth.user_id, access_token=f"gh-{prefix}")
    return auth


async def _enroll_gateway_bearer(
    client: AsyncClient,
    auth,
    *,
    prefix: str,
    organization_id: str | None = None,
) -> str:
    body: dict[str, str] = {"desktopInstallId": f"install-{prefix}"}
    if organization_id is not None:
        body["organizationId"] = organization_id
    enrollment = await client.post(
        "/v1/cloud/workers/desktop/enrollment",
        headers=auth.headers,
        json=body,
    )
    assert enrollment.status_code == 200, enrollment.text
    token = enrollment.json()["enrollmentToken"]
    enroll = await client.post("/v1/cloud/worker/enroll", json={"enrollmentToken": token})
    authorization = enroll.json()["integrationGateway"]["authorization"]
    return authorization.removeprefix("Bearer ")


async def _gateway_bearer(client: AsyncClient, db_session: AsyncSession, *, prefix: str) -> str:
    auth = await _authed_user(client, db_session, prefix=prefix)
    return await _enroll_gateway_bearer(client, auth, prefix=prefix)


async def _seed_ready_account(db_session: AsyncSession, *, user_id: str, namespace: str) -> None:
    await sync_seed_definitions(db_session)
    await db_session.commit()
    definition = await definitions_store.get_seed_by_namespace(db_session, namespace)
    assert definition is not None
    account = await accounts_store.upsert_account(
        db_session,
        user_id=uuid.UUID(user_id),
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


async def _create_org_with_member(db_session: AsyncSession, *, user_id: str) -> str:
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
            role=ORGANIZATION_ROLE_MEMBER,
            status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            joined_at=now,
            created_at=now,
            updated_at=now,
        )
    )
    await db_session.commit()
    return str(organization.id)


@pytest.mark.asyncio
async def test_gateway_rejects_bad_token(client: AsyncClient) -> None:
    response = await client.post(
        GATEWAY_URL,
        headers={"Authorization": "Bearer nope"},
        json={"jsonrpc": "2.0", "id": 1, "method": "initialize"},
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_gateway_initialize_and_tools_list(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    bearer = await _gateway_bearer(client, db_session, prefix="gw-init")
    headers = {"Authorization": f"Bearer {bearer}"}

    init = await client.post(
        GATEWAY_URL,
        headers=headers,
        json={"jsonrpc": "2.0", "id": 1, "method": "initialize"},
    )
    assert init.status_code == 200, init.text
    assert init.json()["result"]["serverInfo"]["name"] == "proliferate_integrations"

    tools = await client.post(
        GATEWAY_URL,
        headers=headers,
        json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
    )
    names = {t["name"] for t in tools.json()["result"]["tools"]}
    assert names == {
        "integrations.list_providers",
        "integrations.list_tools",
        "integrations.call_tool",
    }


@pytest.mark.asyncio
async def test_gateway_notifications_return_202(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    bearer = await _gateway_bearer(client, db_session, prefix="gw-notify")
    response = await client.post(
        GATEWAY_URL,
        headers={"Authorization": f"Bearer {bearer}"},
        json={"jsonrpc": "2.0", "method": "notifications/initialized"},
    )
    assert response.status_code == 202


@pytest.mark.asyncio
async def test_list_providers_reflects_ready_accounts(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    bearer = await _gateway_bearer(client, db_session, prefix="gw-providers")
    headers = {"Authorization": f"Bearer {bearer}"}

    # No accounts yet -> empty provider list.
    empty = await client.post(
        GATEWAY_URL,
        headers=headers,
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": "integrations.list_providers", "arguments": {}},
        },
    )
    assert empty.json()["result"]["structuredContent"]["providers"] == []

    # The gateway grant resolves to the enrolled worker's owner; seed an account
    # for that user by reading it back from the worker owner.
    from sqlalchemy import select

    from proliferate.db.models.cloud.runtime_workers import CloudRuntimeWorker

    worker = (await db_session.execute(select(CloudRuntimeWorker))).scalars().first()
    assert worker is not None
    await _seed_ready_account(db_session, user_id=str(worker.owner_user_id), namespace="context7")

    listed = await client.post(
        GATEWAY_URL,
        headers=headers,
        json={
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {"name": "integrations.list_providers", "arguments": {}},
        },
    )
    providers = listed.json()["result"]["structuredContent"]["providers"]
    assert [p["provider"] for p in providers] == ["context7"]


@pytest.mark.asyncio
async def test_call_tool_proxies_to_upstream(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    bearer = await _gateway_bearer(client, db_session, prefix="gw-call")
    headers = {"Authorization": f"Bearer {bearer}"}

    from sqlalchemy import select

    from proliferate.db.models.cloud.runtime_workers import CloudRuntimeWorker

    worker = (await db_session.execute(select(CloudRuntimeWorker))).scalars().first()
    assert worker is not None
    await _seed_ready_account(db_session, user_id=str(worker.owner_user_id), namespace="context7")

    captured: dict[str, object] = {}

    async def fake_call_tool(*, url, headers, tool_name, arguments, query=None):
        captured.update(
            {"url": url, "headers": headers, "tool_name": tool_name, "arguments": arguments}
        )
        return {"content": [{"type": "text", "text": "ok"}], "isError": False}

    monkeypatch.setattr(
        "proliferate.server.cloud.integration_gateway.service.mcp_remote.call_tool",
        fake_call_tool,
    )

    response = await client.post(
        GATEWAY_URL,
        headers=headers,
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "integrations.call_tool",
                "arguments": {
                    "provider": "context7",
                    "tool": "resolve-library-id",
                    "arguments": {"q": "react"},
                },
            },
        },
    )
    assert response.status_code == 200, response.text
    result = response.json()["result"]["structuredContent"]
    assert result["isError"] is False
    assert captured["tool_name"] == "resolve-library-id"
    # The upstream received the Cloud-held credential, never the agent.
    assert captured["headers"].get("Authorization") == "Bearer secret"


@pytest.mark.asyncio
async def test_call_tool_unknown_provider_returns_mcp_error(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    bearer = await _gateway_bearer(client, db_session, prefix="gw-unknown")
    response = await client.post(
        GATEWAY_URL,
        headers={"Authorization": f"Bearer {bearer}"},
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "integrations.call_tool",
                "arguments": {"provider": "nope", "tool": "x", "arguments": {}},
            },
        },
    )
    assert response.status_code == 200
    assert response.json()["result"]["isError"] is True


@pytest.mark.asyncio
async def test_call_tool_upstream_failure_returns_mcp_error_not_500(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    bearer = await _gateway_bearer(client, db_session, prefix="gw-upstream-down")
    headers = {"Authorization": f"Bearer {bearer}"}

    from sqlalchemy import select

    from proliferate.db.models.cloud.runtime_workers import CloudRuntimeWorker
    from proliferate.integrations.mcp_remote import McpRemoteError

    worker = (await db_session.execute(select(CloudRuntimeWorker))).scalars().first()
    await _seed_ready_account(db_session, user_id=str(worker.owner_user_id), namespace="context7")

    async def failing_call_tool(*, url, headers, tool_name, arguments, query=None):
        raise McpRemoteError("upstream is down", code="transport_error")

    monkeypatch.setattr(
        "proliferate.server.cloud.integration_gateway.service.mcp_remote.call_tool",
        failing_call_tool,
    )

    # A batch: an upstream failure must not 500 or discard the sibling response.
    response = await client.post(
        GATEWAY_URL,
        headers=headers,
        json=[
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "integrations.call_tool",
                    "arguments": {"provider": "context7", "tool": "x", "arguments": {}},
                },
            },
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
        ],
    )
    assert response.status_code == 200, response.text
    by_id = {r["id"]: r for r in response.json()}
    assert by_id[1]["result"]["isError"] is True
    assert by_id[2]["result"]["tools"]  # sibling still returned


async def _tool_call(client: AsyncClient, headers: dict[str, str], *, name: str, arguments: dict):
    response = await client.post(
        GATEWAY_URL,
        headers=headers,
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments},
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["result"]


@pytest.mark.asyncio
async def test_org_scoped_grant_stops_serving_after_membership_removal(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    auth = await _authed_user(client, db_session, prefix="gw-membership")
    org_id = await _create_org_with_member(db_session, user_id=auth.user_id)
    bearer = await _enroll_gateway_bearer(
        client, auth, prefix="gw-membership", organization_id=org_id
    )
    headers = {"Authorization": f"Bearer {bearer}"}
    request_body = {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}

    ok = await client.post(GATEWAY_URL, headers=headers, json=request_body)
    assert ok.status_code == 200, ok.text

    # Remove the owner from the org: the long-lived org-scoped grant must stop
    # serving immediately, not at the next re-enrollment.
    from sqlalchemy import select

    membership = (
        await db_session.execute(
            select(OrganizationMembership).where(
                OrganizationMembership.organization_id == uuid.UUID(org_id),
                OrganizationMembership.user_id == uuid.UUID(auth.user_id),
            )
        )
    ).scalar_one()
    membership.status = ORGANIZATION_MEMBERSHIP_STATUS_REMOVED
    await db_session.commit()

    revoked = await client.post(GATEWAY_URL, headers=headers, json=request_body)
    assert revoked.status_code == 401


@pytest.mark.asyncio
async def test_gateway_get_returns_method_not_allowed(client: AsyncClient) -> None:
    # No GET event stream is offered; streamable-HTTP clients rely on 405 to
    # stop re-opening the stream.
    response = await client.get(GATEWAY_URL)
    assert response.status_code == 405
    assert response.headers.get("allow") == "POST"


@pytest.mark.asyncio
async def test_gateway_grant_resolves_without_stamping_last_used(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    bearer = await _gateway_bearer(client, db_session, prefix="gw-grant")
    init = await client.post(
        GATEWAY_URL,
        headers={"Authorization": f"Bearer {bearer}"},
        json={"jsonrpc": "2.0", "id": 1, "method": "initialize"},
    )
    assert init.status_code == 200, init.text

    from sqlalchemy import select

    from proliferate.db.models.cloud.runtime_workers import CloudIntegrationGatewayToken

    token = (await db_session.execute(select(CloudIntegrationGatewayToken))).scalars().one()
    assert token.status == "active"
    # The hot path no longer stamps last_used_at per request.
    assert token.last_used_at is None


@pytest.mark.asyncio
async def test_list_tools_cache_refetches_after_ttl(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    bearer = await _gateway_bearer(client, db_session, prefix="gw-ttl")
    headers = {"Authorization": f"Bearer {bearer}"}

    from sqlalchemy import select, update

    from proliferate.db.models.cloud.runtime_workers import CloudRuntimeWorker

    worker = (await db_session.execute(select(CloudRuntimeWorker))).scalars().first()
    assert worker is not None
    await _seed_ready_account(db_session, user_id=str(worker.owner_user_id), namespace="context7")

    calls = {"count": 0}

    async def fake_list_tools(*, url, headers, query=None):
        calls["count"] += 1
        return [{"name": "resolve-library-id", "inputSchema": {"type": "object"}}]

    monkeypatch.setattr(
        "proliferate.server.cloud.integrations.tools.mcp_remote.list_tools",
        fake_list_tools,
    )

    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": "integrations.list_tools", "arguments": {"provider": "context7"}},
    }
    first = await client.post(GATEWAY_URL, headers=headers, json=payload)
    assert first.status_code == 200, first.text
    assert calls["count"] == 1

    # A fresh, version-matching cache is served without refetching.
    second = await client.post(GATEWAY_URL, headers=headers, json=payload)
    assert second.status_code == 200, second.text
    assert calls["count"] == 1

    # Backdating the fetch beyond the TTL makes the cache stale again.
    from datetime import UTC, datetime, timedelta

    from proliferate.constants.cloud import CLOUD_INTEGRATION_TOOL_CACHE_TTL_SECONDS
    from proliferate.db.models.cloud.integrations import CloudIntegrationToolSchemaCache

    await db_session.execute(
        update(CloudIntegrationToolSchemaCache).values(
            fetched_at=datetime.now(UTC)
            - timedelta(seconds=CLOUD_INTEGRATION_TOOL_CACHE_TTL_SECONDS + 60)
        )
    )
    await db_session.commit()

    third = await client.post(GATEWAY_URL, headers=headers, json=payload)
    assert third.status_code == 200, third.text
    assert calls["count"] == 2


async def _tool_call_events(db_session: AsyncSession):
    from sqlalchemy import select

    from proliferate.db.models.cloud.integrations import CloudIntegrationToolCallEvent

    return (
        (
            await db_session.execute(
                select(CloudIntegrationToolCallEvent).order_by(
                    CloudIntegrationToolCallEvent.created_at
                )
            )
        )
        .scalars()
        .all()
    )


@pytest.mark.asyncio
async def test_call_tool_success_writes_audit_event(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    bearer = await _gateway_bearer(client, db_session, prefix="gw-audit-ok")
    headers = {"Authorization": f"Bearer {bearer}"}

    from sqlalchemy import select

    from proliferate.db.models.cloud.runtime_workers import CloudRuntimeWorker

    worker = (await db_session.execute(select(CloudRuntimeWorker))).scalars().first()
    assert worker is not None
    await _seed_ready_account(db_session, user_id=str(worker.owner_user_id), namespace="context7")

    async def fake_call_tool(*, url, headers, tool_name, arguments, query=None):
        return {"content": [{"type": "text", "text": "ok"}], "isError": False}

    monkeypatch.setattr(
        "proliferate.server.cloud.integration_gateway.service.mcp_remote.call_tool",
        fake_call_tool,
    )

    result = await _tool_call(
        client,
        headers,
        name="integrations.call_tool",
        arguments={"provider": "context7", "tool": "resolve-library-id", "arguments": {}},
    )
    assert result["structuredContent"]["isError"] is False

    events = await _tool_call_events(db_session)
    assert len(events) == 1
    event = events[0]
    assert event.ok is True
    assert event.error_code is None
    assert event.integration_namespace == "context7"
    assert event.tool_name == "resolve-library-id"
    assert event.user_id == worker.owner_user_id
    assert event.organization_id is None
    assert event.runtime_worker_id == worker.id
    assert event.latency_ms >= 0


@pytest.mark.asyncio
async def test_call_tool_upstream_failure_writes_audit_event(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    bearer = await _gateway_bearer(client, db_session, prefix="gw-audit-down")
    headers = {"Authorization": f"Bearer {bearer}"}

    from sqlalchemy import select

    from proliferate.db.models.cloud.runtime_workers import CloudRuntimeWorker
    from proliferate.integrations.mcp_remote import McpRemoteError

    worker = (await db_session.execute(select(CloudRuntimeWorker))).scalars().first()
    assert worker is not None
    await _seed_ready_account(db_session, user_id=str(worker.owner_user_id), namespace="context7")

    async def failing_call_tool(*, url, headers, tool_name, arguments, query=None):
        raise McpRemoteError("upstream is down", code="transport_error")

    monkeypatch.setattr(
        "proliferate.server.cloud.integration_gateway.service.mcp_remote.call_tool",
        failing_call_tool,
    )

    result = await _tool_call(
        client,
        headers,
        name="integrations.call_tool",
        arguments={"provider": "context7", "tool": "resolve-library-id", "arguments": {}},
    )
    assert result["isError"] is True

    events = await _tool_call_events(db_session)
    assert len(events) == 1
    event = events[0]
    assert event.ok is False
    assert event.error_code == "transport_error"
    assert event.integration_namespace == "context7"
    assert event.tool_name == "resolve-library-id"


@pytest.mark.asyncio
async def test_call_tool_tool_level_error_writes_audit_event(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    # The upstream answered, but the tool itself reported an error: still
    # audited, as a failure with the dedicated tool_error code.
    bearer = await _gateway_bearer(client, db_session, prefix="gw-audit-toolerr")
    headers = {"Authorization": f"Bearer {bearer}"}

    from sqlalchemy import select

    from proliferate.db.models.cloud.runtime_workers import CloudRuntimeWorker

    worker = (await db_session.execute(select(CloudRuntimeWorker))).scalars().first()
    assert worker is not None
    await _seed_ready_account(db_session, user_id=str(worker.owner_user_id), namespace="context7")

    async def erroring_call_tool(*, url, headers, tool_name, arguments, query=None):
        return {"content": [{"type": "text", "text": "bad args"}], "isError": True}

    monkeypatch.setattr(
        "proliferate.server.cloud.integration_gateway.service.mcp_remote.call_tool",
        erroring_call_tool,
    )

    result = await _tool_call(
        client,
        headers,
        name="integrations.call_tool",
        arguments={"provider": "context7", "tool": "resolve-library-id", "arguments": {}},
    )
    assert result["structuredContent"]["isError"] is True

    events = await _tool_call_events(db_session)
    assert len(events) == 1
    assert events[0].ok is False
    assert events[0].error_code == "tool_error"


@pytest.mark.asyncio
async def test_call_tool_unknown_provider_writes_audit_event(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    bearer = await _gateway_bearer(client, db_session, prefix="gw-audit-noprov")
    headers = {"Authorization": f"Bearer {bearer}"}

    result = await _tool_call(
        client,
        headers,
        name="integrations.call_tool",
        arguments={"provider": "nope", "tool": "x", "arguments": {}},
    )
    assert result["isError"] is True

    events = await _tool_call_events(db_session)
    assert len(events) == 1
    event = events[0]
    assert event.ok is False
    assert event.error_code == "integration_provider_not_found"
    assert event.integration_namespace == "nope"
    assert event.tool_name == "x"
