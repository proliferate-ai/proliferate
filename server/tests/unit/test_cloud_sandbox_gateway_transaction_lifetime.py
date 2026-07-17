"""Transaction lifetime guarantees for long-lived cloud sandbox proxies."""

from __future__ import annotations

from types import SimpleNamespace
from typing import cast

import pytest
from fastapi import Request, WebSocket
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import Response

from proliferate.db.models.auth import User
from proliferate.server.cloud.gateway import api as gateway_api


@pytest.mark.asyncio
async def test_http_gateway_commits_access_before_starting_stream(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[str] = []
    db = cast(AsyncSession, object())
    user = cast(User, object())
    request = cast(Request, object())

    async def _access(actual_db: object, actual_user: object) -> object:
        assert actual_db is db
        assert actual_user is user
        events.append("access")
        return SimpleNamespace(upstream_base_url="http://up", upstream_token="token")

    async def _commit(actual_db: object) -> None:
        assert actual_db is db
        events.append("commit")

    async def _proxy(actual_request: object, **_kwargs: object) -> Response:
        assert actual_request is request
        assert events == ["access", "commit"]
        events.append("stream")
        return Response()

    monkeypatch.setattr(gateway_api, "ensure_cloud_sandbox_gateway_access", _access)
    monkeypatch.setattr(gateway_api.session_ops, "commit_session", _commit)
    monkeypatch.setattr(gateway_api, "proxy_http_to_anyharness", _proxy)

    await gateway_api.proxy_cloud_sandbox_anyharness_http(
        "v1/sessions/session-id/stream",
        request,
        db,
        user,
    )

    assert events == ["access", "commit", "stream"]


@pytest.mark.asyncio
async def test_websocket_gateway_commits_access_before_starting_proxy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[str] = []
    db = cast(AsyncSession, object())
    user = cast(User, object())
    websocket = cast(WebSocket, object())

    async def _authenticate(actual_db: object, token: object) -> object:
        assert actual_db is db
        assert token == "product-token"
        events.append("authenticate")
        return user

    async def _access(actual_db: object, actual_user: object) -> object:
        assert actual_db is db
        assert actual_user is user
        events.append("access")
        return SimpleNamespace(upstream_base_url="http://up", upstream_token="token")

    async def _commit(actual_db: object) -> None:
        assert actual_db is db
        events.append("commit")

    async def _proxy(actual_websocket: object, **_kwargs: object) -> None:
        assert actual_websocket is websocket
        assert events == ["authenticate", "access", "commit"]
        events.append("proxy")

    monkeypatch.setattr(
        gateway_api,
        "authenticate_product_user_for_gateway_websocket",
        _authenticate,
    )
    monkeypatch.setattr(gateway_api, "ensure_cloud_sandbox_gateway_access", _access)
    monkeypatch.setattr(gateway_api.session_ops, "commit_session", _commit)
    monkeypatch.setattr(gateway_api, "proxy_websocket_to_anyharness", _proxy)
    monkeypatch.setattr(
        gateway_api,
        "product_token_from_websocket",
        lambda _websocket: "product-token",
    )
    monkeypatch.setattr(
        gateway_api,
        "accepted_gateway_websocket_subprotocol",
        lambda _websocket: None,
    )
    monkeypatch.setattr(gateway_api, "clear_server_sentry_user", lambda: None)

    await gateway_api.proxy_cloud_sandbox_anyharness_websocket(
        websocket,
        "v1/terminals/terminal-id/ws",
        db,
    )

    assert events == ["authenticate", "access", "commit", "proxy"]
