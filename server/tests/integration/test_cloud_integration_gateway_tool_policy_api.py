"""Fail-closed Slack tool policy at the hosted integration gateway."""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.models.cloud.integrations import CloudIntegrationToolCallEvent
from proliferate.db.models.cloud.runtime_workers import CloudRuntimeWorker
from proliferate.db.store.integrations import accounts as accounts_store
from proliferate.db.store.integrations import definitions as definitions_store
from proliferate.server.cloud.integration_gateway.domain.tool_policy import (
    SLACK_MUTATING_TOOL_NAMES,
)
from proliferate.server.cloud.integrations.seeds import sync_seed_definitions
from proliferate.utils.crypto import encrypt_json
from tests.integration.test_cloud_integration_gateway_api import (
    GATEWAY_URL,
    _authed_user,
    _gateway_bearer,
    _seed_ready_account,
    _tool_call,
)

MCP_SESSION_HEADER = "Mcp-Session-Id"


@pytest.fixture(autouse=True)
def _worker_cloud_base_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "cloud_worker_base_url", "http://cloud.test")


async def _first_worker(db_session: AsyncSession) -> CloudRuntimeWorker:
    worker = (await db_session.execute(select(CloudRuntimeWorker))).scalars().first()
    assert worker is not None
    return worker


async def _initialized_gateway_headers(
    client: AsyncClient,
    *,
    bearer: str,
) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {bearer}"}
    initialized = await client.post(
        GATEWAY_URL,
        headers=headers,
        json={"jsonrpc": "2.0", "id": 1, "method": "initialize"},
    )
    assert initialized.status_code == 200, initialized.text
    return {**headers, MCP_SESSION_HEADER: initialized.headers[MCP_SESSION_HEADER]}


async def _seed_ready_slack_account(
    db_session: AsyncSession,
    *,
    user_id: uuid.UUID,
) -> None:
    await sync_seed_definitions(db_session)
    await db_session.commit()
    definition = await definitions_store.get_seed_by_namespace(db_session, "slack")
    assert definition is not None
    account = await accounts_store.upsert_account(
        db_session,
        user_id=user_id,
        definition_id=definition.id,
        auth_kind="oauth2",
        status="ready",
    )
    await accounts_store.set_account_credentials(
        db_session,
        account_id=account.id,
        credential_ciphertext=encrypt_json(
            {
                "issuer": "https://slack.com",
                "resource": "https://mcp.slack.com/mcp",
                "clientId": "slack-client",
                "accessToken": "slack-read-token",
                "refreshToken": "slack-refresh-token",
                "expiresAt": None,
                "scopes": [],
                "tokenEndpoint": "https://slack.com/api/oauth.v2.user.access",
                "redirectUri": ("https://api.example.com/v1/cloud/integrations/oauth/callback"),
            }
        ),
        credential_format="oauth-bundle-v1",
        auth_status="ready",
        token_expires_at=None,
    )
    await db_session.commit()


@pytest.mark.asyncio
async def test_known_slack_read_tool_executes_directly(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bearer = await _gateway_bearer(client, db_session, prefix="gw-slack-policy-read")
    worker = await _first_worker(db_session)
    await _seed_ready_slack_account(db_session, user_id=worker.owner_user_id)
    captured: dict[str, object] = {}

    async def fake_call_tool(*, url, headers, tool_name, arguments, query=None):
        captured.update(
            {
                "headers": headers,
                "tool_name": tool_name,
                "arguments": arguments,
            }
        )
        return {"content": [{"type": "text", "text": "read result"}], "isError": False}

    monkeypatch.setattr(
        "proliferate.server.cloud.integration_gateway.service.mcp_remote.call_tool",
        fake_call_tool,
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

    assert result["structuredContent"]["isError"] is False
    assert captured["tool_name"] == "slack_search_public"
    assert captured["arguments"] == {"query": "release"}
    captured_headers = captured["headers"]
    assert isinstance(captured_headers, dict)
    assert captured_headers.get("Authorization") == "Bearer slack-read-token"


@pytest.mark.asyncio
async def test_every_known_slack_mutation_returns_typed_approval_required(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bearer = await _gateway_bearer(client, db_session, prefix="gw-slack-policy-write")
    worker = await _first_worker(db_session)
    await _seed_ready_slack_account(db_session, user_id=worker.owner_user_id)
    gateway_headers = await _initialized_gateway_headers(client, bearer=bearer)

    async def unexpected_call_tool(**_kwargs: object) -> dict[str, object]:
        raise AssertionError("Slack mutation reached the upstream MCP")

    monkeypatch.setattr(
        "proliferate.server.cloud.integration_gateway.service.mcp_remote.call_tool",
        unexpected_call_tool,
    )

    for tool in sorted(SLACK_MUTATING_TOOL_NAMES):
        result = await _tool_call(
            client,
            gateway_headers,
            name="integrations.call_tool",
            arguments={
                "provider": "slack",
                "tool": tool,
                "arguments": {
                    "approved": True,
                    "userConfirmed": True,
                    "approvalToken": "agent-claimed-approval",
                },
            },
        )

        assert result["isError"] is True
        error = result["structuredContent"]["error"]
        assert error["code"] == "integration_tool_approval_required"
        assert error["provider"] == "slack"
        assert error["tool"] == tool
        assert error["approval"]["required"] is True
        assert error["approval"]["status"] == "pending"
        assert error["approval"]["actionSummary"].startswith("Slack external action:")
        assert len(error["approval"]["payloadDigest"]) == 64
        assert "agent-claimed-approval" not in str(error)

    await db_session.rollback()
    events = list(
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
    assert {event.tool_name for event in events} == set(SLACK_MUTATING_TOOL_NAMES)
    assert {event.error_code for event in events} == {"integration_tool_approval_required"}
    assert all(event.ok is False for event in events)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "tool",
    ["slack_send_message_v2", "slack_search_public ", "Slack_search_public"],
)
async def test_unknown_or_inexact_slack_tool_fails_closed(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    tool: str,
) -> None:
    bearer = await _gateway_bearer(
        client,
        db_session,
        prefix=f"gw-slack-policy-unknown-{uuid.uuid4().hex}",
    )

    async def unexpected_call_tool(**_kwargs: object) -> dict[str, object]:
        raise AssertionError("Unknown Slack tool reached the upstream MCP")

    monkeypatch.setattr(
        "proliferate.server.cloud.integration_gateway.service.mcp_remote.call_tool",
        unexpected_call_tool,
    )

    result = await _tool_call(
        client,
        {"Authorization": f"Bearer {bearer}"},
        name="integrations.call_tool",
        arguments={"provider": "slack", "tool": tool, "arguments": {}},
    )

    assert result["isError"] is True
    assert result["structuredContent"]["error"] == {
        "code": "integration_tool_not_allowed",
        "message": "This provider tool is not allowed by the integration gateway.",
        "provider": "slack",
        "tool": tool,
        "approval": {"required": False, "status": "not_applicable"},
    }


@pytest.mark.asyncio
async def test_unrecognized_policy_verdict_fails_closed(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bearer = await _gateway_bearer(client, db_session, prefix="gw-policy-verdict")

    monkeypatch.setattr(
        "proliferate.server.cloud.integration_gateway.service.decide_tool_call",
        lambda **_kwargs: object(),
    )

    result = await _tool_call(
        client,
        {"Authorization": f"Bearer {bearer}"},
        name="integrations.call_tool",
        arguments={
            "provider": "slack",
            "tool": "slack_search_public",
            "arguments": {},
        },
    )

    assert result["isError"] is True
    assert result["structuredContent"]["error"]["code"] == ("integration_tool_not_allowed")


@pytest.mark.asyncio
async def test_non_slack_provider_preserves_current_tool_execution(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bearer = await _gateway_bearer(client, db_session, prefix="gw-provider-isolation")
    worker = await _first_worker(db_session)
    await _seed_ready_account(
        db_session,
        user_id=str(worker.owner_user_id),
        namespace="context7",
    )
    called = False

    async def fake_call_tool(**_kwargs: object) -> dict[str, object]:
        nonlocal called
        called = True
        return {"content": [{"type": "text", "text": "ok"}], "isError": False}

    monkeypatch.setattr(
        "proliferate.server.cloud.integration_gateway.service.mcp_remote.call_tool",
        fake_call_tool,
    )

    result = await _tool_call(
        client,
        {"Authorization": f"Bearer {bearer}"},
        name="integrations.call_tool",
        arguments={
            "provider": "context7",
            "tool": "slack_send_message",
            "arguments": {},
        },
    )

    assert result["structuredContent"]["isError"] is False
    assert called is True


@pytest.mark.asyncio
async def test_worker_token_and_gateway_arguments_cannot_bypass_policy(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    auth = await _authed_user(client, db_session, prefix="gw-policy-worker-bypass")
    enrollment = await client.post(
        "/v1/cloud/workers/desktop/enrollment",
        headers=auth.headers,
        json={"desktopInstallId": "install-gw-policy-worker-bypass"},
    )
    assert enrollment.status_code == 200, enrollment.text
    enrolled = await client.post(
        "/v1/cloud/worker/enroll",
        json={"enrollmentToken": enrollment.json()["enrollmentToken"]},
    )
    assert enrolled.status_code == 200, enrolled.text

    worker_token = enrolled.json()["workerToken"]
    worker_attempt = await client.post(
        GATEWAY_URL,
        headers={"Authorization": f"Bearer {worker_token}"},
        json={"jsonrpc": "2.0", "id": 1, "method": "initialize"},
    )
    assert worker_attempt.status_code == 401

    gateway_authorization = enrolled.json()["integrationGateway"]["authorization"]
    await _seed_ready_slack_account(db_session, user_id=uuid.UUID(auth.user_id))
    initialized = await client.post(
        GATEWAY_URL,
        headers={"Authorization": gateway_authorization},
        json={"jsonrpc": "2.0", "id": 1, "method": "initialize"},
    )
    assert initialized.status_code == 200
    result = await _tool_call(
        client,
        {
            "Authorization": gateway_authorization,
            MCP_SESSION_HEADER: initialized.headers[MCP_SESSION_HEADER],
        },
        name="integrations.call_tool",
        arguments={
            "provider": "slack",
            "tool": "slack_send_message",
            "arguments": {
                "approved": True,
                "userConfirmed": True,
                "message": "do not send",
            },
        },
    )
    assert result["isError"] is True
    assert result["structuredContent"]["error"]["code"] == ("integration_tool_approval_required")
