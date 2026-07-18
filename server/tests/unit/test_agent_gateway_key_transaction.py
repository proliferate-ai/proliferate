from __future__ import annotations

from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import UUID

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from starlette.types import Message, Receive, Scope, Send

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.store.agent_gateway.records import AgentApiKeyRecord
from proliferate.server.cloud.agent_gateway import api
from proliferate.server.cloud.agent_gateway import service as agent_gateway_service


@pytest.mark.asyncio
async def test_key_create_commit_finishes_before_response_starts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Create-and-bind callers can immediately reference the returned key."""
    app = FastAPI()
    app.include_router(api.router, prefix="/v1/cloud")
    commits_finished = 0
    commits_at_response_start: list[int] = []
    user_id = UUID("00000000-0000-0000-0000-000000000001")
    key_id = UUID("00000000-0000-0000-0000-000000000002")

    async def observed_session() -> AsyncGenerator[object, None]:
        nonlocal commits_finished
        yield object()
        commits_finished += 1

    async def product_user() -> SimpleNamespace:
        return SimpleNamespace(id=user_id)

    async def create_key(*_args: object, **_kwargs: object) -> AgentApiKeyRecord:
        created_at = datetime(2026, 7, 18, tzinfo=UTC)
        return AgentApiKeyRecord(
            id=key_id,
            user_id=user_id,
            title="Qualification key",
            redacted_hint="sk-...test",
            status="active",
            created_at=created_at,
            updated_at=created_at,
        )

    app.dependency_overrides[get_async_session] = observed_session
    app.dependency_overrides[current_product_user] = product_user
    monkeypatch.setattr(agent_gateway_service, "create_api_key", create_key)

    async def observed_app(scope: Scope, receive: Receive, send: Send) -> None:
        async def observe_response_start(message: Message) -> None:
            if message["type"] == "http.response.start":
                commits_at_response_start.append(commits_finished)
            await send(message)

        await app(scope, receive, observe_response_start)

    async with AsyncClient(
        transport=ASGITransport(app=observed_app),
        base_url="http://test",
    ) as client:
        response = await client.post(
            "/v1/cloud/agent-gateway/keys",
            json={"title": "Qualification key", "value": "secret"},
        )

    assert response.status_code == 200
    assert response.json()["id"] == str(key_id)
    assert commits_at_response_start == [1]
