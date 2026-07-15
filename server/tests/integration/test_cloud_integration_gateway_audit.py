"""Integration-gateway tool-call audit rows (cloud_integration_tool_call_event).

Every ``integrations.call_tool`` proxied through the gateway must leave one
queryable audit row — success, tool-level error, provider-resolution failure,
or upstream transport failure.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.integrations import CloudIntegrationToolCallEvent
from proliferate.db.models.cloud.runtime_workers import CloudRuntimeWorker
from proliferate.integrations.mcp_remote import McpRemoteError
from tests.integration.test_cloud_integration_gateway_api import (
    _gateway_bearer,
    _seed_ready_account,
    _tool_call,
    _worker_cloud_base_url,  # noqa: F401 - autouse fixture re-export
)


async def _tool_call_events(db_session: AsyncSession) -> list[CloudIntegrationToolCallEvent]:
    return list(
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


async def _seeded_worker_bearer(
    client: AsyncClient, db_session: AsyncSession, *, prefix: str
) -> tuple[str, CloudRuntimeWorker]:
    bearer = await _gateway_bearer(client, db_session, prefix=prefix)
    worker = (await db_session.execute(select(CloudRuntimeWorker))).scalars().first()
    assert worker is not None
    await _seed_ready_account(db_session, user_id=str(worker.owner_user_id), namespace="context7")
    return bearer, worker


@pytest.mark.asyncio
async def test_call_tool_success_writes_audit_event(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    bearer, worker = await _seeded_worker_bearer(client, db_session, prefix="gw-audit-ok")
    headers = {"Authorization": f"Bearer {bearer}"}

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
    bearer, _ = await _seeded_worker_bearer(client, db_session, prefix="gw-audit-down")
    headers = {"Authorization": f"Bearer {bearer}"}

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
    bearer, _ = await _seeded_worker_bearer(client, db_session, prefix="gw-audit-toolerr")
    headers = {"Authorization": f"Bearer {bearer}"}

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
